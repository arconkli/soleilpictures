-- 0398 — Reacting to someone else's message saves.
--
-- Reactions live in messages.reactions ({ "<emoji>": ["<user id>", …] }) and
-- the client wrote them with a plain UPDATE. The only UPDATE policy on
-- messages is the author's own ("messages update", 0058: sender_id =
-- auth.uid() and kind = 'user'), so a reaction to anyone else's message
-- matched zero rows, raised no error, and was gone on the next refetch.
-- Only reactions to your own messages ever stuck (COMMS-02).
--
-- Widening that policy would let any participant rewrite any message's body,
-- so the write goes through this one narrow RPC instead. It lets in exactly
-- who may post in the conversation — the "messages insert" predicate (0083):
-- an active participant who can write the message's workspace (which itself
-- refuses suspended accounts and the waitlist) — and touches only the
-- caller's own entry under one emoji. The row is locked for the toggle, so
-- two people reacting at once no longer overwrite each other the way the
-- client's read-modify-write did.
--
-- Returns the message's reactions after the toggle.

begin;

create or replace function public.toggle_message_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_conv      uuid;
  v_ws        uuid;
  v_reactions jsonb;
  v_list      jsonb;
begin
  if v_uid is null then
    raise exception 'sign in to react' using errcode = '42501';
  end if;
  if p_emoji is null or char_length(btrim(p_emoji)) = 0 or char_length(p_emoji) > 32 then
    raise exception 'not a reaction' using errcode = '22023';
  end if;

  select m.conversation_id, m.workspace_id, coalesce(m.reactions, '{}'::jsonb)
    into v_conv, v_ws, v_reactions
    from public.messages m
   where m.id = p_message_id
     and m.deleted_at is null
     for update;
  if v_conv is null then
    raise exception 'message not found' using errcode = '42704';
  end if;

  -- The same people who may post here (policy "messages insert", 0083).
  if not (public.is_active_conversation_participant(v_conv)
          and public.can_write_workspace(v_ws)) then
    raise exception 'not a member of this conversation' using errcode = '42501';
  end if;

  v_list := v_reactions -> p_emoji;
  if v_list is null or jsonb_typeof(v_list) <> 'array' then
    v_list := '[]'::jsonb;
  end if;
  if v_list ? v_uid::text then
    v_list := v_list - v_uid::text;
  else
    v_list := v_list || to_jsonb(v_uid::text);
  end if;
  if jsonb_array_length(v_list) = 0 then
    v_reactions := v_reactions - p_emoji;
  else
    v_reactions := jsonb_set(v_reactions, array[p_emoji], v_list, true);
  end if;

  update public.messages set reactions = v_reactions where id = p_message_id;
  return v_reactions;
end;
$$;

revoke execute on function public.toggle_message_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;

-- The 0311 habit: a REVOKE reporting success proves nothing.
do $$
begin
  if has_function_privilege('anon', 'public.toggle_message_reaction(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.toggle_message_reaction(uuid, text)', 'execute') then
    raise exception '0398: toggle_message_reaction grants are wrong';
  end if;
end $$;

commit;
