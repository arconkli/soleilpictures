-- 0020_messaging_power_features.sql — bundle of schema for the
-- messaging "power features" pass: threaded replies, pinned messages,
-- mention notifications, real unread counts, and read-by indicators.

----------------------------------------------------------------------
-- THREADED REPLIES
----------------------------------------------------------------------
alter table messages add column if not exists parent_id uuid
  references messages(id) on delete cascade;
create index if not exists messages_parent_idx
  on messages(parent_id) where parent_id is not null;

----------------------------------------------------------------------
-- PINNED MESSAGES
----------------------------------------------------------------------
alter table messages add column if not exists is_pinned boolean
  not null default false;
create index if not exists messages_pinned_idx
  on messages(board_id, is_pinned) where is_pinned;

-- toggle_pin: workspace member of the message's workspace flips
-- is_pinned. Avoids loosening the messages UPDATE policy (which is
-- sender-only) for the broader pin operation.
create or replace function toggle_pin(p_message_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_workspace uuid;
  v_pinned    boolean;
begin
  select workspace_id, is_pinned into v_workspace, v_pinned
  from messages where id = p_message_id;
  if v_workspace is null then
    raise exception 'message % not found', p_message_id using errcode = '42704';
  end if;
  if not is_workspace_member(v_workspace) then
    raise exception 'must be a workspace member to pin' using errcode = '42501';
  end if;
  update messages set is_pinned = not v_pinned where id = p_message_id;
  return not v_pinned;
end;
$$;
revoke all on function toggle_pin(uuid) from public;
grant execute on function toggle_pin(uuid) to authenticated;

----------------------------------------------------------------------
-- MENTION NOTIFICATIONS
----------------------------------------------------------------------
create table if not exists mention_notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  message_id   uuid not null references messages on delete cascade,
  workspace_id uuid not null references workspaces on delete cascade,
  board_id     uuid references boards on delete cascade,
  dm_peer_id   uuid references auth.users on delete cascade,
  mentioned_by uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  dismissed_at timestamptz
);
create index if not exists mention_notifications_user_unread_idx
  on mention_notifications(user_id) where dismissed_at is null;

alter table mention_notifications enable row level security;

create policy "mention_notifications read self" on mention_notifications
  for select using (user_id = auth.uid());
create policy "mention_notifications update self" on mention_notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "mention_notifications insert authed" on mention_notifications
  for insert to authenticated with check (auth.uid() is not null);

-- AFTER INSERT trigger on messages: fan out one notification row per
-- mentioned user, excluding the sender themselves. mentions is a
-- uuid[] populated by the client when the user picks an entity from
-- the @-mention picker.
create or replace function messages_fire_mention_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mentions is null or array_length(new.mentions, 1) = 0 then
    return new;
  end if;
  insert into mention_notifications
    (user_id, message_id, workspace_id, board_id, dm_peer_id, mentioned_by)
  select t.uid, new.id, new.workspace_id, new.board_id, new.dm_peer_id, new.sender_id
  from unnest(new.mentions) as t(uid)
  where t.uid <> new.sender_id;
  return new;
end;
$$;

drop trigger if exists messages_mention_notify_trg on messages;
create trigger messages_mention_notify_trg
  after insert on messages
  for each row execute function messages_fire_mention_notifications();

----------------------------------------------------------------------
-- UNREAD COUNTS RPC
----------------------------------------------------------------------
-- Returns a JSON object keyed `{ "b:<board_id>": N, "d:<peer_id>": N }`
-- so the channel list can render real numbers in one round trip.
-- Self-sent messages don't count as "unread".
create or replace function get_unread_counts()
returns json
language sql stable security definer set search_path = public as $$
  with my_reads as (
    select reads_board_id, reads_dm_peer, last_read_at
    from message_reads where user_id = auth.uid()
  )
  select coalesce(json_object_agg(key, cnt), '{}'::json) from (
    select 'b:' || m.board_id::text as key, count(*) as cnt
    from messages m
    left join my_reads r on r.reads_board_id = m.board_id
    where m.deleted_at is null
      and m.board_id is not null
      and m.created_at > coalesce(r.last_read_at, '1970-01-01'::timestamptz)
      and m.sender_id <> auth.uid()
    group by m.board_id
    union all
    select 'd:' || m.sender_id::text as key, count(*) as cnt
    from messages m
    left join my_reads r on r.reads_dm_peer = m.sender_id
    where m.deleted_at is null
      and m.dm_peer_id = auth.uid()
      and m.created_at > coalesce(r.last_read_at, '1970-01-01'::timestamptz)
      and m.sender_id <> auth.uid()
    group by m.sender_id
  ) sub;
$$;
revoke all on function get_unread_counts() from public;
grant execute on function get_unread_counts() to authenticated;

----------------------------------------------------------------------
-- MESSAGE_READS workspace visibility (powers read-by indicators)
----------------------------------------------------------------------
-- Original "reads own" was for-all + self-only. Split into per-op
-- policies so SELECT can include workspace co-members (so the read-by
-- avatar stack can render); INSERT/UPDATE/DELETE stay strictly self.
drop policy if exists "reads own" on message_reads;

create policy "reads read by workspace" on message_reads
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from workspace_members m1
      join workspace_members m2 on m1.workspace_id = m2.workspace_id
      where m1.user_id = auth.uid() and m2.user_id = message_reads.user_id
    )
  );
create policy "reads insert self" on message_reads
  for insert to authenticated with check (user_id = auth.uid());
create policy "reads update self" on message_reads
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "reads delete self" on message_reads
  for delete using (user_id = auth.uid());
