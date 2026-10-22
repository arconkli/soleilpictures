-- 0532: Teams, part 4 — what a team's people can do.
--
-- STATUS: written 2026-10-22. NOT APPLIED until the owner says go.
--
-- Every call here is a definer RPC over the RPC-only tables of 0522: create
-- a team, bring workspaces in and out, people (invites, the link, company
-- domains, requests), seats and the when-full rule, leave, remove, close.
-- Nothing runs for anyone until an organization row exists, and none can
-- while app_config.teams_open is closed and lists nobody (0522's gate).
--
-- Who may do what (design record; plan decisions 1–14):
--   * the owner: everything, and alone makes or unmakes admins and closes
--     the team;
--   * admins: people, seats, joining, the when-full rule, workspaces in and
--     out, private workspaces;
--   * members (a seat): create team workspaces, move their own in, leave;
--   * viewers: leave, ask for edit (ask_team_for_edit).
-- An admin's own action never consults the when-full rule: it adds a seat
-- only when it says so (p_add_seats), after the app has shown the price.
-- Joiners (link, domain) go through _team_admit (0531), which does.
--
-- Locks: pg_advisory_xact_lock(hashtext('team_seats:' || org)) comes first,
-- before any seat arithmetic and before any row lock (FOR UPDATE, or a write
-- that can wait on one), so no two team actions each hold what the other
-- waits for. What an action reads before it (whose invite, which team, a
-- workspace's team) it reads again under it. _team_admit and _org_add_seats'
-- callers take the same key. _org_add_seats (0531) is the one writer of
-- organizations.seats and refuses above organizations.seat_ceiling (hint
-- team_seats_ceiling, amendment B); create_team checks the row's own
-- ceiling, never a literal.
--
-- From the security audit (main session, 2026-10-22):
--   * the team link lives in org_invite_links / org_invite_link_joins (0522),
--     live by _team_link_live, a mirror of _workspace_invite_link_live (0450),
--     with create_workspace_invite_link's uses and expiry;
--   * an invite or a domain offer is taken only from a session that proved
--     its inbox (public._session_proves_inbox(), the security session's;
--     hint team_inbox_unproven);
--   * whoever loses team-derived access is offboarded first
--     (public._offboard_member(ws, user), the security session's Phase 1);
--   * team_domain_mark_verified(…, p_ok => false) un-verifies a domain whose
--     daily re-check failed, which pauses auto-join.
--
-- From the adversarial review (main session, 2026-10-22; amendment G):
--   * every address gets an invite, never a place by itself: an account that
--     already has the address joins only by taking the invite from a session
--     that proved the inbox, and invite_to_team's answer never says whether
--     an account exists;
--   * a removal sticks: invites waiting for the address end, the domain
--     offer isn't made again, and the team link refuses someone an admin
--     removed (org_removals) until an admin's invite brings them back;
--   * a workspace made private offboards the members and viewers who opened
--     it only through the team;
--   * only the owner gives a team workspace to anyone but the owner;
--   * a new account starts create_workspace_with_root's number of
--     workspaces at most, team ones counted, and a view-only team gains none.
--
-- Requests: _team_request (0531, amendment D) is the one core; claim_team_link,
-- answer_team_offer and ask_team_for_edit call it and nothing here defines it.
--
-- Member rows written here (moves, creation, approval, close) set
-- soleil.quiet_member_email for the transaction, and _tg_workspace_member_email
-- (re-emitted from 0450, one early return added) sends no "you were added"
-- for them. Rebased on its live prosrc, md5 09305fb639bef7c88c4cd0c3ce3752ea,
-- which Task 9 compares with live before applying (amendment F). S2a sends
-- no email at all: invite_to_team stores invites, and S4 adds the template
-- under the 0369 breaker and the invite budget.
--
-- Notification kinds (title NOT NULL, short plain sentences; data carries
-- org_id; one a day per person, team and workspace): team.removed,
-- team.request_approved, team.workspace_moved_out, team.closed. An invite
-- tells no account anything (its email reaches the inbox, S4).
-- team.join_request and team.joined_as_viewer are 0531's (_team_request,
-- _team_request_and_notify).
-- Analytics server events: team_created, team_joined, team_closed. Never a
-- token (0474).
--
-- No path here writes boards.parent_board_id except create_team_workspace's
-- root insert (null), and every workspace keeps a live root.

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

-- An admin's explicit action that needs one more seat for this person: none
-- when they already hold one; a free one; else the seat the admin said to
-- add; else refuse with the hint the caller names. Never the when-full rule.
-- The caller holds the team_seats lock.
create or replace function public._team_seat_for(p_org uuid, p_user uuid, p_add boolean, p_reason text, p_hint text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_used  integer;
  v_held  boolean;
  v_seats integer;
begin
  select lower(u.email) into v_email from auth.users u where u.id = p_user;
  select count(*)::integer,
         coalesce(bool_or(s.user_id = p_user or (v_email is not null and s.email = v_email)), false)
    into v_used, v_held
    from public._team_seat_slots(p_org) s;
  if v_held then return; end if;
  select o.seats into v_seats from public.organizations o where o.id = p_org;
  if v_used < v_seats then return; end if;
  if p_add then
    perform public._org_add_seats(p_org, v_used + 1 - v_seats, p_reason, auth.uid());
    return;
  end if;
  if p_hint = 'team_seats_needed' then
    raise exception 'this needs % more seat(s)', v_used + 1 - v_seats
      using errcode = '42501', hint = 'team_seats_needed', detail = (v_used + 1 - v_seats)::text;
  end if;
  raise exception 'team seats full: every seat is in use; add a seat to do this'
    using errcode = '42501', hint = 'team_seats_full';
end;
$$;

-- A company domain as typed ("@Acme.com.", " acme.com") → "acme.com".
create or replace function public._team_norm_domain(p_domain text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(regexp_replace(regexp_replace(lower(btrim(coalesce(p_domain, ''))), '^.*@', ''), '\.+$', ''), '');
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

-- Someone leaves or is removed: their team row, and every explicit grant in
-- the team's workspaces (decision 12), which frees the seat. The 0318
-- cascade: workspace rows, then shares on clusters there
-- (board_shares_remember_removal records each, so restore_board_share can
-- undo one). Pending requests are cancelled. Open sockets drop within a
-- minute (the party's re-check). p_removed: an admin removed them (told, and
-- kept out of the team link), rather than they left.
create or replace function public._org_remove_person(p_org uuid, p_user uuid, p_removed boolean)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_team  text;
  v_ws    uuid;
  v_email text;
begin
  -- The security session's offboarding (Phase 1) runs first, in every team
  -- workspace; the seat frees only after it has.
  for v_ws in select w.id from public.workspaces w where w.org_id = p_org loop
    perform public._offboard_member(v_ws, p_user);
  end loop;
  delete from public.org_members m
   where m.org_id = p_org and m.user_id = p_user and m.role <> 'owner';
  delete from public.workspace_members wm
   using public.workspaces w
   where w.id = wm.workspace_id and w.org_id = p_org
     and wm.user_id = p_user and wm.role <> 'owner';
  delete from public.board_shares s
   using public.boards b, public.workspaces w
   where b.id = s.board_id and w.id = b.workspace_id and w.org_id = p_org
     and s.user_id = p_user;
  update public.org_join_requests r
     set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where r.org_id = p_org and r.user_id = p_user and r.status = 'pending';

  -- They stay out of the doors that open without an admin (amendment G):
  -- invites waiting for their address end, the team's and its workspaces';
  -- the domain offer isn't made again; and someone an admin removed is
  -- refused by the team link until an admin's invite brings them back.
  select lower(u.email) into v_email from auth.users u where u.id = p_user;
  if v_email is not null then
    update public.org_invites oi
       set revoked_at = now()
     where oi.org_id = p_org and oi.email = v_email
       and oi.claimed_at is null and oi.revoked_at is null;
    delete from public.pending_invites pi
     using public.workspaces w
     where w.id = pi.workspace_id and w.org_id = p_org
       and lower(pi.email) = v_email and pi.claimed_at is null;
  end if;
  insert into public.org_domain_answers (org_id, user_id, answer)
  values (p_org, p_user, 'declined')
  on conflict (org_id, user_id) do update set answer = 'declined', answered_at = now();
  if p_removed then
    insert into public.org_removals (org_id, user_id, removed_by)
    values (p_org, p_user, auth.uid())
    on conflict (org_id, user_id) do update set removed_by = excluded.removed_by, removed_at = now();
    select o.name into v_team from public.organizations o where o.id = p_org;
    perform public._team_notify(p_user, 'team.removed', p_org, null, auth.uid(),
      format('You were removed from %s', coalesce('“' || public._safe_label(v_team, 60, '') || '”', 'a team')),
      'You can no longer open its workspaces.');
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

-- ── 5. People ───────────────────────────────────────────────────────────────

-- Invite people by address. Every address gets an invite, whether or not an
-- account has it (decision 4 as amended, amendment G): the person joins by
-- taking it from a session that proved the inbox (accept_team_invite,
-- claim_my_team_invites), so an account someone else made with the address
-- can't, and the answer never says whether an account exists. S4 sends the
-- email. Admin and member invites hold seats from the moment they're stored:
-- the shortfall is added only with p_add_seats, else refused with it in detail.
create or replace function public.invite_to_team(p_org_id uuid, p_emails text[], p_role text default 'member',
                                                 p_add_seats boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid         uuid := auth.uid();
  v_seats       integer;
  v_list        text[];
  v_addr        text;
  v_kind        text;
  v_kinds       text[] := '{}';
  v_slot_emails text[];
  v_used        integer;
  v_need        integer := 0;
  v_short       integer;
  v_invited     jsonb := '[]'::jsonb;
  v_already     jsonb := '[]'::jsonb;
  v_skipped     jsonb := '[]'::jsonb;
  i             integer;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'member', 'viewer') then
    raise exception 'role must be admin, member or viewer' using errcode = '22023';
  end if;
  if not public._org_is_admin(p_org_id, v_uid) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, v_uid) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  if p_role = 'admin' and public._org_role(p_org_id, v_uid) <> 'owner' then
    raise exception 'only the team''s owner can make admins' using errcode = '42501', hint = 'team_not_owner';
  end if;
  if coalesce(cardinality(p_emails), 0) > 50 then
    raise exception 'at most 50 addresses at a time' using errcode = '22023';
  end if;
  -- An invite becomes an email (S4), so it waits on the same hold as a link.
  if not public._actor_can_send() then
    raise exception 'sharing is paused on this account while we review unusual activity'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(s.e order by s.first_i), '{}'::text[]) into v_list
    from (select lower(btrim(x)) as e, min(t.i) as first_i
            from unnest(coalesce(p_emails, '{}'::text[])) with ordinality t(x, i)
           where nullif(btrim(x), '') is not null
           group by 1) s;

  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org_id::text));
  select o.seats into v_seats
    from public.organizations o where o.id = p_org_id and o.closed_at is null for update;
  if v_seats is null then
    raise exception 'team not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(s.email) filter (where s.email is not null), '{}'::text[]),
         count(*)::integer
    into v_slot_emails, v_used
    from public._team_seat_slots(p_org_id) s;

  -- Pass 1: what each address is, and the seats the new invites need. In
  -- the team already (the roster admins read) or invited already: 'already'.
  -- Nothing here asks whether an account has the address.
  for i in 1 .. coalesce(cardinality(v_list), 0) loop
    v_addr := v_list[i];
    if char_length(v_addr) > 254 or v_addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_kind := 'invalid';
    elsif exists (select 1 from public.org_members m join auth.users u on u.id = m.user_id
                   where m.org_id = p_org_id and lower(u.email) = v_addr)
       or exists (select 1 from public.org_invites oi
                   where oi.org_id = p_org_id and oi.email = v_addr
                     and oi.claimed_at is null and oi.revoked_at is null and oi.expires_at > now()) then
      v_kind := 'already';
    else
      v_kind := 'invite';
      -- A seat, unless the address (or the account with it) holds one already.
      if p_role in ('admin', 'member') and not (v_addr = any(v_slot_emails)) then
        v_need := v_need + 1;
      end if;
    end if;
    v_kinds := v_kinds || v_kind;
  end loop;

  if v_need > 0 and v_used + v_need > v_seats then
    v_short := v_used + v_need - v_seats;
    if not coalesce(p_add_seats, false) then
      raise exception 'adding them needs % more seat(s)', v_short
        using errcode = '42501', hint = 'team_seats_needed', detail = v_short::text;
    end if;
    perform public._org_add_seats(p_org_id, v_short, 'admin_add', v_uid);
  end if;

  -- Pass 2: write.
  for i in 1 .. coalesce(cardinality(v_list), 0) loop
    v_addr := v_list[i];
    v_kind := v_kinds[i];
    if v_kind = 'invalid' then
      v_skipped := v_skipped || jsonb_build_object('email', v_addr, 'reason', 'invalid');
    elsif v_kind = 'already' then
      v_already := v_already || to_jsonb(v_addr);
    else
      -- An expired invite still holds the address's one open place
      -- (org_invites_open_email).
      update public.org_invites oi
         set revoked_at = now()
       where oi.org_id = p_org_id and oi.email = v_addr
         and oi.claimed_at is null and oi.revoked_at is null and oi.expires_at <= now();
      insert into public.org_invites (org_id, email, role, invited_by)
      values (p_org_id, v_addr, p_role, v_uid);
      v_invited := v_invited || to_jsonb(v_addr);
    end if;
  end loop;

  return jsonb_build_object('invited', v_invited, 'already', v_already, 'skipped', v_skipped);
