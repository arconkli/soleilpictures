-- 0532: Teams, part 4 — a team and its workspaces.
--
-- STATUS: written 2026-10-22. Applied 2026-10-22 (owner's go), teams closed.
-- Live as migrations 20261022075029 teams_rpcs_part1 through 20261022085710
-- teams_rpcs_part5_proofs: the MCP refused calls this size, so it went in at function
-- boundaries, each part one transaction carrying its functions' grants,
-- the proof block last. Its 14 function bodies match this file by md5.
--
-- The team RPCs are three files, each small enough to apply and probe in one
-- call, applied in order: 0532 a team and its workspaces (create, rename,
-- workspaces in and out, private workspaces, close) and the internals the
-- other two share; 0533 people and seats; 0534 joining (the team link,
-- company domains, requests). Every call is a definer RPC over the RPC-only
-- tables of 0522. Nothing runs for anyone until an organization row exists,
-- and none can while app_config.teams_open is closed and lists nobody
-- (0522's gate).
--
-- Who may do what (design record; plan decisions 1–14):
--   * the owner: everything, and alone makes or unmakes admins and closes
--     the team;
--   * admins: people, seats, joining, the when-full rule, workspaces in and
--     out, private workspaces;
--   * members (a seat): create team workspaces, move their own in, leave;
--   * viewers: leave, ask for edit (ask_team_for_edit, 0534).
-- An admin's own action never consults the when-full rule: it adds a seat
-- only when it says so (p_add_seats), after the app has shown the price.
-- Joiners (link, domain) go through _team_admit (0531), which does.
--
-- Locks, in all three files: pg_advisory_xact_lock(hashtext('team_seats:' ||
-- org)) comes first, before any seat arithmetic and before any row lock (FOR
-- UPDATE, or a write that can wait on one), so no two team actions each hold
-- what the other waits for. What an action reads before it (whose invite,
-- which team, a workspace's team) it reads again under it. _team_admit and
-- _org_add_seats' callers take the same key. _org_add_seats (0531) is the
-- one writer of organizations.seats and refuses above
-- organizations.seat_ceiling (hint team_seats_ceiling, amendment B);
-- create_team checks the row's own ceiling, never a literal.
--
-- From the security audit (main session, 2026-10-22): whoever loses
-- team-derived access is offboarded first (public._offboard_member(ws,
-- user), the security session's Phase 1).
--
-- From the adversarial review (main session, 2026-10-22; amendment G):
--   * a workspace made private offboards the members and viewers who opened
--     it only through the team;
--   * only the owner gives a team workspace to anyone but the owner;
--   * a new account starts create_workspace_with_root's number of
--     workspaces at most, team ones counted, and a view-only team gains none.
--
-- Member rows written by these RPCs (moves, creation and close here, an
-- approval in 0534) set soleil.quiet_member_email for the transaction, and
-- _tg_workspace_member_email (re-emitted from 0450, one early return added)
-- sends no "you were added" for them. Rebased on its live prosrc, md5
-- 09305fb639bef7c88c4cd0c3ce3752ea, which Task 9 compares with live before
-- applying (amendment F). S2a sends no email at all: invite_to_team (0533)
-- stores invites, and S4 adds the template under the 0369 breaker and the
-- invite budget.
--
-- Notification kinds (title NOT NULL, short plain sentences; data carries
-- org_id; one a day per person, team and workspace, by _team_notify):
-- team.workspace_moved_out and team.closed here, team.removed in 0533,
-- team.request_approved in 0534. team.join_request and team.joined_as_viewer
-- are 0531's (_team_request, _team_request_and_notify).
-- Analytics server events (_team_event): team_created and team_closed here,
-- team_joined in 0533 and 0534. Never a token (0474).
--
-- No path in 0532–0534 writes boards.parent_board_id except
-- create_team_workspace's root insert (null), and every workspace keeps a
-- live root.

begin;

-- ── 1. Internals ────────────────────────────────────────────────────────────

-- A person's name for a notice or the roster. An address only when the
-- reader may see addresses (owner and admins); a member never gets one, not
-- even as a fallback.
create or replace function public._team_person_name(p_user uuid, p_with_email boolean)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (select nullif(btrim(p.display_name), '') from public.profiles p where p.user_id = p_user),
    (select nullif(btrim(u.raw_user_meta_data ->> 'full_name'), '') from auth.users u where u.id = p_user),
    case when p_with_email then (select u.email from auth.users u where u.id = p_user) end,
    'Someone');
$$;

-- One notice, at most one a day per (person, kind, team, workspace), so no
-- run of actions can fill someone's notices. A notice never breaks the action
-- that sends it.
create or replace function public._team_notify(p_user uuid, p_kind text, p_org uuid, p_workspace uuid,
                                               p_actor uuid, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then return; end if;
  if exists (select 1 from public.notifications n
              where n.user_id = p_user
                and n.kind = p_kind
                and n.data ->> 'org_id' = p_org::text
                and n.workspace_id is not distinct from p_workspace
                and n.created_at > now() - interval '24 hours') then
    return;
  end if;
  insert into public.notifications (user_id, kind, workspace_id, actor_id, title, body, data)
  values (p_user, p_kind, p_workspace, p_actor, p_title, p_body,
          jsonb_build_object('org_id', p_org));
exception when others then
  raise warning '_team_notify % failed for %: %', p_kind, p_user, sqlerrm;
end;
$$;

-- One analytics row. Never raises, never carries a token.
create or replace function public._team_event(p_user uuid, p_event text, p_props jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.analytics_events (user_id, event, props)
  values (p_user, p_event, coalesce(p_props, '{}'::jsonb));
exception when others then
  null;
end;
$$;

-- One owner per workspace move. transfer_workspace_ownership's storage move
-- (0412:144: the _image_counts sum and the two _storage_usage_apply calls),
-- so files follow the owner the way a transfer moves them. The previous
-- owner keeps editing (their row becomes 'editor').
create or replace function public._workspace_set_owner(p_ws uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old     uuid;
  v_bytes   bigint;
  v_objects bigint;
begin
  if p_new_owner is null then
    raise exception 'a workspace needs an owner' using errcode = '22023';
  end if;
  select created_by into v_old from public.workspaces where id = p_ws for update;
  if v_old is not distinct from p_new_owner then return; end if;
  perform set_config('soleil.quiet_member_email', '1', true);
  update public.workspaces set created_by = p_new_owner where id = p_ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_ws, p_new_owner, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  if v_old is not null then
    update public.workspace_members set role = 'editor' where workspace_id = p_ws and user_id = v_old;
  end if;
  select coalesce(sum(i.size_bytes), 0)::bigint, count(*)::bigint
    into v_bytes, v_objects
    from public.images i
   where i.workspace_id = p_ws
     and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at);
  if v_old is not null then
    perform public._storage_usage_apply(v_old, -v_bytes, -v_objects);
  end if;
  perform public._storage_usage_apply(p_new_owner, v_bytes, v_objects);
end;
$$;

-- Move a personal workspace into a team. The caller must own it; the team
-- owner becomes its owner (created_by), the caller stays as an editor.
-- Everyone in it keeps what they had. Seats short: add them when allowed,
-- else refuse with the shortfall in detail. A view-only team takes none in.
create or replace function public._org_move_in(p_ws uuid, p_org uuid, p_actor uuid, p_may_add_seats boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w      public.workspaces%rowtype;
  v_owner  uuid;
  v_status text;
  v_used   integer;
  v_seats  integer;
begin
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org::text));
  select * into v_w from public.workspaces where id = p_ws for update;
  if not found then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if v_w.org_id is not null then
    raise exception 'that workspace is already in a team' using errcode = '22023', hint = 'team_workspace';
  end if;
  if v_w.created_by is distinct from p_actor then
    raise exception 'only its owner can move a workspace into a team' using errcode = '42501';
  end if;
  select o.owner_id, o.status into v_owner, v_status
    from public.organizations o where o.id = p_org and o.closed_at is null;
  if v_owner is null then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'this team is view-only until it pays again' using errcode = '42501', hint = 'team_view_only';
  end if;
  update public.workspaces set org_id = p_org, org_visibility = 'team' where id = p_ws;
  perform public._workspace_set_owner(p_ws, v_owner);
  perform public._ensure_workspace_root(p_ws, p_actor);
  v_used := public._team_seats_used(p_org);
  select o.seats into v_seats from public.organizations o where o.id = p_org;
  if v_used > v_seats then
    if not p_may_add_seats then
      raise exception 'moving this workspace in needs % more seat(s)', v_used - v_seats
        using errcode = '42501', hint = 'team_seats_needed', detail = (v_used - v_seats)::text;
    end if;
    perform public._org_add_seats(p_org, v_used - v_seats, 'move_in', p_actor);
  end if;
end;
$$;

-- ── 2. The member email stays quiet for team moves ──────────────────────────

-- 0450's trigger, unchanged except for the early return marked 0532.
create or replace function public._tg_workspace_member_email()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_owner_id        uuid;
  v_workspace_name  text;
  v_recipient_email text;
  v_inviter_name    text;
begin
  -- 0360: a service identity has an undeliverable address on purpose; mailing
  -- it would only bounce, on the domain that carries everyone's sign-in codes.
  if new.role = 'service' then
    return new;
  end if;

  -- 0450: they joined through a workspace invite link just now, so "you were
  -- added" would only repeat what they did.
  if current_setting('soleil.ws_link_join', true) = '1' then
    return new;
  end if;

  -- 0532: a team move, a team workspace's creation, an approval or a team's
  -- close wrote this row; nobody was "added" by a person.
  if current_setting('soleil.quiet_member_email', true) = '1' then
    return new;
  end if;

  select w.created_by, w.name
  into v_owner_id, v_workspace_name
  from public.workspaces w
  where w.id = new.workspace_id;

  if v_owner_id is null or new.user_id = v_owner_id then
    return new;
  end if;

  if not public._email_pref_enabled(new.user_id, 'email_workspace_invite') then
    return new;
  end if;

  select email into v_recipient_email
  from auth.users where id = new.user_id;
  if v_recipient_email is null then return new; end if;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_inviter_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = v_owner_id;

  perform public._notify_email(
    'workspace_invite',
    v_recipient_email,
    jsonb_build_object(
      'workspaceName', coalesce(v_workspace_name, 'a workspace'),
      'inviterName',   coalesce(v_inviter_name,   'Someone on Clusters'),
      'role',          coalesce(new.role, 'member'),
      'workspaceId',   new.workspace_id::text
    )
  );

  return new;
end;
$$;

-- ── 3. The team ─────────────────────────────────────────────────────────────

create or replace function public.create_team(p_name text, p_color text default null,
                                              p_workspace_ids uuid[] default '{}', p_seats integer default 3)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := btrim(coalesce(p_name, ''));
  v_org     uuid;
  v_ceiling integer;
  v_ws      uuid;
  v_moved   integer := 0;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'a team name is 1 to 60 characters' using errcode = '22023';
  end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'a team colour is #rrggbb' using errcode = '22023';
  end if;
  if p_seats is null or p_seats < 3 then
    raise exception 'a team starts with at least 3 seats' using errcode = '22023';
  end if;
  -- One open team per owner (decision 7); two tabs can't both make one.
  perform pg_advisory_xact_lock(hashtext('team_create:' || v_uid::text));
  if exists (select 1 from public.organizations o where o.owner_id = v_uid and o.closed_at is null) then
    raise exception 'you already have a team' using errcode = '42501', hint = 'team_exists';
  end if;

  -- organizations_insert_gate (0522) refuses unless teams are open for the caller.
  insert into public.organizations (name, color, owner_id, seats)
  values (v_name, p_color, v_uid, p_seats)
  returning id, seat_ceiling into v_org, v_ceiling;
  if p_seats > v_ceiling then
    raise exception 'more than % seats is a conversation: talk to us', v_ceiling
      using errcode = '42501', hint = 'team_seats_ceiling';
  end if;
  insert into public.org_seat_changes (org_id, delta, seats_after, reason, actor)
  values (v_org, p_seats, p_seats, 'create', v_uid);
  insert into public.org_members (org_id, user_id, role, joined_via)
  values (v_org, v_uid, 'owner', 'create');

  for v_ws in select distinct x from unnest(coalesce(p_workspace_ids, '{}'::uuid[])) x where x is not null loop
    perform public._org_move_in(v_ws, v_org, v_uid, true);
    v_moved := v_moved + 1;
  end loop;

  perform public._team_event(v_uid, 'team_created',
    jsonb_build_object('org_id', v_org, 'seats', p_seats, 'workspaces', v_moved));
  return v_org;
end;
$$;

create or replace function public.rename_team(p_org_id uuid, p_name text, p_color text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'a team name is 1 to 60 characters' using errcode = '22023';
  end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'a team colour is #rrggbb' using errcode = '22023';
  end if;
  update public.organizations o
     set name = v_name, color = coalesce(p_color, o.color)
   where o.id = p_org_id and o.closed_at is null;
end;
$$;

-- ── 4. Workspaces ───────────────────────────────────────────────────────────

-- As create_workspace_with_root (0375:477), for a team: the team owner owns
-- it (created_by, the 'owner' row), the caller edits it, the root is theirs.
-- Not a new overload of create_workspace_with_root (PGRST203). Its rule for
-- a new account holds here too, counting the team workspaces the account
-- started (their root is its board) with the ones it owns.
create or replace function public.create_team_workspace(p_org_id uuid, p_name text,
                                                        p_root_name text default 'Studio',
                                                        p_private boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_owner  uuid;
  v_status text;
  v_ws     uuid;
  v_root   uuid;
  c_new_account_workspaces constant integer := 4;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  -- Under the team's seat lock, so a removal or a close can't slip between
  -- these checks and the rows below.
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org_id::text));
  v_role := public._org_role(p_org_id, v_uid);
  if v_role is null then
    raise exception 'you are not in this team' using errcode = '42501', hint = 'team_not_member';
  end if;
  if v_role = 'viewer' then
    raise exception 'a viewer can''t make team workspaces; ask an admin for a seat'
      using errcode = '42501', hint = 'team_seats_ask_admin';
  end if;
  if coalesce(p_private, false) and not public._org_is_admin(p_org_id, v_uid) then
    raise exception 'only the team''s owner or an admin can make a private workspace'
      using errcode = '42501', hint = 'team_not_admin';
  end if;
  if public._account_is_new()
     and (select count(*) from (
            select w.id from public.workspaces w where w.created_by = v_uid
            union
            select b.workspace_id
              from public.boards b
              join public.workspaces w on w.id = b.workspace_id
             where w.org_id is not null and b.parent_board_id is null and b.created_by = v_uid) x)
         >= c_new_account_workspaces then
    raise exception 'a new account can have % workspaces for now; more open up once it is three days old',
      c_new_account_workspaces using errcode = '54000', hint = 'new_account';
  end if;
  select o.owner_id, o.status into v_owner, v_status
    from public.organizations o where o.id = p_org_id and o.closed_at is null;
  if v_owner is null then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'this team is view-only until it pays again' using errcode = '42501', hint = 'team_view_only';
  end if;

  perform set_config('soleil.quiet_member_email', '1', true);
  insert into public.workspaces (name, created_by, org_id, org_visibility)
  values (coalesce(nullif(btrim(p_name), ''), 'Workspace'), v_owner, p_org_id,
          case when coalesce(p_private, false) then 'private' else 'team' end)
  returning id into v_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, v_owner, 'owner');
  if v_uid <> v_owner then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_ws, v_uid, 'editor');
  end if;

  insert into public.boards (workspace_id, parent_board_id, name, view, created_by)
  values (v_ws, null, coalesce(nullif(btrim(p_root_name), ''), 'Studio'), 'canvas', v_uid)
  returning id into v_root;
  insert into public.board_state (board_id, doc)
  values (v_root, '');

  return jsonb_build_object('workspace_id', v_ws, 'root_board_id', v_root);
end;
$$;

-- What moving this workspace in would take: the seats it needs beyond what
-- the team has, and the people who can edit in it. Runs the real move and
-- always undoes it, so the answer is exact and nothing stays. The count
-- before is read under the team's seat lock, which the undo lets go. Past
-- the ceiling it raises the move's own team_seats_ceiling (the app says
-- "talk to us"), and a view-only team team_view_only.
create or replace function public.preview_move_into_team(p_workspace_id uuid, p_org_id uuid)
returns table (seats_needed integer, editors integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid     uuid := auth.uid();
  v_role    text;
  v_before  integer;
  v_after   integer;
  v_need    integer := 0;
  v_editors integer := 0;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  v_role := public._org_role(p_org_id, v_uid);
  if v_role is null then
    raise exception 'you are not in this team' using errcode = '42501', hint = 'team_not_member';
  end if;
  if v_role = 'viewer' then
    raise exception 'a viewer can''t move workspaces into the team; ask an admin for a seat'
      using errcode = '42501', hint = 'team_seats_ask_admin';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.created_by = v_uid) then
    raise exception 'only its owner can move a workspace into a team' using errcode = '42501';
  end if;

  begin
    perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org_id::text));
    select o.seats into v_before from public.organizations o where o.id = p_org_id;
    perform public._org_move_in(p_workspace_id, p_org_id, v_uid, true);
    select o.seats into v_after from public.organizations o where o.id = p_org_id;
    v_need := greatest(0, v_after - v_before);
    select count(distinct coalesce(g.user_id::text, 'e:' || g.email))::integer into v_editors
      from public._team_seat_grants(p_org_id) g
     where g.workspace_id = p_workspace_id;
    raise exception 'preview only' using errcode = 'SLPV0';
  exception when sqlstate 'SLPV0' then
    null;   -- every write above is undone; the counts stay
  end;
  return query select v_need, v_editors;
