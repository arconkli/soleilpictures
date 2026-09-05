-- 0287 — three tables were being sequentially scanned inside hot helpers.
--
-- Applied with CREATE INDEX CONCURRENTLY, which cannot run inside a
-- transaction — run these as individual statements, not as one migration
-- block.
--
-- workspaces (139,934 seq scans, 40.1M tuples read)
--   has no index on created_by, and created_by = auth.uid() is tested inside
--   can_write_board(), can_write_workspace() AND get_my_tier(). get_my_tier
--   alone runs 7,996 times at 763 buffers a call. 4 of 345 rows are NULL and
--   `= auth.uid()` never matches NULL, so the partial predicate is free.
--
-- email_sends (60,292 seq scans, 246M tuples read)
--   _email_deliverable() joins it on lower(recipient_email) with no matching
--   index. Runs hourly from the lifecycle mailer and grows with the table.
--
-- entity_links (96,920 seq scans, 41.8M tuples read)
--   counted by created_at in admin_universe_stats(), which runs 65,303 times.

create index concurrently if not exists workspaces_created_by_idx
  on public.workspaces (created_by) where created_by is not null;

create index concurrently if not exists email_sends_recipient_lower_idx
  on public.email_sends (lower(recipient_email));

create index concurrently if not exists entity_links_created_at_idx
  on public.entity_links (created_at);

-- Dead weight, dropped. Each of these costs WAL and dirtied buffers on every
-- insert to its table and returns nothing on read.
--
--   analytics_events_props_gin   9.5MB, 0 lifetime scans. jsonb_path_ops
--                                answers @>, @? and @@; no query in the repo
--                                uses any of them on props. Not merely unused
--                                — unusable.
--   board_versions_board_idx     exact duplicate of board_versions_recent_idx
--                                (both btree(board_id, snapshot_at DESC)).
--   board_ops_card_gin           3.3MB, 0 scans. card_ids is written by the
--                                append-op RPC and never queried.
--   board_ops_author_ts_idx      10MB, 4 lifetime scans. No author-scoped query
--                                exists; the ts-range probes use
--                                board_ops_board_ts_idx.
--
-- NOT dropped, despite also showing 0 scans:
--   board_ops_r2_gin       0284 rewrote the orphan-sweep guards from
--                          `= any(...)` to `&&`, which is the operator this
--                          index answers. It goes live with that change.
--   images_boards_gin      same shape, needed by the images RLS policy.
-- A GIN index reading zero is not always a dead index; sometimes it is a query
-- asking the wrong question.

drop index concurrently if exists public.analytics_events_props_gin;
drop index concurrently if exists public.board_versions_board_idx;
drop index concurrently if exists public.board_ops_card_gin;
drop index concurrently if exists public.board_ops_author_ts_idx;
