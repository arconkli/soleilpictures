-- Ground-truth labels for the tagging-quality eval harness.
--
-- After the embeddings-only rework (0043) the open question was
-- whether the system makes the right calls — precision in AUTO and
-- recall in SUGGEST. This table stores hand-labeled (tag, source)
-- pairs marked as "should_apply" or "should_not_apply" by an admin,
-- which the admin Tagging tab uses as a repeatable benchmark for any
-- future threshold change, centroid recompute, or model swap.
--
-- Scope is intentionally small: a few dozen labels per tag is enough
-- at the current scale (3 tags, 324 card_embeddings). RLS mirrors
-- tag_centroids / tag_suggestions — workspace members can read/write
-- labels for their own workspace.

create table if not exists tag_eval_labels (
  tag_id       uuid not null references tags(id) on delete cascade,
  source_kind  text not null,                            -- 'card' for v1
  source_id    text not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  label        text not null
               check (label in ('should_apply','should_not_apply')),
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users on delete set null,
  primary key (tag_id, source_kind, source_id)
);

create index if not exists tag_eval_labels_workspace_idx
  on tag_eval_labels (workspace_id);

alter table tag_eval_labels enable row level security;

create policy "tag_eval_labels read"  on tag_eval_labels
  for select using (is_workspace_member(workspace_id));
create policy "tag_eval_labels write" on tag_eval_labels
  for all    using (is_workspace_member(workspace_id))
            with check (is_workspace_member(workspace_id));
