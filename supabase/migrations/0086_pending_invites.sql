-- 0086_pending_invites.sql — invite-before-signup.
--
-- Before this migration, share_board() and the workspace_members
-- invite path both REQUIRED the invitee to already have an account
-- (auth.users lookup, raise if null). The UI surfaced this as a
-- "not signed up" failure toast and silently dropped the invite.
--
-- This migration adds a pending_invites table + magic-link token so
-- inviters can add anyone, regardless of account status. The flow:
--
--   1. share_board / invite_workspace_member: if the email has no
--      account, upsert a pending_invites row (instead of erroring).
--      A trigger fires a 'pending_invite' email containing a
--      /?invite=<token> magic-link.
--   2. Invitee clicks the link → AuthGate stores the token, runs the
--      existing OTP signup (email auto-prefilled via peek_pending_-
--      invite_email).
--   3. After signup, the client calls claim_pending_invite(token) to
--      grant the specific board/workspace + redirect.
--   4. Backstop (in 0087): the auth.users INSERT trigger ALSO calls
--      _claim_pending_invites_for_user, which finds any pending rows
--      matching the new user's email and claims them — covers the
--      case where the user signs up without ever clicking the link.

-----------------------------------------------------------------------
-- TABLE
-----------------------------------------------------------------------
create table if not exists pending_invites (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,                       -- always lower(trim(...))
  workspace_id uuid not null references workspaces on delete cascade,
  board_id     uuid references boards on delete cascade,   -- null = workspace-level
  role         text not null check (role in ('viewer','editor','workspace')),
  invited_by   uuid references auth.users on delete set null,
  token        uuid not null unique default gen_random_uuid(),
  expires_at   timestamptz not null default (now() + interval '30 days'),
  claimed_at   timestamptz,
  claimed_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now()
);

-- Partial unique indexes: one unclaimed row per (email, board) for
-- board-level invites; one unclaimed row per (email, workspace) for
-- workspace-level invites. Two indexes because Postgres treats NULL
-- as distinct in compound uniques, so a single index over
-- (email, workspace_id, board_id) would let multiple workspace-level
-- rows for the same email co-exist.
create unique index if not exists pending_invites_board_unclaimed_uniq
  on pending_invites (lower(email), board_id)
  where claimed_at is null and board_id is not null;

create unique index if not exists pending_invites_workspace_unclaimed_uniq
  on pending_invites (lower(email), workspace_id)
  where claimed_at is null and board_id is null;

-- Used by the backstop trigger in 0087 to find all unclaimed invites
-- for a freshly-created user's email.
create index if not exists pending_invites_email_unclaimed_idx
  on pending_invites (lower(email))
  where claimed_at is null;

create index if not exists pending_invites_workspace_idx
  on pending_invites (workspace_id);

alter table pending_invites enable row level security;

-- The workspace owner (and the original inviter) can read pending rows
-- so the ShareModal can list "pending signup" entries. All writes go
-- through SECURITY DEFINER RPCs below — no INSERT/UPDATE/DELETE policy.
create policy "pending_invites read by owner or inviter" on pending_invites
  for select using (
    invited_by = auth.uid()
    or exists (
      select 1 from workspaces w
      where w.id = pending_invites.workspace_id and w.created_by = auth.uid()
    )
  );

-----------------------------------------------------------------------
-- share_board RPC — replaces the version from 0065.
--
-- The prior signature returned void; the new one returns text
-- ('granted' | 'pending'). Postgres CREATE OR REPLACE refuses to
-- change a function's return type, so we drop first. CASCADE is not
-- needed — no view or other function depends on share_board's result.
-----------------------------------------------------------------------
drop function if exists share_board(uuid, text, text);

