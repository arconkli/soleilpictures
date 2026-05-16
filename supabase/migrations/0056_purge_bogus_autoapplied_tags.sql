-- One-shot cleanup RPC: removes auto-applied tag applications where the
-- tag's name shares no meaningful token (4+ chars) with the source's
-- own text. This catches cases like the AI tagger applying "Clusters
-- logo" to a paragraph that says "ad / collab / exclusive" — the tag
-- name has zero overlap with the underlying text, so the application
-- is almost certainly a false positive from a permissive model verdict.
--
-- Also marks the (source, tag) pair as ignored in autotag_ignored so
-- the engine won't re-apply the same false positive on the next pass.
--
-- Caller must be a workspace member. Returns the count of rows deleted.

create or replace function purge_bogus_autoapplied_tags(
  p_workspace_id uuid
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  total int := 0;
begin
  if not is_workspace_member(p_workspace_id) then
    raise exception 'not a workspace member';
  end if;

  -- Identify auto-applied rows whose tag name shares NO 4+-char token
  -- with the source's text. context_text comes off the entity_link row
  -- when available (set by tagDocRange for paragraph-cascade rows); we
  -- fall back to the underlying source's text via card_index /
  -- group_index / boards / doc_page_index lookups so older rows
  -- without context_text are still evaluated.
  with candidates as (
    select el.id, el.target_id as tag_id, el.source_kind, el.source_id,
           t.name as tag_name, coalesce(el.context_text, '') as ctx,
           case el.source_kind
             when 'card' then (
               select coalesce(ci.title, '') || ' ' || coalesce(ci.body, '')
                 from card_index ci
                where ci.card_id = el.source_id
                  and ci.workspace_id = p_workspace_id
                limit 1
             )
             when 'group' then (
               select coalesce(gi.name, '')
                 from group_index gi
                where gi.group_id = el.source_id
                  and gi.board_id = el.source_board_id
                limit 1
             )
             when 'board' then (
               select coalesce(b.name, '')
                 from boards b
                where b.id::text = el.source_id
                  and b.workspace_id = p_workspace_id
                limit 1
             )
             when 'doc' then (
               select coalesce(dpi.page_title, '') || ' ' || coalesce(dpi.page_text, '')
                 from doc_page_index dpi
                where dpi.doc_card_id = el.source_id
                  and (el.source_page_id is null
                       or dpi.page_id::text = el.source_page_id)
                  and dpi.workspace_id = p_workspace_id
                limit 1
             )
             else ''
           end as src_text
      from entity_links el
      join tags t on t.id = el.target_id
     where el.target_kind = 'tag'
       and el.link_kind = 'applied'
       and el.source in ('ai', 'auto', 'auto-paragraph', 'auto-doc', 'auto-board', 'auto-card', 'auto-group')
       and el.source_workspace = p_workspace_id
       and t.workspace_id = p_workspace_id
  ),
  bogus as (
    select c.id, c.tag_id, c.source_kind, c.source_id
      from candidates c
     where (
       select count(*)
         from regexp_split_to_table(lower(c.tag_name), '[^a-z0-9]+') tok
        where char_length(tok) >= 4
     ) > 0
       and not exists (
         select 1
           from regexp_split_to_table(lower(c.tag_name), '[^a-z0-9]+') tok
          where char_length(tok) >= 4
            and (
              position(tok in lower(c.ctx)) > 0
              or position(tok in lower(coalesce(c.src_text, ''))) > 0
            )
       )
  ),
  ignored_inserts as (
    insert into autotag_ignored (workspace_id, target_kind, target_id, tag_id)
    select p_workspace_id, b.source_kind, b.source_id, b.tag_id
      from bogus b
    on conflict (workspace_id, target_kind, target_id, tag_id) do nothing
    returning 1
  ),
  deletions as (
    delete from entity_links el
     where el.id in (select id from bogus)
    returning 1
  )
  select count(*) into total from deletions;

  return coalesce(total, 0);
end;
$$;

grant execute on function purge_bogus_autoapplied_tags(uuid) to authenticated;
