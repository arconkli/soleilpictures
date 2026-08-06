-- 0207_comment_mention_notifications.sql — @-mentions inside inline comment
-- threads (docs + notes) reuse the existing mention_notifications pipeline,
-- and the mention-email trigger is repaired along the way.
--
-- Background. Inline comment threads live in Yjs (docState's `docComments`),
-- anchored by a CommentMark inside the Y.XmlFragment so ranges survive
-- concurrent edits. Yjs only reaches peers who currently have the board open,
-- so an @-mention needs exactly one server touch to reach someone who's away.
-- Rather than a parallel notification table, we widen mention_notifications:
--   • hooks/useMentionNotifications.js already fetches + realtime-subscribes to
--     it, so the in-app surface needs no client change;
--   • the AFTER INSERT trigger from 0075 already sends `mention_email`, gated on
--     _is_user_online() and the per-user `email_mentions` preference.
--
-- ── BUG REPAIR (pre-existing, unrelated to comments) ────────────────────────
-- 0058 dropped mention_notifications.board_id and .dm_peer_id (conversations
-- replaced board chat / DM peers), but _tg_mention_notification_email was never
-- updated and still reads new.dm_peer_id / new.board_id. plpgsql resolves record
-- fields at RUNTIME, so that surface-selection block raises
--   record "new" has no field "dm_peer_id"
-- as soon as it's reached — inside the same transaction as the messages INSERT
-- that fanned the row out. mention_notifications currently has zero rows for its
-- whole lifetime, consistent with that path never having completed. The rewrite
-- below drops the dead dm_peer_id reference and derives the DM surface from
-- conversation_id, which is the column 0058 actually introduced.

-- ── Schema ───────────────────────────────────────────────────────────────────
-- message_id becomes nullable: a comment mention has no message behind it.
alter table public.mention_notifications
  alter column message_id drop not null;

alter table public.mention_notifications
  add column if not exists source_kind      text not null default 'message',
  -- Re-introduced (0058 dropped it with board chat). A comment mention needs to
  -- say WHICH board so the email can deep-link there; the email template's
  -- surface='board' branch already builds that link.
  add column if not exists board_id         uuid references public.boards on delete cascade,
  add column if not exists source_card_id   text,   -- doc/note card id (canvas card ids are text)
  add column if not exists source_thread_id text,   -- docComments thread id ('cm_…')
  -- Comment bodies live in Yjs, which Postgres cannot read — so the email
  -- preview has to be carried on the row itself.
  add column if not exists preview          text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mention_notifications_source_kind_chk'
      and conrelid = 'public.mention_notifications'::regclass
  ) then
    alter table public.mention_notifications
      add constraint mention_notifications_source_kind_chk
      check (source_kind in ('message', 'comment'));
  end if;
  -- Keep the original invariant for message rows now that the NOT NULL is gone.
  if not exists (
    select 1 from pg_constraint
    where conname = 'mention_notifications_message_ref_chk'
      and conrelid = 'public.mention_notifications'::regclass
  ) then
    alter table public.mention_notifications
      add constraint mention_notifications_message_ref_chk
      check (source_kind <> 'message' or message_id is not null);
  end if;
end $$;

-- ── Can an ARBITRARY user read a board? ─────────────────────────────────────
-- can_read_board() answers only for auth.uid(), but notifying someone requires
-- checking the RECIPIENT's access. Same recursive parent-board walk, same two
-- grant paths (workspace membership OR a direct board share), parameterized.
create or replace function public._user_can_read_board(p_user_id uuid, p_board_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  with recursive chain as (
    select id, workspace_id, parent_board_id
    from boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id
    from boards b join chain c on b.id = c.parent_board_id
  )
  select exists (
    select 1 from chain
    where exists (
        select 1 from workspace_members m
        where m.workspace_id = chain.workspace_id and m.user_id = p_user_id
      )
       or exists (
        select 1 from board_shares s
        where s.board_id = chain.id and s.user_id = p_user_id
      )
  );
$$;
revoke all on function public._user_can_read_board(uuid, uuid) from public;

-- ── Write path ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER, never a direct client insert: the table's insert policy is
-- `auth.uid() is not null`, i.e. anyone could notify anyone. Here the CALLER
-- must be able to read the board, and each recipient is filtered to those who
-- can read it too — you cannot use a mention to ping a stranger, and you cannot
-- leak a comment preview to someone who has no access to the board it's on.
create or replace function public.notify_comment_mention(
  p_workspace_id uuid,
  p_board_id     uuid,
  p_card_id      text,
  p_thread_id    text,
  p_user_ids     uuid[],
  p_preview      text
) returns integer
language plpgsql security definer set search_path = public, auth as $$
declare
  v_actor uuid := auth.uid();
  v_count int  := 0;
begin
  if v_actor is null or p_board_id is null or p_workspace_id is null then
    return 0;
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;
  -- Caller must actually be on this board.
  if not public.can_read_board(p_board_id) then
    return 0;
  end if;

  insert into public.mention_notifications
    (user_id, message_id, workspace_id, board_id, mentioned_by,
     source_kind, source_card_id, source_thread_id, preview)
  select distinct t.uid, null, p_workspace_id, p_board_id, v_actor,
         'comment', p_card_id, p_thread_id, left(coalesce(p_preview, ''), 280)
  from unnest(p_user_ids) as t(uid)
  where t.uid is not null
    and t.uid <> v_actor                                   -- never self-notify
    and public._user_can_read_board(t.uid, p_board_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.notify_comment_mention(uuid, uuid, text, text, uuid[], text) from public;
grant execute on function public.notify_comment_mention(uuid, uuid, text, text, uuid[], text) to authenticated;
-- NOTE: revoking from PUBLIC does NOT drop the anon grant Supabase's default
-- privileges attach on create. 0208 revokes it explicitly — apply both.

-- ── Email trigger: repaired + comment-aware ─────────────────────────────────
create or replace function public._tg_mention_notification_email()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
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

  select email into v_recipient_email
  from auth.users where id = new.user_id;
  if v_recipient_email is null then return new; end if;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_mentioner_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.mentioned_by;

  -- Preview. A message body is readable from Postgres; a comment body is not
  -- (it lives in the Yjs snapshot), so comment rows carry their own preview.
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

  -- Surface. NOTE: the previous version branched on new.dm_peer_id, a column
  -- 0058 dropped — which made this block throw at runtime. DM is now derived
  -- from conversation_id (the column 0058 actually added).
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

drop trigger if exists mention_email_trigger on public.mention_notifications;
create trigger mention_email_trigger
  after insert on public.mention_notifications
  for each row execute function public._tg_mention_notification_email();

