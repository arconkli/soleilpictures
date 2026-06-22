-- 0155_related_entities.sql
-- "Related entities" for the entity profile: sibling tags that co-occur with
-- this one. Co-occurrence is computed at the BOARD level (verified: exact
-- shared-card co-occurrence is empty on real data, board-level is dense).
-- Member-gated; returns only sibling identities + a shared-board count (no
-- board content), mirroring the 0146 RLS pattern.
create or replace function public.get_related_entities(p_tag_id uuid, p_limit int default 8)
returns table(tag_id uuid, name text, slug text, color text, entity_type text, shared bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare ws_id uuid;
begin
  select workspace_id into ws_id from tags where id = p_tag_id;
  if ws_id is null or not is_workspace_member(ws_id) then return; end if;
  return query
  with mine as (
    select distinct case when el.source_kind = 'board' then el.source_id::uuid else el.source_board_id end as board_id
      from entity_links el
     where el.target_kind = 'tag' and el.target_id = p_tag_id and el.link_kind = 'applied'
       and el.source_workspace = ws_id
  ),
  others as (
    select el.target_id as tid,
           case when el.source_kind = 'board' then el.source_id::uuid else el.source_board_id end as board_id
      from entity_links el
     where el.target_kind = 'tag' and el.link_kind = 'applied' and el.source_workspace = ws_id
       and el.target_id <> p_tag_id
  )
  select t.id, t.name, t.slug, t.color, t.entity_type, count(distinct o.board_id) as shared
    from others o
    join mine m on m.board_id = o.board_id
    join tags t on t.id = o.tid
   where o.board_id is not null
   group by t.id
   order by shared desc, t.name
   limit p_limit;
end $$;

grant execute on function public.get_related_entities(uuid, int) to authenticated;
