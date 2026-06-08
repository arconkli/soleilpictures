-- 0127_image_refs_recompute_and_sweep_guard.sql
--
-- Fixes the "some board images stay locked" class of bugs at its safety-critical
-- root: stale image reference accounting + an R2 orphan sweep that could delete
-- in-use images.
--
-- Background. Image cards store `r2:<storage_path>`. Reading an image needs (a)
-- an `images` row readable under RLS, and (b) the underlying R2 object to exist.
-- The `images` table carries history-aware reference columns (ref_count,
-- referenced_in_board_ids, first/last_referenced_at — migration 0060), populated
-- ONCE by migration 0062's pure-SQL scan of board_state.doc. The forward-
-- maintenance edge function (backfill-image-refs) is deprecated, and there is no
-- trigger/cron, so the columns went stale: most card-referenced images have
-- ref_count = 0 / empty referenced_in_board_ids. The history-safe orphan sweep
-- (find_history_safe_orphan_images, migration 0068) treats ref_count = 0 images
-- as deletion candidates and only spares them via the HISTORY tables
-- (board_snapshots / board_ops) — never the LIVE board_state. When R2_SWEEP_MODE
-- flips live, it would delete R2 objects of images that are still on boards,
-- turning their signed URLs into permanent 404 "locked" placeholders for
-- everyone (members included).
--
-- This migration:
--   1. _r2_keys_in_doc(doc)        — reuse 0062's escape+regex key extraction.
--   2. recompute_image_refs(board) — rebuild the reference columns from the LIVE
--      board_state (full rebuild when board is null; cheap scoped rebuild for one
--      board, with correct decrement when a card is removed).
--   3. board_state trigger + nightly pg_cron — keep the columns fresh forever.
--   4. one-time full backfill — repair the currently-stale rows now.
--   5. harden the sweep with an authoritative LIVE board_state guard so it can
--      NEVER delete an image that is still referenced on a board, regardless of
--      ref_count freshness.
--
-- NOTE: ref_count's meaning becomes "number of distinct LIVE boards referencing
-- the key" (so ref_count > 0  <=>  cardinality(referenced_in_board_ids) > 0).
-- The only reader of ref_count is the sweep, and it only tests `= 0`, so this is
-- safe. No authorization surface changes here (see 0128 for the RLS fix).

-- ── 1. Key extraction helper (Yjs stores strings inline; r2:<key> is findable
--       as bytes after base64-decode + 'escape' rendering — same as 0062). ──
create or replace function _r2_keys_in_doc(p_doc text)
returns setof text
language sql
immutable
as $$
  select distinct m[1]
  from regexp_matches(
    encode(decode(p_doc, 'base64'), 'escape'),
    'r2:([A-Za-z0-9_\-./]{20,})',
    'g'
  ) as m
$$;

