-- 0358 — invites can no longer be used to mail strangers in bulk.
--
-- On 2026-09-20 two accounts, created minutes apart, named a cluster with a
-- phishing lure and a link, then invited a long pasted list of addresses to
-- it. Every new pending invite fires `pending_invite` from our own sending
-- domain — the domain that also carries sign-in codes and every lifecycle
-- email — and that email put the cluster's name in its subject line. Nothing
-- limited how many invites one account could send; no legitimate account has
-- ever come close to the limits below. Our mail has been landing in spam since.
--
-- This migration:
--   1. Closes the incident. The two accounts' open invites are expired (the
--      rows stay as the record; both claim paths refuse an expired invite),
--      their two lure clusters are soft-deleted, and both accounts are banned
--      in both places: auth.users.banned_until stops sign-in, and
--      profiles.banned_at is what the app's own checks read (_actor_active,
--      the lifecycle eligibility functions). The workspace roots stay live —
--      every workspace keeps one (CLAUDE.md).
--   2. Caps invite emails per inviter: _invite_budget_take() checks a rolling
--      24-hour budget, smaller on an account's first day, and records the send
--      in invite_send_ledger. share_board and invite_workspace_member call it
--      only on a path that sends an email — a new pending invite, a share to
--      an existing account, a new workspace member — so a re-invite that the
--      unique indexes turn into a no-op spends nothing.
--   3. Makes a ban stop invites at once. Owners skipped can_write_board, and
--      with it _actor_active(), so a banned owner could keep inviting until
--      their access token expired.
--   4. Drops the open INSERT policies on share_notifications and
--      mention_notifications. Any signed-in user could insert a row naming any
--      recipient, any sender and any text, and the email triggers mailed it.
--      Every real writer is a security definer function (checked below), and
--      the app itself only reads and dismisses these rows.
--   5. Names the inviter in `pending_invite` by account email. The recipient
--      has no account, and a display name is whatever its owner typed.
--
-- The rendered names are cleaned in the edge function as well (safeLabel.mjs):
-- no links, no newlines, a length cap.
--
-- No counts in this file: the repo is public.

begin;

-- ── 1. The 2026-09-20 incident ──────────────────────────────────────────────
-- Literal ids, not a heuristic: these are the two accounts and the two lure
-- clusters. On any other database (a restore drill, a branch) nothing matches
-- and every statement is a no-op.

update public.pending_invites
   set expires_at = now()
 where invited_by in ('908f62c5-bf1f-4923-850b-930c051f2cf8',
                      '23197060-e9f6-497b-ba63-e986c0d0eb36')
   and claimed_at is null
   and expires_at > now();

-- What soft_delete_board does, minus its can_write_board gate, which needs an
-- auth.uid() a migration does not have. Both are leaf clusters, so its
-- re-homing step has nothing to move; the proof block re-checks that.
update public.boards
   set deleted_at = now(), updated_at = now()
 where id in ('7187840d-daeb-479e-b948-97f6aaca43aa',
              '27d77056-b4b2-4d6d-bdea-e1e718c2d40e')
   and deleted_at is null
   and parent_board_id is not null
   and not exists (select 1 from public.boards c
                    where c.parent_board_id = boards.id and c.deleted_at is null);

-- The admin ban sets the same 100-year GoTrue ban (admin-account-action);
-- 'infinity' is avoided on purpose, since GoTrue has to parse the value.
update auth.users
   set banned_until = now() + interval '876000 hours'
 where id in ('908f62c5-bf1f-4923-850b-930c051f2cf8',
              '23197060-e9f6-497b-ba63-e986c0d0eb36');

update public.profiles
   set banned_at = coalesce(banned_at, now())
 where user_id in ('908f62c5-bf1f-4923-850b-930c051f2cf8',
                   '23197060-e9f6-497b-ba63-e986c0d0eb36');

-- ── 2. The invite budget ────────────────────────────────────────────────────

