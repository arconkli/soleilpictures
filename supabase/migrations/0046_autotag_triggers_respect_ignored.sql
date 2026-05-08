-- Make the server-side autotag triggers respect autotag_ignored.
--
-- Bug: user removes a tag → autotag_ignored row gets written →
-- but the next card_index UPDATE / boards rename / group rename
-- fires the trigger, scans tags, and re-applies the same tag —
-- because the trigger never consulted autotag_ignored. Result:
-- "Remove tag" appeared to do nothing.
--
-- Fix: every trigger that auto-applies a tag now joins to
-- autotag_ignored and skips any (target, tag) pair already
-- dismissed for that target. Idempotent ON CONFLICT DO NOTHING
-- behavior preserved.
--
-- Also enable autotag_ignored in supabase_realtime so the client
-- autotag worker sees dismissal updates without a refresh.

alter publication supabase_realtime add table autotag_ignored;

create or replace function autotag_on_card_index_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into entity_links (
    source_kind, source_id, source_workspace, source_board_id,
    target_kind, target_id, link_kind, source
  )
  select 'card', NEW.card_id, NEW.workspace_id, NEW.board_id,
         'tag', t.id, 'applied', 'auto'
    from tags t
   where t.workspace_id = NEW.workspace_id
     and (
       (NEW.title is not null and lower(NEW.title) ~ _tag_slug_word_re(t.slug))
    or (NEW.body  is not null and lower(NEW.body)  ~ _tag_slug_word_re(t.slug))
     )
     and not exists (
       select 1 from autotag_ignored ai
        where ai.workspace_id = NEW.workspace_id
          and ai.target_kind  = 'card'
          and ai.target_id    = NEW.card_id
          and ai.tag_id       = t.id
     )
  on conflict do nothing;
  return NEW;
end $$;

create or replace function autotag_on_group_index_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select b.workspace_id into ws from boards b where b.id = NEW.board_id;
  if ws is null then return NEW; end if;
  insert into entity_links (
    source_kind, source_id, source_workspace, source_board_id,
    target_kind, target_id, link_kind, source
  )
  select 'group', NEW.group_id, ws, NEW.board_id,
         'tag', t.id, 'applied', 'auto'
    from tags t
   where t.workspace_id = ws
     and NEW.name is not null
     and lower(NEW.name) ~ _tag_slug_word_re(t.slug)
     and not exists (
       select 1 from autotag_ignored ai
        where ai.workspace_id = ws
          and ai.target_kind  = 'group'
          and ai.target_id    = NEW.group_id
          and ai.tag_id       = t.id
     )
  on conflict do nothing;
  return NEW;
end $$;

create or replace function autotag_on_board_rename()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into entity_links (
    source_kind, source_id, source_workspace, source_board_id,
    target_kind, target_id, link_kind, source
  )
  select 'board', NEW.id::text, NEW.workspace_id, NEW.id,
         'tag', t.id, 'applied', 'auto'
    from tags t
   where t.workspace_id = NEW.workspace_id
     and NEW.name is not null
     and lower(NEW.name) ~ _tag_slug_word_re(t.slug)
     and not exists (
       select 1 from autotag_ignored ai
        where ai.workspace_id = NEW.workspace_id
          and ai.target_kind  = 'board'
          and ai.target_id    = NEW.id::text
          and ai.tag_id       = t.id
     )
  on conflict do nothing;
  return NEW;
end $$;

create or replace function autotag_on_doc_page_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_board uuid;
  parent_card  text;
  ws           uuid;
begin
  select ci.workspace_id, ci.board_id, ci.card_id
    into ws, parent_board, parent_card
    from card_index ci
   where ci.card_id = NEW.doc_card_id::text
     and ci.kind in ('doc')
   limit 1;
  if ws is null or parent_board is null or parent_card is null then
    return NEW;
  end if;
  insert into entity_links (
    source_kind, source_id, source_workspace, source_board_id,
    target_kind, target_id, link_kind, source
  )
  select 'card', parent_card, ws, parent_board,
         'tag', t.id, 'applied', 'auto'
    from tags t
   where t.workspace_id = ws
     and (
       (NEW.page_title is not null and lower(NEW.page_title) ~ _tag_slug_word_re(t.slug))
    or (NEW.page_text  is not null and lower(NEW.page_text)  ~ _tag_slug_word_re(t.slug))
     )
     and not exists (
       select 1 from autotag_ignored ai
        where ai.workspace_id = ws
          and ai.target_kind  = 'card'
          and ai.target_id    = parent_card
          and ai.tag_id       = t.id
     )
  on conflict do nothing;
  return NEW;
