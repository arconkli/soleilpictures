-- 0364 — security audit, part 1: the mention relay, forged alerts, two helper
-- grants, and an actor check that failed open.
--
-- The 2026-10-06 audit (after the 2026-09-20 invite blast) traced every way an
-- account can make us email someone, and every way we could fail to notice.
-- 0358 capped invites. This closes what the audit found next to them:
--
--   1. notify_comment_mention was an unbounded relay. Any reader of a board
--      could make us email every other reader up to 280 characters the caller
--      wrote, as often as they liked: no recipient cap, no rate, no dedupe, the
--      comment need not exist (comments live in the Yjs doc, so the server
--      cannot check), and p_workspace_id was taken on trust. The preview went
--      out unsanitised, links included, from our sending domain. Now:
--        - the workspace is the board's, never the caller's;
--        - a suspended account notifies nobody;
--        - at most 20 people per call and 30 notifications per sender per hour;
--        - the same person about the same thread at most once per 10 minutes.
--      The client already treats this RPC as best-effort (commentMentions.js
--      returns 0 on any error), so a capped call changes nothing visible.
--      messages_fire_mention_notifications gets the same hourly cap and
--      dedupe on top of 0360's participant filter.
--
--   2. Each mention or reply email is also capped per (recipient, sender): at
--      most 5 a day reach one inbox from one person. The in-app notification
--      is unaffected.
--
--   3. _discovery_alert decides whether an alert already fired by reading
--      client_errors, which any anonymous visitor can insert into. The alert
--      names are in this public repo, and occurred_at was client-settable, so
--      one forged row dated in the future silenced an alert forever. Clients
--      can no longer write the server-only kinds, a future occurred_at is
--      clamped to now() on insert, and the dedupe ignores rows from the future.
--
--   4. _storage_usage_apply, _storage_used_bytes, _storage_quota_bytes and
--      _image_owner were EXECUTE-able by every signed-in user (granted in 0221,
--      before the 0311 default). _storage_usage_apply writes any owner's usage
--      counter with caller-chosen deltas; the readers leak usage, quota and
--      workspace ownership. Every caller is SECURITY DEFINER, so revoking the
--      client grant breaks nothing. _board_in_workspace stays: RLS uses it.
--
--   5. _actor_active() returned true for a signed-in user with no profile row
--      (coalesce(..., true)). Every suspension check rests on it. It now fails
--      closed for a signed-in caller; with no signed-in caller (anon, service)
--      it stays true, because public reads pass through it. No user lacks a
--      profile today (checked 2026-10-06), and ensure_profile_for_new_user
--      creates one in the same transaction as the account.
--
-- Signatures are unchanged, so create or replace keeps each ACL.

begin;

-- ── 5. _actor_active fails closed for a signed-in caller ────────────────────

create or replace function public._actor_active()
returns boolean
language sql stable security definer
set search_path = public as $$
  select case
    when auth.uid() is null then true
    else coalesce((select p.banned_at is null from public.profiles p
                    where p.user_id = auth.uid()), false)
  end;
$$;

-- ── 4. Internal storage helpers are not client-callable ─────────────────────

revoke execute on function public._storage_usage_apply(uuid, bigint, bigint) from public, anon, authenticated;
revoke execute on function public._storage_used_bytes(uuid)                  from public, anon, authenticated;
revoke execute on function public._storage_quota_bytes(uuid)                 from public, anon, authenticated;
revoke execute on function public._image_owner(uuid)                         from public, anon, authenticated;

-- ── 1. The mention relay ────────────────────────────────────────────────────

create index if not exists mention_notifications_sender_recent_idx
  on public.mention_notifications (mentioned_by, created_at desc);

create or replace function public.notify_comment_mention(
  p_workspace_id uuid,
  p_board_id     uuid,
  p_card_id      text,
  p_thread_id    text,
  p_user_ids     uuid[],
  p_preview      text
)
returns integer
language plpgsql security definer
set search_path = public, auth as $$
declare
  c_max_recipients constant int := 20;
  c_max_per_hour   constant int := 30;
  v_actor  uuid := auth.uid();
  v_ws     uuid;
  v_recent int;
  v_count  int := 0;
