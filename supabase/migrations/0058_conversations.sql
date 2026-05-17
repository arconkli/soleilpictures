-- 0058_conversations.sql — collapse "board chat" + DMs into a single
-- workspace-level conversation model (DMs and ad-hoc group chats).
--
-- Why: the prior model coupled chat 1:1 to boards (every board had an
-- implicit chat thread). That made it impossible to start a chat that
-- wasn't tied to a board, cluttered the panel with empty board chats,
-- and made unread state hard to track cleanly. This collapses to:
--
--   conversations               (workspace-scoped chat thread)
--   conversation_participants   (membership + last_read_at + soft-leave)
--   messages.conversation_id    (FK replaces board_id / dm_peer_id)
--
-- DMs are just 2-participant conversations. Group chats are 3+.
-- All existing board / DM messages are wiped (internal app, no
-- history worth migrating).

----------------------------------------------------------------------
-- 1. WIPE existing messages + entity_links from messages
----------------------------------------------------------------------
-- Truncate before we alter the column shape. Cascades to
-- mention_notifications (FK to messages.id).
truncate table messages cascade;

-- entity_links uses (source_kind, source_id) text keys, not FKs, so
-- truncating messages doesn't cascade. Clear the message rows.
delete from entity_links where source_kind = 'message';

----------------------------------------------------------------------
-- 2. Drop dependents that reference messages.board_id / dm_peer_id
----------------------------------------------------------------------
drop view  if exists board_channel_summary;
drop view  if exists dm_thread_summary;
drop index if exists messages_board_idx;
drop index if exists messages_dm_idx;
drop index if exists messages_pinned_idx;     -- references board_id; re-created below

drop function if exists get_unread_counts();  -- references board_id / dm_peer_id

drop trigger  if exists messages_record_entity_links_ins on messages;
drop trigger  if exists messages_record_entity_links_upd on messages;
drop trigger  if exists messages_mention_notify_trg on messages;
-- functions get CREATE OR REPLACE'd below.

-- The "messages read" policy uses can_read_board(board_id); drop it
-- so we can rebuild around conversation participation.
drop policy if exists "messages read"   on messages;
drop policy if exists "messages insert" on messages;
drop policy if exists "messages update" on messages;
drop policy if exists "messages delete" on messages;

----------------------------------------------------------------------
-- 3. Conversations + participants
----------------------------------------------------------------------
create table conversations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces on delete cascade,
  title           text,                       -- null = render from participants
  created_by      uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz                 -- denormalized for sort; null until first message
);

create index conversations_workspace_idx on conversations (workspace_id, last_message_at desc nulls last);

create table conversation_participants (
  conversation_id uuid not null references conversations on delete cascade,
  user_id         uuid not null references auth.users on delete cascade,
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,                -- null = active member
  last_read_at    timestamptz not null default '1970-01-01'::timestamptz,
  primary key (conversation_id, user_id)
);

create index conversation_participants_user_idx
  on conversation_participants (user_id) where left_at is null;

-- Helpers for RLS (avoid recursive policy lookups).
create or replace function is_conversation_participant(p_conv uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation_participants
    where conversation_id = p_conv and user_id = auth.uid()
  );
$$;
revoke all on function is_conversation_participant(uuid) from public;
grant execute on function is_conversation_participant(uuid) to authenticated;

create or replace function is_active_conversation_participant(p_conv uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation_participants
    where conversation_id = p_conv and user_id = auth.uid() and left_at is null
  );
$$;
revoke all on function is_active_conversation_participant(uuid) from public;
grant execute on function is_active_conversation_participant(uuid) to authenticated;

alter table conversations enable row level security;
alter table conversation_participants enable row level security;

-- conversations: visible if you're (or were) a participant; insert by
-- workspace members; update by participants (rename); no delete.
create policy "conversations read" on conversations for select
  using (is_conversation_participant(id));

create policy "conversations insert" on conversations for insert
  with check (is_workspace_member(workspace_id) and created_by = auth.uid());

create policy "conversations update" on conversations for update
  using (is_active_conversation_participant(id))
  with check (is_active_conversation_participant(id));

-- conversation_participants:
--   read: anyone in the same conversation can see all participants
--   insert: any active participant of the conversation can add a workspace co-member;
--           OR the row's user_id matches the conversation creator (for the initial seed)
--   update: only your own row (last_read_at, left_at)
--   delete: no (use left_at)
create policy "participants read" on conversation_participants for select
  using (is_conversation_participant(conversation_id));

