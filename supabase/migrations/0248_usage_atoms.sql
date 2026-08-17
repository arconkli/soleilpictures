-- 0248_usage_atoms.sql — make "active" mean used, and "session" mean session.
--
-- Every retention number this product reports — admin_retention_curve,
-- admin_retention_cohorts, admin_return_rate, admin_user_dormancy, and the
-- dormancy gate on every lifecycle email — is built on public.user_active_day.
-- That table has exactly one writer: bump_seconds_in_app, which fires whenever
-- the client heartbeat credits a second of PRESENCE.
--
-- Measured against 90 days of production data before writing this: 54% of the
-- rows in user_active_day contain no work event at all — no card placed, no
-- card edited, no doc edited, not even a board opened — while barely 1% of
-- genuine work-days are missing from the table. So the heartbeat is not
-- under-counting; it is over-counting by roughly half. "Came back" currently
-- means "loaded the page", which is the wrong atom for deciding how to make
-- people come back.
--
-- The same is true one level up: analytics_events.session_id is minted once
-- into localStorage and never rotates. Its measured span is p50 13 seconds —
-- right for a one-and-done visitor — but the longest runs to 81 days, and the
-- ones that stretch past a week belong precisely to the returning users worth
-- studying. Every count(distinct session_id) is really a browser count.
--
-- BOTH are fixed by ADDITION, never by redefinition:
--
--   • user_active_day keeps its meaning and gains did_work. Presence stays
--     readable, so 90 days of history keeps working; work is a stricter track
--     beside it. Retention RPCs get p_require_work in 0249 and can be read
--     either way.
--   • analytics_events.session_id is untouched — it remains the browser/device
--     id that stitches a visitor's pre-auth funnel to their account. The new
--     app_session_id column carries the real session (rotates on 30 min idle,
--     on sign-in/out, and at the UTC day boundary — see src/lib/appSession.js).
--
-- did_work cannot be backfilled. Rows before this migration stay false, which
-- is honest: we do not know. Work-gated retention starts from the deploy date.
--
-- Also here: public.usage_session, which gives time-on-task a dimension.
-- profiles.seconds_in_app is a single undimensioned integer, so "do people
-- spend their time on the canvas or in the schedule" has never been answerable.

-- ── 1. user_active_day gains a work track ──────────────────────────────

alter table public.user_active_day
  add column if not exists did_work  boolean not null default false,
  add column if not exists work_ops  integer not null default 0;

comment on column public.user_active_day.did_work is
  'True when the user did real work that day (a card/doc/comment write), as
   opposed to merely being present. Written by two independent paths: the
   client heartbeat (bump_seconds_in_app.p_did_work) and a server-truth
   trigger on card_index. Always false for rows predating migration 0248 —
   it cannot be backfilled.';

comment on column public.user_active_day.work_ops is
  'Rough magnitude of that day''s work — server-side card writes plus
   client-reported work slices. An indicator, not a precise operation count:
   one edit can rewrite a card_index row more than once.';

-- Work-gated retention scans this constantly once 0249 lands.
create index if not exists user_active_day_work_idx
  on public.user_active_day (day) where did_work;

-- ── 2. Presence writer learns about work ───────────────────────────────
-- Unchanged behaviour when p_did_work is omitted, so every existing caller
-- (including the keepalive beacon in heartbeat.js) keeps working untouched.
-- The 60s-per-60s heartbeat_session rate cap and the 0203 country stamp are
-- preserved exactly as they were.
--
-- Postgres identifies a function by (name, argument types), so adding a fourth
-- parameter CREATES A SECOND FUNCTION rather than replacing the first — and a
-- three-argument call binds to the exact three-argument match, not to the new
-- one's default. Leaving the old signature in place would mean every existing
-- caller silently kept the old body and did_work was never written. So the new
-- one is created, then the old signature is dropped, and three-arg callers fall
-- through to p_did_work's default. Its grants (anon, authenticated,
-- service_role — the heartbeat runs before sign-in) are restated below, since
-- a dropped function takes its ACL with it.