end;
$$;

create or replace function public.revoke_team_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  select oi.org_id into v_org from public.org_invites oi where oi.id = p_invite_id;
  if v_org is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if not public._org_is_admin(v_org, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(v_org, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  update public.org_invites oi
     set revoked_at = now()
   where oi.id = p_invite_id and oi.claimed_at is null and oi.revoked_at is null;
end;
$$;

-- An invite opened by the person it names. No seat gate: its slot was held
-- from the moment it was sent (as claim_pending_invite, 0371:312). An
-- admin's invite brings back someone an admin removed.
create or replace function public.accept_team_invite(p_token uuid)
returns table (org_id uuid, role text, status text)
language plpgsql
security definer
set search_path = public, auth
as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_org   uuid;
  v_for   text;
  v_inv   public.org_invites%rowtype;
  v_email text;
  v_open  boolean;
  v_role  text;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._session_proves_inbox() then
    raise exception 'sign in with a code sent to this address first' using errcode = '42501', hint = 'team_inbox_unproven';
  end if;
  -- Whose invite and which team, read before the team's seat lock; the row
  -- is locked and read again under it.
  select oi.org_id, oi.email into v_org, v_for from public.org_invites oi where oi.token = p_token;
  if v_org is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  -- The address is the inbox this session proved. A users row alone proves
  -- only that someone typed it, so email_confirmed_at is never the gate.
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null or v_email <> v_for then
    raise exception 'this invite is for a different email' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('team_seats:' || v_org::text));
  select * into v_inv from public.org_invites oi where oi.token = p_token for update;
  if v_inv.claimed_at is not null then
    if v_inv.claimed_by = v_uid then
      return query select v_inv.org_id, public._org_role(v_inv.org_id, v_uid), 'already'::text;
      return;
    end if;
    return query select v_inv.org_id, null::text, 'revoked'::text;
    return;
  end if;
  select (o.closed_at is null) into v_open from public.organizations o where o.id = v_inv.org_id;
  if v_inv.revoked_at is not null or not coalesce(v_open, false)
     or public._sharer_suspended(v_inv.invited_by) then
    return query select v_inv.org_id, null::text, 'revoked'::text;
    return;
  end if;
  if v_inv.expires_at <= now() then
    return query select v_inv.org_id, null::text, 'expired'::text;
    return;
  end if;

  update public.org_invites oi set claimed_at = now(), claimed_by = v_uid where oi.id = v_inv.id;
  delete from public.org_removals x where x.org_id = v_inv.org_id and x.user_id = v_uid;
  v_role := public._org_role(v_inv.org_id, v_uid);
  if v_role is not null then
    return query select v_inv.org_id, v_role, 'already'::text;
    return;
  end if;
  insert into public.org_members (org_id, user_id, role, joined_via, invited_by)
  values (v_inv.org_id, v_uid, v_inv.role, 'invite', v_inv.invited_by);
  perform public._team_event(v_uid, 'team_joined',
    jsonb_build_object('org_id', v_inv.org_id, 'via', 'invite', 'status', 'joined'));
  return query select v_inv.org_id, v_inv.role, 'joined'::text;
end;
$$;

-- Every open invite to the address this session proved (S4 calls it at
-- boot; the signup trigger path is not touched). Returns how many teams they
-- joined. It runs at every boot, so a session that hasn't proved the inbox
-- joins none and is told nothing; accept_team_invite, a deliberate click,
-- says why.
create or replace function public.claim_my_team_invites()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_joined integer := 0;
  v_inv    public.org_invites%rowtype;
  r        record;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._session_proves_inbox() then
    return 0;
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    return 0;
  end if;
  -- The candidates, read unlocked; for each, its team's seat lock, then the
  -- invite row, read again under it.
  for r in
    select oi.id, oi.org_id
      from public.org_invites oi
      join public.organizations o on o.id = oi.org_id and o.closed_at is null
     where oi.email = v_email
       and oi.claimed_at is null and oi.revoked_at is null and oi.expires_at > now()
       and not public._sharer_suspended(oi.invited_by)
     order by oi.created_at
  loop
    perform pg_advisory_xact_lock(hashtext('team_seats:' || r.org_id::text));
    select * into v_inv from public.org_invites oi
     where oi.id = r.id and oi.claimed_at is null and oi.revoked_at is null and oi.expires_at > now()
     for update;
    continue when not found;
    continue when not exists (select 1 from public.organizations o where o.id = r.org_id and o.closed_at is null);
    update public.org_invites oi set claimed_at = now(), claimed_by = v_uid where oi.id = v_inv.id;
    delete from public.org_removals x where x.org_id = v_inv.org_id and x.user_id = v_uid;
    if not exists (select 1 from public.org_members m where m.org_id = v_inv.org_id and m.user_id = v_uid) then
      insert into public.org_members (org_id, user_id, role, joined_via, invited_by)
      values (v_inv.org_id, v_uid, v_inv.role, 'invite', v_inv.invited_by);
      perform public._team_event(v_uid, 'team_joined',
        jsonb_build_object('org_id', v_inv.org_id, 'via', 'invite', 'status', 'joined'));
      v_joined := v_joined + 1;
    end if;
  end loop;
  return v_joined;
end;
$$;

-- An admin changes someone's role. Insiders: admin / member / viewer (a
-- viewer given a seat needs a free one or p_add_seats). Outsiders (no team
-- row): 'viewer' makes every editor grant they have in the team's workspaces
-- a viewer grant; 'guest' is reached only by approving their request.
create or replace function public.set_team_role(p_org_id uuid, p_user_id uuid, p_role text,
                                                p_add_seats boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_me     text;
  v_target text;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, v_uid) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, v_uid) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  if p_role is null or p_role not in ('admin', 'member', 'viewer', 'guest') then
    raise exception 'role must be admin, member, viewer or guest' using errcode = '22023';
  end if;
  if p_user_id is null or p_user_id = v_uid then
    raise exception 'you can''t change your own role' using errcode = '22023';
  end if;
  v_me := public._org_role(p_org_id, v_uid);
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org_id::text));
  select m.role into v_target from public.org_members m
   where m.org_id = p_org_id and m.user_id = p_user_id for update;

  if v_target is null then
    -- Someone from outside the team, here through their own grants.
    if p_role <> 'viewer' then
      raise exception 'a guest is made by approving their request' using errcode = '22023';
    end if;
    update public.workspace_members wm
       set role = 'viewer'
      from public.workspaces w
     where w.id = wm.workspace_id and w.org_id = p_org_id
       and wm.user_id = p_user_id and wm.role in ('coowner', 'admin', 'editor');
    update public.board_shares s
       set role = 'viewer'
      from public.boards b, public.workspaces w
     where b.id = s.board_id and w.id = b.workspace_id and w.org_id = p_org_id
       and s.user_id = p_user_id and s.role = 'editor';
    return;
  end if;

  if v_target = 'owner' then
    raise exception 'the team owner''s role can''t change' using errcode = '42501', hint = 'team_owner';
  end if;
  if p_role = 'guest' then
    raise exception 'someone in the team is an admin, a member or a viewer' using errcode = '22023';
  end if;
  if (v_target = 'admin' or p_role = 'admin') and v_me <> 'owner' then
    raise exception 'only the team''s owner can make or unmake admins' using errcode = '42501', hint = 'team_not_owner';
  end if;
  if v_target = p_role then
    return;
  end if;
  if v_target = 'viewer' then
    perform public._team_seat_for(p_org_id, p_user_id, coalesce(p_add_seats, false), 'admin_add', 'team_seats_needed');
  end if;
  update public.org_members m set role = p_role where m.org_id = p_org_id and m.user_id = p_user_id;