create policy "participants insert" on conversation_participants for insert
  to authenticated
  with check (
    -- Caller is an active participant adding someone to a conversation
    is_active_conversation_participant(conversation_id)
    -- Or: caller is adding themselves AND they created the conversation
    or (
      user_id = auth.uid()
      and exists (
        select 1 from conversations c
        where c.id = conversation_id and c.created_by = auth.uid()
      )
    )
  );

create policy "participants update self" on conversation_participants for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

----------------------------------------------------------------------
-- 4. Alter messages: drop board_id/dm_peer_id, add conversation_id + kind
----------------------------------------------------------------------
-- The CHECK constraints from 0005 ("board_id is null or dm_peer_id is null", etc.)
-- are anonymous; DROP COLUMN ... CASCADE drops them along with the columns.
alter table messages drop column if exists board_id  cascade;
alter table messages drop column if exists dm_peer_id cascade;

alter table messages add column conversation_id uuid
  references conversations on delete cascade;

alter table messages add column kind text not null default 'user'
  check (kind in ('user','system'));

-- After backfill, conversation_id will be required. We just wiped all
-- rows, so make it NOT NULL now to prevent future bad inserts.
alter table messages alter column conversation_id set not null;

create index messages_conversation_idx
  on messages (conversation_id, created_at desc);
create index messages_pinned_idx
  on messages (conversation_id, is_pinned) where is_pinned;

-- New messages RLS (participant-based).
create policy "messages read" on messages for select
  using (is_conversation_participant(conversation_id));

create policy "messages insert" on messages for insert
  with check (
    sender_id = auth.uid()
    and is_active_conversation_participant(conversation_id)
  );

create policy "messages update" on messages for update
  using (sender_id = auth.uid() and kind = 'user')
  with check (sender_id = auth.uid() and kind = 'user');

create policy "messages delete" on messages for delete
  using (sender_id = auth.uid() and kind = 'user');

----------------------------------------------------------------------
-- 5. Drop message_reads (per-target read tracking moves into
--    conversation_participants.last_read_at)
----------------------------------------------------------------------
drop table if exists message_reads cascade;

----------------------------------------------------------------------
-- 6. Update mention_notifications schema (board_id/dm_peer_id → conversation_id)
----------------------------------------------------------------------
alter table mention_notifications drop column if exists board_id;
alter table mention_notifications drop column if exists dm_peer_id;
alter table mention_notifications add column conversation_id uuid
  references conversations on delete cascade;

----------------------------------------------------------------------
-- 7. Recreate triggers without board_id / dm_peer_id refs
----------------------------------------------------------------------
-- entity_links recorder: now records messages with NULL source_board_id
-- (messages are no longer tied to a board). attachments still link to
-- target boards / cards / docs / urls as before.
create or replace function messages_record_entity_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  att   jsonb;
  uid   uuid;
  ws    uuid;
begin
  ws := new.workspace_id;

  delete from entity_links
  where source_kind = 'message' and source_id = new.id::text;

  if new.attachments is not null then
    for att in select * from jsonb_array_elements(new.attachments)
    loop
      if att->>'kind' = 'board' then
        insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                                  target_kind, target_board_id, target_id, created_by, context_text)
        values ('message', new.id::text, ws, null,
                'board',
                nullif(att->>'boardId','')::uuid,
                nullif(att->>'boardId','')::uuid,
                new.sender_id, new.body)
        on conflict do nothing;
      elsif att->>'kind' = 'card' then
        insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                                  target_kind, target_board_id, target_card_id, created_by, context_text)
        values ('message', new.id::text, ws, null,
                'card',
                nullif(att->>'boardId','')::uuid,
                att->>'cardId',
                new.sender_id, new.body)
        on conflict do nothing;
      elsif att->>'kind' in ('doc','docPos') then
        insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                                  target_kind, target_doc_card_id, target_page_id, target_anchor,
                                  created_by, context_text)
        values ('message', new.id::text, ws, null,
                att->>'kind',
                nullif(att->>'docCardId','')::uuid,
                att->>'pageId',
                att->'anchor',
                new.sender_id, new.body)
        on conflict do nothing;
      elsif att->>'kind' = 'url' then
        insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                                  target_kind, target_url, created_by, context_text)
        values ('message', new.id::text, ws, null,
                'url', att->>'href',
                new.sender_id, new.body)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  if new.mentions is not null then
    for uid in select unnest(new.mentions)
    loop
      insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                                target_kind, target_id, created_by, context_text)
      values ('message', new.id::text, ws, null,
              'user', uid, new.sender_id, new.body)
      on conflict do nothing;
    end loop;
  end if;

  return new;
