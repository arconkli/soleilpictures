-- 0605_chat_ends_at_removal.sql
--
-- A conversation participant whose access was ended (revoked_at, written by
-- _offboard_member in 0524 when they leave or are removed from the
-- conversation's workspace) is no longer in it:
--   * is_conversation_participant and is_active_conversation_participant
--     require revoked_at is null, so every policy built on them (messages,
--     conversations, participants, entity_links, the conv: realtime topics and
--     the message-attachments storage policy) stops answering them;
--   * inbox pings, mention notifications and unread counts skip them;
--   * find_or_create_dm starts a new conversation rather than reopening one
--     either person was removed from;
--   * an active participant who can message them may add them back
--     (add_conversation_participants clears revoked_at); nobody can add
--     themselves back;
--   * the participants insert policy's creator branch also requires that the
--     creator can still write the conversation's workspace.
--
-- messages.workspace_id is NOT derived from the conversation: a DM between
-- share collaborators is posted from the sender's own workspace.
--
-- Bodies re-emitted from the live definitions; only these lines change.

CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conv uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from conversation_participants
    where conversation_id = p_conv and user_id = auth.uid()
      and revoked_at is null
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_active_conversation_participant(p_conv uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from conversation_participants
    where conversation_id = p_conv and user_id = auth.uid() and left_at is null
      and revoked_at is null
  );
$function$;

CREATE OR REPLACE FUNCTION public.find_or_create_dm(p_workspace uuid, p_peer uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'must be authenticated' using errcode = '42501';
  end if;
  if v_me = p_peer then
    raise exception 'cannot DM yourself' using errcode = '22023';
  end if;
  if not is_workspace_member(p_workspace) then
    raise exception 'must be a workspace member' using errcode = '42501';
  end if;
  if not can_message(p_peer) then
    raise exception 'cannot message this user' using errcode = '42501';
  end if;

  select c.id into v_id
  from conversations c
  where exists (select 1 from conversation_participants where conversation_id = c.id and user_id = v_me)
    and exists (select 1 from conversation_participants where conversation_id = c.id and user_id = p_peer)
    and (select count(*) from conversation_participants where conversation_id = c.id) = 2
    -- 0605: never one either person was removed from; that history stays
    -- with the workspace it was in, and a new conversation starts here.
    and not exists (select 1 from conversation_participants
                     where conversation_id = c.id and revoked_at is not null)
  limit 1;

  if v_id is not null then
    update conversation_participants
       set left_at = null
     where conversation_id = v_id and user_id = v_me and left_at is not null;
    return v_id;
  end if;

  insert into conversations (workspace_id, created_by) values (p_workspace, v_me)
    returning id into v_id;
  insert into conversation_participants (conversation_id, user_id) values (v_id, v_me);
  insert into conversation_participants (conversation_id, user_id) values (v_id, p_peer);
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.messages_fanout_inbox_pings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  preview text;
  payload jsonb;
  recipient record;
begin
  if new.kind = 'system' then
    return new;
  end if;

  preview := substring(regexp_replace(coalesce(new.body, ''), E'\\s+', ' ', 'g') from 1 for 140);

  payload := jsonb_build_object(
    'conversation_id', new.conversation_id,
    'message_id',      new.id,
    'sender_id',       new.sender_id,
    'sender_email',    new.sender_email,
    'workspace_id',    new.workspace_id,
    'body_preview',    preview,
    'mentions',        coalesce(to_jsonb(new.mentions), '[]'::jsonb),
    'has_attachments', (jsonb_array_length(coalesce(new.attachments, '[]'::jsonb)) > 0),
    'parent_id',       new.parent_id,
    'created_at',      new.created_at
  );

  for recipient in
    select user_id
    from conversation_participants
    where conversation_id = new.conversation_id
      and left_at is null
      and revoked_at is null
      and user_id <> new.sender_id
  loop
    perform realtime.send(
      payload,
      'inbox-ping',
      'user:' || recipient.user_id::text,
      true
    );
  end loop;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.messages_fire_mention_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_max_per_hour constant int := 30;
  v_recent int;
begin
  if new.mentions is null or array_length(new.mentions, 1) = 0 then
    return new;
  end if;
  if new.kind = 'system' then
    return new;
  end if;
  -- 0369: an account on a sending hold notifies nobody.
  if exists (select 1 from public.profiles p where p.user_id = new.sender_id and p.send_hold_at is not null) then
    return new;
  end if;

  -- 0364: at most 30 mention notifications per sender per hour.
  select count(*) into v_recent
    from public.mention_notifications m
   where m.mentioned_by = new.sender_id
     and m.created_at > now() - interval '1 hour';
  if v_recent >= c_max_per_hour then
    return new;
  end if;

  -- 0360: only active participants of this conversation (the only people who
  -- can read it) whom the sender can message, each once, at most 50.
  -- can_message reads auth.uid(), which the messages INSERT policy pins to
  -- new.sender_id. 0364: and the same person at most once per 10 minutes.
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
                        and cp.left_at is null
                        and cp.revoked_at is null)
         and public.can_message(t.uid)
         and not exists (select 1 from public.mention_notifications m
                          where m.user_id = t.uid
                            and m.mentioned_by = new.sender_id
                            and m.conversation_id = new.conversation_id
                            and m.created_at > now() - interval '10 minutes')
       limit least(50, c_max_per_hour - v_recent)
    ) r;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_unread_counts()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(json_object_agg(conversation_id::text, cnt), '{}'::json)
  from (
    select m.conversation_id, count(*) as cnt
    from messages m
    join conversation_participants p
      on p.conversation_id = m.conversation_id
     and p.user_id = auth.uid()
     and p.revoked_at is null
    where m.deleted_at is null
      and m.kind = 'user'
      and m.sender_id <> auth.uid()
      and m.created_at > p.last_read_at
    group by m.conversation_id
  ) sub;
