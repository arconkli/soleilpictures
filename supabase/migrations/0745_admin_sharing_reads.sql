-- 0745 — The admin's sharing reads (sharing insight, Phase 2).
--
-- 0744's ledger, read three ways for the three places the admin shows sharing.
-- Every number comes from the ledger, so the profile, Analytics › Sharing and
-- the feed count the same things the same way.
--
--   1. admin_user_sharing(user): one person's sharing, for Users › profile
--      (the "By cluster" look the owner picked):
--        brought_in   how they came to sign up (_admin_brought_in()'s rank 1),
--                     who and what it was, how many accounts that same share
--                     brought in, and the other evidence behind them
--        totals       what they shared, the devices that opened it, who got
--                     in, signed up, made something, co-creates; the Share
--                     panel's opens and copies
--        objects      each cluster, workspace or file they shared, newest
--                     outcome first (100, then a count): its routes, copies,
--                     devices (by link kind), and the people it reached
--        people       everyone who got in or signed up through them, and how
--        waiting      their emailed invitations nobody has claimed yet
--        with_them    what others shared with them, from whom, by which route,
--                     and what came of it
--   2. admin_sharing_overview(days, exclude_internal): Analytics › Sharing
--      ("Route ladders"): UTC weeks (Monday) from the first week the window
--      touches, each route's ladder from the share to co-creating, the Share
--      panel, and the fifteen people who reached the most people.
--   3. admin_sharing_recent(limit, before, exclude_internal): the ledger's
--      facts newest first, named, for the feed in words; it pages by `before`.
--
-- What counts as a share: a 'shared' fact on any route but workspace_link,
-- and a workspace link only once someone copied it (the setup step makes one
-- for everybody, and a link nobody copied shared nothing). The people who
-- shared are the sharers of those.
--
-- A row whose sharer or recipient is banned is left out of every figure and
-- counted in banned_left_out (accounts, and the shares among them), as 0490
-- does. No token and no device id leaves: a link is its link_key, a view is
-- counted, never listed. All three are admin-only definers; the two helpers
-- under them are closed to clients. Proof at the end.

-- ── Helpers: names for the ids the ledger hands back ────────────────────────
create or replace function public._admin_share_object_names(p_kinds text[], p_ids uuid[])
returns table (object_kind text, object_id uuid, title text, deleted boolean)
language sql stable security definer
set search_path = 'public'
as $$
  with o as (
    select distinct k.kind, k.id
      from unnest(p_kinds, p_ids) as k(kind, id)
     where k.id is not null
  )
  select o.kind, o.id,
         case o.kind
           when 'cluster'   then b.name
           when 'workspace' then w.name
           when 'file'      then coalesce(nullif(ci.title, ''), fb.name)
         end,
         case o.kind
           when 'cluster'   then b.id is null or b.deleted_at is not null
           when 'workspace' then w.id is null
           when 'file'      then fs.id is null and fb.id is null
           else true
         end
    from o
    left join public.boards b      on o.kind = 'cluster' and b.id = o.id
    left join public.workspaces w  on o.kind = 'workspace' and w.id = o.id
    left join public.file_shares fs on o.kind = 'file' and fs.id = o.id
    left join lateral (select c.title from public.card_index c
                        where c.board_id = fs.board_id and c.card_id = fs.card_id limit 1) ci on fs.id is not null
    -- A Share panel event on a file names the cluster it sits in, not the share.
    left join public.boards fb     on o.kind = 'file' and fb.id = coalesce(fs.board_id, o.id);
$$;

create or replace function public._admin_share_people(p_ids uuid[])
returns table (user_id uuid, email text, name text, banned boolean)
language sql stable security definer
set search_path = 'public'
as $$
  select u.id, u.email::text, nullif(p.display_name, ''), p.banned_at is not null
    from auth.users u
    left join public.profiles p on p.user_id = u.id
   where u.id = any (p_ids);
$$;

-- ── 1. One person ────────────────────────────────────────────────────────────
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
  mine as materialized (select * from l where l.sharer_id = p_user_id),
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

-- ── 2. Analytics › Sharing ───────────────────────────────────────────────────
create or replace function public.admin_sharing_overview(
  p_days             int     default 90,
  p_exclude_internal boolean default true)
returns jsonb
language plpgsql stable security definer
set search_path = 'public'
set plan_cache_mode = 'force_custom_plan'
set work_mem = '32MB'
as $fn$
declare
  v_days  int := least(greatest(coalesce(p_days, 90), 1), 400);
  v_now   timestamptz := now();
  v_since timestamptz;
  v_from  timestamptz;
  v_out   jsonb;
begin
  perform public._require_admin();
  v_since := v_now - make_interval(days => v_days);
  -- Weeks are UTC, Monday to Sunday, from the first the window touches.
  v_from := date_trunc('week', v_since at time zone 'utc') at time zone 'utc';

  with
  raw as materialized (
    select * from public._admin_share_ledger(v_from, p_exclude_internal, true, null)
  ),
  l as materialized (
    select r.*,
           (r.fact = 'shared' and r.route <> 'workspace_link')
             or (r.fact = 'copied' and r.route = 'workspace_link') as is_share,
           date_trunc('week', r.at at time zone 'utc')::date as wk
      from raw r
     where not r.banned
  ),
  win as materialized (select * from l where l.at >= v_since),
  weeks as (
    select g::date as wk
      from generate_series(v_from at time zone 'utc', v_now at time zone 'utc', interval '1 week') g
  ),
  weekly as (
    select w.wk,
           count(*) filter (where l.is_share) as shares,
           count(distinct l.sharer_id) filter (where l.is_share) as sharers,
           count(*) filter (where l.fact = 'opened_panel') as opened,
           count(*) filter (where l.fact = 'copied') as copied,
           count(distinct l.device_id) filter (where l.fact = 'viewed') as seen,
           count(distinct l.recipient_id) filter (where l.fact = 'new_account') as signed_up,
           count(distinct l.recipient_id) filter (where l.fact = 'made_something') as made_something,
           count(distinct l.recipient_id) filter (where l.fact = 'joined') as got_in,
           count(distinct l.recipient_id) filter (where l.fact = 'co_created') as co_creating
      from weeks w
      left join l on l.wk = w.wk
     group by w.wk
  ),
  routes as (
    select w.route,
           count(*) filter (where w.is_share) as shared,
           count(distinct w.sharer_id) filter (where w.is_share) as sharers,
           count(*) filter (where w.fact = 'shared') as made,
           count(*) filter (where w.fact = 'copied') as copies,
           count(distinct w.device_id) filter (where w.fact = 'viewed') as seen,
           count(distinct w.recipient_id) filter (where w.fact = 'new_account') as signed_up,
           count(distinct w.recipient_id) filter (where w.fact = 'made_something') as made_something,
           count(distinct w.recipient_id) filter (where w.fact = 'joined') as got_in,
           count(distinct w.recipient_id) filter (where w.fact = 'co_created') as co_creating
      from win w
     where w.route is not null
     group by w.route
  ),
  sharers as (
    select w.sharer_id,
           count(*) filter (where w.is_share) as shared,
           count(*) filter (where w.is_share and w.route in ('view_link', 'edit_link', 'workspace_link', 'file_share')) as links,
           count(distinct coalesce(w.recipient_id::text, w.recipient_email))
             filter (where w.is_share and w.route in ('email_invite', 'direct_share', 'workspace_add')) as invited,
           count(*) filter (where w.fact = 'copied') as copies,
           count(distinct w.device_id) filter (where w.fact = 'viewed') as seen,
           count(distinct w.recipient_id) filter (where w.fact = 'joined') as got_in,
           count(distinct w.recipient_id) filter (where w.fact = 'new_account') as signed_up,
           count(distinct w.recipient_id) filter (where w.fact = 'made_something') as made_something,
           count(distinct w.recipient_id) filter (where w.fact = 'co_created') as co_creating,
           count(distinct w.recipient_id) filter (where w.fact in ('joined', 'new_account')) as reach
      from win w
     where w.sharer_id is not null and w.sharer_recorded
     group by w.sharer_id
    having count(*) filter (where w.is_share or w.fact in ('copied', 'viewed', 'joined', 'new_account')) > 0
  ),
  top as (
    select s.* from sharers s
     order by s.reach desc, s.seen desc, s.copies desc, s.sharer_id
     limit 15
  ),
  ppl as materialized (
    select * from public._admin_share_people(array(select t.sharer_id from top t))
  )
  select jsonb_build_object(
    'window', jsonb_build_object('days', v_days, 'since', v_since, 'weeks_from', v_from, 'now', v_now),
    'weekly', coalesce((select jsonb_agg(jsonb_build_object(
                 'week', w.wk, 'shares', w.shares, 'sharers', w.sharers, 'opened', w.opened, 'copied', w.copied,
                 'seen', w.seen, 'signed_up', w.signed_up, 'made_something', w.made_something,
                 'got_in', w.got_in, 'co_creating', w.co_creating) order by w.wk) from weekly w), '[]'::jsonb),
    'totals', (select jsonb_build_object(
                 'shares', count(*) filter (where w.is_share),
                 'sharers', count(distinct w.sharer_id) filter (where w.is_share),
                 'panel_opens', count(*) filter (where w.fact = 'opened_panel'),
                 'panel_openers', count(distinct w.sharer_id) filter (where w.fact = 'opened_panel'),
                 'copies', count(*) filter (where w.fact = 'copied'),
                 'seen', count(distinct w.device_id) filter (where w.fact = 'viewed'),
                 'got_in', count(distinct w.recipient_id) filter (where w.fact = 'joined'),
                 'signed_up', count(distinct w.recipient_id) filter (where w.fact = 'new_account'),
                 'made_something', count(distinct w.recipient_id) filter (where w.fact = 'made_something'),
                 'co_creating', count(distinct w.recipient_id) filter (where w.fact = 'co_created'),
                 'setup_links', count(*) filter (where w.fact = 'shared' and w.route = 'workspace_link'))
                 from win w),
    'routes', coalesce((select jsonb_agg(jsonb_build_object(
                 'route', r.route, 'shared', r.shared, 'sharers', r.sharers, 'made', r.made, 'copies', r.copies,
                 'seen', r.seen, 'signed_up', r.signed_up, 'made_something', r.made_something,
                 'got_in', r.got_in, 'co_creating', r.co_creating) order by r.shared desc, r.route) from routes r), '[]'::jsonb),
    'top_sharers', coalesce((select jsonb_agg(jsonb_build_object(
                 'user_id', t.sharer_id, 'email', p.email, 'name', p.name,
                 'shared', t.shared, 'links', t.links, 'invited', t.invited, 'copies', t.copies,
                 'seen', t.seen, 'got_in', t.got_in, 'signed_up', t.signed_up,
                 'made_something', t.made_something, 'co_creating', t.co_creating, 'reach', t.reach)
                 order by t.reach desc, t.seen desc, t.copies desc, t.sharer_id)
                 from top t left join ppl p on p.user_id = t.sharer_id), '[]'::jsonb),
    'banned_left_out', (
      select jsonb_build_object(
               'accounts', (select count(*) from public.profiles bp
                             where bp.banned_at is not null
                               and bp.user_id in (select r.sharer_id from raw r where r.banned and r.at >= v_since
                                                  union select r.recipient_id from raw r where r.banned and r.at >= v_since)),
               'shares', count(*) filter (where r.fact = 'shared'))
        from raw r where r.banned and r.at >= v_since)
  ) into v_out;

  return v_out;
end
$fn$;

-- ── 3. The feed ──────────────────────────────────────────────────────────────
create or replace function public.admin_sharing_recent(
  p_limit            int         default 30,
  p_before           timestamptz default null,
  p_exclude_internal boolean     default true)
returns jsonb
language plpgsql stable security definer
set search_path = 'public'
set plan_cache_mode = 'force_custom_plan'
set work_mem = '32MB'
as $fn$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 30), 1), 200);
  v_before timestamptz := coalesce(p_before, now() + interval '1 second');
  v_out    jsonb;
