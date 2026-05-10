-- Tagging engine v2: embedding + AI tier system.
--
-- Adds three tables backing the new pipeline:
--   - card_embeddings: per-card vector keyed by card_id
--   - tag_centroids:   per-tag mean embedding + drift detection state
--   - pending_clusters: emergent themes (≥3 cards) awaiting promotion to tags
--
-- The card_id and workspace_id columns intentionally do NOT FK out to a cards
-- table — card IDs are managed in Y.Doc (no SQL cards table). The application
-- enforces integrity, matching the existing entity_links pattern.
--
-- pgvector dim 1536 matches OpenAI text-embedding-3-small. Swapping the
-- embedding model means the column dim must change and every embedding must
-- be re-generated — there's no in-place migration path.

create extension if not exists vector;

-- One embedding per card. content_hash lets the client skip re-embedding when
-- the card text hasn't actually changed (typo fix, formatting tweak).
create table if not exists card_embeddings (
  card_id        uuid primary key,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  content_hash   text not null,
  embedding      vector(1536) not null,
  embedded_at    timestamptz not null default now()
);
create index if not exists card_embeddings_workspace_idx
  on card_embeddings (workspace_id);
create index if not exists card_embeddings_hnsw
  on card_embeddings using hnsw (embedding vector_cosine_ops);

-- One centroid per tag. card_count is the number of cards currently tagged
-- (cheap UI counts and "is this tag still meaningful" checks).
-- last_named_centroid + last_named_at track drift since the tag was last
-- AI-validated, so we know when to fire a re-validate call.
create table if not exists tag_centroids (
  tag_id              uuid primary key references tags(id) on delete cascade,
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  centroid            vector(1536),
  card_count          int not null default 0,
  last_named_centroid vector(1536),
  last_named_at       timestamptz,
  updated_at          timestamptz not null default now()
);
create index if not exists tag_centroids_workspace_idx
  on tag_centroids (workspace_id);
create index if not exists tag_centroids_hnsw
  on tag_centroids using hnsw (centroid vector_cosine_ops);

-- Emergent clusters that haven't been promoted to tags yet. Status flow:
--   pending → named (model named it) → promoted (user accepted, became a tag)
--                                    → dismissed (user rejected the suggestion)
--                                    → rejected (model said "none" — no coherent theme)
-- The named state is what surfaces in the Suggested-tags sidebar.
create table if not exists pending_clusters (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  member_card_ids uuid[] not null,
  centroid        vector(1536) not null,
  proposed_name   text,
  status          text not null default 'pending'
                  check (status in ('pending','named','dismissed','promoted','rejected')),
  named_at        timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists pending_clusters_workspace_status_idx
  on pending_clusters (workspace_id, status);

-- RLS — mirrors the workspace-membership pattern used by tags / autotag_ignored.
-- The is_workspace_member(uuid) helper already exists in this project.

alter table card_embeddings  enable row level security;
alter table tag_centroids    enable row level security;
alter table pending_clusters enable row level security;

create policy "card_embeddings read"  on card_embeddings
  for select using (is_workspace_member(workspace_id));
create policy "card_embeddings write" on card_embeddings
  for all    using (is_workspace_member(workspace_id))
            with check (is_workspace_member(workspace_id));

create policy "tag_centroids read"    on tag_centroids
  for select using (is_workspace_member(workspace_id));
create policy "tag_centroids write"   on tag_centroids
  for all    using (is_workspace_member(workspace_id))
            with check (is_workspace_member(workspace_id));

create policy "pending_clusters read"  on pending_clusters
  for select using (is_workspace_member(workspace_id));
create policy "pending_clusters write" on pending_clusters
  for all    using (is_workspace_member(workspace_id))
            with check (is_workspace_member(workspace_id));
