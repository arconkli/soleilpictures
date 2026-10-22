-- 0602_chat_stays_with_its_people.sql
--
-- A conversation's messages are read by the people in it.
--
-- 1. Clients may change only last_read_at and left_at on their own
--    conversation_participants row (mark read, hide, come back), and only
--    title and last_message_at on a conversation. Which conversation a row
--    belongs to, whose row it is, and which workspace a conversation lives in
--    are set by the RPCs that create them and stay put.
-- 2. A link that comes from a message (a mention, an attached cluster, card,
--    doc or URL) never carries the message's text: entity_links.context_text
--    is cleared for source_kind 'message' on every write, whoever writes it.
--    Such a link is readable only by the people in the message's conversation.
-- 3. get_entity_mentions searches only the messages of conversations the
--    caller is in, matches the term literally (% and _ are not wildcards) and
--    caps the page size. Its body is re-emitted from the live definition;
--    only those lines change.

revoke update on table public.conversation_participants from authenticated, anon;
grant update (last_read_at, left_at) on table public.conversation_participants to authenticated;

revoke update on table public.conversations from authenticated, anon;
grant update (title, last_message_at) on table public.conversations to authenticated;

create or replace function public._tg_entity_links_message_context()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if new.source_kind = 'message' then
    new.context_text := null;
  end if;
  return new;
end;
$function$;

revoke execute on function public._tg_entity_links_message_context() from public, anon, authenticated;

create or replace trigger entity_links_message_context
  before insert or update on public.entity_links
  for each row execute function public._tg_entity_links_message_context();

alter policy "entity_links read" on public.entity_links using (
  case
    when source_kind = 'message' then exists (
      select 1 from public.messages m
       where m.id::text = entity_links.source_id
         and public.is_conversation_participant(m.conversation_id))
    else (is_workspace_member(source_workspace) or ((source_board_id is not null) and can_read_board(source_board_id)))
  end
);

CREATE OR REPLACE FUNCTION public.get_entity_mentions(p_term text, p_workspace uuid, p_limit integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pat   text := lower(trim(p_term));
  like_pat text;
  lim   int := least(greatest(coalesce(p_limit, 6), 1), 24);
  ents  jsonb;
  apps  jsonb;
  total int;
begin
  if pat is null or pat = '' or p_workspace is null then
    return jsonb_build_object('entities', '[]'::jsonb, 'appears_in', '[]'::jsonb, 'total_appears', 0);
  end if;

  -- ADDED (0217): the caller must actually belong to the workspace they are
  -- asking about. Without this the function is a cross-tenant content search.
  if not is_workspace_member(p_workspace) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  -- The term is matched literally: % and _ in it are not wildcards.
  like_pat := '%' || replace(replace(replace(pat, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with by_alias as (
    select entity_kind, entity_id from entity_aliases
    where workspace_id = p_workspace and lower(alias) = pat
  ),
  ent_rows as (
    select es.id, es.kind, es.workspace_id, es.board_id, es.card_id,
           es.title, es.body, es.meta, es.updated_at
      from entity_search es
     where es.workspace_id = p_workspace
       and (lower(es.title) = pat
            or exists (
                 select 1 from by_alias ba
                  where ba.entity_kind = es.kind
                    and (ba.entity_id = es.id or ba.entity_id = es.board_id::text)
               ))
     limit (lim * 4)
  )
  select coalesce(jsonb_agg(to_jsonb(er)), '[]'::jsonb) into ents from ent_rows er;

  with apps_doc as (
    select 'doc' as source_kind, dp.doc_card_id::text as source_id,
           dp.page_id as source_page_id, dp.page_title as source_title,
           substring(dp.page_text from greatest(1, position(pat in lower(dp.page_text)) - 40) for 160) as snippet,
           dp.updated_at
      from doc_page_index dp
     where dp.workspace_id = p_workspace
       and dp.page_text ilike like_pat
     order by dp.updated_at desc
     limit lim
  ), apps_msg as (
    select 'message' as source_kind, m.id::text as source_id,
           null::text as source_page_id,
           null::text as source_title,
           substring(m.body from greatest(1, position(pat in lower(m.body)) - 40) for 160) as snippet,
           m.created_at as updated_at
      from messages m
     where m.workspace_id = p_workspace
       and m.deleted_at is null
       and m.body ilike like_pat
       and is_conversation_participant(m.conversation_id)
     order by m.created_at desc
     limit lim
  ), apps_card as (
    select case when ci.kind = 'note' then 'note'
                when ci.kind = 'doc'  then 'doc'
                else 'card' end as source_kind,
           ci.card_id::text as source_id,
           null::text as source_page_id,
           ci.title as source_title,
           coalesce(substring(ci.body from greatest(1, position(pat in lower(ci.body)) - 40) for 160), '') as snippet,
           ci.updated_at
      from card_index ci
     where ci.workspace_id = p_workspace
       and (lower(ci.title) like like_pat or lower(coalesce(ci.body, '')) like like_pat)
     order by ci.updated_at desc
     limit lim
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into apps from (
    select * from apps_doc union all
    select * from apps_msg union all
    select * from apps_card
  ) x;

  select
    (select count(*) from doc_page_index dp where dp.workspace_id = p_workspace and dp.page_text ilike like_pat)
  + (select count(*) from messages m where m.workspace_id = p_workspace and m.deleted_at is null and m.body ilike like_pat and is_conversation_participant(m.conversation_id))
  + (select count(*) from card_index ci where ci.workspace_id = p_workspace and (lower(ci.title) like like_pat or lower(coalesce(ci.body, '')) like like_pat))
  into total;

  return jsonb_build_object(
    'entities', ents,
    'appears_in', apps,
    'total_appears', coalesce(total, 0)
  );
end $function$;

-- The 0311 habit, plus the column grants: prove them, don't trust them.
do $$
begin
  if has_column_privilege('authenticated', 'public.conversation_participants', 'conversation_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.conversation_participants', 'user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.conversation_participants', 'joined_at', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.conversation_participants', 'last_read_at', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.conversation_participants', 'left_at', 'UPDATE') then
    raise exception '0602: conversation_participants column grants are wrong';
  end if;
  if has_column_privilege('authenticated', 'public.conversations', 'workspace_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.conversations', 'created_by', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.conversations', 'title', 'UPDATE') then
    raise exception '0602: conversations column grants are wrong';
  end if;
  if has_function_privilege('anon', 'public._tg_entity_links_message_context()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._tg_entity_links_message_context()', 'EXECUTE') then
    raise exception '0602: _tg_entity_links_message_context() is client-callable';
  end if;
  if has_function_privilege('anon', 'public.get_entity_mentions(text,uuid,integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_entity_mentions(text,uuid,integer)', 'EXECUTE') then
    raise exception '0602: get_entity_mentions grants changed';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'entity_links_message_context'
                  and tgrelid = 'public.entity_links'::regclass and tgenabled = 'O') then
    raise exception '0602: entity_links_message_context is not in place';
  end if;
end $$;
