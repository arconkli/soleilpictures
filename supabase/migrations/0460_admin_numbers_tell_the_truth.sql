-- 0460 — The admin numbers count what their labels say.
--
-- An audit of /admin traced every figure to its query. The arithmetic was
-- right; several definitions were not:
--
--   1. Universe totals read platform_counters. "Cards" kept every card on a
--      trashed cluster while "Clusters" left those clusters out; "Boards"
--      counted the Studio every workspace is born with as if someone had made
--      it; "24h" was refreshed by a 15-minute cron; and the "+N today" chips
--      reset at UTC midnight, which is late afternoon for the people reading
--      them. admin_universe_stats now computes exact live totals, splits
--      clusters people made from Studios, and adds a rolling last_24h block.
--      Its `today` block is untouched: it is the live bar of the Command
--      Center's cards chart and has to keep matching admin_cards_per_day.
--      Everyone is still counted, the team included — that is the owner's
--      call, and the client labels it.
--   2. The galaxy drew every card on a trashed cluster as a node with no
--      parent. Snapshot and edges both skip them now.
--   3. The Users "Active" filter meant "owns a cluster", and the Studio means
--      every account owns one. _admin_made_something() is the one definition
--      — placed a card ever, holds cards, or made a cluster of their own — and
--      the list, its count, the source dropdown's counts and the share-signup
--      "activated" column all read it, so they cannot disagree again.
--   4. metrics_daily rows were snapshots of whenever the admin last opened the
--      dashboard, and the 00:05 cron opened the new day instead of closing the
--      old one. capture_metrics_daily takes the day; the cron closes yesterday
--      and opens today; past signups and active users are restated exactly.
--   5. Time in app had only a lifetime total. user_active_day.seconds starts a
--      per-day history, written by the heartbeat's existing upsert.
--   6. New reads for the Analytics › Overview: lifetime totals that follow
--      both of its toggles, the newest signups with their guest work, and one
--      row per week since launch for the long-term charts.
--
-- Four functions gain an argument. A new argument is a new signature, so, as
-- in 0410, the old one is renamed out of PostgREST's way (left beside a
-- replacement whose last argument has a default, a call would be ambiguous)
-- and closed to every client role, and the new one restates its grants. Every
-- new argument defaults to the old behaviour, so the shipped client keeps
-- reading exactly what it read before.

begin;

set local lock_timeout = '3s';

-- ── 1. Seconds per day ──────────────────────────────────────────────────────
--
-- A constant default makes this a catalog-only change on a hot table. The
-- table's grants are table-level and authenticated holds SELECT only, so a
-- client can read its own seconds and write nobody's.

alter table public.user_active_day add column if not exists seconds integer not null default 0;

create or replace function public.bump_seconds_in_app(
  p_seconds integer,
  p_session_id uuid default null::uuid,
  p_user_id uuid default null::uuid,
  p_did_work boolean default false
)
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
    -- 0254: both writes are now inside the same guard, so the counter and the
    -- summed profile column cannot diverge again.
    update public.platform_counters set value = value + v_credit, updated_at = v_now where key = 'total_seconds_in_app';
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

-- ── 2. Who has made something ───────────────────────────────────────────────
--
-- first_card_at is stamped for whoever placed a card, in any workspace, and
-- survives the card being deleted. Live cards catch an owner whose cards came
-- in some other way. A cluster of their own — never the Studio, which nobody
-- chose to make — counts too.

create or replace function public._admin_made_something()
returns table(user_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.user_id from public.profiles p where p.first_card_at is not null
  union
  select c.user_id from public._owner_card_counts c where c.live_cards > 0 and c.user_id is not null
  union
  select b.created_by from public.boards b
   where b.created_by is not null and b.deleted_at is null and b.parent_board_id is not null;
$function$;

-- ── 3. Universe totals, exact and live ──────────────────────────────────────
--
-- Every key the shipped bundles read is still here, with the corrected
-- definition. No timestamp: the party worker pushes only when this payload
-- changes, and a clock in it would push every second.

create or replace function public.admin_universe_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_midnight timestamptz := date_trunc('day', now());
  v_since    timestamptz := now() - interval '24 hours';
  v_totals   jsonb;
  v_24h      jsonb;
  v_today    jsonb;
begin
  perform public._require_admin();

  v_totals := jsonb_build_object(
    'total_users',          (select count(*) from auth.users
                              where email_confirmed_at is not null and last_sign_in_at is not null),
    'total_workspaces',     (select count(*) from public.workspaces),
    'total_boards',         (select count(*) from public.boards where deleted_at is null),
    'total_clusters_made',  (select count(*) from public.boards where deleted_at is null and parent_board_id is not null),
    'total_studios',        (select count(*) from public.boards where deleted_at is null and parent_board_id is null),
    'total_cards',          (select count(*) from public.card_index ci join public.boards b on b.id = ci.board_id where b.deleted_at is null),
    'total_links',          (select count(*) from public.entity_links) + (select count(*) from public.doc_backlinks),
    'total_seconds_in_app', (select coalesce(sum(seconds_in_app), 0) from public.profiles)
  );

  v_24h := jsonb_build_object(
    'users',         (select count(*) from auth.users
                       where email_confirmed_at is not null and last_sign_in_at is not null
                         and created_at >= v_since),
    'workspaces',    (select count(*) from public.workspaces where created_at >= v_since),
    'boards',        (select count(*) from public.boards where deleted_at is null and created_at >= v_since),
    'clusters_made', (select count(*) from public.boards
                       where deleted_at is null and parent_board_id is not null and created_at >= v_since),
    'cards',         (select count(*) from public.card_index ci join public.boards b on b.id = ci.board_id
                       where b.deleted_at is null and ci.created_at >= v_since)
  );

  -- Unchanged since 0254: the Command Center's chart puts today.cards in place
  -- of admin_cards_per_day's last bar, so the two must count the same thing.
  v_today := jsonb_build_object(
    'users',      (select count(*) from auth.users
                     where email_confirmed_at is not null
                       and last_sign_in_at is not null
                       and created_at >= v_midnight),
    'workspaces', (select count(*) from public.workspaces where created_at >= v_midnight),
    'boards',     (select count(*) from public.boards  where created_at >= v_midnight and deleted_at is null),
    -- card-count-lint: activity — made since midnight, trashed clusters included.
    'cards',      (select count(*) from public.card_index where created_at >= v_midnight),
    'tags',       (select count(*) from public.entity_links where created_at >= v_midnight),
    'links',      (select count(*) from public.doc_backlinks where updated_at >= v_midnight)
  );

  return v_totals || jsonb_build_object(
    -- The galaxy's own definition of a new node, in the last 24 hours.
    'nodes_created_24h', (v_24h->>'users')::bigint + (v_24h->>'workspaces')::bigint
                       + (v_24h->>'boards')::bigint + (v_24h->>'cards')::bigint,
    'last_24h', v_24h,
    'today',    v_today
  );
end $function$;

-- ── 4. The galaxy draws only what is live ───────────────────────────────────

create or replace function public.admin_universe_snapshot_v2(
  p_cursor_ts timestamp with time zone default null::timestamp with time zone,
  p_cursor_id text default null::text,
  p_limit integer default 50000
)
returns jsonb
language plpgsql
stable
security definer
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
    -- delta stream, and the keyset below cannot be moved under the crawl.
    -- 0460: only cards whose cluster is drawn. A card on a trashed cluster
    -- arrived as a node with no parent and was counted in the legend.
    select ('card:' || ci.board_id::text || ':' || ci.card_id), ci.kind, ci.workspace_id, ci.created_at
      from public.card_index ci
      join public.boards cb on cb.id = ci.board_id
     where cb.deleted_at is null
       and (p_cursor_ts is null or ci.created_at >= p_cursor_ts)
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
  p_cursor_ts timestamp with time zone default null::timestamp with time zone,
  p_cursor_key text default null::text,
  p_limit integer default 100000
)
returns jsonb
language plpgsql
stable
security definer
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
    -- 0254: created_at so the board->card edge shares its card node's timestamp
    -- and the two paginate together instead of the edge re-firing on every edit.
    -- 0460: and only for a cluster the snapshot still draws, or the edge
    -- would wait forever for a node that is never sent.
    select ('board:' || ci.board_id::text),
           ('card:'  || ci.board_id::text || ':' || ci.card_id),
           'structural'::text,
           ci.created_at
      from public.card_index ci
      join public.boards cb on cb.id = ci.board_id
     where cb.deleted_at is null
       and (p_cursor_ts is null or ci.created_at >= p_cursor_ts)
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

