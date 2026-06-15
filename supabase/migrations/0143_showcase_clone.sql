-- 0143_showcase_clone.sql
--
-- welcome_showcase arm B (0142) now CLONES the real "Clusters Logo" brand board
-- into a brand-new user's root instead of a hand-built moodboard. The user then
-- clears it in one click to start their own.
--
-- prepare_showcase() does two things in one call: (1) GRANTS the caller's board
-- cross-workspace read on the source board's images — the 0127/0128
-- referenced_in_board_ids model means any board referencing an r2:<key> grants
-- its members read — done BEFORE the client renders so the 21 image cards load
-- with no broken-image flash; (2) returns the source board's Y.Doc snapshot
-- (base64) for the client to decode + seed (bypasses RLS — the showcase is meant
-- to be seen). Source images are retention-locked so the R2 orphan sweep
-- (find_history_safe_orphan_images, 0127) can never reap them even as clones come
-- and go. The recompute_image_refs trigger keeps referenced_in_board_ids correct
-- afterward (rebuilds from each board's live doc), so clearing the showcase drops
-- that board automatically.

-- 1. Config of record — lets us swap the source board or disable without redeploy.
insert into public.app_config (key, value)
values ('onboarding_showcase', jsonb_build_object(
  'enabled', true,
  'board_id', 'ebf42869-d19f-4b86-8659-763b082095c8'
))
on conflict (key) do nothing;

-- 2. The clone primer.
create or replace function public.prepare_showcase(p_board_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cfg jsonb;
  v_src uuid;
  v_snapshot text;
begin
  -- The caller must be able to WRITE the target board — so they can only ever
  -- grant their OWN board read on the showcase images (never an arbitrary board).
  if not can_write_board(p_board_id) then
    return jsonb_build_object('snapshot', null, 'source', null);
  end if;

  select value into v_cfg from public.app_config where key = 'onboarding_showcase';
  if v_cfg is null or coalesce((v_cfg->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('snapshot', null, 'source', null);
  end if;
  v_src := nullif(v_cfg->>'board_id', '')::uuid;
  if v_src is null then
    return jsonb_build_object('snapshot', null, 'source', null);
  end if;

  -- Grant the target board read on every source-board image (idempotent). images
  -- has no authenticated UPDATE policy — this definer is the only writer besides
  -- recompute_image_refs, and both only ever reflect genuine board references.
  update public.images i
     set referenced_in_board_ids = array_append(i.referenced_in_board_ids, p_board_id)
   where i.deleted_at is null
     and (i.board_id = v_src or v_src = any(i.referenced_in_board_ids))
     and not (p_board_id = any(i.referenced_in_board_ids));

  -- The source snapshot (base64 Y.Doc) for the client to decode, stamp, and seed.
  select doc into v_snapshot from public.board_state where board_id = v_src;

  return jsonb_build_object('snapshot', v_snapshot, 'source', v_src);
end;
$function$;

revoke all on function public.prepare_showcase(uuid) from public;
grant execute on function public.prepare_showcase(uuid) to authenticated;

-- 3. Pin the source images against the orphan sweep (far-future lock, the pattern
--    used for thumbnails). Even if every clone is later cleared, the originals
--    survive so future new users still get them.
update public.images
   set retention_locked_until = '2999-01-01'
 where deleted_at is null
   and (board_id = 'ebf42869-d19f-4b86-8659-763b082095c8'
        or 'ebf42869-d19f-4b86-8659-763b082095c8' = any(referenced_in_board_ids));
