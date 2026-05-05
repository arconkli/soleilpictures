-- Soleil Boards initial schema.
-- Run via the Supabase SQL editor (Dashboard → SQL → New query) OR
-- via the Supabase CLI: `supabase db push`.

create extension if not exists pgcrypto;

-- ── Tables ─────────────────────────────────────────────────────────────────

create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null default 'editor',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on workspace_members(user_id);

create table boards (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces on delete cascade,
  parent_board_id uuid references boards on delete cascade,
  name            text not null,
  view            text not null default 'canvas' check (view in ('canvas','list')),
  cover           text,
  meta            text,
  created_by      uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index boards_workspace_idx on boards(workspace_id);
create index boards_parent_idx on boards(parent_board_id);

create table board_state (
  board_id   uuid primary key references boards on delete cascade,
  doc        bytea not null,
  updated_at timestamptz not null default now()
);

create table inbox_items (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces on delete cascade,
  kind          text not null check (kind in ('image','link','note','doc')),
  payload       jsonb not null,
  from_user_id  uuid references auth.users on delete set null,
  source        text,
  created_at    timestamptz not null default now()
);
create index inbox_items_ws_idx on inbox_items(workspace_id, created_at desc);

create table images (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces on delete cascade,
  storage_path  text not null,
  width         int,
  height        int,
  uploaded_by   uuid references auth.users on delete set null,
  created_at    timestamptz not null default now()
);
create index images_ws_idx on images(workspace_id);

-- ── Helper: is the caller a member of this workspace? ──────────────────────
create or replace function is_workspace_member(ws uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table boards enable row level security;
alter table board_state enable row level security;
alter table inbox_items enable row level security;
alter table images enable row level security;

-- workspaces: members read; only authenticated users create; only the creator updates name (could relax later).
create policy "ws read by members" on workspaces for select
  using (is_workspace_member(id));
create policy "ws insert by authed" on workspaces for insert
  to authenticated with check (auth.uid() is not null);
create policy "ws update by creator" on workspaces for update
  using (created_by = auth.uid());

-- workspace_members: a user can read rows for workspaces they belong to;
-- a user can add themselves to a workspace they were invited to (left as future work — for now, the workspace creator inserts).
create policy "wm read own workspaces" on workspace_members for select
  using (user_id = auth.uid() or is_workspace_member(workspace_id));
create policy "wm insert by workspace creator" on workspace_members for insert
  to authenticated with check (
    -- creator of workspace can add anyone
    exists (select 1 from workspaces w where w.id = workspace_id and w.created_by = auth.uid())
    -- or user inserting themselves (TODO: gate by an invite token in v2)
    or user_id = auth.uid()
  );
create policy "wm delete by workspace creator or self" on workspace_members for delete
  using (
    exists (select 1 from workspaces w where w.id = workspace_id and w.created_by = auth.uid())
    or user_id = auth.uid()
  );

-- boards: members can read/write their workspace's boards
create policy "boards read by members" on boards for select
  using (is_workspace_member(workspace_id));
create policy "boards write by members" on boards for insert
  to authenticated with check (is_workspace_member(workspace_id));
create policy "boards update by members" on boards for update
  using (is_workspace_member(workspace_id));
create policy "boards delete by members" on boards for delete
  using (is_workspace_member(workspace_id));

-- board_state: same as boards (joined by workspace via board)
create policy "board_state read by members" on board_state for select
  using (exists (select 1 from boards b where b.id = board_state.board_id and is_workspace_member(b.workspace_id)));
create policy "board_state upsert by members" on board_state for insert
  to authenticated with check (exists (select 1 from boards b where b.id = board_state.board_id and is_workspace_member(b.workspace_id)));
create policy "board_state update by members" on board_state for update
  using (exists (select 1 from boards b where b.id = board_state.board_id and is_workspace_member(b.workspace_id)));
create policy "board_state delete by members" on board_state for delete
  using (exists (select 1 from boards b where b.id = board_state.board_id and is_workspace_member(b.workspace_id)));

-- inbox_items
create policy "inbox read by members" on inbox_items for select
  using (is_workspace_member(workspace_id));
create policy "inbox write by members" on inbox_items for insert
  to authenticated with check (is_workspace_member(workspace_id));
create policy "inbox delete by members" on inbox_items for delete
  using (is_workspace_member(workspace_id));

-- images metadata
create policy "images read by members" on images for select
  using (is_workspace_member(workspace_id));
create policy "images write by members" on images for insert
  to authenticated with check (is_workspace_member(workspace_id));
create policy "images delete by members" on images for delete
  using (is_workspace_member(workspace_id));

-- ── Storage bucket ─────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('board-images', 'board-images', true)
  on conflict (id) do nothing;

-- Public read on board-images (URLs are unguessable UUIDs)
create policy "board-images public read" on storage.objects for select
  using (bucket_id = 'board-images');
create policy "board-images authed write" on storage.objects for insert
  to authenticated with check (bucket_id = 'board-images');
create policy "board-images own delete" on storage.objects for delete
  to authenticated using (bucket_id = 'board-images' and owner = auth.uid());
