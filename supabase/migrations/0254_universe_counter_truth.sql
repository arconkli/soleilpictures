-- 0254 — the universe counters were frozen for up to 24 hours, and several
-- labels on both universe views did not mean what they said.
--
-- ── 1. The counters never moved ────────────────────────────────────────
--
-- public.platform_counters has RLS ENABLED with ZERO policies. The bump
-- triggers (_counter_cards_ins/del, _counter_boards_ins/upd/del,
-- _counter_workspaces_ins/del, _counter_links_ins/del) and their helper
-- _bump_counter were NOT security definer, so they ran as `authenticated`
-- and every UPDATE matched zero rows — silently, no error, forever.
--
--   begin; set local role authenticated;
--   with t as (update public.platform_counters set value = value
--              where key = 'total_cards' returning key)
--   select (select count(*) from t);   -- → 0
--   rollback;
--
-- Only the security-definer writers ever landed: _counter_users_* (which is
-- why total_users alone was correct), and _reconcile_universe_counters_full()
-- at 03:20 UTC. So the "live" ticker — pulsing dot, 1 Hz SSE — was showing
-- numbers up to a day stale, and the giveaway was in the table itself: every
-- one of workspaces/boards/cards/links carried an updated_at of 03:20 while
-- the rows they count had moved on. The gap is invisible on a quiet day and
-- as large as a full day's activity on a busy one.
--
-- The fix is the pattern _counter_users_ins already uses: make the trigger
-- functions security definer so they run as the table owner. They keep their
-- pinned search_path.
--
-- REQUIRED COMPANION: _bump_counter is EXECUTE-able by PUBLIC/anon/
-- authenticated today. That is harmless only because RLS eats its UPDATE —
-- the moment the triggers turn definer, any anonymous caller could set any
-- counter to any value. The revoke below is part of the fix, not hardening.
-- The triggers still reach it because a security-definer function executes
-- as postgres, which retains EXECUTE.
--
-- ── 2. card_index had no created_at ────────────────────────────────────
--
-- The table carried only updated_at, and five separate places read it as if
-- it were a creation time:
--
--   • admin_universe_stats().today.cards  → the "+N today" delta under Cards
--   • nodes_created_24h                   → the "New · 24h" cell
--   • admin_cards_per_day / admin_card_stats windows
--   • the node drawer's "Created" row
--   • admin_universe_snapshot_v2's PAGINATION KEYSET — a mutable sort key, so
--     a card edited mid-crawl jumps the cursor and is skipped, and the delta
--     poller re-emits every edited card as a brand-new node (which the client
--     dedupes) carrying a brand-new structural edge (which it did not).
--
-- created_at is backfilled from updated_at because nothing better exists —
-- card_placed analytics events carry no card_id. So per-day creation history
-- BEFORE this migration is really last-edit history; the dashboard says so.
-- From here forward it is real, and the keyset is immutable.
--
-- ── 3. Two different "Time in app" numbers, one sub-tab apart ──────────
--
-- The ticker read platform_counters.total_seconds_in_app; the Command Center
-- read sum(profiles.seconds_in_app). They disagreed by more than a third.
-- bump_seconds_in_app credited the counter on EVERY heartbeat but the profile
-- only when p_user_id is not null, so signed-out time accumulated in the
-- counter alone — and the full reconcile never touched that key, so the gap
-- could only ever widen. Both surfaces now mean summed profile time:
-- attributable, reconcilable, and what the "summed across everyone" caption
-- printed under it already claimed.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Unfreeze the counters
-- ─────────────────────────────────────────────────────────────────────────

alter function public._counter_boards_ins()     security definer;
alter function public._counter_boards_upd()     security definer;
alter function public._counter_boards_del()     security definer;
alter function public._counter_cards_ins()      security definer;
alter function public._counter_cards_del()      security definer;
alter function public._counter_workspaces_ins() security definer;
alter function public._counter_workspaces_del() security definer;
alter function public._counter_links_ins()      security definer;
alter function public._counter_links_del()      security definer;

-- Now that the bumps actually land, seal the helper. Only the definer
-- triggers (running as postgres) may reach it.
revoke execute on function public._bump_counter(text, bigint) from public;
revoke execute on function public._bump_counter(text, bigint) from anon;
revoke execute on function public._bump_counter(text, bigint) from authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. card_index.created_at
-- ─────────────────────────────────────────────────────────────────────────

