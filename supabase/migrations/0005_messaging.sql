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

-- A2: message_reads — per-user last-read + hidden_at -----------------------

create table message_reads (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  reads_board_id uuid references boards on delete cascade,
  reads_dm_peer  uuid references auth.users on delete cascade,
  last_read_at   timestamptz not null default now(),
  hidden_at      timestamptz
);

-- Postgres rejects coalesce() in primary keys, so emulate (user_id, target) uniqueness
-- with a unique index instead.
create unique index message_reads_unique_target on message_reads (
  user_id,
  coalesce(reads_board_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(reads_dm_peer,  '00000000-0000-0000-0000-000000000000'::uuid)
);

alter table message_reads enable row level security;
drop policy if exists "reads own" on message_reads;
create policy "reads own" on message_reads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A3: summary views ---------------------------------------------------------

create or replace view board_channel_summary as
select
  m.workspace_id,
  m.board_id,
  b.name                              as board_name,
  count(*)                            as message_count,
  max(m.created_at)                   as last_message_at,
  (select body from messages m2
     where m2.board_id = m.board_id and m2.deleted_at is null
     order by m2.created_at desc limit 1) as last_message
from messages m
join boards b on b.id = m.board_id
where m.board_id is not null and m.deleted_at is null
group by m.workspace_id, m.board_id, b.name;

create or replace view dm_thread_summary as
with dm as (
  select
    workspace_id,
    sender_id,
    dm_peer_id,
    body,
    created_at,
    least(sender_id, dm_peer_id)    as user_a,
    greatest(sender_id, dm_peer_id) as user_b
  from messages
  where dm_peer_id is not null and deleted_at is null
)
select
  workspace_id,
  user_a,
  user_b,
  count(*)            as message_count,
  max(created_at)     as last_message_at,
  (select body from dm d2
     where d2.user_a = dm.user_a and d2.user_b = dm.user_b
     order by d2.created_at desc limit 1) as last_message
from dm
group by workspace_id, user_a, user_b;

-- A4: message-attachments storage bucket ------------------------------------

insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', true)
on conflict (id) do nothing;

drop policy if exists "msg-att read"  on storage.objects;
drop policy if exists "msg-att write" on storage.objects;

create policy "msg-att read" on storage.objects for select
  using (bucket_id = 'message-attachments');

create policy "msg-att write" on storage.objects for insert
  with check (bucket_id = 'message-attachments' and auth.uid() is not null);