create or replace function public.bump_seconds_in_app(
  p_seconds    integer,
  p_session_id uuid    default null,
  p_user_id    uuid    default null,
  p_did_work   boolean default false
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_now    timestamptz := now();
  v_sess   record;
  v_credit int;
  v_age    interval;
  v_uid    uuid;
  v_cc     text;
begin
  if p_seconds is null or p_seconds <= 0 then return 0; end if;
  p_seconds := least(p_seconds, 60);

  if p_session_id is null then
    v_credit := least(p_seconds, 5);
  else
    insert into public.heartbeat_session (session_id, window_start, seconds_used, last_bumped_at)
      values (p_session_id, v_now, 0, v_now)
      on conflict (session_id) do nothing;
    select window_start, seconds_used into v_sess
      from public.heartbeat_session where session_id = p_session_id for update;
    v_age := v_now - v_sess.window_start;
    if v_age > interval '60 seconds' then
      v_credit := p_seconds;
      update public.heartbeat_session set window_start = v_now, seconds_used = v_credit, last_bumped_at = v_now where session_id = p_session_id;
    else
      v_credit := greatest(0, least(p_seconds, 60 - v_sess.seconds_used));
      if v_credit > 0 then
        update public.heartbeat_session set seconds_used = seconds_used + v_credit, last_bumped_at = v_now where session_id = p_session_id;
      end if;
    end if;
  end if;

  -- ── ADDED IN 0203: last-seen country ──────────────────────────────
  v_uid := auth.uid();
  if v_uid is not null then
    v_cc := public.request_country();
    if v_cc is not null then
      update public.profiles set country = v_cc
       where user_id = v_uid and country is distinct from v_cc;
    end if;
  end if;
  -- ──────────────────────────────────────────────────────────────────

  if v_credit > 0 then
    update public.platform_counters set value = value + v_credit, updated_at = v_now where key = 'total_seconds_in_app';
    if p_user_id is not null then
      update public.profiles set seconds_in_app = seconds_in_app + v_credit where user_id = p_user_id;
      -- ADDED IN 0248: the day row now carries whether it was work or presence.
      insert into public.user_active_day (user_id, day, did_work, work_ops)
        values (p_user_id, current_date, coalesce(p_did_work, false), case when p_did_work then 1 else 0 end)
        on conflict (user_id, day) do update
          set did_work = public.user_active_day.did_work or excluded.did_work,
              work_ops = public.user_active_day.work_ops + excluded.work_ops;
    end if;
  end if;
  return v_credit;
end $$;

drop function if exists public.bump_seconds_in_app(integer, uuid, uuid);

-- A freshly created function is executable by PUBLIC, and Supabase's default
-- privileges additionally grant anon/authenticated/service_role. The dropped
-- function had PUBLIC revoked, so restate the whole posture rather than
-- assuming the new one inherited it — it does not.
revoke all on function public.bump_seconds_in_app(integer, uuid, uuid, boolean) from public;
grant execute on function public.bump_seconds_in_app(integer, uuid, uuid, boolean)
  to anon, authenticated, service_role;

-- ── 3. Server truth as the second writer ───────────────────────────────
-- The client saying "that was work" is useful but not trustworthy on its own:
-- a dropped beacon, a crashed tab, or a blocked request loses the claim. A card
-- write is unambiguous evidence, and it is already trigger-instrumented — this
-- follows _stamp_first_populated_board's owner resolution exactly, including
-- its rule that seeded onboarding cards ('onb-%') are not the user's work.

create or replace function public._stamp_active_day_work()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
begin
  if new.card_id like 'onb-%' then return new; end if;

  select b.created_by into v_owner from public.boards b where b.id = new.board_id;
  v_owner := coalesce(v_owner, auth.uid(),
    (select w.created_by from public.workspaces w where w.id = new.workspace_id));
  if v_owner is null then return new; end if;

  insert into public.user_active_day (user_id, day, did_work, work_ops)
    values (v_owner, current_date, true, 1)
    on conflict (user_id, day) do update
      set did_work = true,
          work_ops = public.user_active_day.work_ops + 1;
  return new;
end $$;

drop trigger if exists card_index_active_day on public.card_index;
create trigger card_index_active_day
  after insert or update on public.card_index
  for each row execute function public._stamp_active_day_work();

-- ── 4. The real session, alongside the device id ───────────────────────
-- session_id keeps its exact current meaning. Nothing that reads it changes.

alter table public.analytics_events
  add column if not exists app_session_id uuid;

comment on column public.analytics_events.session_id is
  'Browser/DEVICE id — minted once into localStorage and never rotated, which
   is what makes it a durable stitch between a visitor''s pre-auth funnel and
   their account. It is NOT a session: measured p50 span 13s but max span 81
   days. Use app_session_id for anything session-shaped.';

comment on column public.analytics_events.app_session_id is
  'A real session: rotates after 30 min idle, on sign-in/sign-out, and at the
   UTC day boundary (src/lib/appSession.js). Null for rows predating 0248 and
   for any client too old to send it. props->>''session_seq'' numbers a
   browser''s sessions so "their 1st" and "their 12th" are distinguishable.';

create index if not exists analytics_events_app_session_idx
  on public.analytics_events (app_session_id, occurred_at)
  where app_session_id is not null;

-- ── 5. Time-on-task, with a dimension ──────────────────────────────────

create table if not exists public.usage_session (
  app_session_id  uuid        not null,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  surface         text        not null,
  board_id        uuid,
  started_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  active_seconds  integer     not null default 0,
  ops_n           integer     not null default 0
);

comment on table public.usage_session is
  'Active seconds per (session, surface, board). profiles.seconds_in_app is a
   single undimensioned counter, so "canvas vs schedule vs docs" and "which
   boards hold attention" were unanswerable. Written by record_usage_slice from
   the client heartbeat, which already computes visible-and-interacting time.
   Admin-read only (RLS on, no policies — same posture as user_active_day and
   metrics_daily).';

-- board_id is nullable (settings, messages and the browser have no board), and
-- NULL never equals NULL in a unique index, so the key is coalesced to a
-- sentinel. The upsert below matches on the same expression.
create unique index if not exists usage_session_key_idx
  on public.usage_session (
    app_session_id, surface,
    coalesce(board_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists usage_session_user_time_idx
  on public.usage_session (user_id, started_at desc);
create index if not exists usage_session_surface_idx
  on public.usage_session (surface, started_at desc);
create index if not exists usage_session_board_idx
  on public.usage_session (board_id, started_at desc) where board_id is not null;

alter table public.usage_session enable row level security;
-- Deliberately no policies: reachable only through SECURITY DEFINER RPCs.

create or replace function public.record_usage_slice(
  p_app_session_id uuid,
  p_surface        text,
  p_seconds        integer,
  p_board_id       uuid    default null,
  p_ops            integer default 0
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid     uuid := auth.uid();
  v_secs    int;
  v_ops     int;
  v_surface text;
begin
  -- Signed-in only. The heartbeat also runs on public pages before sign-in;
  -- that time belongs to the landing funnel (lp_dwell), not to usage.
  if v_uid is null or p_app_session_id is null then return 0; end if;

  -- Same ceiling as bump_seconds_in_app: one call can never claim more than a
  -- minute, so a hostile or buggy client cannot inflate the series.
  v_secs := least(greatest(coalesce(p_seconds, 0), 0), 60);
  v_ops  := least(greatest(coalesce(p_ops, 0), 0), 500);
  if v_secs = 0 and v_ops = 0 then return 0; end if;

  v_surface := lower(coalesce(nullif(btrim(p_surface), ''), 'unknown'));
  if v_surface !~ '^[a-z_]{1,24}$' then v_surface := 'unknown'; end if;

  loop
    update public.usage_session
       set active_seconds = least(active_seconds + v_secs, 86400),
           ops_n          = least(ops_n + v_ops, 100000),
           last_seen_at   = now()
     where app_session_id = p_app_session_id
       and surface        = v_surface
       and coalesce(board_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_board_id, '00000000-0000-0000-0000-000000000000'::uuid);
    if found then return v_secs; end if;

    begin
      insert into public.usage_session
        (app_session_id, user_id, surface, board_id, active_seconds, ops_n)
        values (p_app_session_id, v_uid, v_surface, p_board_id, v_secs, v_ops);
      return v_secs;
    exception when unique_violation then
      -- Another tab in the same session inserted first; loop and update it.
    end;
  end loop;
end $$;

-- anon is revoked EXPLICITLY: Supabase's default privileges grant it as a named
-- role, so `revoke ... from public` alone leaves it in place — the trap that
-- 0211/0217 were written to sweep up. Signed-out callers have no usage to record.
revoke all on function public.record_usage_slice(uuid, text, integer, uuid, integer) from public, anon;
grant execute on function public.record_usage_slice(uuid, text, integer, uuid, integer) to authenticated;

-- ── 6. Retention + GDPR must cover the new table ───────────────────────
-- 0107 established that analytics data has a TTL and that a user can demand
-- export and erasure. A new table that records what someone did and for how
-- long is squarely in scope for both; adding it without these is a bug.

create or replace function public.purge_old_usage_sessions(p_retention_days integer default 400)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cutoff  timestamptz := now() - make_interval(days => greatest(p_retention_days, 30));
  v_deleted integer := 0;
begin
  delete from public.usage_session where started_at < v_cutoff;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

-- Cron-only, like every other purge_* in 0107/0108.
revoke all on function public.purge_old_usage_sessions(integer) from public, anon, authenticated;

-- Rides alongside the existing nightly analytics purge (0107, 03:30).
select cron.schedule('purge_old_usage_sessions', '32 3 * * *', $$ select public.purge_old_usage_sessions(400); $$);

-- Erasure: clear the new session column too, and drop usage rows outright.
-- usage_session has no anonymised form worth keeping — without a user it is
-- just noise — so it is deleted rather than nulled.
create or replace function public.anonymize_user_analytics(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sessions uuid[];
  v_count    integer := 0;
begin
  select array_agg(distinct session_id)
    into v_sessions
    from public.analytics_events
   where user_id = p_user_id and session_id is not null;

  update public.analytics_events
     set user_id        = null,
         session_id     = null,
         app_session_id = null,   -- ADDED 0248
         props          = props - array['referrer','utm_source','utm_medium','utm_campaign','utm_content','utm_term']::text[]
   where user_id = p_user_id
      or (v_sessions is not null and session_id = any(v_sessions));
  get diagnostics v_count = row_count;

  delete from public.usage_session where user_id = p_user_id;   -- ADDED 0248
  return v_count;
end $$;

-- Portability: the export must show everything held about the person, and
-- "which surfaces you used, for how long, on which boards" is exactly the kind
-- of record a DSAR is for. user_active_day joins it — it is the day-level
-- summary the retention curves read.
create or replace function public.admin_export_user_data(p_user_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_sessions uuid[];
  v_result   jsonb;
begin
  perform public._require_admin();

  select array_agg(distinct session_id)
    into v_sessions
    from public.analytics_events
   where user_id = p_user_id and session_id is not null;

  select jsonb_build_object(
    'exported_at', now(),
    'user_id',     p_user_id,
    'auth', (
      select jsonb_build_object(
               'email',           u.email,
               'created_at',      u.created_at,
               'last_sign_in_at', u.last_sign_in_at)
        from auth.users u where u.id = p_user_id
    ),
    'profile',      (select to_jsonb(p) from public.profiles p      where p.user_id = p_user_id),
    'subscription', (select to_jsonb(s) from public.subscriptions s where s.user_id = p_user_id),
    'feedback',     (select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at), '[]'::jsonb)
                       from public.feedback f where f.user_id = p_user_id),
    'paid_grants',  (select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb)
                       from public.paid_grants g where g.user_id = p_user_id),
    'analytics_events', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at), '[]'::jsonb)
        from public.analytics_events e
       where e.user_id = p_user_id
          or (v_sessions is not null and e.session_id = any(v_sessions))
    ),
    'client_errors', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.occurred_at), '[]'::jsonb)
        from public.client_errors c
       where c.user_id = p_user_id
          or (v_sessions is not null and c.session_id = any(v_sessions))
    ),
    -- ADDED 0248
    'usage_sessions', (
      select coalesce(jsonb_agg(to_jsonb(us) order by us.started_at), '[]'::jsonb)
        from public.usage_session us where us.user_id = p_user_id
    ),
    'active_days', (
      select coalesce(jsonb_agg(to_jsonb(ad) order by ad.day), '[]'::jsonb)
        from public.user_active_day ad where ad.user_id = p_user_id
    )
  ) into v_result;

  return v_result;
end $$;
