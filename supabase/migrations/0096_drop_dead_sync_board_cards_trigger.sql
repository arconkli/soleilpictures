-- Drop the board_state → sync-board-cards edge-function trigger.
--
-- The trigger has been 401-dead: trigger_sync_board_cards() posts to the
-- sync-board-cards edge function with no Authorization header, while the
-- function requires a JWT (verify_jwt=true), so every call is rejected
-- (confirmed by a stream of `POST | 401` in the edge-function logs). The
-- client-side syncCardIndex (boards/src/lib/boardsApi.js) already keeps
-- card_index fresh, so the trigger is redundant — it only generated a
-- wasteful pg_net + 401 edge-invocation storm (~4x per second during active
-- editing). Removing it cuts that waste with zero functional change.
--
-- Reverses migration 20260508023551 (sync_card_index_on_board_state).
-- Applied to prod via MCP apply_migration on 2026-05-29.
drop trigger if exists sync_board_cards_on_state_change on public.board_state;
drop function if exists public.trigger_sync_board_cards();
