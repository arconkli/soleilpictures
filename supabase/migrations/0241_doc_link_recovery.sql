-- 0241: deleting a doc card no longer strands its links unrecoverable.
--
-- cleanupDocCards used to hard-DELETE the doc's entity_links (applied tags,
-- @-mention link records) the moment the card was deleted — so undoing the
-- card delete restored the card with every link gone. doc_page_index /
-- doc_backlinks keep their hard delete (they provably regenerate on next
-- doc open via syncDocPageIndex/updateBacklinks); entity_links move to the
-- 0240 tombstone instead, reason 'doc-card-delete', and the undo path
-- restores them. Purged with the rest of the tombstone at 30 days (0240).

create or replace function public.soft_delete_doc_links(p_doc_card_id text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_moved integer := 0;
begin
  if p_doc_card_id is null or length(p_doc_card_id) = 0 then return 0; end if;
  insert into deleted_entity_links
        (id, source_kind, source_id, source_workspace, source_board_id, source_page_id,
         source_link_id, context_text, target_kind, target_id, target_board_id,
         target_card_id, target_doc_card_id, target_page_id, target_anchor, target_url,
         created_at, created_by, link_kind, source, source_anchor,
         deleted_by, delete_reason)
  select el.id, el.source_kind, el.source_id, el.source_workspace, el.source_board_id, el.source_page_id,
         el.source_link_id, el.context_text, el.target_kind, el.target_id, el.target_board_id,
         el.target_card_id, el.target_doc_card_id, el.target_page_id, el.target_anchor, el.target_url,
         el.created_at, el.created_by, el.link_kind, el.source, el.source_anchor,
         auth.uid(), 'doc-card-delete'
    from entity_links el
   where el.source_kind = 'doc' and el.source_id = p_doc_card_id
     and can_write_workspace(el.source_workspace)
  on conflict (id) do nothing;
  get diagnostics v_moved = row_count;
  delete from entity_links el
   where el.source_kind = 'doc' and el.source_id = p_doc_card_id
     and can_write_workspace(el.source_workspace);
  return v_moved;
end;
$$;
revoke all on function public.soft_delete_doc_links(text) from public;
grant execute on function public.soft_delete_doc_links(text) to authenticated;

create or replace function public.restore_doc_links(p_doc_card_id text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_back integer := 0;
begin
  if p_doc_card_id is null or length(p_doc_card_id) = 0 then return 0; end if;
  insert into entity_links
        (id, source_kind, source_id, source_workspace, source_board_id, source_page_id,
         source_link_id, context_text, target_kind, target_id, target_board_id,
         target_card_id, target_doc_card_id, target_page_id, target_anchor, target_url,
         created_at, created_by, link_kind, source, source_anchor)
  select d.id, d.source_kind, d.source_id, d.source_workspace, d.source_board_id, d.source_page_id,
         d.source_link_id, d.context_text, d.target_kind, d.target_id, d.target_board_id,
         d.target_card_id, d.target_doc_card_id, d.target_page_id, d.target_anchor, d.target_url,
         d.created_at, d.created_by, d.link_kind, d.source, d.source_anchor
    from deleted_entity_links d
   where d.source_kind = 'doc' and d.source_id = p_doc_card_id
     and d.delete_reason = 'doc-card-delete'
     and can_write_workspace(d.source_workspace)
  on conflict do nothing;
  get diagnostics v_back = row_count;
  delete from deleted_entity_links d
   where d.source_kind = 'doc' and d.source_id = p_doc_card_id
     and d.delete_reason = 'doc-card-delete'
     and can_write_workspace(d.source_workspace);
  return v_back;
end;
$$;
revoke all on function public.restore_doc_links(text) from public;
grant execute on function public.restore_doc_links(text) to authenticated;