alter table public.card_index add column if not exists created_at timestamptz;

-- Backfill with user triggers OFF. card_index_active_day fires on ANY update
-- and would stamp today's user_active_day row for every card owner in the
-- corpus; card_index_webhook_upd is a statement trigger with a transition
-- table and would emit the whole table as one webhook payload.
alter table public.card_index disable trigger user;
update public.card_index set created_at = updated_at where created_at is null;
alter table public.card_index enable trigger user;

alter table public.card_index
  alter column created_at set default now(),
  alter column created_at set not null;

-- The universe pages on (created_at, node_id); node_id is
-- 'card:<board_id>:<card_id>', so this index matches the sort exactly.
create index if not exists card_index_created_at_idx
  on public.card_index (created_at, board_id, card_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Point the universe snapshot + edges at the immutable column
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.admin_universe_snapshot_v2(
  p_cursor_ts timestamptz default null,
  p_cursor_id text default null,
  p_limit integer default 50000)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_rows  jsonb;
  v_count int;
begin
  perform public._require_admin();
  p_limit := greatest(1, least(p_limit, 100000));
  p_cursor_id := coalesce(p_cursor_id, '');

  with src as (
    select ('user:' || u.id::text) as node_id,
           'user'::text            as kind,
           null::uuid              as workspace_id,
           u.created_at            as created_at
      from auth.users u
     where exists (select 1 from public.workspace_members wm where wm.user_id = u.id)
       and (p_cursor_ts is null or u.created_at >= p_cursor_ts)
    union all
    select ('ws:' || w.id::text), 'ws', w.id, w.created_at
      from public.workspaces w
     where (p_cursor_ts is null or w.created_at >= p_cursor_ts)
    union all
    select ('board:' || b.id::text), 'board', b.workspace_id, b.created_at
      from public.boards b
     where b.deleted_at is null
       and (p_cursor_ts is null or b.created_at >= p_cursor_ts)
    union all
    -- 0254: created_at, not updated_at. An edited card no longer re-enters the
    -- delta stream, and the keyset below can no longer be moved under the crawl.
    select ('card:' || ci.board_id::text || ':' || ci.card_id), ci.kind, ci.workspace_id, ci.created_at
      from public.card_index ci
     where (p_cursor_ts is null or ci.created_at >= p_cursor_ts)
  ), page as (
    select s.node_id, s.kind, s.workspace_id, s.created_at
      from src s
     where p_cursor_ts is null
        or (s.created_at, s.node_id) > (p_cursor_ts, p_cursor_id)
     order by s.created_at asc, s.node_id asc
     limit p_limit
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at, p.node_id), '[]'::jsonb),
         count(*)
    into v_rows, v_count
    from page p;

  return jsonb_build_object(
    'nodes',   v_rows,
    'next_ts', case when v_count > 0 then v_rows->-1->>'created_at' end,
    'next_id', case when v_count > 0 then v_rows->-1->>'node_id'    end,
    'done',    v_count < p_limit
  );
end $function$;

create or replace function public.admin_universe_edges_v2(
  p_cursor_ts timestamptz default null,
  p_cursor_key text default null,
  p_limit integer default 100000)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_rows     jsonb;
  v_count    int;
  v_last_ts  timestamptz;
  v_last_key text;
