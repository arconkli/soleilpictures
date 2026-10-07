-- 0375 — an account's first three days, and an invite budget per inbox.
--
-- Throwaway accounts do their damage in their first hours, and they get
-- everything at minute zero (audit AC-8): API keys, OAuth connections,
-- webhooks, service accounts, indexable links, an Explore submission, as many
-- workspaces as a script can make. No real account has needed any of those
-- in its first days, so for its first 72 hours an account can't:
--
--   - mint an API key or a service token, or add a service account;
--   - connect an OAuth app;
--   - add a webhook, or point one at a new address (re-pointing a workspace's
--     events is the same act);
--   - let search engines index a share link, or submit a cluster to Explore;
--   - own more than four workspaces (no real account has had more than three).
--
-- The refusal says what opens up and when. The four functions that never
-- asked whether the caller was suspended now do too.
--
-- And the invite budget (0358: 20 a day, 5 on the first) belonged to an
-- account, while accounts are free: one inbox signs up as a+1@, a+2@, … and
-- gets a fresh budget each time. It now belongs to the inbox: accounts that
-- reach the same mailbox (a +tag, or Gmail's dots — _outbound_recipient_key,
-- 0369) share one allowance. The constants, the "invite limit reached"
-- wording ShareModal stops on, and the revoke stay exactly as they were.

begin;

-- ── New accounts ────────────────────────────────────────────────────────────

create or replace function public._account_is_new()
returns boolean
language sql stable security definer
set search_path = public, auth as $$
  select coalesce((select u.created_at > now() - interval '72 hours'
                     from auth.users u where u.id = auth.uid()), false);
$$;

create or replace function public._refuse_if_new(p_what text)
returns void
language plpgsql stable security definer
set search_path = public as $$
begin
  if public._account_is_new() then
    raise exception '% opens up once an account is three days old', p_what
      using errcode = '42501', hint = 'new_account';
  end if;
end;
$$;

-- ── The inbox an invitation was charged to ──────────────────────────────────

alter table public.invite_send_ledger add column if not exists identity_key text;
create index if not exists invite_send_ledger_identity_idx
  on public.invite_send_ledger (identity_key, created_at desc) where identity_key is not null;

