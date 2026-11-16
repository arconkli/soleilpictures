-- 0898 — A "quick" picture tier: the smallest preview, about 256px wide, WebP.
--
-- Pictures already have a full preview and a small one (preview_sm). A canvas
-- full of cards, a share page or a first paint wants something far lighter to
-- show while the better one loads, so images gains a third, smaller tier:
-- preview_xs_path (the R2 key), preview_xs_w and preview_xs_h (its size).
--
-- Everything that already knows about preview_sm_path learns about the new key
-- the same way: the insert policy checks it sits under the row's own workspace
-- (0427), set_image_variant records it (0402), the tombstone trigger and the
-- orphan sweeps treat it as part of the row (0306, 0875), and the three bundle
-- readers hand it out (get_share_bundle, mcp_draft_keep_view,
-- get_public_board_bundle). Those bundles' per-original meta now also carry
-- the picture's own width and height ('w', 'h'), so a viewer knows how big the
-- original is before deciding to load it on a deep zoom, as the app does.
--
-- set_image_variant and find_history_safe_orphan_images change their argument
-- list / return table, so each is dropped and re-created in one part and has
-- its grants restated. The last part proves every grant, and that the old
-- eight-argument set_image_variant is gone.
--
-- Apply the parts one at a time; each is valid on its own. Nothing is
-- backfilled: rows without a quick tier keep working as they do today.

-- ── part 1 ──

set local lock_timeout = '5s';

alter table public.images
  add column if not exists preview_xs_path text,
  add column if not exists preview_xs_w integer,
  add column if not exists preview_xs_h integer;

comment on column public.images.preview_xs_path is 'R2 key of the quick tier: a ~256px WebP, the smallest picture. Null until generated.';
comment on column public.images.preview_xs_w is 'Width in pixels of the quick-tier file.';
comment on column public.images.preview_xs_h is 'Height in pixels of the quick-tier file.';

-- ── part 2 ──

set local lock_timeout = '5s';

alter policy "images insert" on public.images
  with check (
    (public.can_write_workspace(workspace_id)
       or (board_id is not null
           and public.can_write_board(board_id)
           and public._board_in_workspace(board_id, workspace_id)))
    and storage_path ~ ('^' || workspace_id::text || '/[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$')
    and (preview_path is null
         or preview_path ~ ('^' || workspace_id::text || '/[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$'))
    and (preview_sm_path is null
         or preview_sm_path ~ ('^' || workspace_id::text || '/[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$'))
    and (preview_xs_path is null
         or preview_xs_path ~ ('^' || workspace_id::text || '/[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$'))
  );

do $$
declare v_check text;
begin
  select p.with_check into v_check
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'images' and p.policyname = 'images insert';
  if v_check is null
     or v_check not like '%storage_path ~%'
     or v_check not like '%preview_path ~%'
     or v_check not like '%preview_sm_path ~%'
     or v_check not like '%preview_xs_path ~%' then
    raise exception '0898: the images insert policy does not constrain its keys: %', v_check;
  end if;
end $$;

-- ── part 3 ──

drop function if exists public.set_image_variant(text,text,text,integer,integer,text,integer,integer);