begin
  perform public._require_admin();

  with
  l as materialized (
    select r.*
      from public._admin_share_ledger(v_before - interval '90 days', p_exclude_internal, true, null) r
     where not r.banned
       and r.at < v_before
       -- The setup step's workspace links shared nothing until someone copies one.
       and not (r.fact = 'shared' and r.route = 'workspace_link')
  ),
  page as materialized (
    select * from l order by l.at desc, l.edge_key, l.fact limit v_limit + 1
  ),
  ppl as materialized (
    select * from public._admin_share_people(array(
      select p.sharer_id from page p where p.sharer_id is not null
      union select p.recipient_id from page p where p.recipient_id is not null))
  ),
  names as materialized (
    select * from public._admin_share_object_names(
      array(select p.object_kind from page p), array(select p.object_id from page p))
  ),
  rows as (
    select p.*, row_number() over (order by p.at desc, p.edge_key, p.fact) as rn from page p
  )
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object(
              'at', r.at, 'fact', r.fact, 'route', r.route, 'evidence', r.evidence, 'state', r.state,
              'link_key', r.link_key, 'recorded', r.sharer_recorded,
              'object', case when r.object_id is null then null else jsonb_build_object(
                          'kind', r.object_kind, 'id', r.object_id, 'title', n.title, 'deleted', coalesce(n.deleted, true)) end,
              'sharer', case when r.sharer_id is null then null else jsonb_build_object(
                          'user_id', r.sharer_id, 'email', s.email, 'name', s.name) end,
              'recipient', case when r.recipient_id is null and r.recipient_email is null then null
                                else jsonb_build_object('user_id', r.recipient_id,
                                                        'email', coalesce(t.email, r.recipient_email), 'name', t.name) end)
              order by r.rn) filter (where r.rn <= v_limit), '[]'::jsonb),
    'next_before', case when count(*) > v_limit then max(r.at) filter (where r.rn = v_limit) end)
    into v_out
    from rows r
    left join ppl s on s.user_id = r.sharer_id
    left join ppl t on t.user_id = r.recipient_id
    left join names n on n.object_kind = r.object_kind and n.object_id = r.object_id;

  return v_out;
