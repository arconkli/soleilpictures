-- 0592 — One count per tag: the things that carry it.
--
-- The sidebar counted raw applied rows (every range of a tag on a doc page
-- counted again, and rows whose card had since been deleted still counted),
-- the tag page counted every card inside every tagged cluster, and Manage
-- counted rows after a 300-row cap: three numbers for one tag, never equal.
--
-- tag_item_counts(workspace) counts, per live tag, the distinct live things
-- carrying it, the same things the tag page lists as tagged:
--   * a card that still exists (its card_index row, on a cluster not in the
--     Trash);
--   * a cluster not in the Trash;
--   * a group that still exists and has something in it (the tag page hides
--     an empty group);
--   * a document page the page index knows (ranges on one page count once).
-- Members only; one aggregate, so the sidebar no longer downloads every row.

begin;

create or replace function public.tag_item_counts(p_workspace_id uuid)
returns table (tag_id uuid, items integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select el.target_id as tag_id,
         count(distinct (el.source_kind, el.source_id,
                         case when el.source_kind = 'doc' then coalesce(el.source_page_id, '') else '' end))::int as items
    from entity_links el
    join tags t on t.id = el.target_id
   where public.is_workspace_member(p_workspace_id)
     and t.workspace_id = p_workspace_id
     and t.deleted_at is null
     and el.target_kind = 'tag'
     and el.link_kind = 'applied'
     and (
       (el.source_kind = 'card' and exists (
          select 1 from card_index ci join boards b on b.id = ci.board_id
           where ci.board_id = el.source_board_id and ci.card_id = el.source_id and b.deleted_at is null))
       or (el.source_kind = 'board' and exists (
          select 1 from boards b where b.id::text = el.source_id and b.deleted_at is null))
       or (el.source_kind = 'group' and exists (
          select 1 from group_index gi
           where gi.board_id = el.source_board_id and gi.group_id = el.source_id and coalesce(gi.member_count, 0) > 0))
       or (el.source_kind = 'doc' and exists (
          select 1 from doc_page_index dp
           where dp.doc_card_id = el.source_id and dp.page_id = el.source_page_id))
     )
   group by el.target_id
$function$;

revoke execute on function public.tag_item_counts(uuid) from public, anon;
grant execute on function public.tag_item_counts(uuid) to authenticated;

do $proof$
begin
  if has_function_privilege('anon', 'public.tag_item_counts(uuid)', 'execute') then
    raise exception '0592: anon can count tags';
  end if;
  if not has_function_privilege('authenticated', 'public.tag_item_counts(uuid)', 'execute') then
    raise exception '0592: members cannot count tags';
  end if;
end $proof$;

commit;