-- ── 5. "Here now" can leave the team out ────────────────────────────────────
--
-- The Overview has an Internal toggle and its "here now" ignored it, so it
-- always counted whoever was reading it. The Command Center keeps counting
-- everyone, which the default preserves.

alter function public.admin_active_now(integer) rename to admin_active_now_0101;
revoke execute on function public.admin_active_now_0101(integer) from public, anon, authenticated;

create or replace function public.admin_active_now(
  p_window_minutes integer default 5,
  p_exclude_internal boolean default false
)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_n int;
begin
  perform public._require_admin();
  p_window_minutes := greatest(1, least(p_window_minutes, 1440));
  select count(*) into v_n
  from public.user_presence pr
  where pr.last_seen_at > now() - make_interval(mins => p_window_minutes)
    and (not p_exclude_internal
         or pr.user_id not in (select iu.user_id from public._internal_user_ids() iu));
  return coalesce(v_n, 0);
end;
$function$;

-- ── 6. Signups by day can leave the team out ────────────────────────────────
--
-- Retention sizes its intake with this under an Internal toggle it ignored.

alter function public.admin_signups_by_day(integer, boolean) rename to admin_signups_by_day_0149;
revoke execute on function public.admin_signups_by_day_0149(integer, boolean) from public, anon, authenticated;

create or replace function public.admin_signups_by_day(
  p_days integer default 30,
  p_verified_only boolean default true,
  p_exclude_internal boolean default false
)
returns table(day date, signups integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
  select d::date as day, coalesce(c.n, 0)::int as signups
  from generate_series(
    current_date - (p_days - 1),
    current_date,
    '1 day'::interval
  ) d
  left join (
    select date_trunc('day', u.created_at)::date as day, count(*)::int as n
    from auth.users u
    where (not p_verified_only
           or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
      and (not p_exclude_internal
           or u.id not in (select iu.user_id from public._internal_user_ids() iu))
      and u.created_at >= (current_date - (p_days - 1))::timestamptz
    group by 1
  ) c on c.day = d::date
  order by day asc;
end $function$;

-- ── 7. Source counts follow the activity filter ─────────────────────────────
--
-- The Users source dropdown printed a count beside each source that ignored
-- the activity filter beside it, so a source never matched the list it chose.

alter function public.admin_acquisition_channels(text) rename to admin_acquisition_channels_0159;
revoke execute on function public.admin_acquisition_channels_0159(text) from public, anon, authenticated;

create or replace function public.admin_acquisition_channels(
  p_verification text default 'all'::text,
  p_activity text default 'all'::text
)
returns table(channel text, n integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_v text := lower(coalesce(nullif(trim(p_verification), ''), 'all'));
  v_a text := lower(coalesce(nullif(trim(p_activity), ''), 'all'));
begin
  perform public._require_admin();
  return query
  select public.derive_acquisition_channel(p.first_source) as channel, count(*)::int as n
    from auth.users u
    left join public.profiles p on p.user_id = u.id
   where (case v_v
            when 'verified'   then (u.email_confirmed_at is not null and u.last_sign_in_at is not null)
            when 'unverified' then (u.email_confirmed_at is null     or  u.last_sign_in_at is null)
            else true
          end)
     and (case v_a
            when 'active'   then u.id in     (select m.user_id from public._admin_made_something() m)
            when 'inactive' then u.id not in (select m.user_id from public._admin_made_something() m)
            else true
          end)
   group by 1
   order by n desc, channel asc;
end $function$;

-- ── 8. A day is captured when it has ended ──────────────────────────────────
--
-- Signups and active users are the day's own, derived exactly, so a capture
-- at 00:05 and a capture at noon record the same day. MRR and the tier counts
-- are snapshots of now, so only today (so far) and yesterday (closed at 00:05)
-- can be captured: anything older would put today's numbers on a day long
-- gone. Active users are user_active_day's, which keeps a row per person per
-- day; user_presence keeps only the last sighting and cannot answer for a
-- day that has ended.

alter function public.capture_metrics_daily() rename to capture_metrics_daily_0332;
revoke execute on function public.capture_metrics_daily_0332() from public, anon, authenticated;

create or replace function public.capture_metrics_daily(p_day date default current_date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_day is null or p_day > current_date or p_day < current_date - 1 then
    raise exception 'capture_metrics_daily: only today or yesterday, not %', p_day using errcode = '22023';
  end if;

  insert into public.metrics_daily (
    day, mrr_cents, total_users, paid_users, trialing_users, demo_users,
    waitlist_users, admin_users, signups, active_users, captured_at
  )
  select
    p_day,
    coalesce((
      select sum(coalesce(monthly_amount_cents,
               case when plan = 'monthly' then 2500
                    when plan = 'annual'  then 2000
                    else 0 end))::int
      from public.subscriptions where status = 'active'
    ), 0),
    (select count(*) from auth.users
       where email_confirmed_at is not null and last_sign_in_at is not null)::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null
         and p.tier = 'paid'
         and not exists (select 1 from public.subscriptions s
                          where s.user_id = p.user_id and s.status = 'trialing'))::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null
         and exists (select 1 from public.subscriptions s
                      where s.user_id = p.user_id and s.status = 'trialing'))::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null and p.tier = 'demo')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null and p.tier = 'waitlist')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.email_confirmed_at is not null and u.last_sign_in_at is not null and p.tier = 'admin')::int,
    -- 0460: the day's own signups and active users, not "since midnight".
    (select count(*) from auth.users
       where email_confirmed_at is not null and last_sign_in_at is not null
         and created_at >= p_day and created_at < p_day + 1)::int,
    (select count(*) from public.user_active_day where day = p_day)::int,
    now()
  on conflict (day) do update set
    mrr_cents      = excluded.mrr_cents,
    total_users    = excluded.total_users,
    paid_users     = excluded.paid_users,
    trialing_users = excluded.trialing_users,
    demo_users     = excluded.demo_users,
    waitlist_users = excluded.waitlist_users,
    admin_users    = excluded.admin_users,
    signups        = excluded.signups,
    active_users   = excluded.active_users,
    captured_at    = excluded.captured_at;
