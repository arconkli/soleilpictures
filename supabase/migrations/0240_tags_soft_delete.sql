-- 0240: tags become recoverable.
--
-- Before this: deleting a tag hard-deleted the definition AND every
-- entity_links application in one click-confirm; merge_tags hard-deleted the
-- from-tag and silently DESTROYED collision rows; untag was a one-click hard
-- delete. Nothing could be walked back.
--
-- Design: piggyback on the existing tags.status lifecycle
-- ('candidate'|'active'|'hidden') with a new 'deleted' state + deleted_at for
-- the 30-day purge. Applications move to a full-fidelity tombstone
-- (deleted_entity_links) instead of staying in place — that keeps every
-- link-driven surface (counts, get_things_tagged, co-occurrence, backlinks)
-- clean with zero changes, and restore puts the exact rows (same ids) back.
-- The autotag triggers + backfill already filter status='active', so a
-- 'deleted' tag is invisible to them for free. Definition-driven surfaces
-- that DON'T filter status (entity_search tag branch, the client tag list)
-- get explicit deleted filters.

-- ── tags lifecycle ───────────────────────────────────────────────────────────
alter table public.tags drop constraint if exists tags_status_check;
alter table public.tags add constraint tags_status_check
  check (status = any (array['candidate'::text, 'active'::text, 'hidden'::text, 'deleted'::text]));
alter table public.tags add column if not exists deleted_at timestamptz;
alter table public.tags add column if not exists status_before_delete text;
create index if not exists tags_deleted_idx on public.tags (workspace_id) where status = 'deleted';

-- ── application tombstone ────────────────────────────────────────────────────
-- Full row copy (same ids) + provenance. RLS on with NO policies: all access
-- is through the SECURITY DEFINER RPCs below.
create table if not exists public.deleted_entity_links (
  like public.entity_links including defaults,
  deleted_at    timestamptz not null default now(),
  deleted_by    uuid,
  delete_reason text not null,
  batch_id      uuid,
  primary key (id)
);
alter table public.deleted_entity_links enable row level security;
create index if not exists deleted_entity_links_target_idx on public.deleted_entity_links (target_id);
create index if not exists deleted_entity_links_batch_idx  on public.deleted_entity_links (batch_id);
create index if not exists deleted_entity_links_age_idx    on public.deleted_entity_links (deleted_at);

-- ── merge undo log ───────────────────────────────────────────────────────────
create table if not exists public.tag_merge_undo (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  from_tag       uuid not null,
  into_tag       uuid not null,
  moved_link_ids uuid[] not null default '{}',
  batch_id       uuid,
  created_at     timestamptz not null default now(),
  created_by     uuid
);
alter table public.tag_merge_undo enable row level security;

