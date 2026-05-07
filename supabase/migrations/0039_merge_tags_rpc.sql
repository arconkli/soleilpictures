-- Atomic tag merge. Repoints every entity_links row that targets
-- p_from_tag_id to p_into_tag_id, then deletes p_from_tag_id from
-- the tags table. Works inside a single transaction so peers either
-- see the merge complete or never see a half state.
--
-- Both tags must be in the same workspace AND the caller must be a
-- member. The RPC is SECURITY DEFINER so it can rewrite rows that
-- the caller might not normally have permission to update directly
-- (some entity_links rows could be on shared boards where the
-- caller is a workspace member but not a board editor — merge is a
-- workspace-level action so this is intentional).

create or replace function merge_tags(
  p_from_tag_id uuid,
  p_into_tag_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_from uuid;
  ws_into uuid;
  rewritten int;
begin
  if p_from_tag_id is null or p_into_tag_id is null then
    raise exception 'merge_tags: both ids required';
  end if;
  if p_from_tag_id = p_into_tag_id then
    return 0;
  end if;

  select t.workspace_id into ws_from from tags t where t.id = p_from_tag_id;
  select t.workspace_id into ws_into from tags t where t.id = p_into_tag_id;

  if ws_from is null or ws_into is null then
    raise exception 'merge_tags: tag not found';
  end if;
  if ws_from <> ws_into then
    raise exception 'merge_tags: tags must be in the same workspace';
  end if;

  -- Authorize: caller must be a workspace member (or have anon
  -- read-only access — no, RLS gates the helper, but SECURITY
  -- DEFINER bypasses; check explicitly).
  if not is_workspace_member(ws_from) then
    raise exception 'merge_tags: not a member of this workspace';
  end if;

  -- 1a. Drop rows that would collide post-update — i.e., rows
  --     targeting FROM where the same source ALREADY has a row
  --     targeting INTO. Without this, the UPDATE would violate the
  --     entity_links_unique constraint.
  delete from entity_links a
   where a.target_kind = 'tag'
     and a.target_id   = p_from_tag_id
     and exists (
       select 1 from entity_links b
        where b.target_kind = 'tag'
          and b.target_id   = p_into_tag_id
          and b.source_kind = a.source_kind
          and b.source_id   = a.source_id
          and coalesce(b.source_page_id, '') = coalesce(a.source_page_id, '')
          and coalesce(b.source_link_id, '') = coalesce(a.source_link_id, '')
          and b.link_kind   = a.link_kind
     );

  -- 1b. Repoint the surviving rows from FROM to INTO.
  with promoted as (
    update entity_links
       set target_id = p_into_tag_id
     where target_kind = 'tag'
       and target_id   = p_from_tag_id
     returning id
  )
  select count(*) into rewritten from promoted;

  -- 2. Drop the FROM tag itself. Cascades remove any leftover refs.
  delete from tags where id = p_from_tag_id;

  return rewritten;
end $$;
