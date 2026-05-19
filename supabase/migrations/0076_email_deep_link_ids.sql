-- 0076_email_deep_link_ids.sql — pass workspace + board IDs in the
-- email payload so the CTA URL can deep-link the recipient directly
-- to the right workspace/board after sign-in. AuthGate consumes the
-- `?w=&b=` params and writes them into the localStorage keys App reads
-- on mount, so the user lands on the right place without manual nav.
--
-- Pure function-body update — trigger bindings from 0074 / 0075 stay.

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
      'role',          coalesce(new.role, 'member'),
      'workspaceId',   new.workspace_id::text
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
  v_workspace_id    uuid;
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

  select name, workspace_id into v_board_name, v_workspace_id
  from public.boards where id = new.board_id;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_sharer_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.shared_by;

  perform public._notify_email(
    'board_shared',
    v_recipient_email,
    jsonb_build_object(
      'boardName',   coalesce(v_board_name,  'a board'),
      'sharerName',  coalesce(v_sharer_name, 'Someone on Clusters'),
      'role',        coalesce(new.role, 'viewer'),
      'workspaceId', v_workspace_id::text,
      'boardId',     new.board_id::text
    )
  );

  return new;
end;
$$;

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
      'messagePreview', v_message_preview,
      'workspaceId',    new.workspace_id::text,
      'boardId',        new.board_id::text
    )
  );

  return new;
end;
$$;

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
  v_workspace_id     uuid;
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

  select b.name, w.name, b.workspace_id
  into v_board_name, v_workspace_name, v_workspace_id
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
      'replyPreview',  v_reply_preview,
      'workspaceId',   v_workspace_id::text,
      'boardId',       new.board_id::text
    )
  );

  return new;
end;
$$;