create or replace function public.set_image_variant(
  p_storage_path text,
  p_blur text default null,
  p_preview_path text default null,
  p_preview_w integer default null,
  p_preview_h integer default null,
  p_preview_sm_path text default null,
  p_preview_sm_w integer default null,
  p_preview_sm_h integer default null,
  p_preview_xs_path text default null,
  p_preview_xs_w integer default null,
  p_preview_xs_h integer default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_img public.images%rowtype;
begin
  select * into v_img from public.images where storage_path = p_storage_path;
  if not found then
    raise exception 'set_image_variant: unknown storage_path %', p_storage_path
      using errcode = 'no_data_found';
  end if;
  if not (
    can_write_workspace(v_img.workspace_id)
    or (v_img.board_id is not null and can_write_board(v_img.board_id))
  ) then
    raise exception 'set_image_variant: not authorized for %', p_storage_path
      using errcode = 'insufficient_privilege';
  end if;
  -- Each preview key gets its own images row (retention-locked) so /sign-reads
  -- and the share bundle can authorize + sign it.
  if p_preview_path is not null then
    insert into public.images (
      workspace_id, board_id, storage_path, width, height,
      uploaded_by, retention_locked_until
    ) values (
      v_img.workspace_id, v_img.board_id, p_preview_path, p_preview_w, p_preview_h,
      auth.uid(), timestamptz '2999-01-01'
    )
    on conflict (storage_path) do nothing;
  end if;
  if p_preview_sm_path is not null then
    insert into public.images (
      workspace_id, board_id, storage_path, width, height,
      uploaded_by, retention_locked_until
    ) values (
      v_img.workspace_id, v_img.board_id, p_preview_sm_path, p_preview_sm_w, p_preview_sm_h,
      auth.uid(), timestamptz '2999-01-01'
    )
    on conflict (storage_path) do nothing;
  end if;
  if p_preview_xs_path is not null then
    insert into public.images (
      workspace_id, board_id, storage_path, width, height,
      uploaded_by, retention_locked_until
    ) values (
      v_img.workspace_id, v_img.board_id, p_preview_xs_path, p_preview_xs_w, p_preview_xs_h,
      auth.uid(), timestamptz '2999-01-01'
    )
    on conflict (storage_path) do nothing;
  end if;
  update public.images set
    blur_hash       = coalesce(p_blur,           blur_hash),
    preview_path    = coalesce(p_preview_path,    preview_path),
    preview_w       = coalesce(p_preview_w,       preview_w),
    preview_h       = coalesce(p_preview_h,       preview_h),
    preview_sm_path = coalesce(p_preview_sm_path, preview_sm_path),
    preview_sm_w    = coalesce(p_preview_sm_w,    preview_sm_w),
    preview_sm_h    = coalesce(p_preview_sm_h,    preview_sm_h),
    preview_xs_path = coalesce(p_preview_xs_path, preview_xs_path),
    preview_xs_w    = coalesce(p_preview_xs_w,    preview_xs_w),
    preview_xs_h    = coalesce(p_preview_xs_h,    preview_xs_h),
    variants_checked_at = case
      when coalesce(p_preview_path, preview_path) is not null
        or greatest(width, height) <= 1280
      then coalesce(variants_checked_at, now())
      else variants_checked_at
    end
  where storage_path = p_storage_path;
end;
$function$;

revoke all on function public.set_image_variant(text,text,text,integer,integer,text,integer,integer,text,integer,integer) from public, anon;
grant execute on function public.set_image_variant(text,text,text,integer,integer,text,integer,integer,text,integer,integer) to authenticated, service_role;

-- ── part 4 ──

create or replace function public._tg_tombstone_r2_keys()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.r2_orphaned_objects (storage_path, workspace_id, image_id, reason)
  select k, old.workspace_id, old.id, 'row_deleted'
    from unnest(array[old.storage_path, old.preview_path, old.preview_sm_path, old.preview_xs_path]) as k
   where k is not null and k <> ''
  on conflict (storage_path) do nothing;
  return old;
end;
$function$;

-- ── part 5 ──

create or replace function public.find_orphaned_r2_tombstones(p_limit integer default 500, p_dryrun boolean default true)
returns table(storage_path text, workspace_id uuid, orphaned_at timestamp with time zone, decision text, reason text)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare v_now timestamptz := now();
begin
  return query
  with cand as (
    select t.storage_path, t.workspace_id, t.orphaned_at
    from public.r2_orphaned_objects t
    where t.swept_at is null
      and t.orphaned_at < (v_now - interval '30 days')
    order by t.orphaned_at asc
    limit p_limit
  ),
  classified as (
    select c.*,
      exists (select 1 from images i where i.storage_path = c.storage_path
                 or i.preview_path = c.storage_path or i.preview_sm_path = c.storage_path
                 or i.preview_xs_path = c.storage_path) as reclaimed,
      exists (select 1 from board_snapshots bs where bs.r2_keys_referenced && array[c.storage_path]) as in_snapshot,
      exists (select 1 from board_ops bo where bo.r2_keys && array[c.storage_path]) as in_ops,
      exists (select 1 from board_op_batches bb where bb.r2_keys_referenced && array[c.storage_path]) as in_batches
    from cand c
  )
  select cl.storage_path, cl.workspace_id, cl.orphaned_at,
    case
      when cl.reclaimed   then 'keep'
      when cl.in_snapshot then 'keep'
      when cl.in_ops      then 'keep'
      when cl.in_batches  then 'keep'
      when p_dryrun       then 'skipped_dryrun'
      else 'delete'
    end as decision,
    case
      when cl.reclaimed   then 'a live images row points at this key again'
      when cl.in_snapshot then 'referenced by retained snapshot history'
      when cl.in_ops      then 'referenced by retained op history'
      when cl.in_batches  then 'referenced by compacted op history'
      when p_dryrun       then 'eligible but in dry-run mode'
      else 'no remaining references; safe to delete'
    end as reason
  from classified cl;
end;
$function$;

-- ── part 6 ──

drop function public.find_history_safe_orphan_images(integer, boolean);

create or replace function public.find_history_safe_orphan_images(p_limit integer default 500, p_dryrun boolean default true)
returns table(id uuid, storage_path text, preview_path text, preview_sm_path text, preview_xs_path text, workspace_id uuid, ref_count integer, last_referenced_at timestamp with time zone, created_at timestamp with time zone, decision text, reason text)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_now timestamptz := now();
begin
  return query
  with candidates as materialized (
    select
      i.id, i.storage_path, i.preview_path, i.preview_sm_path, i.preview_xs_path,
      i.workspace_id, i.ref_count, i.last_referenced_at, i.created_at
    from images i
    where i.deleted_at is null
      and coalesce(i.ref_count, 0) = 0
      and i.created_at < (v_now - interval '30 days')
      and (i.last_referenced_at is null or i.last_referenced_at < (v_now - interval '30 days'))
      and (i.retention_locked_until is null or i.retention_locked_until < v_now)
    order by i.created_at asc
    limit p_limit
  ),
  -- Every candidate's path, once, for one overlap read of each history table.
  wanted as materialized (
    select coalesce(array_agg(c.storage_path) filter (where c.storage_path is not null), '{}'::text[]) as keys
      from candidates c
  ),
  live_doc_keys as (
    select distinct k.r2_key
    from board_state bs
    cross join lateral _r2_keys_in_doc(bs.doc) as k(r2_key)
  ),
  snapshot_keys as (
    select distinct k.key
      from board_snapshots bs
      cross join lateral unnest(bs.r2_keys_referenced) as k(key)
     where bs.r2_keys_referenced && (select w.keys from wanted w)
  ),
  op_keys as (
    select distinct k.key
      from board_ops bo
      cross join lateral unnest(bo.r2_keys) as k(key)
     where bo.r2_keys && (select w.keys from wanted w)
  ),
  batch_keys as (
    select distinct k.key
      from board_op_batches bb
      cross join lateral unnest(bb.r2_keys_referenced) as k(key)
     where bb.r2_keys_referenced && (select w.keys from wanted w)
  ),
  classified as (
    select
      c.*,
      (c.storage_path in (select r2_key from live_doc_keys)) as in_live_doc,
      (c.storage_path in (select key from snapshot_keys))    as in_snapshot,
      (c.storage_path in (select key from op_keys))          as in_ops,
      (c.storage_path in (select key from batch_keys))       as in_batches
    from candidates c
  )
  select
    cl.id, cl.storage_path, cl.preview_path, cl.preview_sm_path, cl.preview_xs_path,
    cl.workspace_id, cl.ref_count, cl.last_referenced_at, cl.created_at,
    case
      when cl.in_live_doc then 'keep'
      when cl.in_snapshot then 'keep'
      when cl.in_ops      then 'keep'
      when cl.in_batches  then 'keep'
      when p_dryrun       then 'skipped_dryrun'
      else 'delete'
    end as decision,
    case
      when cl.in_live_doc then 'referenced in a live board_state doc'
      when cl.in_snapshot then 'referenced by retained snapshot history'
      when cl.in_ops      then 'referenced by retained op history'
      when cl.in_batches  then 'referenced by compacted op history'
      when p_dryrun       then 'eligible but in dry-run mode'
      else 'no remaining references; safe to delete'
    end as reason
  from classified cl;
end;
$function$;

revoke all on function public.find_history_safe_orphan_images(integer, boolean) from public, anon, authenticated;
grant execute on function public.find_history_safe_orphan_images(integer, boolean) to service_role;

-- ── part 7 ──

create or replace function public.get_share_bundle(p_token uuid, p_board_id uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_root_id    uuid;
  v_include    boolean;
  v_target     uuid;
  v_board      record;
  v_snapshot   text;
  v_image_keys text[];
  v_image_meta json;
  v_nav        json;
  v_join       json;
begin
  select t.root_id, t.target_id, t.include_subboards
    into v_root_id, v_target, v_include
  from public._resolve_share_target(p_token, p_board_id) t;

  select b.id, b.name, b.view, b.cover, b.bg_color into v_board
  from boards b where b.id = v_target;

  select doc into v_snapshot from board_state where board_id = v_target;

  select coalesce(array_agg(distinct k), '{}'::text[]) into v_image_keys
  from (
    select storage_path as k from images
     where storage_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
    union
    select preview_path as k from images
     where preview_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
    union
    select preview_sm_path as k from images
     where preview_sm_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
    union
    select preview_xs_path as k from images
     where preview_xs_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
  ) s;

  select coalesce(
           jsonb_object_agg(storage_path, jsonb_build_object(
             'blur', blur_hash,
             'preview', preview_path,
             'preview_w', preview_w,
             'preview_h', preview_h,
             'preview_sm', preview_sm_path,
             'preview_sm_w', preview_sm_w,
             'preview_sm_h', preview_sm_h,
             'preview_xs', preview_xs_path,
             'preview_xs_w', preview_xs_w,
             'preview_xs_h', preview_xs_h,
             'w', width,
             'h', height
           )),
           '{}'::jsonb
         )::json
    into v_image_meta
  from images
  where storage_path is not null
    and (board_id = v_target or v_target = any(referenced_in_board_ids))
    and (blur_hash is not null or preview_path is not null
         or preview_sm_path is not null or preview_xs_path is not null);

  if coalesce(v_include, false) then
    select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
      into v_nav
    from (
      with recursive sub as (
        select id, name from boards where id = v_root_id
        union all
        select b.id, b.name
        from boards b join sub s on b.parent_board_id = s.id
        where b.deleted_at is null
      )
      select id, name from sub
    ) t;
  else
    select json_build_array(json_build_object('id', b.id, 'name', b.name))
      into v_nav
    from boards b where b.id = v_root_id;
  end if;

  select case when l.kind = 'invite'
              then json_build_object('role', l.role, 'kind', l.kind)
              else null end
    into v_join
  from public_share_links l where l.token = p_token;

  return json_build_object(
    'board', json_build_object(
      'id', v_board.id,
      'name', v_board.name,
      'view', v_board.view,
      'cover', v_board.cover,
      'bg_color', v_board.bg_color
    ),
    'snapshot', v_snapshot,
    'image_keys', v_image_keys,
    'image_meta', v_image_meta,
    'role', 'viewer',
    'root_id', v_root_id,
    'include_subboards', coalesce(v_include, false),
    'nav_boards', v_nav,
    'join', v_join
  );
end;
$function$;

-- ── part 8 ──

create or replace function public.mcp_draft_keep_view(p_keep_hash text, p_board_id uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d          public.mcp_drafts;
  v_target   uuid;
  v_board    record;
  v_snapshot text;
  v_keys     text[];
  v_meta     json;
  v_nav      json;
  v_cards    integer;
  v_limit    integer;
begin
  select * into d from public.mcp_drafts m where m.keep_hash = p_keep_hash;
  if d.id is null then
    return json_build_object('state', 'unknown');
  end if;
  if d.claimed_at is not null then
    return json_build_object('state', 'kept', 'host', d.host);
  end if;
  if d.reaped_at is not null or d.expires_at <= now() or d.workspace_id is null then
    return json_build_object('state', 'expired', 'host', d.host);
  end if;
  -- The first time a browser opened the page on it while it was live (0708).
  update public.mcp_drafts m set first_viewed_at = now() where m.id = d.id and m.first_viewed_at is null;

  v_target := public._mcp_draft_main_board(d.workspace_id);
  if p_board_id is not null and exists (
       select 1 from public.boards b
        where b.id = p_board_id and b.workspace_id = d.workspace_id and b.deleted_at is null) then
    v_target := p_board_id;
  end if;

  select b.id, b.name, b.view, b.cover, b.bg_color into v_board from public.boards b where b.id = v_target;
  select s.doc into v_snapshot from public.board_state s where s.board_id = v_target;

  -- get_share_bundle's four key sets, for this board.
  select coalesce(array_agg(distinct k), '{}'::text[]) into v_keys
  from (
    select i.storage_path as k from public.images i
     where i.storage_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
    union
    select i.preview_path from public.images i
     where i.preview_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
    union
    select i.preview_sm_path from public.images i
     where i.preview_sm_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
    union
    select i.preview_xs_path from public.images i
     where i.preview_xs_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
  ) s;

  select coalesce(jsonb_object_agg(i.storage_path, jsonb_build_object(
           'blur', i.blur_hash, 'preview', i.preview_path, 'preview_w', i.preview_w, 'preview_h', i.preview_h,
           'preview_sm', i.preview_sm_path, 'preview_sm_w', i.preview_sm_w, 'preview_sm_h', i.preview_sm_h,
           'preview_xs', i.preview_xs_path, 'preview_xs_w', i.preview_xs_w, 'preview_xs_h', i.preview_xs_h,
           'w', i.width, 'h', i.height)),
         '{}'::jsonb)::json
    into v_meta
    from public.images i
   where i.storage_path is not null
     and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
     and (i.blur_hash is not null or i.preview_path is not null
          or i.preview_sm_path is not null or i.preview_xs_path is not null);

  -- Every live cluster in the draft but its root, so the page can move between them.
  select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name) order by b.created_at), '[]'::json)
    into v_nav
    from public.boards b
   where b.workspace_id = d.workspace_id and b.id is distinct from public._mcp_draft_root(d.workspace_id) and b.deleted_at is null;

  v_cards := public._owner_card_count(d.user_id);
  select coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0) into v_limit
    from public.profiles p where p.user_id = d.user_id;

  return json_build_object(
    'state', 'live',
    'host', d.host,
    'expires_at', d.expires_at,
    'card_count', v_cards,
    'card_limit', coalesce(v_limit, 50),
    'bundle', json_build_object(
      'board', json_build_object('id', v_board.id, 'name', v_board.name, 'view', v_board.view,
                                 'cover', v_board.cover, 'bg_color', v_board.bg_color),
      'snapshot', v_snapshot,
      'image_keys', v_keys,
      'image_meta', v_meta,
      'role', 'viewer',
      'root_id', v_target,
      'include_subboards', true,
      'nav_boards', v_nav,
      'join', null));
