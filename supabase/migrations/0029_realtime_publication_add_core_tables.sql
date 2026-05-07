-- Add the tables our client hooks subscribe to into the
-- supabase_realtime publication. Without being in the publication,
-- subscriptions silently never fire — postgres_changes events are
-- only delivered for tables the publication includes.
--
-- Symptoms this fixes:
--  - useBoardList: peers didn't see new / renamed / deleted boards
--    on a shared canvas until they reloaded.
--  - useEntityNameTrie: auto-detect didn't pick up new entity names
--    or alias edits in real time.
--  - entityMentionsCache: hover popovers showed stale "appears in"
--    counts after edits.
--
-- We deliberately do NOT publish messages / message_reads here —
-- those use Supabase realtime broadcast channels, not Postgres
-- change events.

alter publication supabase_realtime add table boards;
alter publication supabase_realtime add table workspace_members;
alter publication supabase_realtime add table card_index;
alter publication supabase_realtime add table entity_aliases;
alter publication supabase_realtime add table entity_ignore_terms;
alter publication supabase_realtime add table doc_page_index;