$function$;

CREATE OR REPLACE FUNCTION public.add_conversation_participants(p_conversation_id uuid, p_user_ids uuid[])
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ws    uuid;
  v_uid   uuid;
  v_added uuid;
begin
  select c.workspace_id into v_ws from public.conversations c where c.id = p_conversation_id;
  if v_ws is null then
    raise exception 'conversation not found' using errcode = '42704';
  end if;
  if not public.is_active_conversation_participant(p_conversation_id)
     or not public.can_write_workspace(v_ws) then
    raise exception 'you cannot add people to this conversation' using errcode = '42501';
  end if;

  foreach v_uid in array coalesce(p_user_ids, '{}'::uuid[]) loop
    continue when v_uid is null or v_uid = auth.uid() or not public.can_message(v_uid);
    v_added := null;
    insert into public.conversation_participants as cp (conversation_id, user_id)
    values (p_conversation_id, v_uid)
    on conflict (conversation_id, user_id) do update
       set left_at = null, revoked_at = null, joined_at = now()
     where cp.left_at is not null or cp.revoked_at is not null
    returning cp.user_id into v_added;
    if v_added is not null then
      return next v_added;
    end if;
  end loop;
end $function$;

alter policy "participants insert" on public.conversation_participants with check (
  (is_active_conversation_participant(conversation_id)
   and (exists (select 1 from conversations c
                 where c.id = conversation_participants.conversation_id
                   and can_write_workspace(c.workspace_id)))
   and ((user_id = auth.uid()) or can_message(user_id)))
  or ((user_id = auth.uid())
      and (exists (select 1 from conversations c
                    where c.id = conversation_participants.conversation_id
                      and c.created_by = auth.uid()
                      and can_write_workspace(c.workspace_id))))
);

-- The 0311 habit: prove the grants, don't trust them.
do $$
begin
  if not has_function_privilege('authenticated', 'public.is_conversation_participant(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_active_conversation_participant(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.find_or_create_dm(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_unread_counts()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.add_conversation_participants(uuid,uuid[])', 'EXECUTE') then
    raise exception '0605: a chat function lost its grant';
  end if;
  if has_function_privilege('anon', 'public.find_or_create_dm(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_unread_counts()', 'EXECUTE')
     or has_function_privilege('anon', 'public.add_conversation_participants(uuid,uuid[])', 'EXECUTE') then
    raise exception '0605: a chat RPC is callable signed out';
  end if;
  if has_column_privilege('authenticated', 'public.conversation_participants', 'revoked_at', 'UPDATE') then
    raise exception '0605: clients can write conversation_participants.revoked_at';
  end if;
end $$;
