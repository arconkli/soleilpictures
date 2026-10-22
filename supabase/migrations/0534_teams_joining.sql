-- 0534: Teams, part 6 — joining: the team link, company domains, requests.
--
-- STATUS: written 2026-10-22. NOT APPLIED until the owner says go.
--
-- The last of the three team RPC files (0532 a team and its workspaces,
-- 0533 people and seats, 0534 joining), applied after both, whose internals
-- it calls (_team_notify and _team_event, 0532; _team_seat_for, 0533).
-- Joiners (link, domain) go through _team_admit (0531), which follows the
-- when-full rule; an admin approving a request adds a seat only when they
-- say so (p_add_seat), after the app has shown the price. Who may do what,
-- the lock order and the notices are in 0532's header: the team lock first,
-- then rows, and what was read before it is read again under it.
--
-- From the security audit (main session, 2026-10-22):
--   * the team link lives in org_invite_links / org_invite_link_joins (0522),
--     live by _team_link_live, a mirror of _workspace_invite_link_live (0450),
--     with create_workspace_invite_link's uses and expiry;
--   * a domain offer is taken, and a seat an invite holds for the address is
--     used through the link, only from a session that proved its inbox
--     (public._session_proves_inbox(), the security session's; hint
--     team_inbox_unproven);
--   * team_domain_mark_verified(…, p_ok => false) un-verifies a domain whose
--     daily re-check failed, which pauses auto-join.
--
-- From the adversarial review (main session, 2026-10-22; amendment G): the
-- team link refuses someone an admin removed (org_removals, 0533) until an
-- admin's invite brings them back, and the domain offer isn't made to them
-- again.
--
-- Requests: _team_request (0531, amendment D) is the one core; claim_team_link,
-- answer_team_offer and ask_team_for_edit call it and nothing here defines it.
-- An approval's member row is quiet (soleil.quiet_member_email, as 0532's).
-- Notification kind: team.request_approved. Analytics server event:
-- team_joined. Never a token (0474).

begin;

-- ── 1. The team link ────────────────────────────────────────────────────────

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

-- ── 2. Company domains ──────────────────────────────────────────────────────

-- A company domain as typed ("@Acme.com.", " acme.com") → "acme.com".
create or replace function public._team_norm_domain(p_domain text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(regexp_replace(regexp_replace(lower(btrim(coalesce(p_domain, ''))), '^.*@', ''), '\.+$', ''), '');
$$;

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

-- ── 3. Requests ─────────────────────────────────────────────────────────────

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

-- ── 4. Grants (0311) ────────────────────────────────────────────────────────

revoke execute on function public._team_norm_domain(text) from public, anon, authenticated;
revoke execute on function public._team_link_live(uuid) from public, anon, authenticated;
revoke execute on function public._team_link_make(uuid, text) from public, anon, authenticated;

-- Service role only (S4's DNS check in the Worker).
revoke execute on function public.team_domain_mark_verified(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.team_domain_mark_verified(uuid, text, boolean, text) to service_role;

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

-- The link's preview page runs before sign-in (as peek_workspace_invite_link).
grant execute on function public.peek_team_link(uuid) to anon;

-- ── 5. Proofs (the 0311 habit: a REVOKE reporting success proves nothing) ──

do $$
declare
  v_fn text;
begin
  -- What this file calls of the security session's is live first, and
  -- server-only (Task 9): a plpgsql body binds what it calls only when it
  -- runs, so nothing else here would notice it missing.
  foreach v_fn in array array['public._session_proves_inbox()'] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0534 needs the security session''s % live first', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0534: % is client-executable', v_fn;
    end if;
  end loop;
  -- 0532's and 0533's internals, which this file calls, are live first.
  foreach v_fn in array array[
    'public._team_notify(uuid,text,uuid,uuid,uuid,text,text)',
    'public._team_event(uuid,text,jsonb)',
    'public._team_seat_for(uuid,uuid,boolean,text,text)'] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0534 needs % (0532, 0533) live first', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public._team_link_live(uuid)',
    'public._team_link_make(uuid,text)',
    'public._team_norm_domain(text)',
    'public.team_domain_mark_verified(uuid,text,boolean,text)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0534: % is client-executable', v_fn;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.team_domain_mark_verified(uuid,text,boolean,text)', 'execute') then
    raise exception '0534: the Worker (service role) cannot mark a domain verified';
  end if;

  foreach v_fn in array array[
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
    'public.keep_team_request_viewer(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0534: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0534: % is not callable signed in', v_fn;
    end if;
  end loop;

  if not has_function_privilege('anon', 'public.peek_team_link(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.peek_team_link(uuid)', 'execute') then
    raise exception '0534: the team link preview must work signed out and signed in';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_team_link_live', '_team_link_make', 'set_team_link',
                                  'reset_team_link', 'peek_team_link', 'claim_team_link',
                                  '_team_norm_domain', 'add_team_domain', 'set_team_domain_on',
                                  'remove_team_domain', 'team_domain_mark_verified',
                                  'my_team_offers', 'answer_team_offer', 'ask_team_for_edit',
                                  'approve_team_request', 'keep_team_request_viewer')
              group by p.proname having count(*) > 1) then
    raise exception '0534: an overload exists (PGRST203)';
  end if;

  -- Applying this changes nothing for anyone: no team exists.
  if exists (select 1 from public.organizations) then
    raise exception '0534: an organization exists';
  end if;
end $$;

commit;