create table if not exists public.invite_send_ledger (
  id         bigint generated always as identity primary key,
  inviter    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists invite_send_ledger_inviter_idx
  on public.invite_send_ledger (inviter, created_at desc);

-- Written only by _invite_budget_take (security definer). RLS on with no
-- policies, and the table grants revoked, so no client can read or forge it.
alter table public.invite_send_ledger enable row level security;
revoke all on public.invite_send_ledger from public, anon, authenticated;

-- The two numbers are named constants so scripts/gen-docs.mjs can read them
-- straight out of this file into the sharing docs ({{fact:inviteDailyLimit}},
-- {{fact:inviteFirstDayLimit}}). Change them here and the docs follow.
create or replace function public._invite_budget_take()
returns void
language plpgsql security definer
set search_path = public, auth as $$
declare
  c_invite_daily_limit     constant integer := 20;
  c_invite_first_day_limit constant integer := 5;
  v_uid     uuid := auth.uid();
  v_created timestamptz;
  v_limit   integer;
  v_used    integer;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Serialise one inviter's calls, so two concurrent invites cannot both read
  -- the count before either records its send.
  perform pg_advisory_xact_lock(hashtext('invite_budget:' || v_uid::text));

  select u.created_at into v_created from auth.users u where u.id = v_uid;
  v_limit := case when v_created > now() - interval '24 hours'
                  then c_invite_first_day_limit else c_invite_daily_limit end;

  select count(*) into v_used
    from public.invite_send_ledger l
   where l.inviter = v_uid and l.created_at > now() - interval '24 hours';

  -- The phrase "invite limit reached" is what ShareModal recognises to stop
  -- its per-address loop; keep it at the start of both messages.
  if v_used >= v_limit then
    if v_limit = c_invite_first_day_limit then
      raise exception 'invite limit reached: a new account can send % invitations on its first day. You can send more tomorrow.', v_limit
        using errcode = 'P0001', hint = 'invite_limit_reached';
    end if;
    raise exception 'invite limit reached: you can send % invitations a day. You can send more tomorrow.', v_limit
      using errcode = 'P0001', hint = 'invite_limit_reached';
  end if;

  insert into public.invite_send_ledger (inviter) values (v_uid);
  -- Rows older than the window are never read again.
  delete from public.invite_send_ledger
   where inviter = v_uid and created_at < now() - interval '48 hours';
end $$;

comment on function public._invite_budget_take() is
  'Spends one invite email from the caller''s rolling 24h budget (smaller on an account''s first day) or raises "invite limit reached". Called by share_board and invite_workspace_member on every path that sends an email. Internal: no client may call it.';

-- ── 2b + 3. share_board: ban check and budget ───────────────────────────────
-- Body is 0227's, with _actor_active() and _invite_budget_take() added.

create or replace function public.share_board(p_board_id uuid, p_email text, p_role text)
returns text
language plpgsql security definer
set search_path to 'public' as $function$
declare
  v_owner                uuid;
  v_is_owner             boolean;
  v_user                 uuid;
  v_workspace            uuid;
  v_my_tier              text;
  v_existing_invited_by  uuid;
  v_email_norm           text := lower(trim(p_email));
  v_cap                  integer;
  v_editor_seats         integer;
begin
  if p_role not in ('viewer','editor') then
    raise exception 'role must be viewer or editor' using errcode = '22023';
  end if;

  -- 0358: a banned account stops inviting at once. Owners never reach
  -- can_write_board below, so they never met this check before.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select coalesce(
    (select tier from public.profiles where user_id = auth.uid()),
    'demo'
  ) into v_my_tier;

  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;
  -- (The 0147 "demo can only invite viewers" block was here. Editor
  -- collaboration is free now — owner-pays caps (0187) are the resource
  -- gate; the config brake below is the emergency lever.)

  select b.workspace_id into v_workspace
  from boards b where b.id = p_board_id;
  if v_workspace is null then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;

  select w.created_by into v_owner from workspaces w where w.id = v_workspace;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to share this board'
      using errcode = '42501';
  end if;

  -- Dormant editor-seat brake: only bites when an admin sets a cap.
  if p_role = 'editor' then
    v_cap := public._collab_editor_cap();
    if v_cap is not null then
      select count(distinct bs.user_id) into v_editor_seats
      from board_shares bs
      join boards b     on b.id = bs.board_id
      join workspaces w on w.id = b.workspace_id
      where w.created_by = v_owner and bs.role = 'editor';
      if v_editor_seats >= v_cap then
        raise exception 'this workspace has reached its free editor limit'
          using errcode = '42501';
      end if;
    end if;
  end if;

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
    -- Pending path: invitee has no account yet. Re-inviting/refreshing is an
    -- "add" action — allowed for owners and editors; latest inviter owns the
    -- not-yet-claimed pending row.
    --
    -- 0358: only a NEW row fires the invite email (the trigger is AFTER
    -- INSERT), so only a new row spends budget; a refresh does not.
    if not exists (select 1 from pending_invites pi
                    where lower(pi.email) = v_email_norm
                      and pi.board_id = p_board_id
                      and pi.claimed_at is null) then
      perform public._invite_budget_take();
    end if;
    --
    -- The predicate must match pending_invites_board_unclaimed_uniq EXACTLY —
    -- including `board_id is not null`. Without it Postgres cannot infer the
    -- arbiter and every call raises 42P10 (see migration 0227's header).
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, v_workspace, p_board_id, p_role, auth.uid())
    on conflict (lower(email), board_id) where claimed_at is null and board_id is not null
    do update set role       = excluded.role,
                  invited_by = auth.uid(),
                  expires_at = now() + interval '30 days';
    return 'pending';
  end if;

  if v_user = auth.uid() then
    raise exception 'cannot share with yourself' using errcode = '22023';
  end if;

  -- Editors may add anyone, but may only CHANGE an existing share if they
  -- created it. A brand-new INSERT is always allowed (subject to tier/role).
  select invited_by into v_existing_invited_by
  from board_shares where board_id = p_board_id and user_id = v_user;
  if FOUND and not v_is_owner and v_existing_invited_by is distinct from auth.uid() then
    raise exception 'you can only change the access of people you invited'
      using errcode = '42501';
  end if;

  -- 0358: the share_notifications row below emails `board_shared`, on every
  -- call, so every call spends budget.
  perform public._invite_budget_take();

  insert into board_shares (board_id, user_id, role, invited_by)
  values (p_board_id, v_user, p_role, auth.uid())
  on conflict (board_id, user_id)
  do update set role = excluded.role,
                invited_by = auth.uid();

  insert into share_notifications (user_id, board_id, role, shared_by)
  values (v_user, p_board_id, p_role, auth.uid());

  return 'granted';
end;
$function$;

-- ── 2c + 3. invite_workspace_member: ban check and budget ───────────────────
-- Body is 0318's, with _actor_active() and _invite_budget_take() added.

create or replace function public.invite_workspace_member(
  p_workspace_id uuid, p_email text, p_role text default 'editor')
returns text
language plpgsql security definer
set search_path to 'public' as $function$
declare
  v_owner       uuid;
  v_user        uuid;
  v_my_tier     text;
  v_email_norm  text := lower(trim(p_email));
begin
  if p_role not in ('editor','viewer') then
    raise exception 'workspace member role must be editor or viewer'
      using errcode = '22023';
  end if;

  -- 0358: a banned account stops inviting at once.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select coalesce((select tier from public.profiles where user_id = auth.uid()), 'demo')
    into v_my_tier;
  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;

  select created_by into v_owner from workspaces where id = p_workspace_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can add members'
      using errcode = '42501';
  end if;

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
    -- 0358: only a new pending row fires the invite email, so only it spends.
    if not exists (select 1 from pending_invites pi
                    where lower(pi.email) = v_email_norm
                      and pi.workspace_id = p_workspace_id
                      and pi.board_id is null
                      and pi.claimed_at is null) then
      perform public._invite_budget_take();
    end if;
    -- 0318: 'workspace' is what both claim paths turn into an editor membership;
    -- a viewer invite must stay 'viewer' or the claim promotes it.
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, p_workspace_id, null,
            case when p_role = 'viewer' then 'viewer' else 'workspace' end,
            auth.uid())
    on conflict (lower(email), workspace_id) where claimed_at is null and board_id is null
    do update set role       = case when p_role = 'viewer' then 'viewer' else 'workspace' end,
                  invited_by = auth.uid(),
                  expires_at = now() + interval '30 days';
    return 'pending';
  end if;

  if v_user = auth.uid() then
    raise exception 'cannot invite yourself' using errcode = '22023';
  end if;

  -- 0358: an existing member is told so without spending budget; a new one
  -- gets the `workspace_invite` email, so it spends.
  if exists (select 1 from workspace_members m
              where m.workspace_id = p_workspace_id and m.user_id = v_user) then
    return 'already_member';
  end if;
  perform public._invite_budget_take();

  begin
    insert into workspace_members (workspace_id, user_id, role)
    values (p_workspace_id, v_user, p_role);
  exception when unique_violation then
    return 'already_member';
  end;

  return 'granted';
