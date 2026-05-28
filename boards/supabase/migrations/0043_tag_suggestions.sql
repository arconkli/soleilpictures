-- Embeddings-only tagging: middle-band suggestion inbox.
--
-- The AI tagger used to send every middle-band (cosine 0.20–0.55) candidate
-- to gpt-4o for a high/medium/low verdict. That burned through OpenAI spend
-- because the trigger fired on every render — see plan
-- /Users/andrewconklin/.claude/plans/we-need-to-work-snappy-wilkinson.md.
--
-- New pipeline:
--   - distance < SILENT_APPLY_DIST → auto-apply via entity_links (unchanged)
--   - distance in middle band       → upsert into tag_suggestions (NEW)
--   - distance >= NO_MATCH_DIST     → ignore
--
-- The middle band no longer hits an LLM. Suggestions surface in TagDetailView
-- as a per-tag inbox where the user accepts or dismisses. Dismissed rows
-- tombstone forever (dismissed_at set) so we don't re-annoy with the same
-- false positive.

create table if not exists tag_suggestions (
  tag_id        uuid not null references tags(id) on delete cascade,
  source_kind   text not null,                                  -- 'card' | 'group' | 'board' | 'doc-page'
  source_id     text not null,                                  -- text to match entity_links / card_embeddings
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  board_id      uuid,                                           -- for navigation; nullable for board-kind sources
  doc_card_id   uuid,                                           -- doc-page sources only
  distance      double precision not null,                      -- cosine distance at suggestion time
  created_at    timestamptz not null default now(),
  dismissed_at  timestamptz,                                    -- tombstone; null = active suggestion
  primary key (tag_id, source_kind, source_id)
);

-- Index for the inbox query: "active suggestions for this tag, closest first."
create index if not exists tag_suggestions_active_idx
  on tag_suggestions (tag_id, distance)
  where dismissed_at is null;

-- Workspace-scoped scans (admin views, cleanup jobs).
create index if not exists tag_suggestions_workspace_idx
  on tag_suggestions (workspace_id);

-- RLS — mirrors tag_centroids policies in 0042_tagging_embeddings.sql.
alter table tag_suggestions enable row level security;

create policy "tag_suggestions read"  on tag_suggestions
  for select using (is_workspace_member(workspace_id));
create policy "tag_suggestions write" on tag_suggestions
  for all    using (is_workspace_member(workspace_id))
            with check (is_workspace_member(workspace_id));
