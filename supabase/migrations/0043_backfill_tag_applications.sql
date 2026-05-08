-- backfill_tag_applications(tag_id, workspace_id)
--
-- Server-side "tag everything obvious" for a freshly-created tag.
-- Mirrors the autotag engine's exact-name path but operates on
-- the whole workspace at once, so a tag created from the sidebar
-- (where no per-board scoring is running) lands on every existing
-- board/group/card whose text word-matches the tag's slug.
--
-- Called from tagsApi.ensureTag after a tag is newly inserted.
-- Idempotent — ON CONFLICT DO NOTHING — so re-running is safe.

create or replace function backfill_tag_applications(
  p_tag_id uuid,
  p_workspace_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  slug_text text;
  word_re text;
  total int := 0;
  delta int;
begin
  if not is_workspace_member(p_workspace_id) then
    raise exception 'not a workspace member';
  end if;

  select t.slug into slug_text
    from tags t
   where t.id = p_tag_id and t.workspace_id = p_workspace_id;
  if slug_text is null then
    return 0;
  end if;

  -- Word-bounded regex around the slug. Escapes regex metachars so
  -- a slug like "c++" doesn't blow up.
  word_re := '(^|[^a-z0-9])'
          || regexp_replace(slug_text, '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
          || '($|[^a-z0-9])';

  -- Boards by name.
  with ins as (
    insert into entity_links (
      source_kind, source_id, source_workspace, source_board_id,
      target_kind, target_id, link_kind, source
    )
    select 'board', b.id::text, b.workspace_id, b.id,
           'tag', p_tag_id, 'applied', 'auto'
      from boards b
     where b.workspace_id = p_workspace_id
       and b.name is not null
       and lower(b.name) ~ word_re
    on conflict do nothing
    returning 1
  )
  select count(*) into delta from ins;
  total := total + coalesce(delta, 0);

  -- Groups by name. group_index.board_id is the parent board's uuid;
  -- we still scope by workspace via the join to boards.
  with ins as (
    insert into entity_links (
      source_kind, source_id, source_workspace, source_board_id,
      target_kind, target_id, link_kind, source
    )
    select 'group', gi.group_id, b.workspace_id, gi.board_id,
           'tag', p_tag_id, 'applied', 'auto'
      from group_index gi
      join boards b on b.id = gi.board_id
     where b.workspace_id = p_workspace_id
       and gi.name is not null
       and lower(gi.name) ~ word_re
    on conflict do nothing
    returning 1
  )
  select count(*) into delta from ins;
  total := total + coalesce(delta, 0);

  -- Cards by title or body. Empty cards are excluded so a board
  -- name match doesn't drag in content-less notes.
  with ins as (
    insert into entity_links (
      source_kind, source_id, source_workspace, source_board_id,
      target_kind, target_id, link_kind, source
    )
    select 'card', ci.card_id, ci.workspace_id, ci.board_id,
           'tag', p_tag_id, 'applied', 'auto'
      from card_index ci
     where ci.workspace_id = p_workspace_id
       and (
         (ci.title is not null and lower(ci.title) ~ word_re)
      or (ci.body  is not null and lower(ci.body)  ~ word_re)
       )
    on conflict do nothing
    returning 1
  )
  select count(*) into delta from ins;
  total := total + coalesce(delta, 0);

  return total;
end $$;
