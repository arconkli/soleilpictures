-- 0372 — the admin Overview reads complete weeks from durable tables, and the
-- owner can pin dated notes beside them.
--
-- WHY
--
-- One 7-day delta cannot say "consistently". The Today tiles compare the last
-- seven days with the seven before and nothing else, so one good week reads
-- the same as a rise that has held for two months. And the sparks beside the
-- tiles were not counting what the tiles count:
--
--   - admin_signups_by_day (the Signups spark) has no internal exclusion, so
--     the spark counted the internal accounts the tile leaves out;
--   - the Weekly-active spark was metrics_daily.active_users, a same-day
--     presence snapshot, not distinct people over a week;
--   - admin_kpi_summary compared 8 calendar days of WAU (today and the 7
--     before it, whatever p_days said) with 7 in the previous window, applied
--     the verified rule to signups but not to WAU, and counted cards by
--     card_index.updated_at while the cards spark counted created_at.
--
-- metrics_daily cannot be the series. It is a once-a-day snapshot (a missed
-- run is a missing day, and nothing backfills it), and what its counters mean
-- has changed four times (0102, 0149, 0327, 0332). Every weekly number here is
-- recomputed from durable tables (auth.users, user_active_day, card_index)
-- under one definition, for every week in the window at once.
--
-- WHAT
--
--   1. _admin_people(p_exclude_internal, p_verified_only): the ONE population
--      predicate for admin reads, 0149's verified rule (email confirmed and
--      signed in at least once) and 0110's internal rule (_internal_user_ids).
--      An internal helper: the definer functions that call it run as its
--      owner, so no client role needs EXECUTE, and none has it.
--   2. admin_weekly_series(p_weeks, p_exclude_internal, p_verified_only): one
--      zero-filled row per UTC calendar week (Monday, as date_trunc('week')),
--      oldest first and the current partial week last: signups, distinct
--      people present, distinct people who did real work, cards created. Each
--      row says whether its week is complete, and whether it is still settling
--      (the partial week, and the newest complete week for its first three
--      days). Presence and work each have a floor, the first day it was ever
--      recorded, derived with min(day) as 0278 derives the work floor. A week
--      that began before its floor returns NULL with *_measurable false: NULL
--      means "we were not counting", 0 means "nobody".
--   3. admin_notes, written through admin_note_add / admin_note_delete /
--      admin_note_restore: the owner's own dated notes (a ship, an event, a
--      note). Delete is soft: the house rule is that deleting shows an undo
--      toast, and an undo must bring back the same row, not a copy of it.
--   4. admin_markers(p_since): notes, discovery-pipeline alerts and ops alerts
--      as one dated list for the charts. A discovery alert re-fires daily while
--      its pipeline stays broken, so each run of consecutive days is ONE marker
--      at the run's first day, labelled "<name> (n days)". Ops alerts are one
--      per day and kind, minus the kinds that would mislead: the Monday
--      heartbeat and the test button (a marker every week), held-mail
--      reminders (daily while mail is held), and the signup spike (a function
--      of the signups line itself, so it explains nothing).
--   5. admin_kpi_summary, rewritten in place with the same signature: every
--      user count goes through _admin_people; WAU is exactly p_days days in
--      both windows, over the same people; a work_users key (distinct people
--      who did real work) sits beside it in both; cards_created counts
--      creation. Each changed line is marked -- 0372 and the rest is 0149's
--      body verbatim (weeklySeriesMigration.test.mjs checks it line by line).
--
-- DELIBERATELY NOT DONE
--
--   - No visits column. _admin_visits (0322/0363) is cohort-scoped and scans
--     analytics_events, whose crawler rows before 0294 cannot be identified.
--     Distinct people present (user_active_day) is the durable stand-in.
--   - No trials or MRR column. Subscription status is rewritten in place, so
--     a weekly history of it cannot be recomputed; metrics_daily stays the
--     money series, breaks and all.
--   - No DROP of anything. admin_kpi_summary keeps its exact signature, so
--     create or replace keeps its ACL; the grants are restated anyway.
--   - Definition-break DATES are not stored here. They are facts about this
--     repo's migrations, dated from git, and live in the client
--     (lib/adminDefinitionBreaks.js). The only breaks that are data are the
--     two floors, returned on every row and derived rather than hardcoded so
--     they stay true if either column is ever backfilled.
--   - History can shrink. A deleted account leaves auth.users, taking its
--     user_active_day rows with it, and a deleted card leaves card_index, so
--     a past week can read lower later than it did at the time. These reads
--     count what still exists, and their comments say so.
--   - admin_cards_per_day is untouched: it has counted card_index.created_at
--     since 0254.

