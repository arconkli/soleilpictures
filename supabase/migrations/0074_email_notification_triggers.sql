-- 0074_email_notification_triggers.sql — fire transactional emails
-- from DB triggers when someone is added to a workspace or has a board
-- shared with them.
--
-- Why triggers (vs. wrapping each call site): workspace_members and
-- share_notifications are populated from multiple paths — RPCs, the
-- share_board function, settings UIs, ownership transfer flows. A
-- single trigger per table catches every insert uniformly, so a new
-- call site can't accidentally skip the email.
--
-- Mechanism: pg_net.http_post fires async POSTs to the edge function
-- send-transactional-email. The Bearer token lives in Supabase Vault
-- under the name 'edge_email_token' (set out-of-band after migration
-- applies — do NOT bake the real value into git).
--
-- All triggers are deliberately fire-and-forget: a failed email never
-- rolls back the insert. pg_net queues the request inside the same
-- transaction, so if the tx rolls back the request is dropped too.

create extension if not exists pg_net;

-- ── Vault setup ────────────────────────────────────────────────────────
-- Create the secret with a placeholder if it doesn't exist yet. The
-- real value is set by `select vault.update_secret(id, '<token>')` once
-- the matching SEND_EMAIL_SECRET is provisioned in Supabase Edge
-- Function secrets. _notify_email below no-ops when the placeholder
-- is still in place.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'edge_email_token') then
    perform vault.create_secret(
      'CHANGE_ME',
      'edge_email_token',
      'Bearer token for the send-transactional-email edge function'
    );
  end if;
end $$;

-- ── _notify_email helper ───────────────────────────────────────────────
-- Posts to send-transactional-email with a Vault-stored bearer token.
-- Security-definer so RLS doesn't get in the way of reading vault or
-- net.http_post. Returns void; on configuration error it logs a
-- warning rather than raising so callers don't fail.

create or replace function public._notify_email(
  p_template text,
  p_to       text,
  p_data     jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public, vault, net as $$
declare
  v_token text;
  v_url   text := 'https://ehlhlmbpwwalmeisvmdp.supabase.co/functions/v1/send-transactional-email';
begin
  if p_to is null or p_to = '' then return; end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'edge_email_token'
  limit 1;

  if v_token is null or v_token = 'CHANGE_ME' then
    raise warning '_notify_email: vault secret edge_email_token not configured; skipping email %', p_template;
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := jsonb_build_object('template', p_template, 'to', p_to, 'data', p_data),
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning '_notify_email failed for template %: %', p_template, sqlerrm;
end;
$$;
revoke all on function public._notify_email(text, text, jsonb) from public;
-- Trigger functions inherit the postgres role's privileges; no grant
-- to authenticated needed (and we don't want clients calling it directly).

-- ── workspace_members trigger ──────────────────────────────────────────
-- Fires "{inviter} added you to {workspace}" when a NEW row is
-- inserted into workspace_members AND the user being added is NOT the
-- workspace's own owner (which catches every "owner bootstraps their
-- personal workspace" path).
--
-- Inviter name resolution: profiles.display_name → auth.users.email →
-- "Someone on Clusters".

create or replace function public._tg_workspace_member_email()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_owner_id      uuid;
  v_workspace_name text;
  v_recipient_email text;
  v_inviter_name  text;
begin
  -- Workspace owner = the inviter for our purposes. Skip if the new
  -- member IS the owner (creator-adds-self bootstrap path).
  select w.created_by, w.name
  into v_owner_id, v_workspace_name
  from public.workspaces w
  where w.id = new.workspace_id;

  if v_owner_id is null or new.user_id = v_owner_id then
    return new;
  end if;

  select email into v_recipient_email
  from auth.users where id = new.user_id;
  if v_recipient_email is null then return new; end if;

  -- Inviter display name with email + generic fallback.
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
      'role',          coalesce(new.role, 'member')
    )
  );

  return new;
end;
$$;

drop trigger if exists workspace_member_email_trigger on public.workspace_members;
create trigger workspace_member_email_trigger
  after insert on public.workspace_members
  for each row execute function public._tg_workspace_member_email();

-- ── share_notifications trigger ────────────────────────────────────────
-- Fires '{sharer} shared "{board}" with you' on every share_notifications
-- insert. share_board RPC fires one of these per share, so this is the
-- single point of capture.

create or replace function public._tg_share_notification_email()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_recipient_email text;
  v_board_name      text;
  v_sharer_name     text;
begin
  if new.shared_by is null or new.shared_by = new.user_id then
    return new;
  end if;

  select email into v_recipient_email
  from auth.users where id = new.user_id;
  if v_recipient_email is null then return new; end if;

  select name into v_board_name from public.boards where id = new.board_id;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_sharer_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.shared_by;

  perform public._notify_email(
    'board_shared',
    v_recipient_email,
    jsonb_build_object(
      'boardName',  coalesce(v_board_name,  'a board'),
      'sharerName', coalesce(v_sharer_name, 'Someone on Clusters'),
      'role',       coalesce(new.role, 'viewer')
    )
  );

  return new;
end;
$$;

drop trigger if exists share_notification_email_trigger on public.share_notifications;
create trigger share_notification_email_trigger
  after insert on public.share_notifications
  for each row execute function public._tg_share_notification_email();