begin
  if v_actor is null or p_board_id is null then
    return 0;
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;
  if not public._actor_active() then
    return 0;
  end if;
  if not public.can_comment_board(p_board_id) then
    return 0;
  end if;

  -- 0364: the board's own workspace, whatever the caller passed.
  select b.workspace_id into v_ws
    from public.boards b
   where b.id = p_board_id and b.deleted_at is null;
  if v_ws is null then
    return 0;
  end if;

  -- 0364: one sender's calls are serialised so the hourly count can't be raced.
  perform pg_advisory_xact_lock(hashtext('mention_budget:' || v_actor::text));
  select count(*) into v_recent
    from public.mention_notifications m
   where m.mentioned_by = v_actor
     and m.created_at > now() - interval '1 hour';
  if v_recent >= c_max_per_hour then
    return 0;
  end if;

  insert into public.mention_notifications
    (user_id, message_id, workspace_id, board_id, mentioned_by,
     source_kind, source_card_id, source_thread_id, preview)
  select r.uid, null, v_ws, p_board_id, v_actor,
         'comment', p_card_id, p_thread_id, left(coalesce(p_preview, ''), 280)
    from (
      select distinct t.uid
        from unnest(p_user_ids) as t(uid)
       where t.uid is not null
         and t.uid <> v_actor
         and public._user_can_read_board(t.uid, p_board_id)
         and not exists (
               select 1 from public.mention_notifications m
                where m.user_id = t.uid
                  and m.mentioned_by = v_actor
                  and m.board_id = p_board_id
                  and m.source_thread_id is not distinct from p_thread_id
                  and m.created_at > now() - interval '10 minutes')
       limit least(c_max_recipients, c_max_per_hour - v_recent)
    ) r;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.messages_fire_mention_notifications()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  c_max_per_hour constant int := 30;
  v_recent int;
begin
  if new.mentions is null or array_length(new.mentions, 1) = 0 then
    return new;
  end if;
  if new.kind = 'system' then
    return new;
  end if;

  -- 0364: at most 30 mention notifications per sender per hour.
  select count(*) into v_recent
    from public.mention_notifications m
   where m.mentioned_by = new.sender_id
     and m.created_at > now() - interval '1 hour';
  if v_recent >= c_max_per_hour then
    return new;
  end if;

  -- 0360: only active participants of this conversation (the only people who
  -- can read it) whom the sender can message, each once, at most 50.
  -- can_message reads auth.uid(), which the messages INSERT policy pins to
  -- new.sender_id. 0364: and the same person at most once per 10 minutes.
  insert into public.mention_notifications
    (user_id, message_id, workspace_id, conversation_id, mentioned_by)
  select r.uid, new.id, new.workspace_id, new.conversation_id, new.sender_id
    from (
      select distinct t.uid
        from unnest(new.mentions) as t(uid)
       where t.uid is not null
         and t.uid <> new.sender_id
         and exists (select 1 from public.conversation_participants cp
                      where cp.conversation_id = new.conversation_id
                        and cp.user_id = t.uid
                        and cp.left_at is null)
         and public.can_message(t.uid)
         and not exists (select 1 from public.mention_notifications m
                          where m.user_id = t.uid
                            and m.mentioned_by = new.sender_id
                            and m.conversation_id = new.conversation_id
                            and m.created_at > now() - interval '10 minutes')
       limit least(50, c_max_per_hour - v_recent)
    ) r;
  return new;
end;
$$;

-- ── 2. At most 5 mention / reply emails a day from one person to one inbox ──

create or replace function public._tg_mention_notification_email()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_recipient_email text;
  v_mentioner_name  text;
  v_message_body    text;
  v_message_preview text;
  v_board_name      text;
  v_workspace_name  text;
  v_surface         text;
  v_surface_context text;