end;
$function$;

-- One statement: close yesterday, then open today.
select cron.unschedule(jobid) from cron.job where jobname = 'capture_metrics_daily';
select cron.schedule('capture_metrics_daily', '5 0 * * *',
  $$select public.capture_metrics_daily(current_date - 1), public.capture_metrics_daily(current_date)$$);

-- ── 9. Users: "made something", one definition ──────────────────────────────

create or replace function public.admin_list_users(
  p_limit integer default 50,
  p_offset integer default 0,
  p_query text default null::text,
  p_tier text default null::text,
  p_sort text default 'recent'::text,
  p_status text default null::text,
  p_source text default null::text,
  p_contacted text default null::text,
  p_verification text default 'verified'::text,
  p_activity text default 'all'::text
)
returns table(user_id uuid, email text, tier text, card_count integer, seconds_in_app bigint, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, subscription_plan text, subscription_status text, current_period_end timestamp with time zone, subscription_amount_cents integer, subscription_discounted boolean, banned boolean, joined_waitlist boolean, display_name text, avatar_url text, color text, last_seen_at timestamp with time zone, board_count integer, acquisition_source text, last_reached_out_at timestamp with time zone, outreach_count integer, email_confirmed boolean, storage_bytes bigint, country text, last_worked_at timestamp with time zone)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_q text := nullif(trim(coalesce(p_query,     '')), '');
  v_t text := nullif(trim(coalesce(p_tier,      '')), '');
  v_s text := nullif(trim(coalesce(p_status,    '')), '');
  v_o text := nullif(trim(coalesce(p_source,    '')), '');
  v_c text := nullif(trim(coalesce(p_contacted, '')), '');
  v_k text := lower(coalesce(nullif(trim(p_sort), ''), 'recent'));
  v_v text := lower(coalesce(nullif(trim(p_verification), ''), 'verified'));
  v_a text := lower(coalesce(nullif(trim(p_activity), ''), 'all'));
begin
  perform public._require_admin();
  p_limit  := greatest(1, least(p_limit, 200));
  p_offset := greatest(0, p_offset);
  return query
  with owner_cards as (
    select b.created_by as uid,
           max(ci.updated_at) filter (where ci.card_id not like 'onb-%') as last_card_at
    from public.card_index ci join public.boards b on b.id = ci.board_id
    group by b.created_by
  ),
  owner_counts as (
    select c.user_id as uid, c.live_cards from public._owner_card_counts c
  ),
  owner_boards as (
    select b.created_by as uid, count(*)::int as board_count
    from public.boards b where b.created_by is not null and b.deleted_at is null
    group by b.created_by
  ),
  owner_storage as (
    select w.created_by as uid, coalesce(sum(i.size_bytes), 0)::bigint as bytes
    from public.images i join public.workspaces w on w.id = i.workspace_id
    where i.deleted_at is null group by w.created_by
  ),
  work_ev as (
    select e.user_id as uid, max(e.occurred_at) as last_ev_at
    from public.analytics_events e
    where e.user_id is not null
      and e.event in ('card_placed','card_edit','doc_edit','comment_create',
                      'arrow_created','remix_clone','tag_manual_apply','tag_confirm')
      and coalesce(e.props->>'synthetic', '') <> 'true'
    group by e.user_id
  ),
  base as (
    select
      u.id as user_id, u.email::text as email, coalesce(p.tier, 'demo')::text as tier,
      coalesce(occ.live_cards, 0)::int as card_count,
      coalesce(p.seconds_in_app, 0)::bigint as seconds_in_app,
      u.created_at as created_at, u.last_sign_in_at as last_sign_in_at,
      s.plan::text as subscription_plan, s.status::text as subscription_status,
      s.current_period_end as current_period_end, s.monthly_amount_cents as subscription_amount_cents,
      (s.discount is not null) as subscription_discounted, (p.banned_at is not null) as banned,
      exists (select 1 from public.waitlist_entries we2 where lower(we2.email) = lower(u.email)) as joined_waitlist,
      nullif(p.display_name, '') as display_name, nullif(p.avatar_url, '') as avatar_url,
      nullif(p.color, '') as color, pr.last_seen_at as last_seen_at,
      coalesce(ob.board_count, 0)::int as board_count,
      public.derive_acquisition_channel(p.first_source) as acquisition_source,
      ox.last_reached_out_at as last_reached_out_at, coalesce(ox.outreach_count, 0)::int as outreach_count,
      (u.email_confirmed_at is not null) as email_confirmed, coalesce(ostor.bytes, 0)::bigint as storage_bytes,
      nullif(p.country, '') as country,
      greatest(oc.last_card_at, we.last_ev_at) as last_worked_at
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.subscriptions s on s.user_id = u.id
    left join public.user_presence pr on pr.user_id = u.id
    left join owner_cards oc on oc.uid = u.id
    left join owner_counts occ on occ.uid = u.id
    left join owner_boards ob on ob.uid = u.id
    left join owner_storage ostor on ostor.uid = u.id
    left join work_ev we on we.uid = u.id
    left join lateral (
      select max(o.reached_at) as last_reached_out_at, count(*)::int as outreach_count
      from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)
    ) ox on true
    where (case v_v
             when 'verified'   then (u.email_confirmed_at is not null and u.last_sign_in_at is not null)
             when 'unverified' then (u.email_confirmed_at is null     or  u.last_sign_in_at is null)
             else true end)
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
  )
  select * from base
  where (v_o is null or base.acquisition_source = v_o)
    and (v_c is null
         or (v_c = 'yes' and base.last_reached_out_at is not null)
         or (v_c = 'no'  and base.last_reached_out_at is null))
    -- 0460: "active" meant cards OR any cluster, and every account's Studio
    -- is a cluster. It means made something now; see _admin_made_something.
    and (case v_a
           when 'active'   then base.user_id in     (select m.user_id from public._admin_made_something() m)
           when 'inactive' then base.user_id not in (select m.user_id from public._admin_made_something() m)
           else true end)
  order by
    case when v_k = 'recent' then base.created_at end desc nulls last,
    case when v_k = 'active' then base.last_seen_at end desc nulls last,
    case when v_k = 'worked' then base.last_worked_at end desc nulls last,
    case when v_k = 'cards'  then base.card_count end desc nulls last,
    case when v_k = 'spend'  then base.subscription_amount_cents end desc nulls last,
    case when v_k = 'name'   then lower(coalesce(base.display_name, base.email)) end asc nulls last,
    base.created_at desc nulls last
  limit p_limit offset p_offset;
