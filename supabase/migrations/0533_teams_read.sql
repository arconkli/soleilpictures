-- 0533: Teams, part 5 — what the Team page and the workspace menu read.
--
-- STATUS: written 2026-10-22. NOT APPLIED until the owner says go.
--
--   get_team(org)               the TeamSnapshot of boards/src/lib/teamModel.js,
--                               cut to the caller's role on the server
--   list_my_teams()             the caller's open teams (workspace menu,
--                               "Team or Personal" where they hold a seat)
--   list_my_team_workspaces()   team workspaces the caller opens through the
--                               team and has no workspace_members row in, with
--                               the workspace row itself, so S4 merges them
--                               into the list without a second fetch
--
-- my_workspace_role is 0530's. Nothing here writes.
--
-- Privacy (design record): everyone in the team reads names and where people
-- edit; only the owner and admins read addresses, presence, invites,
-- requests, seats, the when-full rule and joining. A member never receives
-- an address, not even as a fallback name, and sees only the workspaces they
-- can open: a private one's name never reaches them (in `workspaces` or a
-- person's `where`), nor who works only there, nor, through `everywhere`,
-- that one exists. Everything about people is counted over the workspaces
-- the caller sees (amendment G).
--
-- Contract additions to teamModel.js's header (Q11 / decision 11; S4 updates
-- the header): me.role may be 'viewer'; `seats: { bought, used, pending,
-- ceiling }` for owner/admins (S3 moves it under plan); domains carry
-- txtName / txtValue; joining.link is { on, token, role, expiresAt, usesLeft }
-- from org_invite_links (the security audit's link table), all-null when
-- the team has no unrevoked link. Times are epoch milliseconds, as the client model uses.

begin;

create or replace function public.get_team(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid        uuid := auth.uid();
  v_role       text;
  v_admin      boolean;
  v_org        public.organizations%rowtype;
  v_people     jsonb;
  v_listed     text[];
  v_invites    jsonb := '[]'::jsonb;
  v_admins     jsonb;
  v_workspaces jsonb;
  v_requests   jsonb;
  v_seats      jsonb;
  v_when_full  jsonb;
  v_joining    jsonb;
  v_used       integer;
  v_pending    integer;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to see this' using errcode = '42501';
  end if;
  v_role := public._org_role(p_org_id, v_uid);
  if v_role is null then
    raise exception 'you are not in this team' using errcode = '42501', hint = 'team_not_member';
  end if;
  v_admin := v_role in ('owner', 'admin');
  select * into v_org from public.organizations o where o.id = p_org_id;

  -- The workspaces the caller sees: owner/admins all; others the team-visible
  -- ones and a private one they have a row in.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id, 'name', w.name, 'letter', upper(left(btrim(w.name), 1)),
           'color', w.settings ->> 'color', 'private', w.org_visibility = 'private')
         order by w.created_at), '[]'::jsonb)
    into v_workspaces
    from public.workspaces w
   where w.org_id = p_org_id
     and (v_admin or w.org_visibility = 'team'
          or exists (select 1 from public.workspace_members m
                      where m.workspace_id = w.id and m.user_id = v_uid));

  -- People: the team's own, and everyone from outside with an explicit grant
  -- in the workspaces the caller sees (owner and admins: all of them).
  with tw as (
    select w.id, w.name, w.org_visibility from public.workspaces w where w.org_id = p_org_id
  ),
  seen as (
    select tw.id, tw.name, tw.org_visibility from tw
     where v_admin or tw.org_visibility = 'team'
        or exists (select 1 from public.workspace_members m where m.workspace_id = tw.id and m.user_id = v_uid)
  ),
  ins as (
    select m.user_id, m.role, false as outside from public.org_members m where m.org_id = p_org_id
  ),
  grants as (
    select wm.user_id, wm.workspace_id, null::uuid as board_id,
           wm.role in ('owner', 'coowner', 'admin', 'editor') as edits
      from public.workspace_members wm join seen on seen.id = wm.workspace_id
     where wm.role <> 'service'
    union all
    select s.user_id, b.workspace_id, s.board_id, s.role = 'editor'
      from public.board_shares s
      join public.boards b on b.id = s.board_id and b.deleted_at is null
      join seen on seen.id = b.workspace_id
  ),
  outs as (
    select g.user_id, case when bool_or(g.edits) then 'guest' else 'viewer' end as role, true as outside
      from grants g
     where not exists (select 1 from ins where ins.user_id = g.user_id)
       and not public._is_service_identity(g.user_id)
     group by g.user_id
  ),
  everyone as (
    select * from ins union all select * from outs
  ),
  -- What each person can open, of what the caller sees: an explicit row, or
  -- the team's own rule (_org_ws_role_for, 0530: owner/admin every
  -- workspace, member and viewer the team-visible ones).
  opens as (
    select wm.user_id, wm.workspace_id
      from public.workspace_members wm join seen on seen.id = wm.workspace_id
     where wm.role <> 'service'
    union
    select ins.user_id, seen.id
      from ins join seen on ins.role in ('owner', 'admin') or seen.org_visibility = 'team'
  ),
  -- A share-only reach: "{workspace}, N clusters".
  reach as (
    select g.user_id, g.workspace_id, count(distinct g.board_id)::integer as n
      from grants g
     where g.board_id is not null
       and not exists (select 1 from opens o where o.user_id = g.user_id and o.workspace_id = g.workspace_id)
     group by g.user_id, g.workspace_id
  ),
  -- "Everywhere" means every workspace the caller sees.
  total as (
    select count(*)::integer as n from seen
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.user_id,
           'name', public._team_person_name(e.user_id, v_admin),
           'email', case when v_admin then u.email end,
           'role', e.role,
           'outside', e.outside,
           'everywhere', e.role in ('owner', 'admin')
                         or ((select n from total) > 0
                             and (select count(*) from opens o where o.user_id = e.user_id) >= (select n from total)),
           'where', coalesce((
              select jsonb_agg(x.label order by x.label)
                from (select s.name as label
                        from opens o join seen s on s.id = o.workspace_id
                       where o.user_id = e.user_id
                      union all
                      select s.name || ', ' || case when r.n = 1 then 'one cluster' else r.n || ' clusters' end
                        from reach r join seen s on s.id = r.workspace_id
                       where r.user_id = e.user_id) x), '[]'::jsonb),
           'online', case when v_admin then coalesce(up.last_seen_at > now() - interval '2 minutes', false) else false end,
           'lastSeenAt', case when v_admin then (extract(epoch from up.last_seen_at) * 1000)::bigint end,
           'color', p.color,
           'invited', null)
         order by case e.role when 'owner' then 0 when 'admin' then 1 when 'member' then 2
                              when 'guest' then 3 else 4 end,
                  public._team_person_name(e.user_id, v_admin)), '[]'::jsonb),
         array_agg(case when v_admin then lower(u.email) end)
    into v_people, v_listed
    from everyone e
    join auth.users u on u.id = e.user_id
    left join public.profiles p on p.user_id = e.user_id
    left join public.user_presence up on up.user_id = e.user_id;

  -- The owner first, then admins by when they joined.
  select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'name', public._team_person_name(m.user_id, v_admin))
                            order by (m.role = 'owner') desc, m.created_at), '[]'::jsonb)
    into v_admins
    from public.org_members m
   where m.org_id = p_org_id and m.role in ('owner', 'admin');

  if v_admin then
    -- Invites: the team's own, and editor/viewer invites waiting in its
    -- workspaces, each address once, never one an account here already has.
    with tw as (
      select w.id, w.name from public.workspaces w where w.org_id = p_org_id
    ),
    team_inv as (
      select oi.id, oi.email, oi.role, oi.created_at
        from public.org_invites oi
       where oi.org_id = p_org_id
         and oi.claimed_at is null and oi.revoked_at is null and oi.expires_at > now()
         and not (oi.email = any(coalesce(v_listed, '{}'::text[])))
    ),
    ws_inv as (
      select lower(pi.email) as email,
             (array_agg(pi.id order by pi.created_at))[1] as id,
             bool_or(pi.role in ('editor', 'workspace')) as edits,
             min(pi.created_at) as sent_at,
             jsonb_agg(distinct case when pi.board_id is null then tw.name else tw.name || ', one cluster' end) as labels
        from public.pending_invites pi
        join tw on tw.id = pi.workspace_id
       where pi.claimed_at is null and pi.expires_at > now() and pi.held_at is null
         and not public._sharer_suspended(pi.invited_by)
         and (pi.board_id is null
              or exists (select 1 from public.boards b where b.id = pi.board_id and b.deleted_at is null))
         and not (lower(pi.email) = any(coalesce(v_listed, '{}'::text[])))
         and not exists (select 1 from team_inv where team_inv.email = lower(pi.email))
       group by lower(pi.email)
    )
    select coalesce(jsonb_agg(x.person order by x.sent_at), '[]'::jsonb) into v_invites
      from (
        select ti.created_at as sent_at, jsonb_build_object(
                 'id', 'invite:' || ti.id, 'name', ti.email, 'email', ti.email,
                 'role', ti.role, 'outside', false, 'everywhere', ti.role = 'admin',
                 'where', '[]'::jsonb, 'online', false, 'lastSeenAt', null, 'color', null,
                 'invited', jsonb_build_object(
                   'role', case when ti.role = 'viewer' then 'viewer' else 'editor' end,
                   'sentAt', (extract(epoch from ti.created_at) * 1000)::bigint)) as person
          from team_inv ti
        union all
        select wi.sent_at, jsonb_build_object(
                 'id', 'pending:' || wi.id, 'name', wi.email, 'email', wi.email,
                 'role', case when wi.edits then 'guest' else 'viewer' end,
                 'outside', true, 'everywhere', false,
                 'where', wi.labels, 'online', false, 'lastSeenAt', null, 'color', null,
                 'invited', jsonb_build_object(
                   'role', case when wi.edits then 'editor' else 'viewer' end,
                   'sentAt', (extract(epoch from wi.sent_at) * 1000)::bigint))
          from ws_inv wi
      ) x;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'personId', r.user_id,
             'name', public._team_person_name(r.user_id, true),
             'workspace', coalesce(w.name, bw.name, v_org.name),
             'color', p.color)
           order by r.created_at), '[]'::jsonb)
      into v_requests
      from public.org_join_requests r
      left join public.workspaces w on w.id = r.workspace_id
      left join public.boards b on b.id = r.board_id
      left join public.workspaces bw on bw.id = b.workspace_id
      left join public.profiles p on p.user_id = r.user_id
     where r.org_id = p_org_id and r.status = 'pending';

    select (count(*) filter (where s.source not in ('pending', 'team_invite')))::integer,
           (count(*) filter (where s.source in ('pending', 'team_invite')))::integer
      into v_used, v_pending
      from public._team_seat_slots(p_org_id) s;
    v_seats := jsonb_build_object('bought', v_org.seats, 'used', v_used, 'pending', v_pending,
                                  'ceiling', v_org.seat_ceiling);
    v_when_full := jsonb_build_object('mode', v_org.when_full, 'monthlyLimit', v_org.auto_monthly_limit);
    v_joining := jsonb_build_object(
      'link', coalesce((
        select jsonb_build_object(
                 'on', public._team_link_live(l.token),
                 'token', l.token,
                 'role', case when l.role = 'member' then 'editor' else 'viewer' end,
                 'expiresAt', (extract(epoch from l.expires_at) * 1000)::bigint,
                 'usesLeft', greatest(0, l.max_uses - (select count(*) from public.org_invite_link_joins j
                                                        where j.token = l.token))::integer)
          from public.org_invite_links l
         where l.org_id = p_org_id and l.revoked_at is null),
        jsonb_build_object('on', false, 'token', null, 'role', null, 'expiresAt', null, 'usesLeft', null)),
      'domains', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'domain', d.domain, 'verified', d.verified_at is not null, 'on', d.join_on,
                 'txtName', d.domain, 'txtValue', 'soleil-verification=' || d.verify_token)
               order by d.created_at)
          from public.org_domains d where d.org_id = p_org_id), '[]'::jsonb));
  end if;

  return jsonb_build_object(
    'id', v_org.id,
    'name', v_org.name,
    'letter', upper(left(btrim(v_org.name), 1)),
    'color', v_org.color,
    'sample', false,
    'status', v_org.status,
    'me', jsonb_build_object('id', v_uid, 'role', v_role),
    'admins', v_admins,
    'people', v_people || v_invites,
    'requests', case when v_admin then v_requests end,
    'plan', null,
    'storage', null,
    'unpaid', null,
    'seats', case when v_admin then v_seats end,
    'whenFull', case when v_admin then v_when_full end,
    'joining', case when v_admin then v_joining end,
    'workspaces', v_workspaces);
