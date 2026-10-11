-- 0407 — Re-adding someone who left a group brings them back (audit COMMS-18).
--
-- addParticipants upserted with ignoreDuplicates (ON CONFLICT DO NOTHING), so
-- a person who had left kept left_at set. The thread posted "A added B" and
-- toasted success while B stayed out: nothing reached them and they could not
-- post. A client may only update its OWN participant row ("participants
-- update self"), so letting someone else back in needs a definer.
--
-- add_conversation_participants applies the insert policy's rule for adding
-- someone else ("participants insert"): the caller is an active participant,
-- can write the conversation's workspace, and may message each person
-- (can_message). A new person is inserted; one who left is let back in
-- (left_at cleared, joined_at now). It returns who actually joined, so the
-- thread announces only them.

begin;

create or replace function public.add_conversation_participants(p_conversation_id uuid, p_user_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
       set left_at = null, joined_at = now()
     where cp.left_at is not null
    returning cp.user_id into v_added;
    if v_added is not null then
      return next v_added;
    end if;
  end loop;
end $function$;

revoke execute on function public.add_conversation_participants(uuid, uuid[]) from public, anon;

do $$
begin
  if has_function_privilege('anon', 'public.add_conversation_participants(uuid,uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.add_conversation_participants(uuid,uuid[])', 'execute') then
    raise exception '0407: grants are wrong on add_conversation_participants';
  end if;
end $$;

commit;
