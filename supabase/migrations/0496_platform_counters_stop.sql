-- 0496 — Nothing keeps platform_counters any more.
--
-- platform_counters held the Universe's running totals (users, workspaces,
-- clusters, cards, links, seconds in app, nodes in the last 24 hours), kept
-- by a trigger on every row that changed one, by the heartbeat, and by two
-- crons that recounted them (0074, 0254). Since 0460 admin_universe_stats
-- counts live rows and nothing reads the table: no function or view, no
-- client (it has RLS and no policy, so a signed-in read returns nothing), no
-- party, no edge function. Yet every card placed or deleted, every cluster
-- made, trashed or restored, every link, every new account and every
-- heartbeat still rewrote one of its seven rows: one hot row per key,
-- updated by every writer at once.
--
-- So:
--   * the two recount crons are unscheduled, and their functions dropped;
--   * the heartbeat stops adding to total_seconds_in_app. Otherwise it is
--     0470's body, which is the live one, unchanged: it credits only its
--     caller (0470), keeps 0460's seconds in user_active_day, and stays closed
--     to anon (0477). CREATE OR REPLACE keeps its ACL; the grants are restated
--     without anon and proved;
--   * the fourteen counter triggers are dropped, and with them the trigger
--     functions and _bump_counter. auth.users goes last, so its lock is held
--     for the shortest time;
--   * the table stays, marked frozen, so dropping it is a separate decision
--     that nothing depends on.

begin;

set local lock_timeout = '3s';

-- ── 1. The recounts ─────────────────────────────────────────────────────────

select cron.unschedule(jobid) from cron.job
 where jobname in ('universe_counters_minutely', 'universe_counters_nightly');

drop function if exists public._reconcile_universe_counters();
drop function if exists public._reconcile_universe_counters_full();

-- ── 2. The heartbeat, without the counter ───────────────────────────────────
-- 0470's body (the live one) with the platform_counters update and its 0254
-- comment taken out.

