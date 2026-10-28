-- 0746 — Sharing on the Users list (sharing insight, Phase 2).
--
-- The Users list can show only the people who share, sort by the people they
-- reached, and mark each row; each row also carries the workspaces the person
-- is in, with the cards in each (the owner's ask of 10-28: "workspace level
-- card counters to peoples user cards").
--
--   1. _admin_user_sharing_marks(): one row per account, from 0744's ledger
--      (no views: the list needs people, not devices) and _admin_brought_in():
--        shared_n    shares made (a workspace link once copied, as 0745 counts)
--        brought_n   accounts brought in (new_account)
--        reach_n     accounts that got in or signed up through them: people,
--                    so the sort reads "Most people reached"
--        came        brought in by a share, an invitation or a referral
--        brought_by  who brought them in (rank 1's sharer)
--        works_with  in a workspace or a cluster with another account that
--                    isn't banned
--      Banned rows are left out; a workspace add nobody recorded credits
--      nobody. Closed to clients.
--   2. admin_list_users and admin_user_count take p_sharing ('all', 'shared',
--      'brought', 'came', 'works_with'); the list sorts by 'reach' too and
--      returns shared_n, brought_n, reach_n, brought_by_email, workspaces_n and
--      workspace_cards (the three with the most cards: workspace_id, name,
--      role, cards). Both bodies are the live ones (0462's list, 0461's count;
--      md5 ee70d2c55feb70b3426b7f780572a4b8 and d8144c00cb1e225c6c5f5c066abb37e8
--      as read before applying) with only those lines added. A new argument is
--      a new function, so the old ones are renamed and closed, as 0460 did:
--      the admin on production names the old ten and seven arguments, which
--      the new ones take with p_sharing defaulted.
--   3. admin_user_workspaces(user): every workspace a person is in, with its
--      cards, for the profile's header.
--   4. admin_user_sharing (0745) leaves an add nobody recorded out of a
--      person's own sharing, as the list does; one line changed.
--
-- Cards are card_index weights on live clusters, the unit _owner_card_counts
-- counts (card_index is written by the client: the count is advisory).

begin;

set local lock_timeout = '3s';

-- ── 1. The marks ─────────────────────────────────────────────────────────────
create or replace function public._admin_user_sharing_marks()
returns table (user_id uuid, shared_n int, brought_n int, reach_n int,
               came boolean, brought_by uuid, works_with boolean)
language sql stable security definer
set search_path = 'public'
set plan_cache_mode = 'force_custom_plan'
set work_mem = '32MB'
as $$
  with
  banned as (select p.user_id from public.profiles p where p.banned_at is not null),
  l as (
    select * from public._admin_share_ledger(null, false, false, null) r
     where not r.banned and r.sharer_id is not null and r.sharer_recorded
  ),
  s as (
    select l.sharer_id as uid,
           (count(*) filter (where (l.fact = 'shared' and l.route <> 'workspace_link')
                                or (l.fact = 'copied' and l.route = 'workspace_link')))::int as shared_n,
           (count(distinct l.recipient_id) filter (where l.fact = 'new_account'))::int as brought_n,
           (count(distinct l.recipient_id) filter (where l.fact in ('joined', 'new_account')
                                                     and l.recipient_id <> l.sharer_id))::int as reach_n
      from l
     group by l.sharer_id
  ),
  bi as (
    select b.user_id as uid, b.sharer_id from public._admin_brought_in() b where b.rank = 1
  ),
  ww as (
    select a.user_id as uid
      from public.workspace_members a
      join public.workspace_members o on o.workspace_id = a.workspace_id and o.user_id <> a.user_id
     where o.user_id not in (select banned.user_id from banned)
    union
    select s.user_id
      from public.board_shares s
      join public.boards bd on bd.id = s.board_id and bd.deleted_at is null
      join public.workspace_members o on o.workspace_id = bd.workspace_id and o.user_id <> s.user_id
     where o.user_id not in (select banned.user_id from banned)
    union
    select o.user_id
      from public.board_shares s
      join public.boards bd on bd.id = s.board_id and bd.deleted_at is null
      join public.workspace_members o on o.workspace_id = bd.workspace_id and o.user_id <> s.user_id
     where s.user_id not in (select banned.user_id from banned)
  )
  select u.id, coalesce(s.shared_n, 0), coalesce(s.brought_n, 0), coalesce(s.reach_n, 0),
         bi.uid is not null, bi.sharer_id, ww.uid is not null
    from auth.users u
    left join s  on s.uid = u.id
    left join bi on bi.uid = u.id
    left join ww on ww.uid = u.id;
$$;

revoke execute on function public._admin_user_sharing_marks() from public, anon, authenticated;

-- ── 2. The list and its count ────────────────────────────────────────────────
alter function public.admin_list_users(integer, integer, text, text, text, text, text, text, text, text) rename to admin_list_users_0462;
revoke execute on function public.admin_list_users_0462(integer, integer, text, text, text, text, text, text, text, text) from public, anon, authenticated;
alter function public.admin_user_count(text, text, text, text, text, text, text) rename to admin_user_count_0461;
revoke execute on function public.admin_user_count_0461(text, text, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.admin_list_users(p_limit integer default 50, p_offset integer default 0, p_query text default null, p_tier text default null, p_sort text default 'recent', p_status text default null, p_source text default null, p_contacted text default null, p_verification text default 'verified', p_activity text default 'all', p_sharing text default 'all')
returns table (user_id uuid, email text, tier text, card_count integer, seconds_in_app bigint, created_at timestamptz, last_sign_in_at timestamptz, subscription_plan text, subscription_status text, current_period_end timestamptz, subscription_amount_cents integer, subscription_discounted boolean, banned boolean, joined_waitlist boolean, display_name text, avatar_url text, color text, last_seen_at timestamptz, board_count integer, acquisition_source text, last_reached_out_at timestamptz, outreach_count integer, email_confirmed boolean, storage_bytes bigint, country text, last_worked_at timestamptz, shared_n integer, brought_n integer, reach_n integer, brought_by_email text, workspaces_n integer, workspace_cards jsonb)
language plpgsql stable security definer set search_path = public
set plan_cache_mode = 'force_custom_plan'
set work_mem = '32MB'
as $function$
declare
  v_sh text := lower(coalesce(nullif(trim(p_sharing), ''), 'all'));
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
  -- 0746: what each person shared and who it reached (_admin_user_sharing_marks),
  -- and the workspaces they're in with the cards in each, the most first.
  marks as (
    select * from public._admin_user_sharing_marks()
  ),
  ws_live as (
    select b.workspace_id, coalesce(sum(ci.weight), 0)::int as cards
    from public.boards b left join public.card_index ci on ci.board_id = b.id
    where b.deleted_at is null
    group by b.workspace_id
  ),
  member_ws as (
    select x.uid, count(*)::int as workspaces_n,
           jsonb_agg(jsonb_build_object('workspace_id', x.workspace_id, 'name', x.name, 'role', x.role, 'cards', x.cards)
                     order by x.rn) filter (where x.rn <= 3) as workspace_cards
    from (select m.user_id as uid, m.workspace_id, w.name, m.role, coalesce(wl.cards, 0) as cards,
                 row_number() over (partition by m.user_id order by coalesce(wl.cards, 0) desc, w.name, m.workspace_id) as rn
          from public.workspace_members m
          join public.workspaces w on w.id = m.workspace_id
          left join ws_live wl on wl.workspace_id = m.workspace_id) x
    group by x.uid
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
      (u.id in (select ec.entered_id from public._admin_entered_code() ec)) as email_confirmed, coalesce(ostor.bytes, 0)::bigint as storage_bytes,
      nullif(p.country, '') as country,
      greatest(oc.last_card_at, we.last_ev_at) as last_worked_at,
      coalesce(mk.shared_n, 0)::int as shared_n, coalesce(mk.brought_n, 0)::int as brought_n,
      coalesce(mk.reach_n, 0)::int as reach_n, bu.email::text as brought_by_email,
      coalesce(mw.workspaces_n, 0)::int as workspaces_n, coalesce(mw.workspace_cards, '[]'::jsonb) as workspace_cards
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.subscriptions s on s.user_id = u.id
    left join public.user_presence pr on pr.user_id = u.id
    left join owner_cards oc on oc.uid = u.id
    left join owner_counts occ on occ.uid = u.id
    left join owner_boards ob on ob.uid = u.id
    left join owner_storage ostor on ostor.uid = u.id
    left join work_ev we on we.uid = u.id
    left join marks mk on mk.user_id = u.id
    left join auth.users bu on bu.id = mk.brought_by
    left join member_ws mw on mw.uid = u.id
    left join lateral (
      select max(o.reached_at) as last_reached_out_at, count(*)::int as outreach_count
      from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)
    ) ox on true
    where (case v_v
             when 'verified'   then (u.id in (select ec.entered_id from public._admin_entered_code() ec))
             when 'unverified' then (u.id not in (select ec.entered_id from public._admin_entered_code() ec))
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
    -- 0746: the Sharing filter, from the marks every row carries.
    and (case v_sh
           when 'shared'     then base.user_id in (select mk.user_id from marks mk where mk.shared_n > 0)
           when 'brought'    then base.user_id in (select mk.user_id from marks mk where mk.brought_n > 0)
           when 'came'       then base.user_id in (select mk.user_id from marks mk where mk.came)
           when 'works_with' then base.user_id in (select mk.user_id from marks mk where mk.works_with)
           else true end)
  order by
    case when v_k = 'recent' then base.created_at end desc nulls last,
    case when v_k = 'active' then base.last_seen_at end desc nulls last,
    case when v_k = 'worked' then base.last_worked_at end desc nulls last,
    case when v_k = 'cards'  then base.card_count end desc nulls last,
    case when v_k = 'spend'  then base.subscription_amount_cents end desc nulls last,
    case when v_k = 'reach'  then base.reach_n end desc nulls last,
    case when v_k = 'reach'  then base.shared_n end desc nulls last,
    case when v_k = 'name'   then lower(coalesce(base.display_name, base.email)) end asc nulls last,
    base.created_at desc nulls last
  limit p_limit offset p_offset;
end $function$;

create or replace function public.admin_user_count(p_query text default null, p_tier text default null, p_status text default null, p_source text default null, p_contacted text default null, p_verification text default 'verified', p_activity text default 'all', p_sharing text default 'all')
returns bigint
language plpgsql stable security definer set search_path = public
set plan_cache_mode = 'force_custom_plan'
set work_mem = '32MB'
as $function$
declare
  v_sh text := lower(coalesce(nullif(trim(p_sharing), ''), 'all'));
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
  with marks as (
    select * from public._admin_user_sharing_marks()
  ),
  base as (
    select public.derive_acquisition_channel(p.first_source) as acquisition_source
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.subscriptions s on s.user_id = u.id
    where (case v_v
             when 'verified'   then (u.id in (select ec.entered_id from public._admin_entered_code() ec))
             when 'unverified' then (u.id not in (select ec.entered_id from public._admin_entered_code() ec))
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
      -- 0746: the Sharing filter, from the marks every row carries.
      and (case v_sh
             when 'shared'     then u.id in (select mk.user_id from marks mk where mk.shared_n > 0)
             when 'brought'    then u.id in (select mk.user_id from marks mk where mk.brought_n > 0)
             when 'came'       then u.id in (select mk.user_id from marks mk where mk.came)
             when 'works_with' then u.id in (select mk.user_id from marks mk where mk.works_with)
             else true end)
  )
  select count(*) into v_n from base where (v_o is null or base.acquisition_source = v_o);
  return v_n;
end $function$;

revoke execute on function public.admin_list_users(integer, integer, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_list_users(integer, integer, text, text, text, text, text, text, text, text, text) to authenticated, service_role;
revoke execute on function public.admin_user_count(text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_user_count(text, text, text, text, text, text, text, text) to authenticated, service_role;

-- ── 3. A person's workspaces ─────────────────────────────────────────────────
create or replace function public.admin_user_workspaces(p_user_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = 'public'
as $fn$
declare
  v_out jsonb;
begin
  perform public._require_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
           'workspace_id', x.workspace_id, 'name', x.name, 'role', x.role, 'joined_at', x.joined_at,
           'owner_id', x.owner_id, 'cards', x.cards, 'clusters', x.clusters, 'members', x.members)
           order by x.cards desc, x.name, x.workspace_id), '[]'::jsonb)
    into v_out
    from (select m.workspace_id, w.name, m.role, m.created_at as joined_at, w.created_by as owner_id,
                 (select coalesce(sum(ci.weight), 0)::int
                    from public.boards b join public.card_index ci on ci.board_id = b.id
                   where b.workspace_id = m.workspace_id and b.deleted_at is null) as cards,
                 (select count(*)::int from public.boards b
                   where b.workspace_id = m.workspace_id and b.deleted_at is null and b.parent_board_id is not null) as clusters,
                 (select count(*)::int from public.workspace_members o where o.workspace_id = m.workspace_id) as members
            from public.workspace_members m
            join public.workspaces w on w.id = m.workspace_id
           where m.user_id = p_user_id) x;
  return v_out;
end
$fn$;

revoke execute on function public.admin_user_workspaces(uuid) from public, anon;
grant execute on function public.admin_user_workspaces(uuid) to authenticated;

-- ── 4. A person's own sharing leaves out an add nobody recorded ──────────────
create or replace function public.admin_user_sharing(p_user_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = 'public'
set plan_cache_mode = 'force_custom_plan'
set work_mem = '32MB'
as $fn$
declare
  v_out jsonb;
begin
  perform public._require_admin();
  if p_user_id is null then
    return null;
  end if;

  with
  raw as materialized (
    select * from public._admin_share_ledger(null, false, true, p_user_id)
  ),
  l as materialized (
    select * from raw r
     where not r.banned
       and not (r.fact = 'shared' and r.route = 'workspace_link')
  ),
  -- 0746: a workspace add with no recorded adder credits nobody, as on the Users list.
  mine as materialized (select * from l where l.sharer_id = p_user_id and l.sharer_recorded),
  theirs as materialized (
    select * from l where l.recipient_id = p_user_id and l.sharer_id is distinct from p_user_id
  ),
  bi_all as materialized (select * from public._admin_brought_in()),
  bi as (select b.* from bi_all b where b.user_id = p_user_id),
  bi1 as (select * from bi where bi.rank = 1),
  -- How many accounts the share that brought them in brought in, them included.
  bi_same as (
    select count(*)::int as n
      from bi_all b
     where b.rank = 1 and b.edge_key = (select bi1.edge_key from bi1)
  ),
  ppl as materialized (
    select * from public._admin_share_people(array(
      select x.sharer_id from l x where x.sharer_id is not null
      union select x.recipient_id from l x where x.recipient_id is not null
      union select bi1.sharer_id from bi1 where bi1.sharer_id is not null))
  ),
  names as materialized (
    select * from public._admin_share_object_names(
      array(select x.object_kind from l x union all select bi1.object_kind from bi1),
      array(select x.object_id from l x union all select bi1.object_id from bi1))
  ),
  -- What they shared, one row per object.
  obj as (
    select m.object_kind, m.object_id,
           min(m.at) as first_at, max(m.at) as last_at,
           count(*) filter (where m.fact = 'shared' or (m.fact = 'copied' and m.route = 'workspace_link')) as shares,
           count(*) filter (where m.fact = 'copied') as copies,
           count(distinct m.device_id) filter (where m.fact = 'viewed') as seen,
           count(distinct m.device_id) filter (where m.fact = 'viewed' and m.route = 'view_link') as seen_view,
           count(distinct m.device_id) filter (where m.fact = 'viewed' and m.route = 'edit_link') as seen_edit,
           count(distinct m.recipient_id) filter (where m.fact = 'new_account') as signed_up,
           count(distinct m.recipient_id) filter (where m.fact = 'made_something') as made_something,
           count(distinct m.recipient_id) filter (where m.fact = 'joined') as got_in,
           count(distinct m.recipient_id) filter (where m.fact = 'co_created') as co_creating,
           count(*) filter (where m.fact = 'shared' and m.route = 'email_invite' and m.state = 'pending') as waiting,
           max(m.at) filter (where m.fact in ('viewed', 'joined', 'new_account', 'made_something', 'co_created')) as last_outcome_at
      from mine m
     where m.object_id is not null and m.fact <> 'opened_panel'
     group by m.object_kind, m.object_id
  ),
  obj_routes as (
    select m.object_kind, m.object_id,
           jsonb_object_agg(m.route, jsonb_build_object(
             'shares', m.shares, 'copies', m.copies, 'live', m.live, 'first_at', m.first_at, 'last_at', m.last_at)) as routes
      from (select m.object_kind, m.object_id, m.route,
                   count(*) filter (where m.fact = 'shared' or (m.fact = 'copied' and m.route = 'workspace_link')) as shares,
                   count(*) filter (where m.fact = 'copied') as copies,
                   count(*) filter (where m.fact = 'shared' and m.state = 'live') as live,
                   min(m.at) as first_at, max(m.at) as last_at
              from mine m
             where m.object_id is not null and m.route is not null
               and m.fact in ('shared', 'copied', 'viewed', 'joined', 'new_account')
             group by 1, 2, 3) m
     group by 1, 2
  ),
  obj_people as (
    select q.object_kind, q.object_id,
           jsonb_agg(jsonb_build_object(
             'user_id', q.recipient_id, 'email', p.email, 'name', p.name,
             'got_in', q.got_in, 'signed_up', q.signed_up,
             'made_something', q.made_something, 'co_creating', q.co_creating, 'at', q.at)
             order by q.at) as people
      from (select m.object_kind, m.object_id, m.recipient_id, min(m.at) as at,
                   bool_or(m.fact = 'joined') as got_in, bool_or(m.fact = 'new_account') as signed_up,
                   bool_or(m.fact = 'made_something') as made_something, bool_or(m.fact = 'co_created') as co_creating
              from mine m
             where m.object_id is not null and m.recipient_id is not null
               and m.fact in ('joined', 'new_account', 'made_something', 'co_created')
             group by 1, 2, 3) q
      left join ppl p on p.user_id = q.recipient_id
     group by 1, 2
  ),
  obj_ranked as (
    select o.*, row_number() over (order by coalesce(o.last_outcome_at, o.last_at) desc, o.object_id) as rn
      from obj o
  ),
  -- Everyone who got in or signed up through them.
  people as (
    select q.recipient_id,
           min(q.at) as first_at,
           bool_or(q.fact = 'joined') as got_in, bool_or(q.fact = 'new_account') as signed_up,
           bool_or(q.fact = 'made_something') as made_something, bool_or(q.fact = 'co_created') as co_creating,
           jsonb_agg(jsonb_build_object(
             'fact', q.fact, 'route', q.route, 'at', q.at,
             'object_kind', q.object_kind, 'object_id', q.object_id, 'title', n.title, 'deleted', n.deleted)
             order by q.at) filter (where q.fact in ('joined', 'new_account')) as via
      from mine q
      left join names n on n.object_kind = q.object_kind and n.object_id = q.object_id
     where q.recipient_id is not null and q.recipient_id <> p_user_id
       and q.fact in ('joined', 'new_account', 'made_something', 'co_created')
     group by q.recipient_id
  ),
  waiting as (
    select m.recipient_email, m.at, m.object_kind, m.object_id
      from mine m
     where m.fact = 'shared' and m.route = 'email_invite' and m.state = 'pending'
  ),
  -- What others shared with them.
  with_them as (
    select t.object_kind, t.object_id, t.sharer_id, t.route,
           bool_and(t.sharer_recorded) as recorded,
           min(t.at) as at,
           bool_or(t.fact = 'joined') as got_in, bool_or(t.fact = 'new_account') as signed_up,
           bool_or(t.fact = 'made_something') as made_something, bool_or(t.fact = 'co_created') as co_creating,
           max(t.state) filter (where t.fact in ('shared', 'joined')) as state
      from theirs t
     where t.fact in ('shared', 'joined', 'new_account', 'made_something', 'co_created')
     group by 1, 2, 3, 4
  )
  select jsonb_build_object(
    'user_id', p_user_id,
    'brought_in', (
      select jsonb_build_object(
               'route', b.route, 'at', b.at, 'evidence', b.evidence, 'state', b.state,
               'link_key', b.link_key,
               'by', case when b.sharer_id is null then null else jsonb_build_object(
                        'user_id', b.sharer_id, 'email', p.email, 'name', p.name) end,
               'via', case when b.object_id is null then null else jsonb_build_object(
                        'kind', b.object_kind, 'id', b.object_id, 'title', n.title, 'deleted', coalesce(n.deleted, true)) end,
               'same_share_brought', (select s.n from bi_same s),
               'other_routes', coalesce((select jsonb_agg(distinct o.route) from bi o where o.rank > 1 and o.route is distinct from b.route), '[]'::jsonb))
        from bi1 b
        left join ppl p on p.user_id = b.sharer_id
        left join names n on n.object_kind = b.object_kind and n.object_id = b.object_id),
    'totals', (
      select jsonb_build_object(
               'objects', (select count(*) from obj o where o.shares > 0),
               'clusters', (select count(*) from obj o where o.shares > 0 and o.object_kind = 'cluster'),
               'workspaces', (select count(*) from obj o where o.shares > 0 and o.object_kind = 'workspace'),
               'files', (select count(*) from obj o where o.shares > 0 and o.object_kind = 'file'),
               'shares', count(*) filter (where m.fact = 'shared' or (m.fact = 'copied' and m.route = 'workspace_link')),
               'devices', count(distinct m.device_id) filter (where m.fact = 'viewed'),
               'got_in', count(distinct m.recipient_id) filter (where m.fact = 'joined'),
               'signed_up', count(distinct m.recipient_id) filter (where m.fact = 'new_account'),
               'made_something', count(distinct m.recipient_id) filter (where m.fact = 'made_something'),
               'co_creating', count(distinct m.recipient_id) filter (where m.fact = 'co_created'),
               'panel_opens', count(*) filter (where m.fact = 'opened_panel'),
               'copies', count(*) filter (where m.fact = 'copied'),
               'last_copy_at', max(m.at) filter (where m.fact = 'copied'),
               'shares_by_route', coalesce((select jsonb_object_agg(r.route, r.n) from (
                   select x.route, count(*) as n from mine x
                    where x.fact = 'shared' or (x.fact = 'copied' and x.route = 'workspace_link')
                    group by x.route) r), '{}'::jsonb),
               'copies_by_route', coalesce((select jsonb_object_agg(r.route, r.n) from (
                   select x.route, count(*) as n from mine x where x.fact = 'copied' group by x.route) r), '{}'::jsonb),
               'opens_by_surface', coalesce((select jsonb_object_agg(r.ev, r.n) from (
                   select coalesce(x.evidence, 'unknown') as ev, count(*) as n from mine x
                    where x.fact = 'opened_panel' group by 1) r), '{}'::jsonb))
        from mine m),
    'objects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', o.object_kind, 'id', o.object_id, 'title', n.title, 'deleted', coalesce(n.deleted, true),
               'first_at', o.first_at, 'last_at', o.last_at, 'last_outcome_at', o.last_outcome_at,
               'shares', o.shares, 'copies', o.copies,
               'seen', o.seen, 'seen_view_link', o.seen_view, 'seen_edit_link', o.seen_edit,
               'signed_up', o.signed_up, 'made_something', o.made_something,
               'got_in', o.got_in, 'co_creating', o.co_creating, 'waiting', o.waiting,
               'routes', coalesce(r.routes, '{}'::jsonb),
               'people', coalesce(pp.people, '[]'::jsonb))
             order by o.rn)
        from obj_ranked o
        left join names n on n.object_kind = o.object_kind and n.object_id = o.object_id
        left join obj_routes r on r.object_kind = o.object_kind and r.object_id = o.object_id
        left join obj_people pp on pp.object_kind = o.object_kind and pp.object_id = o.object_id
       where o.rn <= 100), '[]'::jsonb),
    'objects_more', (select greatest(count(*) - 100, 0) from obj),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', q.recipient_id, 'email', p.email, 'name', p.name, 'first_at', q.first_at,
               'got_in', q.got_in, 'signed_up', q.signed_up,
               'made_something', q.made_something, 'co_creating', q.co_creating,
               'via', coalesce(q.via, '[]'::jsonb))
             order by q.first_at desc)
        from people q
        left join ppl p on p.user_id = q.recipient_id), '[]'::jsonb),
    'waiting', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', w.recipient_email, 'at', w.at,
               'object_kind', w.object_kind, 'object_id', w.object_id, 'title', n.title)
             order by w.at desc)
        from (select * from waiting order by at desc limit 20) w
        left join names n on n.object_kind = w.object_kind and n.object_id = w.object_id), '[]'::jsonb),
    'waiting_n', (select count(*) from waiting),
    'with_them', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', t.object_kind, 'id', t.object_id, 'title', n.title, 'deleted', coalesce(n.deleted, true),
               'route', t.route, 'at', t.at, 'state', t.state, 'recorded', t.recorded,
               'by', case when t.sharer_id is null then null else jsonb_build_object(
                        'user_id', t.sharer_id, 'email', p.email, 'name', p.name) end,
               'got_in', t.got_in, 'signed_up', t.signed_up,
               'made_something', t.made_something, 'co_creating', t.co_creating)
             order by t.at desc)
        from (select * from with_them order by at desc limit 100) t
        left join ppl p on p.user_id = t.sharer_id
        left join names n on n.object_kind = t.object_kind and n.object_id = t.object_id), '[]'::jsonb),
    'banned_left_out', (
      select jsonb_build_object(
               'accounts', (select count(*) from public.profiles bp
                             where bp.banned_at is not null
                               and bp.user_id in (select r.sharer_id from raw r where r.banned
                                                  union select r.recipient_id from raw r where r.banned)),
               'shares', count(*) filter (where r.fact = 'shared'))
        from raw r where r.banned)
  ) into v_out;

  return v_out;
