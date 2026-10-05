-- 0362 — what an adversarial review of 0358 and 0359 found, closed.
--
-- Applied to the database as 0360_review_fixes_impersonation_and_fanout,
-- between 0360 and 0361, which were written at the same time by other work and
-- touch none of the same objects. It is renumbered here so its prefix is
-- unique. The "0360" tags inside the function bodies below are the text that
-- is live, so they stay as they are.
--
-- 0358 capped invite email and stopped forged notifications. A review of the
-- shipped work then traced every remaining route by which one account can make
-- us email, or act as, another. Four were still open:
--
--   1. service_account_register accepted ANY user id. A workspace owner could
--      register someone else's account as their own service account, which
--      emailed that person a workspace invite, and then mint an API token for
--      it with api_token_mint_for: a token that acts as that person. Both
--      functions now require a machine identity, the kind the Worker creates
--      for this one purpose (createServiceAuthUser in boards/src/lib/apiAuth.js:
--      an undeliverable svc+…@service.soleilpictures.com address carrying
--      user_metadata.service_account = true), and refuse one already bound to
--      another workspace. Both also stop a suspended account (_actor_active).
--   2. The workspace_members AFTER INSERT trigger emailed every new member,
--      including a service identity, whose address bounces by design. It now
--      skips role = 'service'.
--   3. The "wm insert by workspace creator" policy let an owner add ANY user to
--      their workspace straight through PostgREST: an unbudgeted invite email
--      to anyone. No client writes workspace_members; every legitimate writer
--      is a SECURITY DEFINER function (claim and invite paths, workspace
--      creation, service_account_register). The policy goes, and so does the
--      client INSERT grant.
--   4. A chat message's mentions array notified every user id in it: no check
--      that they were in the conversation, no de-duplication, no cap, so one
--      message could email any account whose id the sender knew. Mentions now
--      reach only active participants the sender can message (can_message,
--      0178), once each, at most 50. Adding someone to a conversation through
--      the participants policy now needs can_message too, so the participant
--      list cannot be padded to get round that.
--
-- And one behaviour the public docs described wrongly:
--
--   5. share_board treated every call for an existing account as a new share,
--      so changing a collaborator's role re-sent "X shared Y with you" and
--      spent an invite. A share that already exists is now updated in place,
--      with no email and no budget.
--
-- Bodies are the live ones (the 0222 functions run comment-stripped copies of
-- the migration text, same logic) plus the additions marked 0360. Every
-- signature is unchanged, so create or replace keeps each ACL.

begin;

-- ── 1. Service accounts are machines ────────────────────────────────────────

