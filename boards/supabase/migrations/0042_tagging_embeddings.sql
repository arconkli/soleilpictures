-- Tagging engine v2: embedding + AI tier system.
--
-- Adds three tables backing the new pipeline:
--   - card_embeddings: per-card vector keyed by card_id
--   - tag_centroids:   per-tag mean embedding + drift detection state
--   - pending_clusters: emergent themes (≥3 cards) awaiting promotion to tags
--
-- The card_id and workspace_id columns intentionally do NOT FK out — card IDs
-- are managed in Y.Doc (no SQL table) and the workspaces FK target may differ
-- across deployments. The application enforces integrity (matches the existing
-- entity_links pattern, which is also polymorphic).
--
-- pgvector dim 1536 matches OpenAI text-embedding-3-small. Swap the model and
-- the column dim must change too — no migration path other than re-embedding.

create extension if not exists vector;

-- One embedding per card. content_hash lets the client skip re-embedding when
-- the card text hasn't actually changed (typo fix, formatting tweak).
create table if not exists card_embeddings (
  card_id        uuid primary key,
  workspace_id   uuid not null,
  content_hash   text not null,
  embedding      vector(1536) not null,
  embedded_at    timestamptz not null default now()
);
create index if not exists card_embeddings_workspace_idx
  on card_embeddings (workspace_id);
create index if not exists card_embeddings_hnsw
  on card_embeddings using hnsw (embedding vector_cosine_ops);

-- One centroid per tag. card_count is the number of cards currently tagged
-- (for cheap UI counts and "is this tag still meaningful" checks).
-- last_named_centroid + last_named_at track drift since the tag was last
-- AI-validated, so we know when to fire a re-validate call.
create table if not exists tag_centroids (
  tag_id              uuid primary key references tags(id) on delete cascade,
  workspace_id        uuid not null,
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
--   pending → named (Haiku named it) → promoted (user accepted, became a tag)
--                                    → dismissed (user rejected the suggestion)
--                                    → rejected (Haiku said "none" — no coherent theme)
-- The named state is what surfaces in the Suggested-tags sidebar.
create table if not exists pending_clusters (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
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

-- RLS: this app uses the anon key client-side and a service-role key in the
-- Cloudflare Worker. Reads from the client are gated by joining workspace_id
-- against the user's accessible workspaces; the worker bypasses RLS via the
-- service-role key. Match whatever policy your other workspace-scoped tables
-- use (e.g. boards, entity_links). Add policies AFTER reviewing the existing
-- pattern in your project — leaving RLS off here would expose the data.
alter table card_embeddings  enable row level security;
alter table tag_centroids    enable row level security;
alter table pending_clusters enable row level security;
-- TODO: add SELECT/INSERT/UPDATE/DELETE policies matching the workspace
-- membership check used by your existing tables.