-- Same tier-aware checks (waitlist blocked, demo can't invite editors,
-- only workspace owner can share). The only change is the
-- "no user with email" branch: instead of raising, we upsert a
-- pending_invites row and return 'pending'. Callers that already-have
-- accounts still get the original behavior (board_shares insert +
-- share_notifications email).
create or replace function share_board(
  p_board_id uuid, p_email text, p_role text
) returns text
language plpgsql security definer
set search_path = public as $$
declare
  v_owner       uuid;
  v_user        uuid;
  v_workspace   uuid;
  v_my_tier     text;
  v_email_norm  text := lower(trim(p_email));
begin
  if p_role not in ('viewer','editor') then
    raise exception 'role must be viewer or editor' using errcode = '22023';
  end if;

  select coalesce(
    (select tier from public.profiles where user_id = auth.uid()),
    'demo'
  ) into v_my_tier;

  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;
  if v_my_tier = 'demo' and p_role = 'editor' then
    raise exception 'inviting editors is a paid feature; upgrade to invite editors'
      using errcode = '42501';
  end if;

  select b.workspace_id into v_workspace
  from boards b where b.id = p_board_id;
  if v_workspace is null then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;

  select w.created_by into v_owner from workspaces w where w.id = v_workspace;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can share boards'
      using errcode = '42501';
  end if;

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
    -- Pending path. Upsert into pending_invites; trigger sends invite.
    -- The 30-day expiry is refreshed on every re-invite so the magic-
    -- link stays valid as long as someone keeps inviting them.
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, v_workspace, p_board_id, p_role, auth.uid())
    on conflict (lower(email), board_id) where claimed_at is null
    do update set role       = excluded.role,
                  invited_by = auth.uid(),
                  expires_at = now() + interval '30 days';
    return 'pending';
  end if;

  if v_user = auth.uid() then
    raise exception 'cannot share with yourself' using errcode = '22023';
  end if;

  insert into board_shares (board_id, user_id, role, invited_by)
  values (p_board_id, v_user, p_role, auth.uid())
  on conflict (board_id, user_id)
  do update set role = excluded.role,
                invited_by = auth.uid();

  insert into share_notifications (user_id, board_id, role, shared_by)
  values (v_user, p_board_id, p_role, auth.uid());

  return 'granted';
end;
$$;
revoke all on function share_board(uuid, text, text) from public;
grant execute on function share_board(uuid, text, text) to authenticated;

-----------------------------------------------------------------------
-- invite_workspace_member RPC — server-side replacement for the
-- client-side workspace_members insert in ShareModal. Branches on
-- whether the email has an account, same as share_board.
--
-- Returns 'granted' | 'pending' | 'already_member'.
-----------------------------------------------------------------------
create or replace function invite_workspace_member(
  p_workspace_id uuid, p_email text, p_role text default 'editor'
) returns text
language plpgsql security definer
set search_path = public as $$
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
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, p_workspace_id, null, 'workspace', auth.uid())
    on conflict (lower(email), workspace_id) where claimed_at is null and board_id is null
    do update set role       = 'workspace',
                  invited_by = auth.uid(),
                  expires_at = now() + interval '30 days';
    return 'pending';
  end if;

  if v_user = auth.uid() then
    raise exception 'cannot invite yourself' using errcode = '22023';
  end if;

  begin
    insert into workspace_members (workspace_id, user_id, role)
    values (p_workspace_id, v_user, p_role);
  exception when unique_violation then
    return 'already_member';
  end;

  return 'granted';
end;
$$;
revoke all on function invite_workspace_member(uuid, text, text) from public;
grant execute on function invite_workspace_member(uuid, text, text) to authenticated;

-----------------------------------------------------------------------
-- peek_pending_invite_email — anon-callable. Returns the email so the
-- sign-in page can prefill it. Holding the token IS proof of email
-- control (the link came from their inbox), so leaking the email back
-- to the holder is safe.
-----------------------------------------------------------------------
create or replace function peek_pending_invite_email(p_token uuid)
returns text
language plpgsql security definer
set search_path = public as $$
declare v_email text;
begin
  select email into v_email
  from pending_invites
  where token = p_token
    and claimed_at is null
    and expires_at > now();
  return v_email;  -- null when invalid/expired/claimed
