-- Completes 0315. That migration made the array predicate GIN-usable
-- (= any -> @>), which fixed it in ISOLATION (592ms -> 8ms) but NOT in context:
-- the trigger's real query ORs it with `storage_path in (select … from live_b)`,
-- and the planner cannot BitmapOr a hashed-subquery IN with a GIN @>, so it fell
-- back to a full sequential scan of images on every board_state write anyway
-- (measured: the UPDATE's driving scan was ~558ms).
--
-- The robust fix is the classic OR -> UNION rewrite so each arm uses its own
-- index and no seq scan is possible:
--   arm 1  storage_path in (live_b)          -> images_storage_path_key (btree)
--   arm 2  referenced_in_board_ids @> [board]-> images_boards_gin (gin)
-- UNION dedups to the identical candidate set the OR produced (verified in place:
-- old/new predicates selected the same 21 rows, 0 symmetric difference).
--
-- Measured on production (board 7940f8aa…, 12,437 image rows), full trigger call:
--   before 0315 : 911 ms  (seq scan, = any)
--   after  0315 : 896 ms  (seq scan persists — OR defeats the index in context)
--   after  0316 :  31 ms  (all index access, no seq scan)  -> ~29x
-- board_state upserts were 59.8% of all DB exec time; this is the write path
-- behind every save. Only the per-board branch (the path the trigger takes) is
-- touched; the full-recompute branch (p_board_id is null, run manually) already
-- joins through agg and keeps its structure. Body is otherwise verbatim.
-- create-or-replace preserves the ACL, so 0311's revoke sweep stands.

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
    candidates as (
      -- OR split into index-friendly arms; UNION dedups to the same set.
      select id from images where storage_path in (select r2_key from live_b)
      union
      select id from images where referenced_in_board_ids @> array[p_board_id]
    ),
    affected as (
      select i.id,
             i.storage_path,
             i.referenced_in_board_ids,
             i.first_referenced_at,
             (i.storage_path in (select r2_key from live_b)) as live_here
      from images i
      where i.id in (select id from candidates)
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
