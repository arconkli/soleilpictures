-- 0247_board_day_details.sql — when the day starts, where it is, and what kind
-- of day it is.
--
-- Background. 0238 gave a cluster a DATE and 0243 gave it a publish/notify
-- lifecycle. Between them a dated day carries five fields: date, end, label,
-- status, version. Not one of them answers the question every person on a
-- production actually opens the schedule to ask — *when do I show up, and
-- where*. The industry is unanimous on this: the general call time is the single
-- most important line on a call sheet and it has to be readable without hunting
-- for it. We could not render it, because we did not store it.
--
-- The UI rework turns a day from a 24px tile into a full-width row. A row can
-- only be as rich as the data behind it; this migration is that data.
--
-- NOT ONLY FILM. The app is for creative production generally — game studios,
-- photo and commercial shoots, design studios, music. So the columns here are
-- deliberately generic (start / end / place / type) rather than the film
-- vocabulary (call / wrap / location / unit), and the *meaning* of a day type
-- is not baked into the database at all. See the palette note at the bottom.

-- ── Columns ──────────────────────────────────────────────────────────────────
alter table public.boards
  -- A slug into the parent cluster's day_types palette (below). Free
  -- text with no FK on purpose: the palette is per-production and user-defined,
  -- and a day whose type was renamed or deleted should degrade to neutral, not
  -- fail a write.
  add column if not exists day_type  text,
  -- Bare `time`, matching scheduled_date's local-wall-clock model (the header of
  -- lib/schedDates.js). A production runs on the clock on the wall where it is.
  add column if not exists day_start time,
  add column if not exists day_end   time,
  -- "Stage 4", "Ext. Dock — Malibu", "Studio B", "Remote". One line, as it
  -- appears on the row; structured addresses are a different feature.
  add column if not exists day_place text,
  -- The day-type palette, set on the PARENT cluster (a production), read by
  -- every dated child. [{id, name, color}, …]. See the note where it is granted.
  add column if not exists day_types jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'boards_day_type_len_chk'
      and conrelid = 'public.boards'::regclass
  ) then
    alter table public.boards
      add constraint boards_day_type_len_chk
      check (day_type is null or char_length(day_type) <= 64);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'boards_day_place_len_chk'
      and conrelid = 'public.boards'::regclass
  ) then
    alter table public.boards
      add constraint boards_day_place_len_chk
      check (day_place is null or char_length(day_place) <= 200);
  end if;
end $$;

-- Deliberately NO check that day_end >= day_start. A night shoot calls at 18:00
-- and wraps at 04:00, and that is not a data bug — it is Tuesday. The same
-- reasoning does not apply to scheduled_end, which is a date range and is
-- constrained in 0238.

-- ── Grant lockdown ───────────────────────────────────────────────────────────
-- Exactly the 0238 problem, and it recurs on every ADD COLUMN: `boards` carries
-- TABLE-level grants, so a new column is immediately writable by any
-- authenticated client through PostgREST. A crew member PATCHing day_start
-- directly would change the call time for everyone with no notification and no
-- history — the precise failure the publish/notify lifecycle exists to prevent.
--
-- Postgres cannot revoke one column out of a table-level grant, so the grant is
-- replaced with an explicit list. This is the same 17 columns 0238 named, plus
-- day_types; the schedule columns from 0238 and the four day fields above are
-- all absent. Writes to those go through the SECURITY DEFINER RPCs and nowhere
-- else.
--
-- day_types IS granted, deliberately. The 0238 lockdown exists for a specific
-- reason: sched_version / sched_status / scheduled_date decide whether a
-- notification fires and what it claims, so a client that could PATCH them
-- could route around publish_schedule_day() and make the version disagree with
-- what the crew was told. A palette of names and colours decides nothing. It is
-- also the field a production is most likely to fiddle with — renaming
-- "Production" to "Shoot" should be a plain PATCH, not an RPC round trip, and
-- anyone who can write the board can already rename the board itself.
revoke update on public.boards from authenticated, anon;
grant update (
  id, workspace_id, parent_board_id, name, view, cover, meta, created_by,
  created_at, updated_at, bg_color, deleted_at, thumb_key, thumb_updated_at,
  card_count, thumb_version, thumb_custom, day_types
) on public.boards to authenticated, anon;

