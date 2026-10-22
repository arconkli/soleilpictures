-- 0531: Teams, part 3 — seats, and the team branch of the editor limit.
--
-- STATUS: written 2026-10-22. NOT APPLIED until the owner says go.
--
-- A Team pays per seat. What holds a seat (the analog of 0520's
-- _account_editor_slots):
--   * the team's owner, admins and members (never its viewers);
--   * explicit editors in the team's workspaces: workspace_members owner,
--     coowner, admin or editor, and editor shares on live clusters, guests
--     included;
--   * editor invites still waiting on an address in a team workspace (0520's
--     filters: unclaimed, unexpired, not held by the breaker, sender not
--     suspended, cluster live);
--   * open team invites for an admin or a member.
-- Banned and service identities never. One seat per person; an address holds
-- one only when no account with that address already does.
--
-- When every seat is taken, the admins' rule (organizations.when_full):
--   * 'auto' adds what's needed, within their monthly number if they set one,
--     and never past the self-serve ceiling (organizations.seat_ceiling,
--     amendment B), where it answers 'full' instead;
--   * 'ask' answers 'full', and the door decides: refuse with a hint, or let
--     them in as a viewer with a request to the admins.
--
-- _org_add_seats is the one writer of organizations.seats in S2a; every
-- change is a row in org_seat_changes, which S3 bills (billed_at).
--
-- _team_request is the one request core (amendment D): 0534's RPCs call it,
-- and no later migration re-defines it.
--
-- The S1 helpers each gain a team branch, so S1's six doors (0521) admit by
-- seat without being touched. Each is its live body (pg_get_functiondef, read
-- 2026-10-22, the same text as 0520_editor_limit_core.sql) with the lines
-- marked 0531 and nothing else changed. Rebased on: the md5 of each live
-- prosrc, which Task 9 compares with live before applying (amendment F):
--   _account_editor_grants     personal accounts count personal workspaces only    acde04cbb8748d254da957fa1098444a
--   _editor_admit              a team workspace asks _team_admit                   8c15d9effd2bf89756f8f42a24fd76f5
--   _editor_refuse             team hints: team_seats_full / team_seats_ask_admin  9d4b6a89a2c92373f6cb3df3525872c9
--   _editor_limit_fallback     a team workspace asks the team's admins             f74faaac19de02b6d9986faa8763552e
--   get_editor_capacity        subject 'team': seats, not the personal limit       5e42d0af1ba7f41d4d0873843f41080d
--   ask_owner_for_editor_slot  asks the team's owner and admins                    b7661e00512cb018ce9b2c6c613e6ded
--
-- Notification kinds written here: team.join_request (to the owner and
-- admins), team.joined_as_viewer (to the joiner), team.seats_full (to the
-- owner and admins). Analytics: team_seat_viewer_fallback.

begin;

-- ── 1. Who's who in a team ──────────────────────────────────────────────────