-- ── The gates ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.api_token_mint(p_name text, p_scopes text[] DEFAULT ARRAY['read'::text], p_ttl_days integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, token text, prefix text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  v_token  text;
  v_prefix text;
  v_id     uuid;
  v_name   text := coalesce(nullif(btrim(p_name), ''), 'API token');
  v_scopes text[] := coalesce(p_scopes, array['read']);
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  -- 0375: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  -- 0375: not in an account's first three days.
  perform public._refuse_if_new('Creating an API key');
  if not (v_scopes <@ array['read','write','delete']) then
    raise exception 'scopes must be a subset of read, write, delete' using errcode = '22023';
  end if;

  if 'delete' = any(v_scopes) and not ('write' = any(v_scopes)) then
    v_scopes := v_scopes || 'write'::text;
  end if;
  if not ('read' = any(v_scopes)) then
    v_scopes := array['read'] || v_scopes;
  end if;
  select array_agg(s order by array_position(array['read','write','delete'], s))
    into v_scopes
    from (select distinct unnest(v_scopes) as s) d;

  if (select count(*) from public.api_tokens
       where user_id = auth.uid() and revoked_at is null and oauth_client_id is null) >= 20 then
    raise exception 'too many active tokens — revoke one first' using errcode = '54000';
  end if;

  v_token  := 'sk_live_' || encode(extensions.gen_random_bytes(20), 'hex');
  v_prefix := substr(v_token, 1, 14);

  insert into public.api_tokens (user_id, name, token_hash, prefix, scopes, expires_at)
  values (
    auth.uid(), left(v_name, 80),
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_prefix, v_scopes,
    case when p_ttl_days is null then null
         else now() + make_interval(days => greatest(1, least(p_ttl_days, 3650))) end
  )
  returning api_tokens.id into v_id;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (auth.uid(), 'api_token_minted', jsonb_build_object('scopes', v_scopes));
  exception when others then null;
  end;

  return query select v_id, v_token, v_prefix;
end;
$function$;

CREATE OR REPLACE FUNCTION public.api_token_mint_for(p_user_id uuid, p_name text, p_scopes text[] DEFAULT ARRAY['read'::text], p_ttl_days integer DEFAULT NULL::integer, p_req_limit integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, token text, prefix text, req_limit integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
#variable_conflict use_column
declare
  v_token text; v_prefix text; v_id uuid; v_ws uuid;
  v_limit integer := coalesce(p_req_limit, 10000);
  v_name text := coalesce(nullif(btrim(p_name), ''), 'Service token');
  v_scopes text[] := coalesce(p_scopes, array['read']);
begin
  if auth.uid() is null then raise exception 'must be signed in' using errcode = '42501'; end if;
  -- 0360
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  -- 0375: not in an account's first three days.
  perform public._refuse_if_new('Creating a service token');
  if not (v_scopes <@ array['read','write','delete']) then
    raise exception 'scopes must be a subset of read, write, delete' using errcode = '22023';
  end if;
  select s.workspace_id into v_ws from public.service_accounts s
   where s.user_id = p_user_id and s.disabled_at is null;
  if v_ws is null then raise exception 'no such active service account' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.workspaces w where w.id = v_ws and w.created_by = auth.uid()) then
    raise exception 'only the workspace owner can mint a service token' using errcode = '42501';
  end if;
  -- 0360: the token acts as p_user_id, so p_user_id must be a machine.
  if not public._is_service_identity(p_user_id) then
    raise exception 'that user is not a service identity' using errcode = '42501';
  end if;
  if 'delete' = any(v_scopes) and not ('write' = any(v_scopes)) then
    v_scopes := v_scopes || 'write'::text;
  end if;
  if not ('read' = any(v_scopes)) then v_scopes := array['read'] || v_scopes; end if;
  select array_agg(s order by array_position(array['read','write','delete'], s))
    into v_scopes from (select distinct unnest(v_scopes) as s) d;
  if (select count(*) from public.api_tokens t
       where t.user_id = p_user_id and t.revoked_at is null) >= 20 then
    raise exception 'too many active tokens — revoke one first' using errcode = '54000';
  end if;
  v_limit  := greatest(1, least(v_limit, 1000000));
  v_token  := 'sk_live_' || encode(extensions.gen_random_bytes(20), 'hex');
  v_prefix := substr(v_token, 1, 14);
  insert into public.api_tokens
    (user_id, name, token_hash, prefix, scopes, expires_at, req_limit, workspace_id)
  values (p_user_id, left(v_name, 80),
    encode(extensions.digest(v_token, 'sha256'), 'hex'), v_prefix, v_scopes,
    case when p_ttl_days is null then null
         else now() + make_interval(days => greatest(1, least(p_ttl_days, 3650))) end,
    v_limit, v_ws)
  returning api_tokens.id into v_id;
  return query select v_id, v_token, v_prefix, v_limit;
end;
$function$;

CREATE OR REPLACE FUNCTION public.oauth_authorize_consent(p_client_id text, p_code_hash text, p_redirect_uri text, p_scope text[], p_challenge text, p_method text DEFAULT 'S256'::text, p_resource text DEFAULT NULL::text, p_ttl_seconds integer DEFAULT 120)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_client public.oauth_clients;
  v_scope  text[];
  v_exp    timestamptz;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  -- 0375: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  -- 0375: not in an account's first three days.
  perform public._refuse_if_new('Connecting an app');

  select * into v_client from public.oauth_clients
   where client_id = p_client_id and disabled_at is null;
  if not found then
    raise exception 'unknown client' using errcode = '22023';
  end if;
  if not (p_redirect_uri = any(v_client.redirect_uris)) then
    raise exception 'redirect_uri does not match this client' using errcode = '22023';
  end if;
  if coalesce(p_method, 'S256') <> 'S256' then
    raise exception 'code_challenge_method must be S256' using errcode = '22023';
  end if;
  if p_challenge is null or length(p_challenge) < 43 then
    raise exception 'a PKCE code_challenge is required' using errcode = '22023';
  end if;

  v_scope := coalesce(p_scope, array['read']);
  if not (v_scope <@ array['read','write','delete']) then
    raise exception 'scopes must be a subset of read, write, delete' using errcode = '22023';
  end if;
  if 'delete' = any(v_scope) and not ('write' = any(v_scope)) then
    v_scope := v_scope || 'write'::text;
  end if;
  if not ('read' = any(v_scope)) then v_scope := array['read'] || v_scope; end if;
  select array_agg(s order by array_position(array['read','write','delete'], s))
    into v_scope from (select distinct unnest(v_scope) as s) d;

  if (select count(*) from public.oauth_grants
       where user_id = auth.uid() and revoked_at is null) >= 20 then
    raise exception 'too many connected apps — disconnect one first' using errcode = '54000';
  end if;

  v_exp := now() + make_interval(secs => greatest(30, least(coalesce(p_ttl_seconds, 120), 600)));

  insert into public.oauth_codes (
    code_hash, client_id, user_id, redirect_uri, scope,
    code_challenge, code_challenge_method, resource, expires_at
  ) values (
    p_code_hash, p_client_id, auth.uid(), p_redirect_uri, v_scope,
    p_challenge, 'S256', nullif(p_resource, ''), v_exp
  );

  begin
    insert into public.analytics_events (user_id, event, props)
    values (auth.uid(), 'oauth_consent_granted',
            jsonb_build_object('client', v_client.client_name, 'scopes', v_scope));
  exception when others then null;
  end;

  return v_exp;
end;
$function$;

CREATE OR REPLACE FUNCTION public.webhook_create(p_workspace_id uuid, p_url text, p_events text[], p_name text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, secret text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_secret text; v_id uuid;
begin
  if not public.can_write_workspace(p_workspace_id) then
    raise exception 'you cannot add a webhook to this workspace' using errcode = '42501';
  end if;
  -- 0375: not in an account's first three days.
  perform public._refuse_if_new('Adding a webhook');
  if (select count(*) from public.webhooks w
       where w.workspace_id = p_workspace_id and w.active) >= 20 then
    raise exception 'a workspace may have at most 20 active webhooks' using errcode = '54000';
  end if;
  v_secret := 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.webhooks (workspace_id, url, events, secret, name, created_by)
  values (p_workspace_id, p_url, p_events, v_secret, left(nullif(btrim(p_name),''), 80), auth.uid())
  returning webhooks.id into v_id;
  return query select v_id, v_secret, now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.webhook_update(p_id uuid, p_url text DEFAULT NULL::text, p_events text[] DEFAULT NULL::text[], p_name text DEFAULT NULL::text, p_active boolean DEFAULT NULL::boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_ws uuid;
begin
  select w.workspace_id into v_ws from public.webhooks w where w.id = p_id;
  if v_ws is null then return false; end if;
  if not public.can_write_workspace(v_ws) then
    raise exception 'not your webhook' using errcode = '42501';
  end if;
  -- 0375: pointing a workspace's events somewhere new is adding a webhook.
  if p_url is not null then
    perform public._refuse_if_new('Pointing a webhook at a new address');
  end if;
  update public.webhooks w
     set url    = coalesce(p_url, w.url),
         events = coalesce(p_events, w.events),
         name   = coalesce(nullif(btrim(p_name), ''), w.name),
         active = coalesce(p_active, w.active),
         failure_count   = case when p_active then 0 else w.failure_count end,
         disabled_reason = case when p_active then null else w.disabled_reason end,
         updated_at = now()
   where w.id = p_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.service_account_register(p_user_id uuid, p_workspace_id uuid, p_name text)
 RETURNS TABLE(user_id uuid, workspace_id uuid, name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
#variable_conflict use_column
declare
  v_name text := coalesce(nullif(btrim(p_name), ''), 'Service account');
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  -- 0360
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  -- 0375: not in an account's first three days.
  perform public._refuse_if_new('Adding a service account');
  if not exists (select 1 from public.workspaces w
                  where w.id = p_workspace_id and w.created_by = auth.uid()) then
    raise exception 'only the workspace owner can create a service account' using errcode = '42501';
  end if;
  -- 0360: only the machine identity the Worker just created, never a person ...
  if not public._is_service_identity(p_user_id) then
    raise exception 'that user is not a service identity' using errcode = '42501';
  end if;
  -- ... and never one that already belongs to a different workspace.
  if exists (select 1 from public.service_accounts s
              where s.user_id = p_user_id and s.workspace_id <> p_workspace_id)
     or exists (select 1 from public.workspace_members m
                 where m.user_id = p_user_id and m.workspace_id <> p_workspace_id) then
    raise exception 'that service identity belongs to another workspace' using errcode = '42501';
  end if;
  if (select count(*) from public.service_accounts s
       where s.workspace_id = p_workspace_id and s.disabled_at is null) >= 10 then
    raise exception 'a workspace may have at most 10 service accounts' using errcode = '54000';
  end if;
  update public.profiles p
     set tier = case when p.tier = 'waitlist' then 'demo' else p.tier end,
         is_service = true
   where p.user_id = p_user_id;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_workspace_id, p_user_id, 'service')
  on conflict (workspace_id, user_id) do nothing;
  insert into public.service_accounts (user_id, workspace_id, name, created_by)
  values (p_user_id, p_workspace_id, left(v_name, 80), auth.uid())
  on conflict (user_id) do update set name = excluded.name, disabled_at = null;
  return query select s.user_id, s.workspace_id, s.name, s.created_at
                 from public.service_accounts s where s.user_id = p_user_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_board_to_explore(p_board_id uuid, p_slug text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_body text DEFAULT NULL::text, p_keyword text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_board record;
  v_img int;
  v_slug text;
  v_base text;
  v_n int := 0;
  v_existing record;
begin
  if v_uid is null then raise exception 'sign in required' using errcode='42501'; end if;
  -- 0375: not in an account's first three days.
  perform public._refuse_if_new('Submitting to Explore');
  if not can_write_board(p_board_id) then
    raise exception 'you do not have access to this board' using errcode='42501';
  end if;
  select b.id, b.name into v_board from boards b where b.id = p_board_id and b.deleted_at is null;
  if v_board.id is null then raise exception 'no such board' using errcode='P0002'; end if;

  select board_id, published_at into v_existing from public_boards where board_id = p_board_id;
  if v_existing.board_id is not null and v_existing.published_at is not null then
    return jsonb_build_object('status','already_published',
      'slug', (select slug from public_boards where board_id = p_board_id));
  end if;

  select count(*) into v_img from card_index where board_id = p_board_id and kind = 'image';
  if v_img < 3 then
    raise exception 'A board needs at least 3 images to be published to Explore' using errcode='22023';
  end if;

  v_base := nullif(trim(coalesce(p_slug, '')), '');
  if v_base is null then
    v_base := lower(regexp_replace(regexp_replace(coalesce(v_board.name,'board'), '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'));
    v_base := nullif(v_base, ''); if v_base is null then v_base := 'board'; end if;
    v_base := left(v_base, 70);
    -- left(.,70) can put a hyphen back on the end; strip it (and any '-N'
    -- collision suffix would otherwise become '--N'). Re-floor if emptied.
    v_base := regexp_replace(v_base, '-+$', '', 'g');
    if v_base = '' then v_base := 'board'; end if;
  end if;
  v_slug := v_base;
  while exists (select 1 from public_boards pb where pb.slug = v_slug and pb.board_id <> p_board_id) loop
    v_n := v_n + 1; v_slug := left(v_base, 70) || '-' || v_n::text;
  end loop;

  insert into public_boards as pb
    (board_id, slug, seo_title, seo_description, seo_body, target_keyword,
     created_by, published_at, review_status, submitted_by, submitted_at, published_by, review_reason)
  values
    (p_board_id, v_slug,
     nullif(trim(coalesce(p_title,'')),''), nullif(trim(coalesce(p_description,'')),''),
     nullif(trim(coalesce(p_body,'')),''), nullif(trim(coalesce(p_keyword,'')),''),
     v_uid, null, 'pending', v_uid, now(), 'user', null)
  on conflict (board_id) do update set
    slug=coalesce(excluded.slug, pb.slug),
    seo_title=coalesce(excluded.seo_title, pb.seo_title),
    seo_description=coalesce(excluded.seo_description, pb.seo_description),
    seo_body=coalesce(excluded.seo_body, pb.seo_body),
    target_keyword=coalesce(excluded.target_keyword, pb.target_keyword),
    review_status='pending', submitted_by=v_uid, submitted_at=now(),
    published_by='user', review_reason=null, updated_at=now()
  where pb.published_at is null;

  return jsonb_build_object('status','pending','slug',v_slug);
end $function$;

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
  -- 0375: and not in an account's first three days.
  if coalesce(p_allow, false) then
    perform public._refuse_if_new('Letting search engines index a link');
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
  c_new_account_workspaces constant integer := 4;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'must be authenticated';
  end if;
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  -- 0375: a new account gets a handful of workspaces, not an endless supply.
  if public._account_is_new()
     and (select count(*) from workspaces w where w.created_by = uid) >= c_new_account_workspaces then
    raise exception 'a new account can have % workspaces for now; more open up once it is three days old',
      c_new_account_workspaces using errcode = '54000', hint = 'new_account';
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

CREATE OR REPLACE FUNCTION public._invite_budget_take()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  c_invite_daily_limit     constant integer := 20;
  c_invite_first_day_limit constant integer := 5;
  v_uid     uuid := auth.uid();
  v_created timestamptz;
  v_limit   integer;
  v_used    integer;
  v_key     text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- 0369: an account on a sending hold invites nobody. The phrase "invite
  -- limit reached" is what ShareModal recognises to stop its loop, so this
  -- refusal starts with it too.
  if exists (select 1 from public.profiles p where p.user_id = v_uid and p.send_hold_at is not null) then
    raise exception 'invite limit reached: sharing is paused on this account while we review unusual activity.'
      using errcode = 'P0001', hint = 'sending_on_hold';
  end if;

  -- 0375: the budget belongs to the inbox, not the account. Accounts that
  -- reach the same mailbox (a +tag, or Gmail's dots) share one allowance,
  -- so one inbox cannot mint a fleet of fresh budgets.
  select u.created_at, public._outbound_recipient_key(u.email) into v_created, v_key
    from auth.users u where u.id = v_uid;

  -- Serialise one inbox's calls, so two concurrent invites cannot both read
  -- the count before either records its send.
  perform pg_advisory_xact_lock(hashtext('invite_budget:' || coalesce(v_key, v_uid::text)));

  v_limit := case when v_created > now() - interval '24 hours'
                  then c_invite_first_day_limit else c_invite_daily_limit end;

  select count(*) into v_used
    from public.invite_send_ledger l
   where (l.inviter = v_uid or l.identity_key = v_key)
     and l.created_at > now() - interval '24 hours';

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

  insert into public.invite_send_ledger (inviter, identity_key) values (v_uid, v_key);
  -- Rows older than the window are never read again.
  delete from public.invite_send_ledger
   where inviter = v_uid and created_at < now() - interval '48 hours';
end;
$function$;

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke execute on function public._account_is_new() from public, anon, authenticated;
revoke execute on function public._refuse_if_new(text) from public, anon, authenticated;
revoke execute on function public._invite_budget_take() from public, anon, authenticated;

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
declare
  v_fn  text;
  r     record;
  v_src text;
begin
  foreach v_fn in array array['public._account_is_new()', 'public._refuse_if_new(text)', 'public._invite_budget_take()'] loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0375: % is client-executable', v_fn;
    end if;
  end loop;
  for r in
    select * from (values
      ('public.api_token_mint(text,text[],integer)',                              '_refuse_if_new(''Creating an API key'')'),
      ('public.api_token_mint_for(uuid,text,text[],integer,integer)',             '_refuse_if_new(''Creating a service token'')'),
      ('public.oauth_authorize_consent(text,text,text,text[],text,text,text,integer)', '_refuse_if_new(''Connecting an app'')'),
      ('public.webhook_create(uuid,text,text[],text)',                            '_refuse_if_new(''Adding a webhook'')'),
      ('public.webhook_update(uuid,text,text[],text,boolean)',                    '_refuse_if_new(''Pointing a webhook'),
      ('public.service_account_register(uuid,uuid,text)',                         '_refuse_if_new(''Adding a service account'')'),
      ('public.submit_board_to_explore(uuid,text,text,text,text,text)',           '_refuse_if_new(''Submitting to Explore'')'),
      ('public.set_public_link_indexing(uuid,boolean)',                           '_refuse_if_new(''Letting search engines'),
      ('public.create_workspace_with_root(text,text)',                            'c_new_account_workspaces constant integer := 4'),
      ('public._invite_budget_take()',                                            'or l.identity_key = v_key')
    ) as t(fn, marker)
  loop
    select prosrc into v_src from pg_proc where oid = r.fn::regprocedure;
    if position(r.marker in v_src) = 0 then
      raise exception '0375: % lacks its check (%)', r.fn, r.marker;
    end if;
  end loop;
  select prosrc into v_src from pg_proc where oid = 'public._invite_budget_take()'::regprocedure;
  if position('c_invite_daily_limit     constant integer := 20' in v_src) = 0
     or position('c_invite_first_day_limit constant integer := 5' in v_src) = 0
     or position('invite limit reached' in v_src) = 0 then
    raise exception '0375: _invite_budget_take lost its documented limits or its wording';
  end if;
end $$;

commit;