end $function$;

create or replace function public.admin_user_count(
  p_query text default null::text,
  p_tier text default null::text,
  p_status text default null::text,
  p_source text default null::text,
  p_contacted text default null::text,
  p_verification text default 'verified'::text,
  p_activity text default 'all'::text
)
returns bigint
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_q text := nullif(trim(coalesce(p_query,     '')), '');
  v_t text := nullif(trim(coalesce(p_tier,      '')), '');
  v_s text := nullif(trim(coalesce(p_status,    '')), '');
  v_o text := nullif(trim(coalesce(p_source,    '')), '');
  v_c text := nullif(trim(coalesce(p_contacted, '')), '');
  v_v text := lower(coalesce(nullif(trim(p_verification), ''), 'verified'));
  v_a text := lower(coalesce(nullif(trim(p_activity), ''), 'all'));
  v_n bigint;
begin
  perform public._require_admin();
  with base as (
    select public.derive_acquisition_channel(p.first_source) as acquisition_source
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.subscriptions s on s.user_id = u.id
    where (case v_v
             when 'verified'   then (u.email_confirmed_at is not null and u.last_sign_in_at is not null)
             when 'unverified' then (u.email_confirmed_at is null     or  u.last_sign_in_at is null)
             else true end)
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
      and (v_c is null
           or (v_c = 'yes' and     exists (select 1 from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)))
           or (v_c = 'no'  and not exists (select 1 from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email))))
      -- 0460: the list's own predicate, from the one helper both read.
      and (case v_a
             when 'active'   then u.id in     (select m.user_id from public._admin_made_something() m)
             when 'inactive' then u.id not in (select m.user_id from public._admin_made_something() m)
             else true end)
  )
  select count(*) into v_n from base where (v_o is null or base.acquisition_source = v_o);
  return v_n;
end $function$;

