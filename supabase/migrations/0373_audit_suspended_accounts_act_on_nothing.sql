-- 0373 — a suspended account acts on nothing, and every account action is on
-- record. The second half of 0371, split for size (0372 is another session's).
--
-- The audit found the owner-only shortcuts (make a link, transfer or delete a
-- workspace) never asked whether the caller was suspended; a banned account's
-- API keys still resolved and its OAuth connections still refreshed; its open
-- sessions stayed open; and it could delete itself, taking the record of what
-- it did with it.
--
--   4. The owner shortcuts check the caller; making or indexing a link is
--      sharing, so a sending hold stops that too.
--   5. API keys resolve as revoked; OAuth codes and refresh tokens refuse.
--   6. can_read_board: a share on a cluster in the trash grants nothing.
--   7. prepare_account_deletion refuses a banned account (self-delete only;
--      an admin can still delete it).
--   8. account_actions: every ban, unban, sending hold and release is
--      recorded with an evidence snapshot that outlives the account. A ban
--      also ends every open session and every API session at once.
--   9. The Security tab's overview gains banned accounts, recent account
--      actions, and the ids of held mail (so system mail can be released).
--  10. Three maintenance functions any visitor could run are server-only now
--      (one recomputed every owner's storage on demand), and setting a tag's
--      type needs an editor, like every other tag edit since 0366.
--
-- Open sockets: a banned account cannot reconnect to a live cluster
-- (PartyKit re-checks can_write_board on every connect), but a socket already
-- open stays until it drops. Closing it needs a PartyKit change; tracked as
-- a follow-up.

begin;

-- ── 4. The owner's shortcuts check the actor too ──────────────────────────

CREATE OR REPLACE FUNCTION public.create_public_link(p_board_id uuid, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_include_subboards boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner    uuid;
  v_is_owner boolean;
  v_token    uuid;
begin
  -- 0371: a link is sharing, so an account on a sending hold (0369) or a
  -- suspended one makes none.
  if not public._actor_can_send() then
    raise exception 'sharing is paused on this account while we review unusual activity'
      using errcode = '42501';
  end if;
  select w.created_by into v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = p_board_id;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to create links for this board'
      using errcode = '42501';
  end if;

  insert into public_share_links (board_id, role, created_by, expires_at, include_subboards)
  values (p_board_id, 'viewer', auth.uid(), p_expires_at, coalesce(p_include_subboards, false))
  returning token into v_token;
  return v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_collab_link(p_board_id uuid, p_role text DEFAULT 'editor'::text, p_expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval))
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner    uuid;
  v_is_owner boolean;
  v_token    uuid;
begin
  -- 0371: a link is sharing, so an account on a sending hold (0369) or a
  -- suspended one makes none.
  if not public._actor_can_send() then
    raise exception 'sharing is paused on this account while we review unusual activity'
      using errcode = '42501';
  end if;
  if p_role not in ('viewer','editor') then
    raise exception 'role must be viewer or editor' using errcode = '22023';
  end if;

  select w.created_by into v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = p_board_id;
  if v_owner is null then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to create links for this board'
      using errcode = '42501';
  end if;

  select l.token into v_token
  from public_share_links l
  where l.board_id = p_board_id
    and l.kind = 'invite'
    and l.role = p_role
    and l.created_by = auth.uid()
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now())
  order by l.created_at desc
  limit 1;
  if v_token is not null then
    return v_token;
  end if;

  insert into public_share_links
    (board_id, role, kind, created_by, expires_at, include_subboards, allow_indexing)
  values
    (p_board_id, p_role, 'invite', auth.uid(), p_expires_at, true, false)
  returning token into v_token;
  return v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_public_link_indexing(p_token uuid, p_allow boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner           uuid;
  v_is_owner        boolean;
  v_link_created_by uuid;
  v_board_id        uuid;
  v_kind            text;
begin
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  if coalesce(p_allow, false) and not public._actor_can_send() then
    raise exception 'sharing is paused on this account while we review unusual activity'
      using errcode = '42501';
  end if;
  select w.created_by, l.created_by, l.board_id, l.kind
    into v_owner, v_link_created_by, v_board_id, v_kind
  from public_share_links l
  join boards b on b.id = l.board_id
  join workspaces w on w.id = b.workspace_id
  where l.token = p_token;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and (v_link_created_by is distinct from auth.uid()
                          or not can_write_board(v_board_id)) then
    raise exception 'you can only manage links you created' using errcode = '42501';
  end if;
  if v_kind = 'invite' and coalesce(p_allow, false) then
    raise exception 'invite links can''t be indexed' using errcode = '22023';
  end if;

  update public_share_links set allow_indexing = coalesce(p_allow, false)
  where token = p_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_public_link_subboards(p_token uuid, p_include boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner           uuid;
  v_is_owner        boolean;
  v_link_created_by uuid;
  v_board_id        uuid;
begin
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  select w.created_by, l.created_by, l.board_id
    into v_owner, v_link_created_by, v_board_id
  from public_share_links l
  join boards b on b.id = l.board_id
  join workspaces w on w.id = b.workspace_id
  where l.token = p_token;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and (v_link_created_by is distinct from auth.uid()
                          or not can_write_board(v_board_id)) then
    raise exception 'you can only manage links you created' using errcode = '42501';
  end if;

  update public_share_links set include_subboards = coalesce(p_include, false)
  where token = p_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_workspace_ownership(p_workspace_id uuid, p_new_owner uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old uuid;
begin
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  -- A banned account's clusters stop serving, so it can't be handed one.
  if public._user_banned(p_new_owner) then
    raise exception 'that account cannot own a workspace' using errcode = '42501';
  end if;
  if p_new_owner = auth.uid() then
    raise exception 'cannot transfer ownership to yourself'
      using errcode = '22023';
  end if;

  select created_by into v_old from workspaces where id = p_workspace_id;
  if v_old is null then
    raise exception 'workspace % not found', p_workspace_id using errcode = '42704';
  end if;
  if v_old <> auth.uid() then
    raise exception 'only the current owner can transfer ownership'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from workspace_members
    where workspace_id = p_workspace_id and user_id = p_new_owner
  ) then
    raise exception 'new owner must already be a workspace member'
      using errcode = '42704';
  end if;

  update workspaces set created_by = p_new_owner where id = p_workspace_id;
  update workspace_members set role = 'owner'
    where workspace_id = p_workspace_id and user_id = p_new_owner;
  update workspace_members set role = 'editor'
    where workspace_id = p_workspace_id and user_id = v_old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_workspace(p_workspace_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
begin
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  select created_by into v_owner from workspaces where id = p_workspace_id;
  if v_owner is null then
    raise exception 'workspace % not found', p_workspace_id using errcode = '42704';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'only the workspace owner can delete it' using errcode = '42501';
  end if;
  delete from workspaces where id = p_workspace_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_workspace_with_root(p_name text, p_root_name text DEFAULT 'Studio'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid;
  ws_id uuid;
  brd_id uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'must be authenticated';
  end if;
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  insert into workspaces (name, created_by)
    values (coalesce(nullif(trim(p_name), ''), 'Workspace'), uid)
    returning id into ws_id;

  insert into workspace_members (workspace_id, user_id, role)
    values (ws_id, uid, 'owner');

  insert into boards (workspace_id, parent_board_id, name, view, created_by)
    values (ws_id, null, coalesce(nullif(trim(p_root_name), ''), 'Studio'), 'canvas', uid)
    returning id into brd_id;

  insert into board_state (board_id, doc)
    values (brd_id, '');

  return jsonb_build_object(
    'workspace_id', ws_id,
    'root_board_id', brd_id
  );
end $function$;

-- ── 5. API keys and OAuth stop working for a banned account ──────────────

CREATE OR REPLACE FUNCTION public.api_token_resolve(p_token_hash text)
 RETURNS TABLE(user_id uuid, token_id uuid, scopes text[], reason text, req_count integer, req_limit integer, req_reset timestamp with time zone, workspace_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  t public.api_tokens%rowtype; v_limit integer; v_valid boolean;
  v_count integer; v_reset timestamptz;
begin
  select * into t from public.api_tokens where token_hash = p_token_hash;
  if not found then
    return query select null::uuid, null::uuid, null::text[], 'unknown'::text,
                        null::integer, 1000, null::timestamptz, null::uuid;
    return;
  end if;
  v_limit := coalesce(t.req_limit, 1000);
  v_valid := t.revoked_at is null and (t.expires_at is null or t.expires_at > now());
  update public.api_tokens a
     set req_window   = case when now() - a.req_window > interval '1 hour' then now() else a.req_window end,
         req_count    = case when now() - a.req_window > interval '1 hour' then 1 else a.req_count + 1 end,
         last_used_at = case when v_valid then now() else a.last_used_at end
   where a.id = t.id
  returning a.req_count, a.req_window + interval '1 hour' into v_count, v_reset;
  if v_count > v_limit then
    return query select null::uuid, null::uuid, null::text[], 'rate_limited'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;
  if t.revoked_at is not null then
    return query select null::uuid, null::uuid, null::text[], 'revoked'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;
  if t.expires_at is not null and t.expires_at <= now() then
    return query select null::uuid, null::uuid, null::text[], 'expired'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;
  if exists (select 1 from public.service_accounts s
              where s.user_id = t.user_id and s.disabled_at is not null) then
    return query select null::uuid, null::uuid, null::text[], 'revoked'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;
  -- 0371: a banned account's keys stop working (and work again if the ban
  -- is lifted). apiAuth.js mints sessions only for a token that resolves.
  if public._user_banned(t.user_id) then
    return query select null::uuid, null::uuid, null::text[], 'revoked'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;
  return query select t.user_id, t.id, t.scopes, null::text,
                      v_count, v_limit, v_reset, t.workspace_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.oauth_code_redeem(p_code_hash text, p_client_id text, p_redirect_uri text, p_verifier text, p_access_hash text, p_prefix text, p_refresh_hash text, p_access_ttl integer DEFAULT 3600, p_refresh_days integer DEFAULT 90)
 RETURNS TABLE(grant_id uuid, user_id uuid, scope text[], resource text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  c        public.oauth_codes;
  v_client public.oauth_clients;
  v_token  uuid;
  v_grant  uuid;
  v_challenge text;
  v_exp    timestamptz := now() + make_interval(secs => greatest(60, least(coalesce(p_access_ttl, 3600), 86400)));
begin
  if p_verifier is null or length(p_verifier) < 43 or length(p_verifier) > 128 then
    raise exception 'a PKCE code_verifier of 43-128 characters is required' using errcode = '22023';
  end if;

  v_challenge := rtrim(
    translate(replace(encode(extensions.digest(p_verifier, 'sha256'), 'base64'), E'\n', ''), '+/', '-_'),
    '=');

  update public.oauth_codes
     set consumed_at = now()
   where code_hash = p_code_hash
     and client_id = p_client_id
     and redirect_uri = p_redirect_uri
     and code_challenge = v_challenge
     and consumed_at is null
     and public.oauth_codes.expires_at > now()
  returning * into c;

  if not found then
    raise exception 'that authorization code is not valid' using errcode = '22023';
  end if;
  -- 0371: a banned account connects nothing new.
  if public._user_banned(c.user_id) then
    raise exception 'that authorization code is not valid' using errcode = '22023';
  end if;

  select * into v_client from public.oauth_clients where client_id = p_client_id;

  insert into public.api_tokens (user_id, name, token_hash, prefix, scopes, expires_at, oauth_client_id)
  values (c.user_id, left(coalesce(v_client.client_name, 'Connected app'), 80),
          p_access_hash, p_prefix, c.scope, v_exp, p_client_id)
  returning id into v_token;

  insert into public.oauth_grants (
    client_id, user_id, scope, resource, refresh_token_hash, token_id, refresh_expires_at
  ) values (
    p_client_id, c.user_id, c.scope, c.resource, p_refresh_hash, v_token,
    now() + make_interval(days => greatest(1, least(coalesce(p_refresh_days, 90), 365)))
  ) returning id into v_grant;

  update public.oauth_clients set last_used_at = now() where client_id = p_client_id;

  return query select v_grant, c.user_id, c.scope, c.resource, v_exp;
end;
$function$;

CREATE OR REPLACE FUNCTION public.oauth_refresh_rotate(p_refresh_hash text, p_client_id text, p_new_access_hash text, p_prefix text, p_new_refresh_hash text, p_access_ttl integer DEFAULT 3600, p_refresh_days integer DEFAULT 90)
 RETURNS TABLE(grant_id uuid, user_id uuid, scope text[], resource text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g     public.oauth_grants;
  v_exp timestamptz := now() + make_interval(secs => greatest(60, least(coalesce(p_access_ttl, 3600), 86400)));
begin
  update public.oauth_grants
     set refresh_token_hash = p_new_refresh_hash,
         last_used_at = now(),
         refresh_expires_at = now() + make_interval(days => greatest(1, least(coalesce(p_refresh_days, 90), 365)))
   where refresh_token_hash = p_refresh_hash
     and client_id = p_client_id
     and revoked_at is null
     and (refresh_expires_at is null or refresh_expires_at > now())
  returning * into g;

  if not found then
    raise exception 'that refresh token is not valid' using errcode = '22023';
  end if;
  -- 0371: nor refreshes an old connection (the rotation rolls back with it).
  if public._user_banned(g.user_id) then
    raise exception 'that refresh token is not valid' using errcode = '22023';
  end if;

  update public.api_tokens
     set token_hash = p_new_access_hash,
         prefix     = p_prefix,
         expires_at = v_exp,
         revoked_at = null
   where id = g.token_id;

  return query select g.id, g.user_id, g.scope, g.resource, v_exp;
end;
$function$;

-- ── 6. A share on a deleted cluster grants nothing ───────────────────────

CREATE OR REPLACE FUNCTION public.can_read_board(p_board_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with recursive chain as (
    select id, workspace_id, parent_board_id, deleted_at
    from boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id, b.deleted_at
    from boards b join chain c on b.id = c.parent_board_id
  )
  select public._actor_active() and exists (
    select 1 from chain
    where is_workspace_member(chain.workspace_id)
       -- 0371: a share on a cluster in the trash grants nothing.
       or (chain.deleted_at is null and exists (
         select 1 from board_shares s
         where s.board_id = chain.id and s.user_id = auth.uid()
       ))
  );
$function$;

-- ── 7. A banned account cannot delete itself ─────────────────────────────

CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_xfer int := 0;
  v_del  int := 0;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22004';
  end if;
  -- 0371: a banned account cannot delete itself: that would take the record
  -- of what it did with it and free the address to sign up again. An admin
  -- can still delete it (admin-account-action does not come through here).
  if public._user_banned(p_user_id) then
    raise exception 'this account is suspended; contact support to close it' using errcode = '42501';
  end if;

  with heir as (
    select w.id as workspace_id,
           (select m.user_id from workspace_members m
             where m.workspace_id = w.id and m.user_id <> p_user_id
             order by m.created_at asc, m.user_id asc
             limit 1) as to_user
    from workspaces w
    where w.created_by = p_user_id
      and exists (select 1 from workspace_members m
                   where m.workspace_id = w.id and m.user_id <> p_user_id)
  )
  update workspaces w
     set created_by = h.to_user
    from heir h
   where w.id = h.workspace_id and h.to_user is not null;
  get diagnostics v_xfer = row_count;

  delete from workspaces w
   where w.created_by = p_user_id
     and not exists (select 1 from workspace_members m
                      where m.workspace_id = w.id and m.user_id <> p_user_id);
  get diagnostics v_del = row_count;

  return jsonb_build_object('workspaces_transferred', v_xfer,
                            'workspaces_deleted', v_del);
end;
$function$;

-- ── 8. The record of every account action ───────────────────────────────────

create table if not exists public.account_actions (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid not null,   -- deliberately no foreign key: the record outlives the account
  email      text,
  action     text not null check (action in ('ban', 'unban', 'send_hold', 'send_release')),
  actor      uuid,            -- who did it; null when the breaker did, or the service role
  reason     text,
  evidence   jsonb
);
alter table public.account_actions enable row level security;
revoke all on table public.account_actions from public, anon, authenticated;
create index if not exists account_actions_user_idx   on public.account_actions (user_id, created_at desc);
create index if not exists account_actions_recent_idx on public.account_actions (created_at desc);

-- What the account had out in the world at the moment it was stopped. Taken
-- then, because pending_invites.invited_by and the rest are ON DELETE SET
-- NULL: once the account is gone, nothing else ties these back to it.
create or replace function public._account_evidence(p_user uuid)
returns jsonb
language sql stable security definer
set search_path = public, auth as $$
  select jsonb_build_object(
    'account_created_at', (select u.created_at from auth.users u where u.id = p_user),
    'last_sign_in_at',    (select u.last_sign_in_at from auth.users u where u.id = p_user),
    'workspaces_owned',   (select count(*) from public.workspaces w where w.created_by = p_user),
    'clusters_owned',     (select count(*) from public.boards b
                             join public.workspaces w on w.id = b.workspace_id
                            where w.created_by = p_user and b.deleted_at is null),
    'cluster_names',      (select coalesce(jsonb_agg(left(x.name, 80)), '[]'::jsonb)
                             from (select b.name from public.boards b
                                     join public.workspaces w on w.id = b.workspace_id
                                    where w.created_by = p_user
                                    order by b.created_at desc limit 20) x),
    'live_share_links',   (select count(*) from public.public_share_links l
                            where l.created_by = p_user and l.revoked_at is null
                              and (l.expires_at is null or l.expires_at > now())),
    'published_clusters', (select count(*) from public.public_boards pb
                             join public.boards b on b.id = pb.board_id
                             join public.workspaces w on w.id = b.workspace_id
                            where pb.published_at is not null
                              and (w.created_by = p_user or pb.submitted_by = p_user)),
    'invitations_sent',   (select count(*) from public.pending_invites i where i.invited_by = p_user),
    'invitation_domains', (select coalesce(jsonb_object_agg(x.d, x.n), '{}'::jsonb)
                             from (select split_part(lower(i.email), '@', 2) as d, count(*) as n
                                     from public.pending_invites i
                                    where i.invited_by = p_user
                                    group by 1 order by 2 desc limit 15) x),
    'outbound_7d',        (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
                             from (select l.template || ':' || l.state as k, count(*) as n
                                     from public.outbound_ledger l
                                    where l.actor = p_user and l.created_at > now() - interval '7 days'
                                    group by 1) x)
  );
$$;

-- Fires on a ban, an unban, a sending hold and a release — whoever made them
-- (admin-account-action, the breaker, the Security tab). A ban also ends the
-- sessions that exist: the auth ban stops new sign-ins and refreshes, and the
-- API sessions apiAuth.js minted for keys go with them.
create or replace function public._tg_profiles_account_action()
returns trigger
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_email text;
begin
  select u.email into v_email from auth.users u where u.id = new.user_id;

  if old.banned_at is null and new.banned_at is not null then
    insert into public.account_actions (user_id, email, action, actor, reason, evidence)
    values (new.user_id, v_email, 'ban', coalesce(new.banned_by, auth.uid()), new.banned_reason,
            public._account_evidence(new.user_id));
    delete from auth.sessions s where s.user_id = new.user_id;
    delete from public.api_sessions a where a.user_id = new.user_id;
  elsif old.banned_at is not null and new.banned_at is null then
    insert into public.account_actions (user_id, email, action, actor)
    values (new.user_id, v_email, 'unban', auth.uid());
  end if;

  if old.send_hold_at is null and new.send_hold_at is not null then
    insert into public.account_actions (user_id, email, action, actor, reason, evidence)
    values (new.user_id, v_email, 'send_hold', auth.uid(), new.send_hold_reason,
            public._account_evidence(new.user_id));
  elsif old.send_hold_at is not null and new.send_hold_at is null then
    insert into public.account_actions (user_id, email, action, actor)
    values (new.user_id, v_email, 'send_release', auth.uid());
  end if;

  return null;
end;
$$;

drop trigger if exists profiles_account_action on public.profiles;
create trigger profiles_account_action
  after update of banned_at, send_hold_at on public.profiles
  for each row
  when (old.banned_at is distinct from new.banned_at or old.send_hold_at is distinct from new.send_hold_at)
  execute function public._tg_profiles_account_action();

-- ── 9. The Security tab sees bans, account actions, and held mail by id ─────

create or replace function public.admin_security_overview()
returns jsonb
language plpgsql security definer
set search_path = public, auth as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'breaker', (select to_jsonb(b) from public.outbound_breaker b where b.id = 1),
    'held_accounts', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'email', u.email,
                                          'since', p.send_hold_at, 'reason', p.send_hold_reason)
                       order by p.send_hold_at desc)
        from public.profiles p join auth.users u on u.id = p.user_id
       where p.send_hold_at is not null), '[]'::jsonb),
    'banned_accounts', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'email', u.email,
                                          'since', p.banned_at, 'reason', p.banned_reason)
                       order by p.banned_at desc)
        from (select * from public.profiles where banned_at is not null
               order by banned_at desc limit 50) p
        join auth.users u on u.id = p.user_id), '[]'::jsonb),
    'held_mail', coalesce((
      select jsonb_agg(x order by x->>'oldest')
        from (select jsonb_build_object('actor', l.actor, 'email', u.email, 'count', count(*),
                                        'oldest', min(l.created_at),
                                        'templates', to_jsonb(array_agg(distinct l.template)),
                                        'ids', to_jsonb(array_agg(l.id order by l.id))) x
                from public.outbound_ledger l left join auth.users u on u.id = l.actor
               where l.state = 'held'
               group by l.actor, u.email) s), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
        from (select id, created_at, kind, title, body, actor, page, paged_at, acked_at
                from public.ops_alerts order by created_at desc limit 50) a), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
        from (select id, created_at, user_id, email, action, actor, reason, evidence
                from public.account_actions order by created_at desc limit 30) a), '[]'::jsonb),
    'last_7d', coalesce((
      select jsonb_object_agg(k, n)
        from (select risk || ':' || state as k, count(*) as n
                from public.outbound_ledger
               where created_at > now() - interval '7 days' group by 1) z), '{}'::jsonb)
  );