end
$fn$;

-- ── 4. Grants ────────────────────────────────────────────────────────────────
revoke execute on function public._admin_share_object_names(text[], uuid[]) from public, anon, authenticated;
revoke execute on function public._admin_share_people(uuid[]) from public, anon, authenticated;
revoke execute on function public.admin_user_sharing(uuid) from public, anon;
revoke execute on function public.admin_sharing_overview(int, boolean) from public, anon;
revoke execute on function public.admin_sharing_recent(int, timestamptz, boolean) from public, anon;
grant execute on function public.admin_user_sharing(uuid) to authenticated;
grant execute on function public.admin_sharing_overview(int, boolean) to authenticated;
grant execute on function public.admin_sharing_recent(int, timestamptz, boolean) to authenticated;

-- ── Proof ────────────────────────────────────────────────────────────────────
do $proof$
declare
  v_who   text;
  v_fn    text;
  v_admin uuid;
  v_user  uuid;
  v_ok    boolean;
  j       jsonb;
begin
  foreach v_who in array array['public', 'anon', 'authenticated'] loop
    foreach v_fn in array array['public._admin_share_object_names(text[], uuid[])',
                                'public._admin_share_people(uuid[])'] loop
      if has_function_privilege(v_who, v_fn, 'execute') then
        raise exception '0745: % can execute %', v_who, v_fn;
      end if;
    end loop;
  end loop;
  foreach v_fn in array array['public.admin_user_sharing(uuid)',
                              'public.admin_sharing_overview(integer, boolean)',
                              'public.admin_sharing_recent(integer, timestamp with time zone, boolean)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0745: anon can execute %', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0745: authenticated cannot execute % (it checks for an admin itself)', v_fn;
    end if;
    select p.prosecdef and p.proconfig @> array['search_path=public'] into v_ok
      from pg_proc p where p.oid = v_fn::regprocedure;
    if not coalesce(v_ok, false) then
      raise exception '0745: % is not a definer on search_path public', v_fn;
    end if;
    if position('_require_admin()' in pg_get_functiondef(v_fn::regprocedure)) = 0 then
      raise exception '0745: % does not ask for an admin', v_fn;
    end if;
  end loop;

  -- A signed-in account that isn't an admin is turned away.
  select p.user_id into v_user from public.profiles p
   where p.tier is distinct from 'admin' and p.banned_at is null limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_sharing_overview(7, true);
    raise exception '0745: a non-admin read the overview';
  exception when insufficient_privilege then null;
  end;

  -- An admin reads all three, with no token among them.
  select p.user_id into v_admin from public.profiles p where p.tier = 'admin' limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  j := public.admin_sharing_overview(90, true);
  if jsonb_typeof(j->'weekly') <> 'array' or jsonb_array_length(j->'weekly') < 13 then
    raise exception '0745: the overview has no weeks';
  end if;
  if (j->'totals'->>'shares')::int <> (select coalesce(sum((r->>'shared')::int), 0) from jsonb_array_elements(j->'routes') r) then
    raise exception '0745: the routes do not add up to the shares';
  end if;
  if j::text ~* '"token"' or j::text ~* 'device_id' then
    raise exception '0745: the overview hands out a token or a device';
  end if;

  j := public.admin_sharing_recent(30, null, true);
  if jsonb_array_length(j->'rows') = 0 or j::text ~* '"token"' or j::text ~* 'device_id' then
    raise exception '0745: the feed is empty or hands out a token or a device';
  end if;
  if exists (select 1 from jsonb_array_elements(j->'rows') r
              where r->>'fact' = 'shared' and r->>'route' = 'workspace_link') then
    raise exception '0745: the feed shows a workspace link nobody copied';
  end if;

  -- The person who reached the most people: their profile agrees with the overview.
  v_user := (public.admin_sharing_overview(90, false)->'top_sharers'->0->>'user_id')::uuid;
  j := public.admin_user_sharing(v_user);
  if (j->'totals'->>'shares')::int = 0 or jsonb_array_length(j->'objects') = 0 then
    raise exception '0745: the top sharer has no shares in their profile';
  end if;
  if j::text ~* '"token"' or j::text ~* 'device_id' then
    raise exception '0745: a profile hands out a token or a device';
  end if;

  perform set_config('request.jwt.claims', '', true);
end
$proof$;