end;
$$;

create or replace function public.remove_from_team(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_target text;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, v_uid) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, v_uid) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  if p_user_id is null then
    raise exception 'who?' using errcode = '22023';
  end if;
  v_target := public._org_role(p_org_id, p_user_id);
  if v_target = 'owner' then
    raise exception 'the team owner can''t be removed' using errcode = '42501', hint = 'team_owner';
  end if;
  if v_target = 'admin' and public._org_role(p_org_id, v_uid) <> 'owner' then
    raise exception 'only the team''s owner can remove an admin' using errcode = '42501', hint = 'team_not_owner';
  end if;
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org_id::text));
  perform public._org_remove_person(p_org_id, p_user_id, true);
end;
$$;

create or replace function public.leave_team(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  v_role := public._org_role(p_org_id, auth.uid());
  if v_role is null then
    raise exception 'you are not in this team' using errcode = '42501', hint = 'team_not_member';
  end if;
  if v_role = 'owner' then
    raise exception 'the owner can''t leave the team; close it instead' using errcode = '42501', hint = 'team_owner';
  end if;
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org_id::text));
  perform public._org_remove_person(p_org_id, auth.uid(), false);
end;
$$;

-- ── 6. Seats and the when-full rule ─────────────────────────────────────────

create or replace function public.add_team_seats(p_org_id uuid, p_n integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats   integer;
  v_ceiling integer;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  if p_n is null or p_n < 1 then
    raise exception 'add at least one seat' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org_id::text));
  select o.seats, o.seat_ceiling into v_seats, v_ceiling
    from public.organizations o where o.id = p_org_id and o.closed_at is null;
  if v_seats + p_n > v_ceiling then
    raise exception 'more than % seats is a conversation: talk to us', v_ceiling
      using errcode = '42501', hint = 'team_seats_ceiling';
  end if;
  return public._org_add_seats(p_org_id, p_n, 'admin_add', auth.uid());