end;
$$;
revoke all on function peek_pending_invite_email(uuid) from public;
grant execute on function peek_pending_invite_email(uuid) to anon, authenticated;

-----------------------------------------------------------------------
-- claim_pending_invite — called by the signed-in client when the URL
-- has ?invite=<token>. Verifies the caller's email matches the invite,
-- inserts the right grant (board_shares or workspace_members) if not
-- already present, marks the row claimed, and returns the redirect
-- target. Idempotent — the backstop trigger may have already done the
-- grant; this RPC just becomes a redirect helper in that case.
-----------------------------------------------------------------------
create or replace function claim_pending_invite(p_token uuid)
returns table(workspace_id uuid, board_id uuid)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_row           pending_invites%rowtype;
  v_caller_email  text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to claim invite' using errcode = '42501';
  end if;

  select email into v_caller_email from auth.users where id = auth.uid();

  select * into v_row from pending_invites where token = p_token;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if v_row.expires_at <= now() then
    raise exception 'invite has expired' using errcode = '22023';
  end if;

  if lower(v_row.email) <> lower(coalesce(v_caller_email, '')) then
    raise exception 'this invite is for a different email' using errcode = '42501';
  end if;

  if v_row.claimed_at is not null and v_row.claimed_by is distinct from auth.uid() then
    raise exception 'invite already claimed' using errcode = '22023';
  end if;

  if v_row.board_id is not null then
    insert into board_shares (board_id, user_id, role, invited_by)
    values (v_row.board_id, auth.uid(),
            case when v_row.role = 'editor' then 'editor' else 'viewer' end,
            v_row.invited_by)
    on conflict (board_id, user_id) do nothing;
  else
    insert into workspace_members (workspace_id, user_id, role)
    values (v_row.workspace_id, auth.uid(),
            case when v_row.role = 'viewer' then 'viewer' else 'editor' end)
    on conflict (workspace_id, user_id) do nothing;
  end if;

  update pending_invites
     set claimed_at = coalesce(claimed_at, now()),
         claimed_by = coalesce(claimed_by, auth.uid())
   where id = v_row.id;

  return query select v_row.workspace_id, v_row.board_id;
end;
$$;
revoke all on function claim_pending_invite(uuid) from public;
grant execute on function claim_pending_invite(uuid) to authenticated;

-----------------------------------------------------------------------
-- _claim_pending_invites_for_user — backstop helper. Invoked by the
-- auth.users INSERT trigger (extended in 0087) so a brand-new user
-- automatically inherits any unclaimed invites that match their email.
--
-- NEVER raises — failures inside the loop are logged via raise warning
-- so a single bad invite can't block account creation.
-----------------------------------------------------------------------
create or replace function _claim_pending_invites_for_user(p_user_id uuid, p_email text)
returns integer
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_row    pending_invites%rowtype;
  v_count  integer := 0;
  v_email_norm text := lower(trim(coalesce(p_email, '')));
begin
  if v_email_norm = '' or p_user_id is null then
    return 0;
  end if;

  for v_row in
    select * from pending_invites
    where lower(email) = v_email_norm
      and claimed_at is null
      and expires_at > now()
  loop
    begin
      if v_row.board_id is not null then
        insert into board_shares (board_id, user_id, role, invited_by)
        values (v_row.board_id, p_user_id,
                case when v_row.role = 'editor' then 'editor' else 'viewer' end,
                v_row.invited_by)
        on conflict (board_id, user_id) do nothing;
      else
        insert into workspace_members (workspace_id, user_id, role)
        values (v_row.workspace_id, p_user_id,
                case when v_row.role = 'viewer' then 'viewer' else 'editor' end)
        on conflict (workspace_id, user_id) do nothing;
      end if;

      update pending_invites
         set claimed_at = now(),
             claimed_by = p_user_id
       where id = v_row.id;

      v_count := v_count + 1;
    exception when others then
      raise warning '_claim_pending_invites_for_user: claim id=% failed: %', v_row.id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;
