-- Soleil Boards messaging — DMs + per-board channels.
-- Built up across A1..A4 below; later migrations (0006, 0007) extend
-- entity_search and drop the legacy inbox_items table.

-- A1: messages table + RLS ---------------------------------------------------

create table messages (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces on delete cascade,
  board_id      uuid references boards on delete cascade,
  dm_peer_id    uuid references auth.users on delete cascade,
  sender_id     uuid not null references auth.users on delete cascade,
  body          text not null default '',
  attachments   jsonb not null default '[]'::jsonb,
  mentions      uuid[] not null default '{}',
  reactions     jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  deleted_at    timestamptz,
  check (board_id is not null or dm_peer_id is not null),
  check (board_id is null or dm_peer_id is null)
);

create index messages_board_idx on messages (board_id, created_at desc) where board_id is not null;
create index messages_dm_idx    on messages (workspace_id, sender_id, dm_peer_id, created_at desc) where dm_peer_id is not null;
create index messages_sender_idx on messages (sender_id, created_at desc);
create index messages_mentions_idx on messages using gin (mentions);

alter table messages enable row level security;

drop policy if exists "messages read"   on messages;
drop policy if exists "messages insert" on messages;
drop policy if exists "messages update" on messages;
drop policy if exists "messages delete" on messages;

create policy "messages read" on messages for select
  using (is_workspace_member(workspace_id));

create policy "messages insert" on messages for insert
  with check (is_workspace_member(workspace_id) and sender_id = auth.uid());

create policy "messages update" on messages for update
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

create policy "messages delete" on messages for delete
  using (sender_id = auth.uid());