end $$;

create or replace function autotag_on_tag_slug_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare word_re text;
begin
  if NEW.slug is null or NEW.slug = OLD.slug then return NEW; end if;
  word_re := _tag_slug_word_re(NEW.slug);

  insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
  select 'board', b.id::text, b.workspace_id, b.id, 'tag', NEW.id, 'applied', 'auto'
    from boards b
   where b.workspace_id = NEW.workspace_id and b.name is not null and lower(b.name) ~ word_re
     and not exists (
       select 1 from autotag_ignored ai
        where ai.workspace_id = NEW.workspace_id
          and ai.target_kind = 'board' and ai.target_id = b.id::text and ai.tag_id = NEW.id
     )
  on conflict do nothing;

  insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
  select 'group', gi.group_id, b.workspace_id, gi.board_id, 'tag', NEW.id, 'applied', 'auto'
    from group_index gi
    join boards b on b.id = gi.board_id
   where b.workspace_id = NEW.workspace_id and gi.name is not null and lower(gi.name) ~ word_re
     and not exists (
       select 1 from autotag_ignored ai
        where ai.workspace_id = NEW.workspace_id
          and ai.target_kind = 'group' and ai.target_id = gi.group_id and ai.tag_id = NEW.id
     )
  on conflict do nothing;

  insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
  select 'card', ci.card_id, ci.workspace_id, ci.board_id, 'tag', NEW.id, 'applied', 'auto'
    from card_index ci
   where ci.workspace_id = NEW.workspace_id
     and ((ci.title is not null and lower(ci.title) ~ word_re) or (ci.body is not null and lower(ci.body) ~ word_re))
     and not exists (
       select 1 from autotag_ignored ai
        where ai.workspace_id = NEW.workspace_id
          and ai.target_kind = 'card' and ai.target_id = ci.card_id and ai.tag_id = NEW.id
     )
  on conflict do nothing;

  return NEW;
end $$;

-- backfill_tag_applications respects ignored too — important
-- for the case where you delete + re-create a tag and the
-- backfill would otherwise resurrect everything you'd dismissed.
create or replace function backfill_tag_applications(
  p_tag_id uuid,
  p_workspace_id uuid
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  slug_text text;
  word_re text;
  total int := 0;
  delta int;
begin
  if not is_workspace_member(p_workspace_id) then
    raise exception 'not a workspace member';
  end if;
  select t.slug into slug_text from tags t where t.id = p_tag_id and t.workspace_id = p_workspace_id;
  if slug_text is null then return 0; end if;
  word_re := _tag_slug_word_re(slug_text);

  with ins as (
    insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
    select 'board', b.id::text, b.workspace_id, b.id, 'tag', p_tag_id, 'applied', 'auto'
      from boards b
     where b.workspace_id = p_workspace_id and b.name is not null and lower(b.name) ~ word_re
       and not exists (
         select 1 from autotag_ignored ai
          where ai.workspace_id = p_workspace_id and ai.target_kind = 'board'
            and ai.target_id = b.id::text and ai.tag_id = p_tag_id
       )
    on conflict do nothing
    returning 1
  )
  select count(*) into delta from ins;
  total := total + coalesce(delta, 0);

  with ins as (
    insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
    select 'group', gi.group_id, b.workspace_id, gi.board_id, 'tag', p_tag_id, 'applied', 'auto'
      from group_index gi
      join boards b on b.id = gi.board_id
     where b.workspace_id = p_workspace_id and gi.name is not null and lower(gi.name) ~ word_re
       and not exists (
         select 1 from autotag_ignored ai
          where ai.workspace_id = p_workspace_id and ai.target_kind = 'group'
            and ai.target_id = gi.group_id and ai.tag_id = p_tag_id
       )
    on conflict do nothing
    returning 1
  )
  select count(*) into delta from ins;
  total := total + coalesce(delta, 0);

  with ins as (
    insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
    select 'card', ci.card_id, ci.workspace_id, ci.board_id, 'tag', p_tag_id, 'applied', 'auto'
      from card_index ci
     where ci.workspace_id = p_workspace_id
       and ((ci.title is not null and lower(ci.title) ~ word_re) or (ci.body is not null and lower(ci.body) ~ word_re))
       and not exists (
         select 1 from autotag_ignored ai
          where ai.workspace_id = p_workspace_id and ai.target_kind = 'card'
            and ai.target_id = ci.card_id and ai.tag_id = p_tag_id
       )
    on conflict do nothing
    returning 1
  )
  select count(*) into delta from ins;
  total := total + coalesce(delta, 0);

  return total;
end $$;
