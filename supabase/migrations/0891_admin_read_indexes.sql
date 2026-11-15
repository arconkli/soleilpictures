-- 0891 — covering indexes for the admin reads of analytics_events.
--
-- The admin reports walked most of the events heap through an index only to
-- read user_id, occurred_at, event and session_id. The heap is wide (each row
-- carries its props document) and close to the size of the buffer cache, so
-- those walks were disk reads. Each new index carries the columns the reports
-- read, so they scan narrow index entries instead (Index Only Scan).
--
-- CONCURRENTLY cannot run inside a transaction, so this file has no
-- transaction block and is not applied as a migration block: the release run
-- applies it ONE STATEMENT AT A TIME with execute_sql (as 0861 was), in file
-- order, creates before drops. A plain CREATE INDEX would block writes to a
-- hot table for the whole build.
--
-- Before the drops, confirm all four new indexes are valid (four rows, all t):
--   select c.relname, i.indisvalid from pg_index i
--     join pg_class c on c.oid = i.indexrelid
--    where c.relname in ('analytics_events_user_time_cover',
--                        'analytics_events_occurred_cover',
--                        'analytics_events_session_time_user',
--                        'analytics_events_card_placed_user_time');
-- A failed or cancelled concurrent build leaves an INVALID index, and IF NOT
-- EXISTS then skips it silently: drop it and build it again before going on.
--
-- Each replacement keeps the old index's leading key columns, order and
-- direction, and a predicate no stricter than the old one's, so every query
-- the old index served is still served.

-- Replaces events_user_time (same keys, same predicate). _admin_visits reads
-- every person's events for their days, first and last times and whether
-- anything real happened: all of it is now in the index.
create index concurrently if not exists analytics_events_user_time_cover
  on public.analytics_events (user_id, occurred_at desc)
  include (event, session_id)
  where user_id is not null;

-- Replaces analytics_events_occurred_at_idx (same key, no predicate). The
-- activity heatmap reads a time window's user_id and session_id.
create index concurrently if not exists analytics_events_occurred_cover
  on public.analytics_events (occurred_at desc)
  include (user_id, session_id);

-- Replaces events_session, which is on (session_id) alone with no predicate,
-- so this one has none either. The share ledger and the tests read ask which
-- accounts a device has been signed in as, and since when.
create index concurrently if not exists analytics_events_session_time_user
  on public.analytics_events (session_id, occurred_at)
  include (user_id);

-- New. The return reports join each person to their day-one card_placed rows;
-- without this the planner intersected two whole-table bitmaps. Those reports
-- also read props (actor, n), so this is an Index Scan that touches only the
-- person's own card_placed rows, not an Index Only Scan.
create index concurrently if not exists analytics_events_card_placed_user_time
  on public.analytics_events (user_id, occurred_at)
  where event = 'card_placed';

-- The old ones, each after its replacement.
drop index concurrently if exists public.events_user_time;
drop index concurrently if exists public.analytics_events_occurred_at_idx;
drop index concurrently if exists public.events_session;

-- An index-only scan still visits the heap for every page the visibility map
-- does not mark all-visible, and only a vacuum marks them. At the default 0.2
-- an insert-only table this size waits for about a fifth of its rows in new
-- inserts between vacuums, so the newest rows, the ones admin reads most, kept
-- needing heap fetches. 0.02 vacuums roughly ten times as often; each pass
-- only has to look at the pages added since the last one.
alter table public.analytics_events
  set (autovacuum_vacuum_insert_scale_factor = 0.02);