-- ── Set a day's details ──────────────────────────────────────────────────────
-- A SEPARATE function rather than more default arguments on set_board_schedule.
-- Adding optional params there would create a second overload sharing a prefix,
-- and PostgREST resolves overloads by argument NAME — two candidates both
-- matching {board_id, date, day_label} is an ambiguity error at call time, not
-- at deploy time. Two functions, two jobs.
--
-- WHEN THIS NOTIFIES. Same rule as a date move, and for the same reason: these
-- are structural facts about the day, not content. Someone changing the call
-- time from 07:00 to 05:30 is the most consequential edit anyone makes to a
-- schedule, and it is a discrete deliberate act — it cannot storm the way
-- typing into a doc can. Content still waits for publish_schedule_day().
--
-- Every write is gated on sched_status='published', so building a schedule
-- stays silent no matter how much you rearrange.
create or replace function public.set_board_day_details(
  p_board_id  uuid,
  p_day_type  text default null,
  p_day_start time default null,
  p_day_end   time default null,
  p_day_place text default null,
  p_day_label text default null,
  -- Explicit clears. A NULL argument means "leave it alone" (so a caller can
  -- set just the place), which leaves no way to say "there is no call time any
  -- more" — hence a list of field names to null out.
  p_clear     text[] default null,
  p_notify    boolean default true
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_actor  uuid := auth.uid();
  b        record;
  v_parent record;
  v_clear  text[] := coalesce(p_clear, '{}'::text[]);
  v_type   text;
  v_start  time;
  v_end    time;
  v_place  text;
  v_label  text;
  v_parts  text[] := '{}';
  v_sent   int := 0;
begin
  if v_actor is null then return jsonb_build_object('ok', false, 'error', 'unauthenticated'); end if;
  if p_board_id is null then return jsonb_build_object('ok', false, 'error', 'missing_board'); end if;
  if not public.can_write_board(p_board_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select id, workspace_id, parent_board_id, name, day_label, scheduled_date,
         sched_status, sched_version, day_type, day_start, day_end, day_place
    into b
    from public.boards
   where id = p_board_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  v_type  := case when 'day_type'  = any(v_clear) then null else coalesce(p_day_type,  b.day_type)  end;
  v_start := case when 'day_start' = any(v_clear) then null else coalesce(p_day_start, b.day_start) end;
  v_end   := case when 'day_end'   = any(v_clear) then null else coalesce(p_day_end,   b.day_end)   end;
  v_place := case when 'day_place' = any(v_clear) then null
                  else nullif(trim(coalesce(p_day_place, b.day_place, '')), '') end;
  v_label := case when 'day_label' = any(v_clear) then null
                  else nullif(trim(coalesce(p_day_label, b.day_label, '')), '') end;

  update public.boards
     set day_type   = v_type,
         day_start  = v_start,
         day_end    = v_end,
         day_place  = v_place,
         day_label  = v_label,
         -- Or the /api/v1 change feed (GET /boards?since=, ordered by
         -- updated_at) never surfaces the edit to a synchroniser.
         updated_at = now()
   where id = p_board_id;

  -- Same auditing as set_board_schedule: these columns are RPC-only, so the RPC
  -- owns their history.
  if b.day_start is distinct from v_start then
    insert into public.board_meta_history (board_id, workspace_id, field, before_value, after_value, changed_by)
    values (p_board_id, b.workspace_id, 'day_start', to_jsonb(b.day_start), to_jsonb(v_start), v_actor);
    v_parts := v_parts || case
      when v_start is null then 'Start time removed'
      when b.day_start is null then 'Starts ' || to_char(v_start, 'HH24:MI')
      else 'Start ' || to_char(b.day_start, 'HH24:MI') || ' → ' || to_char(v_start, 'HH24:MI') end;
  end if;
  if b.day_end is distinct from v_end then
    insert into public.board_meta_history (board_id, workspace_id, field, before_value, after_value, changed_by)
    values (p_board_id, b.workspace_id, 'day_end', to_jsonb(b.day_end), to_jsonb(v_end), v_actor);
  end if;
  if b.day_place is distinct from v_place then
    insert into public.board_meta_history (board_id, workspace_id, field, before_value, after_value, changed_by)
    values (p_board_id, b.workspace_id, 'day_place', to_jsonb(b.day_place), to_jsonb(v_place), v_actor);
    v_parts := v_parts || case
      when v_place is null then 'Location removed'
      else 'Location: ' || v_place end;
  end if;
  if b.day_type is distinct from v_type then
    insert into public.board_meta_history (board_id, workspace_id, field, before_value, after_value, changed_by)
    values (p_board_id, b.workspace_id, 'day_type', to_jsonb(b.day_type), to_jsonb(v_type), v_actor);
  end if;
  if b.day_label is distinct from v_label then
    insert into public.board_meta_history (board_id, workspace_id, field, before_value, after_value, changed_by)
    values (p_board_id, b.workspace_id, 'day_label', to_jsonb(b.day_label), to_jsonb(v_label), v_actor);
  end if;

  -- Only start time and place are worth interrupting a crew for. A day-type or
  -- label tidy-up is housekeeping; v_parts stays empty and nobody is told.
  if p_notify and b.sched_status = 'published' and array_length(v_parts, 1) > 0 then
    select id, name into v_parent from public.boards where id = b.parent_board_id;
    v_sent := public._notify_users(
      array(select public._board_readers(p_board_id)),
      'schedule.day_updated',
      p_board_id, b.parent_board_id, b.workspace_id, v_actor,
      public._sched_day_title(v_label, b.name, b.scheduled_date),
      array_to_string(v_parts, ' · '),
      jsonb_build_object(
        'date', b.scheduled_date, 'day_label', v_label,
        'day_start', v_start, 'day_end', v_end, 'day_place', v_place,
        'day_type', v_type, 'version', b.sched_version,
        'production_name', v_parent.name)
    );
  end if;

  return jsonb_build_object('ok', true, 'notified', v_sent,
                            'changed', coalesce(array_length(v_parts, 1), 0) > 0,
                            'published', b.sched_status = 'published');
end;
$$;
revoke all on function public.set_board_day_details(uuid, text, time, time, text, text, text[], boolean) from public, anon;
grant execute on function public.set_board_day_details(uuid, text, time, time, text, text, text[], boolean) to authenticated;

-- ── Carry the new columns to the two reads that feed the calendar ────────────
-- Both gain columns, so both are drop-and-create. The App.jsx normalizer drops
-- anything these projections don't name — 0244 learned that the hard way, when
-- a crew member shared into a production saw an empty grid.

drop function if exists public.list_shared_boards();

create or replace function public.list_shared_boards()
returns table (
  board_id              uuid,
  board_name            text,
  role                  text,
  source_workspace_id   uuid,
  source_workspace_name text,
  parent_board_id       uuid,
  board_view            text,
  board_cover           text,
  created_at            timestamptz,
  scheduled_date        date,
  scheduled_end         date,
  day_label             text,
  sched_status          text,
  sched_version         int,
  sched_published_at    timestamptz,
  day_type              text,
  day_start             time,
  day_end               time,
  day_place             text,
  -- A shared crew member needs the parent's palette to resolve a day's colour,
  -- and the parent arrives in this same result set (0244 walks descendants), so
  -- projecting the column is all it takes — no second round trip.
  day_types             jsonb,
  updated_at            timestamptz,
  is_shared_root        boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive roots as (
    select b.id, s.role, s.created_at
    from board_shares s
    join boards b on b.id = s.board_id
    where s.user_id = auth.uid()
      and b.deleted_at is null
      and not is_workspace_member(b.workspace_id)
  ),
  tree as (
    select r.id, r.role, r.created_at as share_created_at, true as is_root, 0 as depth
    from roots r
    union all
    select c.id, t.role, t.share_created_at, false, t.depth + 1
    from boards c
    join tree t on c.parent_board_id = t.id
    where c.deleted_at is null and t.depth < 20
  ),
  dedup as (
    select distinct on (t.id) t.id, t.role, t.share_created_at, t.is_root
    from tree t
    order by t.id, (t.role = 'editor') desc, t.is_root desc, t.depth asc
  )
  select b.id, b.name, d.role,
         w.id, w.name, b.parent_board_id,
         coalesce(b.view, 'canvas')::text,
         coalesce(b.cover, 'neutral')::text,
         d.share_created_at,
         b.scheduled_date, b.scheduled_end, b.day_label,
         b.sched_status, b.sched_version, b.sched_published_at,
         b.day_type, b.day_start, b.day_end, b.day_place, b.day_types,
         b.updated_at, d.is_root
  from dedup d
  join boards b     on b.id = d.id
  join workspaces w on w.id = b.workspace_id
  order by w.name asc, b.name asc;
$$;

revoke all on function public.list_shared_boards() from public, anon;
grant execute on function public.list_shared_boards() to authenticated;

drop function if exists public.list_my_schedule(date, int);

create or replace function public.list_my_schedule(
  p_from date default current_date,
  p_days int  default 60
) returns table (
  board_id uuid, board_name text, day_label text,
  scheduled_date date, scheduled_end date,
  sched_status text, sched_version int, sched_published_at timestamptz,
  day_type text, day_start time, day_end time, day_place text,
  production_board_id uuid, production_name text, workspace_id uuid,
  unread_count int
)
language sql stable security definer set search_path = public, auth as $$
  select b.id, b.name, b.day_label,
         b.scheduled_date, b.scheduled_end,
         b.sched_status, b.sched_version, b.sched_published_at,
         b.day_type, b.day_start, b.day_end, b.day_place,
         b.parent_board_id, p.name, b.workspace_id,
         (select count(*)::int from public.notifications n
           where n.board_id = b.id and n.user_id = auth.uid() and n.read_at is null)
    from public.boards b
    left join public.boards p on p.id = b.parent_board_id
   where b.scheduled_date is not null
     and b.deleted_at is null
     and b.scheduled_date >= p_from
     and b.scheduled_date < p_from + greatest(1, least(coalesce(p_days, 60), 730))
     and public._user_can_read_board(auth.uid(), b.id)
   -- Ordering by start time before label is the whole point of having it: two
   -- units on the same date read in the order the day actually happens.
   order by b.scheduled_date, b.day_start nulls last, coalesce(b.day_label, b.name);
$$;
revoke all on function public.list_my_schedule(date, int) from public, anon;
grant execute on function public.list_my_schedule(date, int) to authenticated;

-- ── The day-type palette ─────────────────────────────────────────────────────
-- Intentionally NOT a table and NOT an enum:
--
--   boards.day_types = [{ "id": "shoot", "name": "Shoot", "color": "#4f8df8" }, …]
--
-- set on the parent cluster, read by every dated child through day_type.
--
-- An enum would hardcode one industry's vocabulary into the schema, and this
-- app is for creative production generally. The client ships generic defaults —
-- Prep / Production / Travel / Off / Wrap / Milestone — and a film production
-- renames Production→Shoot while a game studio renames Wrap→Ship and
-- Milestone→Playtest. Which words a team uses is not a schema concern.
--
-- NULL means "the client's defaults", so no backfill and no write on any
-- existing production: a row only appears here once someone edits the palette.
-- Days reference a type by slug and fall back to neutral if it is gone, so a
-- deleted palette entry degrades quietly instead of orphaning rows.
--
-- (The pre-existing `boards.meta` was the obvious home and is the wrong one: it
-- is a `text` column, not jsonb, and is unused across every row on the live
-- database. Storing JSON in it would have meant no server-side jsonb operators
-- and a parse/stringify dance on both shells.)

comment on column public.boards.day_start is
  'Local wall-clock start ("call time"). Set only via set_board_day_details(); not client-writable. Changing it notifies readers of a PUBLISHED day.';
comment on column public.boards.day_place is
  'One-line location for the day. Set only via set_board_day_details(); not client-writable.';
comment on column public.boards.day_type is
  'Slug into the parent cluster''s day_types palette. User-defined per production — no enum, no FK.';
comment on column public.boards.day_types is
  'Day-type palette for a production: [{id,name,color}]. Client-writable (it gates nothing); NULL means the app defaults.';
comment on function public.set_board_day_details(uuid, text, time, time, text, text, text[], boolean) is
  'The only path that writes boards.day_start/day_end/day_place/day_type. Notifies readers when the start time or location of a PUBLISHED day changes.';