end;
$$;

create or replace function public.move_workspace_into_team(p_workspace_id uuid, p_org_id uuid,
                                                           p_add_seats boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  v_role := public._org_role(p_org_id, v_uid);
  if v_role is null then
    raise exception 'you are not in this team' using errcode = '42501', hint = 'team_not_member';
  end if;
  if v_role = 'viewer' then
    raise exception 'a viewer can''t move workspaces into the team; ask an admin for a seat'
      using errcode = '42501', hint = 'team_seats_ask_admin';
  end if;
  -- Only an owner or admin may add seats (the app shows the price first).
  perform public._org_move_in(p_workspace_id, p_org_id, v_uid,
                              coalesce(p_add_seats, false) and public._org_is_admin(p_org_id, v_uid));
end;
$$;

-- Hand a team workspace to one person: the team owner, or another seat
-- holder the owner picks (an admin hands a workspace only to the owner, so
-- no admin can walk off with one; amendment G). Team-derived access ends;
-- explicit rows stay (decision 9). The team owner, its previous owner, keeps
-- an editor row.
create or replace function public.move_workspace_out_of_team(p_workspace_id uuid, p_to_user uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_org   uuid;
  v_owner uuid;
  v_to    uuid;
  v_name  text;
  v_team  text;
  v_lost  uuid[];
  v_p     uuid;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  select w.org_id into v_org from public.workspaces w where w.id = p_workspace_id;
  if v_org is null then
    raise exception 'that workspace is not in a team' using errcode = '22023';
  end if;
  if not public._org_is_admin(v_org, v_uid) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(v_org, v_uid) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  -- The team's seat lock, then the workspace row, read again under it.
  perform pg_advisory_xact_lock(hashtext('team_seats:' || v_org::text));
  select w.name into v_name from public.workspaces w
   where w.id = p_workspace_id and w.org_id = v_org for update;
  if not found then
    raise exception 'that workspace is not in a team' using errcode = '22023';
  end if;
  select o.name, o.owner_id into v_team, v_owner
    from public.organizations o where o.id = v_org and o.closed_at is null;
  if v_owner is null then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  v_to := coalesce(p_to_user, v_owner);
  if v_to <> v_owner and v_uid <> v_owner then
    raise exception 'only the team''s owner can give a team workspace to someone else'
      using errcode = '42501', hint = 'team_not_owner';
  end if;
  if not exists (select 1 from public.org_members m
                  where m.org_id = v_org and m.user_id = v_to and m.seat) then
    raise exception 'a workspace can only go to someone in the team with a seat' using errcode = '22023';
  end if;
  if public._user_banned(v_to) then
    raise exception 'that account cannot own a workspace' using errcode = '42501';
  end if;

  -- Who reaches it only through the team, while it is still the team's.
  select coalesce(array_agg(m.user_id), '{}'::uuid[]) into v_lost
    from public.org_members m
   where m.org_id = v_org
     and public._org_ws_role_for(p_workspace_id, m.user_id) is not null;

  update public.workspaces set org_id = null, org_visibility = null where id = p_workspace_id;
  perform public._workspace_set_owner(p_workspace_id, v_to);
  perform public._ensure_workspace_root(p_workspace_id, v_to);

  -- Team-derived access ended for everyone without an explicit row (the
  -- security session's offboarding, Phase 1).
  foreach v_p in array v_lost loop
    continue when exists (select 1 from public.workspace_members wm
                           where wm.workspace_id = p_workspace_id and wm.user_id = v_p);
    perform public._offboard_member(p_workspace_id, v_p);
  end loop;

  if v_to <> v_uid then
    perform public._team_notify(v_to, 'team.workspace_moved_out', v_org, p_workspace_id, v_uid,
      format('You now own %s', coalesce('“' || nullif(btrim(v_name), '') || '”', 'a workspace')),
      format('It moved out of %s. Its cards, files and storage now count toward your plan.',
             coalesce('“' || public._safe_label(v_team, 60, '') || '”', 'the team')));
  end if;
end;
$$;

-- Private: the owner and admins still open it (owner decision), and so does
-- anyone with a row of their own; members and viewers who opened it only
-- through the team lose it, and are offboarded there (amendment G).
create or replace function public.set_team_workspace_private(p_workspace_id uuid, p_private boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_was text;
  v_p   uuid;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  select w.org_id into v_org from public.workspaces w where w.id = p_workspace_id;
  if v_org is null then
    raise exception 'that workspace is not in a team' using errcode = '22023';
  end if;
  if not public._org_is_admin(v_org, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(v_org, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  -- The team's seat lock, then the workspace row, read again under it.
  perform pg_advisory_xact_lock(hashtext('team_seats:' || v_org::text));
  select w.org_visibility into v_was from public.workspaces w
   where w.id = p_workspace_id and w.org_id = v_org for update;
  if not found then
    raise exception 'that workspace is not in a team' using errcode = '22023';
  end if;
  update public.workspaces
     set org_visibility = case when coalesce(p_private, false) then 'private' else 'team' end
   where id = p_workspace_id;

  if coalesce(p_private, false) and v_was = 'team' then
    for v_p in
      select m.user_id from public.org_members m
       where m.org_id = v_org and m.role in ('member', 'viewer')
         and not exists (select 1 from public.workspace_members wm
                          where wm.workspace_id = p_workspace_id and wm.user_id = m.user_id)
    loop
      perform public._offboard_member(p_workspace_id, v_p);
    end loop;
  end if;
end;
$$;

-- ── 5. Closing ──────────────────────────────────────────────────────────────

-- The owner closes the team. Everyone keeps what the team gave them as an
-- explicit row (the freeze, owner decision), never lowering one they had;
-- the workspaces become the owner's own, and their personal limit counts
-- them (over 10 is S1's freeze). S3 prefixes "the subscription has ended".
create or replace function public.close_team(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_owner  uuid;
  v_team   text;
  v_people uuid[];
  v_moved  integer := 0;
  v_p      uuid;
  w        record;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  select o.owner_id, o.name into v_owner, v_team
    from public.organizations o where o.id = p_org_id and o.closed_at is null;
  if v_owner is null or v_owner <> v_uid then
    raise exception 'only the team''s owner can close it' using errcode = '42501',
      hint = case when public._org_role(p_org_id, v_uid) is null then 'team_not_member' else 'team_not_owner' end;
  end if;
  -- The team's seat lock, then the team's row, read again under it (a second
  -- close finds it closed).
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org_id::text));
  perform 1 from public.organizations o where o.id = p_org_id and o.closed_at is null for update;
  if not found then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  perform set_config('soleil.quiet_member_email', '1', true);

  select coalesce(array_agg(m.user_id), '{}'::uuid[]) into v_people
    from public.org_members m where m.org_id = p_org_id;

  for w in select ws.id, ws.created_by from public.workspaces ws where ws.org_id = p_org_id for update loop
    if w.created_by is distinct from v_owner then
      perform public._workspace_set_owner(w.id, v_owner);
    end if;
    -- While the team is still open, so _org_ws_role_for still answers.
    insert into public.workspace_members (workspace_id, user_id, role)
    select w.id, m.user_id, public._org_ws_role_for(w.id, m.user_id)
      from public.org_members m
     where m.org_id = p_org_id
       and m.user_id <> v_owner
       and public._org_ws_role_for(w.id, m.user_id) is not null
    on conflict (workspace_id, user_id) do update
       set role = excluded.role
     where public._ws_role_rank(excluded.role) > public._ws_role_rank(workspace_members.role)
       and workspace_members.role not in ('owner', 'service');
    v_moved := v_moved + 1;
  end loop;

  update public.workspaces ws set org_id = null, org_visibility = null where ws.org_id = p_org_id;

  update public.org_invites oi set revoked_at = now()
   where oi.org_id = p_org_id and oi.claimed_at is null and oi.revoked_at is null;
  delete from public.org_domains d where d.org_id = p_org_id;
  update public.org_join_requests r set status = 'cancelled', decided_at = now(), decided_by = v_uid
   where r.org_id = p_org_id and r.status = 'pending';
  update public.org_invite_links l set revoked_at = now()
   where l.org_id = p_org_id and l.revoked_at is null;
  delete from public.org_members m where m.org_id = p_org_id;
  update public.organizations o set closed_at = now() where o.id = p_org_id;

  foreach v_p in array v_people loop
    continue when v_p = v_uid;
    perform public._team_notify(v_p, 'team.closed', p_org_id, null, v_uid,
      format('%s was closed', coalesce('“' || public._safe_label(v_team, 60, '') || '”', 'Your team')),
      'You keep what you could do in its workspaces.');
  end loop;
  perform public._team_event(v_uid, 'team_closed',
    jsonb_build_object('org_id', p_org_id, 'workspaces', v_moved));
  return jsonb_build_object('workspaces_moved', v_moved);
end;
$$;

-- ── 6. Grants (0311) ────────────────────────────────────────────────────────

revoke execute on function public._team_person_name(uuid, boolean) from public, anon, authenticated;
revoke execute on function public._team_notify(uuid, text, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public._team_event(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public._workspace_set_owner(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._org_move_in(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._tg_workspace_member_email() from public, anon, authenticated;

revoke execute on function public.create_team(text, text, uuid[], integer) from public, anon;
revoke execute on function public.rename_team(uuid, text, text) from public, anon;
revoke execute on function public.create_team_workspace(uuid, text, text, boolean) from public, anon;
revoke execute on function public.preview_move_into_team(uuid, uuid) from public, anon;
revoke execute on function public.move_workspace_into_team(uuid, uuid, boolean) from public, anon;
revoke execute on function public.move_workspace_out_of_team(uuid, uuid) from public, anon;
revoke execute on function public.set_team_workspace_private(uuid, boolean) from public, anon;
revoke execute on function public.close_team(uuid) from public, anon;

grant execute on function public.create_team(text, text, uuid[], integer) to authenticated;
grant execute on function public.rename_team(uuid, text, text) to authenticated;
grant execute on function public.create_team_workspace(uuid, text, text, boolean) to authenticated;
grant execute on function public.preview_move_into_team(uuid, uuid) to authenticated;
grant execute on function public.move_workspace_into_team(uuid, uuid, boolean) to authenticated;
grant execute on function public.move_workspace_out_of_team(uuid, uuid) to authenticated;
grant execute on function public.set_team_workspace_private(uuid, boolean) to authenticated;
grant execute on function public.close_team(uuid) to authenticated;

-- ── 7. Proofs (the 0311 habit: a REVOKE reporting success proves nothing) ──

do $$
declare
  v_fn text;
begin
  -- What this file calls of the security session's is live first, and
  -- server-only (Task 9): a plpgsql body binds what it calls only when it
  -- runs, so nothing else here would notice it missing.
  foreach v_fn in array array['public._offboard_member(uuid,uuid)'] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0532 needs the security session''s % live first', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0532: % is client-executable', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public._team_person_name(uuid,boolean)',
    'public._team_notify(uuid,text,uuid,uuid,uuid,text,text)',
    'public._team_event(uuid,text,jsonb)',
    'public._workspace_set_owner(uuid,uuid)',
    'public._org_move_in(uuid,uuid,uuid,boolean)',
    'public._tg_workspace_member_email()'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0532: % is client-executable', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.create_team(text,text,uuid[],integer)',
    'public.rename_team(uuid,text,text)',
    'public.create_team_workspace(uuid,text,text,boolean)',
    'public.preview_move_into_team(uuid,uuid)',
    'public.move_workspace_into_team(uuid,uuid,boolean)',
    'public.move_workspace_out_of_team(uuid,uuid)',
    'public.set_team_workspace_private(uuid,boolean)',
    'public.close_team(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0532: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0532: % is not callable signed in', v_fn;
    end if;
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_team_person_name', '_team_notify', '_team_event',
                                  '_workspace_set_owner', '_org_move_in',
                                  '_tg_workspace_member_email', 'create_team', 'rename_team',
                                  'create_team_workspace', 'preview_move_into_team',
                                  'move_workspace_into_team', 'move_workspace_out_of_team',
                                  'set_team_workspace_private', 'close_team')
              group by p.proname having count(*) > 1) then
    raise exception '0532: an overload exists (PGRST203)';
  end if;

  -- The trigger keeps both of its earlier early returns, and gains the quiet one.
  if position('soleil.ws_link_join' in (select prosrc from pg_proc where oid = 'public._tg_workspace_member_email()'::regprocedure)) = 0
     or position('soleil.quiet_member_email' in (select prosrc from pg_proc where oid = 'public._tg_workspace_member_email()'::regprocedure)) = 0
     or position('new.role = ''service''' in (select prosrc from pg_proc where oid = 'public._tg_workspace_member_email()'::regprocedure)) = 0 then
    raise exception '0532: _tg_workspace_member_email lost an early return';
  end if;

  -- Applying this changes nothing for anyone: no team exists.
  if exists (select 1 from public.organizations) then
    raise exception '0532: an organization exists';
  end if;
end $$;

commit;
