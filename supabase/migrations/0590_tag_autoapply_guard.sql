-- 0590 — One guard for every automatic tag application.
--
-- Removed tags kept coming back. "Remove tag" writes an autotag_ignored row,
-- and the word-match triggers (0044–0046, 0152) honour it, but the client
-- paths that also apply tags (canvas scoring, the embedding tagger and its
-- backfill, group propagation, the doc paragraph cascade) never read it, so
-- in production removed tags came back within minutes.
--
-- So the rule moves to where every path has to pass: a BEFORE INSERT trigger
-- on entity_links drops an automatic tag application (link_kind 'applied',
-- target_kind 'tag', source anything but 'user') when
--   * the tag is soft-deleted or not 'active' (0152's statuses), or
--   * an autotag_ignored row covers (item, tag), or
--   * the item is a doc page and a 'doc_page' row covers
--     (doc card id || ':' || page id, tag). Doc removals write that key from
--     the client; before this nothing kept a removed doc tag off.
-- A person's own application (source 'user') always goes through, and the
-- manual paths already lift the ignore row when someone re-tags by hand.
-- The trigger is named to sort before entity_links_message_context.
--
-- Also here:
--   * the automatic rows that came back after a removal move to
--     deleted_entity_links under one batch, so they stay recoverable;
--   * merge_tags_v2 carries the from-tag's "don't tag this" rows onto the
--     into-tag (tag_merge_undo.copied_ignores remembers exactly which, and
--     undo_tag_merge takes back only those), parks automatic from-tag rows
--     that the into-tag was removed from instead of moving them, drops the
--     from-tag's suggestions, and drops both centroids so they rebuild from
--     the merged members;
--   * soft_delete_tag drops the tag's suggestions and centroid; both are
--     caches that rebuild if the tag is restored;
--   * get_things_tagged returns page_id on doc rows, so the tag page can open
--     a page and take a doc tag off it.
--
-- The four function bodies are the live ones (pg_get_functiondef, 2026-10-24)
-- with only those lines added, written compactly: applied through MCP as
-- tag_autoapply_guard_part1..5 (the parts are marked below), because a
-- longer part was refused. This file is the applied text. create or replace
-- keeps the ACLs; the proof checks them, and that clients can't call the new
-- trigger function. Probed first in one rolled-back statement against live
-- data: removed, hidden and soft-deleted tags stayed off, a doc_page row kept
-- one page only, merge + undo and delete + restore round-tripped.

begin;

-- part1 ─────────────────────────────────────────────────────────────────────
create or replace function public._tg_entity_links_tag_autoapply_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ws uuid;
  v_status text;
  v_deleted timestamptz;
begin
  select t.workspace_id, t.status, t.deleted_at
    into v_ws, v_status, v_deleted
    from tags t
   where t.id = new.target_id;
  if not found then
    return new;
  end if;
  if v_deleted is not null or coalesce(v_status, 'active') <> 'active' then
    return null;
  end if;
  if exists (select 1 from autotag_ignored i
              where i.workspace_id = v_ws
                and i.target_kind  = new.source_kind
                and i.target_id    = new.source_id
                and i.tag_id       = new.target_id) then
    return null;
  end if;
  if new.source_kind = 'doc' and new.source_page_id is not null
     and exists (select 1 from autotag_ignored i
                  where i.workspace_id = v_ws
                    and i.target_kind  = 'doc_page'
                    and i.target_id    = new.source_id || ':' || new.source_page_id
                    and i.tag_id       = new.target_id) then
    return null;
  end if;
  return new;
end $function$;

revoke execute on function public._tg_entity_links_tag_autoapply_guard() from public, anon, authenticated;

alter table public.tag_merge_undo
  add column if not exists copied_ignores jsonb not null default '[]'::jsonb;

-- part2 ─────────────────────────────────────────────────────────────────────
create or replace function public.merge_tags_v2(p_from_tag_id uuid, p_into_tag_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  ws_from uuid; ws_into uuid; v_batch uuid := gen_random_uuid(); v_ids uuid[];
  v_rewritten integer := 0; v_merge_id uuid; v_copied jsonb := '[]'::jsonb;
begin
  if p_from_tag_id is null or p_into_tag_id is null then raise exception 'merge_tags_v2: both ids required'; end if;
  if p_from_tag_id = p_into_tag_id then return jsonb_build_object('merge_id', null, 'rewritten', 0); end if;
  select t.workspace_id into ws_from from tags t where t.id = p_from_tag_id and t.status is distinct from 'deleted';
  select t.workspace_id into ws_into from tags t where t.id = p_into_tag_id and t.status is distinct from 'deleted';
  if ws_from is null or ws_into is null then raise exception 'merge_tags_v2: tag not found'; end if;
  if ws_from <> ws_into then raise exception 'merge_tags_v2: tags must be in the same workspace'; end if;
  if not can_write_workspace(ws_from) then raise exception 'merge_tags_v2: not a member of this workspace'; end if;
  insert into deleted_entity_links (id, source_kind, source_id, source_workspace, source_board_id, source_page_id, source_link_id, context_text, target_kind, target_id, target_board_id, target_card_id, target_doc_card_id, target_page_id, target_anchor, target_url, created_at, created_by, link_kind, source, source_anchor, deleted_by, delete_reason, batch_id)
  select a.id, a.source_kind, a.source_id, a.source_workspace, a.source_board_id, a.source_page_id, a.source_link_id, a.context_text, a.target_kind, a.target_id, a.target_board_id, a.target_card_id, a.target_doc_card_id, a.target_page_id, a.target_anchor, a.target_url, a.created_at, a.created_by, a.link_kind, a.source, a.source_anchor, auth.uid(), 'tag-merge', v_batch
    from entity_links a
   where a.target_kind = 'tag' and a.target_id = p_from_tag_id
     and (exists (select 1 from entity_links b
                   where b.target_kind = 'tag' and b.target_id = p_into_tag_id
                     and b.source_kind = a.source_kind and b.source_id = a.source_id
                     and coalesce(b.source_page_id, '') = coalesce(a.source_page_id, '')
                     and coalesce(b.source_link_id, '') = coalesce(a.source_link_id, '')
                     and b.link_kind = a.link_kind)
          or (a.link_kind = 'applied' and coalesce(a.source, 'user') <> 'user'
              and exists (select 1 from autotag_ignored i
                           where i.workspace_id = ws_into and i.tag_id = p_into_tag_id
                             and i.target_kind = a.source_kind and i.target_id = a.source_id)));
  delete from entity_links a where a.target_kind = 'tag' and a.target_id = p_from_tag_id
     and a.id in (select id from deleted_entity_links where batch_id = v_batch);
  with promoted as (
    update entity_links set target_id = p_into_tag_id
     where target_kind = 'tag' and target_id = p_from_tag_id returning id)
  select coalesce(array_agg(id), '{}'), count(*) into v_ids, v_rewritten from promoted;
  with copied as (
    insert into autotag_ignored (workspace_id, target_kind, target_id, tag_id, ignored_by, ignored_at)
    select i.workspace_id, i.target_kind, i.target_id, p_into_tag_id, i.ignored_by, i.ignored_at
      from autotag_ignored i where i.workspace_id = ws_from and i.tag_id = p_from_tag_id
    on conflict do nothing returning target_kind, target_id)
  select coalesce(jsonb_agg(jsonb_build_object('k', target_kind, 'id', target_id)), '[]'::jsonb) into v_copied from copied;
  delete from tag_suggestions where tag_id = p_from_tag_id;
  delete from tag_centroids where tag_id in (p_from_tag_id, p_into_tag_id);
  update tags set status_before_delete = status, status = 'deleted', deleted_at = now() where id = p_from_tag_id;
  insert into tag_merge_undo (workspace_id, from_tag, into_tag, moved_link_ids, batch_id, created_by, copied_ignores)
  values (ws_from, p_from_tag_id, p_into_tag_id, v_ids, v_batch, auth.uid(), v_copied) returning id into v_merge_id;
  return jsonb_build_object('merge_id', v_merge_id, 'rewritten', v_rewritten);
end;
$function$;

-- part3 ─────────────────────────────────────────────────────────────────────
create or replace function public.undo_tag_merge(p_merge_id uuid)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  r record; v_back integer := 0;
begin
  select * into r from tag_merge_undo where id = p_merge_id;
  if r is null then return 0; end if;
  if not can_write_workspace(r.workspace_id) then raise exception 'undo_tag_merge: not a member of this workspace'; end if;
  update entity_links set target_id = r.from_tag
   where id = any(r.moved_link_ids) and target_kind = 'tag' and target_id = r.into_tag;
  get diagnostics v_back = row_count;
  update tags set status = coalesce(status_before_delete, 'active'), deleted_at = null, status_before_delete = null
   where id = r.from_tag and status = 'deleted';
  insert into entity_links (id, source_kind, source_id, source_workspace, source_board_id, source_page_id, source_link_id, context_text, target_kind, target_id, target_board_id, target_card_id, target_doc_card_id, target_page_id, target_anchor, target_url, created_at, created_by, link_kind, source, source_anchor)
  select d.id, d.source_kind, d.source_id, d.source_workspace, d.source_board_id, d.source_page_id, d.source_link_id, d.context_text, d.target_kind, d.target_id, d.target_board_id, d.target_card_id, d.target_doc_card_id, d.target_page_id, d.target_anchor, d.target_url, d.created_at, d.created_by, d.link_kind, d.source, d.source_anchor
    from deleted_entity_links d where d.batch_id = r.batch_id
  on conflict do nothing;
  delete from deleted_entity_links where batch_id = r.batch_id;
  -- Take back only the "don't tag this" rows the merge copied.
  delete from autotag_ignored i
   using jsonb_to_recordset(coalesce(r.copied_ignores, '[]'::jsonb)) as c(k text, id text)
   where i.workspace_id = r.workspace_id and i.tag_id = r.into_tag and i.target_kind = c.k and i.target_id = c.id;
  delete from tag_merge_undo where id = p_merge_id;
  return v_back;
end;
$function$;

create or replace function public.soft_delete_tag(p_tag_id uuid)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_ws uuid; v_moved integer := 0;
begin
  select workspace_id into v_ws from tags where id = p_tag_id and status is distinct from 'deleted';
  if v_ws is null then return 0; end if;
  if not can_write_workspace(v_ws) then raise exception 'soft_delete_tag: not a member of this workspace'; end if;
  insert into deleted_entity_links (id, source_kind, source_id, source_workspace, source_board_id, source_page_id, source_link_id, context_text, target_kind, target_id, target_board_id, target_card_id, target_doc_card_id, target_page_id, target_anchor, target_url, created_at, created_by, link_kind, source, source_anchor, deleted_by, delete_reason)
  select el.id, el.source_kind, el.source_id, el.source_workspace, el.source_board_id, el.source_page_id, el.source_link_id, el.context_text, el.target_kind, el.target_id, el.target_board_id, el.target_card_id, el.target_doc_card_id, el.target_page_id, el.target_anchor, el.target_url, el.created_at, el.created_by, el.link_kind, el.source, el.source_anchor, auth.uid(), 'tag-delete'
    from entity_links el where el.target_kind = 'tag' and el.target_id = p_tag_id;
  get diagnostics v_moved = row_count;
  delete from entity_links where target_kind = 'tag' and target_id = p_tag_id;
  -- Suggestions and the centroid are caches; both rebuild if the tag comes back.
  delete from tag_suggestions where tag_id = p_tag_id;
  delete from tag_centroids where tag_id = p_tag_id;
  update tags set status_before_delete = status, status = 'deleted', deleted_at = now() where id = p_tag_id;
  return v_moved;
end;
$function$;

-- part4 ─────────────────────────────────────────────────────────────────────
create or replace function public.get_things_tagged(p_tag_id uuid, p_limit integer default 200)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  ws_id uuid; is_member boolean; rows jsonb;
begin
  select t.workspace_id into ws_id from tags t where t.id = p_tag_id;
  if ws_id is null then return '[]'::jsonb; end if;
  is_member := is_workspace_member(ws_id);
  with applied as (
    select el.source_kind, el.source_id, el.source_board_id, el.source_workspace, el.source, el.created_at, el.source_page_id
      from entity_links el
     where el.target_kind = 'tag' and el.target_id = p_tag_id and el.link_kind = 'applied'
       and (is_member or can_read_board(case when el.source_kind = 'board' then el.source_id::uuid else el.source_board_id end))
     order by el.created_at desc
     limit p_limit
  ),
  resolved as (
    select a.created_at as applied_at, a.source as applied_source, es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at, b.name as board_name,
           coalesce(ci.meta->>'groupName', '') as group_name, coalesce(ci.meta->>'groupId', '') as group_id,
           ci.body as card_body, null::int as member_count, null::text as page_id
      from applied a
      join entity_search es on es.id = a.source_board_id::text || ':' || a.source_id and es.kind <> 'board' and es.kind <> 'group'
      left join card_index ci on ci.board_id = a.source_board_id and ci.card_id = a.source_id
      left join boards b on b.id = a.source_board_id
     where a.source_kind = 'card'
    union all
    select a.created_at, a.source, es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at, es.title, '', '', null, null::int, null::text
      from applied a
      join entity_search es on es.kind = 'board' and es.id = a.source_id
     where a.source_kind = 'board'
    union all
    -- Groups. entity_search id = "{board_uuid}:g:{group_id}".
    select a.created_at, a.source, es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at, b.name, '', a.source_id, null, gi.member_count, null::text
      from applied a
      join entity_search es on es.kind = 'group' and es.id = a.source_board_id::text || ':g:' || a.source_id
      left join group_index gi on gi.board_id = a.source_board_id and gi.group_id = a.source_id
      left join boards b on b.id = a.source_board_id
     where a.source_kind = 'group'
    union all
    -- Doc pages tagged directly; ranges on one page collapse to one row.
    -- page_id lets the tag page open the page and take the tag off it.
    select max(a.created_at), max(a.source), (a.source_id || ':' || coalesce(a.source_page_id, '')), 'doc'::text,
           coalesce(nullif(max(dp.page_title), ''), 'Untitled doc'), left(coalesce(max(dp.page_text), ''), 200), null::jsonb,
           a.source_board_id, a.source_id, max(dp.updated_at), coalesce(max(b.name), ''), '', '', null, null::int,
           a.source_page_id
      from applied a
      join doc_page_index dp on dp.doc_card_id = a.source_id and dp.page_id = a.source_page_id
      left join boards b on b.id = a.source_board_id
     where a.source_kind = 'doc'
     group by a.source_id, a.source_page_id, a.source_board_id
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.applied_at desc), '[]'::jsonb) into rows from resolved r;
  return rows;
end $function$;

-- part5 ─────────────────────────────────────────────────────────────────────
-- The trigger goes on last, so the table lock it takes is held for as little
-- of this as possible; the cleanup runs under it, so nothing slips back in.
drop trigger if exists a_tag_autoapply_guard on public.entity_links;
create trigger a_tag_autoapply_guard
  before insert on public.entity_links
  for each row
  when (new.link_kind = 'applied' and new.target_kind = 'tag' and coalesce(new.source, 'user') <> 'user')
  execute function public._tg_entity_links_tag_autoapply_guard();

-- The automatic rows that came back after someone removed them.
do $cleanup$
declare
  v_batch uuid := gen_random_uuid();
begin
  with gone as (
    delete from entity_links el using tags t
     where el.link_kind = 'applied' and el.target_kind = 'tag'
       and coalesce(el.source, 'user') <> 'user' and t.id = el.target_id
       and exists (select 1 from autotag_ignored i
                    where i.workspace_id = t.workspace_id and i.target_kind = el.source_kind
                      and i.target_id = el.source_id and i.tag_id = el.target_id)
    returning el.*
  )
  insert into deleted_entity_links (id, source_kind, source_id, source_workspace, source_board_id, source_page_id, source_link_id, context_text, target_kind, target_id, target_board_id, target_card_id, target_doc_card_id, target_page_id, target_anchor, target_url, created_at, created_by, link_kind, source, source_anchor, deleted_by, delete_reason, batch_id)
  select g.id, g.source_kind, g.source_id, g.source_workspace, g.source_board_id, g.source_page_id, g.source_link_id, g.context_text, g.target_kind, g.target_id, g.target_board_id, g.target_card_id, g.target_doc_card_id, g.target_page_id, g.target_anchor, g.target_url, g.created_at, g.created_by, g.link_kind, g.source, g.source_anchor, null, 'autotag-ignored', v_batch
    from gone g;
end $cleanup$;

do $proof$
begin
  if has_function_privilege('anon', 'public._tg_entity_links_tag_autoapply_guard()', 'execute')
     or has_function_privilege('authenticated', 'public._tg_entity_links_tag_autoapply_guard()', 'execute') then
    raise exception '0590: clients can call the guard trigger function';
  end if;
  if not has_function_privilege('authenticated', 'public.merge_tags_v2(uuid,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.undo_tag_merge(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.soft_delete_tag(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_things_tagged(uuid,integer)', 'execute') then
    raise exception '0590: a redefined tag function lost its authenticated grant';
  end if;
  if has_function_privilege('anon', 'public.merge_tags_v2(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.soft_delete_tag(uuid)', 'execute') then
    raise exception '0590: merge and delete must stay signed-in only';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.entity_links'::regclass
                    and tgname = 'a_tag_autoapply_guard' and not tgisinternal) then
    raise exception '0590: the guard trigger is missing';
  end if;
  if (select p.prosrc from pg_proc p where p.oid = 'public.merge_tags_v2(uuid,uuid)'::regprocedure) not like '%copied_ignores%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.undo_tag_merge(uuid)'::regprocedure) not like '%copied_ignores%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.soft_delete_tag(uuid)'::regprocedure) not like '%delete from tag_centroids%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.get_things_tagged(uuid,integer)'::regprocedure) not like '%a.source_page_id%' then
    raise exception '0590: an earlier part did not take';
  end if;
  if exists (select 1 from entity_links el join tags t on t.id = el.target_id
              where el.link_kind = 'applied' and el.target_kind = 'tag'
                and coalesce(el.source, 'user') <> 'user'
                and exists (select 1 from autotag_ignored i
                             where i.workspace_id = t.workspace_id and i.target_kind = el.source_kind
                               and i.target_id = el.source_id and i.tag_id = el.target_id)) then
    raise exception '0590: an automatic row still sits on a removed (item, tag)';
  end if;
end $proof$;

commit;
