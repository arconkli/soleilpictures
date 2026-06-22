-- 0152: Quality guards on autotag SPREAD (candidate-invisibility + stop-word/
-- min-length floor).
--
-- The autotag triggers spread a tag to every card/board/group/doc whose text
-- word-matches the tag's slug (`lower(text) ~ _tag_slug_word_re(slug)`), with
-- NO floor — so a tag like "May"/"the", a 2-char slug, or (once Phase 4 lands)
-- a discovered "candidate" tag would auto-tag everything. Add `tags.status`
-- (candidate/active/hidden) and a `_tag_is_spreadable()` floor, applied at every
-- auto-apply site:
--   content triggers: autotag_on_card_index_change / _board_rename /
--                     _doc_page_change / _group_index_change
--   tag triggers:     autotag_on_tag_slug_change, backfill_tag_applications
--
-- ONLY the source='auto' spread is gated. User-applied tags (tagCard/tagBoard/
-- tagGroup, source='user') are untouched, and EXISTING applications are
-- unchanged — this gates FUTURE spread only. Verified on prod before applying:
-- zero existing tags are <3 chars or stop-words, so no current tag's spread
-- changes; the change is purely preventive. Each function body is byte-identical
-- to the live (pre-0152) version apart from the added `_tag_is_spreadable` guard.
--
-- NOTE (Phase 4 follow-up): the client-side TF-IDF autotagger (CanvasSurface
-- runAutotagScoringInner → tagCard/tagBoard/tagGroup source='auto') is a
-- SEPARATE spread path not gated here; once 'candidate' tags exist it should
-- exclude status<>'active' tags from its scored tag list.

alter table public.tags
  add column if not exists status text not null default 'active'
    check (status in ('candidate','active','hidden'));

comment on column public.tags.status is
  'Lifecycle: active (spreads), candidate (discovered, inert/invisible), hidden. Only active tags auto-spread.';

-- A tag may auto-spread only if it is active, long enough, and not a common
-- stop-word / app-or-screenplay artifact. Pure (no table refs) so it is safe
-- in the trigger WHERE clauses.
create or replace function public._tag_is_spreadable(p_slug text, p_status text)
returns boolean language sql immutable as $function$
  select coalesce(p_status,'active') = 'active'
     and char_length(coalesce(p_slug,'')) >= 3
     and lower(coalesce(p_slug,'')) <> all (array[
       'the','and','but','for','nor','yet','with','from','into','onto','upon','over','under','above','below',
       'about','after','before','between','through','during','without','within','against','among','across','behind','beside',
       'are','was','were','has','had','have','will','would','could','should','can','may','might','must','get','got','gets','see','saw','seen','let','put','set',
       'you','your','they','them','their','this','that','these','those','here','there','what','which','who','whom','whose','his','her','hers','our','ours','its','him','she',
       'not','now','all','any','some','one','two','more','most','very','only','each','same','than','then','when','while','also','just','like','well','back','down','even','much','many','such','both','out','off','for','per','via',
       'monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february','march','april','june','july','august','september','october','november','december',
       'note','notes','image','images','board','boards','doc','docs','tag','tags','card','cards','page','pages','item','items','new','old','draft','todo','done','misc','stuff','thing','things',
       'shot','scene','cut','int','ext','pov','fade','title','montage','close','wide','angle','est'
     ]::text[]);
$function$;

create or replace function public.autotag_on_card_index_change()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
  select 'card', NEW.card_id, NEW.workspace_id, NEW.board_id, 'tag', t.id, 'applied', 'auto'
    from tags t
   where t.workspace_id = NEW.workspace_id
     and _tag_is_spreadable(t.slug, t.status)
     and ((NEW.title is not null and lower(NEW.title) ~ _tag_slug_word_re(t.slug))
       or (NEW.body  is not null and lower(NEW.body)  ~ _tag_slug_word_re(t.slug)))
     and not exists (select 1 from autotag_ignored ai where ai.workspace_id = NEW.workspace_id and ai.target_kind = 'card' and ai.target_id = NEW.card_id and ai.tag_id = t.id)
  on conflict do nothing;
  return NEW;
end $function$;

create or replace function public.autotag_on_board_rename()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
  select 'board', NEW.id::text, NEW.workspace_id, NEW.id, 'tag', t.id, 'applied', 'auto'
    from tags t
   where t.workspace_id = NEW.workspace_id and NEW.name is not null
     and _tag_is_spreadable(t.slug, t.status)
     and lower(NEW.name) ~ _tag_slug_word_re(t.slug)
     and not exists (select 1 from autotag_ignored ai where ai.workspace_id = NEW.workspace_id and ai.target_kind = 'board' and ai.target_id = NEW.id::text and ai.tag_id = t.id)
  on conflict do nothing;
  return NEW;
end $function$;

create or replace function public.autotag_on_doc_page_change()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare parent_board uuid; parent_card text; ws uuid;
begin
  select ci.workspace_id, ci.board_id, ci.card_id into ws, parent_board, parent_card
    from card_index ci where ci.card_id = NEW.doc_card_id::text and ci.kind = 'doc' limit 1;
  if ws is null or parent_board is null or parent_card is null then return NEW; end if;
  insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
  select 'card', parent_card, ws, parent_board, 'tag', t.id, 'applied', 'auto'
    from tags t
   where t.workspace_id = ws
     and _tag_is_spreadable(t.slug, t.status)
     and ((NEW.page_title is not null and lower(NEW.page_title) ~ _tag_slug_word_re(t.slug))
       or (NEW.page_text  is not null and lower(NEW.page_text)  ~ _tag_slug_word_re(t.slug)))
     and not exists (select 1 from autotag_ignored ai where ai.workspace_id = ws and ai.target_kind = 'card' and ai.target_id = parent_card and ai.tag_id = t.id)
  on conflict do nothing;
  return NEW;
