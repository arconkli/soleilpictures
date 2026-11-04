-- 0861 — index for social_board_visits (0860): share_view rows by the page's slug.
--
-- Applied with CREATE INDEX CONCURRENTLY, which cannot run inside a
-- transaction — run it as its own statement, not as a migration block.
-- analytics_events is large and hot; a plain CREATE INDEX would block its
-- writes for the whole build. social_board_visits works without this index,
-- just slower, so apply it whenever convenient after 0860.
--
-- Afterwards, confirm it is there and valid (one row, indisvalid = t):
--   select i.indexrelid::regclass, i.indisvalid from pg_index i
--    where i.indexrelid = 'public.analytics_events_share_view_slug_idx'::regclass;
-- An invalid leftover from a cancelled build must be dropped and rebuilt.

create index concurrently if not exists analytics_events_share_view_slug_idx
  on public.analytics_events ((props->>'public_slug'), occurred_at)
  where event = 'share_view';