begin
  perform public._require_admin();
  p_limit := greatest(1, least(p_limit, 200000));
  p_cursor_key := coalesce(p_cursor_key, '');

  with hier as (
    select ('board:' || b.parent_board_id::text) as e_src,
           ('board:' || b.id::text)              as e_tgt,
           'hierarchy'::text                     as e_kind,
           b.created_at                          as e_ts
      from public.boards b
     where b.parent_board_id is not null
       and b.deleted_at is null
       and (p_cursor_ts is null or b.created_at >= p_cursor_ts)
  ), structural as (
    -- 0254: created_at so the board→card edge shares its card node's timestamp
    -- and the two paginate together instead of the edge re-firing on every edit.
    select ('board:' || ci.board_id::text),
           ('card:'  || ci.board_id::text || ':' || ci.card_id),
           'structural'::text,
           ci.created_at
      from public.card_index ci
     where (p_cursor_ts is null or ci.created_at >= p_cursor_ts)
  ), el as (
    select
      case el.source_kind
        when 'card'       then ('card:' || coalesce(el.source_board_id::text, '') || ':' || el.source_id)
        when 'card_title' then ('card:' || coalesce(el.source_board_id::text, '') || ':' || el.source_id)
        else null
      end as e_src,
      case el.target_kind
        when 'board' then ('board:' || coalesce(el.target_board_id::text, el.target_id::text))
        when 'card'  then ('card:'  || coalesce(el.target_board_id::text, '') || ':' || el.target_card_id)
        when 'doc'   then ('card:'  ||                          el.target_doc_card_id::text)
        else null
      end as e_tgt,
      el.target_kind as e_kind,
      el.created_at  as e_ts
    from public.entity_links el
   where (p_cursor_ts is null or el.created_at >= p_cursor_ts)
  ), db as (
    select
      ('card:' || db.source_doc_card_id::text) as e_src,
      case db.target_kind
        when 'board' then ('board:' || db.target_board_id::text)
        when 'card'  then ('card:'  || coalesce(db.target_board_id::text, '') || ':' || db.target_card_id)
        when 'doc'   then ('card:'  || db.target_doc_card_id::text)
        else null
      end as e_tgt,
      ('doc_' || db.target_kind) as e_kind,
      db.updated_at              as e_ts
    from public.doc_backlinks db
   where (p_cursor_ts is null or db.updated_at >= p_cursor_ts)
  ), membership as (
    select ('user:' || wm.user_id::text),
           ('ws:'   || wm.workspace_id::text),
           'membership'::text,
           wm.created_at
      from public.workspace_members wm
     where (p_cursor_ts is null or wm.created_at >= p_cursor_ts)
  ), wsroot as (
    select ('ws:'    || b.workspace_id::text),
           ('board:' || b.id::text),
           'wsroot'::text,
           b.created_at
      from public.boards b
     where b.parent_board_id is null
       and b.deleted_at is null
       and (p_cursor_ts is null or b.created_at >= p_cursor_ts)
  ), share as (
    select ('user:'  || bs.user_id::text),
           ('board:' || bs.board_id::text),
           'share'::text,
           bs.created_at
      from public.board_shares bs
     where (p_cursor_ts is null or bs.created_at >= p_cursor_ts)
  ), unioned as (
    select * from hier
    union all
    select * from structural
    union all
    select e_src, e_tgt, e_kind, e_ts from el where e_src is not null and e_tgt is not null
    union all
    select e_src, e_tgt, e_kind, e_ts from db where e_tgt is not null
    union all
    select * from membership
    union all
    select * from wsroot
    union all
    select * from share
  ), keyed as (
    select u.e_src  as source_id,
           u.e_tgt  as target_id,
           u.e_kind as edge_kind,
           u.e_ts   as created_at,
           (u.e_src || chr(31) || u.e_tgt || chr(31) || u.e_kind) as edge_key
      from unioned u
  ), page as (
    select k.source_id, k.target_id, k.edge_kind, k.created_at, k.edge_key
      from keyed k
     where p_cursor_ts is null
        or (k.created_at, k.edge_key) > (p_cursor_ts, p_cursor_key)
     order by k.created_at asc, k.edge_key asc
     limit p_limit
  )
  select coalesce(jsonb_agg((to_jsonb(p) - 'edge_key') order by p.created_at, p.edge_key), '[]'::jsonb),
         count(*),
         (array_agg(p.created_at order by p.created_at desc, p.edge_key desc))[1],
         (array_agg(p.edge_key   order by p.created_at desc, p.edge_key desc))[1]
    into v_rows, v_count, v_last_ts, v_last_key
    from page p;

  return jsonb_build_object(
    'edges',    v_rows,
    'next_ts',  v_last_ts,
    'next_key', v_last_key,
    'done',     v_count < p_limit
  );
end $function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Make the ticker's semantics match its labels
-- ─────────────────────────────────────────────────────────────────────────
--
-- today.cards counted cards EDITED today and was rendered as "+N today"
-- growth. today.links counted entity_links (which today are 100% tag
-- attachments) plus doc_backlinks by their edit time. Both now count
-- creations, and the tag half is named `tags` so the UI can stop calling
-- tag attachments "Links" — the universe renders none of them as edges.

create or replace function public.admin_universe_stats()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_counters jsonb;
  v_today    jsonb;
  v_midnight timestamptz := date_trunc('day', now());
