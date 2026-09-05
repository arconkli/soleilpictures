-- 0293 — one board_state save rewrote every image row on the board, twice over.
--
-- board_state fires _trg_recompute_image_refs on every doc change, which calls
-- recompute_image_refs(board_id). That function UPDATEd every image row it
-- touched unconditionally, and each of those UPDATEs fired storage_usage_trg,
-- which wrote storage_usage twice. Measured lifetime:
--
--   images          413,800 updates, only 6.2% HOT  (~388k full row + 8 index rewrites)
--   storage_usage   834,628 updates
--
-- Two independent causes, both fixed here.
--
-- 1. recompute_image_refs never checked whether anything changed. The per-board
--    branch also set `last_referenced_at = now()` on every matched row, which
--    guarantees a write even when the reference arrays are identical — and most
--    saves are a card move or a keystroke, which change no image references at
--    all. Guards added to both branches.
--
--    `last_referenced_at` is now set only when the image is actually live on the
--    board. Its ONLY consumer is the orphan sweep's
--    `ref_count = 0 and last_referenced_at < now() - 30 days`, and there is no
--    app reader anywhere. For a still-referenced image (ref_count >= 1) the
--    timestamp cannot affect that predicate, so not bumping it is unobservable.
--    For an image being REMOVED from its last board the old behaviour reset the
--    clock to now() at the moment it stopped being referenced, which kept it
--    permanently ineligible for the sweep. Keeping the prior value is both
--    cheaper and more correct.
--
-- 2. storage_usage_trg, on UPDATE, unconditionally did
--       _storage_usage_apply(old_owner, -size, -1)
--       _storage_usage_apply(new_owner, +size, +1)
--    When owner, size_bytes and deleted_at are all unchanged those two calls
--    cancel exactly, so the whole thing is a pair of writes to reach the number
--    it already held. Now it returns early.
--
--    Caveat worth stating: _storage_usage_apply clamps with greatest(0, ...), so
--    on a drifted counter the -/+ pair could nudge the total upward rather than
--    cancelling. That is an accident, not a design — reconcile_storage_usage
--    (nightly, jobid 25) is the authoritative repair — and depending on it would
--    mean keeping ~834k writes to launder a rounding error.
--
-- Verified on production: a repeat recompute on the busiest board (501 images)
-- now updates 0 rows where it previously updated all 501 plus 1,002
-- storage_usage writes; corrupting one row's array and re-running updates
-- exactly 1 and repairs it; a storage-irrelevant image UPDATE leaves
-- storage_usage.updated_at untouched while a soft-delete still moves both
-- bytes_used and object_count.
--
-- NOT changed: the `storage_path in (...) or ... = any(referenced_in_board_ids)`
-- predicate. Rewriting it to `&&` and splitting the OR into a UNION does light
-- up images_boards_gin, but measured on the busiest board it costs MORE:
-- 2,158 buffers (501 index probes on images_storage_path_key) versus 972 for the
-- seq scan the planner picks today. The read side is already the cheap half.

create or replace function public.storage_usage_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old_owner uuid;
  v_new_owner uuid;
  v_old_alive boolean;
  v_new_alive boolean;
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then
      perform public._storage_usage_apply(
        public._image_owner(new.workspace_id), coalesce(new.size_bytes, 0), 1);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.deleted_at is null then
      perform public._storage_usage_apply(
        public._image_owner(old.workspace_id), -coalesce(old.size_bytes, 0), -1);
    end if;
    return old;
  end if;

  -- UPDATE. Storage usage is a function of exactly three columns. If none of
  -- them moved, the -/+ pair below is arithmetically a no-op, so skip it.
  if old.workspace_id is not distinct from new.workspace_id
     and coalesce(old.size_bytes, 0) = coalesce(new.size_bytes, 0)
     and (old.deleted_at is null) = (new.deleted_at is null) then
    return new;
  end if;

  v_old_alive := old.deleted_at is null;
  v_new_alive := new.deleted_at is null;
  v_old_owner := public._image_owner(old.workspace_id);
  v_new_owner := public._image_owner(new.workspace_id);

  if v_old_alive then
    perform public._storage_usage_apply(v_old_owner, -coalesce(old.size_bytes, 0), -1);
  end if;
  if v_new_alive then
    perform public._storage_usage_apply(v_new_owner, coalesce(new.size_bytes, 0), 1);
  end if;
  return new;
end $function$;

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
         or p_board_id = any(i.referenced_in_board_ids)
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

-- The updates that DO survive the guards should stand a chance of being HOT.
-- images sat at 6.2% HOT on a default fillfactor of 100, so nearly every one
-- rewrote all eight of its index entries too.
alter table public.images set (fillfactor = 90);
