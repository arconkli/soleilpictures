-- 0533: Teams, part 5 — people and seats.
--
-- STATUS: written 2026-10-22. Applied 2026-10-22 (owner's go), teams closed.
-- Live as migrations 20261022085817 teams_people_part1 through 20261022093833
-- teams_people_part4c_proofs: the MCP refused calls this size, so it went in at function
-- boundaries, each part one transaction carrying its functions' grants,
-- the proof block last. Its 13 function bodies match this file by md5.
--
-- The second of the three team RPC files (0532 a team and its workspaces,
-- 0533 people and seats, 0534 joining), applied after 0532, whose internals
-- it calls (_team_notify, _team_event): invite people, take an invite,
-- change a role, remove someone, leave; add and drop seats, the when-full
-- rule, the seat perk. Who may do what, the lock order and the notices are
-- in 0532's header: the team lock comes before any seat arithmetic and any
-- row lock, and what was read before it is read again under it. An admin's
-- own action never consults the when-full rule: it adds a seat only when it
-- says so (p_add_seats), after the app has shown the price.
--
-- From the security audit (main session, 2026-10-22):
--   * an invite is taken only from a session that proved its inbox
--     (public._session_proves_inbox(), the security session's; hint
--     team_inbox_unproven);
--   * whoever loses team-derived access is offboarded first
--     (public._offboard_member(ws, user), the security session's Phase 1).
--
-- From the adversarial review (main session, 2026-10-22; amendment G):
--   * every address gets an invite, never a place by itself: an account that
--     already has the address joins only by taking the invite from a session
--     that proved the inbox, and invite_to_team's answer never says whether
--     an account exists;
--   * a removal sticks: invites waiting for the address end, the domain
--     offer isn't made again, and the team link (0534) refuses someone an
--     admin removed (org_removals) until an admin's invite brings them back;
--   * an admin made a member or a viewer is offboarded from the private
--     workspaces they opened only as an admin.
--
-- An invite tells no account anything: S2a sends no email, and S4 adds the
-- template under the 0369 breaker and the invite budget. Notification kind:
-- team.removed. Analytics server event: team_joined. Never a token (0474).

begin;

-- ── 1. Internals ────────────────────────────────────────────────────────────

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

-- ── 2. People ───────────────────────────────────────────────────────────────

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
  v_ws     uuid;
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
  -- An admin made a member or a viewer stops reaching the team's private
  -- workspaces, so what they set up there goes, before the role (and maybe the
  -- seat) changes (requirement 3; set_team_workspace_private does the same).
  -- Where they still reach a workspace, a lower role takes nothing, as
  -- set_workspace_member_role.
  if v_target = 'admin' then
    for v_ws in
      select w.id from public.workspaces w
       where w.org_id = p_org_id and w.org_visibility = 'private'
         and not exists (select 1 from public.workspace_members wm
                          where wm.workspace_id = w.id and wm.user_id = p_user_id)
    loop
      perform public._offboard_member(v_ws, p_user_id);
    end loop;
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

-- ── 3. Seats and the when-full rule ─────────────────────────────────────────

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

-- ── 4. Grants (0311) ────────────────────────────────────────────────────────

revoke execute on function public._team_seat_for(uuid, uuid, boolean, text, text) from public, anon, authenticated;
revoke execute on function public._org_remove_person(uuid, uuid, boolean) from public, anon, authenticated;

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

-- ── 5. Proofs (the 0311 habit: a REVOKE reporting success proves nothing) ──

do $$
declare
  v_fn text;
begin
  -- What this file calls of the security session's is live first, and
  -- server-only (Task 9): a plpgsql body binds what it calls only when it
  -- runs, so nothing else here would notice it missing.
  foreach v_fn in array array['public._session_proves_inbox()', 'public._offboard_member(uuid,uuid)'] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0533 needs the security session''s % live first', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0533: % is client-executable', v_fn;
    end if;
  end loop;
  -- 0532's internals, which this file calls, are live first.
  foreach v_fn in array array[
    'public._team_notify(uuid,text,uuid,uuid,uuid,text,text)',
    'public._team_event(uuid,text,jsonb)'] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0533 needs % (0532) live first', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public._team_seat_for(uuid,uuid,boolean,text,text)',
    'public._org_remove_person(uuid,uuid,boolean)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0533: % is client-executable', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
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
    'public.set_team_seat_perk(uuid,boolean)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0533: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0533: % is not callable signed in', v_fn;
    end if;
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_team_seat_for', '_org_remove_person', 'invite_to_team',
                                  'revoke_team_invite', 'accept_team_invite',
                                  'claim_my_team_invites', 'set_team_role', 'remove_from_team',
                                  'leave_team', 'add_team_seats', 'remove_team_seat',
                                  'set_team_when_full', 'set_team_seat_perk')
              group by p.proname having count(*) > 1) then
    raise exception '0533: an overload exists (PGRST203)';
  end if;

  -- Applying this changes nothing for anyone: no team exists.
  if exists (select 1 from public.organizations) then
    raise exception '0533: an organization exists';
  end if;
end $$;

commit;
