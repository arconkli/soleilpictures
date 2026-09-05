-- 0289 — three tables were being decoded by Realtime for nobody.
--
-- realtime.list_changes() is the WALRUS poller, and it is the single largest
-- statement on this instance: 2.49M calls, 24,499s of execution, 5.84 BILLION
-- shared buffer hits — 92% of every buffer lookup the database performs. A
-- large part of that cost is fixed per poll rather than per event, because the
-- poller re-resolves publication membership from the catalog every time it
-- runs. Measured at ~33 buffer hits per published table per poll, so the size
-- of the publication is a tax paid every poll whether or not anything was
-- written.
--
-- To be precise about what this does and does not fix: those are buffer HITS,
-- not disk reads. This is CPU, buffer-mapping-lock contention and cache
-- eviction pressure on a 224MB shared_buffers — a responsiveness problem, not
-- the Disk IO budget problem. It is worth doing on those grounds alone.
--
-- These three carry no postgres_changes binding anywhere in the codebase
-- (boards/src, mcp, scout, supabase/functions all checked):
--
--   notifications      — nothing subscribes; the app listens on
--                        mention_notifications, which is a different table and
--                        stays published.
--   tag_centroids      — written by the autotag pipeline, read on demand.
--   workspace_members  — also read by is_workspace_member() on nearly every
--                        RLS policy, so keeping its row churn out of the decode
--                        path is doubly worthwhile.
--
-- Re-adding any of them is a one-line ALTER PUBLICATION if a live-update
-- feature ever wants them.
--
-- Two bindings in the app point at tables that are NOT in the publication and
-- therefore already do nothing: entityMentionsCache.js on `messages` and
-- TagDetailView.jsx on `tag_suggestions`. They still cost a subscription
-- round-trip on every mount. Left alone here — that is an app change, not a
-- publication one.

alter publication supabase_realtime drop table public.notifications;
alter publication supabase_realtime drop table public.tag_centroids;
alter publication supabase_realtime drop table public.workspace_members;