CREATE OR REPLACE FUNCTION public.bump_seconds_in_app(p_seconds integer, p_session_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_did_work boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now    timestamptz := now();
  v_sess   record;
  v_credit int;
  v_age    interval;
  v_uid    uuid;
  v_cc     text;
begin
  -- 0470: the caller's own account, whatever the client sent. The parameter
  -- stays so the client in production calls it unchanged.
  p_user_id := auth.uid();

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

  -- ADDED IN 0203: last-seen country
  v_uid := auth.uid();
  if v_uid is not null then
    v_cc := public.request_country();
    if v_cc is not null then
      update public.profiles set country = v_cc
       where user_id = v_uid and country is distinct from v_cc;
    end if;
  end if;

  if v_credit > 0 and p_user_id is not null then
    -- 0496: the platform total this guard kept in step is gone; the profile
    -- column and the day rows are the record.
    update public.profiles set seconds_in_app = seconds_in_app + v_credit where user_id = p_user_id;
    -- ADDED IN 0248: the day row carries whether it was work or presence.
    -- 0460: and the seconds it held, in the same statement, so time in app
    -- has a history and the heartbeat has no extra write.
    insert into public.user_active_day (user_id, day, did_work, work_ops, seconds)
      values (p_user_id, current_date, coalesce(p_did_work, false), case when p_did_work then 1 else 0 end, v_credit)
      on conflict (user_id, day) do update
        set did_work = public.user_active_day.did_work or excluded.did_work,
            work_ops = public.user_active_day.work_ops + excluded.work_ops,
            seconds  = public.user_active_day.seconds + excluded.seconds;
  end if;
  return v_credit;
end $function$;

revoke execute on function public.bump_seconds_in_app(integer, uuid, uuid, boolean) from public, anon;
grant execute on function public.bump_seconds_in_app(integer, uuid, uuid, boolean) to authenticated, service_role;

-- ── 3. The triggers on public tables, and what they called ──────────────────

drop trigger if exists boards_counter_ins on public.boards;
drop trigger if exists boards_counter_upd on public.boards;
drop trigger if exists boards_counter_del on public.boards;
drop trigger if exists workspaces_counter_ins on public.workspaces;
drop trigger if exists workspaces_counter_del on public.workspaces;
drop trigger if exists card_index_counter_ins on public.card_index;
drop trigger if exists card_index_counter_del on public.card_index;
drop trigger if exists entity_links_counter_ins on public.entity_links;
drop trigger if exists entity_links_counter_del on public.entity_links;
drop trigger if exists doc_backlinks_counter_ins on public.doc_backlinks;
drop trigger if exists doc_backlinks_counter_del on public.doc_backlinks;

drop function if exists public._counter_boards_ins();
drop function if exists public._counter_boards_upd();
drop function if exists public._counter_boards_del();
drop function if exists public._counter_workspaces_ins();
drop function if exists public._counter_workspaces_del();
drop function if exists public._counter_cards_ins();
drop function if exists public._counter_cards_del();
drop function if exists public._counter_links_ins();
drop function if exists public._counter_links_del();

-- ── 4. auth.users, last ─────────────────────────────────────────────────────

drop trigger if exists users_counter_ins on auth.users;
drop trigger if exists users_counter_del on auth.users;
drop trigger if exists users_counter_confirm on auth.users;

drop function if exists public._counter_users_ins();
drop function if exists public._counter_users_del();
drop function if exists public._counter_users_confirm();
drop function if exists public._bump_counter(text, bigint);

comment on table public.platform_counters is
  'Frozen by 0496: nothing writes or reads it. The Universe and every admin total count live rows (0460). Safe to drop.';

do $proof$
declare
  v_sig constant text := 'public.bump_seconds_in_app(integer,uuid,uuid,boolean)';
  v_def text;
  v_left text;
begin
  select string_agg(n.nspname || '.' || c.relname || ' ' || t.tgname, ', ') into v_left
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and (p.proname like '\_counter\_%' or p.prosrc ilike '%platform_counters%');
  if v_left is not null then
    raise exception '0496: counter triggers remain: %', v_left;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_left
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like '\_counter\_%' or p.proname = '_bump_counter'
          or p.proname like '\_reconcile\_universe\_counters%' or p.prosrc ilike '%platform_counters%');
  if v_left is not null then
    raise exception '0496: functions still keep the counters: %', v_left;
  end if;

  select string_agg(j.jobname, ', ') into v_left
    from cron.job j where j.command ilike '%universe_counters%' or j.jobname like 'universe\_counters%';
  if v_left is not null then
    raise exception '0496: counter crons remain: %', v_left;
  end if;

  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'bump_seconds_in_app') <> 1 then
    raise exception '0496: bump_seconds_in_app has an overload';
  end if;
  if has_function_privilege('anon', v_sig, 'execute') then
    raise exception '0496: a signed-out caller can run bump_seconds_in_app';
  end if;
  if not has_function_privilege('authenticated', v_sig, 'execute')
     or not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception '0496: bump_seconds_in_app lost its grant';
  end if;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if position('p_user_id := auth.uid();' in v_def) = 0
     or position('p_user_id := auth.uid();' in v_def) > position('insert into public.heartbeat_session' in v_def) then
    raise exception '0496: bump_seconds_in_app does not take its caller before crediting';
  end if;
  if v_def not like '%public.user_active_day.seconds + excluded.seconds;%'
     or v_def not like '%update public.profiles set seconds_in_app = seconds_in_app + v_credit where user_id = p_user_id;%' then
    raise exception '0496: bump_seconds_in_app lost a write it keeps';
  end if;
  if not (select p.prosecdef and p.proconfig = array['search_path=public']
            from pg_proc p where p.oid = v_sig::regprocedure) then
    raise exception '0496: bump_seconds_in_app lost an attribute';
  end if;
end $proof$;

commit;
