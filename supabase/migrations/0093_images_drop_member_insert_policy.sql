-- 0093_images_drop_member_insert_policy.sql
--
-- Close an images-insert tier bypass that complements the 0091 demo lockdown.
--
-- The legacy permissive policy "images insert by members" (role public,
-- WITH CHECK is_workspace_member(workspace_id)) co-existed with "images insert"
-- (WITH CHECK can_write_workspace(workspace_id) OR (board_id IS NOT NULL AND
-- can_write_board(board_id))). Because Postgres ORs permissive INSERT policies,
-- ANY workspace member of ANY tier could insert `images` rows, bypassing the
-- tier-aware can_write_workspace gate established in 0091 (a demo non-creator
-- member is is_workspace_member=true but can_write_workspace=false).
--
-- Drop the legacy policy so the tier-aware "images insert" policy is the sole
-- INSERT gate. Verified (dry-run): post-drop the only INSERT policy is
-- "images insert" (authenticated). Legitimate writers are unaffected --
-- admin/paid members pass via can_write_workspace (which delegates to
-- is_workspace_member for them), and editor-shares pass via can_write_board.
-- No anon insert path exists (uploads require a JWT).

drop policy if exists "images insert by members" on public.images;
