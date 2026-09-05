-- 0284 — the R2 orphan sweep cannot see compacted history.
--
-- find_history_safe_orphan_images() decides whether an unreferenced image is
-- safe to delete from R2. It keeps an image if the image is referenced by any
-- of three things:
--
--   in_live_doc  — a live board_state doc
--   in_snapshot  — board_snapshots.r2_keys_referenced
--   in_ops       — board_ops.r2_keys
--
-- There is a fourth place a reference can live, and the function has never
-- known about it. When the compaction pipeline merges an hour of board_ops
-- into a single Y.Update, commit_op_batch() writes a board_op_batches row
-- carrying r2_keys_referenced and then DELETES the source ops. From that
-- moment the only surviving record that the image is referenced by history is
-- the batch row — and the sweep does not look there.
--
-- This has been harmless only because compaction has never run: board_op_batches
-- has zero rows and history_rework_config.compaction_dryrun has been true since
-- 2026-05-18. The moment compaction is switched on, every image whose only
-- reference was an op that got compacted becomes, to this function, an orphan
-- with no remaining references — decision 'delete'. This migration must land
-- before HISTORY_COMPACTION_MODE is set to run.
--
-- While here, the two existing array guards are rewritten from
--
--   c.storage_path = any (bo.r2_keys)      -- scalar = ANY(array)
-- to
--   bo.r2_keys && array[c.storage_path]    -- array overlap
--
-- Same result, but `&&` is the operator GIN indexes answer. board_ops_r2_gin
-- and images_boards_gin both show zero lifetime scans for exactly this reason:
-- the index exists, the query just never asked a question it could answer. With
-- up to 500 candidates per run against a 150MB board_ops, that was 500
-- sequential scans a night.

create or replace function public.find_history_safe_orphan_images(
  p_limit integer default 500,
  p_dryrun boolean default true
)
returns table(
  id uuid, storage_path text, workspace_id uuid, ref_count integer,
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
      i.id,
      i.storage_path,
      i.workspace_id,
      i.ref_count,
      i.last_referenced_at,
      i.created_at,
      i.retention_locked_until,
      i.deleted_at
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
      exists (
        select 1 from board_snapshots bs
        where bs.r2_keys_referenced && array[c.storage_path]
      ) as in_snapshot,
      exists (
        select 1 from board_ops bo
        where bo.r2_keys && array[c.storage_path]
      ) as in_ops,
      exists (
        select 1 from board_op_batches bb
        where bb.r2_keys_referenced && array[c.storage_path]
      ) as in_batches
    from candidates c
  )
  select
    cl.id,
    cl.storage_path,
    cl.workspace_id,
    cl.ref_count,
    cl.last_referenced_at,
    cl.created_at,
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

-- The overlap rewrite above is only worth having if board_op_batches can answer
-- it by index too. board_ops and board_snapshots already carry GIN indexes on
-- their key arrays; board_op_batches never got one because nothing queried it.
create index if not exists board_op_batches_r2_gin
  on public.board_op_batches using gin (r2_keys_referenced);