end $$;

create trigger messages_record_entity_links_ins
  after insert on messages
  for each row execute function messages_record_entity_links();

create trigger messages_record_entity_links_upd
  after update on messages
  for each row when (old.attachments is distinct from new.attachments
                  or old.mentions    is distinct from new.mentions)
  execute function messages_record_entity_links();

-- Mention notifications: now references conversation_id directly.
create or replace function messages_fire_mention_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mentions is null or array_length(new.mentions, 1) = 0 then
    return new;
  end if;
  if new.kind = 'system' then
    return new;
  end if;
  insert into mention_notifications
    (user_id, message_id, workspace_id, conversation_id, mentioned_by)
  select t.uid, new.id, new.workspace_id, new.conversation_id, new.sender_id
  from unnest(new.mentions) as t(uid)
  where t.uid <> new.sender_id;
  return new;
end;
$$;

create trigger messages_mention_notify_trg
  after insert on messages
  for each row execute function messages_fire_mention_notifications();

-- Bump conversations.last_message_at on user-message insert so the
-- list sorts cleanly without an aggregate per fetch.
create or replace function messages_touch_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'user' then
    update conversations
       set last_message_at = new.created_at
     where id = new.conversation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation_trg on messages;
create trigger messages_touch_conversation_trg
  after insert on messages
  for each row execute function messages_touch_conversation();

----------------------------------------------------------------------
-- 8. conversation_summary view (replaces board_channel_summary + dm_thread_summary)
----------------------------------------------------------------------
create or replace view conversation_summary as
with last_msg as (
  select distinct on (conversation_id)
    conversation_id, body, sender_id, sender_email, created_at, kind
  from messages
  where deleted_at is null
  order by conversation_id, created_at desc
)
select
  c.id              as conversation_id,
  c.workspace_id,
  c.title,
  c.created_by,
  c.created_at,
  c.last_message_at,
  lm.body           as last_message_body,
  lm.sender_id      as last_message_sender_id,
  lm.sender_email   as last_message_sender_email,
  lm.kind           as last_message_kind,
  (select count(*)::int from conversation_participants
     where conversation_id = c.id and left_at is null) as active_participant_count
from conversations c
left join last_msg lm on lm.conversation_id = c.id;

----------------------------------------------------------------------
-- 9. get_unread_counts RPC (keyed by conversation_id)
----------------------------------------------------------------------
-- Returns JSON: { "<conversation_id>": N, ... } for the current user.
-- Self-sent + system messages don't count as unread.
create or replace function get_unread_counts()
returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg(conversation_id::text, cnt), '{}'::json)
  from (
    select m.conversation_id, count(*) as cnt
    from messages m
    join conversation_participants p
      on p.conversation_id = m.conversation_id
     and p.user_id = auth.uid()
    where m.deleted_at is null
      and m.kind = 'user'
      and m.sender_id <> auth.uid()
      and m.created_at > p.last_read_at
    group by m.conversation_id
  ) sub;
$$;
revoke all on function get_unread_counts() from public;
grant execute on function get_unread_counts() to authenticated;