create or replace function public.admin_share_signups(p_limit integer default 20)
returns table(kind text, token text, slug text, board_id uuid, board_title text, shared_by_email text, link_kind text, link_role text, signups integer, activated integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public._require_admin();
  p_limit := greatest(1, least(coalesce(p_limit, 20), 100));

  return query
  -- 0460: "activated" is the Users tab's "made something". The old rule
  -- (any card ever indexed on a cluster they made, or any live cluster) was
  -- met by every account's Studio.
  with active_users as (
    select m.user_id as id from public._admin_made_something() m
  ),
  share_link_cohort as (
    select p.first_source->>'share_token' as tok,
           count(*)::int as signups,
           count(*) filter (where au.id is not null)::int as activated
    from public.profiles p
    left join active_users au on au.id = p.user_id
    where nullif(p.first_source->>'share_token', '') is not null
    group by 1
  ),
  public_board_cohort as (
    select p.first_source->>'public_slug' as sl,
           count(*)::int as signups,
           count(*) filter (where au.id is not null)::int as activated
    from public.profiles p
    left join active_users au on au.id = p.user_id
    where nullif(p.first_source->>'public_slug', '') is not null
    group by 1
  )
  select 'share_link'::text, slc.tok, null::text,
         psl.board_id, b.name, su.email::text, psl.kind, psl.role,
         slc.signups, slc.activated
  from share_link_cohort slc
  left join public.public_share_links psl on psl.token::text = slc.tok
  left join public.boards b on b.id = psl.board_id
  left join auth.users su on su.id = psl.created_by
  union all
  select 'public_board'::text, null::text, pbc.sl,
         pb.board_id, b2.name, su2.email::text, null::text, null::text,
         pbc.signups, pbc.activated
  from public_board_cohort pbc
  left join public.public_boards pb on pb.slug = pbc.sl
  left join public.boards b2 on b2.id = pb.board_id
  left join auth.users su2 on su2.id = pb.created_by
  order by 9 desc
  limit p_limit;
end $function$;

-- The detail panel's "Boards" counted the Studio. It keeps board_count for
-- the shipped client and adds the split, plus the days the person was here.
create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_out jsonb;
begin
  perform public._require_admin();

  if p_user_id is null then
    raise exception 'user id required' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'user_id', u.id,
    'email',   u.email::text,
    'flags', jsonb_build_object(
      'banned',          (p.banned_at is not null),
      'is_internal',     exists (select 1 from public._internal_user_ids() iu(id) where iu.id = u.id),
      'email_confirmed', (u.email_confirmed_at is not null),
      'last_sign_in_at', u.last_sign_in_at,
      'verified',        (u.email_confirmed_at is not null and u.last_sign_in_at is not null)
    ),
    'identity', jsonb_build_object(
      'display_name', nullif(p.display_name, ''),
      'avatar_url',   nullif(p.avatar_url, ''),
      'color',        nullif(p.color, ''),
      'tier',         coalesce(p.tier, 'demo'),
      'banned',       (p.banned_at is not null),
      'banned_at',    p.banned_at,
      'banned_by',    p.banned_by,
      'banned_by_email', (select bu.email::text from auth.users bu where bu.id = p.banned_by),
      'banned_reason',   p.banned_reason
    ),
    'acquisition', jsonb_build_object(
      'label',         public.derive_acquisition_channel(p.first_source),
      'utm_source',    nullif(p.first_source->>'utm_source', ''),
      'utm_medium',    nullif(p.first_source->>'utm_medium', ''),
      'utm_campaign',  nullif(p.first_source->>'utm_campaign', ''),
      'utm_content',   nullif(p.first_source->>'utm_content', ''),
      'utm_term',      nullif(p.first_source->>'utm_term', ''),
      'referrer',      nullif(p.first_source->>'referrer', ''),
      'referrer_host', nullif(p.first_source->>'referrer_host', ''),
      'landing_path',  nullif(p.first_source->>'landing_path', ''),
      'fbclid',        nullif(p.first_source->>'fbclid', ''),
      'gclid',         nullif(p.first_source->>'gclid', ''),
      'wbraid',        nullif(p.first_source->>'wbraid', ''),
      'gbraid',        nullif(p.first_source->>'gbraid', ''),
      'msclkid',       nullif(p.first_source->>'msclkid', ''),
      'ttclid',        nullif(p.first_source->>'ttclid', ''),
      'twclid',        nullif(p.first_source->>'twclid', ''),
      'rdt_cid',       nullif(p.first_source->>'rdt_cid', ''),
      'li_fat_id',     nullif(p.first_source->>'li_fat_id', ''),
      'epik',          nullif(p.first_source->>'epik', ''),
      'sccid',         nullif(p.first_source->>'sccid', ''),
      'share_token',   nullif(p.first_source->>'share_token', ''),
      'public_slug',   nullif(p.first_source->>'public_slug', ''),
      'share',         sh.info,
      'last_touch', case when lt.bag is null then null
        else (lt.bag
              || jsonb_build_object('channel', public.derive_acquisition_channel(lt.bag))
              || (case when lt.touched_at is not null then jsonb_build_object('at', lt.touched_at) else '{}'::jsonb end))
        end,
      'raw',           coalesce(p.first_source, '{}'::jsonb)
    ),
    'activation', jsonb_build_object(
      'created_at',        u.created_at,
      'first_board_at',    p.first_board_at,
      'first_card_at',     p.first_card_at,
      'first_share_at',    p.first_share_at,
      'first_backlink_at', p.first_backlink_at,
      'first_paid_at',     p.first_paid_at,
      'milestones', coalesce((
        select jsonb_agg(jsonb_build_object('key', m.key, 'at', m.at) order by m.at asc)
        from (
          values
            ('signed_up',     u.created_at),
            ('first_board',   p.first_board_at),
            ('first_card',    p.first_card_at),
            ('first_share',   p.first_share_at),
            ('first_backlink',p.first_backlink_at),
            ('first_paid',    p.first_paid_at)
        ) as m(key, at)
        where m.at is not null
      ), '[]'::jsonb)
    ),
    'engagement', jsonb_build_object(
      'seconds_in_app',  coalesce(p.seconds_in_app, 0),
      'last_seen_at',    pr.last_seen_at,
      'online',          (pr.last_seen_at is not null and pr.last_seen_at > now() - interval '5 minutes'),
      'card_count',         coalesce(occ.live_cards, 0),
      'discarded_cards',    coalesce(occ.discarded_cards, 0),
      'discarded_clusters', coalesce(occ.discarded_clusters, 0),
      'guest_cards',        coalesce(occ.guest_cards, 0),
      'guest_clusters',     coalesce(occ.guest_clusters, 0),
      'guest_workspaces',   coalesce(occ.guest_workspaces, 0),
      'board_count',     coalesce(ob.board_count, 0),
      -- 0460: the clusters they made, and the Studios they were given.
      'clusters_made',   coalesce(ob.clusters_made, 0),
      'studios',         coalesce(ob.studios, 0),
      -- 0460: days in the app, and the ones with real work in them.
      'active_days',      coalesce(ad.active_days, 0),
      'work_days',        coalesce(ad.work_days, 0),
      'first_active_day', ad.first_day,
      'last_active_day',  ad.last_day,
      'demo_card_cap',   (coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)),
      'card_cap_base',   coalesce(p.card_cap_base, 50),
      'bonus_card_credits',   coalesce(p.bonus_card_credits, 0),
      'effective_card_limit', (coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)),
      'storage', jsonb_build_object(
        'used_bytes',  coalesce(st.used_bytes, 0),
        'quota_bytes', public._storage_quota_bytes(),
        'image_count', coalesce(st.image_count, 0)
      )
    ),
    'device', jsonb_build_object(
      'last', (
        select jsonb_build_object(
          'device_type', e.props->>'device_type',
          'os',          e.props->>'os',
          'browser',     e.props->>'browser',
          'at',          e.occurred_at
        )
        from public.analytics_events e
        where e.user_id = u.id and nullif(e.props->>'device_type', '') is not null
        order by e.occurred_at desc
        limit 1
      ),
      'breakdown', coalesce((
        select jsonb_agg(jsonb_build_object('device_type', d.dt, 'events', d.n) order by d.n desc)
        from (
          select coalesce(nullif(e.props->>'device_type', ''), 'unknown') as dt, count(*)::int as n
          from public.analytics_events e
          where e.user_id = u.id and nullif(e.props->>'device_type', '') is not null
          group by 1
        ) d
      ), '[]'::jsonb)
    ),
    'geo', jsonb_build_object(
      'signup_country', nullif(p.signup_country, ''),
      'country',        nullif(p.country, ''),
      'breakdown', coalesce((
        select jsonb_agg(jsonb_build_object('country', g.cc, 'events', g.n) order by g.n desc)
        from (
          select e.country as cc, count(*)::int as n
          from public.analytics_events e
          where e.user_id = u.id and nullif(e.country, '') is not null
          group by 1
        ) g
      ), '[]'::jsonb)
    ),
    'billing', case when s.user_id is null then null else jsonb_build_object(
      'plan',                  s.plan,
      'status',                s.status,
      'trialing',              (s.status = 'trialing'),
      'monthly_amount_cents',  s.monthly_amount_cents,
      'discount',              s.discount,
      'discounted',            (s.discount is not null),
      'cancel_at_period_end',  coalesce(s.cancel_at_period_end, false),
      'current_period_end',    s.current_period_end,
      'stripe_customer_id',    s.stripe_customer_id,
      'stripe_subscription_id',s.stripe_subscription_id,
      'updated_at',            s.updated_at
    ) end,
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email',            g.email,
        'status',           public._grant_status(g.revoked_at, g.expires_at),
        'expires_at',       g.expires_at,
        'granted_at',       g.granted_at,
        'granted_by_email', g.granted_by_email,
        'revoked_at',       g.revoked_at,
        'note',             g.note
      ) order by
        case when g.revoked_at is null then 0 else 1 end asc,
        g.granted_at desc)
      from public.paid_grants g
      where g.user_id = u.id or lower(g.email) = lower(u.email)
    ), '[]'::jsonb),
    'outreach', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',               o.id,
        'email',            o.email,
        'reached_at',       o.reached_at,
        'reached_by_email', o.reached_by_email,
        'note',             o.note
      ) order by o.reached_at desc)
      from public.user_outreach o
      where o.user_id = u.id or lower(o.email) = lower(u.email)
    ), '[]'::jsonb)
  )
  into v_out
  from auth.users u
  left join public.profiles      p  on p.user_id  = u.id
  left join public.subscriptions s  on s.user_id  = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join public._owner_card_counts occ on occ.user_id = u.id
  left join lateral (
    select count(*)::int as board_count,
           (count(*) filter (where b.parent_board_id is not null))::int as clusters_made,
           (count(*) filter (where b.parent_board_id is null))::int     as studios
    from public.boards b
    where b.created_by = u.id and b.deleted_at is null
  ) ob on true
  left join lateral (
    select count(*)::int as active_days,
           (count(*) filter (where a.did_work))::int as work_days,
           min(a.day) as first_day,
           max(a.day) as last_day
    from public.user_active_day a
    where a.user_id = u.id
  ) ad on true
  left join lateral (
    select coalesce(sum(i.size_bytes), 0)::bigint as used_bytes, count(*)::bigint as image_count
    from public.images i
    join public.workspaces w on w.id = i.workspace_id
    where w.created_by = u.id and i.deleted_at is null
  ) st on true
  left join lateral (
    select case
      when nullif(p.first_source->>'share_token','') is not null then (
        select jsonb_build_object(
          'kind',            'share_link',
          'token',           p.first_source->>'share_token',
          'board_id',        psl.board_id,
          'board_title',     b2.name,
          'shared_by_email', su.email::text,
          'link_kind',       psl.kind,
          'link_role',       psl.role,
          'link_created_at', psl.created_at,
          'link_revoked_at', psl.revoked_at,
          'cohort_signups',  (select count(*) from public.profiles p2
                               where p2.first_source->>'share_token' = p.first_source->>'share_token')
        )
        from public.public_share_links psl
        left join public.boards b2 on b2.id = psl.board_id
        left join auth.users su on su.id = psl.created_by
        where psl.token::text = p.first_source->>'share_token'
        limit 1
      )
      when nullif(p.first_source->>'public_slug','') is not null then (
        select jsonb_build_object(
          'kind',            'public_board',
          'slug',            p.first_source->>'public_slug',
          'board_id',        pb.board_id,
          'board_title',     b3.name,
          'shared_by_email', su2.email::text,
          'cohort_signups',  (select count(*) from public.profiles p3
                               where p3.first_source->>'public_slug' = p.first_source->>'public_slug')
        )
        from public.public_boards pb
        left join public.boards b3 on b3.id = pb.board_id
        left join auth.users su2 on su2.id = pb.created_by
        where pb.slug = p.first_source->>'public_slug'
        limit 1
      )
      else null
    end as info
  ) sh on true
  left join lateral (
    select (select jsonb_object_agg(substr(k, 4), val)
              from jsonb_each_text(e.props) kv(k, val)
             where starts_with(k, 'lt_') and k <> 'lt_last_touch_at') as bag,
           e.props->>'lt_last_touch_at' as touched_at
    from public.analytics_events e
    where e.user_id = u.id and e.props ? 'lt_last_touch_at'
    order by e.occurred_at desc
    limit 1
  ) lt on true
  where u.id = p_user_id;

  if v_out is null then
    raise exception 'user not found: %', p_user_id using errcode = 'P0002';
  end if;

  return v_out;