begin
  if new.mentioned_by is null or new.mentioned_by = new.user_id then
    return new;
  end if;
  if public._is_user_online(new.user_id) then
    return new;
  end if;
  if not public._email_pref_enabled(new.user_id, 'email_mentions') then
    return new;
  end if;
  -- 0364: the in-app notification stands, but one person's mentions reach the
  -- same inbox at most 5 times a day.
  if (select count(*) from public.mention_notifications m
       where m.user_id = new.user_id
         and m.mentioned_by = new.mentioned_by
         and m.id <> new.id
         and m.created_at > now() - interval '24 hours') >= 5 then
    return new;
  end if;

  select email into v_recipient_email from auth.users where id = new.user_id;
  if v_recipient_email is null then return new; end if;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_mentioner_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.mentioned_by;

  -- A message body is readable from Postgres; a comment body is not (Yjs), so
  -- comment rows carry their own preview.
  if new.source_kind = 'comment' then
    v_message_preview := coalesce(new.preview, '');
  else
    select body into v_message_body from public.messages where id = new.message_id;
    v_message_preview := case
      when v_message_body is null then ''
      when length(v_message_body) > 140 then substring(v_message_body, 1, 140) || '…'
      else v_message_body
    end;
  end if;

  -- Surface. The previous version branched on new.dm_peer_id, a column 0058
  -- dropped — which made this block throw at runtime. DM now comes from
  -- conversation_id.
  if new.board_id is not null then
    v_surface := 'board';
    select b.name, w.name into v_board_name, v_workspace_name
    from public.boards b
    left join public.workspaces w on w.id = b.workspace_id
    where b.id = new.board_id;
    v_surface_context := coalesce(v_board_name, 'a board')
                      || coalesce(' in ' || v_workspace_name, '');
  elsif new.conversation_id is not null then
    v_surface := 'dm';
    v_surface_context := 'a direct message';
  else
    v_surface := 'workspace';
    select name into v_workspace_name from public.workspaces where id = new.workspace_id;
    v_surface_context := coalesce(v_workspace_name, 'your workspace');
  end if;

  perform public._notify_email(
    'mention_email',
    v_recipient_email,
    jsonb_build_object(
      'mentionerName',  v_mentioner_name,
      'surface',        v_surface,
      'surfaceContext', v_surface_context,
      'messagePreview', v_message_preview,
      'workspaceId',    new.workspace_id::text,
      'boardId',        new.board_id::text
    )
  );
  return new;
end;
$$;

create index if not exists comments_author_created_idx
  on public.comments (author, created_at desc);

create or replace function public._tg_comment_reply_email()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_parent_author    uuid;
  v_recipient_email  text;
  v_replier_name     text;
  v_reply_preview    text;
  v_board_name       text;
  v_workspace_name   text;
  v_workspace_id     uuid;
begin
  if new.reply_to is null or new.author is null then return new; end if;

  select author into v_parent_author from public.comments where id = new.reply_to;
  if v_parent_author is null or v_parent_author = new.author then
    return new;
  end if;

  if public._is_user_online(v_parent_author) then
    return new;
  end if;

  if not public._email_pref_enabled(v_parent_author, 'email_comment_replies') then
    return new;
  end if;

  -- 0364: one person's replies reach the same inbox at most 5 times a day.
  if (select count(*) from public.comments c
        join public.comments p on p.id = c.reply_to
       where c.author = new.author
         and p.author = v_parent_author
         and c.id <> new.id
         and c.created_at > now() - interval '24 hours') >= 5 then
    return new;
  end if;

  select email into v_recipient_email
  from auth.users where id = v_parent_author;
  if v_recipient_email is null then return new; end if;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_replier_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.author;

  v_reply_preview := case
    when new.body is null then ''
    when length(new.body) > 140 then substring(new.body, 1, 140) || '…'
    else new.body
  end;

  select b.name, w.name, b.workspace_id
  into v_board_name, v_workspace_name, v_workspace_id
  from public.boards b
  left join public.workspaces w on w.id = b.workspace_id
  where b.id = new.board_id;

  perform public._notify_email(
    'comment_reply_email',
    v_recipient_email,
    jsonb_build_object(
      'replierName',   v_replier_name,
      'boardName',     coalesce(v_board_name, 'a board'),
      'workspaceName', coalesce(v_workspace_name, 'your workspace'),
      'replyPreview',  v_reply_preview,
      'workspaceId',   v_workspace_id::text,
      'boardId',       new.board_id::text
    )
  );

  return new;
