-- Server-side autotag triggers.
--
-- The client-side per-board autotag effect handles real-time
-- scoring while a user has a board mounted, but it leaves a gap:
-- cards/groups/boards that are added or renamed while NOBODY has
-- the board open never get scored. These triggers close that gap
-- by running an exact-name + word-bounded match against every
-- workspace tag whenever the indexed text changes.
--
-- Idempotent (ON CONFLICT DO NOTHING) and additive only — the
-- triggers never untag, since auto-untag on edit would be
-- surprising and could destroy manually-applied tags.

-- Helper: word-bounded regex builder. Used in three places below
-- so factor it out.
create or replace function _tag_slug_word_re(slug text)
returns text language sql immutable as $$
  select '(^|[^a-z0-9])'
      || regexp_replace(lower(slug), '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
      || '($|[^a-z0-9])'
$$;

-- card_index changes → score the card against every workspace tag.
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
  on conflict do nothing;
  return NEW;
end $$;

drop trigger if exists autotag_card_index on card_index;
create trigger autotag_card_index
after insert or update of title, body on card_index
for each row execute function autotag_on_card_index_change();

-- group_index changes → score the group against every workspace tag.
create or replace function autotag_on_group_index_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  -- group_index doesn't carry workspace_id directly; resolve via boards.
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
  on conflict do nothing;
  return NEW;
end $$;

drop trigger if exists autotag_group_index on group_index;
create trigger autotag_group_index
after insert or update of name on group_index
for each row execute function autotag_on_group_index_change();

-- boards rename → score the board against every workspace tag.
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
  on conflict do nothing;
  return NEW;
end $$;

drop trigger if exists autotag_boards_rename on boards;
create trigger autotag_boards_rename
after insert or update of name on boards
for each row execute function autotag_on_board_rename();
