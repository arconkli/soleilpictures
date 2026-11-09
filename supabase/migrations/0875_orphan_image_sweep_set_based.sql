-- 0875_orphan_image_sweep_set_based.sql
--
-- The nightly picture sweep (worker.js, p_limit 500) asks
-- find_history_safe_orphan_images (0306) which unreferenced pictures may go.
-- For each of up to 500 candidates it ran three separate EXISTS checks over
-- board_snapshots, board_ops and board_op_batches, so one call took about
-- fifteen seconds at 500 and grew with the limit.
--
-- The candidates are now taken once (a MATERIALIZED CTE, the same filter, the
-- same order and the same limit), their storage paths gathered into one
-- array, and each history table read once for rows that overlap that array
-- (&&, the same GIN indexes the per-candidate checks used). A candidate is
-- "in" a table when its path is among the keys of those rows, which is
-- exactly what `r2_keys && array[path]` asked one path at a time. The live
-- board_state keys, the order of the checks, the decisions and the reasons are
-- 0306's word for word, and so is everything around the body: the signature
-- and return columns, plpgsql, security definer, search_path public,
-- extensions, and the grants (service_role only, restated below and proved).
--
-- Checked on production before writing (never committed): old and new
-- returned identical rows, sorted by id, at p_limit 10 and 500 with dry run on
-- and at 100 with dry run off (the function only classifies; it deletes
-- nothing). At 500 the old body took about fifteen seconds and the new one
-- under two; what remains is mostly reading the live board_state docs.

begin;

create or replace function public.find_history_safe_orphan_images(
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
  with candidates as materialized (
    select
      i.id, i.storage_path, i.preview_path, i.preview_sm_path,
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

do $proof$
begin
  if has_function_privilege('anon', 'public.find_history_safe_orphan_images(integer,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.find_history_safe_orphan_images(integer,boolean)', 'execute') then
    raise exception '0875: a client can call the orphan picture sweep';
  end if;
  if not has_function_privilege('service_role', 'public.find_history_safe_orphan_images(integer,boolean)', 'execute') then
    raise exception '0875: the Worker can no longer call the orphan picture sweep';
  end if;
end $proof$;

commit;