end;
$$;

-- ── 10. A viewer's tag edit ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_tag_entity_type(p_tag_id uuid, p_entity_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ws uuid;
begin
  if p_entity_type is not null
     and p_entity_type <> all (array['character','setting','concept','thing','organization']) then
    raise exception 'invalid entity_type: %', p_entity_type;
  end if;
  select workspace_id into ws from tags where id = p_tag_id;
  if ws is null then raise exception 'tag not found'; end if;
  -- 0371: an edit, so an editor's right (0366 closed the table; this is the RPC).
  if not can_write_workspace(ws) then
    raise exception 'not authorized';
  end if;
  update tags set entity_type = p_entity_type where id = p_tag_id;
end;
$function$;

-- Any visitor could run these three. One recomputed every owner's storage
-- usage on demand; the other two only ran early what their nightly jobs do.
-- The jobs run as the owner, so nothing they do changes.
revoke execute on function public.reconcile_storage_usage() from public, anon, authenticated;
revoke execute on function public.purge_old_deleted_tags() from public, anon, authenticated;
revoke execute on function public.purge_old_deleted_vote_cards() from public, anon, authenticated;

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke execute on function public._account_evidence(uuid) from public, anon, authenticated;
revoke execute on function public._tg_profiles_account_action() from public, anon, authenticated;

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
declare
  v_fn   text;
  v_need text;
  r      record;