begin
  perform public._require_admin();
  select jsonb_object_agg(key, value) into v_counters from public.platform_counters;
  v_today := jsonb_build_object(
    'users',      (select count(*) from auth.users
                     where email_confirmed_at is not null
                       and last_sign_in_at is not null
                       and created_at >= v_midnight),
    'workspaces', (select count(*) from public.workspaces where created_at >= v_midnight),
    'boards',     (select count(*) from public.boards  where created_at >= v_midnight and deleted_at is null),
    'cards',      (select count(*) from public.card_index where created_at >= v_midnight),
    'tags',       (select count(*) from public.entity_links where created_at >= v_midnight),
    'links',      (select count(*) from public.doc_backlinks where updated_at >= v_midnight)
  );
  return coalesce(v_counters, '{}'::jsonb) || jsonb_build_object('today', v_today);
end $function$;

-- "New · 24h" claimed to be new nodes but was boards-created plus cards-EDITED,
-- and silently omitted users and workspaces entirely. All four node kinds, all
-- genuinely created.
create or replace function public._reconcile_universe_counters()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.platform_counters set value = (
    (select count(*) from public.workspaces where created_at >= now() - interval '24 hours')
  + (select count(*) from public.boards     where deleted_at is null and created_at >= now() - interval '24 hours')
  + (select count(*) from public.card_index where created_at >= now() - interval '24 hours')
  + (select count(*) from auth.users        where email_confirmed_at is not null
                                              and last_sign_in_at is not null
                                              and created_at >= now() - interval '24 hours')
  ), updated_at = now() where key = 'nodes_created_24h';
end $function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. One definition of "time in app"
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public._reconcile_universe_counters_full()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.platform_counters set value = (select count(*) from public.workspaces),                       updated_at = now() where key = 'total_workspaces';
  update public.platform_counters set value = (select count(*) from public.boards where deleted_at is null),  updated_at = now() where key = 'total_boards';
  update public.platform_counters set value = (select count(*) from public.card_index),                       updated_at = now() where key = 'total_cards';
  update public.platform_counters set value = (
    (select count(*) from public.entity_links) + (select count(*) from public.doc_backlinks)
  ), updated_at = now() where key = 'total_links';
  update public.platform_counters set value = (select count(*) from auth.users
                                                 where email_confirmed_at is not null and last_sign_in_at is not null),
                                       updated_at = now() where key = 'total_users';
  -- 0254: this key was never reconciled, so it could only drift. It is now
  -- defined as summed profile time, matching admin_stats.total_seconds_in_app.
  update public.platform_counters set value = (select coalesce(sum(seconds_in_app), 0)::bigint from public.profiles),
                                       updated_at = now() where key = 'total_seconds_in_app';
  perform public._reconcile_universe_counters();
end $function$;

-- Stop crediting the global counter for heartbeats that have no profile to
-- credit — that asymmetry is what let the two surfaces disagree by a third.
-- Everything else in this function is unchanged from 0248.
create or replace function public.bump_seconds_in_app(
  p_seconds integer,
  p_session_id uuid default null,
  p_user_id uuid default null,
  p_did_work boolean default false)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  if v_credit > 0 and p_user_id is not null then
    -- 0254: both writes are now inside the same guard, so the counter and the
    -- summed profile column can never diverge again.
    update public.platform_counters set value = value + v_credit, updated_at = v_now where key = 'total_seconds_in_app';
    update public.profiles set seconds_in_app = seconds_in_app + v_credit where user_id = p_user_id;
    -- ADDED IN 0248: the day row now carries whether it was work or presence.
    insert into public.user_active_day (user_id, day, did_work, work_ops)
      values (p_user_id, current_date, coalesce(p_did_work, false), case when p_did_work then 1 else 0 end)
      on conflict (user_id, day) do update
        set did_work = public.user_active_day.did_work or excluded.did_work,
            work_ops = public.user_active_day.work_ops + excluded.work_ops;
  end if;
  return v_credit;
end $function$;

-- One-shot: bring the drifted counters to truth immediately rather than
-- waiting for tonight's 03:20 run.
select public._reconcile_universe_counters_full();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Card windows mean creation, not last edit
-- ─────────────────────────────────────────────────────────────────────────
--
-- admin_cards_per_day bucketed by updated_at, so re-saving an old card moved
-- it OUT of its original day — the chart's history rewrote itself as people
-- worked. Both RPCs now window on created_at. (Feeds the Command Center plus
-- analytics/views/OverviewView.jsx and EngagementView.jsx.)

