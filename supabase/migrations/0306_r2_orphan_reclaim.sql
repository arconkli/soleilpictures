-- 0306_r2_orphan_reclaim.sql
--
-- Two ways R2 objects leak forever. Both are storage cost and both are a
-- right-to-erasure gap, because the bytes outlive every pointer to them.
--
-- LEAK 1 — derived previews are never swept.
-- Every upload can produce three R2 objects: the original (images.storage_path)
-- and two WebP previews (images.preview_path, images.preview_sm_path, written by
-- generateAndUploadVariants in boards/src/lib/uploads.js). The sweep only ever
-- read storage_path, and worker.js only ever deleted that one key. So even on
-- the HAPPY path -- an orphan correctly identified and deleted -- both previews
-- stayed in the bucket with nothing left pointing at them. Roughly a third of
-- image rows carry previews, so this has been quietly accruing since variants
-- shipped.
--
-- LEAK 2 — cascade-deleted rows take the only pointer with them.
-- images.workspace_id is `references workspaces on delete cascade`. Delete a
-- workspace (or an account, which deletes its workspaces) and the images rows
-- vanish. find_history_safe_orphan_images selects `from images`, so those keys
-- can never become candidates: the sweep cannot see what it cannot join to.
-- The bytes are unreachable AND unreclaimable, which is the worst combination
-- -- we keep paying for data the user asked us to erase.
--
-- Fix: record the keys BEFORE the row disappears, and teach the sweep about
-- previews.
--
-- Note on what this does NOT do: it cannot recover objects already orphaned by
-- past cascades. Those keys are gone from Postgres and the only way to find
-- them is to list the bucket and diff against images.storage_path. That is a
-- one-off reconciliation, not a migration.
--
-- Retention: tombstoned keys are held 30 days before becoming eligible, which
-- matches the trash window and keeps them recoverable for the length of a
-- restore-from-backup. If erasure needs to be faster than that for compliance,
-- lower the interval in find_orphaned_r2_tombstones -- nothing references these
-- keys, so a shorter window is safe, it just narrows the recovery window too.

-- ── 1. Tombstone ─────────────────────────────────────────────────────────────

create table if not exists public.r2_orphaned_objects (
  storage_path text primary key,
  workspace_id uuid,
  image_id     uuid,
  reason       text not null default 'row_deleted',
  orphaned_at  timestamptz not null default now(),
  swept_at     timestamptz
);

comment on table public.r2_orphaned_objects is
  'R2 keys whose images row was hard-deleted (usually a workspace/account cascade). '
  'Written by a BEFORE DELETE trigger so the key survives the row that pointed at it. '
  'Consumed by find_orphaned_r2_tombstones via the daily R2 sweep.';

create index if not exists r2_orphaned_objects_unswept_idx
  on public.r2_orphaned_objects (orphaned_at) where swept_at is null;

alter table public.r2_orphaned_objects enable row level security;
-- No policies: this is service_role-only, like every other sweep table.
revoke all on public.r2_orphaned_objects from anon, authenticated;

-- BEFORE DELETE, so it also fires for rows removed by a cascade from
-- workspaces -- which is the entire point. Records all three keys an image can
-- own. ON CONFLICT DO NOTHING because a preview key can legitimately be shared
-- (the deterministic board-thumb path is written per board, not per image).
create or replace function public._tg_tombstone_r2_keys()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.r2_orphaned_objects (storage_path, workspace_id, image_id, reason)
  select k, old.workspace_id, old.id, 'row_deleted'
    from unnest(array[old.storage_path, old.preview_path, old.preview_sm_path]) as k
   where k is not null and k <> ''
  on conflict (storage_path) do nothing;
  return old;
end;
$function$;

drop trigger if exists images_tombstone_r2_keys on public.images;
create trigger images_tombstone_r2_keys
  before delete on public.images
  for each row execute function public._tg_tombstone_r2_keys();

-- ── 2. Teach the existing sweep about previews ───────────────────────────────
--
-- The return type gains two columns, so this is a drop + create rather than a
-- replace. Dropping a function drops its ACL with it, so the grants are
-- restated below -- 0068 and 0284 left this service_role-only and it must stay
-- that way. Body is unchanged apart from selecting the two preview columns.

drop function if exists public.find_history_safe_orphan_images(integer, boolean);

create function public.find_history_safe_orphan_images(
  p_limit integer default 500,
  p_dryrun boolean default true
)
returns table(
  id uuid, storage_path text, preview_path text, preview_sm_path text,
  workspace_id uuid, ref_count integer,
  last_referenced_at timestamptz, created_at timestamptz,
  decision text, reason text
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_now timestamptz := now();
begin
  return query
  with live_doc_keys as (
    select distinct k.r2_key
    from board_state bs
    cross join lateral _r2_keys_in_doc(bs.doc) as k(r2_key)
  ),
  candidates as (
    select
      i.id, i.storage_path, i.preview_path, i.preview_sm_path,
      i.workspace_id, i.ref_count, i.last_referenced_at, i.created_at,
      i.retention_locked_until, i.deleted_at
    from images i
    where i.deleted_at is null
      and coalesce(i.ref_count, 0) = 0
      and i.created_at < (v_now - interval '30 days')
      and (i.last_referenced_at is null or i.last_referenced_at < (v_now - interval '30 days'))
      and (i.retention_locked_until is null or i.retention_locked_until < v_now)
    order by i.created_at asc
    limit p_limit
  ),
  classified as (
    select
      c.*,
      (c.storage_path in (select r2_key from live_doc_keys)) as in_live_doc,
      exists (select 1 from board_snapshots bs where bs.r2_keys_referenced && array[c.storage_path]) as in_snapshot,
      exists (select 1 from board_ops bo where bo.r2_keys && array[c.storage_path]) as in_ops,
      exists (select 1 from board_op_batches bb where bb.r2_keys_referenced && array[c.storage_path]) as in_batches
    from candidates c
  )
  select
    cl.id, cl.storage_path, cl.preview_path, cl.preview_sm_path,
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

-- ── 3. Tombstone reclaim ─────────────────────────────────────────────────────
--
-- Same shape and the same conservatism as the sweep above: an unrecognized
-- decision is never a delete, and the history tables are still consulted even
-- though a cascaded workspace takes its own history with it. Cheap, and the
-- alternative is trusting that assumption on a destructive path.

create or replace function public.find_orphaned_r2_tombstones(
  p_limit integer default 500,
  p_dryrun boolean default true
)
returns table(storage_path text, workspace_id uuid, orphaned_at timestamptz, decision text, reason text)
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
                 or i.preview_path = c.storage_path or i.preview_sm_path = c.storage_path) as reclaimed,
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

revoke all on function public.find_orphaned_r2_tombstones(integer, boolean) from public, anon, authenticated;
grant execute on function public.find_orphaned_r2_tombstones(integer, boolean) to service_role;

create or replace function public.mark_r2_tombstones_swept(p_paths text[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer;
begin
  update public.r2_orphaned_objects
     set swept_at = now()
   where storage_path = any(p_paths) and swept_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.mark_r2_tombstones_swept(text[]) from public, anon, authenticated;
grant execute on function public.mark_r2_tombstones_swept(text[]) to service_role;