end;
$function$;

-- ── 4. No more forged notification rows ─────────────────────────────────────

drop policy if exists "share_notifications insert authed" on public.share_notifications;
drop policy if exists "mention_notifications insert authed" on public.mention_notifications;
-- PUBLIC too: a revoke from anon/authenticated is a no-op while PUBLIC holds
-- the grant. Security definer writers run as the owner and are unaffected.
revoke insert on public.share_notifications, public.mention_notifications from public, anon, authenticated;

-- ── 5. pending_invite names the inviter by account email ────────────────────
-- Body is 0086's, with the display name dropped from the inviter.

create or replace function public._tg_pending_invite_email()
returns trigger
language plpgsql security definer
set search_path to 'public', 'auth' as $function$
declare
  v_workspace_name text;
  v_board_name     text;
  v_inviter_name   text;
begin
  if new.claimed_at is not null then
    return new;
  end if;

  select name into v_workspace_name
    from public.workspaces where id = new.workspace_id;

  if new.board_id is not null then
    select name into v_board_name from public.boards where id = new.board_id;
  end if;

  -- 0358: the account's own address, never a display name. This email goes to
  -- someone with no account, and a display name is whatever its owner typed.
  select u.email into v_inviter_name
    from auth.users u
   where u.id = new.invited_by;

  perform public._notify_email(
    'pending_invite',
    new.email,
    jsonb_build_object(
      'inviterName',   coalesce(v_inviter_name,   'Someone on Clusters'),
      'workspaceName', coalesce(v_workspace_name, 'a workspace'),
      'boardName',     v_board_name,
      'role',          new.role,
      'token',         new.token::text,
      'expiresAt',     to_char(new.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  );

  return new;
end;
$function$;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- _invite_budget_take is internal (the 0311 habit): born with EXECUTE for
-- authenticated, so revoke it. The replaced functions keep their ACLs
-- (create or replace with an unchanged signature).
revoke execute on function public._invite_budget_take() from public, anon, authenticated;

-- ── Proof ───────────────────────────────────────────────────────────────────
do $$
begin
  -- 1. The incident is closed (vacuous on a database without those rows).
  if exists (select 1 from public.pending_invites
              where invited_by in ('908f62c5-bf1f-4923-850b-930c051f2cf8',
                                   '23197060-e9f6-497b-ba63-e986c0d0eb36')
                and claimed_at is null and expires_at > now()) then
    raise exception '0358: an incident invite is still open';
  end if;
  if exists (select 1 from public.boards
              where id in ('7187840d-daeb-479e-b948-97f6aaca43aa',
                           '27d77056-b4b2-4d6d-bdea-e1e718c2d40e')
                and deleted_at is null) then
    raise exception '0358: a lure cluster is still live (did it gain a child?)';
  end if;
  if exists (select 1 from public.profiles
              where user_id in ('908f62c5-bf1f-4923-850b-930c051f2cf8',
                                '23197060-e9f6-497b-ba63-e986c0d0eb36')
                and banned_at is null)
     or exists (select 1 from auth.users
              where id in ('908f62c5-bf1f-4923-850b-930c051f2cf8',
                           '23197060-e9f6-497b-ba63-e986c0d0eb36')
                and (banned_until is null or banned_until < now() + interval '1 year')) then
    raise exception '0358: an incident account is not banned in both places';
  end if;
  -- Their workspaces keep a live root.
  if exists (select 1 from public.workspaces w
              where w.created_by in ('908f62c5-bf1f-4923-850b-930c051f2cf8',
                                     '23197060-e9f6-497b-ba63-e986c0d0eb36')
                and not exists (select 1 from public.boards b
                                 where b.workspace_id = w.id
                                   and b.parent_board_id is null
                                   and b.deleted_at is null)) then
    raise exception '0358: an incident workspace lost its live root';
  end if;

  -- 2 + 3. Both invite paths take the budget and check the ban.
  if position('_invite_budget_take' in pg_get_functiondef('public.share_board(uuid,text,text)'::regprocedure)) = 0
     or position('_invite_budget_take' in pg_get_functiondef('public.invite_workspace_member(uuid,text,text)'::regprocedure)) = 0 then
    raise exception '0358: an invite path does not take the budget';
  end if;
  if position('_actor_active' in pg_get_functiondef('public.share_board(uuid,text,text)'::regprocedure)) = 0
     or position('_actor_active' in pg_get_functiondef('public.invite_workspace_member(uuid,text,text)'::regprocedure)) = 0 then
    raise exception '0358: an invite path does not check the ban';
  end if;

  -- 4. No INSERT policy left on the notification tables, and every function
  -- that still writes them is a security definer (or chat @mentions break).
  if exists (select 1 from pg_policies
              where schemaname = 'public'
                and tablename in ('share_notifications','mention_notifications')
                and cmd in ('INSERT','ALL')) then
    raise exception '0358: a notification table still accepts client inserts';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f' and not p.prosecdef
                and (p.prosrc ~* 'insert\s+into\s+(public\.)?share_notifications'
                  or p.prosrc ~* 'insert\s+into\s+(public\.)?mention_notifications')) then
    raise exception '0358: a non-definer function writes a notification table';
  end if;
  if has_table_privilege('authenticated', 'public.share_notifications', 'insert')
     or has_table_privilege('authenticated', 'public.mention_notifications', 'insert') then
    raise exception '0358: authenticated can still insert notification rows';
  end if;

  -- Grants (the 0311 habit: a REVOKE reporting success proves nothing).
  if has_function_privilege('anon', 'public._invite_budget_take()', 'execute')
     or has_function_privilege('authenticated', 'public._invite_budget_take()', 'execute') then
    raise exception '0358: _invite_budget_take is callable by a client';
  end if;
  if not has_function_privilege('authenticated', 'public.share_board(uuid,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.invite_workspace_member(uuid,text,text)', 'execute') then
    raise exception '0358: the invite RPCs lost their authenticated grant';
  end if;
  if has_function_privilege('anon', 'public.share_board(uuid,text,text)', 'execute')
     or has_function_privilege('anon', 'public.invite_workspace_member(uuid,text,text)', 'execute') then
    raise exception '0358: anon can call an invite RPC';
  end if;
  if has_table_privilege('authenticated', 'public.invite_send_ledger', 'select')
     or has_table_privilege('anon', 'public.invite_send_ledger', 'select') then
    raise exception '0358: a client can read invite_send_ledger';
  end if;
end $$;

commit;