end;
$$;

create or replace function public.list_my_teams()
returns table (org_id uuid, name text, letter text, color text, role text, holds_seat boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to see this' using errcode = '42501';
  end if;
  return query
  select o.id, o.name, upper(left(btrim(o.name), 1)), o.color, m.role, m.seat
    from public.org_members m
    join public.organizations o on o.id = m.org_id and o.closed_at is null
   where m.user_id = auth.uid()
   order by m.created_at;
end;
$$;

create or replace function public.list_my_team_workspaces()
returns table (workspace_id uuid, role text, created_at timestamptz, org_id uuid, org_name text,
               private boolean, workspace jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to see this' using errcode = '42501';
  end if;
  return query
  select w.id, public._org_ws_role_for(w.id, auth.uid()), w.created_at, o.id, o.name,
         w.org_visibility = 'private', to_jsonb(w)
    from unnest(public._my_org_workspace_ids()) x(id)
    join public.workspaces w on w.id = x.id
    join public.organizations o on o.id = w.org_id
   where not exists (select 1 from public.workspace_members m
                      where m.workspace_id = w.id and m.user_id = auth.uid())
   order by w.created_at;
end;
$$;

-- ── Grants (0311) ───────────────────────────────────────────────────────────

revoke execute on function public.get_team(uuid) from public, anon;
revoke execute on function public.list_my_teams() from public, anon;
revoke execute on function public.list_my_team_workspaces() from public, anon;
grant execute on function public.get_team(uuid) to authenticated;
grant execute on function public.list_my_teams() to authenticated;
grant execute on function public.list_my_team_workspaces() to authenticated;

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array['public.get_team(uuid)', 'public.list_my_teams()',
                              'public.list_my_team_workspaces()'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0533: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0533: % is not callable signed in', v_fn;
    end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('get_team', 'list_my_teams', 'list_my_team_workspaces')
              group by p.proname having count(*) > 1) then
    raise exception '0533: an overload exists (PGRST203)';
  end if;
end $$;

commit;
