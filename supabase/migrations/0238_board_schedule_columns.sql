-- 0238_board_schedule_columns.sql — a cluster can carry a DATE.
--
-- Background. The schedule card (kind:'schedule' with a schedView) keeps its
-- items in the board's Y.Doc, keyed by date slot paths (lib/schedLayout.js).
-- Yjs is invisible to Postgres, so nothing outside that one card can answer
-- "what is on the calendar, for whom, on what day" — which rules out
-- notifications, a personal schedule, a digest, or any API-driven scheduling.
--
-- A film production is the motivating case: a 3-month calendar shared with the
-- whole crew, one child cluster per shoot day (script pages, call sheet,
-- shotlist, hour-by-hour), and a shoot date that moves at short notice. Making
-- the DATE a column on `boards` turns "move the day" into a single
-- authoritative write that notification fanout, the /api/v1 change feed and a
-- personal schedule view can all key off.
--
-- Ad-hoc Yjs items pinned to a day keep working exactly as they do now. The
-- calendar renders two layers; this migration is only about the second.

-- ── Columns ──────────────────────────────────────────────────────────────────
-- scheduled_date is a bare `date`, deliberately: it matches the card's existing
-- local-wall-clock model (see the header of lib/schedDates.js) and a production
-- shoots in one place. It is wrong the day someone shoots across a date line,
-- and that is a known, accepted limit rather than an oversight.
alter table public.boards
  add column if not exists scheduled_date     date,
  -- Inclusive end for a multi-day block (travel, a company move, a 2-day
  -- location). NULL = a single day.
  add column if not exists scheduled_end      date,
  -- The durable half of a day's identity: "Day 12", "Travel", "Company Move".
  -- The DATE is never typed into boards.name — every surface renders it from
  -- scheduled_date instead, so a moved day can't leave a stale name behind.
  add column if not exists day_label          text,
  add column if not exists sched_status       text not null default 'draft',
  -- The call-sheet version the crew already expects to see ("v3").
  add column if not exists sched_version      int  not null default 0,
  add column if not exists sched_published_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'boards_sched_status_chk'
      and conrelid = 'public.boards'::regclass
  ) then
    alter table public.boards
      add constraint boards_sched_status_chk
      check (sched_status in ('draft', 'published', 'cancelled'));
  end if;
  -- A backwards range is always a data bug; cheaper to reject than to render.
  if not exists (
    select 1 from pg_constraint
    where conname = 'boards_sched_range_chk'
      and conrelid = 'public.boards'::regclass
  ) then
    alter table public.boards
      add constraint boards_sched_range_chk
      check (scheduled_end is null
             or (scheduled_date is not null and scheduled_end >= scheduled_date));
  end if;
end $$;

-- The calendar's only query: dated children of one production, by date.
create index if not exists boards_parent_scheduled_date_idx
  on public.boards (parent_board_id, scheduled_date)
  where scheduled_date is not null;

-- ── Grant lockdown ───────────────────────────────────────────────────────────
-- `boards` carries TABLE-level grants (pg_class.relacl = authenticated=arwdxtm,
-- pg_attribute.attacl empty), so an ADD COLUMN is immediately writable by any
-- authenticated client through PostgREST. That would let a crew member PATCH
-- sched_version / sched_published_at directly and route around
-- publish_schedule_day() — the version and the notification would disagree,
-- which is exactly the failure a call sheet exists to prevent.
--
-- Postgres cannot revoke one column out of a table-level grant, so the grant is
-- replaced with an explicit column list. The list below is the 17 columns that
-- existed before this migration, verified against information_schema.columns on
-- the live database; the six new columns are deliberately absent. Writes to
-- them go through the SECURITY DEFINER RPCs in 0243 and nowhere else.
--
-- Only UPDATE is narrowed. INSERT keeps its table-level grant: the status
-- columns default to draft/0/null, and pre-setting them on a board you are
-- creating anyway deceives no one — there are no subscribers to a row that
-- does not exist yet.
revoke update on public.boards from authenticated, anon;
grant update (
  id, workspace_id, parent_board_id, name, view, cover, meta, created_by,
  created_at, updated_at, bg_color, deleted_at, thumb_key, thumb_updated_at,
  card_count, thumb_version, thumb_custom
) on public.boards to authenticated, anon;

-- ── Who is on this board? ────────────────────────────────────────────────────
-- _user_can_read_board (0207) answers the question for ONE user. Notifying a
-- crew needs the set. Same recursive parent-board walk, same two grant paths,
-- enumerated rather than tested.
--
-- workspaces.created_by is unioned in as well. can_write_board (0188) already
-- treats ownership as a grant path distinct from membership, and while every
-- workspace on the live database currently has its owner in workspace_members,
-- relying on that would make the crew list silently wrong the first time it
-- isn't true.
create or replace function public._board_readers(p_board_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select id, workspace_id, parent_board_id
    from boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id
    from boards b join chain c on b.id = c.parent_board_id
  )
  select distinct r.user_id
  from (
    select m.user_id
      from workspace_members m
     where m.workspace_id in (select workspace_id from chain)
    union
    select w.created_by
      from workspaces w
     where w.id in (select workspace_id from chain)
    union
    select s.user_id
      from board_shares s
     where s.board_id in (select id from chain)
  ) r
  where r.user_id is not null;
$$;

revoke all on function public._board_readers(uuid) from public, anon, authenticated;

comment on function public._board_readers(uuid) is
  'Every user who can read this board (workspace membership, workspace ownership, or a board share, walking up the parent chain). Internal: the recipient set for notification fanout. Never granted to clients — it enumerates who is on a board.';

comment on column public.boards.scheduled_date is
  'The calendar date this cluster sits on. Set only via set_board_schedule(); not client-writable.';
comment on column public.boards.sched_version is
  'Call-sheet version, bumped by publish_schedule_day(). Not client-writable.';