create or replace function public._org_role(p_org uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.org_members m
    join public.organizations o on o.id = m.org_id and o.closed_at is null
   where m.org_id = p_org and m.user_id = p_user;
$$;

create or replace function public._org_is_admin(p_org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public._org_role(p_org, p_user) in ('owner', 'admin'), false);
$$;

-- ── 2. Who holds a seat ─────────────────────────────────────────────────────

-- Every grant of editing in the team, one row per grant (as 0520's
-- _account_editor_grants). _team_seat_slots folds these to one seat per person.
create or replace function public._team_seat_grants(p_org uuid)
returns table (user_id uuid, email text, source text, workspace_id uuid, board_id uuid,
               role text, invite_id uuid, sent_at timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  with ws as (
    select w.id from public.workspaces w where w.org_id = p_org
  ),
  people as (
    select m.user_id, 'team'::text as source, null::uuid as workspace_id, null::uuid as board_id, m.role
      from public.org_members m
     where m.org_id = p_org and m.role in ('owner', 'admin', 'member')
    union all
    select m.user_id, 'member', m.workspace_id, null::uuid, m.role::text
      from public.workspace_members m
     where m.workspace_id in (select ws.id from ws)
       and m.role in ('owner', 'coowner', 'admin', 'editor')
    union all
    select s.user_id, 'share', b.workspace_id, s.board_id, s.role::text
      from public.board_shares s
      join public.boards b on b.id = s.board_id
     where b.workspace_id in (select ws.id from ws)
       and b.deleted_at is null
       and s.role = 'editor'
  )
  select u.id, lower(u.email), pp.source, pp.workspace_id, pp.board_id, pp.role, null::uuid, null::timestamptz
    from people pp
    join auth.users u on u.id = pp.user_id
   where not public._user_banned(u.id)
     and not public._is_service_identity(u.id)
  union all
  -- A waiting editor invite in a team workspace, as 0520 counts one.
  select null::uuid, lower(pi.email), 'pending', pi.workspace_id, pi.board_id, pi.role::text, pi.id, pi.created_at
    from public.pending_invites pi
   where pi.workspace_id in (select ws.id from ws)
     and pi.role in ('editor', 'workspace')
     and pi.claimed_at is null
     and pi.expires_at > now()
     and pi.held_at is null
     and not public._sharer_suspended(pi.invited_by)
     and (pi.board_id is null
          or exists (select 1 from public.boards b where b.id = pi.board_id and b.deleted_at is null))
  union all
  -- An open invite to join the team as an admin or a member.
  select null::uuid, oi.email, 'team_invite', null::uuid, null::uuid, oi.role, oi.id, oi.created_at
    from public.org_invites oi
   where oi.org_id = p_org
     and oi.role in ('admin', 'member')
     and oi.claimed_at is null
     and oi.revoked_at is null
     and oi.expires_at > now()
     and not public._sharer_suspended(oi.invited_by);
$$;

-- One seat per person: an account once (team before member before share); an
-- address once, and not at all when an account with that address holds one.
create or replace function public._team_seat_slots(p_org uuid)
returns table (slot_key text, user_id uuid, email text, source text)
language sql
stable
security definer
set search_path = public
as $$
  with g as (
    select * from public._team_seat_grants(p_org)
  ),
  accounts as (
    select distinct on (g.user_id) g.user_id, g.email, g.source
      from g
     where g.user_id is not null
     order by g.user_id, case g.source when 'team' then 0 when 'member' then 1 else 2 end
  ),
  addresses as (
    select distinct on (g.email) g.email, g.source
      from g
     where g.user_id is null
       and not exists (select 1 from accounts a where a.email = g.email)
     order by g.email, case g.source when 'team_invite' then 0 else 1 end
  )
  select 'u:' || a.user_id::text, a.user_id, a.email, a.source
    from accounts a
  union all
  select 'e:' || d.email, null::uuid, d.email, d.source
    from addresses d;
$$;

create or replace function public._team_seats_used(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public._team_seat_slots(p_org);
$$;

-- Seats the 'auto' rule added this calendar month (UTC; decision 6).
create or replace function public._team_auto_added_this_month(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(c.delta), 0)::integer
    from public.org_seat_changes c
   where c.org_id = p_org and c.reason = 'auto'
     and c.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;

-- ── 3. Adding seats, and admitting one more editor ──────────────────────────

-- The one writer of organizations.seats in S2a. S3 bills the rows (billed_at).
-- Never past the self-serve ceiling (amendment B): above it is "Talk to us".
create or replace function public._org_add_seats(p_org uuid, p_n integer, p_reason text, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats   integer;
  v_ceiling integer;
  v_after   integer;
begin
  select o.seats, o.seat_ceiling into v_seats, v_ceiling
    from public.organizations o
   where o.id = p_org and o.closed_at is null
   for update;
  if not found then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  if p_n is null or p_n = 0 then
    return v_seats;
  end if;
  if p_n > 0 and v_seats + p_n > v_ceiling then
    raise exception 'team seats ceiling: a team can have up to % seats here; talk to us for more', v_ceiling
      using errcode = '42501', hint = 'team_seats_ceiling', detail = v_ceiling::text;
  end if;
  update public.organizations set seats = seats + p_n
   where id = p_org
   returning seats into v_after;
  insert into public.org_seat_changes (org_id, delta, seats_after, reason, actor)
  values (p_org, p_n, v_after, p_reason, p_actor);
  return v_after;
end;
$$;

-- May one more person edit in this team? Free seats first. When none is
-- left, the admins' rule: 'auto' adds what's needed (within their monthly
-- number, if they set one, and the ceiling); 'ask' answers 'full', and the
-- door decides (refuse, or let them in as a viewer with a request). Never
-- raises for a full team: a claim must never break.
create or replace function public._team_admit(p_org uuid, p_user uuid, p_email text default null)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_org   public.organizations%rowtype;
  v_email text := lower(nullif(btrim(p_email), ''));
  v_used  integer;
  v_held  boolean;
  v_need  integer;
begin
  -- One admission at a time per team, so two doors can't both take the last
  -- seat. Held until the door's transaction ends. Taken before the team's row
  -- is read: a seat count read before the wait could be one an admission
  -- ahead of us already raised, and 'auto' would then buy a seat twice.
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org::text));
  select * into v_org from public.organizations where id = p_org and closed_at is null;
  if not found then return 'full'; end if;
  if v_email is null and p_user is not null then
    select lower(u.email) into v_email from auth.users u where u.id = p_user;
  end if;
  select count(*)::integer,
         coalesce(bool_or((p_user is not null and s.user_id = p_user)
                          or (v_email is not null and s.email = v_email)), false)
    into v_used, v_held
    from public._team_seat_slots(p_org) s;
  if v_held then return 'already'; end if;
  if v_used < v_org.seats then return 'ok'; end if;
  if v_org.when_full = 'auto' then
    v_need := v_used + 1 - v_org.seats;
    if v_org.seats + v_need <= v_org.seat_ceiling
       and (v_org.auto_monthly_limit is null
            or public._team_auto_added_this_month(p_org) + v_need <= v_org.auto_monthly_limit) then
      perform public._org_add_seats(p_org, v_need, 'auto', auth.uid());
      return 'ok';
    end if;
  end if;
  return 'full';
end;
$$;

-- ── 4. Asking the admins ────────────────────────────────────────────────────

-- The one request core (amendment D). Upserts the one pending request for
-- (team, person) and tells every owner and admin except the person, once a
-- day per (recipient, person). A pending request never narrows: a second ask
-- replaces it only when it wants at least as much (member > workspace editor
-- > board editor). Returns the pending request's id.
create or replace function public._team_request(p_org uuid, p_user uuid, p_wanted text, p_via text, p_ws uuid, p_board uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id    uuid;
  v_team  text;
  v_name  text;
  v_place text;
  r       record;
begin
  if p_org is null or p_user is null then
    raise exception 'a request needs a team and a person' using errcode = '22023';
  end if;

  insert into public.org_join_requests (org_id, user_id, wanted, via, workspace_id, board_id)
  values (p_org, p_user, p_wanted, p_via, p_ws, p_board)
  on conflict (org_id, user_id) where status = 'pending' do update
     set wanted = excluded.wanted, via = excluded.via,
         workspace_id = excluded.workspace_id, board_id = excluded.board_id
   where (case excluded.wanted when 'member' then 3 when 'workspace_editor' then 2 else 1 end)
      >= (case org_join_requests.wanted when 'member' then 3 when 'workspace_editor' then 2 else 1 end)
  returning id into v_id;
  if v_id is null then
    select q.id into v_id from public.org_join_requests q
     where q.org_id = p_org and q.user_id = p_user and q.status = 'pending';
  end if;

  select nullif(btrim(o.name), '') into v_team from public.organizations o where o.id = p_org;
  select coalesce(nullif(btrim(p.display_name), ''), u.email, 'Someone')
    into v_name
    from auth.users u left join public.profiles p on p.user_id = u.id
   where u.id = p_user;
  v_name := coalesce(v_name, 'Someone');
  if p_wanted = 'member' then
    v_place := v_team;
  else
    select coalesce(nullif(btrim(b.name), ''), nullif(btrim(w.name), '')) into v_place
      from public.workspaces w
      left join public.boards b on b.id = p_board
     where w.id = p_ws;
  end if;

  for r in
    select m.user_id from public.org_members m
     where m.org_id = p_org and m.role in ('owner', 'admin')
  loop
    continue when r.user_id = p_user;
    continue when exists (
      select 1 from public.notifications n
       where n.user_id = r.user_id
         and n.kind = 'team.join_request'
         and n.actor_id is not distinct from p_user
         and n.created_at > now() - interval '24 hours');
    insert into public.notifications (user_id, kind, workspace_id, board_id, actor_id, title, body, data)
    values (
      r.user_id, 'team.join_request', p_ws, p_board, p_user,
      format('%s asked to edit %s', v_name, coalesce('“' || v_place || '”', 'in your team')),
      case when p_via in ('ask', 'team_link', 'domain')
           then 'They can view now. Approve to give them a seat.'
           else format('%s has no free seats. Approve to give them one.', coalesce(v_team, 'Your team'))
      end,
      jsonb_build_object('request_id', v_id, 'org_id', p_org, 'wanted', p_wanted, 'via', p_via));
  end loop;

  return v_id;
end;
$$;

-- The doors' viewer fallback in a team workspace: an edit link let someone in
-- as a viewer because the team has no free seat. Ask the admins, tell the
-- joiner, log it. Never raises: it must never break a claim.
create or replace function public._team_request_and_notify(p_workspace uuid, p_board uuid, p_joiner uuid, p_via text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid;
  v_team  text;
  v_place text;
begin
  select w.org_id, nullif(btrim(o.name), '') into v_org, v_team
    from public.workspaces w
    join public.organizations o on o.id = w.org_id and o.closed_at is null
   where w.id = p_workspace;
  if v_org is null or p_joiner is null then
    return;
  end if;

  perform public._team_request(
    v_org, p_joiner,
    case when p_via = 'collab_link' and p_board is not null then 'board_editor' else 'workspace_editor' end,
    p_via, p_workspace,
    case when p_via = 'collab_link' then p_board end);

  if not exists (select 1 from public.notifications n
                  where n.user_id = p_joiner
                    and n.kind = 'team.joined_as_viewer'
                    and n.workspace_id = p_workspace
                    and n.board_id is not distinct from p_board
                    and n.created_at > now() - interval '24 hours') then
    select coalesce(nullif(btrim(b.name), ''), nullif(btrim(w.name), '')) into v_place
      from public.workspaces w
      left join public.boards b on b.id = p_board
     where w.id = p_workspace;
    insert into public.notifications (user_id, kind, workspace_id, board_id, title, body, data)
    values (
      p_joiner, 'team.joined_as_viewer', p_workspace, p_board,
      format('You joined %s as a viewer', coalesce('“' || v_place || '”', 'a workspace')),
      format('%s has no free seats, so you can view for now. We asked its admins.', coalesce(v_team, 'The team')),
      jsonb_build_object('org_id', v_org, 'via', p_via));
  end if;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (p_joiner, 'team_seat_viewer_fallback',
            jsonb_build_object('via', p_via, 'workspace_id', p_workspace, 'board_id', p_board));
  exception when others then null;
  end;
exception when others then
  raise warning '_team_request_and_notify failed for %: %', p_workspace, sqlerrm;
end;
$$;

-- ── 5. The S1 helpers' team branch (0520's live bodies) ─────────────────────

create or replace function public._account_editor_grants(p_owner uuid)
returns table (user_id uuid, email text, source text, workspace_id uuid, board_id uuid,
               role text, invite_id uuid, sent_at timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  with ws as (
    -- 0531: a personal account counts its personal workspaces; a team's count its seats.
    select w.id from public.workspaces w where w.created_by = p_owner and w.org_id is null
  ),
  people as (
    select p_owner as user_id, 'owner'::text as source,
           null::uuid as workspace_id, null::uuid as board_id, 'owner'::text as role
    union all
    select m.user_id, 'member', m.workspace_id, null::uuid, m.role::text
      from public.workspace_members m
     where m.workspace_id in (select ws.id from ws)
       and m.role in ('owner', 'coowner', 'admin', 'editor')
    union all
    select s.user_id, 'share', b.workspace_id, s.board_id, s.role::text
      from public.board_shares s
      join public.boards b on b.id = s.board_id
     where b.workspace_id in (select ws.id from ws)
       and b.deleted_at is null
       and s.role = 'editor'
  )
  select u.id, lower(u.email), pp.source, pp.workspace_id, pp.board_id, pp.role,
         null::uuid, null::timestamptz
    from people pp
    join auth.users u on u.id = pp.user_id
   where not public._user_banned(u.id)
     and not public._is_service_identity(u.id)
  union all
  -- An invite holds its place until it is claimed, expires or is cancelled.
  -- One the outbound breaker holds (0369), or one sent by an account that is
  -- now suspended, will never be delivered, so it holds nothing. Its id and
  -- date let the owner's list revoke it and say when it went.
  select null::uuid, lower(pi.email), 'pending', pi.workspace_id, pi.board_id, pi.role::text,
         pi.id, pi.created_at
    from public.pending_invites pi
   where pi.workspace_id in (select ws.id from ws)
     and pi.role in ('editor', 'workspace')
     and pi.claimed_at is null
     and pi.expires_at > now()
     and pi.held_at is null
     and not public._sharer_suspended(pi.invited_by)
     and (pi.board_id is null
          or exists (select 1 from public.boards b
                      where b.id = pi.board_id and b.deleted_at is null));
$$;

-- 'ok' to let one more person edit in this workspace's account; 'already' when
-- they hold a place (an account by id or address, an address by its invite);
-- 'full' when the account has no room. That one comparison is the whole rule,
-- freeze included: an account that ends up over the limit (a transfer, a
-- restore) keeps everyone it has and admits nobody new until it is under.
-- It takes a workspace, not an owner, so a Team's seats (S2a) branch here
-- without touching a door.
create or replace function public._editor_admit(p_workspace uuid, p_user uuid, p_email text default null)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_owner uuid;
  v_org   uuid;
  v_email text := lower(nullif(btrim(p_email), ''));
  v_used  integer;
  v_held  boolean;
begin
  select w.created_by, w.org_id into v_owner, v_org from public.workspaces w where w.id = p_workspace;
  if v_org is not null then
    return public._team_admit(v_org, p_user, p_email);   -- 0531: a team workspace counts the team's seats
  end if;
  if v_owner is null or not public._editor_limit_on(v_owner) then
    return 'ok';
  end if;

  if v_email is null and p_user is not null then
    select lower(u.email) into v_email from auth.users u where u.id = p_user;
  end if;

  -- One admission at a time per account, so two invites can't both take the
  -- last place. Held until the door's transaction ends.
  perform pg_advisory_xact_lock(hashtext('editor_slots:' || v_owner::text));

  select count(*)::integer,
         coalesce(bool_or((p_user is not null and s.user_id = p_user)
                          or (v_email is not null and s.email = v_email)), false)
    into v_used, v_held
    from public._account_editor_slots(v_owner) s;

  if v_held then
    return 'already';
  end if;
  if v_used >= public._editor_limit() then
    return 'full';
  end if;
  return 'ok';
end;
$$;

-- The refusal, worded for whoever is asking. The hint is the stable key the
-- app reads:
--   * 'editor_limit': the caller is the account's owner, who can make room;
--   * 'editor_limit_ask_owner': anyone else, who can ask the owner.
-- 0531: in a team workspace, 'team_seats_full' for an owner or admin (who can
-- add a seat), 'team_seats_ask_admin' for anyone else.
create or replace function public._editor_refuse(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_org   uuid;
begin
  select w.created_by, w.org_id into v_owner, v_org from public.workspaces w where w.id = p_workspace;
  if v_org is not null then
    if public._org_is_admin(v_org, auth.uid()) then
      raise exception 'team seats full: every seat is in use; add a seat to add another editor'
        using errcode = '42501', hint = 'team_seats_full';
    end if;
    raise exception 'team seats full: ask an admin of the team for another seat'
      using errcode = '42501', hint = 'team_seats_ask_admin';
  end if;
  if v_owner is not null and v_owner = auth.uid() then
    raise exception 'editor limit reached: you have % people who can edit across your workspaces, the most a personal plan allows',
      public._editor_limit()
      using errcode = '42501', hint = 'editor_limit';
  end if;
  raise exception 'editor limit reached: this account already has % people who can edit',
    public._editor_limit()
    using errcode = '42501', hint = 'editor_limit_ask_owner';
end;
$$;

-- An edit link let someone in as a viewer because the account was full. Send
-- both notices and log editor_limit_viewer_fallback, so the read can tell how
-- often the limit turns someone away. Never raises.
create or replace function public._editor_limit_fallback(p_workspace uuid, p_board uuid, p_joiner uuid, p_via text, p_upgrade boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 0531: a team workspace asks the team's admins instead of the account owner.
  if exists (select 1 from public.workspaces w where w.id = p_workspace and w.org_id is not null) then
    perform public._team_request_and_notify(p_workspace, p_board, p_joiner, p_via);
    return;
  end if;
  perform public._notify_editor_limit(p_workspace, p_board, p_joiner, p_via);
  perform public._notify_joined_as_viewer(p_joiner, p_workspace, p_board);
  begin
    insert into public.analytics_events (user_id, event, props)
    values (p_joiner, 'editor_limit_viewer_fallback',
            jsonb_build_object('via', p_via, 'upgrade', p_upgrade,
                               'workspace_id', p_workspace, 'board_id', p_board));
  exception when others then null;
  end;
end;
$$;

-- The numbers for the share panel and Members:
--   * is the limit on for this account;
--   * how many places are taken, and how many of those by waiting invites;
--   * is it full;
--   * is the caller the account's owner (who can make room; anyone else asks).
-- Numbers only, never who. `subject` is 'account', or 'team' in a team
-- workspace (0531), where the limit is the team's seats, "full" means the
-- next editor needs an admin, and the "owner" is any owner or admin.
create or replace function public.get_editor_capacity(p_board_id uuid default null, p_workspace_id uuid default null)
returns table (enforced boolean, editor_limit integer, used integer, pending integer,
               is_full boolean, i_am_account_owner boolean, subject text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_ws    uuid := p_workspace_id;
  v_owner uuid;
  v_org   uuid;
  v_on    boolean;
  v_used  integer;
  v_pend  integer;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to see this' using errcode = '42501';
  end if;
  if p_board_id is not null then
    select b.workspace_id into v_ws from public.boards b
     where b.id = p_board_id and b.deleted_at is null;
    if v_ws is null or not public.can_write_board(p_board_id) then
      raise exception 'you do not have access to this cluster' using errcode = '42501';
    end if;
  elsif v_ws is null
     or not (public.can_manage_workspace(v_ws) or public._workspace_member_can_write(v_ws)) then
    raise exception 'you do not have access to this workspace' using errcode = '42501';
  end if;

  select w.created_by, w.org_id into v_owner, v_org from public.workspaces w where w.id = v_ws;
  -- 0531: a team workspace answers with the team's seats.
  if v_org is not null then
    return query
      select true, o.seats,
             (count(s.slot_key) filter (where s.source not in ('pending', 'team_invite')))::integer,
             (count(s.slot_key) filter (where s.source in ('pending', 'team_invite')))::integer,
             count(s.slot_key) >= o.seats
               and (o.when_full = 'ask'
                    or o.seats >= o.seat_ceiling
                    or (o.auto_monthly_limit is not null
                        and public._team_auto_added_this_month(v_org) >= o.auto_monthly_limit)),
             public._org_is_admin(v_org, auth.uid()),
             'team'::text
        from public.organizations o
        left join public._team_seat_slots(v_org) s on true
       where o.id = v_org
       group by o.seats, o.seat_ceiling, o.when_full, o.auto_monthly_limit;
    return;
  end if;
  v_on := v_owner is not null and public._editor_limit_on(v_owner);
  select (count(*) filter (where s.source <> 'pending'))::integer,
         (count(*) filter (where s.source = 'pending'))::integer
    into v_used, v_pend
    from public._account_editor_slots(v_owner) s;

  return query select v_on, public._editor_limit(), v_used, v_pend,
                      v_on and v_used + v_pend >= public._editor_limit(),
                      v_owner is not distinct from auth.uid(),
                      'account'::text;
end;
$$;

-- Someone who isn't the owner, turned away by the limit, asks the owner (and
-- co-owners) to make room. A door that refuses rolls back everything it did,
-- its notices included, so asking is a call of its own. It returns:
--   * 'sent';
--   * 'already_sent': they asked within the last day;
--   * 'not_full': there's room after all, or the limit is off for the account;
--   * 'owner': it is their own account.
-- 0531: in a team workspace it asks the team's owner and admins for a seat
-- ('owner' when the caller is one of them).
create or replace function public.ask_owner_for_editor_slot(p_board_id uuid default null, p_workspace_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws    uuid := p_workspace_id;
  v_owner uuid;
  v_org   public.organizations%rowtype;
  v_name  text;
  r       record;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if p_board_id is not null then
    select b.workspace_id into v_ws from public.boards b
     where b.id = p_board_id and b.deleted_at is null;
    if v_ws is null or not public.can_write_board(p_board_id) then
      raise exception 'you do not have access to this cluster' using errcode = '42501';
    end if;
  elsif v_ws is null
     or not (public.can_manage_workspace(v_ws) or public._workspace_member_can_write(v_ws)) then
    raise exception 'you do not have access to this workspace' using errcode = '42501';
  end if;

  -- 0531: the team branch.
  select o.* into v_org
    from public.workspaces w
    join public.organizations o on o.id = w.org_id and o.closed_at is null
   where w.id = v_ws;
  if v_org.id is not null then
    if public._org_is_admin(v_org.id, auth.uid()) then
      return 'owner';
    end if;
    if public._team_seats_used(v_org.id) < v_org.seats
       or (v_org.when_full = 'auto'
           and v_org.seats < v_org.seat_ceiling
           and (v_org.auto_monthly_limit is null
                or public._team_auto_added_this_month(v_org.id) < v_org.auto_monthly_limit)) then
      return 'not_full';
    end if;
    if exists (select 1 from public.notifications n
                where n.kind = 'team.seats_full'
                  and n.actor_id = auth.uid()
                  and n.data ->> 'org_id' = v_org.id::text
                  and n.created_at > now() - interval '24 hours') then
      return 'already_sent';
    end if;
    select coalesce(nullif(btrim(p.display_name), ''), u.email, 'Someone')
      into v_name
      from auth.users u left join public.profiles p on p.user_id = u.id
     where u.id = auth.uid();
    for r in
      select m.user_id from public.org_members m
       where m.org_id = v_org.id and m.role in ('owner', 'admin')
    loop
      insert into public.notifications (user_id, kind, workspace_id, board_id, actor_id, title, body, data)
      values (
        r.user_id, 'team.seats_full', v_ws, p_board_id, auth.uid(),
        format('%s asked for another seat', coalesce(v_name, 'Someone')),
        format('Every seat in %s is in use. Add a seat so they can add another editor.',
               coalesce('“' || nullif(btrim(v_org.name), '') || '”', 'your team')),
        jsonb_build_object('via', 'ask', 'org_id', v_org.id));
    end loop;
    return 'sent';
  end if;

  select w.created_by into v_owner from public.workspaces w where w.id = v_ws;
  if v_owner = auth.uid() then
    return 'owner';
  end if;
  if not public._editor_limit_on(v_owner)
     or public._account_editor_count(v_owner) < public._editor_limit() then
    return 'not_full';
  end if;
  if exists (select 1 from public.notifications n
              where n.user_id = v_owner
                and n.kind = 'editors.limit_reached'
                and n.actor_id = auth.uid()
                and n.data ->> 'via' = 'ask'
                and n.created_at > now() - interval '24 hours') then
    return 'already_sent';
  end if;
  perform public._notify_editor_limit(v_ws, p_board_id, auth.uid(), 'ask');
  return 'sent';
end;
$$;

-- ── 6. Grants (0311) ────────────────────────────────────────────────────────
-- create or replace kept each re-emitted function's ACL; the proofs re-assert.

revoke execute on function public._org_role(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._org_is_admin(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._team_seat_grants(uuid) from public, anon, authenticated;
revoke execute on function public._team_seat_slots(uuid) from public, anon, authenticated;
revoke execute on function public._team_seats_used(uuid) from public, anon, authenticated;
revoke execute on function public._team_auto_added_this_month(uuid) from public, anon, authenticated;
revoke execute on function public._org_add_seats(uuid, integer, text, uuid) from public, anon, authenticated;
revoke execute on function public._team_admit(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._team_request(uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._team_request_and_notify(uuid, uuid, uuid, text) from public, anon, authenticated;

-- Re-emitted helpers, already client-proof since 0520: restated, so the file
-- that now defines each one says so (no ACL changes).
revoke execute on function public._account_editor_grants(uuid) from public, anon, authenticated;
revoke execute on function public._editor_admit(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._editor_refuse(uuid) from public, anon, authenticated;
revoke execute on function public._editor_limit_fallback(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;

-- ── 7. Proofs (the 0311 habit: a REVOKE reporting success proves nothing) ──

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public._org_role(uuid,uuid)', 'public._org_is_admin(uuid,uuid)',
    'public._team_seat_grants(uuid)', 'public._team_seat_slots(uuid)',
    'public._team_seats_used(uuid)', 'public._team_auto_added_this_month(uuid)',
    'public._org_add_seats(uuid,integer,text,uuid)', 'public._team_admit(uuid,uuid,text)',
    'public._team_request(uuid,uuid,text,text,uuid,uuid)',
    'public._team_request_and_notify(uuid,uuid,uuid,text)',
    'public._account_editor_grants(uuid)', 'public._editor_admit(uuid,uuid,text)',
    'public._editor_refuse(uuid)', 'public._editor_limit_fallback(uuid,uuid,uuid,text,boolean)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0531: % is client-executable', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.get_editor_capacity(uuid,uuid)',
    'public.ask_owner_for_editor_slot(uuid,uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0531: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0531: % is not callable signed in', v_fn;
    end if;
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_editor_admit', '_team_admit', '_team_seat_slots', '_team_seat_grants',
                                  'get_editor_capacity', 'ask_owner_for_editor_slot', '_org_role',
                                  '_org_is_admin', '_team_seats_used', '_team_auto_added_this_month',
                                  '_org_add_seats', '_team_request', '_team_request_and_notify',
                                  '_account_editor_grants', '_editor_refuse', '_editor_limit_fallback')
              group by p.proname having count(*) > 1) then
    raise exception '0531: an overload exists (PGRST203)';
  end if;

  -- Applying this changes nothing for anyone: no team exists, and a
  -- workspace that isn't a team's still takes the personal path (limit off).
  if exists (select 1 from public.organizations) then
    raise exception '0531: an organization exists';
  end if;
  if public._editor_admit(gen_random_uuid(), gen_random_uuid(), null) <> 'ok' then
    raise exception '0531: _editor_admit refuses with no team and the limit off';
  end if;
end $$;

commit;