create or replace function public._is_service_identity(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth as $$
  select exists (
    select 1 from auth.users u
     where u.id = p_user_id
       and u.email like 'svc+%@service.soleilpictures.com'
       and u.raw_user_meta_data ->> 'service_account' = 'true'
  );
$$;

comment on function public._is_service_identity(uuid) is
  'True only for a machine identity minted by the Worker''s createServiceAuthUser: an undeliverable svc+ address that no person can sign in with, plus user_metadata.service_account. Internal (0360).';

revoke execute on function public._is_service_identity(uuid) from public, anon, authenticated;

create or replace function public.service_account_register(
  p_user_id      uuid,
  p_workspace_id uuid,
  p_name         text
)
returns table(user_id uuid, workspace_id uuid, name text, created_at timestamptz)
language plpgsql security definer
set search_path = public, auth as $$
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
$$;

create or replace function public.api_token_mint_for(
  p_user_id   uuid,
  p_name      text,
  p_scopes    text[] default array['read'],
  p_ttl_days  int default null,
  p_req_limit int default null
)
returns table(id uuid, token text, prefix text, req_limit integer)
language plpgsql security definer
set search_path = public, auth as $$
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
$$;

-- ── 2. No membership email to a machine ─────────────────────────────────────
-- Body is 0076's, with the role = 'service' early return added.

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

-- ── 3. Memberships are written only by definer functions ────────────────────

drop policy if exists "wm insert by workspace creator" on public.workspace_members;
revoke insert on table public.workspace_members from public, anon, authenticated;

-- ── 4. Mentions reach the conversation, not the directory ───────────────────
-- Body is 0058's, with the recipient filter, de-duplication and cap added.

create or replace function public.messages_fire_mention_notifications()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mentions is null or array_length(new.mentions, 1) = 0 then
    return new;
  end if;
  if new.kind = 'system' then
    return new;
  end if;
  -- 0360: only active participants of this conversation (the only people who
  -- can read it) whom the sender can message, each once, at most 50.
  -- can_message reads auth.uid(), which the messages INSERT policy pins to
  -- new.sender_id.
  insert into public.mention_notifications
    (user_id, message_id, workspace_id, conversation_id, mentioned_by)
  select r.uid, new.id, new.workspace_id, new.conversation_id, new.sender_id
    from (
      select distinct t.uid
        from unnest(new.mentions) as t(uid)
       where t.uid is not null
         and t.uid <> new.sender_id
         and exists (select 1 from public.conversation_participants cp
                      where cp.conversation_id = new.conversation_id
                        and cp.user_id = t.uid
                        and cp.left_at is null)
         and public.can_message(t.uid)
       limit 50
    ) r;
  return new;
end;
$$;

-- 0083's policy, with can_message required to add anyone other than yourself.
drop policy if exists "participants insert" on public.conversation_participants;
create policy "participants insert" on public.conversation_participants for insert
  to authenticated
  with check (
    (
      is_active_conversation_participant(conversation_id)
      and exists (
        select 1 from public.conversations c
        where c.id = conversation_id
          and can_write_workspace(c.workspace_id)
      )
      and (user_id = auth.uid() or can_message(user_id))
    )
    or (
      user_id = auth.uid()
      and exists (
        select 1 from public.conversations c
        where c.id = conversation_id and c.created_by = auth.uid()
      )
    )
  );

-- ── 5. share_board: a role change is not a new share ────────────────────────
-- Body is 0358's, with the FOUND branch returning early.

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
  if FOUND then
    if not v_is_owner and v_existing_invited_by is distinct from auth.uid() then
      raise exception 'you can only change the access of people you invited'
        using errcode = '42501';
    end if;
    -- 0360: they already have access, so this is a role change, not a new
    -- share. It sends no email and spends no budget; before, the panel's role
    -- picker re-sent "X shared Y with you" and used up an invite every time.
    update board_shares
       set role = p_role, invited_by = auth.uid()
     where board_id = p_board_id and user_id = v_user;
    return 'granted';
  end if;

  -- 0358: the share_notifications row below emails `board_shared`, so a new
  -- share spends budget.
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

-- ── Proof ───────────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
begin
  -- Grants (the 0311 habit). The helper is internal; the client RPCs keep
  -- exactly what they had.
  if has_function_privilege('anon', 'public._is_service_identity(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._is_service_identity(uuid)', 'execute') then
    raise exception '0360: _is_service_identity is callable by a client';
  end if;
  if not has_function_privilege('authenticated', 'public.service_account_register(uuid,uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.api_token_mint_for(uuid,text,text[],integer,integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.share_board(uuid,text,text)', 'execute') then
    raise exception '0360: a client RPC lost its grant';
  end if;
  if has_function_privilege('anon', 'public.service_account_register(uuid,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.api_token_mint_for(uuid,text,text[],integer,integer)', 'execute')
     or has_function_privilege('anon', 'public.share_board(uuid,text,text)', 'execute') then
    raise exception '0360: a client RPC is callable by anon';
  end if;

  -- 1. Both service-account functions check the identity and the actor.
  select prosrc into v_src from pg_proc where oid = 'public.service_account_register(uuid,uuid,text)'::regprocedure;
  if position('_is_service_identity' in v_src) = 0 or position('_actor_active' in v_src) = 0
     or position('belongs to another workspace' in v_src) = 0 then
    raise exception '0360: service_account_register is missing a guard';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.api_token_mint_for(uuid,text,text[],integer,integer)'::regprocedure;
  if position('_is_service_identity' in v_src) = 0 or position('_actor_active' in v_src) = 0 then
    raise exception '0360: api_token_mint_for is missing a guard';
  end if;
  -- No person passes as a machine.
  if exists (select 1 from auth.users u
              where u.email not like 'svc+%@service.soleilpictures.com'
                and public._is_service_identity(u.id)) then
    raise exception '0360: a person passes as a service identity';
  end if;

  -- 2. No membership email to a service row.
  select prosrc into v_src from pg_proc where oid = 'public._tg_workspace_member_email()'::regprocedure;
  if position('new.role = ''service''' in v_src) = 0 then
    raise exception '0360: _tg_workspace_member_email still mails service identities';
  end if;

  -- 3. No client path writes workspace_members.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'workspace_members'
                and cmd in ('INSERT', 'ALL')) then
    raise exception '0360: an INSERT policy remains on workspace_members';
  end if;
  if has_table_privilege('anon', 'public.workspace_members', 'insert')
     or has_table_privilege('authenticated', 'public.workspace_members', 'insert') then
    raise exception '0360: a client can still insert into workspace_members';
  end if;

  -- 4. Mentions are filtered, and so is adding participants.
  select prosrc into v_src from pg_proc where oid = 'public.messages_fire_mention_notifications()'::regprocedure;
  if position('conversation_participants' in v_src) = 0 or position('can_message' in v_src) = 0
     or position('limit 50' in v_src) = 0 then
    raise exception '0360: messages_fire_mention_notifications is unfiltered';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'conversation_participants'
                    and policyname = 'participants insert' and with_check like '%can_message%') then
    raise exception '0360: the participants insert policy does not require can_message';
  end if;

  -- 5. A role change returns before the budget and the email.
  -- (Read from the existing-account branch on, the early return must come
  -- before the budget spend.)
  select prosrc into v_src from pg_proc where oid = 'public.share_board(uuid,text,text)'::regprocedure;
  v_src := substr(v_src, position('cannot share with yourself' in v_src));
  if position('is a role change' in v_src) = 0
     or position('is a role change' in v_src) > position('_invite_budget_take' in v_src) then
    raise exception '0360: share_board does not return early for an existing share';
  end if;
end $$;

commit;
