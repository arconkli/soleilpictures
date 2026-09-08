-- board_state writes were the single most expensive thing in the database:
-- 59.8% of all exec time, mean 366ms per upsert, because the AFTER-write trigger
-- board_state_recompute_image_refs -> recompute_image_refs(board_id) contained a
-- predicate that could not use the index built for it.
--
--     or p_board_id = any(i.referenced_in_board_ids)
--
-- `scalar = ANY(array)` is not sargable: it forced a sequential scan of the whole
-- images table on EVERY board_state write. There is already a GIN index for this
-- exact question — images_boards_gin on referenced_in_board_ids — but only the
-- containment operators (@>, &&, <@) can use it. Rewriting the clause to
--
--     or i.referenced_in_board_ids @> array[p_board_id]
--
-- is semantically identical (an array contains x iff x = any(array)) and lets the
-- planner use the index.
--
-- Measured on production (board 7940f8aa…, 12,437 image rows):
--   = any :  Seq Scan,           592 ms, 897 buffers, 12,416 rows removed by filter
--   @>    :  Bitmap Index Scan,     8 ms,  22 buffers
-- Full recompute_image_refs() for a referenced board: 911 ms -> single-digit ms.
-- Equivalence checked in place: old and new predicates selected the identical
-- 21-row set (0 symmetric difference), doc-key branch included.
--
-- Only the per-board branch (p_board_id is not null — the path the trigger takes)
-- had this shape; the full-recompute branch already joins through agg. The body
-- below is verbatim from pg_get_functiondef with exactly one line changed.
-- create-or-replace preserves the existing ACL, so the 0311 revoke sweep stands.

create or replace function public.recompute_image_refs(p_board_id uuid default null::uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_affected integer := 0;
begin
  if p_board_id is null then
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
    where i.id = base.id
      and (
        i.referenced_in_board_ids is distinct from coalesce(a.board_ids, '{}'::uuid[])
        or i.ref_count is distinct from coalesce(a.n_boards, 0)
        or (a.r2_key is not null and i.first_referenced_at is null)
        or (a.r2_key is not null
            and (i.last_referenced_at is null or i.last_referenced_at < a.last_ts))
      );
    get diagnostics v_affected = row_count;

  else
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
         or i.referenced_in_board_ids @> array[p_board_id]
    ),
    computed as (
      select a.id,
             a.first_referenced_at,
             a.live_here,
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
      last_referenced_at      = case when c.live_here then now() else i.last_referenced_at end,
      first_referenced_at     = case when c.live_here then coalesce(c.first_referenced_at, now())
                                     else c.first_referenced_at end
    from computed c
    where i.id = c.id
      and (
        i.referenced_in_board_ids is distinct from coalesce(c.new_boards, '{}'::uuid[])
        or i.ref_count is distinct from coalesce(cardinality(c.new_boards), 0)
        or (c.live_here and i.first_referenced_at is null)
      );
    get diagnostics v_affected = row_count;
  end if;

  return v_affected;
end;
$function$;