end;
$$;

-- ── 3. Clients cannot forge or future-date alert rows ───────────────────────

drop policy if exists "anyone insert client_errors" on public.client_errors;
create policy "anyone insert client_errors" on public.client_errors
  for insert to public
  with check (kind is null or kind not in ('discovery_pipeline', 'aeo_probe', 'seo_health'));

create or replace function public._tg_client_errors_clamp_time()
returns trigger
language plpgsql
set search_path = public as $$
begin
  if new.occurred_at is null or new.occurred_at > now() + interval '5 minutes' then
    new.occurred_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public._tg_client_errors_clamp_time() from public, anon, authenticated;

drop trigger if exists client_errors_clamp_time on public.client_errors;
create trigger client_errors_clamp_time
  before insert on public.client_errors
  for each row execute function public._tg_client_errors_clamp_time();

-- Rows already dated in the future can't suppress anything any more.
update public.client_errors set occurred_at = now() where occurred_at > now() + interval '5 minutes';

create or replace function public._discovery_alert(p_name text, p_message text)
returns boolean
language plpgsql security definer
set search_path = public as $$
begin
  -- 0364: only server-written rows count (clients can no longer insert this
  -- kind), and a row from the future is never "already fired".
  if exists (select 1 from public.client_errors
              where kind = 'discovery_pipeline' and name = p_name
                and occurred_at > now() - interval '20 hours'
                and occurred_at <= now() + interval '5 minutes') then
    return false;
  end if;
  insert into public.client_errors (kind, name, message, path)
  values ('discovery_pipeline', left(p_name, 120), left(p_message, 500), '/discovery-pipelines');
  return true;
end;
$$;

-- ── Proofs ───────────────────────────────────────────────────────────────────

do $$
declare
  v_fn  text;
  v_src text;
begin
  -- 4. Helpers revoked from every client role (PUBLIC included).
  foreach v_fn in array array[
    'public._storage_usage_apply(uuid,bigint,bigint)',
    'public._storage_used_bytes(uuid)',
    'public._storage_quota_bytes(uuid)',
    'public._image_owner(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0364: % is still client-executable', v_fn;
    end if;
  end loop;
  -- _board_in_workspace must stay callable: the boards UPDATE and images
  -- INSERT policies call it as the client role.
  if not has_function_privilege('authenticated', 'public._board_in_workspace(uuid,uuid)', 'execute') then
    raise exception '0364: _board_in_workspace lost its authenticated grant';
  end if;

  -- 5. _actor_active fails closed for a signed-in caller.
  select prosrc into v_src from pg_proc where oid = 'public._actor_active()'::regprocedure;
  if position('false)' in v_src) = 0 then
    raise exception '0364: _actor_active still fails open';
  end if;

  -- 1. The mention relay is capped and keeps its client grant.
  select prosrc into v_src from pg_proc
   where oid = 'public.notify_comment_mention(uuid,uuid,text,text,uuid[],text)'::regprocedure;
  if position('c_max_per_hour' in v_src) = 0 or position('_actor_active' in v_src) = 0
     or position('b.workspace_id into v_ws' in v_src) = 0 then
    raise exception '0364: notify_comment_mention is not capped';
  end if;
  if not has_function_privilege('authenticated',
       'public.notify_comment_mention(uuid,uuid,text,text,uuid[],text)', 'execute') then
    raise exception '0364: notify_comment_mention lost its authenticated grant';
  end if;
  if has_function_privilege('anon',
       'public.notify_comment_mention(uuid,uuid,text,text,uuid[],text)', 'execute') then
    raise exception '0364: notify_comment_mention is anon-executable';
  end if;

  -- 3. No client policy admits the server-only alert kinds.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'client_errors'
                    and policyname = 'anyone insert client_errors'
                    and with_check like '%discovery_pipeline%') then
    raise exception '0364: client_errors still accepts forged alert rows';
  end if;
  if exists (select 1 from public.client_errors where occurred_at > now() + interval '5 minutes') then
    raise exception '0364: future-dated client_errors rows remain';
  end if;
end $$;

commit;