create or replace function public.admin_cards_per_day(
  p_days integer default 30,
  p_exclude_internal boolean default true)
returns table(day date, cards integer)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
  select d::date as day, coalesce(c.n, 0)::int as cards
  from generate_series(current_date - (p_days - 1), current_date, '1 day'::interval) d
  left join (
    select date_trunc('day', ci.created_at)::date as day, count(*)::int as n
    from public.card_index ci left join public.boards b on b.id = ci.board_id
    where ci.created_at >= (current_date - (p_days - 1))::timestamptz
      and (not p_exclude_internal or b.created_by is null or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))
    group by 1
  ) c on c.day = d::date
  order by day asc;
end;
$function$;

create or replace function public.admin_card_stats(
  p_days integer default 30,
  p_exclude_internal boolean default true)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_out jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  with c as (
    select ci.kind, coalesce(p.tier, 'demo')::text as tier
    from public.card_index ci
    join public.boards b on b.id = ci.board_id
    left join public.profiles p on p.user_id = b.created_by
    where ci.created_at >= now() - (p_days || ' days')::interval
      and (not p_exclude_internal or b.created_by is null or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))
  )
  select jsonb_build_object(
    'total',        (select count(*) from c),
    'by_kind',      coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) as n from c group by kind) k), '{}'::jsonb),
    'by_tier',      coalesce((select jsonb_object_agg(tier, n) from (select tier, count(*) as n from c group by tier) t), '{}'::jsonb),
    'kind_by_tier', coalesce((select jsonb_object_agg(kind, by_t) from (
                       select kind, jsonb_object_agg(tier, n) as by_t
                       from (select kind, tier, count(*) as n from c group by kind, tier) inner_q
                       group by kind
                     ) kt), '{}'::jsonb)
  ) into v_out;
  return v_out;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. comped_paid could exceed the "Paying" value printed above it
-- ─────────────────────────────────────────────────────────────────────────
--
-- tier_counts.paid joins auth.users and honours p_verified_only; comped_paid
-- did neither, so the Command Center's "N comped" sub-label was drawn from a
-- strictly larger population than the number it qualifies. Same population now.

create or replace function public.admin_stats(p_verified_only boolean default true)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_out jsonb;
begin
  perform public._require_admin();

  select jsonb_build_object(
    'total_users',     (select count(*) from auth.users u
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))),
    'new_users_7d',    (select count(*) from auth.users u
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and u.created_at >= now() - interval '7 days'),
    'tier_counts',     coalesce((select jsonb_object_agg(tier, n) from (
                          select p.tier, count(*) as n
                          from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                          group by p.tier
                        ) t), '{}'::jsonb),
    'total_seconds_in_app',
                       (select coalesce(sum(p.seconds_in_app), 0)::bigint
                          from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))),
    'sub_counts',      coalesce((select jsonb_object_agg(status, n) from (
                          select status, count(*) as n
                          from public.subscriptions
                          where status is not null
                          group by status
                        ) s), '{}'::jsonb),
    'mrr_cents',       coalesce((
                          select sum(coalesce(
                            monthly_amount_cents,
                            case when plan = 'monthly' then 2500
                                 when plan = 'annual'  then 2000
                                 else 0 end
                          ))::int
                          from public.subscriptions
                          where status in ('active', 'trialing')
                        ), 0),
    -- 0254: same population as tier_counts.paid above.
    'comped_paid',     (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where p.tier = 'paid'
                            and (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and not exists (
                              select 1 from public.subscriptions s
                              where s.user_id = p.user_id and s.status in ('active', 'trialing')
                            )),
    -- 0254: how many of tier_counts.paid are backed by a real subscription.
    'subscribed_paid', (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where p.tier = 'paid'
                            and (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and exists (
                              select 1 from public.subscriptions s
                              where s.user_id = p.user_id and s.status in ('active', 'trialing')
                            )),
    'discounted_subs', (select count(*) from public.subscriptions
                          where status in ('active', 'trialing') and discount is not null),
    'waitlist_pending',(select count(*) from public.waitlist_entries where status = 'pending'),
    'waitlist_total',  (select count(*) from public.waitlist_entries)
  ) into v_out;
  return v_out;
end $function$;