begin
  foreach v_fn in array array[
    'public._account_evidence(uuid)',
    'public._tg_profiles_account_action()',
    'public.reconcile_storage_usage()',
    'public.purge_old_deleted_tags()',
    'public.purge_old_deleted_vote_cards()'] loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0373: % is client-executable', v_fn;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.account_actions', 'select')
     or has_table_privilege('anon', 'public.account_actions', 'select')
     or not (select relrowsecurity from pg_class where oid = 'public.account_actions'::regclass) then
    raise exception '0373: account_actions is client-readable or has no RLS';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'profiles_account_action'
                  and tgrelid = 'public.profiles'::regclass and not tgisinternal) then
    raise exception '0373: the account-action trigger is missing';
  end if;

  for r in
    select * from (values
      ('public.create_public_link(uuid,timestamp with time zone,boolean)',              '_actor_can_send()'),
      ('public.create_collab_link(uuid,text,timestamp with time zone)',                 '_actor_can_send()'),
      ('public.set_public_link_indexing(uuid,boolean)',                                 '_actor_active()'),
      ('public.set_public_link_subboards(uuid,boolean)',                                '_actor_active()'),
      ('public.transfer_workspace_ownership(uuid,uuid)',                                '_actor_active()'),
      ('public.delete_workspace(uuid)',                                                 '_actor_active()'),
      ('public.create_workspace_with_root(text,text)',                                  '_actor_active()'),
      ('public.api_token_resolve(text)',                                                '_user_banned(t.user_id)'),
      ('public.oauth_code_redeem(text,text,text,text,text,text,text,integer,integer)',  '_user_banned(c.user_id)'),
      ('public.oauth_refresh_rotate(text,text,text,text,text,integer,integer)',         '_user_banned(g.user_id)'),
      ('public.can_read_board(uuid)',                                                   'chain.deleted_at is null'),
      ('public.prepare_account_deletion(uuid)',                                         '_user_banned(p_user_id)'),
      ('public.set_tag_entity_type(uuid,text)',                                         'can_write_workspace(ws)')
    ) as t(fn, marker)
  loop
    select prosrc into v_need from pg_proc where oid = r.fn::regprocedure;
    if position(r.marker in v_need) = 0 then
      raise exception '0373: % lacks its check (%)', r.fn, r.marker;
    end if;
  end loop;
end $$;

commit;