end $function$;

-- ── 10. Restate the days that were captured early ───────────────────────────
--
-- Only what can be derived for a past day: verified signups created that day
-- (admin_signups_by_day's rule), and active users from the first day
-- user_active_day recorded. MRR and the tier counts were snapshots and stay
-- what they were.

update public.metrics_daily m
   set signups = (select count(*) from auth.users u
                   where u.email_confirmed_at is not null and u.last_sign_in_at is not null
                     and u.created_at >= m.day and u.created_at < m.day + 1)::int
 where m.day < current_date;

update public.metrics_daily m
   set active_users = (select count(*) from public.user_active_day a where a.day = m.day)::int
 where m.day < current_date
   and m.day >= (select min(a.day) from public.user_active_day a);

-- ── 11. Reads for Analytics › Overview ──────────────────────────────────────
--
-- All three draw their people from _admin_people (0372), the population
-- admin_weekly_series counts, so a lifetime total, a weekly bar and a tile
-- strip are always about the same people. Things — workspaces, clusters,
-- cards — follow only the Internal toggle and are judged by who made them,
-- as admin_cards_per_day judges a card by its cluster's creator.

create or replace function public.admin_lifetime_totals(
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'users',          (select count(*) from public._admin_people(p_exclude_internal, p_verified_only)),
    'workspaces',     (select count(*) from public.workspaces w
                        where not p_exclude_internal or w.created_by is null
                           or w.created_by not in (select iu.user_id from public._internal_user_ids() iu)),
    'clusters_made',  (select count(*) from public.boards b
                        where b.deleted_at is null and b.parent_board_id is not null
                          and (not p_exclude_internal or b.created_by is null
                               or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))),
    'studios',        (select count(*) from public.boards b
                        where b.deleted_at is null and b.parent_board_id is null
                          and (not p_exclude_internal or b.created_by is null
                               or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))),
    -- Cards that still exist: on a live cluster.
    'cards',          (select count(*) from public.card_index ci
                         join public.boards b on b.id = ci.board_id
                        where b.deleted_at is null
                          and (not p_exclude_internal or b.created_by is null
                               or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))),
    'seconds_in_app', (select coalesce(sum(pr.seconds_in_app), 0)
                         from public.profiles pr
                         join public._admin_people(p_exclude_internal, p_verified_only) pe on pe.user_id = pr.user_id)
  );