end $function$;

create or replace function public.autotag_on_group_index_change()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare ws uuid;
begin
  select b.workspace_id into ws from boards b where b.id = NEW.board_id;
  if ws is null then return NEW; end if;
  insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
  select 'group', NEW.group_id, ws, NEW.board_id, 'tag', t.id, 'applied', 'auto'
    from tags t
   where t.workspace_id = ws and NEW.name is not null
     and _tag_is_spreadable(t.slug, t.status)
     and lower(NEW.name) ~ _tag_slug_word_re(t.slug)
     and not exists (select 1 from autotag_ignored ai where ai.workspace_id = ws and ai.target_kind = 'group' and ai.target_id = NEW.group_id and ai.tag_id = t.id)
  on conflict do nothing;
  return NEW;
end $function$;

create or replace function public.autotag_on_tag_slug_change()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare word_re text;
begin
  if NEW.slug is null or NEW.slug = OLD.slug then return NEW; end if;
  if not _tag_is_spreadable(NEW.slug, NEW.status) then return NEW; end if;
  word_re := _tag_slug_word_re(NEW.slug);
  insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
  select 'board', b.id::text, b.workspace_id, b.id, 'tag', NEW.id, 'applied', 'auto'
    from boards b
   where b.workspace_id = NEW.workspace_id and b.name is not null and lower(b.name) ~ word_re
     and not exists (select 1 from autotag_ignored ai where ai.workspace_id = NEW.workspace_id and ai.target_kind = 'board' and ai.target_id = b.id::text and ai.tag_id = NEW.id)
  on conflict do nothing;
  insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
  select 'group', gi.group_id, b.workspace_id, gi.board_id, 'tag', NEW.id, 'applied', 'auto'
    from group_index gi join boards b on b.id = gi.board_id
   where b.workspace_id = NEW.workspace_id and gi.name is not null and lower(gi.name) ~ word_re
     and not exists (select 1 from autotag_ignored ai where ai.workspace_id = NEW.workspace_id and ai.target_kind = 'group' and ai.target_id = gi.group_id and ai.tag_id = NEW.id)
  on conflict do nothing;
  insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
  select 'card', ci.card_id, ci.workspace_id, ci.board_id, 'tag', NEW.id, 'applied', 'auto'
    from card_index ci
   where ci.workspace_id = NEW.workspace_id
     and ((ci.title is not null and lower(ci.title) ~ word_re) or (ci.body is not null and lower(ci.body) ~ word_re))
     and not exists (select 1 from autotag_ignored ai where ai.workspace_id = NEW.workspace_id and ai.target_kind = 'card' and ai.target_id = ci.card_id and ai.tag_id = NEW.id)
  on conflict do nothing;
  return NEW;
end $function$;

create or replace function public.backfill_tag_applications(p_tag_id uuid, p_workspace_id uuid)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare slug_text text; status_text text; word_re text; total int := 0; delta int;
begin
  if not can_write_workspace(p_workspace_id) then raise exception 'not a workspace member'; end if;
  select t.slug, t.status into slug_text, status_text from tags t where t.id = p_tag_id and t.workspace_id = p_workspace_id;
  if slug_text is null then return 0; end if;
  if not _tag_is_spreadable(slug_text, status_text) then return 0; end if;
  word_re := _tag_slug_word_re(slug_text);
  with ins as (
    insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
    select 'board', b.id::text, b.workspace_id, b.id, 'tag', p_tag_id, 'applied', 'auto'
      from boards b where b.workspace_id = p_workspace_id and b.name is not null and lower(b.name) ~ word_re
       and not exists (select 1 from autotag_ignored ai where ai.workspace_id = p_workspace_id and ai.target_kind = 'board' and ai.target_id = b.id::text and ai.tag_id = p_tag_id)
    on conflict do nothing returning 1)
  select count(*) into delta from ins; total := total + coalesce(delta,0);
  with ins as (
    insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
    select 'group', gi.group_id, b.workspace_id, gi.board_id, 'tag', p_tag_id, 'applied', 'auto'
      from group_index gi join boards b on b.id = gi.board_id where b.workspace_id = p_workspace_id and gi.name is not null and lower(gi.name) ~ word_re
       and not exists (select 1 from autotag_ignored ai where ai.workspace_id = p_workspace_id and ai.target_kind = 'group' and ai.target_id = gi.group_id and ai.tag_id = p_tag_id)
    on conflict do nothing returning 1)
  select count(*) into delta from ins; total := total + coalesce(delta,0);
  with ins as (
    insert into entity_links (source_kind, source_id, source_workspace, source_board_id, target_kind, target_id, link_kind, source)
    select 'card', ci.card_id, ci.workspace_id, ci.board_id, 'tag', p_tag_id, 'applied', 'auto'
      from card_index ci where ci.workspace_id = p_workspace_id
       and ((ci.title is not null and lower(ci.title) ~ word_re) or (ci.body is not null and lower(ci.body) ~ word_re))
       and not exists (select 1 from autotag_ignored ai where ai.workspace_id = p_workspace_id and ai.target_kind = 'card' and ai.target_id = ci.card_id and ai.tag_id = p_tag_id)
    on conflict do nothing returning 1)
  select count(*) into delta from ins; total := total + coalesce(delta,0);
  return total;
end $function$;