end;
$$;

create or replace function public.remove_team_seat(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats integer;
  v_used  integer;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org_id::text));
  select o.seats into v_seats from public.organizations o where o.id = p_org_id and o.closed_at is null;
  v_used := public._team_seats_used(p_org_id);
  if v_seats - 1 < greatest(3, v_used) then
    raise exception 'every seat is in use, or the team is at its 3-seat minimum'
      using errcode = '42501', hint = 'team_seats_full';
  end if;
  return public._org_add_seats(p_org_id, -1, 'admin_remove', auth.uid());
end;
$$;

create or replace function public.set_team_when_full(p_org_id uuid, p_mode text, p_monthly_limit integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  if p_mode is null or p_mode not in ('ask', 'auto') then
    raise exception 'when full is ask or auto' using errcode = '22023';
  end if;
  if p_monthly_limit is not null and p_monthly_limit not between 1 and 1000 then
    raise exception 'a monthly number is 1 to 1000, or none' using errcode = '22023';
  end if;
  update public.organizations o
     set when_full = p_mode, auto_monthly_limit = p_monthly_limit
   where o.id = p_org_id and o.closed_at is null;
end;
$$;

-- Stored for S2b (the seat perk reads it).
create or replace function public.set_team_seat_perk(p_org_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  if p_on is null then
    raise exception 'on or off' using errcode = '22023';
  end if;
  update public.organizations o set seat_perk = p_on where o.id = p_org_id and o.closed_at is null;
end;
$$;

-- ── 7. The team link ────────────────────────────────────────────────────────

-- A team link lives in org_invite_links (0522): at most one unrevoked link
-- per team, each join recorded in org_invite_link_joins. Live mirrors
-- _workspace_invite_link_live (0450:122): not revoked or expired, under its
-- uses, a maker who may still send and still runs the team, an open team
-- whose owner isn't banned.
create or replace function public._team_link_live(p_token uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.org_invite_links l
      join public.organizations o on o.id = l.org_id
     where l.token = p_token
       and l.revoked_at is null
       and l.expires_at > now()
       and (select count(*) from public.org_invite_link_joins j where j.token = l.token) < l.max_uses
       and not public._sharer_suspended(l.created_by)
       and not exists (select 1 from public.profiles p
                        where p.user_id = l.created_by and p.send_hold_at is not null)
       and o.closed_at is null
       and not public._user_banned(o.owner_id)
       and exists (select 1 from public.org_members m
                    where m.org_id = l.org_id and m.user_id = l.created_by
                      and m.role in ('owner', 'admin')));
$$;

-- A new link, with create_workspace_invite_link's numbers (0450): 25 uses
-- and 30 days, or 5 uses and 7 days from a new account. The caller has
-- already revoked any unrevoked link.
create or replace function public._team_link_make(p_org uuid, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c_uses     constant integer := 25;
  c_new_uses constant integer := 5;
  c_days     constant integer := 30;
  c_new_days constant integer := 7;
  v_new      boolean := public._account_is_new();
  v_token    uuid;
begin
  if not public._actor_can_send() then
    raise exception 'sharing is paused on this account while we review unusual activity'
      using errcode = '42501';
  end if;
  insert into public.org_invite_links (org_id, role, created_by, expires_at, max_uses)
  values (p_org, coalesce(p_role, 'member'), auth.uid(),
          now() + make_interval(days => case when v_new then c_new_days else c_days end),
          case when v_new then c_new_uses else c_uses end)
  returning org_invite_links.token into v_token;
  return v_token;
end;
$$;

-- On: keep the live link, or make one. Off: revoke it. A role: the live
-- link's role (or the new link's).
create or replace function public.set_team_link(p_org_id uuid, p_on boolean default null, p_role text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  if p_role is not null and p_role not in ('member', 'viewer') then
    raise exception 'a team link makes members or viewers' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('team_link:' || p_org_id::text));
  select l.token into v_token from public.org_invite_links l
   where l.org_id = p_org_id and l.revoked_at is null;

  if p_on is false then
    update public.org_invite_links l set revoked_at = now()
     where l.org_id = p_org_id and l.revoked_at is null;
    return;
  end if;
  if v_token is not null and public._team_link_live(v_token) then
    if p_role is not null then
      update public.org_invite_links l set role = p_role where l.token = v_token;
    end if;
    return;
  end if;
  if p_on is true then
    -- An expired or used-up link still holds the one unrevoked place.
    update public.org_invite_links l set revoked_at = now()
     where l.org_id = p_org_id and l.revoked_at is null;
    perform public._team_link_make(p_org_id, p_role);
  end if;
end;
$$;

create or replace function public.reset_team_link(p_org_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  perform pg_advisory_xact_lock(hashtext('team_link:' || p_org_id::text));
  select l.role into v_role from public.org_invite_links l
   where l.org_id = p_org_id and l.revoked_at is null;
  update public.org_invite_links l set revoked_at = now()
   where l.org_id = p_org_id and l.revoked_at is null;
  return public._team_link_make(p_org_id, v_role);
end;
$$;

-- What a team link leads to, for the page before sign-in (as
-- peek_workspace_invite_link, 0450:247). Never says who is in it.
create or replace function public.peek_team_link(p_token uuid)
returns table (status text, team_name text, role text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_name text;
  v_role text;
begin
  select o.name, l.role into v_name, v_role
    from public.org_invite_links l
    join public.organizations o on o.id = l.org_id
   where l.token = p_token;
  if not found then
    return query select 'not_found'::text, null::text, null::text;
    return;
  end if;
  if not public._team_link_live(p_token) then
    return query select 'off'::text, null::text, null::text;
    return;
  end if;
  return query select 'ok'::text, public._safe_label(v_name, 60, 'a team'), v_role;
end;
$$;

-- Join by the team link. A member link admits by the admins' rule
-- (_team_admit); when full, the person comes in as a viewer and the admins
-- get a request (status 'requested'). Every join counts toward the link's
-- uses, as on a workspace link. Someone an admin removed is refused
-- ('removed'): only an admin's invite brings them back.
create or replace function public.claim_team_link(p_token uuid)
returns table (org_id uuid, role text, status text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid    uuid := auth.uid();
  v_org    uuid;
  v_link   public.org_invite_links%rowtype;
  v_role   text;
  v_admit  text;
  v_status text;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  -- Which team, read before its seat lock; then the link row, locked and
  -- read again under it: one join at a time per link, so the use count is exact.
  select l.org_id into v_org from public.org_invite_links l where l.token = p_token;
  if v_org is null then
    return query select null::uuid, null::text, 'not_found'::text;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('team_seats:' || v_org::text));
  select * into v_link from public.org_invite_links l where l.token = p_token for update;
  if not public._team_link_live(p_token) then
    return query select null::uuid, null::text, 'off'::text;
    return;
  end if;
  v_role := public._org_role(v_link.org_id, v_uid);
  if v_role is not null then
    return query select v_link.org_id, v_role, 'already'::text;
    return;
  end if;
  if exists (select 1 from public.org_removals x where x.org_id = v_link.org_id and x.user_id = v_uid) then
    return query select v_link.org_id, null::text, 'removed'::text;
    return;
  end if;

  if v_link.role = 'viewer' then
    v_role := 'viewer';
    v_status := 'joined';
  else
    v_admit := public._team_admit(v_link.org_id, v_uid, null);
    -- 'already' through the address alone (an invite waiting for it holds
    -- the seat, not this account): that seat is taken only by proving the inbox.
    if v_admit = 'already' and not public._session_proves_inbox()
       and not exists (select 1 from public._team_seat_slots(v_link.org_id) s where s.user_id = v_uid) then
      v_admit := 'full';
    end if;
    if v_admit in ('ok', 'already') then
      v_role := 'member';
      v_status := 'joined';
    else
      v_role := 'viewer';
      v_status := 'requested';
    end if;
  end if;
  insert into public.org_members (org_id, user_id, role, joined_via, invited_by)
  values (v_link.org_id, v_uid, v_role, 'link', v_link.created_by)
  on conflict (org_id, user_id) do nothing;
  insert into public.org_invite_link_joins (token, user_id)
  values (v_link.token, v_uid)
  on conflict do nothing;
  if v_status = 'requested' then
    perform public._team_request(v_link.org_id, v_uid, 'member', 'team_link', null, null);
  end if;
  perform public._team_event(v_uid, 'team_joined',
    jsonb_build_object('org_id', v_link.org_id, 'via', 'team_link', 'status', v_status, 'role', v_role));
  return query select v_link.org_id, v_role, v_status;
end;
$$;

-- ── 8. Company domains ──────────────────────────────────────────────────────

-- Proven by a TXT record on the domain itself, soleil-verification=<token>
-- (decision 13). S4's Worker checks DNS and calls team_domain_mark_verified.
create or replace function public.add_team_domain(p_org_id uuid, p_domain text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain text := public._team_norm_domain(p_domain);
  v_row    public.org_domains%rowtype;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  if v_domain is null or char_length(v_domain) > 253
     or v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    raise exception 'that isn''t a domain' using errcode = '22023', hint = 'team_domain_invalid';
  end if;
  if public._freemail_domain(v_domain) then
    raise exception 'a free email domain can''t be a team''s' using errcode = '22023', hint = 'team_domain_freemail';
  end if;
  if exists (select 1 from public.org_domains d
              where d.domain = v_domain and d.verified_at is not null and d.org_id <> p_org_id) then
    raise exception 'another team has verified that domain' using errcode = '22023', hint = 'team_domain_taken';
  end if;
  if not exists (select 1 from public.org_domains d where d.org_id = p_org_id and d.domain = v_domain)
     and (select count(*) from public.org_domains d where d.org_id = p_org_id) >= 10 then
    raise exception 'a team can have 10 domains' using errcode = '22023';
  end if;
  insert into public.org_domains (org_id, domain, created_by)
  values (p_org_id, v_domain, auth.uid())
  on conflict (org_id, domain) do nothing;
  select * into v_row from public.org_domains d where d.org_id = p_org_id and d.domain = v_domain;
  return jsonb_build_object('domain', v_row.domain,
                            'txt_name', v_row.domain,
                            'txt_value', 'soleil-verification=' || v_row.verify_token,
                            'verified', v_row.verified_at is not null);
end;
$$;

create or replace function public.set_team_domain_on(p_org_id uuid, p_domain text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  if p_on is null then
    raise exception 'on or off' using errcode = '22023';
  end if;
  update public.org_domains d set join_on = p_on
   where d.org_id = p_org_id and d.domain = public._team_norm_domain(p_domain);
end;
$$;

create or replace function public.remove_team_domain(p_org_id uuid, p_domain text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  delete from public.org_domains d
   where d.org_id = p_org_id and d.domain = public._team_norm_domain(p_domain);
end;
$$;

-- Service role only: the Worker's DNS check. p_ok = true: the TXT record
-- carries p_token, and it is still this row's verify_token, so a re-check
-- can't verify a row whose token has changed (the unique index
-- org_domains_verified_once refuses a domain another team verified first).
-- p_ok = false: a failed daily re-check clears verified_at whatever the
-- token, which pauses auto-join until it passes again.
create or replace function public.team_domain_mark_verified(p_org_id uuid, p_domain text, p_ok boolean default true,
                                                            p_token text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if not coalesce(p_ok, true) then
    update public.org_domains d
       set verified_at = null
     where d.org_id = p_org_id and d.domain = public._team_norm_domain(p_domain);
    return false;
  end if;
  begin
    update public.org_domains d
       set verified_at = coalesce(d.verified_at, now())
      from public.organizations o
     where o.id = d.org_id and o.closed_at is null
       and d.org_id = p_org_id and d.domain = public._team_norm_domain(p_domain)
       and p_token is not null and d.verify_token = p_token
    returning true into v_ok;
  exception when unique_violation then
    raise exception 'another team has verified that domain' using errcode = '23505', hint = 'team_domain_taken';
  end;
  return coalesce(v_ok, false);
end;
$$;

-- The teams whose verified company domain is the caller's address domain,
-- asked once (no org_domain_answers row yet), never to someone an admin
-- removed. 'auto' when the account was made after the domain was verified
-- (new accounts join), else 'ask'. Reads only the caller: admins never learn
-- who has an account. It runs at every boot, so a session that hasn't
-- proved the inbox is offered nothing and told nothing; answer_team_offer,
-- a deliberate click, says why.
create or replace function public.my_team_offers()
returns table (org_id uuid, name text, letter text, color text, mode text)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._session_proves_inbox() then
    return;
  end if;
  if public._is_service_identity(auth.uid()) then
    return;
  end if;
  return query
  select o.id, o.name, upper(left(btrim(o.name), 1)), o.color,
         case when u.created_at > d.verified_at then 'auto' else 'ask' end
    from auth.users u
    join public.org_domains d
      on d.domain = split_part(lower(u.email), '@', 2)
     and d.verified_at is not null and d.join_on
    join public.organizations o on o.id = d.org_id and o.closed_at is null
   where u.id = auth.uid()
     and not public._user_banned(o.owner_id)
     and not exists (select 1 from public.org_members m where m.org_id = o.id and m.user_id = u.id)
     and not exists (select 1 from public.org_domain_answers a where a.org_id = o.id and a.user_id = u.id)
     and not exists (select 1 from public.org_removals x where x.org_id = o.id and x.user_id = u.id);
end;
$$;

create or replace function public.answer_team_offer(p_org_id uuid, p_join boolean)
returns table (org_id uuid, role text, status text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_admit text;
  v_role  text;
  v_status text;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._session_proves_inbox() then
    raise exception 'sign in with a code sent to this address first' using errcode = '42501', hint = 'team_inbox_unproven';
  end if;
  if p_join is null then
    raise exception 'join or not' using errcode = '22023';
  end if;
  if not exists (select 1 from public.my_team_offers() x where x.org_id = p_org_id) then
    raise exception 'that team isn''t offering you a place' using errcode = '42501';
  end if;
  -- The team's seat lock before anything is written, and the offer again under it.
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org_id::text));
  if not exists (select 1 from public.my_team_offers() x where x.org_id = p_org_id) then
    raise exception 'that team isn''t offering you a place' using errcode = '42501';
  end if;
  insert into public.org_domain_answers (org_id, user_id, answer)
  values (p_org_id, v_uid, case when p_join then 'joined' else 'declined' end)
  on conflict (org_id, user_id) do nothing;
  if not p_join then
    return query select p_org_id, null::text, 'declined'::text;
    return;
  end if;

  v_admit := public._team_admit(p_org_id, v_uid, null);
  if v_admit in ('ok', 'already') then
    v_role := 'member';
    v_status := 'joined';
  else
    v_role := 'viewer';
    v_status := 'requested';
  end if;
  insert into public.org_members (org_id, user_id, role, joined_via)
  values (p_org_id, v_uid, v_role, 'domain')
  on conflict (org_id, user_id) do nothing;
  if v_status = 'requested' then
    perform public._team_request(p_org_id, v_uid, 'member', 'domain', null, null);
  end if;
  perform public._team_event(v_uid, 'team_joined',
    jsonb_build_object('org_id', p_org_id, 'via', 'domain', 'status', v_status, 'role', v_role));
  return query select p_org_id, v_role, v_status;
end;
$$;

-- ── 9. Requests ─────────────────────────────────────────────────────────────

-- A viewer asks to edit (decision 10, amendment C). Never grants, even with a
-- seat free: an admin made them a viewer.
create or replace function public.ask_team_for_edit(p_workspace_id uuid, p_board_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_org     uuid;
  v_bws     uuid;
  v_existed boolean;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  select w.org_id into v_org
    from public.workspaces w
    join public.organizations o on o.id = w.org_id and o.closed_at is null
   where w.id = p_workspace_id;
  if v_org is null then
    return 'not_in_team';
  end if;
  if p_board_id is not null then
    select b.workspace_id into v_bws from public.boards b where b.id = p_board_id and b.deleted_at is null;
    if v_bws is distinct from p_workspace_id then
      raise exception 'that cluster isn''t in this workspace' using errcode = '22023';
    end if;
    if not public.can_read_board(p_board_id) then
      raise exception 'you do not have access to this cluster' using errcode = '42501';
    end if;
    if public.can_write_board(p_board_id) then
      return 'can_edit';
    end if;
  else
    if not public.is_workspace_member(p_workspace_id) then
      raise exception 'you do not have access to this workspace' using errcode = '42501';
    end if;
    if public._workspace_member_can_write(p_workspace_id) then
      return 'can_edit';
    end if;
  end if;

  v_existed := exists (select 1 from public.org_join_requests r
                        where r.org_id = v_org and r.user_id = v_uid and r.status = 'pending');
  perform public._team_request(v_org, v_uid,
                               case when p_board_id is not null then 'board_editor' else 'workspace_editor' end,
                               'ask', p_workspace_id, p_board_id);
  return case when v_existed then 'already_sent' else 'sent' end;
end;
$$;

-- An admin approves: a seat (the one they hold, a free one, or the one the
-- admin says to add), then the grant asked for.
create or replace function public.approve_team_request(p_request_id uuid, p_add_seat boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_org  uuid;
  v_r    public.org_join_requests%rowtype;
  v_team text;
  v_ws   uuid;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  select r.org_id into v_org from public.org_join_requests r where r.id = p_request_id;
  if v_org is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not public._org_is_admin(v_org, v_uid) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(v_org, v_uid) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  -- The team's seat lock, then the request row, read again under it.
  perform pg_advisory_xact_lock(hashtext('team_seats:' || v_org::text));
  select * into v_r from public.org_join_requests r where r.id = p_request_id for update;
  if v_r.status <> 'pending' then
    return v_r.status;
  end if;
  -- A banned account's request ends here (returned, not raised: a raise
  -- would undo the cancel).
  if public._user_banned(v_r.user_id) then
    update public.org_join_requests r set status = 'cancelled', decided_at = now(), decided_by = v_uid
     where r.id = v_r.id;
    return 'cancelled';
  end if;

  perform public._team_seat_for(v_r.org_id, v_r.user_id, coalesce(p_add_seat, false), 'approve', 'team_seats_full');

  perform set_config('soleil.quiet_member_email', '1', true);
  if v_r.wanted = 'member' then
    insert into public.org_members (org_id, user_id, role, joined_via, invited_by)
    values (v_r.org_id, v_r.user_id, 'member', 'request', v_uid)
    on conflict (org_id, user_id) do update set role = 'member' where org_members.role = 'viewer';
  elsif v_r.wanted = 'workspace_editor' then
    if not exists (select 1 from public.workspaces w where w.id = v_r.workspace_id and w.org_id = v_r.org_id) then
      raise exception 'that workspace is no longer in the team' using errcode = '22023';
    end if;
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_r.workspace_id, v_r.user_id, 'editor')
    on conflict (workspace_id, user_id) do update set role = 'editor' where workspace_members.role = 'viewer';
  else
    select b.workspace_id into v_ws
      from public.boards b join public.workspaces w on w.id = b.workspace_id
     where b.id = v_r.board_id and b.deleted_at is null and w.org_id = v_r.org_id;
    if v_ws is null then
      raise exception 'that cluster is no longer in the team' using errcode = '22023';
    end if;
    insert into public.board_shares (board_id, user_id, role, invited_by)
    values (v_r.board_id, v_r.user_id, 'editor', v_uid)
    on conflict (board_id, user_id) do update set role = 'editor' where board_shares.role = 'viewer';
  end if;

  update public.org_join_requests r
     set status = 'approved', decided_at = now(), decided_by = v_uid
   where r.id = v_r.id;

  select o.name into v_team from public.organizations o where o.id = v_r.org_id;
  perform public._team_notify(v_r.user_id, 'team.request_approved', v_r.org_id,
    coalesce(v_r.workspace_id, v_ws), v_uid,
    'You can edit now',
    format('%s approved your request.',
           coalesce('“' || public._safe_label(v_team, 60, '') || '”', 'Your team')));
  return 'approved';
end;
$$;

create or replace function public.keep_team_request_viewer(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  select r.org_id into v_org from public.org_join_requests r where r.id = p_request_id;
  if v_org is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not public._org_is_admin(v_org, auth.uid()) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(v_org, auth.uid()) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  update public.org_join_requests r
     set status = 'kept', decided_at = now(), decided_by = auth.uid()
   where r.id = p_request_id and r.status = 'pending';
end;
$$;

-- ── 10. Closing ─────────────────────────────────────────────────────────────

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

-- ── 11. Grants (0311) ───────────────────────────────────────────────────────

revoke execute on function public._team_person_name(uuid, boolean) from public, anon, authenticated;
revoke execute on function public._team_notify(uuid, text, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public._team_event(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public._team_seat_for(uuid, uuid, boolean, text, text) from public, anon, authenticated;
revoke execute on function public._team_norm_domain(text) from public, anon, authenticated;
revoke execute on function public._workspace_set_owner(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._org_move_in(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._org_remove_person(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._team_link_live(uuid) from public, anon, authenticated;
revoke execute on function public._team_link_make(uuid, text) from public, anon, authenticated;
revoke execute on function public._tg_workspace_member_email() from public, anon, authenticated;

-- Service role only (S4's DNS check in the Worker).
revoke execute on function public.team_domain_mark_verified(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.team_domain_mark_verified(uuid, text, boolean, text) to service_role;

revoke execute on function public.create_team(text, text, uuid[], integer) from public, anon;
revoke execute on function public.rename_team(uuid, text, text) from public, anon;
revoke execute on function public.create_team_workspace(uuid, text, text, boolean) from public, anon;
revoke execute on function public.preview_move_into_team(uuid, uuid) from public, anon;
revoke execute on function public.move_workspace_into_team(uuid, uuid, boolean) from public, anon;
revoke execute on function public.move_workspace_out_of_team(uuid, uuid) from public, anon;
revoke execute on function public.set_team_workspace_private(uuid, boolean) from public, anon;
revoke execute on function public.invite_to_team(uuid, text[], text, boolean) from public, anon;
revoke execute on function public.revoke_team_invite(uuid) from public, anon;
revoke execute on function public.accept_team_invite(uuid) from public, anon;
revoke execute on function public.claim_my_team_invites() from public, anon;
revoke execute on function public.set_team_role(uuid, uuid, text, boolean) from public, anon;
revoke execute on function public.remove_from_team(uuid, uuid) from public, anon;
revoke execute on function public.leave_team(uuid) from public, anon;
revoke execute on function public.add_team_seats(uuid, integer) from public, anon;
revoke execute on function public.remove_team_seat(uuid) from public, anon;
revoke execute on function public.set_team_when_full(uuid, text, integer) from public, anon;
revoke execute on function public.set_team_seat_perk(uuid, boolean) from public, anon;
revoke execute on function public.set_team_link(uuid, boolean, text) from public, anon;
revoke execute on function public.reset_team_link(uuid) from public, anon;
revoke execute on function public.peek_team_link(uuid) from public, anon;
revoke execute on function public.claim_team_link(uuid) from public, anon;
revoke execute on function public.add_team_domain(uuid, text) from public, anon;
revoke execute on function public.set_team_domain_on(uuid, text, boolean) from public, anon;
revoke execute on function public.remove_team_domain(uuid, text) from public, anon;
revoke execute on function public.my_team_offers() from public, anon;
revoke execute on function public.answer_team_offer(uuid, boolean) from public, anon;
revoke execute on function public.ask_team_for_edit(uuid, uuid) from public, anon;
revoke execute on function public.approve_team_request(uuid, boolean) from public, anon;
revoke execute on function public.keep_team_request_viewer(uuid) from public, anon;
revoke execute on function public.close_team(uuid) from public, anon;

grant execute on function public.create_team(text, text, uuid[], integer) to authenticated;
grant execute on function public.rename_team(uuid, text, text) to authenticated;
grant execute on function public.create_team_workspace(uuid, text, text, boolean) to authenticated;
grant execute on function public.preview_move_into_team(uuid, uuid) to authenticated;
grant execute on function public.move_workspace_into_team(uuid, uuid, boolean) to authenticated;
grant execute on function public.move_workspace_out_of_team(uuid, uuid) to authenticated;
grant execute on function public.set_team_workspace_private(uuid, boolean) to authenticated;
grant execute on function public.invite_to_team(uuid, text[], text, boolean) to authenticated;
grant execute on function public.revoke_team_invite(uuid) to authenticated;
grant execute on function public.accept_team_invite(uuid) to authenticated;
grant execute on function public.claim_my_team_invites() to authenticated;
grant execute on function public.set_team_role(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.remove_from_team(uuid, uuid) to authenticated;
grant execute on function public.leave_team(uuid) to authenticated;
grant execute on function public.add_team_seats(uuid, integer) to authenticated;
grant execute on function public.remove_team_seat(uuid) to authenticated;
grant execute on function public.set_team_when_full(uuid, text, integer) to authenticated;
grant execute on function public.set_team_seat_perk(uuid, boolean) to authenticated;
grant execute on function public.set_team_link(uuid, boolean, text) to authenticated;
grant execute on function public.reset_team_link(uuid) to authenticated;
grant execute on function public.peek_team_link(uuid) to authenticated;
grant execute on function public.claim_team_link(uuid) to authenticated;
grant execute on function public.add_team_domain(uuid, text) to authenticated;
grant execute on function public.set_team_domain_on(uuid, text, boolean) to authenticated;
grant execute on function public.remove_team_domain(uuid, text) to authenticated;
grant execute on function public.my_team_offers() to authenticated;
grant execute on function public.answer_team_offer(uuid, boolean) to authenticated;
grant execute on function public.ask_team_for_edit(uuid, uuid) to authenticated;
grant execute on function public.approve_team_request(uuid, boolean) to authenticated;
grant execute on function public.keep_team_request_viewer(uuid) to authenticated;
grant execute on function public.close_team(uuid) to authenticated;

-- The link's preview page runs before sign-in (as peek_workspace_invite_link).
grant execute on function public.peek_team_link(uuid) to anon;

-- ── 12. Proofs (the 0311 habit: a REVOKE reporting success proves nothing) ──

do $$
declare
  v_fn text;
begin
  -- The security session's helpers this file calls are live first (Task 9):
  -- a plpgsql body binds what it calls only when it runs, so nothing else
  -- here would notice them missing.
  if to_regprocedure('public._session_proves_inbox()') is null
     or to_regprocedure('public._offboard_member(uuid,uuid)') is null then
    raise exception '0532: _session_proves_inbox() and _offboard_member(uuid, uuid) must be live first';
  end if;
  foreach v_fn in array array['public._session_proves_inbox()', 'public._offboard_member(uuid,uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0532: % is client-executable', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public._team_person_name(uuid,boolean)',
    'public._team_notify(uuid,text,uuid,uuid,uuid,text,text)',
    'public._team_event(uuid,text,jsonb)',
    'public._team_seat_for(uuid,uuid,boolean,text,text)',
    'public._team_norm_domain(text)',
    'public._workspace_set_owner(uuid,uuid)',
    'public._org_move_in(uuid,uuid,uuid,boolean)',
    'public._org_remove_person(uuid,uuid,boolean)',
    'public._team_link_live(uuid)',
    'public._team_link_make(uuid,text)',
    'public._tg_workspace_member_email()',
    'public.team_domain_mark_verified(uuid,text,boolean,text)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0532: % is client-executable', v_fn;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.team_domain_mark_verified(uuid,text,boolean,text)', 'execute') then
    raise exception '0532: the Worker (service role) cannot mark a domain verified';
  end if;

  foreach v_fn in array array[
    'public.create_team(text,text,uuid[],integer)',
    'public.rename_team(uuid,text,text)',
    'public.create_team_workspace(uuid,text,text,boolean)',
    'public.preview_move_into_team(uuid,uuid)',
    'public.move_workspace_into_team(uuid,uuid,boolean)',
    'public.move_workspace_out_of_team(uuid,uuid)',
    'public.set_team_workspace_private(uuid,boolean)',
    'public.invite_to_team(uuid,text[],text,boolean)',
    'public.revoke_team_invite(uuid)',
    'public.accept_team_invite(uuid)',
    'public.claim_my_team_invites()',
    'public.set_team_role(uuid,uuid,text,boolean)',
    'public.remove_from_team(uuid,uuid)',
    'public.leave_team(uuid)',
    'public.add_team_seats(uuid,integer)',
    'public.remove_team_seat(uuid)',
    'public.set_team_when_full(uuid,text,integer)',
    'public.set_team_seat_perk(uuid,boolean)',
    'public.set_team_link(uuid,boolean,text)',
    'public.reset_team_link(uuid)',
    'public.claim_team_link(uuid)',
    'public.add_team_domain(uuid,text)',
    'public.set_team_domain_on(uuid,text,boolean)',
    'public.remove_team_domain(uuid,text)',
    'public.my_team_offers()',
    'public.answer_team_offer(uuid,boolean)',
    'public.ask_team_for_edit(uuid,uuid)',
    'public.approve_team_request(uuid,boolean)',
    'public.keep_team_request_viewer(uuid)',
    'public.close_team(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0532: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0532: % is not callable signed in', v_fn;
    end if;
  end loop;

  if not has_function_privilege('anon', 'public.peek_team_link(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.peek_team_link(uuid)', 'execute') then
    raise exception '0532: the team link preview must work signed out and signed in';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_team_person_name', '_team_notify', '_team_event', '_team_seat_for',
                                  '_team_norm_domain', '_workspace_set_owner', '_org_move_in',
                                  '_org_remove_person', '_tg_workspace_member_email',
                                  '_team_link_live', '_team_link_make',
                                  'create_team', 'rename_team', 'create_team_workspace',
                                  'preview_move_into_team', 'move_workspace_into_team',
                                  'move_workspace_out_of_team', 'set_team_workspace_private',
                                  'invite_to_team', 'revoke_team_invite', 'accept_team_invite',
                                  'claim_my_team_invites', 'set_team_role', 'remove_from_team',
                                  'leave_team', 'add_team_seats', 'remove_team_seat',
                                  'set_team_when_full', 'set_team_seat_perk', 'set_team_link',
                                  'reset_team_link', 'peek_team_link', 'claim_team_link',
                                  'add_team_domain', 'set_team_domain_on', 'remove_team_domain',
                                  'team_domain_mark_verified', 'my_team_offers', 'answer_team_offer',
                                  'ask_team_for_edit', 'approve_team_request',
                                  'keep_team_request_viewer', 'close_team')
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