----------------------------------------------------------------------
-- 10. find_or_create_dm RPC
----------------------------------------------------------------------
-- Looks up the DM (2-participant conversation) between auth.uid()
-- and p_peer in p_workspace; creates one if missing. Returns the
-- conversation id. SECURITY DEFINER bypasses RLS for the lookup
-- (caller doesn't have permission to see conversations they haven't
-- joined yet by name, but they're allowed to find DMs with peers
-- they share a workspace with).
create or replace function find_or_create_dm(p_workspace uuid, p_peer uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_id   uuid;
begin
  if v_me is null then
    raise exception 'must be authenticated' using errcode = '42501';
  end if;
  if v_me = p_peer then
    raise exception 'cannot DM yourself' using errcode = '22023';
  end if;
  if not is_workspace_member(p_workspace) then
    raise exception 'must be a workspace member' using errcode = '42501';
  end if;
  if not exists (
    select 1 from workspace_members
    where workspace_id = p_workspace and user_id = p_peer
  ) then
    raise exception 'peer is not a workspace member' using errcode = '42501';
  end if;

  -- Look for an existing 2-person conversation between us in this workspace.
  select c.id into v_id
  from conversations c
  where c.workspace_id = p_workspace
    and exists (select 1 from conversation_participants
                where conversation_id = c.id and user_id = v_me)
    and exists (select 1 from conversation_participants
                where conversation_id = c.id and user_id = p_peer)
    and (select count(*) from conversation_participants
         where conversation_id = c.id) = 2
  limit 1;

  if v_id is not null then
    -- Re-engage the DM: clear left_at for the caller if they'd left.
    update conversation_participants
       set left_at = null
     where conversation_id = v_id and user_id = v_me and left_at is not null;
    return v_id;
  end if;

  -- Create new.
  insert into conversations (workspace_id, created_by) values (p_workspace, v_me)
    returning id into v_id;
  insert into conversation_participants (conversation_id, user_id) values (v_id, v_me);
  insert into conversation_participants (conversation_id, user_id) values (v_id, p_peer);
  return v_id;
end;
$$;
revoke all on function find_or_create_dm(uuid, uuid) from public;
grant execute on function find_or_create_dm(uuid, uuid) to authenticated;

----------------------------------------------------------------------
-- 11. create_group_conversation RPC
----------------------------------------------------------------------
-- Creates a group chat with the given workspace members as
-- participants (auth.uid() is always added). Returns conversation id.
create or replace function create_group_conversation(
  p_workspace uuid,
  p_title text,
  p_member_ids uuid[]
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_uid uuid;
begin
  if v_me is null then
    raise exception 'must be authenticated' using errcode = '42501';
  end if;
  if not is_workspace_member(p_workspace) then
    raise exception 'must be a workspace member' using errcode = '42501';
  end if;
  -- Validate every peer is also a workspace member.
  if exists (
    select 1 from unnest(p_member_ids) m(uid)
    where not exists (select 1 from workspace_members
                      where workspace_id = p_workspace and user_id = m.uid)
  ) then
    raise exception 'all members must belong to the workspace' using errcode = '42501';
  end if;

  insert into conversations (workspace_id, title, created_by)
    values (p_workspace, nullif(trim(coalesce(p_title, '')), ''), v_me)
    returning id into v_id;

  insert into conversation_participants (conversation_id, user_id)
    values (v_id, v_me)
    on conflict do nothing;
  foreach v_uid in array p_member_ids loop
    insert into conversation_participants (conversation_id, user_id)
      values (v_id, v_uid)
      on conflict do nothing;
  end loop;

  return v_id;
end;
$$;
revoke all on function create_group_conversation(uuid, text, uuid[]) from public;
grant execute on function create_group_conversation(uuid, text, uuid[]) to authenticated;

----------------------------------------------------------------------
-- 12. Realtime broadcast policies — replace dm:* with conv:*
----------------------------------------------------------------------
drop policy if exists "realtime dm: party members"       on realtime.messages;
drop policy if exists "realtime dm: party members write" on realtime.messages;

-- conv:{conversationId} — any participant of the conversation can
-- subscribe + send broadcasts.
create policy "realtime conv: participants"
on realtime.messages
for select to authenticated
using (
  realtime.topic() like 'conv:%'
  and is_conversation_participant(
        substring(realtime.topic() from 6)::uuid
      )
);

create policy "realtime conv: participants write"
on realtime.messages
for insert to authenticated
with check (
  realtime.topic() like 'conv:%'
  and is_active_conversation_participant(
        substring(realtime.topic() from 6)::uuid
      )
);

----------------------------------------------------------------------
-- 13. Realtime publication: expose conversations + participants for
-- postgres_changes subscribers (so the panel can react to last_read_at
-- updates from other tabs/peers and to new conversations).
----------------------------------------------------------------------
do $$
begin
  perform 1
  from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations';
  if not found then
    alter publication supabase_realtime add table conversations;
  end if;
  perform 1
  from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_participants';
  if not found then
    alter publication supabase_realtime add table conversation_participants;
  end if;
end $$;