-- ── 2. Recompute reference accounting from the LIVE board_state. ──
create or replace function recompute_image_refs(p_board_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affected integer := 0;
begin
  if p_board_id is null then
    -- FULL rebuild: scan every live doc, rebuild every image row (so images that
    -- are no longer referenced anywhere are correctly reset to 0 / '{}').
    with live as (
      select bs.board_id, bs.updated_at, k.r2_key
      from board_state bs
      cross join lateral _r2_keys_in_doc(bs.doc) as k(r2_key)
    ),
    agg as (
      select r2_key,
             array_agg(distinct board_id) as board_ids,
             count(distinct board_id)     as n_boards,
             max(updated_at)              as last_ts
      from live
      group by r2_key
    )
    update images i set
      referenced_in_board_ids = coalesce(a.board_ids, '{}'::uuid[]),
      ref_count               = coalesce(a.n_boards, 0),
      last_referenced_at      = case when a.r2_key is not null
                                     then greatest(coalesce(i.last_referenced_at, a.last_ts), a.last_ts)
                                     else i.last_referenced_at end,
      first_referenced_at     = case when a.r2_key is not null
                                     then coalesce(i.first_referenced_at, a.last_ts)
                                     else i.first_referenced_at end
    from images base
    left join agg a on a.r2_key = base.storage_path
    where i.id = base.id;
    get diagnostics v_affected = row_count;

  else
    -- SCOPED rebuild for one board: scan only this board's doc and merge with
    -- each affected key's prior board set (other boards are authoritative from
    -- their own recompute; the nightly full rebuild heals any concurrent-edit
    -- drift). `affected` includes keys that currently LIST this board so that a
    -- card removal correctly DROPS the board from the array.
    with live_b as (
      select distinct k.r2_key
      from board_state bs
      cross join lateral _r2_keys_in_doc(bs.doc) as k(r2_key)
      where bs.board_id = p_board_id
    ),
    affected as (
      select i.id,
             i.storage_path,
             i.referenced_in_board_ids,
             i.first_referenced_at,
             (i.storage_path in (select r2_key from live_b)) as live_here
      from images i
      where i.storage_path in (select r2_key from live_b)
         or p_board_id = any(i.referenced_in_board_ids)
    ),
    computed as (
      select a.id,
             a.first_referenced_at,
             case when a.live_here then (
                    select coalesce(array_agg(distinct b), '{}'::uuid[])
                    from unnest(array_remove(a.referenced_in_board_ids, p_board_id) || array[p_board_id]) as b
                  )
                  else array_remove(a.referenced_in_board_ids, p_board_id)
             end as new_boards
      from affected a
    )
    update images i set
      referenced_in_board_ids = coalesce(c.new_boards, '{}'::uuid[]),
      ref_count               = coalesce(cardinality(c.new_boards), 0),
      last_referenced_at      = now(),
      first_referenced_at     = coalesce(c.first_referenced_at, now())
    from computed c
    where i.id = c.id;
    get diagnostics v_affected = row_count;
  end if;

  return v_affected;
end;
$$;

revoke all on function recompute_image_refs(uuid) from public, anon;
grant execute on function recompute_image_refs(uuid) to service_role;

-- ── 3a. Forward maintenance: recompute the affected board on every doc change. ──
create or replace function _trg_recompute_image_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.doc is distinct from old.doc then
    perform recompute_image_refs(new.board_id);
  end if;
  return null;  -- AFTER trigger
end;
$$;

drop trigger if exists board_state_recompute_image_refs on board_state;
create trigger board_state_recompute_image_refs
  after insert or update on board_state
  for each row
  execute function _trg_recompute_image_refs();

-- ── 3b. Nightly safety-net full recompute (heals any drift). ──
do $$
begin
  perform cron.unschedule('recompute_image_refs_nightly');
exception when others then
  null;  -- not scheduled yet
end $$;

select cron.schedule(
  'recompute_image_refs_nightly',
  '40 3 * * *',
  $cron$ select public.recompute_image_refs(null); $cron$
);

-- ── 4. One-time backfill: repair the currently-stale rows. ──
select recompute_image_refs(null);

-- ── 5. Harden the orphan sweep with an authoritative LIVE board_state guard. ──
-- An image referenced in ANY live board_state doc is ALWAYS kept, independent of
-- ref_count freshness. This is the definitive safety net — even if the recompute
-- above ever lags or has a bug, the sweep consults the live source of truth.
create or replace function find_history_safe_orphan_images(
  p_limit  integer default 500,
  p_dryrun boolean default true
)
returns table (
  id uuid,
  storage_path text,
  workspace_id uuid,
  ref_count int,
  last_referenced_at timestamptz,
  created_at timestamptz,
  decision text,
  reason text
)
language plpgsql
security definer
as $$
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
        where c.storage_path = any (bs.r2_keys_referenced)
      ) as in_snapshot,
      exists (
        select 1 from board_ops bo
        where c.storage_path = any (bo.r2_keys)
      ) as in_ops
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
      when p_dryrun       then 'skipped_dryrun'
      else 'delete'
    end as decision,
    case
      when cl.in_live_doc then 'referenced in a live board_state doc'
      when cl.in_snapshot then 'referenced by retained snapshot history'
      when cl.in_ops      then 'referenced by retained op history'
      when p_dryrun       then 'eligible but in dry-run mode'
      else 'no remaining references; safe to delete'
    end as reason
  from classified cl;
end;
$$;

revoke all on function find_history_safe_orphan_images(integer, boolean) from public;
grant execute on function find_history_safe_orphan_images(integer, boolean) to service_role;
