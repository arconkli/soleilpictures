-- 0744 — The sharing ledger (sharing insight, Phase 2).
--
-- Every share already names its sharer somewhere (a link's created_by, an
-- invitation's invited_by, a board share's invited_by, a published page's
-- submitter), and what came of it sits in the tables and events beside it. The
-- admin read none of that beyond two first-touch credits. These three helpers
-- turn it into one ledger, so the profile, the Users list, Analytics › Sharing
-- and the live feed count the same things the same way.
--
--   1. _admin_workspace_adds(): the members someone put straight into a
--      workspace (no link and no invitation behind them), and who did it:
--      0740's record from its apply on; before that, a workspace manager's own
--      access_granted (how 'workspace') within five minutes of the row; else
--      not recorded. Not adds: the workspace's creator, a member row within ten
--      seconds of the workspace's (an owner who handed it over), owners,
--      service rows, and whatever 0740 filed as system or service.
--   2. _admin_brought_in(): how each account came to sign up, every piece of
--      evidence ranked; rank 1 is the credit:
--        1 the cluster link they first arrived through (first_source.
--          share_token; a link that no longer exists is still the credit,
--          never "organic")
--        2 the Explore page they first arrived on (first_source.public_slug)
--        3 a referral recorded within a day of signing up (a ?ref= code, an
--          edit link, a workspace link; 0163's invitation fallback is 4)
--        4 an emailed invitation sent before the account, claimed within a
--          day of it
--        5 a workspace link joined within a day of signing up
--        6 added straight to a workspace within a day of signing up
--        7 a shared file: its page first (file_token, or a landing path of
--          /f/<token>), or named on one before the account existed
--   3. _admin_share_ledger(since, exclude_internal, with_views, user): one row
--      per fact, on the share it belongs to (edge_key) and dated by itself:
--        shared, opened_panel, copied, viewed, joined, new_account,
--        made_something, co_created, remixed
--      across the routes view_link, edit_link, email_invite, direct_share,
--      workspace_link, workspace_add, file_share, explore, referral_link.
--        viewed       a device (session_id, in device_id) opening a share,
--                     once per share, at its first open; left out: valid
--                     false, the sharer's own devices, an internal account's
--                     (when internal is left out), and a device whose account
--                     could already open that cluster then. A view without
--                     link_kind (before 5aa7aa32 reached production) is an
--                     edit link's when that link's join card logged beside it
--                     in the same session, else the cluster's earliest view
--                     link live at the time.
--        new_account  rank 1 of _admin_brought_in() for people who entered
--                     the code (_admin_people); made_something, those of them
--                     in _admin_made_something()
--        co_created   a recipient placing a card in the shared object's
--                     workspace after getting in; the card's board decides,
--                     since a cluster guest's card_placed carries their own
--                     workspace, not the cluster's
--      A banned sharer or recipient flags the row (banned) for callers to
--      leave out and count; internal accounts are dropped when asked. No token
--      leaves: a link is its link_key, left(md5(token), 12).
--      Measured on the live database before applying: ninety days with views
--      in 160–200 ms, without views (what the Users list needs) under 90 ms,
--      one person under 90 ms; every events read is by (event, occurred_at),
--      or by session or user through an array, with no per-row lookups.
--   4. All three closed to clients (the admin reads that call them are
--      definers). Proof: the grants, the ledger's custom plans, three totals
--      it must agree with counted straight from their tables, one credit per
--      account, and no token among its keys.

-- ── 1. Members put straight into a workspace ─────────────────────────────────
create or replace function public._admin_workspace_adds()
returns table (workspace_id uuid, user_id uuid, at timestamptz,
               sharer_id uuid, sharer_recorded boolean, edge_key text, evidence text)
language sql stable security definer
set search_path = 'public'
as $$
  with m as (
    select m.workspace_id, m.user_id, m.created_at, w.created_by as owner
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
     where m.user_id is distinct from w.created_by
       and m.role not in ('owner', 'service')
       and m.created_at > w.created_at + interval '10 seconds'
  ),
  rec as (  -- 0740: how each member got in, recorded as it happened
    select distinct on (a.workspace_id, a.user_id) a.workspace_id, a.user_id, a.joined_via, a.added_by
      from public.workspace_member_adds a
     order by a.workspace_id, a.user_id, a.created_at desc
  ),
  ag as (   -- before 0740: the adder's own share event
    select e.user_id, e.occurred_at
      from public.analytics_events e
     where e.event = 'access_granted' and e.props->>'how' = 'workspace' and e.user_id is not null
  ),
  matched as (
    select distinct on (m.workspace_id, m.user_id) m.workspace_id, m.user_id, ag.user_id as adder
      from m
      join ag on ag.occurred_at between m.created_at - interval '5 minutes' and m.created_at + interval '5 minutes'
             and ag.user_id <> m.user_id
     where ag.user_id = m.owner
        or exists (select 1 from public.workspace_members mm
                    where mm.workspace_id = m.workspace_id and mm.user_id = ag.user_id
                      and mm.role in ('owner', 'coowner'))
     order by m.workspace_id, m.user_id, abs(extract(epoch from ag.occurred_at - m.created_at))
  )
  select m.workspace_id, m.user_id, m.created_at,
         coalesce(rec.added_by, matched.adder),
         (rec.added_by is not null or matched.adder is not null),
         'wa:' || m.workspace_id::text || ':' || m.user_id::text,
         case when rec.added_by is not null then 'recorded'
              when matched.adder is not null then 'matched_event'
              else 'not_recorded' end
    from m
    left join rec on rec.workspace_id = m.workspace_id and rec.user_id = m.user_id
    left join matched on matched.workspace_id = m.workspace_id and matched.user_id = m.user_id
   where coalesce(rec.joined_via, 'direct_add') in ('direct_add', 'other')
     -- before 0740, a link join or a claimed invitation is its own route
     and (rec.joined_via is not null
          or (not exists (select 1 from public.workspace_invite_link_joins j
                           where j.workspace_id = m.workspace_id and j.user_id = m.user_id)
              and not exists (select 1 from public.pending_invites pi
                               where pi.board_id is null and pi.workspace_id = m.workspace_id
                                 and pi.claimed_by = m.user_id)));
$$;

-- ── 2. How each account came to sign up ──────────────────────────────────────
create or replace function public._admin_brought_in()
returns table (user_id uuid, at timestamptz, rank int, route text, sharer_id uuid, edge_key text,
               object_kind text, object_id uuid, link_key text, evidence text, state text)
language sql stable security definer
set search_path = 'public'
as $$
  with u as (
    select u.id, u.created_at, p.first_source as fs
      from auth.users u
      left join public.profiles p on p.user_id = u.id
  ),
  ev as (
    -- 1. The cluster link they first arrived through. A deleted link keeps the
    --    credit; the referral its claim wrote says which kind it was.
    select u.id, u.created_at, 1 as pri,
           case when l.kind = 'invite' or (l.token is null and rf.id is not null) then 'edit_link' else 'view_link' end as route,
           coalesce(l.created_by, rf.referrer_id) as sharer,
           case when l.kind = 'invite' or (l.token is null and rf.id is not null) then 'el:' else 'vl:' end
             || left(md5(lower(u.fs->>'share_token')), 12) as ek,
           left(md5(lower(u.fs->>'share_token')), 12) as lk,
           'cluster'::text as okind, l.board_id as oid, 'first_touch'::text as evidence,
           case when l.token is null then 'deleted'
                when l.revoked_at is not null then 'revoked'
                when l.expires_at is not null and l.expires_at < now() then 'expired'
                else 'live' end as state
      from u
      left join public.public_share_links l on l.token::text = lower(u.fs->>'share_token')
      left join public.referrals rf on rf.referee_id = u.id and lower(rf.meta->>'token') = lower(u.fs->>'share_token')
     where nullif(u.fs->>'share_token', '') is not null
    union all
    -- 2. The Explore page they first arrived on.
    select u.id, u.created_at, 2, 'explore', coalesce(pb.submitted_by, pb.created_by),
           'ex:' || coalesce(pb.board_id::text, 'slug:' || (u.fs->>'public_slug')), null,
           'cluster', pb.board_id, 'first_touch',
           case when pb.board_id is null then 'deleted'
                when pb.published_at is not null then 'live'
                else coalesce(pb.review_status, 'draft') end
      from u
      left join public.public_boards pb on pb.slug = u.fs->>'public_slug'
     where nullif(u.fs->>'public_slug', '') is not null
    union all
    -- 3. A referral, recorded within a day of signing up (0163's fallback for
    --    a claimed invitation carries no via: that one is 4).
    select u.id, u.created_at, 3,
           case when rf.source = 'link' then 'referral_link'
                when rf.meta->>'via' = 'workspace_link' then 'workspace_link'
                else 'edit_link' end,
           rf.referrer_id,
           case when rf.source = 'link' then 'rl:' || rf.referrer_id::text
                when rf.meta->>'via' = 'workspace_link' then 'wl:' || coalesce(left(md5(wj.token::text), 12), '?')
                else 'el:' || left(md5(lower(rf.meta->>'token')), 12) end,
           case when rf.meta->>'via' = 'workspace_link' then left(md5(wj.token::text), 12)
                when rf.meta ? 'token' then left(md5(lower(rf.meta->>'token')), 12) end,
           case when rf.source = 'link' then null
                when rf.meta->>'via' = 'workspace_link' then 'workspace'
                else 'cluster' end,
           case when rf.meta->>'via' = 'workspace_link' then wj.workspace_id else l.board_id end,
           'referral', 'referred'
      from public.referrals rf
      join u on u.id = rf.referee_id
      left join public.public_share_links l on l.token::text = lower(rf.meta->>'token')
      left join lateral (
        select j.token, j.workspace_id
          from public.workspace_invite_link_joins j
         where j.user_id = rf.referee_id and j.workspace_id::text = rf.meta->>'workspace_id'
         order by j.joined_at
         limit 1) wj on true
     where rf.created_at <= u.created_at + interval '1 day'
       and (rf.source = 'link' or rf.meta ? 'via')
    union all
    -- 4. An emailed invitation sent before the account, claimed as it signed up.
    select u.id, u.created_at, 4, 'email_invite', pi.invited_by, 'pi:' || pi.id::text, null,
           case when pi.board_id is null then 'workspace' else 'cluster' end,
           coalesce(pi.board_id, pi.workspace_id), 'claimed_invite', 'claimed'
      from public.pending_invites pi
      join u on u.id = pi.claimed_by
     where pi.claimed_at is not null
       and pi.created_at <= u.created_at
       and pi.claimed_at <= u.created_at + interval '1 day'
    union all
    -- 5. A workspace link, joined within a day of signing up.
    select u.id, u.created_at, 5, 'workspace_link', wl.created_by,
           'wl:' || left(md5(j.token::text), 12), left(md5(j.token::text), 12),
           'workspace', j.workspace_id, 'workspace_link_join',
           case when wl.token is null then 'deleted'
                when wl.revoked_at is not null then 'revoked'
                when wl.expires_at is not null and wl.expires_at < now() then 'expired'
                else 'live' end
      from public.workspace_invite_link_joins j
      join u on u.id = j.user_id
      left join public.workspace_invite_links wl on wl.token = j.token
     where j.joined_at <= u.created_at + interval '1 day'
    union all
    -- 6. Put straight into someone's workspace within a day of signing up.
    select u.id, u.created_at, 6, 'workspace_add', wa.sharer_id, wa.edge_key, null,
           'workspace', wa.workspace_id, wa.evidence, 'member'
      from public._admin_workspace_adds() wa
      join u on u.id = wa.user_id
     where wa.at <= u.created_at + interval '1 day'
    union all
    -- 7. A shared file: its page first (0741's file_token, or the page's own
    --    landing path) ...
    select u.id, u.created_at, 7, 'file_share', coalesce(s.link_set_by, s.created_by),
           'fs:' || coalesce(s.id::text, '?'), null, 'file', s.id, 'first_touch',
           case when s.id is null then 'deleted' when s.link_access = 'none' then 'no_link' else 'live' end
      from u
      left join public.file_shares s
        on s.token::text = lower(coalesce(nullif(u.fs->>'file_token', ''),
                                          substring(u.fs->>'landing_path' from '^/f/([0-9A-Fa-f-]{36})')))
     where coalesce(nullif(u.fs->>'file_token', ''),
                    substring(u.fs->>'landing_path' from '^/f/([0-9A-Fa-f-]{36})')) is not null
    union all
    --    ... or named on one before the account existed.
    select u.id, u.created_at, 7, 'file_share', coalesce(p.invited_by, s.created_by),
           'fp:' || p.share_id::text || ':' || left(md5(lower(p.email)), 12), null,
           'file', s.id, 'named', case when p.revoked_at is not null then 'revoked' else 'live' end
      from public.file_share_people p
      join public.file_shares s on s.id = p.share_id
      join u on u.id = p.user_id
     where p.created_at <= u.created_at
  )
  select ev.id, ev.created_at, (row_number() over (partition by ev.id order by ev.pri, ev.ek))::int,
         ev.route, ev.sharer, ev.ek, ev.okind, ev.oid, ev.lk, ev.evidence, ev.state
    from ev;
$$;

-- ── 3. The ledger ────────────────────────────────────────────────────────────
create or replace function public._admin_share_ledger(
  p_since            timestamptz default null,
  p_exclude_internal boolean     default true,
  p_with_views       boolean     default true,
  p_user             uuid        default null)
returns table (edge_key text, fact text, at timestamptz, route text,
               sharer_id uuid, sharer_recorded boolean,
               object_kind text, object_id uuid, workspace_id uuid,
               recipient_id uuid, recipient_email text, device_id uuid,
               state text, link_key text, evidence text, banned boolean)
language plpgsql stable security definer
set search_path = 'public'
set plan_cache_mode = 'force_custom_plan'
set work_mem = '32MB'
as $fn$
declare
  v_since timestamptz := coalesce(p_since, '-infinity'::timestamptz);
begin
  return query
  with
  internal as (
    select iu.user_id from public._internal_user_ids() iu where p_exclude_internal
  ),
  banned_people as (
    select p.user_id from public.profiles p where p.banned_at is not null
  ),
  -- Every cluster link, under the key it goes by.
  links as (
    select l.token, l.board_id, l.kind, l.created_by, l.created_at, l.revoked_at,
           left(md5(l.token::text), 12) as lk,
           case when l.kind = 'invite' then 'edit_link' else 'view_link' end as route,
           case when l.kind = 'invite' then 'el:' else 'vl:' end || left(md5(l.token::text), 12) as ek,
           case when l.revoked_at is not null then 'revoked'
                when l.expires_at is not null and l.expires_at < now() then 'expired'
                else 'live' end as state
      from public.public_share_links l
  ),
  explore as (
    select pb.board_id, pb.slug, coalesce(pb.submitted_by, pb.created_by) as sharer,
           coalesce(pb.published_at, pb.submitted_at, pb.created_at) as at,
           case when pb.published_at is not null then 'live' else coalesce(pb.review_status, 'draft') end as state
      from public.public_boards pb
  ),
  -- Every share and what it led to, from the tables that record them.
  base as (
    -- A cluster link: made, then whoever its edit kind let in.
    select l.ek, 'shared'::text as fact, l.created_at as at, l.route, l.created_by as sharer, true as recorded,
           'cluster'::text as okind, l.board_id as oid, null::uuid as recip, null::text as email, l.state, l.lk, null::text as evidence
      from links l
    union all
    select l.ek, 'joined', s.created_at, l.route, l.created_by, true, 'cluster', l.board_id, s.user_id, null, 'member', l.lk, null
      from public.board_shares s join links l on l.token = s.via_link_token
    union all
    select l.ek, 'joined', r.shared_at, l.route, l.created_by, true, 'cluster', l.board_id, r.user_id, null, 'removed', l.lk, null
      from public.board_share_removals r join links l on l.token = r.via_link_token
    union all
    -- An emailed invitation (to a cluster, or a whole workspace): sent, then claimed.
    select 'pi:' || pi.id::text, f.fact, case when f.fact = 'shared' then pi.created_at else pi.claimed_at end,
           'email_invite', pi.invited_by, true,
           case when pi.board_id is null then 'workspace' else 'cluster' end, coalesce(pi.board_id, pi.workspace_id),
           pi.claimed_by, lower(pi.email),
           case when pi.claimed_at is not null then 'claimed' when pi.held_at is not null then 'held'
                when pi.expires_at is not null and pi.expires_at < now() then 'expired' else 'pending' end,
           null, null
      from public.pending_invites pi
      cross join (values ('shared'), ('joined')) f(fact)
     where f.fact = 'shared' or pi.claimed_at is not null
    union all
    -- Shared straight with an account, no link or invitation behind it: made and joined at once.
    select 'bs:' || s.board_id::text || ':' || s.user_id::text, f.fact, s.created_at, 'direct_share', s.invited_by, s.invited_by is not null,
           'cluster', s.board_id, s.user_id, null, 'member', null, null
      from public.board_shares s
      cross join (values ('shared'), ('joined')) f(fact)
     where s.via_link_token is null
       and not exists (select 1 from public.pending_invites pi where pi.board_id = s.board_id and pi.claimed_by = s.user_id)
    union all
    select 'bs:' || r.board_id::text || ':' || r.user_id::text, f.fact, r.shared_at, 'direct_share', r.invited_by, r.invited_by is not null,
           'cluster', r.board_id, r.user_id, null, 'removed', null, null
      from public.board_share_removals r
      cross join (values ('shared'), ('joined')) f(fact)
     where r.via_link_token is null
       and not exists (select 1 from public.pending_invites pi where pi.board_id = r.board_id and pi.claimed_by = r.user_id)
    union all
    -- A workspace's invite link: made, then each join.
    select 'wl:' || left(md5(wl.token::text), 12), 'shared', wl.created_at, 'workspace_link', wl.created_by, true,
           'workspace', wl.workspace_id, null, null,
           case when wl.revoked_at is not null then 'revoked'
                when wl.expires_at is not null and wl.expires_at < now() then 'expired' else 'live' end,
           left(md5(wl.token::text), 12), null
      from public.workspace_invite_links wl
    union all
    select 'wl:' || left(md5(j.token::text), 12), 'joined', j.joined_at, 'workspace_link', wl.created_by, true,
           'workspace', j.workspace_id, j.user_id, null, 'member', left(md5(j.token::text), 12), null
      from public.workspace_invite_link_joins j
      left join public.workspace_invite_links wl on wl.token = j.token
    union all
    -- Put straight into a workspace.
    select wa.edge_key, f.fact, wa.at, 'workspace_add', wa.sharer_id, wa.sharer_recorded,
           'workspace', wa.workspace_id, wa.user_id, null, 'member', null, wa.evidence
      from public._admin_workspace_adds() wa
      cross join (values ('shared'), ('joined')) f(fact)
    union all
    -- A shared file: its link, when it has one, and each person named on it.
    select 'fs:' || s.id::text, 'shared', s.created_at, 'file_share', coalesce(s.link_set_by, s.created_by), true,
           'file', s.id, null, null, 'live', null, null
      from public.file_shares s
     where s.link_access is distinct from 'none'
    union all
    select 'fp:' || p.share_id::text || ':' || left(md5(lower(p.email)), 12), f.fact, p.created_at, 'file_share',
           coalesce(p.invited_by, s.created_by), true,
           'file', s.id, p.user_id, lower(p.email), case when p.revoked_at is not null then 'revoked' else 'live' end, null, null
      from public.file_share_people p
      join public.file_shares s on s.id = p.share_id
      cross join (values ('shared'), ('joined')) f(fact)
     where f.fact = 'shared' or p.user_id is not null
    union all
    -- Published to Explore, or put up for it.
    select 'ex:' || x.board_id::text, 'shared', x.at, 'explore', x.sharer, true, 'cluster', x.board_id, null, null, x.state, null, null
      from explore x
    union all
    -- A remix of a shared cluster (0743).
    select case when rs.source_kind = 'slug' then 'ex:' || rs.source_board_id::text
                when rs.link_kind = 'invite' then 'el:' || rs.link_key else 'vl:' || rs.link_key end,
           'remixed', rs.created_at,
           case when rs.source_kind = 'slug' then 'explore' when rs.link_kind = 'invite' then 'edit_link' else 'view_link' end,
           rs.shared_by, true, 'cluster', rs.source_board_id, rs.remixed_by, null, 'remixed', rs.link_key, null
      from public.remix_sources rs
    union all
    -- The accounts each share brought in, and those of them that made something.
    select bi.edge_key, f.fact, bi.at, bi.route, bi.sharer_id, true, bi.object_kind, bi.object_id,
           bi.user_id, null, bi.state, bi.link_key, bi.evidence
      from public._admin_brought_in() bi
      cross join (values ('new_account'), ('made_something')) f(fact)
     where bi.rank = 1
       and bi.user_id in (select pp.user_id from public._admin_people(false, true) pp)
       and (f.fact = 'new_account' or bi.user_id in (select ms.user_id from public._admin_made_something() ms))
  ),
  -- The sharer's side: the Share panel opened, a link copied. Until 08-28 the
  -- topbar's one-tap copy logged share_open {quick:true}; that is a copy.
  panel as (
    select 'ev:' || e.id::text as ek,
           case when e.event = 'file_share_open' or (e.event = 'share_open' and coalesce(e.props->>'quick', '') <> 'true')
                then 'opened_panel' else 'copied' end as fact,
           e.occurred_at as at,
           case when e.event = 'share_open' and coalesce(e.props->>'quick', '') <> 'true' then null
                when e.event in ('file_share_open', 'file_share_link_copy') then 'file_share'
                when e.event = 'workspace_link_shared' then 'workspace_link'
                when e.props->>'kind' = 'invite' then 'edit_link'
                else 'view_link' end as route,
           e.user_id as sharer, true as recorded,
           case when e.event in ('file_share_open', 'file_share_link_copy') then 'file'
                when e.event = 'workspace_link_shared' then 'workspace' else 'cluster' end as okind,
           case when e.props->>'board_id' ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
                then (e.props->>'board_id')::uuid end as oid,
           null::uuid as recip, null::text as email, null::text as state, null::text as lk,
           left(e.props->>'surface', 40) as evidence
      from public.analytics_events e
     where e.event = any (array['share_open', 'share_link_copied', 'file_share_open', 'file_share_link_copy', 'workspace_link_shared'])
       and e.occurred_at >= v_since
       and e.user_id is not null
  ),
  -- Views: each device's opens of a share, credited to one share (see the header).
  sv as (
    select e.session_id, e.user_id, e.occurred_at,
           case when coalesce(e.props->>'root_id', e.props->>'board_id') ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
                then coalesce(e.props->>'root_id', e.props->>'board_id')::uuid end as root,
           case when e.props->>'link_kind' in ('public', 'view', 'invite') then e.props->>'link_kind'
                when nullif(e.props->>'public_slug', '') is not null then 'public' end as kind,
           nullif(e.props->>'public_slug', '') as slug
      from public.analytics_events e
     where p_with_views and e.event = 'share_view' and e.occurred_at >= v_since
       and e.session_id is not null and coalesce(e.props->>'valid', 'true') <> 'false'
  ),
  ilv as (
    select e.session_id, e.occurred_at
      from public.analytics_events e
     where p_with_views and e.event = 'invite_link_view' and e.occurred_at >= v_since - interval '1 hour'
       and e.session_id is not null
  ),
  svk as materialized (
    select sv.session_id, sv.user_id, sv.occurred_at, sv.root, sv.slug,
           coalesce(sv.kind,
                    case when exists (select 1 from ilv
                                       where ilv.session_id = sv.session_id
                                         and ilv.occurred_at between sv.occurred_at - interval '2 minutes'
                                                                 and sv.occurred_at + interval '2 minutes')
                         then 'invite' end) as kind
      from sv
     where sv.root is not null
  ),
  va as (
    select svk.session_id, svk.user_id, svk.occurred_at,
           case when svk.kind = 'public' then 'ex:' || coalesce(x.board_id, svk.root)::text else lp.ek end as ek,
           case when svk.kind = 'public' then 'explore' else lp.route end as route,
           case when svk.kind = 'public' then x.sharer else lp.created_by end as sharer,
           'cluster'::text as okind,
           case when svk.kind = 'public' then coalesce(x.board_id, svk.root) else svk.root end as oid,
           case when svk.kind = 'public' then coalesce(x.board_id, svk.root) else svk.root end as access_board,
           case when svk.kind = 'public' then null else lp.lk end as lk
      from svk
      left join explore x on svk.kind = 'public' and (x.slug = svk.slug or (svk.slug is null and x.board_id = svk.root))
      left join lateral (
        select case when l.kind = 'invite' then 'el:' else 'vl:' end || left(md5(l.token::text), 12) as ek,
               case when l.kind = 'invite' then 'edit_link' else 'view_link' end as route,
               l.created_by, left(md5(l.token::text), 12) as lk
          from public.public_share_links l
         where svk.kind is distinct from 'public' and l.board_id = svk.root
           and (svk.kind is null or l.kind = case when svk.kind = 'invite' then 'invite' else 'view' end)
         order by (l.kind = 'view') desc,
                  (l.created_at <= svk.occurred_at + interval '1 minute'
                   and (l.revoked_at is null or l.revoked_at > svk.occurred_at)) desc,
                  l.created_at
         limit 1) lp on true
    union all
    select e.session_id, e.user_id, e.occurred_at, 'fs:' || s.id::text, 'file_share',
           coalesce(s.link_set_by, s.created_by), 'file', s.id, s.board_id, null
      from public.analytics_events e
      join public.file_shares s on s.id::text = e.props->>'share_id'
     where p_with_views and e.event = 'file_share_view' and e.occurred_at >= v_since and e.session_id is not null
  ),
  vd as (
    select va.ek, va.route, va.sharer, va.okind, va.oid, va.access_board, va.lk, va.session_id,
           min(va.occurred_at) as first_at,
           (array_agg(va.user_id order by va.occurred_at) filter (where va.user_id is not null))[1] as viewer
      from va
     where va.ek is not null and (p_user is null or va.sharer = p_user)
     group by va.ek, va.route, va.sharer, va.okind, va.oid, va.access_board, va.lk, va.session_id
  ),
  -- Every account each viewing device has been signed in as.
  du as (
    select distinct e.session_id, e.user_id
      from public.analytics_events e
     where p_with_views
       and e.session_id = any (array(select distinct vd.session_id from vd))
       and e.user_id is not null
  ),
  -- Who could already open each viewed cluster, and since when.
  acc as (
    select b.id as board_id, m.user_id, m.created_at
      from public.boards b join public.workspace_members m on m.workspace_id = b.workspace_id
     where b.id in (select vd.access_board from vd)
    union all
    select b.id, w.created_by, '-infinity'::timestamptz
      from public.boards b join public.workspaces w on w.id = b.workspace_id
     where b.id in (select vd.access_board from vd)
    union all
    select s.board_id, s.user_id, s.created_at
      from public.board_shares s
     where s.board_id in (select vd.access_board from vd)
  ),
  -- Devices left out: the sharer's own, an insider's, one whose account could already open it.
  vx as (
    select distinct vd.ek, vd.session_id
      from vd
      join du on du.session_id = vd.session_id
      left join acc on acc.board_id = vd.access_board and acc.user_id = du.user_id and acc.created_at <= vd.first_at
     where du.user_id = vd.sharer or acc.user_id is not null
        or du.user_id in (select i.user_id from internal i)
  ),
  views as (
    select vd.ek, 'viewed'::text as fact, vd.first_at as at, vd.route, vd.sharer, true as recorded,
           vd.okind, vd.oid, vd.viewer as recip, null::text as email, null::text as state, vd.lk, null::text as evidence,
           vd.session_id as dev
      from vd
     where not exists (select 1 from vx where vx.ek = vd.ek and vx.session_id = vd.session_id)
  ),
  -- Each recipient's first way into each workspace; their cards placed there after it.
  joins as (
    select distinct on (j.recip, j.ws) j.*
      from (select f.*, case when f.okind = 'workspace' then f.oid else b.workspace_id end as ws
              from base f
              left join public.boards b on f.okind = 'cluster' and b.id = f.oid
             where f.fact = 'joined' and f.recip is not null) j
     where j.ws is not null
     order by j.recip, j.ws, j.at
  ),
  cc as (
    select e.user_id, b.workspace_id as ws, e.occurred_at as at
      from public.analytics_events e
      join public.boards b
        on b.id = case when e.props->>'board_id' ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
                       then (e.props->>'board_id')::uuid end
     where e.event = any (array['card_placed', 'co_creation_started'])
       and e.user_id = any (array(select distinct j.recip from joins j))
  ),
  cofacts as (
    select j.ek, 'co_created'::text as fact, min(cc.at) as at, j.route, j.sharer, j.recorded, j.okind, j.oid,
           j.recip, null::text as email, null::text as state, j.lk, null::text as evidence
      from joins j
      join cc on cc.user_id = j.recip and cc.ws = j.ws and cc.at >= j.at - interval '1 minute'
     group by j.ek, j.route, j.sharer, j.recorded, j.okind, j.oid, j.recip, j.lk
  ),
  allf as (
    select x.*, null::uuid as dev from base x
    union all select x.*, null::uuid from panel x
    union all select x.* from views x
    union all select x.*, null::uuid from cofacts x
  )
  select f.ek, f.fact, f.at, f.route, f.sharer, f.recorded, f.okind, f.oid,
         case f.okind when 'workspace' then f.oid when 'cluster' then b.workspace_id when 'file' then fs.workspace_id end,
         f.recip, f.email, f.dev, f.state, f.lk, f.evidence,
         coalesce(f.sharer in (select bp.user_id from banned_people bp), false)
           or coalesce(f.recip in (select bp.user_id from banned_people bp), false)
    from allf f
    left join public.boards b on f.okind = 'cluster' and b.id = f.oid
    left join public.file_shares fs on f.okind = 'file' and fs.id = f.oid
   where f.at >= v_since
     and (p_user is null or f.sharer = p_user or f.recip = p_user)
     and not exists (select 1 from internal i where i.user_id = f.sharer or i.user_id = f.recip);
end
$fn$;

-- ── 4. Closed to clients ─────────────────────────────────────────────────────
revoke execute on function public._admin_workspace_adds() from public, anon, authenticated;
revoke execute on function public._admin_brought_in() from public, anon, authenticated;
revoke execute on function public._admin_share_ledger(timestamptz, boolean, boolean, uuid) from public, anon, authenticated;

-- ── Proof ────────────────────────────────────────────────────────────────────
do $proof$
declare
  v_who text;
  v_fn  text;
  n_a   bigint;
  n_b   bigint;
begin
  foreach v_who in array array['public', 'anon', 'authenticated'] loop
    foreach v_fn in array array['public._admin_workspace_adds()',
                                'public._admin_brought_in()',
                                'public._admin_share_ledger(timestamptz, boolean, boolean, uuid)'] loop
      if has_function_privilege(v_who, v_fn, 'execute') then
        raise exception '0744: % can execute %', v_who, v_fn;
      end if;
    end loop;
  end loop;

  if not exists (select 1 from pg_proc p
                  where p.oid = 'public._admin_share_ledger(timestamptz, boolean, boolean, uuid)'::regprocedure
                    and p.prosecdef
                    and p.proconfig @> array['plan_cache_mode=force_custom_plan']) then
    raise exception '0744: the ledger lost its definer or its custom plans';
  end if;

  -- The ledger agrees with its tables, counted straight from them.
  create temp table _0744_ledger on commit drop as
    select * from public._admin_share_ledger(null, false, true, null);

  select count(*) into n_a
    from public.board_shares s join public.public_share_links l on l.token = s.via_link_token;
  select count(*) into n_b
    from _0744_ledger where fact = 'joined' and route = 'edit_link' and state = 'member';
  if n_a <> n_b then
    raise exception '0744: % joins through edit links, the ledger says %', n_a, n_b;
  end if;

  select count(*) into n_a from public.pending_invites where claimed_at is not null;
  select count(*) into n_b from _0744_ledger where fact = 'joined' and route = 'email_invite';
  if n_a <> n_b then
    raise exception '0744: % claimed invitations, the ledger says %', n_a, n_b;
  end if;

  select count(*) into n_a
    from public.profiles p
   where nullif(p.first_source->>'share_token', '') is not null
     and p.user_id in (select pp.user_id from public._admin_people(false, true) pp);
  select count(distinct recipient_id) into n_b
    from _0744_ledger
   where fact = 'new_account' and evidence = 'first_touch' and route in ('view_link', 'edit_link');
  if n_a <> n_b then
    raise exception '0744: % sign-ups through a cluster link, the ledger says %', n_a, n_b;
  end if;

  -- One credit per account.
  if exists (select 1 from public._admin_brought_in() b
              where b.rank = 1 group by b.user_id having count(*) > 1) then
    raise exception '0744: an account is credited twice';
  end if;

  -- No token among its keys: a link key is twelve hex characters, and no id
  -- inside an edge key is any link's, invitation's or file share's token.
  if exists (select 1 from _0744_ledger
              where link_key is not null and link_key !~ '^[0-9a-f]{12}$') then
    raise exception '0744: a link key is not a hash prefix';
  end if;
  if exists (
    select 1
      from (select (regexp_matches(l.edge_key, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g'))[1]::uuid as id
              from _0744_ledger l) k
     where k.id in (select t.token from public.public_share_links t
                    union all select t.token from public.workspace_invite_links t
                    union all select t.token from public.file_shares t
                    union all select t.token from public.pending_invites t
                    union all select t.token from public.org_invites t
                    union all select t.token from public.org_invite_links t)) then
    raise exception '0744: a token reached an edge key';
  end if;
end
$proof$;