end $function$;

-- The newest signups and what they did, including work in someone else's
-- workspace: an invitee who built in the cluster they were invited to used to
-- read "nothing yet".
create or replace function public.admin_recent_signups(
  p_limit integer default 8,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
returns table(user_id uuid, email text, created_at timestamp with time zone, acquisition_source text,
              first_card_at timestamp with time zone, card_count integer, guest_cards integer, clusters_made integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_limit := greatest(1, least(coalesce(p_limit, 8), 50));
  return query
  select pe.user_id,
         u.email::text,
         pe.created_at,
         public.derive_acquisition_channel(pr.first_source),
         pr.first_card_at,
         coalesce(occ.live_cards, 0)::int,
         coalesce(occ.guest_cards, 0)::int,
         (select count(*)::int from public.boards b
           where b.created_by = pe.user_id and b.deleted_at is null and b.parent_board_id is not null)
    from public._admin_people(p_exclude_internal, p_verified_only) pe
    join auth.users u on u.id = pe.user_id
    left join public.profiles pr on pr.user_id = pe.user_id
    left join public._owner_card_counts occ on occ.user_id = pe.user_id
   order by pe.created_at desc
   limit p_limit;
end $function$;

-- One row per UTC week since launch. Every column of admin_weekly_series,
-- computed the same way, so the long charts and the tile strips can never
-- disagree, then the long-run additions. Running totals count what still
-- exists: an account deleted since, or a card on a cluster trashed since, is
-- gone from every past week too.
create or replace function public.admin_growth_series(
  p_weeks integer default 104,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
returns table(
  week_start date, complete boolean, settling boolean,
  signups integer, active_users integer, active_measurable boolean,
  work_users integer, work_measurable boolean, cards integer,
  active_floor date, work_floor date,
  users_total integer, new_active integer, returning_active integer,
  clusters_made integer, cards_total integer,
  day_one_n integer, day_one_activated integer, day_one_complete boolean,
  seconds_in_app bigint, seconds_measurable boolean, seconds_floor date
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_weeks         int;
  v_this          date;
  v_launch        date;
  v_first         date;
  v_active_floor  date;
  v_work_floor    date;
  v_seconds_floor date;
begin
  perform public._require_admin();

  v_weeks         := least(greatest(coalesce(p_weeks, 104), 2), 260);
  v_this          := date_trunc('week', current_date)::date;
  v_launch        := date_trunc('week', ((select min(u.created_at) from auth.users u) at time zone 'utc'))::date;
  v_first         := greatest(v_this - (v_weeks - 1) * 7, coalesce(v_launch, v_this));
  -- Derived floors, as in 0372: each series starts the first day it was
  -- recorded. Seconds per day start with this migration.
  v_active_floor  := (select min(a.day) from public.user_active_day a);
  v_work_floor    := (select min(a.day) from public.user_active_day a where a.did_work);
  v_seconds_floor := (select min(a.day) from public.user_active_day a where a.seconds > 0);

  return query
  with
  people as (select * from public._admin_people(p_exclude_internal, p_verified_only)),
  weeks as (
    select g::date as wk
      from generate_series(v_first, v_this, interval '7 days') g
  ),
  -- Every week since the first account, so the running total starts at zero.
  su as (
    select date_trunc('week', (p.created_at at time zone 'utc'))::date as wk,
           count(*)::int as n
      from people p
     group by 1
  ),
  act as (
    select date_trunc('week', a.day)::date as wk,
           count(distinct a.user_id)::int as active_n,
           (count(distinct a.user_id) filter (where a.did_work))::int as work_n,
           -- New: here the week they signed up. Returning: signed up before it.
           (count(distinct a.user_id) filter (
              where date_trunc('week', (p.created_at at time zone 'utc'))::date = date_trunc('week', a.day)::date
           ))::int as new_n,
           coalesce(sum(a.seconds), 0)::bigint as secs
      from public.user_active_day a
      join people p on p.user_id = a.user_id
     where a.day >= v_first
     group by 1
  ),
  -- card-count-lint: activity — admin_weekly_series' cards, verbatim: a card
  -- made in a cluster deleted since was still made that week.
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
  ),
  -- Cards that still exist, by the week they were made: the running total.
  cl as (
    select date_trunc('week', (ci.created_at at time zone 'utc'))::date as wk,
           count(*)::int as n
      from public.card_index ci
      join public.boards b on b.id = ci.board_id
     where b.deleted_at is null
       and (not p_exclude_internal
            or b.created_by is null
            or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))
     group by 1
  ),
  -- Clusters people made: never a Studio, and still made that week if
  -- trashed since, like cards.
  cm as (
    select date_trunc('week', (b.created_at at time zone 'utc'))::date as wk,
           count(*)::int as n
      from public.boards b
     where b.parent_board_id is not null
       and b.created_at >= v_first
       and (not p_exclude_internal
            or b.created_by is null
            or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))
     group by 1
  ),
  -- Day one, by signup week: of the signups at least a day old, how many
  -- placed a card within 24 hours.
  d1 as (
    select date_trunc('week', (p.created_at at time zone 'utc'))::date as wk,
           (count(*) filter (where p.created_at <= now() - interval '24 hours'))::int as n,
           (count(*) filter (where p.created_at <= now() - interval '24 hours'
                               and pr.first_card_at is not null
                               and pr.first_card_at <= p.created_at + interval '24 hours'))::int as made
      from people p
      left join public.profiles pr on pr.user_id = p.user_id
     where p.created_at >= v_first
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
         v_work_floor,
         (select coalesce(sum(s2.n), 0) from su s2 where s2.wk <= w.wk)::int,
         case when v_active_floor is null or w.wk < v_active_floor then null
              else coalesce(act.new_n, 0) end,
         case when v_active_floor is null or w.wk < v_active_floor then null
              else coalesce(act.active_n, 0) - coalesce(act.new_n, 0) end,
         coalesce(cm.n, 0),
         (select coalesce(sum(c2.n), 0) from cl c2 where c2.wk <= w.wk)::int,
         coalesce(d1.n, 0),
         coalesce(d1.made, 0),
         now() >= ((w.wk + 8)::timestamp at time zone 'utc'),
         case when v_seconds_floor is null or w.wk < v_seconds_floor then null
              else coalesce(act.secs, 0) end,
         not (v_seconds_floor is null or w.wk < v_seconds_floor),
         v_seconds_floor
    from weeks w
    left join su  on su.wk  = w.wk
    left join act on act.wk = w.wk
    left join ca  on ca.wk  = w.wk
    left join cm  on cm.wk  = w.wk
    left join d1  on d1.wk  = w.wk
   order by w.wk;
end;
$function$;

-- ── 12. Grants, and proof of them (the 0311 habit) ──────────────────────────

revoke execute on function public._admin_made_something() from public, anon, authenticated;
grant execute on function public._admin_made_something() to service_role;

revoke execute on function public.capture_metrics_daily(date) from public, anon, authenticated;
grant execute on function public.capture_metrics_daily(date) to service_role;

revoke execute on function public.admin_active_now(integer, boolean) from public, anon;
grant execute on function public.admin_active_now(integer, boolean) to authenticated, service_role;
revoke execute on function public.admin_signups_by_day(integer, boolean, boolean) from public, anon;
grant execute on function public.admin_signups_by_day(integer, boolean, boolean) to authenticated, service_role;
revoke execute on function public.admin_acquisition_channels(text, text) from public, anon;
grant execute on function public.admin_acquisition_channels(text, text) to authenticated, service_role;
revoke execute on function public.admin_lifetime_totals(boolean, boolean) from public, anon;
grant execute on function public.admin_lifetime_totals(boolean, boolean) to authenticated, service_role;
revoke execute on function public.admin_recent_signups(integer, boolean, boolean) from public, anon;
grant execute on function public.admin_recent_signups(integer, boolean, boolean) to authenticated, service_role;
revoke execute on function public.admin_growth_series(integer, boolean, boolean) from public, anon;
grant execute on function public.admin_growth_series(integer, boolean, boolean) to authenticated, service_role;

do $proof$
declare
  r record;
begin
  -- The retired signatures are out of PostgREST's way, and out of reach.
  for r in
    select * from (values
      ('public.admin_active_now(integer)'),
      ('public.admin_signups_by_day(integer,boolean)'),
      ('public.admin_acquisition_channels(text)'),
      ('public.capture_metrics_daily()')
    ) as t(sig)
  loop
    if to_regprocedure(r.sig) is not null then
      raise exception '0460: % is still there beside its replacement', r.sig;
    end if;
  end loop;
  for r in
    select * from (values
      ('public.admin_active_now_0101(integer)'),
      ('public.admin_signups_by_day_0149(integer,boolean)'),
      ('public.admin_acquisition_channels_0159(text)'),
      ('public.capture_metrics_daily_0332()')
    ) as t(sig)
  loop
    if has_function_privilege('anon', r.sig, 'execute')
       or has_function_privilege('authenticated', r.sig, 'execute') then
      raise exception '0460: the retired % is still callable', r.sig;
    end if;
  end loop;

  -- Admin reads: callable signed in (each checks _require_admin), never anon.
  for r in
    select * from (values
      ('public.admin_active_now(integer,boolean)'),
      ('public.admin_signups_by_day(integer,boolean,boolean)'),
      ('public.admin_acquisition_channels(text,text)'),
      ('public.admin_lifetime_totals(boolean,boolean)'),
      ('public.admin_recent_signups(integer,boolean,boolean)'),
      ('public.admin_growth_series(integer,boolean,boolean)'),
      ('public.admin_universe_stats()'),
      ('public.admin_universe_snapshot_v2(timestamptz,text,integer)'),
      ('public.admin_universe_edges_v2(timestamptz,text,integer)'),
      ('public.admin_list_users(integer,integer,text,text,text,text,text,text,text,text)'),
      ('public.admin_user_count(text,text,text,text,text,text,text)'),
      ('public.admin_share_signups(integer)'),
      ('public.admin_user_detail(uuid)')
    ) as t(sig)
  loop
    if has_function_privilege('anon', r.sig, 'execute')
       or not has_function_privilege('authenticated', r.sig, 'execute')
       or not has_function_privilege('service_role', r.sig, 'execute') then
      raise exception '0460: grants are wrong on %', r.sig;
    end if;
  end loop;

  -- Internal: no client role at all.
  for r in
    select * from (values
      ('public._admin_made_something()'),
      ('public.capture_metrics_daily(date)')
    ) as t(sig)
  loop
    if has_function_privilege('anon', r.sig, 'execute')
       or has_function_privilege('authenticated', r.sig, 'execute')
       or not has_function_privilege('service_role', r.sig, 'execute') then
      raise exception '0460: % must be callable by service_role only', r.sig;
    end if;
  end loop;

  -- The heartbeat keeps the grant it had.
  if not has_function_privilege('authenticated', 'public.bump_seconds_in_app(integer,uuid,uuid,boolean)', 'execute') then
    raise exception '0460: the heartbeat lost its grant';
  end if;

  -- The nightly capture closes yesterday.
  if not exists (select 1 from cron.job
                  where jobname = 'capture_metrics_daily'
                    and command like '%capture_metrics_daily(current_date - 1)%') then
    raise exception '0460: capture_metrics_daily is not closing yesterday';
  end if;
end $proof$;

notify pgrst, 'reload schema';

commit;
