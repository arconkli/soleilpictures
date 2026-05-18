-- 0075_communication_notifications.sql — peer-to-peer notification
-- emails (@mentions, comment replies) with presence-based throttling
-- and per-user opt-out.
--
-- Three structural pieces:
--   1. user_presence + touch_presence() RPC + _is_user_online() helper
--      so triggers can skip email when the user is actively in-app.
--   2. profiles.notification_prefs jsonb + _email_pref_enabled() helper
--      for per-user / per-template opt-out (default-on).
--   3. Two new triggers (mention_notifications, comments) and a
--      retrofit of v1's workspace + board-share triggers to consult
--      the prefs helper. Waitlist triggers stay unconditional (see
--      _notify_email comment in 0074).

-- ── User presence ─────────────────────────────────────────────────────
create table if not exists public.user_presence (
  user_id      uuid primary key references auth.users on delete cascade,
  last_seen_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists user_presence_last_seen_idx
  on public.user_presence(last_seen_at desc);

alter table public.user_presence enable row level security;

-- Only self-read. Writes go exclusively through touch_presence() so we
-- never expose user-controllable timestamps to RLS games.
drop policy if exists "presence read self" on public.user_presence;
create policy "presence read self" on public.user_presence
  for select using (user_id = auth.uid());

create or replace function public.touch_presence() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.user_presence (user_id, last_seen_at, updated_at)
  values (auth.uid(), now(), now())
  on conflict (user_id)
  do update set last_seen_at = now(), updated_at = now();
end;
$$;
revoke all on function public.touch_presence() from public;
grant execute on function public.touch_presence() to authenticated;

create or replace function public._is_user_online(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_presence
    where user_id = p_user_id
      and last_seen_at > now() - interval '5 minutes'
  );
$$;
revoke all on function public._is_user_online(uuid) from public;

-- ── Notification preferences (profiles column + helper) ───────────────
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- Default-on: if the key is missing OR set to anything not literally
-- 'false', the email fires. Users opt OUT by writing 'false'.
create or replace function public._email_pref_enabled(p_user_id uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select notification_prefs->>p_key from public.profiles where user_id = p_user_id),
    'true'
  ) <> 'false';
$$;
revoke all on function public._email_pref_enabled(uuid, text) from public;

-- ── Retrofit v1 triggers to honor prefs ───────────────────────────────
-- These two were unconditional in 0074. Now they check the prefs
-- helper so users can mute "added to workspace" / "board shared" mail.
create or replace function public._tg_workspace_member_email()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_owner_id        uuid;
  v_workspace_name  text;
  v_recipient_email text;
  v_inviter_name    text;
begin
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
      'role',          coalesce(new.role, 'member')
    )
  );

  return new;
end;
$$;

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

  if not public._email_pref_enabled(new.user_id, 'email_board_shared') then
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

-- ── Mention email trigger ─────────────────────────────────────────────
-- Fires on mention_notifications INSERT (which the 0020 message-mention
-- trigger populates). One layer above the in-app surface, gated by
-- online-skip + prefs.
create or replace function public._tg_mention_notification_email()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_recipient_email text;
  v_mentioner_name  text;
  v_message_body    text;
  v_message_preview text;
  v_board_name      text;
  v_workspace_name  text;
  v_surface         text;
  v_surface_context text;
begin
  if new.mentioned_by is null or new.mentioned_by = new.user_id then
    return new;
  end if;

  if public._is_user_online(new.user_id) then
    return new;
  end if;

  if not public._email_pref_enabled(new.user_id, 'email_mentions') then
    return new;
  end if;

  select email into v_recipient_email
  from auth.users where id = new.user_id;
  if v_recipient_email is null then return new; end if;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_mentioner_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.mentioned_by;

  select body into v_message_body from public.messages where id = new.message_id;
  v_message_preview := case
    when v_message_body is null then ''
    when length(v_message_body) > 140 then substring(v_message_body, 1, 140) || '…'
    else v_message_body
  end;

  -- Surface: DM, board chat, or fallback to workspace
  if new.dm_peer_id is not null then
    v_surface := 'dm';
    v_surface_context := 'a direct message';
  elsif new.board_id is not null then
    v_surface := 'board';
    select b.name, w.name into v_board_name, v_workspace_name
    from public.boards b
    left join public.workspaces w on w.id = b.workspace_id
    where b.id = new.board_id;
    v_surface_context := coalesce(v_board_name, 'a board')
                      || coalesce(' in ' || v_workspace_name, '');
  else
    v_surface := 'workspace';
    select name into v_workspace_name from public.workspaces where id = new.workspace_id;
    v_surface_context := coalesce(v_workspace_name, 'your workspace');
  end if;

  perform public._notify_email(
    'mention_email',
    v_recipient_email,
    jsonb_build_object(
      'mentionerName',  v_mentioner_name,
      'surface',        v_surface,
      'surfaceContext', v_surface_context,
      'messagePreview', v_message_preview
    )
  );

  return new;
end;
$$;

drop trigger if exists mention_email_trigger on public.mention_notifications;
create trigger mention_email_trigger
  after insert on public.mention_notifications
  for each row execute function public._tg_mention_notification_email();

-- ── Comment reply email trigger ───────────────────────────────────────
-- Fires on comments INSERT when the new comment is a reply (reply_to
-- is not null) AND the parent author isn't the same person AND isn't
-- currently active in-app AND hasn't muted the email.
create or replace function public._tg_comment_reply_email()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_parent_author    uuid;
  v_recipient_email  text;
  v_replier_name     text;
  v_reply_preview    text;
  v_board_name       text;
  v_workspace_name   text;
begin
  if new.reply_to is null or new.author is null then return new; end if;

  select author into v_parent_author from public.comments where id = new.reply_to;
  if v_parent_author is null or v_parent_author = new.author then
    return new;
  end if;

  if public._is_user_online(v_parent_author) then
    return new;
  end if;

  if not public._email_pref_enabled(v_parent_author, 'email_comment_replies') then
    return new;
  end if;

  select email into v_recipient_email
  from auth.users where id = v_parent_author;
  if v_recipient_email is null then return new; end if;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_replier_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.author;

  v_reply_preview := case
    when new.body is null then ''
    when length(new.body) > 140 then substring(new.body, 1, 140) || '…'
    else new.body
  end;

  select b.name, w.name into v_board_name, v_workspace_name
  from public.boards b
  left join public.workspaces w on w.id = b.workspace_id
  where b.id = new.board_id;

  perform public._notify_email(
    'comment_reply_email',
    v_recipient_email,
    jsonb_build_object(
      'replierName',   v_replier_name,
      'boardName',     coalesce(v_board_name, 'a board'),
      'workspaceName', coalesce(v_workspace_name, 'your workspace'),
      'replyPreview',  v_reply_preview
    )
  );

  return new;
end;
$$;

drop trigger if exists comment_reply_email_trigger on public.comments;
create trigger comment_reply_email_trigger
  after insert on public.comments
  for each row execute function public._tg_comment_reply_email();