end
$fn$;

notify pgrst, 'reload schema';

-- ── Proof ────────────────────────────────────────────────────────────────────
do $proof$
declare
  v_who   text;
  v_fn    text;
  v_admin uuid;
  v_ok    boolean;
  n_a     bigint;
  n_b     bigint;
  a_ids   uuid[];
  b_ids   uuid[];
begin
  foreach v_who in array array['public', 'anon', 'authenticated'] loop
    foreach v_fn in array array['public._admin_user_sharing_marks()',
                                'public.admin_list_users_0462(integer,integer,text,text,text,text,text,text,text,text)',
                                'public.admin_user_count_0461(text,text,text,text,text,text,text)'] loop
      if has_function_privilege(v_who, v_fn, 'execute') then
        raise exception '0746: % can execute %', v_who, v_fn;
      end if;
    end loop;
  end loop;
  foreach v_fn in array array['public.admin_list_users(integer,integer,text,text,text,text,text,text,text,text,text)',
                              'public.admin_user_count(text,text,text,text,text,text,text,text)',
                              'public.admin_user_workspaces(uuid)',
                              'public.admin_user_sharing(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0746: anon can execute %', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0746: authenticated cannot execute %', v_fn;
    end if;
    select p.prosecdef into v_ok from pg_proc p where p.oid = v_fn::regprocedure;
    if not v_ok or position('_require_admin()' in pg_get_functiondef(v_fn::regprocedure)) = 0 then
      raise exception '0746: % is not an admin-only definer', v_fn;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.admin_list_users(integer,integer,text,text,text,text,text,text,text,text,text)', 'execute') then
    raise exception '0746: service_role lost the list';
  end if;
  if (select count(*) from pg_proc where proname in ('admin_list_users', 'admin_user_count')
        and pronamespace = 'public'::regnamespace) <> 2 then
    raise exception '0746: an old list or count is still callable by its name';
  end if;

  select p.user_id into v_admin from public.profiles p where p.tier = 'admin' limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- With the filter at 'all', the list and the count are the old ones.
  select count(*) into n_a from public.admin_list_users_0462(200, 0, null, null, 'recent', null, null, null, 'verified', 'all');
  select array_agg(x.user_id) into a_ids from public.admin_list_users_0462(50, 0, null, null, 'recent', null, null, null, 'verified', 'all') x;
  select array_agg(x.user_id) into b_ids from public.admin_list_users(50, 0, null, null, 'recent', null, null, null, 'verified', 'all') x;
  if a_ids is distinct from b_ids then
    raise exception '0746: the list moved with the filter off';
  end if;
  if public.admin_user_count(null, null, null, null, null, 'verified', 'all')
     <> public.admin_user_count_0461(null, null, null, null, null, 'verified', 'all') then
    raise exception '0746: the count moved with the filter off';
  end if;

  -- Each filter: the count agrees with the list, and every row carries its mark.
  foreach v_who in array array['shared', 'brought', 'came', 'works_with'] loop
    select count(*) into n_a from public.admin_list_users(200, 0, null, null, 'reach', null, null, null, 'all', 'all', v_who);
    n_b := public.admin_user_count(null, null, null, null, null, 'all', 'all', v_who);
    if n_a = 0 or (n_b < 200 and n_a <> n_b) then
      raise exception '0746: % lists % and counts %', v_who, n_a, n_b;
    end if;
  end loop;
  if exists (select 1 from public.admin_list_users(200, 0, null, null, 'reach', null, null, null, 'all', 'all', 'shared') x
              where x.shared_n = 0) then
    raise exception '0746: Shared something lists someone who shared nothing';
  end if;
  if exists (select 1 from (
      select x.reach_n, lag(x.reach_n) over () as prev
        from public.admin_list_users(200, 0, null, null, 'reach', null, null, null, 'all', 'all', 'shared') x) q
      where q.reach_n > q.prev) then
    raise exception '0746: Most people reached is out of order';
  end if;

  -- An owner's cards on the list are their workspaces' cards.
  if exists (
    select 1
      from public.admin_list_users(50, 0, null, null, 'cards', null, null, null, 'all', 'all') x
     where x.workspaces_n between 1 and 3
       and x.card_count <> (select coalesce(sum((w->>'cards')::int), 0)
                              from jsonb_array_elements(x.workspace_cards) w
                              join public.workspaces ws on ws.id = (w->>'workspace_id')::uuid
                             where ws.created_by = x.user_id)) then
    raise exception '0746: a workspace''s cards disagree with its owner''s';
  end if;

  perform set_config('request.jwt.claims', '', true);
end
$proof$;

commit;
