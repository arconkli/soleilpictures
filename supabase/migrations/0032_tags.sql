-- Tags everywhere: a workspace-scoped tag namespace + per-card and
-- per-board associations. `kind` distinguishes tags the user explicitly
-- created from auto-detected ones (matched by name) and AI-suggested
-- tags (deferred). `card_tags.source` mirrors that distinction at the
-- association level so the UI can render auto/AI tags differently from
-- ones the user attached themselves.

create table if not exists public.tags (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name         text not null,
  -- Lowercased name for unique-per-workspace constraint + fast lookup.
  slug         text generated always as (lower(name)) stored,
  color        text,
  kind         text not null default 'user' check (kind in ('user','auto','ai')),
  created_by   uuid references auth.users,
  created_at   timestamptz default now(),
  unique (workspace_id, slug)
);

create index if not exists tags_workspace_idx on public.tags (workspace_id);
create index if not exists tags_slug_idx on public.tags (slug);

alter table public.tags enable row level security;

drop policy if exists "tags select" on public.tags;
create policy "tags select"
  on public.tags for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "tags insert" on public.tags;
create policy "tags insert"
  on public.tags for insert
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "tags update" on public.tags;
create policy "tags update"
  on public.tags for update
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "tags delete" on public.tags;
create policy "tags delete"
  on public.tags for delete
  using (public.is_workspace_member(workspace_id));

-- Per-card associations. card_id is a string (Y.Map<'cards'> key); we
-- mirror board_id and workspace_id so RLS can gate reads via the card's
-- containing board, and so deletes cascade with board removal.
create table if not exists public.card_tags (
  workspace_id uuid not null,
  board_id     uuid not null references public.boards on delete cascade,
  card_id      text not null,
  tag_id       uuid not null references public.tags on delete cascade,
  source       text not null default 'user' check (source in ('user','auto','ai')),
  created_at   timestamptz default now(),
  primary key (board_id, card_id, tag_id)
);

create index if not exists card_tags_tag_idx on public.card_tags (tag_id);
create index if not exists card_tags_workspace_idx on public.card_tags (workspace_id);

alter table public.card_tags enable row level security;

drop policy if exists "card_tags select" on public.card_tags;
create policy "card_tags select"
  on public.card_tags for select
  using (public.can_read_board(board_id));

drop policy if exists "card_tags insert" on public.card_tags;
create policy "card_tags insert"
  on public.card_tags for insert
  with check (public.can_write_board(board_id));

drop policy if exists "card_tags delete" on public.card_tags;
create policy "card_tags delete"
  on public.card_tags for delete
  using (public.can_write_board(board_id));

-- Boards can be tagged the same way. Separate table (rather than
-- card_tags with a nullable card_id) keeps the indexes/foreign-keys
-- clean — and the queries the UI actually wants are different.
create table if not exists public.board_tags (
  workspace_id uuid not null,
  board_id     uuid not null references public.boards on delete cascade,
  tag_id       uuid not null references public.tags on delete cascade,
  source       text not null default 'user' check (source in ('user','auto','ai')),
  created_at   timestamptz default now(),
  primary key (board_id, tag_id)
);

create index if not exists board_tags_tag_idx on public.board_tags (tag_id);
create index if not exists board_tags_workspace_idx on public.board_tags (workspace_id);

alter table public.board_tags enable row level security;

drop policy if exists "board_tags select" on public.board_tags;
create policy "board_tags select"
  on public.board_tags for select
  using (public.can_read_board(board_id));

drop policy if exists "board_tags insert" on public.board_tags;
create policy "board_tags insert"
  on public.board_tags for insert
  with check (public.can_write_board(board_id));

drop policy if exists "board_tags delete" on public.board_tags;
create policy "board_tags delete"
  on public.board_tags for delete
  using (public.can_write_board(board_id));

alter publication supabase_realtime add table public.tags;
alter publication supabase_realtime add table public.card_tags;
alter publication supabase_realtime add table public.board_tags;
