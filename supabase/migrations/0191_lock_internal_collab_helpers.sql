-- 0191_lock_internal_collab_helpers.sql — revoke client EXECUTE on the
-- guardless internal SECURITY DEFINER helpers introduced in 0187-0189.
--
-- Supabase's default privileges grant EXECUTE to anon+authenticated at
-- function-creation time, and `revoke ... from public` (which 0187-0189 used)
-- does NOT remove those explicit-role grants — so these helpers were left
-- client-callable. Every OTHER new function is fine: it has an internal
-- auth.uid()/can_*/require_admin guard that fails closed for anon (the
-- project-wide defense pattern). These three do NOT, so they get the same
-- treatment as grant_referral_reward (0163): reachable only by the definer
-- (postgres) + service_role.
--
--   _joined_notification  — the one that mattered: SECURITY DEFINER, no guard,
--     inserts a share_notifications row + fires the invite_accepted email for
--     ARBITRARY (inviter, board, joiner) args. Directly callable, an
--     authenticated user could forge "X joined your board" toasts/emails to
--     any user. Its only legitimate callers are claim_collab_link /
--     claim_pending_invite / _claim_pending_invites_for_user, which run as the
--     definer and are unaffected.
--   _collab_editor_cap    — reads app_config; harmless but internal-only.
--   board_workspace_owner — returns a board's owner uuid; low-sensitivity but
--     internal-only.
--
-- No client/worker code calls any of these (verified by grep); all callers are
-- SECURITY DEFINER SQL functions that execute as postgres.

revoke execute on function public._joined_notification(uuid, uuid, uuid, text, uuid) from anon, authenticated;
revoke execute on function public._collab_editor_cap() from anon, authenticated;
revoke execute on function public.board_workspace_owner(uuid) from anon, authenticated;