begin;

-- ── 1. One population ───────────────────────────────────────────────────────

create or replace function public._admin_people(p_exclude_internal boolean, p_verified_only boolean)
returns table(user_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.created_at
    from auth.users u
   where (not p_verified_only
          or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
     and (not p_exclude_internal
          or u.id not in (select iu.user_id from public._internal_user_ids() iu));
$$;

revoke all on function public._admin_people(boolean, boolean) from public, anon, authenticated;
grant execute on function public._admin_people(boolean, boolean) to service_role;

comment on function public._admin_people(boolean, boolean) is
  'Internal. The one population predicate for admin reads: 0149''s verified rule '
  '(email_confirmed_at and last_sign_in_at both set) unless p_verified_only is false, '
  'and 0110''s internal rule (_internal_user_ids) unless p_exclude_internal is false. '
  'Called by definer functions only; no client role can execute it.';

-- ── 2. The weekly series ────────────────────────────────────────────────────

create or replace function public.admin_weekly_series(
  p_weeks int default 14,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
returns table (
  week_start        date,
  complete          boolean,
  settling          boolean,
  signups           int,
  active_users      int,
  active_measurable boolean,
  work_users        int,
  work_measurable   boolean,
  cards             int,
  active_floor      date,
  work_floor        date
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_weeks        int;
  v_this         date;
  v_first        date;
  v_active_floor date;
  v_work_floor   date;
begin
  perform public._require_admin();

  v_weeks        := least(greatest(coalesce(p_weeks, 14), 2), 52);
  v_this         := date_trunc('week', current_date)::date;
  v_first        := v_this - (v_weeks - 1) * 7;
  -- The first day each was ever recorded. Derived, as 0278 derives the work
  -- floor, so both stay true if either column is ever backfilled.
  v_active_floor := (select min(a.day) from public.user_active_day a);
  v_work_floor   := (select min(a.day) from public.user_active_day a where a.did_work);

  return query
  with
  people as (select * from public._admin_people(p_exclude_internal, p_verified_only)),
  weeks as (
    select g::date as wk
      from generate_series(v_first, v_this, interval '7 days') g
  ),
  su as (
    select date_trunc('week', (p.created_at at time zone 'utc'))::date as wk,
           count(*)::int as n
      from people p
     where p.created_at >= v_first
     group by 1
  ),
  act as (
    select date_trunc('week', a.day)::date as wk,
           count(distinct a.user_id)::int as active_n,
           (count(distinct a.user_id) filter (where a.did_work))::int as work_n
      from public.user_active_day a
      join people p on p.user_id = a.user_id
     where a.day >= v_first
     group by 1
  ),
  -- Cards by creation, owner-excluded exactly as admin_cards_per_day (0254).
  -- card-count-lint: activity — a card made in a cluster deleted since was
  -- still made that week, and admin_cards_per_day counts it too.
  ca as (
    select date_trunc('week', (ci.created_at at time zone 'utc'))::date as wk,
           count(*)::int as n
      from public.card_index ci
      left join public.boards b on b.id = ci.board_id
     where ci.created_at >= v_first
       and (not p_exclude_internal
            or b.created_by is null
            or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))
     group by 1
  )
  select w.wk,
         (w.wk + 7) <= current_date,
         (w.wk + 7 + 3) > current_date,
         coalesce(su.n, 0),
         case when v_active_floor is null or w.wk < v_active_floor then null
              else coalesce(act.active_n, 0) end,
         not (v_active_floor is null or w.wk < v_active_floor),
         case when v_work_floor is null or w.wk < v_work_floor then null
              else coalesce(act.work_n, 0) end,
         not (v_work_floor is null or w.wk < v_work_floor),
         coalesce(ca.n, 0),
         v_active_floor,
         v_work_floor
    from weeks w
    left join su  on su.wk  = w.wk
    left join act on act.wk = w.wk
    left join ca  on ca.wk  = w.wk
   order by w.wk;
end;
$$;

revoke all on function public.admin_weekly_series(int, boolean, boolean) from public, anon;
grant execute on function public.admin_weekly_series(int, boolean, boolean) to authenticated, service_role;

comment on function public.admin_weekly_series(int, boolean, boolean) is
  'Admin. One zero-filled row per UTC calendar week (Monday), oldest first, the current '
  'partial week last (complete false; settling true for it and for the newest complete '
  'week''s first three days). Durable tables only, never metrics_daily: signups from '
  'auth.users, distinct present and did-work people from user_active_day, cards from '
  'card_index.created_at, one population through _admin_people. active_users and '
  'work_users are NULL with *_measurable false for weeks that began before active_floor '
  'or work_floor: NULL means "we were not counting", 0 means "nobody". History can '
  'shrink: deleted accounts and cards leave auth.users and card_index.';

-- ── 3. The owner's dated notes ──────────────────────────────────────────────

create table if not exists public.admin_notes (
  id         bigint generated always as identity primary key,
  day        date not null,
  label      text not null check (length(label) between 1 and 120),
  kind       text not null default 'note' check (kind in ('ship', 'event', 'note')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists admin_notes_live_day_idx on public.admin_notes (day) where deleted_at is null;
alter table public.admin_notes enable row level security;
revoke all on table public.admin_notes from public, anon, authenticated;

comment on table public.admin_notes is
  'The owner''s own dated notes for the admin charts (kind ship, event or note). '
  'deleted_at is a soft delete, so the dashboard''s undo restores the same row. RLS on, '
  'no policies, no client grants: reached only through admin_note_add, admin_note_delete, '
  'admin_note_restore and admin_markers.';

create or replace function public.admin_note_add(
  p_day date,
  p_label text,
  p_kind text default 'note'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_label text;
  v_row   public.admin_notes;
begin
  perform public._require_admin();

  if p_day is null or p_day < date '2026-01-01' or p_day > current_date + 1 then
    raise exception 'A note''s day must be between 2026-01-01 and tomorrow, not %', coalesce(p_day::text, 'empty')
      using errcode = '22023';
  end if;
  v_label := btrim(coalesce(p_label, ''));
  if length(v_label) not between 1 and 120 then
    raise exception 'A note''s label must be 1 to 120 characters once trimmed'
      using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('ship', 'event', 'note') then
    raise exception 'A note''s kind must be ship, event or note, not %', coalesce(p_kind, 'empty')
      using errcode = '22023';
  end if;

  insert into public.admin_notes (day, label, kind, created_by)
  values (p_day, v_label, p_kind, auth.uid())
  returning * into v_row;

  return to_jsonb(v_row) - 'deleted_at';
end;
$$;

create or replace function public.admin_note_delete(p_id bigint)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public._require_admin();

  update public.admin_notes n
     set deleted_at = now()
   where n.id = p_id
     and n.deleted_at is null;

  return found;
end;
$$;

create or replace function public.admin_note_restore(p_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.admin_notes;
begin
  perform public._require_admin();

  update public.admin_notes n
     set deleted_at = null
   where n.id = p_id
     and n.deleted_at is not null
  returning * into v_row;

  if not found then
    raise exception 'Note % is not deleted, or does not exist: nothing to restore', p_id
      using errcode = '22023';
  end if;

  return to_jsonb(v_row) - 'deleted_at';
end;
$$;

revoke all on function public.admin_note_add(date, text, text) from public, anon;
grant execute on function public.admin_note_add(date, text, text) to authenticated, service_role;
revoke all on function public.admin_note_delete(bigint) from public, anon;
grant execute on function public.admin_note_delete(bigint) to authenticated, service_role;
revoke all on function public.admin_note_restore(bigint) from public, anon;
grant execute on function public.admin_note_restore(bigint) to authenticated, service_role;

comment on function public.admin_note_add(date, text, text) is
  'Admin. Adds a dated note (day 2026-01-01 through tomorrow; label 1-120 characters once '
  'trimmed; kind ship, event or note; 22023 otherwise) and returns it without deleted_at.';
comment on function public.admin_note_delete(bigint) is
  'Admin. Soft-deletes a note. True when a live note was deleted, false when there was none.';
comment on function public.admin_note_restore(bigint) is
  'Admin. Undoes admin_note_delete and returns the same row without deleted_at; 22023 when '
  'there is nothing to restore.';

-- ── 4. Markers ──────────────────────────────────────────────────────────────

create or replace function public.admin_markers(p_since date default null)
returns table (
  day    date,
  kind   text,
  label  text,
  source text,
  ref_id bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_since date;
begin
  perform public._require_admin();

  v_since := coalesce(p_since, current_date - 120);

  return query
  with
  notes as (
    select n.day, n.kind, n.label, 'note'::text as source, n.id as ref_id
      from public.admin_notes n
     where n.deleted_at is null
       and n.day >= v_since
  ),
  -- A discovery alert re-fires daily while its pipeline stays broken (0335,
  -- deduped over 20 hours). One marker per name per run of consecutive UTC
  -- days, at the run's first day: a day minus its rank within its name is
  -- constant across a run (gaps and islands). Clients cannot write this kind
  -- (0364); the coalesce only keeps a label from ever being null.
  disc_days as (
    select distinct coalesce(ce.name, 'discovery_pipeline') as name,
           (ce.occurred_at at time zone 'utc')::date as day
      from public.client_errors ce
     where ce.kind = 'discovery_pipeline'
       and ce.occurred_at >= v_since
  ),
  disc_runs as (
    select d.name, d.day,
           d.day - (row_number() over (partition by d.name order by d.day))::int as grp
      from disc_days d
  ),
  disc as (
    select min(r.day) as day,
           'alert'::text as kind,
           case when count(*) = 1 then r.name
                else r.name || ' (' || count(*) || ' days)' end as label,
           'discovery'::text as source,
           null::bigint as ref_id
      from disc_runs r
     group by r.name, r.grp
  ),
  -- Not markers: the Monday heartbeat and the test button would put one on
  -- every week, held-mail reminders repeat daily while mail is held, and the
  -- signup spike is the signups line itself.
  ops as (
    select (oa.created_at at time zone 'utc')::date as day,
           'alert'::text as kind,
           min(oa.title) as label,
           'ops'::text as source,
           null::bigint as ref_id
      from public.ops_alerts oa
     where oa.created_at >= v_since
       and oa.kind not in ('heartbeat', 'test', 'held_reminder', 'signups')
     group by (oa.created_at at time zone 'utc')::date, oa.kind
  )
  select m.day, m.kind, m.label, m.source, m.ref_id
    from (select * from notes
          union all select * from disc
          union all select * from ops) m
   order by m.day, m.source, m.label;
end;
$$;

revoke all on function public.admin_markers(date) from public, anon;
grant execute on function public.admin_markers(date) to authenticated, service_role;

comment on function public.admin_markers(date) is
  'Admin. Dated markers since p_since (default 120 days ago), oldest first: live notes '
  '(source note, ref_id = admin_notes.id), discovery-pipeline alerts collapsed to one per '
  'name per run of consecutive UTC days at its first day (source discovery), and ops '
  'alerts one per UTC day and kind without heartbeat, test, held_reminder and signups '
  '(source ops). Alerts carry kind alert and no ref_id.';

-- ── 5. admin_kpi_summary, fixed in place ────────────────────────────────────
-- 0149's body; every changed line ends -- 0372. Same signature, so the ACL
-- survives create or replace; the grants are restated below regardless.

create or replace function public.admin_kpi_summary(
  p_days integer DEFAULT 30,
  p_exclude_internal boolean DEFAULT true,
  p_verified_only boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_out     jsonb;
  v_now     timestamptz := now();
  v_cur_lo  timestamptz;
  v_prev_lo timestamptz;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  v_cur_lo  := v_now - (p_days || ' days')::interval;
  v_prev_lo := v_now - ((2 * p_days) || ' days')::interval;

  with
  -- 0372: one population for every user count below (0149's verified rule, 0110's internal rule).
  people as (select * from public._admin_people(p_exclude_internal, p_verified_only)),  -- 0372
  signers as (
    select u.user_id as id, u.created_at, p.tier, p.first_card_at, p.first_paid_at      -- 0372
      from people u                                                                     -- 0372
      join public.profiles p on p.user_id = u.user_id                                   -- 0372
     where u.created_at >= v_prev_lo                                                    -- 0372
  ),
  ev as (
    select session_id, event, occurred_at
      from public.analytics_events
     where occurred_at >= v_prev_lo
       and event in ('checkout_open', 'checkout_success')
       and (not p_exclude_internal
            or session_id is null
            or session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  cards as (
    select ci.created_at                                                                -- 0372
      from public.card_index ci
      left join public.boards b on b.id = ci.board_id
     where ci.created_at >= v_prev_lo                                                   -- 0372
       and (not p_exclude_internal
            or b.created_by is null
            or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  wau as (
    select a.day, a.user_id, a.did_work                                                 -- 0372
      from public.user_active_day a                                                     -- 0372
      join people u on u.user_id = a.user_id                                            -- 0372
  )
  select jsonb_build_object(
    'current', jsonb_build_object(
      'signups',          (select count(*) from signers where created_at >= v_cur_lo),
      'activated',        (select count(*) from signers where created_at >= v_cur_lo and first_card_at is not null),
      'activation_rate',  (select round(count(*) filter (where first_card_at is not null)::numeric
                                        / nullif(count(*), 0), 4)
                             from signers where created_at >= v_cur_lo),
      'demo_base',        (select count(*) from signers where created_at >= v_cur_lo and tier in ('demo','paid')),
      'converted',        (select count(*) from signers where created_at >= v_cur_lo and first_paid_at is not null),
      'demo_to_paid_rate',(select round(count(*) filter (where first_paid_at is not null)::numeric
                                        / nullif(count(*) filter (where tier in ('demo','paid')), 0), 4)
                             from signers where created_at >= v_cur_lo),
      'checkout_open',    (select count(distinct session_id) from ev where event='checkout_open'    and occurred_at >= v_cur_lo),
      'checkout_success', (select count(distinct session_id) from ev where event='checkout_success' and occurred_at >= v_cur_lo),
      'checkout_success_rate', (
        select round(
          (select count(distinct session_id) from ev where event='checkout_success' and occurred_at >= v_cur_lo)::numeric
          / nullif((select count(distinct session_id) from ev where event='checkout_open' and occurred_at >= v_cur_lo), 0), 4)),
      'wau',              (select count(distinct user_id) from wau
                             where day > v_cur_lo::date and day <= v_now::date),        -- 0372
      'work_users',       (select count(distinct user_id) from wau                      -- 0372
                             where did_work and day > v_cur_lo::date and day <= v_now::date),  -- 0372
      'cards_created',    (select count(*) from cards where created_at >= v_cur_lo)     -- 0372
    ),
    'previous', jsonb_build_object(
      'signups',          (select count(*) from signers where created_at >= v_prev_lo and created_at < v_cur_lo),
      'activated',        (select count(*) from signers where created_at >= v_prev_lo and created_at < v_cur_lo and first_card_at is not null),
      'activation_rate',  (select round(count(*) filter (where first_card_at is not null)::numeric
                                        / nullif(count(*), 0), 4)
                             from signers where created_at >= v_prev_lo and created_at < v_cur_lo),
      'demo_base',        (select count(*) from signers where created_at >= v_prev_lo and created_at < v_cur_lo and tier in ('demo','paid')),
      'converted',        (select count(*) from signers where created_at >= v_prev_lo and created_at < v_cur_lo and first_paid_at is not null),
      'demo_to_paid_rate',(select round(count(*) filter (where first_paid_at is not null)::numeric
                                        / nullif(count(*) filter (where tier in ('demo','paid')), 0), 4)
                             from signers where created_at >= v_prev_lo and created_at < v_cur_lo),
      'checkout_open',    (select count(distinct session_id) from ev where event='checkout_open'    and occurred_at >= v_prev_lo and occurred_at < v_cur_lo),
      'checkout_success', (select count(distinct session_id) from ev where event='checkout_success' and occurred_at >= v_prev_lo and occurred_at < v_cur_lo),
      'checkout_success_rate', (
        select round(
          (select count(distinct session_id) from ev where event='checkout_success' and occurred_at >= v_prev_lo and occurred_at < v_cur_lo)::numeric
          / nullif((select count(distinct session_id) from ev where event='checkout_open' and occurred_at >= v_prev_lo and occurred_at < v_cur_lo), 0), 4)),
      'wau',              (select count(distinct user_id) from wau
                             where day > v_prev_lo::date and day <= v_cur_lo::date),    -- 0372
      'work_users',       (select count(distinct user_id) from wau                      -- 0372
                             where did_work and day > v_prev_lo::date and day <= v_cur_lo::date),  -- 0372
      'cards_created',    (select count(*) from cards where created_at >= v_prev_lo and created_at < v_cur_lo)  -- 0372
    )
  ) into v_out;

  return v_out;
end;
$function$;

revoke all on function public.admin_kpi_summary(integer, boolean, boolean) from public, anon;
grant execute on function public.admin_kpi_summary(integer, boolean, boolean) to authenticated, service_role;

comment on function public.admin_kpi_summary(integer, boolean, boolean) is
  'Admin. The trailing-window headline: each key over the last p_days (current) and the '
  'p_days before (previous). Every user count is the _admin_people population. wau and '
  'work_users are distinct people present, and doing real work, on exactly p_days calendar '
  'days in each window, today included in current. cards_created counts '
  'card_index.created_at. Rewritten in place by 0372.';

-- ── 6. Proofs (the 0311 habit: a REVOKE reporting success proves nothing) ───

do $proof$
declare
  v_fn   text;
  v_priv text;
  v_src  text;
begin
  -- The helper: definer callers only.
  if has_function_privilege('anon', 'public._admin_people(boolean, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public._admin_people(boolean, boolean)', 'execute')
     or not has_function_privilege('service_role', 'public._admin_people(boolean, boolean)', 'execute') then
    raise exception '0372: _admin_people grants are wrong';
  end if;

  -- The admin RPCs: any signed-in caller reaches them; _require_admin() decides.
  foreach v_fn in array array[
    'public.admin_weekly_series(integer, boolean, boolean)',
    'public.admin_note_add(date, text, text)',
    'public.admin_note_delete(bigint)',
    'public.admin_note_restore(bigint)',
    'public.admin_markers(date)',
    'public.admin_kpi_summary(integer, boolean, boolean)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute')
       or not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0372: % grants are wrong', v_fn;
    end if;
    select p.prosrc into v_src from pg_proc p where p.oid = v_fn::regprocedure;
    if v_src is null or position('_require_admin()' in v_src) = 0 then
      raise exception '0372: % is not admin-gated', v_fn;
    end if;
  end loop;

  -- The notes table: nothing but the RPCs above reach it.
  foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
    if has_table_privilege('anon', 'public.admin_notes', v_priv)
       or has_table_privilege('authenticated', 'public.admin_notes', v_priv) then
      raise exception '0372: a client role has % on admin_notes', v_priv;
    end if;
  end loop;
  if (select c.relrowsecurity from pg_class c where c.oid = 'public.admin_notes'::regclass) is not true then
    raise exception '0372: admin_notes has row-level security off';
  end if;
end $proof$;

commit;
