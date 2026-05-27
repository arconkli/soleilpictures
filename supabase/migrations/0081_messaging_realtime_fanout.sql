-- 0081 — live inbox updates: per-user broadcast for incoming messages,
-- and put mention_notifications into the realtime publication.
--
-- Background:
-- The `conv:{id}` broadcast channel (0058) only fires for participants
-- who already have that thread open. So a peer sending you a DM while
-- your inbox is on the list view (or you're on a different conversation)
-- never delivers anything to the client — the inbox list, unread badge,
-- and toast hosts all sit silent until a manual refresh.
--
-- Fix: a per-user broadcast topic `user:{uid}` that the server fans out
-- to from a trigger on `messages` INSERT. Each active participant
-- (except the sender) receives an `inbox-ping` payload carrying enough
-- to render a toast without a follow-up fetch (sender id, body preview,
-- mentions[]). The open-thread `conv:{id}` channel is unchanged.
--
-- Also adds `mention_notifications` to the realtime publication so the
-- mention badge updates without a polling refresh.

----------------------------------------------------------------------
-- 1. realtime.messages SELECT policy for user:{uid} topics
----------------------------------------------------------------------
-- Each user can subscribe to their OWN per-user topic and no one
-- else's. The trigger runs SECURITY DEFINER and uses realtime.send()
-- which bypasses RLS, so we don't need an INSERT policy here.
drop policy if exists "realtime user: self" on realtime.messages;
create policy "realtime user: self"
on realtime.messages
for select to authenticated
using (
  realtime.topic() like 'user:%'
  and substring(realtime.topic() from 6)::uuid = auth.uid()
);

----------------------------------------------------------------------
-- 2. Fanout trigger — broadcast inbox-ping to each active participant
----------------------------------------------------------------------
-- Single payload shape covers both plain messages and @mentions; the
-- client checks `payload.mentions` and styles accordingly.
--
-- We skip:
--   - system messages (kind='system' — channel announcements, etc)
--   - the sender (no self-pings)
--   - participants who've left (left_at not null)
create or replace function messages_fanout_inbox_pings() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  preview text;
  payload jsonb;
  recipient record;
begin
  if new.kind = 'system' then
    return new;
  end if;

  -- 140-char body preview; collapse newlines so the toast stays one line.
  preview := substring(regexp_replace(coalesce(new.body, ''), E'\\s+', ' ', 'g') from 1 for 140);

  payload := jsonb_build_object(
    'conversation_id', new.conversation_id,
    'message_id',      new.id,
    'sender_id',       new.sender_id,
    'sender_email',    new.sender_email,
    'workspace_id',    new.workspace_id,
    'body_preview',    preview,
    'mentions',        coalesce(to_jsonb(new.mentions), '[]'::jsonb),
    'has_attachments', (jsonb_array_length(coalesce(new.attachments, '[]'::jsonb)) > 0),
    'parent_id',       new.parent_id,
    'created_at',      new.created_at
  );

  for recipient in
    select user_id
    from conversation_participants
    where conversation_id = new.conversation_id
      and left_at is null
      and user_id <> new.sender_id
  loop
    perform realtime.send(
      payload,
      'inbox-ping',
      'user:' || recipient.user_id::text,
      true  -- private: requires authenticated subscriber + RLS pass
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists messages_fanout_inbox_pings_trg on messages;
create trigger messages_fanout_inbox_pings_trg
  after insert on messages
  for each row execute function messages_fanout_inbox_pings();

----------------------------------------------------------------------
-- 3. Put mention_notifications into the realtime publication
----------------------------------------------------------------------
-- Mirrors the pattern used at 0058:526-540 for conversations +
-- conversation_participants. Lets the client subscribe via
-- postgres_changes on (user_id=eq.me) for live mention-badge updates.
do $$
begin
  perform 1
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'mention_notifications';
  if not found then
    alter publication supabase_realtime add table mention_notifications;
  end if;
end $$;