-- ── soft delete / restore ────────────────────────────────────────────────────
create or replace function public.soft_delete_tag(p_tag_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_moved integer := 0;
begin
  select workspace_id into v_ws from tags where id = p_tag_id and status is distinct from 'deleted';
  if v_ws is null then return 0; end if;
  if not can_write_workspace(v_ws) then
    raise exception 'soft_delete_tag: not a member of this workspace';
  end if;
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
         auth.uid(), 'tag-delete'
    from entity_links el
   where el.target_kind = 'tag' and el.target_id = p_tag_id;
  get diagnostics v_moved = row_count;
  delete from entity_links where target_kind = 'tag' and target_id = p_tag_id;
  update tags
     set status_before_delete = status, status = 'deleted', deleted_at = now()
   where id = p_tag_id;
  return v_moved;
end;
$$;
revoke all on function public.soft_delete_tag(uuid) from public;
grant execute on function public.soft_delete_tag(uuid) to authenticated;

create or replace function public.restore_tag(p_tag_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_restored integer := 0;
begin
  select workspace_id into v_ws from tags where id = p_tag_id and status = 'deleted';
  if v_ws is null then return 0; end if;
  if not can_write_workspace(v_ws) then
    raise exception 'restore_tag: not a member of this workspace';
  end if;
  update tags
     set status = coalesce(status_before_delete, 'active'),
         deleted_at = null, status_before_delete = null
   where id = p_tag_id;
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
   where d.target_kind = 'tag' and d.target_id = p_tag_id
  on conflict do nothing;
  get diagnostics v_restored = row_count;
  delete from deleted_entity_links where target_kind = 'tag' and target_id = p_tag_id;
  return v_restored;
end;
$$;
revoke all on function public.restore_tag(uuid) from public;
grant execute on function public.restore_tag(uuid) to authenticated;

-- ── reversible merge ─────────────────────────────────────────────────────────
-- merge_tags (0039/0091) survives for API compatibility, but the client now
-- calls v2: collision rows are TOMBSTONED instead of destroyed, rewrites are
-- logged, and the from-tag is soft-deleted — so undo_tag_merge can put every
-- byte back.
create or replace function public.merge_tags_v2(p_from_tag_id uuid, p_into_tag_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ws_from uuid;
  ws_into uuid;
  v_batch uuid := gen_random_uuid();
  v_ids uuid[];
  v_rewritten integer := 0;
  v_merge_id uuid;
begin
  if p_from_tag_id is null or p_into_tag_id is null then
    raise exception 'merge_tags_v2: both ids required';
  end if;
  if p_from_tag_id = p_into_tag_id then
    return jsonb_build_object('merge_id', null, 'rewritten', 0);
  end if;
  select t.workspace_id into ws_from from tags t where t.id = p_from_tag_id and t.status is distinct from 'deleted';
  select t.workspace_id into ws_into from tags t where t.id = p_into_tag_id and t.status is distinct from 'deleted';
  if ws_from is null or ws_into is null then
    raise exception 'merge_tags_v2: tag not found';
  end if;
  if ws_from <> ws_into then
    raise exception 'merge_tags_v2: tags must be in the same workspace';
  end if;
  if not can_write_workspace(ws_from) then
    raise exception 'merge_tags_v2: not a member of this workspace';
  end if;

  -- Collisions (source already carries the survivor): tombstone, then drop.
  insert into deleted_entity_links
        (id, source_kind, source_id, source_workspace, source_board_id, source_page_id,
         source_link_id, context_text, target_kind, target_id, target_board_id,
         target_card_id, target_doc_card_id, target_page_id, target_anchor, target_url,
         created_at, created_by, link_kind, source, source_anchor,
         deleted_by, delete_reason, batch_id)
  select a.id, a.source_kind, a.source_id, a.source_workspace, a.source_board_id, a.source_page_id,
         a.source_link_id, a.context_text, a.target_kind, a.target_id, a.target_board_id,
         a.target_card_id, a.target_doc_card_id, a.target_page_id, a.target_anchor, a.target_url,
         a.created_at, a.created_by, a.link_kind, a.source, a.source_anchor,
         auth.uid(), 'tag-merge', v_batch
    from entity_links a
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
  delete from entity_links a
   where a.target_kind = 'tag'
     and a.target_id   = p_from_tag_id
     and a.id in (select id from deleted_entity_links where batch_id = v_batch);

  with promoted as (
    update entity_links
       set target_id = p_into_tag_id
     where target_kind = 'tag'
       and target_id   = p_from_tag_id
     returning id
  )
  select coalesce(array_agg(id), '{}'), count(*) into v_ids, v_rewritten from promoted;

  -- Soft-delete the from-tag (merge_tags v1 hard-deleted it).
  update tags
     set status_before_delete = status, status = 'deleted', deleted_at = now()
   where id = p_from_tag_id;

  insert into tag_merge_undo (workspace_id, from_tag, into_tag, moved_link_ids, batch_id, created_by)
  values (ws_from, p_from_tag_id, p_into_tag_id, v_ids, v_batch, auth.uid())
  returning id into v_merge_id;

  return jsonb_build_object('merge_id', v_merge_id, 'rewritten', v_rewritten);
end;
$$;
revoke all on function public.merge_tags_v2(uuid, uuid) from public;
grant execute on function public.merge_tags_v2(uuid, uuid) to authenticated;

create or replace function public.undo_tag_merge(p_merge_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_back integer := 0;
begin
  select * into r from tag_merge_undo where id = p_merge_id;
  if r is null then return 0; end if;
  if not can_write_workspace(r.workspace_id) then
    raise exception 'undo_tag_merge: not a member of this workspace';
  end if;
  -- Repoint only rows STILL on the survivor (later edits win over the undo).
  update entity_links
     set target_id = r.from_tag
   where id = any(r.moved_link_ids)
     and target_kind = 'tag'
     and target_id = r.into_tag;
  get diagnostics v_back = row_count;
  -- Revive the from-tag definition.
  update tags
     set status = coalesce(status_before_delete, 'active'),
         deleted_at = null, status_before_delete = null
   where id = r.from_tag and status = 'deleted';
  -- Resurrect the collision rows tombstoned by this merge.
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
   where d.batch_id = r.batch_id
  on conflict do nothing;
  delete from deleted_entity_links where batch_id = r.batch_id;
  delete from tag_merge_undo where id = p_merge_id;
  return v_back;
end;
$$;
revoke all on function public.undo_tag_merge(uuid) from public;
grant execute on function public.undo_tag_merge(uuid) to authenticated;

-- ── purge (30 days, mirrors 0052) ────────────────────────────────────────────
create or replace function public.purge_old_deleted_tags()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_purged integer := 0;
begin
  delete from deleted_entity_links where deleted_at < now() - interval '30 days';
  delete from tag_merge_undo where created_at < now() - interval '30 days';
  delete from tags where status = 'deleted' and deleted_at < now() - interval '30 days';
  get diagnostics v_purged = row_count;
  return v_purged;
end;
$$;
revoke all on function public.purge_old_deleted_tags() from public;
grant execute on function public.purge_old_deleted_tags() to service_role;

select cron.schedule('purge_deleted_tags', '20 3 * * *', $$select purge_old_deleted_tags();$$);

-- ── entity_search: hide deleted tags ─────────────────────────────────────────
-- Same definition as live (boards ∪ card_index ∪ group_index ∪ user directory
-- ∪ tags) with the tag branch filtered. 'candidate'/'hidden' keep their
-- current visibility — only 'deleted' is new here.
create or replace view public.entity_search as
 SELECT b.id::text AS id,
    'board'::text AS kind,
    b.workspace_id,
    b.id AS board_id,
    NULL::text AS card_id,
    b.name AS title,
    b.meta AS body,
    NULL::jsonb AS meta,
    b.updated_at
   FROM boards b
UNION ALL
 SELECT (ci.board_id::text || ':'::text) || ci.card_id AS id,
    ci.kind,
    ci.workspace_id,
    ci.board_id,
    ci.card_id,
    ci.title,
    ci.body,
    ci.meta,
    ci.updated_at
   FROM card_index ci
UNION ALL
 SELECT (gi.board_id::text || ':g:'::text) || gi.group_id AS id,
    'group'::text AS kind,
    gi.workspace_id,
    gi.board_id,
    gi.group_id AS card_id,
    gi.name AS title,
    NULL::text AS body,
    jsonb_build_object('memberCount', gi.member_count, 'outline', gi.outline, 'color', gi.color) AS meta,
    gi.updated_at
   FROM group_index gi
UNION ALL
 SELECT d.user_id::text AS id,
    'user'::text AS kind,
    d.workspace_id,
    NULL::uuid AS board_id,
    NULL::text AS card_id,
    d.title,
    d.email AS body,
    NULL::jsonb AS meta,
    GREATEST(d.created_at, now()) AS updated_at
   FROM workspace_user_directory() d(user_id, workspace_id, title, email, created_at)
UNION ALL
 SELECT t.id::text AS id,
    'tag'::text AS kind,
    t.workspace_id,
    NULL::uuid AS board_id,
    NULL::text AS card_id,
    t.name AS title,
    NULL::text AS body,
    jsonb_build_object('color', t.color, 'createdKind', t.kind) AS meta,
    t.created_at AS updated_at
   FROM tags t
  WHERE coalesce(t.status, 'active') <> 'deleted';