revoke all on function _claim_pending_invites_for_user(uuid, text) from public;
-- No grant: only the auth.users trigger (running as postgres) should call this.

-----------------------------------------------------------------------
-- revoke_pending_invite — owner-only delete. Used by ShareModal's
-- "Remove" button on pending rows.
-----------------------------------------------------------------------
create or replace function revoke_pending_invite(p_id uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare v_owner uuid;
begin
  select w.created_by into v_owner
  from pending_invites pi
  join workspaces w on w.id = pi.workspace_id
  where pi.id = p_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can revoke invites'
      using errcode = '42501';
  end if;

  delete from pending_invites where id = p_id;
end;
$$;
revoke all on function revoke_pending_invite(uuid) from public;
grant execute on function revoke_pending_invite(uuid) to authenticated;

-----------------------------------------------------------------------
-- list_pending_invites_for_board — owner-only. Used by ShareModal to
-- render the "Pending signup" rows next to the existing board_shares.
-----------------------------------------------------------------------
create or replace function list_pending_invites_for_board(p_board_id uuid)
returns table(id uuid, email text, role text, invited_by uuid,
              expires_at timestamptz, created_at timestamptz)
language plpgsql security definer
set search_path = public as $$
declare v_owner uuid;
begin
  select w.created_by into v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = p_board_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can list pending invites'
      using errcode = '42501';
  end if;

  return query
  select pi.id, pi.email, pi.role, pi.invited_by, pi.expires_at, pi.created_at
  from pending_invites pi
  where pi.board_id = p_board_id
    and pi.claimed_at is null
    and pi.expires_at > now()
  order by pi.created_at asc;
end;
$$;
revoke all on function list_pending_invites_for_board(uuid) from public;
grant execute on function list_pending_invites_for_board(uuid) to authenticated;

-----------------------------------------------------------------------
-- list_pending_invites_for_workspace — owner-only. Used by ShareModal
-- to list pending workspace-level invites (board_id IS NULL).
-----------------------------------------------------------------------
create or replace function list_pending_invites_for_workspace(p_workspace_id uuid)
returns table(id uuid, email text, role text, board_id uuid,
              invited_by uuid, expires_at timestamptz, created_at timestamptz)
language plpgsql security definer
set search_path = public as $$
declare v_owner uuid;
begin
  select created_by into v_owner from workspaces where id = p_workspace_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can list pending invites'
      using errcode = '42501';
  end if;

  return query
  select pi.id, pi.email, pi.role, pi.board_id, pi.invited_by, pi.expires_at, pi.created_at
  from pending_invites pi
  where pi.workspace_id = p_workspace_id
    and pi.claimed_at is null
    and pi.expires_at > now()
    and pi.board_id is null
  order by pi.created_at asc;
end;
$$;
revoke all on function list_pending_invites_for_workspace(uuid) from public;
grant execute on function list_pending_invites_for_workspace(uuid) to authenticated;

-----------------------------------------------------------------------
-- Email trigger: fire 'pending_invite' template on INSERT. Mirrors the
-- pattern of _tg_workspace_member_email / _tg_share_notification_email
-- in 0074. Fires on INSERT only — upserts that flow through ON CONFLICT
-- DO UPDATE land as UPDATE rows and intentionally don't re-send.
-----------------------------------------------------------------------
create or replace function _tg_pending_invite_email()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
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

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
    into v_inviter_name
    from auth.users u
    left join public.profiles p on p.user_id = u.id
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
$$;

drop trigger if exists pending_invite_email_trigger on public.pending_invites;
create trigger pending_invite_email_trigger
  after insert on public.pending_invites
  for each row execute function public._tg_pending_invite_email();
