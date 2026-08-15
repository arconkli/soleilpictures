-- 0239_notifications.sql — a notification that survives the tab being closed.
--
-- Background. The app has two tables with "notification" in the name and
-- neither is one:
--
--   share_notifications   (0016, widened 0171/0189)
--   mention_notifications (0020, reshaped 0058, widened 0207)
--
-- Both are TOAST QUEUES. hooks/useShareNotifications.js and
-- hooks/useMentionNotifications.js fetch on mount, render a toast, and then
-- batch-dismiss the rows ~8s later, so a notification you were not present to
-- see is a notification you see exactly once and can never find again. There
-- is no unread state, no history, no aggregation, and no bell to hang them on.
--
-- A crew member who missed the call-sheet toast at 21:40 needs to still find it
-- at 06:00. That is a different data model, not a bigger toast, so this is a
-- new table rather than a third widening of share_notifications: that table's
-- AFTER INSERT trigger fires board-access emails and its consumer auto-
-- dismisses, and fighting both to borrow the row shape is worse than a clean
-- table.
--
-- It is deliberately GENERIC (kind + data jsonb) so the next notification kind
-- lands here instead of becoming a fourth table. Folding the existing two in is
-- a follow-up and explicitly not part of this change.

create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Dotted namespace: 'schedule.published' | 'schedule.moved' | 'schedule.cancelled'.
  kind text not null,
  workspace_id     uuid references public.workspaces(id) on delete cascade,
  -- The subject — for a schedule notification, the shoot-day cluster.
  board_id         uuid references public.boards(id) on delete cascade,
  -- Where the subject lives — the production holding the calendar. set null on
  -- delete rather than cascade: losing the production shouldn't retroactively
  -- erase the crew's record of a day that did happen.
  context_board_id uuid references public.boards(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  title text not null,
  body  text,
  data  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  emailed_at  timestamptz
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id) where read_at is null;
-- Coalescing lookups ("did we already tell this crew about this day?").
create index if not exists notifications_board_kind_idx
  on public.notifications (board_id, kind, created_at desc);

alter table public.notifications enable row level security;

-- Read your own. Nothing else — no INSERT policy at all, so rows can only
-- arrive through the SECURITY DEFINER fanout below or the service role. The
-- insert policy on mention_notifications is `auth.uid() is not null`, i.e.
-- anyone could notify anyone; that mistake is not repeated here.
drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- Read state moves through mark_notifications_read() only, so there is no
-- UPDATE grant to abuse and no way to forge created_at/kind/data on a row you
-- own. revoke-then-grant because Supabase's default privileges are permissive.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
revoke all on sequence public.notifications_id_seq from anon, authenticated;

-- Live badge without a poll.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ── Broadcast ────────────────────────────────────────────────────────────────
-- Every inserted row pushes to the recipient's own topic. `user:{uid}` already
-- exists with the right RLS (0081: substring(topic from 6)::uuid = auth.uid()),
-- and useInboxLive is already mounted app-wide against it — so this needs no
-- new policy and no new socket, just a new event name alongside 'inbox-ping'.
--
-- A trigger rather than a line inside each fanout: broadcasting is not optional
-- and should not be something a future caller can forget.
create or replace function public.notifications_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id',               new.id,
      'kind',             new.kind,
      'workspace_id',     new.workspace_id,
      'board_id',         new.board_id,
      'context_board_id', new.context_board_id,
      'actor_id',         new.actor_id,
      'title',            new.title,
      'body',             new.body,
      'data',             new.data,
      'created_at',       new.created_at
    ),
    'schedule-ping',
    'user:' || new.user_id::text,
    true   -- private: authenticated subscriber + RLS pass
  );
  return new;
exception when others then
  -- A dead socket must never roll back the notification itself; the row is the
  -- durable record and the client reconciles on next fetch.
  raise warning 'notifications_broadcast failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists notifications_broadcast_trg on public.notifications;
create trigger notifications_broadcast_trg
  after insert on public.notifications
  for each row execute function public.notifications_broadcast();

-- ── Fanout ───────────────────────────────────────────────────────────────────
-- Internal. Callers are the schedule RPCs in 0240; each is responsible for
-- authorising the ACTOR before calling. This function authorises the
-- RECIPIENTS: p_user_ids is intersected with _board_readers(), so a caller that
-- passes a stranger's id cannot use it to deliver them a title and body.
create or replace function public._notify_users(
  p_user_ids        uuid[],
  p_kind            text,
  p_board_id        uuid,
  p_context_board_id uuid,
  p_workspace_id    uuid,
  p_actor_id        uuid,
  p_title           text,
  p_body            text,
  p_data            jsonb default '{}'::jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  -- A crew is O(100). The cap is a runaway guard, not a product limit; if a
  -- real production ever trips it we want a log line, not silent truncation.
  v_max   int := 2000;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then return 0; end if;
  if array_length(p_user_ids, 1) > v_max then
    raise warning '_notify_users: % recipients exceeds cap % for board %; truncating',
      array_length(p_user_ids, 1), v_max, p_board_id;
  end if;

  insert into public.notifications
    (user_id, kind, workspace_id, board_id, context_board_id, actor_id, title, body, data)
  with readers as materialized (
    select public._board_readers(p_board_id) as uid
  ),
  targets as (
    select distinct t.uid
    from unnest(p_user_ids) as t(uid)
    where t.uid is not null
      and t.uid is distinct from p_actor_id              -- never self-notify
      and t.uid in (select uid from readers)
    order by 1                                           -- deterministic if truncated
    limit v_max
  )
  select uid, p_kind, p_workspace_id, p_board_id, p_context_board_id,
         p_actor_id, p_title, p_body, coalesce(p_data, '{}'::jsonb)
  from targets;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public._notify_users(uuid[], text, uuid, uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;

-- ── Client reads ─────────────────────────────────────────────────────────────
create or replace function public.unread_notification_count() returns integer
language sql stable security invoker set search_path = public as $$
  select count(*)::int from public.notifications
   where user_id = auth.uid() and read_at is null;
$$;
grant execute on function public.unread_notification_count() to authenticated;

-- NULL p_ids = mark everything read (the bell's "mark all read").
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns integer
language plpgsql security definer set search_path = public, auth as $$
declare v_count int := 0; v_user uuid := auth.uid();
begin
  if v_user is null then return 0; end if;
  update public.notifications
     set read_at = now()
   where user_id = v_user            -- scoped to the caller, always
     and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_notifications_read(bigint[]) from public, anon;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;

comment on table public.notifications is
  'Persistent, per-user notifications with unread state. Unlike share_notifications / mention_notifications (toast queues that self-dismiss), rows here survive until the user reads them. Insert only via _notify_users() or the service role.';
