-- 0153_classify_untyped_tags.sql
-- Auto-classify existing untyped tags + a first-class entity_type setter.
-- Part of the tags->entity rework: the sidebar index + entity profiles group
-- by entity_type, but it was unpopulated (0 of N tags typed). This backfills a
-- conservative best-guess and adds set_tag_entity_type so the UI's one-tap type
-- switch can persist a correction.

-- Heuristic: a single Capitalized token with no spaces reads as a proper-name
-- character (Yahweh, Enoch, Onyx); anything multi-word or lowercase reads as a
-- concept/Topic (Pricing Plans, Website Sections). Settings/things are left to
-- the one-tap correction. Pure + immutable so it can drive a backfill.
create or replace function public.guess_entity_type(p_name text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_name, '') ~ '^[A-Z][A-Za-z''\-]*$' then 'character'
    else 'concept'
  end;
$$;

-- Persisted setter for the one-tap type switch. Workspace-member gated to match
-- the existing tag-edit path (rename/recolor are member-gated via tags RLS);
-- validates against the entity_type CHECK (0148). Consolidates the only prior
-- writer (a raw client update in useCandidateTagging) into one gated path.
create or replace function public.set_tag_entity_type(p_tag_id uuid, p_entity_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare ws uuid;
begin
  if p_entity_type is not null
     and p_entity_type <> all (array['character','setting','concept','thing']) then
    raise exception 'invalid entity_type: %', p_entity_type;
  end if;
  select workspace_id into ws from tags where id = p_tag_id;
  if ws is null then raise exception 'tag not found'; end if;
  if not is_workspace_member(ws) then
    raise exception 'not authorized';
  end if;
  update tags set entity_type = p_entity_type where id = p_tag_id;
end;
$$;

grant execute on function public.guess_entity_type(text) to authenticated;
grant execute on function public.set_tag_entity_type(uuid, text) to authenticated;

-- One-shot backfill: only touches currently-untyped tags (idempotent; never
-- overwrites an existing type).
update tags set entity_type = guess_entity_type(name) where entity_type is null;