end;
$function$;

-- ── part 9 ──

create or replace function public.get_public_board_bundle(p_slug text, p_board_id uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_root_id   uuid;
  v_target    uuid;
  v_board     record;
  v_snapshot  text;
  v_image_keys text[];
  v_image_meta json;
  v_nav       json;
begin
  v_root_id := _resolve_published_board(p_slug);
  if v_root_id is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;

  v_target := coalesce(p_board_id, v_root_id);

  if v_target <> v_root_id then
    if not exists (
      with recursive chain as (
        select id, parent_board_id from boards where id = v_target
        union all
        select b.id, b.parent_board_id
        from boards b join chain c on b.id = c.parent_board_id
      )
      select 1 from chain where id = v_root_id
    ) then
      raise exception 'board is not part of this public board' using errcode = 'P0002';
    end if;
  end if;

  select b.id, b.name, b.view, b.cover, b.bg_color into v_board
  from boards b where b.id = v_target and b.deleted_at is null;
  if v_board.id is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;

  select doc into v_snapshot from board_state where board_id = v_target;

  select coalesce(array_agg(distinct k), '{}'::text[]) into v_image_keys
  from (
    select storage_path as k from images
     where storage_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
    union
    select preview_path as k from images
     where preview_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
    union
    select preview_sm_path as k from images
     where preview_sm_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
    union
    select preview_xs_path as k from images
     where preview_xs_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
  ) s;

  select coalesce(
           jsonb_object_agg(storage_path, jsonb_build_object(
             'blur', blur_hash,
             'preview', preview_path,
             'preview_w', preview_w,
             'preview_h', preview_h,
             'preview_sm', preview_sm_path,
             'preview_sm_w', preview_sm_w,
             'preview_sm_h', preview_sm_h,
             'preview_xs', preview_xs_path,
             'preview_xs_w', preview_xs_w,
             'preview_xs_h', preview_xs_h,
             'w', width,
             'h', height
           )),
           '{}'::jsonb
         )::json
    into v_image_meta
  from images
  where storage_path is not null
    and (board_id = v_target or v_target = any(referenced_in_board_ids))
    and (blur_hash is not null or preview_path is not null
         or preview_sm_path is not null or preview_xs_path is not null);

  select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
    into v_nav
  from (
    with recursive subt as (
      select id, name from boards where id = v_root_id and deleted_at is null
      union all
      select b.id, b.name from boards b join subt s on b.parent_board_id = s.id
      where b.deleted_at is null
    )
    select id, name from subt
  ) t;

  return json_build_object(
    'board', json_build_object(
      'id', v_board.id, 'name', v_board.name, 'view', v_board.view,
      'cover', v_board.cover, 'bg_color', v_board.bg_color
    ),
    'snapshot',          v_snapshot,
    'image_keys',        v_image_keys,
    'image_meta',        v_image_meta,
    'role',              'viewer',
    'root_id',           v_root_id,
    'include_subboards', true,
    'nav_boards',        v_nav
  );
end;
$function$;

-- ── part 10 ──

-- The 0311 habit: prove the grants, and that the old signature is gone.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('public.set_image_variant(text,text,text,integer,integer,text,integer,integer,text,integer,integer)', false, true,  true),
      ('public._tg_tombstone_r2_keys()',                                                                    false, false, true),
      ('public.find_orphaned_r2_tombstones(integer,boolean)',                                              false, false, true),
      ('public.find_history_safe_orphan_images(integer,boolean)',                                           false, false, true),
      ('public.get_share_bundle(uuid,uuid)',                                                                true,  true,  true),
      ('public.get_public_board_bundle(text,uuid)',                                                         true,  true,  true),
      ('public.mcp_draft_keep_view(text,uuid)',                                                             false, false, true)
    ) as t(fn, want_anon, want_auth, want_service)
  loop
    if has_function_privilege('anon', r.fn::regprocedure, 'execute') is distinct from r.want_anon
       or has_function_privilege('authenticated', r.fn::regprocedure, 'execute') is distinct from r.want_auth
       or has_function_privilege('service_role', r.fn::regprocedure, 'execute') is distinct from r.want_service then
      raise exception '0898: grants are wrong on %', r.fn;
    end if;
  end loop;

  if to_regprocedure('public.set_image_variant(text,text,text,integer,integer,text,integer,integer)') is not null then
    raise exception '0898: the old 8-argument set_image_variant still exists';
  end if;
end $$;
