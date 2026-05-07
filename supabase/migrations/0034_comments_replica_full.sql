-- Postgres realtime DELETE events only include the primary key by
-- default (REPLICA IDENTITY DEFAULT). The boards client filters its
-- comments channel by `board_id=eq.<id>`; on a delete, the OLD record
-- only has `id`, so the filter fails to match and peers never refetch.
-- Symptom: deleting a comment "doesn't work" — the row is gone in the
-- DB but the bubble keeps showing because the local list isn't refreshed.
--
-- REPLICA IDENTITY FULL makes Postgres include the full OLD row in
-- replication events, so the filter matches and DELETE realtime works
-- as expected.

alter table public.comments replica identity full;
