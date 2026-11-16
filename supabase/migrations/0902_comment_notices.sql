-- 0902_comment_notices.sql
--
-- Comment notices. One rule for a new comment, a reply, a mention and a resolve
-- across the three places comments live, every one a row in the bell
-- (public.notifications):
--   canvas (public.comments)   comment.new / comment.reply / comment.mention / comment.resolved
--   docs and notes (Y.Doc)     doc.new / doc.reply / doc.resolved / doc.mention   via notify_doc_comment,
--                              or notify_shared_doc_comment for a doc opened through its share
--   shared files               file.commented / file.replied        (0421 / 0422 / 0426)
-- Beside the notices, one RPC the new client needs and today's never calls:
-- edit_file_comment (an author changes the words of their shared-file comment).
--
-- ONE database serves preview and production, so this is live for today's
-- client the moment it is applied. It ships switched OFF
-- (app_config 'comment_notices' = {"on": false}): while off no trigger or RPC
-- here writes a notice that is not written today. What is live regardless of
-- the switch is listed in build/sql/README.md.
--
-- To turn on, with the release that reads these rows:
--   update public.app_config set value = '{"on": true}'::jsonb, updated_at = now()
--    where key = 'comment_notices';
--
-- Built by build.py (kept beside this file). The five replaced functions start from the text
-- that is live today (md5 of prosrc matched on 2026-11-15) and differ only at
-- the lines marked 0902:
--   _tg_comment_reply_email          from 0369
--   _tg_mention_notification_email   from 0369
--   _tg_file_comment_notify          from 0422
--   add_file_comment                 from 0426
--   resolve_file_comment             from 0421
--
-- Look before you build: nothing general-purpose here; triggers and RPCs on our
-- own tables, reusing _user_can_read_board, can_write_board, _doc_share_access, _file_share_reaches,
-- _user_banned and _actor_can_send for every access decision, _notify_email,
-- _is_user_online and _email_pref_enabled for the mention email, and
-- realtime.send as 0242 calls it. Checked the migrations for a rate-limit
-- helper (_invite_budget_take, _ai_budget_take, the API token limits): each
-- keeps its own ledger for its own thing, so the notice budgets keep one of
-- the same shape (comment_notice_ledger, _comment_notice_take).
--
-- The one transaction, and each part that alters or locks a table, starts with
-- lock_timeout = 3s: it fails fast instead of queueing comment writes behind it.
--
-- Applied in parts (apply_migration takes about 5,000 characters): each
-- "-- ==== part" line below starts one; build/sql/parts/ holds them cut and
-- wrapped, comments outside function bodies dropped.

begin;
set local lock_timeout = '3s';

-- ==== part 1: 0902_comment_notices — columns, the words rule, the switch ====
-- public.comments gains who a comment names and when its words last changed.
-- Both are filled by defaults, so today's client (which never sends them)
-- writes exactly the rows it writes now.
alter table public.comments
  add column if not exists mentions uuid[] not null default '{}',
  add column if not exists edited_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.comments'::regclass and conname = 'comments_mentions_max') then
    alter table public.comments
      add constraint comments_mentions_max check (cardinality(mentions) <= 20);
  end if;
end $$;

-- F13: only the person who wrote a comment changes its words. Resolve, hide,
-- move, delete and restore touch other columns and pass untouched. Like
-- comments_immutable (0366) it binds the API roles only: a definer RPC, the
-- service role and a SQL session run as their owner and pass. On insert it
-- clears an edited_at a client sent: that column is the database's to set.
create or replace function public._tg_comment_words_author()
returns trigger
language plpgsql
set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- A client cannot post a comment that already reads as edited.
    if current_user in ('authenticated', 'anon') then
      new.edited_at := null;
    end if;
    return new;
  end if;
  if new.body is distinct from old.body or new.mentions is distinct from old.mentions then
    if current_user in ('authenticated', 'anon')
       and (auth.uid() is null or auth.uid() is distinct from old.author) then
      raise exception 'Only the person who wrote a comment can change its words.'
        using errcode = '42501';
    end if;
  end if;
  -- edited_at is the database's to set: now when the words change, else as it was.
  new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end;
  return new;
end;
$$;
revoke all on function public._tg_comment_words_author() from public, anon, authenticated;

drop trigger if exists comments_words_author on public.comments;
create trigger comments_words_author
  before insert or update on public.comments
  for each row execute function public._tg_comment_words_author();

-- The switch. Off until the release that reads these notices is out. Reading
-- it can never raise: anything but a JSON true under "on" is off.
insert into public.app_config (key, value)
values ('comment_notices', '{"on": false}'::jsonb)
on conflict (key) do nothing;

create or replace function public._comment_notices_on()
returns boolean
language sql stable security definer
set search_path = '' as $$
  select coalesce((select c.value->'on' = 'true'::jsonb
                     from public.app_config c where c.key = 'comment_notices'), false);
$$;
revoke all on function public._comment_notices_on() from public, anon, authenticated;

-- A comment's words as one line of at most 140 characters.
create or replace function public._comment_excerpt(p_body text)
returns text
language sql immutable
set search_path = '' as $$
  select left(btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g')), 140);
$$;
revoke all on function public._comment_excerpt(text) from public, anon, authenticated;

do $proof$
declare
  v_fn text;
begin
  foreach v_fn in array array['public._tg_comment_words_author()', 'public._comment_notices_on()',
                              'public._comment_excerpt(text)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0902: % is callable by a client', v_fn;
    end if;
  end loop;
  -- Only a row this transaction inserted has to read as off, so applying
  -- this again once the switch is on raises nothing and changes nothing.
  if public._comment_notices_on() and exists (
       select 1 from public.app_config c
        where c.key = 'comment_notices' and c.xmin = pg_current_xact_id()::xid) then
    raise exception '0902: comment notices must start switched off';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.comments'::regclass
                  and t.tgname = 'comments_words_author' and t.tgenabled = 'O'
                  and pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE%') then
    raise exception '0902: comments_words_author is not on public.comments for insert and update';
  end if;
end $proof$;

-- ==== part 2: 0902_comment_notices_ledger — the fold index, the event ledger and its helper ====
-- The fold's lookup: one person's unread rows of a thread.
create index if not exists notifications_unread_thread_idx
  on public.notifications (user_id, (data->>'thread_id')) where read_at is null;

-- The budgets' ledger: one row for each event (a comment, an edit that names
-- more people, a resolve, one person told by a doc call) that was allowed to
-- tell people. It
-- bounds messages as well as rows: an event that is refused writes no row,
-- sends no realtime message and no email, and the comment still saves. Only
-- the definer functions here touch it: RLS on with no policy, no grants.
create table if not exists public.comment_notice_ledger (
  actor_id  uuid not null,
  event_key text not null,
  at        timestamptz not null default now(),
  primary key (actor_id, event_key)
);
create index if not exists comment_notice_ledger_actor_at_idx
  on public.comment_notice_ledger (actor_id, at);
alter table public.comment_notice_ledger enable row level security;
revoke all on public.comment_notice_ledger from public, anon, authenticated;

-- May this event tell people? True takes it. A key already taken within the
-- hour is false (a repeat does nothing); so is an actor at p_per_min events
-- in the last minute or p_per_hour in the last hour. Doc keys ('d:…') and
-- canvas keys ('c:', 'm:', 'r:') are counted apart, so one budget never uses
-- up the other. The actor's rows older than an hour are pruned on the way,
-- skipping any another transaction holds, so the take does not wait on them.
-- No lock here: canvas events landing together can overshoot by the few that
-- overlap. (notify_doc_comment takes its own per-caller lock before its takes.)
-- Checked _invite_budget_take, _ai_budget_take and the API token limits: each
-- keeps its own ledger for its own thing, so this is one more of that shape.
create or replace function public._comment_notice_take(
  p_actor uuid, p_key text, p_per_min integer, p_per_hour integer)
returns boolean
language plpgsql security definer
set search_path = '' as $$
declare
  v_min  integer;
  v_hour integer;
begin
  if p_actor is null or p_key is null then
    return false;
  end if;
  delete from public.comment_notice_ledger l
   where (l.actor_id, l.event_key) in (
           select x.actor_id, x.event_key from public.comment_notice_ledger x
            where x.actor_id = p_actor and x.at <= now() - interval '1 hour'
              for update skip locked);
  if exists (select 1 from public.comment_notice_ledger l
              where l.actor_id = p_actor and l.event_key = p_key
                and l.at > now() - interval '1 hour') then
    return false;
  end if;
  select count(*) filter (where l.at > now() - interval '1 minute'), count(*)
    into v_min, v_hour
    from public.comment_notice_ledger l
   where l.actor_id = p_actor and l.at > now() - interval '1 hour'
     and (l.event_key like 'd:%') = (p_key like 'd:%');
  if v_min >= p_per_min or v_hour >= p_per_hour then
    return false;
  end if;
  insert into public.comment_notice_ledger as l (actor_id, event_key, at)
  values (p_actor, p_key, now())
  on conflict (actor_id, event_key) do update set at = excluded.at
    where l.at <= now() - interval '1 hour';
  return found;
end;
$$;
revoke all on function public._comment_notice_take(uuid, text, integer, integer) from public, anon, authenticated;

do $proof$
declare
  v_fn constant text := 'public._comment_notice_take(uuid,text,integer,integer)';
  v_t  constant text := 'public.comment_notice_ledger';
begin
  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception '0902: % is callable by a client', v_fn;
  end if;
  if has_table_privilege('anon', v_t, 'select, insert, update, delete')
     or has_table_privilege('authenticated', v_t, 'select, insert, update, delete')
     or not (select c.relrowsecurity from pg_class c where c.oid = v_t::regclass)
     or exists (select 1 from pg_policy p where p.polrelid = v_t::regclass) then
    raise exception '0902: % is open to a client', v_t;
  end if;
end $proof$;

-- ==== part 3: 0902_comment_notices_notify — the one writer of a comment notice ====
-- One bell row for one person about one thread. Returns the row's id, or null
-- when nothing was written: no person, the actor themself, a banned person, a
-- cluster in the trash, or a person who can no longer read the cluster
-- (p_board null = the caller already checked reach, which is how the
-- shared-file trigger uses it).
-- A burst folds into the person's UNREAD row instead of adding a second one:
-- the row of the same kind, cluster and thread, or for comment.new the row of
-- the same cluster and actor ("Ana commented in Moodboard", data.count, the
-- latest thread and comment in data). A fold bumps created_at, and tells the
-- person's open tabs with the same realtime message an insert sends (0242's
-- notifications_broadcast: same topic, same payload, the client replaces the
-- row by id). Every fold sends it; the client decides how often to toast.
-- Nothing here waits on a lock. The fold takes its lock only if it is free
-- and its row only if nobody holds it; otherwise it writes a plain new row,
-- so two comments landing together can leave two unread rows where one would
-- do, and neither comment ever waits for the other's transaction.
-- It has no exception block of its own (a block costs a subtransaction for
-- every person told): each caller keeps its whole notify section under one
-- handler, so a notice that cannot be written is a warning there, costs that
-- comment's notices and never the comment.
create or replace function public._notify_comment(
  p_user uuid, p_kind text, p_actor uuid, p_workspace uuid, p_board uuid, p_context_board uuid,
  p_thread_id text, p_comment_id text, p_title text, p_body text, p_data jsonb)
returns bigint
language plpgsql security definer
set search_path = '' as $$
declare
  v_id   bigint;
  v_data jsonb;
  v_row  public.notifications;
begin
  if p_user is null or p_kind is null or p_thread_id is null or p_user = p_actor then
    return null;
  end if;
  if public._user_banned(p_user) then
    return null;
  end if;
  if p_board is not null and (
       exists (select 1 from public.boards b where b.id = p_board and b.deleted_at is not null)
       or not coalesce(public._user_can_read_board(p_user, p_board), false)) then
    return null;
  end if;
  v_data := coalesce(p_data, '{}'::jsonb)
            || jsonb_build_object('thread_id', p_thread_id, 'comment_id', p_comment_id);

  -- One writer at a time for what a fold keys on, when the lock is free.
  -- Never a wait: a lock or a row someone else holds means a plain new row.
  if not pg_try_advisory_xact_lock(hashtext(p_user::text ||
       case when p_kind = 'comment.new'
            then 'new:' || coalesce(p_board::text, '') || coalesce(p_actor::text, '')
            else coalesce(p_thread_id, '') end)) then
    null;
  elsif p_kind = 'comment.new' then
    select n.id into v_id
      from public.notifications n
     where n.user_id = p_user and n.read_at is null and n.kind = p_kind
       and n.board_id is not distinct from p_board and n.actor_id = p_actor
     order by n.created_at desc limit 1 for update skip locked;
  else
    select n.id into v_id
      from public.notifications n
     where n.user_id = p_user and n.read_at is null
       and n.data->>'thread_id' = p_thread_id and n.kind = p_kind
       and n.board_id is not distinct from p_board
     order by n.created_at desc limit 1 for update skip locked;
  end if;
  if v_id is not null then
    update public.notifications n
       set actor_id = p_actor, workspace_id = p_workspace, board_id = p_board,
           title = left(p_title, 200), body = p_body,
           data = n.data || v_data
                  || jsonb_build_object('count', coalesce((n.data->>'count')::integer, 1) + 1),
           created_at = now()
     where n.id = v_id
    returning n.* into v_row;
    -- realtime.send keeps its own handler: a dead socket is its warning.
    perform realtime.send(
      jsonb_build_object(
        'id', v_row.id, 'kind', v_row.kind, 'workspace_id', v_row.workspace_id,
        'board_id', v_row.board_id, 'context_board_id', v_row.context_board_id,
        'actor_id', v_row.actor_id, 'title', v_row.title, 'body', v_row.body,
        'data', v_row.data, 'created_at', v_row.created_at),
      'schedule-ping', 'user:' || v_row.user_id::text, true);
    return v_id;
  end if;

  insert into public.notifications
    (user_id, kind, actor_id, workspace_id, board_id, context_board_id, title, body, data)
  values (p_user, p_kind, p_actor, p_workspace, p_board, p_context_board,
          left(p_title, 200), p_body, v_data || jsonb_build_object('count', 1))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public._notify_comment(uuid, text, uuid, uuid, uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;

do $proof$
declare
  v_fn constant text := 'public._notify_comment(uuid,text,uuid,uuid,uuid,uuid,text,text,text,text,jsonb)';
begin
  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception '0902: % is callable by a client', v_fn;
  end if;
end $proof$;

-- ==== part 4: 0902_comment_notices_canvas_email — canvas mentions: the email for someone who is away ====
-- A canvas mention also sends the existing mention_email when the person is
-- away, under the rules the doc mention email keeps (0369's
-- _tg_mention_notification_email): not while they are online, not when they
-- turned mention emails off, and one person's canvas mentions reach the same
-- inbox at most 5 times a day, counted in emails actually sent (bell rows of
-- kind comment.mention from that person with emailed_at in the last 24
-- hours). A bell row is emailed at most once: a burst on one thread folds
-- into one unread row, and that row's one email stands for it. Only a new
-- comment emails; an edit that adds a mention is bell only. It goes through
-- _notify_email, so the sending hold and the outbound gate apply as they do to
-- every other email. Returns whether an email was handed over; never raises.
create or replace function public._comment_mention_email(
  p_notice bigint, p_user uuid, p_actor uuid, p_workspace uuid, p_board uuid,
  p_thread text, p_comment uuid, p_preview text)
returns boolean
language plpgsql security definer
set search_path = '' as $$
declare
  v_email   text;
  v_name    text;
  v_context text;
begin
  if p_notice is null or p_user is null or p_actor is null or p_user = p_actor then
    return false;
  end if;
  if public._is_user_online(p_user)
     or not public._email_pref_enabled(p_user, 'email_mentions') then
    return false;
  end if;
  -- One email a bell row, however many comments fold into it.
  if exists (select 1 from public.notifications n
              where n.id = p_notice and n.emailed_at is not null) then
    return false;
  end if;
  -- Five a day from one person to one inbox, counted in emails sent. A row's
  -- created_at is never earlier than its emailed_at, so the day bounds the scan.
  if (select count(*) from public.notifications n
       where n.user_id = p_user and n.kind = 'comment.mention' and n.actor_id = p_actor
         and n.created_at > now() - interval '24 hours'
         and n.emailed_at > now() - interval '24 hours') >= 5 then
    return false;
  end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  if v_email is null then
    return false;
  end if;
  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters') into v_name
    from auth.users u
    left join public.profiles p on p.user_id = u.id
   where u.id = p_actor;
  select coalesce(b.name, 'a board') || coalesce(' in ' || w.name, '') into v_context
    from public.boards b
    left join public.workspaces w on w.id = b.workspace_id
   where b.id = p_board;
  perform public._notify_email('mention_email', v_email, jsonb_build_object(
    'mentionerName',  coalesce(v_name, 'Someone on Clusters'),
    'surface',        'canvas',
    'surfaceContext', coalesce(v_context, 'a board'),
    'messagePreview', coalesce(p_preview, ''),
    'workspaceId',    p_workspace::text,
    'boardId',        p_board::text,
    'threadId',       p_thread,
    'commentId',      p_comment::text,
    'unsubscribeToken', (select t.token from public.email_unsub_tokens t where t.user_id = p_user)));
  update public.notifications n set emailed_at = now() where n.id = p_notice;
  return true;
exception when others then
  raise warning '_comment_mention_email failed for %: %', p_user, sqlerrm;
  return false;
end;
$$;
revoke all on function public._comment_mention_email(bigint, uuid, uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;

do $proof$
declare
  v_fn constant text := 'public._comment_mention_email(bigint,uuid,uuid,uuid,uuid,text,uuid,text)';
begin
  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception '0902: % is callable by a client', v_fn;
  end if;
end $proof$;

-- ==== part 5: 0902_comment_notices_canvas — canvas comments: new, reply, mention ====
-- A comment on the canvas tells: each person it names (comment.mention, and
-- the mention email when they are away); for a new thread, the cluster's maker
-- (comment.new); for a reply, the people already in the thread, 30 at most
-- (comment.reply). One row a person, the mention winning; never the author.
-- An edit that names more people tells only the newly named, in the bell
-- only. The thread is the top comment even when the reply answers a reply.
-- Each comment, and each edit that names more people, is one event in the
-- ledger: 20 a minute and 60 an hour for one author (resolves share them),
-- and the same event never tells twice. Past that the comment still saves
-- and tells nobody: no row, no message, no email. Nothing while the switch is
-- off, nothing for a cluster in the trash, and nothing here can fail the
-- comment: the whole body is under one handler, the only one on the way
-- (_notify_comment has none).
-- A copy is quiet: a row inserted with a created_at more than a minute old is
-- a pasted copy or an import (the client passes the original's created_at),
-- and tells nobody: no row, no message, no email, no event taken.
-- One email a person: when a reply names the author of the comment it
-- answers, today's reply email (0369) is theirs and the mention email is not
-- sent to them; their bell row is still the mention.
create or replace function public._tg_comment_notices()
returns trigger
language plpgsql security definer
set search_path = '' as $$
declare
  v_key   text := 'c:' || new.id::text;
  v_root  uuid := new.id;
  v_ids   uuid[] := new.mentions;
  v_name  text;
  v_board text;
  v_maker uuid;
  v_gone  timestamptz;
  v_par   uuid;
  v_ex    text;
  v_data  jsonb;
  v_done  uuid[] := '{}';
  v_nid   bigint;
  r       record;
begin
  if new.author is null or new.deleted_at is not null
     -- a back-dated row is a pasted copy or an import: quiet
     or (tg_op = 'INSERT' and new.created_at < now() - interval '1 minute')
     or not public._comment_notices_on() or not public._actor_can_send() then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(m.uid), '{}') into v_ids
      from unnest(new.mentions) as m(uid) where not (m.uid = any (old.mentions));
    if cardinality(v_ids) = 0 then
      return null;
    end if;
    v_key := 'm:' || new.id::text || ':'
             || md5((select string_agg(distinct m.uid::text, ',' order by m.uid::text)
                       from unnest(v_ids) as m(uid)));
  end if;
  if new.reply_to is not null then
    select coalesce(p.reply_to, p.id), p.author into v_root, v_par
      from public.comments p where p.id = new.reply_to;
    v_root := coalesce(v_root, new.reply_to);
  end if;
  select coalesce(nullif(btrim(b.name), ''), 'a cluster'), b.created_by, b.deleted_at
    into v_board, v_maker, v_gone
    from public.boards b where b.id = new.board_id;
  if not found or v_gone is not null then
    return null;
  end if;
  if not public._comment_notice_take(new.author, v_key, 20, 60) then
    return null;
  end if;
  select coalesce(nullif(btrim(p.display_name), ''), 'Someone') into v_name
    from public.profiles p where p.user_id = new.author;
  v_name := coalesce(v_name, 'Someone');
  v_ex := public._comment_excerpt(new.body);
  v_data := jsonb_build_object('board_id', new.board_id, 'anchor_kind', new.anchor_kind,
                               'anchor_id', new.anchor_id, 'excerpt', v_ex);

  for r in select distinct m.uid from unnest(v_ids) as m(uid)
            where m.uid is not null and m.uid <> new.author order by m.uid loop
    v_nid := public._notify_comment(r.uid, 'comment.mention', new.author, new.workspace_id,
      new.board_id, null, v_root::text, new.id::text,
      v_name || ' mentioned you in ' || v_board, v_ex, v_data);
    v_done := v_done || r.uid;
    -- The email is for a new comment; a mention added by an edit is bell only.
    -- The author of the comment answered gets the reply email (0369) instead.
    if v_nid is not null and tg_op = 'INSERT' and r.uid is distinct from v_par then
      perform public._comment_mention_email(v_nid, r.uid, new.author, new.workspace_id,
        new.board_id, v_root::text, new.id, v_ex);
    end if;
  end loop;
  if tg_op = 'UPDATE' then
    return null;
  end if;

  if new.reply_to is null then
    if v_maker is not null and not (v_maker = any (v_done)) then
      perform public._notify_comment(v_maker, 'comment.new', new.author, new.workspace_id,
        new.board_id, null, v_root::text, new.id::text,
        v_name || ' commented in ' || v_board, v_ex, v_data);
    end if;
  else
    for r in select distinct c.author as uid from public.comments c
              where (c.id = v_root or c.reply_to = v_root
                     or c.reply_to in (select x.id from public.comments x where x.reply_to = v_root))
                and c.id <> new.id and c.deleted_at is null and c.author is not null
                and c.author <> new.author and not (c.author = any (v_done))
              order by c.author limit 30 loop
      perform public._notify_comment(r.uid, 'comment.reply', new.author, new.workspace_id,
        new.board_id, null, v_root::text, new.id::text,
        v_name || ' replied in ' || v_board, v_ex, v_data);
    end loop;
  end if;
  return null;
exception when others then
  raise warning '_tg_comment_notices failed for comment %: %', new.id, sqlerrm;
  return null;
end;
$$;
revoke all on function public._tg_comment_notices() from public, anon, authenticated;

do $proof$
begin
  if has_function_privilege('anon', 'public._tg_comment_notices()', 'execute')
     or has_function_privilege('authenticated', 'public._tg_comment_notices()', 'execute') then
    raise exception '0902: _tg_comment_notices is callable by a client';
  end if;
end $proof$;

-- ==== part 6: 0902_comment_notices_canvas_triggers — canvas comments: the two triggers ====
-- _tg_comment_notices on public.comments: after insert, and after an update
-- of mentions that changes them on a live row. The function and its proof are
-- in part 5; its triggers are here.
drop trigger if exists comments_notices on public.comments;
create trigger comments_notices
  after insert on public.comments
  for each row execute function public._tg_comment_notices();

drop trigger if exists comments_mention_notices on public.comments;
create trigger comments_mention_notices
  after update of mentions on public.comments
  for each row
  when (new.mentions is distinct from old.mentions and new.deleted_at is null)
  execute function public._tg_comment_notices();

-- ==== part 7: 0902_comment_notices_resolved — canvas comments: resolved, and a reply reopens ====
-- Resolving a thread tells the person who started it (comment.resolved, bell
-- only). public.comments keeps `resolved boolean` (there is no resolved_at),
-- so the trigger's WHEN is false -> true on a live top-level row; a move, a
-- hide or an edit never reaches the function. Nothing when there is no
-- signed-in actor (a SQL session, the service role) or when the author
-- resolves their own thread. A resolve is an event in the canvas budget
-- (20 a minute, 60 an hour, shared with comments), keyed on the thread, so
-- resolving, reopening and resolving again within the hour tells once.
create or replace function public._tg_comment_resolved_notice()
returns trigger
language plpgsql security definer
set search_path = '' as $$
declare
  v_actor uuid;
  v_name  text;
  v_board text;
  v_ex    text;
begin
  -- read inside the body, so the handler below covers it
  v_actor := auth.uid();
  if v_actor is null or new.author is null or v_actor = new.author then
    return null;
  end if;
  if not public._comment_notices_on() or not public._actor_can_send() then
    return null;
  end if;
  if not public._comment_notice_take(v_actor, 'r:' || new.id::text, 20, 60) then
    return null;
  end if;
  select coalesce(nullif(btrim(p.display_name), ''), 'Someone') into v_name
    from public.profiles p where p.user_id = v_actor;
  v_name := coalesce(v_name, 'Someone');
  select coalesce(nullif(btrim(b.name), ''), 'a cluster') into v_board
    from public.boards b where b.id = new.board_id;
  v_board := coalesce(v_board, 'a cluster');
  v_ex := public._comment_excerpt(new.body);
  perform public._notify_comment(new.author, 'comment.resolved', v_actor, new.workspace_id,
    new.board_id, null, new.id::text, new.id::text,
    v_name || ' resolved your comment in ' || v_board, v_ex,
    jsonb_build_object('board_id', new.board_id, 'anchor_kind', new.anchor_kind,
                       'anchor_id', new.anchor_id, 'excerpt', v_ex));
  return null;
exception when others then
  raise warning '_tg_comment_resolved_notice failed for comment %: %', new.id, sqlerrm;
  return null;
end;
$$;
revoke all on function public._tg_comment_resolved_notice() from public, anon, authenticated;

drop trigger if exists comments_resolved_notice on public.comments;
create trigger comments_resolved_notice
  after update of resolved on public.comments
  for each row
  when (new.resolved and not old.resolved and new.reply_to is null and new.deleted_at is null)
  execute function public._tg_comment_resolved_notice();

do $proof$
begin
  if has_function_privilege('anon', 'public._tg_comment_resolved_notice()', 'execute')
     or has_function_privilege('authenticated', 'public._tg_comment_resolved_notice()', 'execute') then
    raise exception '0902: _tg_comment_resolved_notice is callable by a client';
  end if;
end $proof$;

-- A reply reopens its thread (C6/C20) for everyone, switch on, as shared
-- files do (part 12). The client reopens first where the person may (the
-- starter or an editor); this covers everyone else, whose own update the
-- comments policy refuses. A back-dated row (a pasted copy or an import)
-- reopens nothing, the same rule the notices use.
create or replace function public._tg_comment_reply_reopens()
returns trigger
language plpgsql security definer
set search_path = '' as $$
declare
  v_root uuid;
begin
  if new.created_at < now() - interval '1 minute' or not public._comment_notices_on() then
    return null;
  end if;
  select coalesce(p.reply_to, p.id) into v_root
    from public.comments p where p.id = new.reply_to;
  update public.comments c
     set resolved = false, hidden = false
   where c.id = coalesce(v_root, new.reply_to)
     and c.reply_to is null
     and c.deleted_at is null
     and (c.resolved or c.hidden);
  return null;
exception when others then
  raise warning '_tg_comment_reply_reopens failed for comment %: %', new.id, sqlerrm;
  return null;
end;
$$;
revoke all on function public._tg_comment_reply_reopens() from public, anon, authenticated;

drop trigger if exists comments_reply_reopens on public.comments;
create trigger comments_reply_reopens
  after insert on public.comments
  for each row
  when (new.reply_to is not null and new.deleted_at is null)
  execute function public._tg_comment_reply_reopens();

do $proof$
begin
  if has_function_privilege('anon', 'public._tg_comment_reply_reopens()', 'execute')
     or has_function_privilege('authenticated', 'public._tg_comment_reply_reopens()', 'execute') then
    raise exception '0902: _tg_comment_reply_reopens is callable by a client';
  end if;
end $proof$;

-- ==== part 8: 0902_comment_notices_reply_email — the reply email carries the comment ====
-- The canvas reply email (0369's definition, live today) with two more fields
-- in what it sends: commentId and threadId. Who is emailed, when, and the rest
-- of the payload are unchanged; the deployed template ignores fields it does
-- not read. It writes no bell row, so the new trigger's row is the only one.
-- threadId is the thread's top comment, also when the reply answers a reply.
-- It was born before 0311 with EXECUTE for authenticated; a trigger function
-- needs none, so that goes.
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
      'boardId',       new.board_id::text,
      -- 0902: which comment and thread, so the link can open it.
      'commentId',     new.id::text,
      'threadId',      (select coalesce(p.reply_to, p.id)::text
                          from public.comments p where p.id = new.reply_to),
      -- 0369: the recipient's own one-click unsubscribe.
      'unsubscribeToken', (select t.token from public.email_unsub_tokens t where t.user_id = v_parent_author)
    )
  );

  return new;
end;
$$;
revoke all on function public._tg_comment_reply_email() from public, anon, authenticated;

do $proof$
begin
  if has_function_privilege('anon', 'public._tg_comment_reply_email()', 'execute')
     or has_function_privilege('authenticated', 'public._tg_comment_reply_email()', 'execute') then
    raise exception '0902: _tg_comment_reply_email is callable by a client';
  end if;
end $proof$;

-- ==== part 9: 0902_comment_notices_mention_email — the mention email carries the card and thread ====
-- The mention email (0369's definition, live today) with the comment's card
-- and thread in what it sends. notify_comment_mention itself is not touched:
-- a doc mention's link stays at the thread (cardId + threadId), since the
-- RPC is told no comment id and its signature stays as it is. EXECUTE for
-- authenticated (pre-0311) goes, as on the reply email.
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
      'boardId',        new.board_id::text,
      -- 0902: where the comment is (null for a message mention).
      'cardId',         new.source_card_id,
      'threadId',       new.source_thread_id,
      -- 0369: the recipient's own one-click unsubscribe.
      'unsubscribeToken', (select t.token from public.email_unsub_tokens t where t.user_id = new.user_id)
    )
  );
  return new;
end;
$$;
revoke all on function public._tg_mention_notification_email() from public, anon, authenticated;

do $proof$
begin
  if has_function_privilege('anon', 'public._tg_mention_notification_email()', 'execute')
     or has_function_privilege('authenticated', 'public._tg_mention_notification_email()', 'execute') then
    raise exception '0902: _tg_mention_notification_email is callable by a client';
  end if;
end $proof$;

-- ==== part 10: 0902_comment_notices_doc — doc and note threads: who is told ====
-- Doc and note threads live in the Y.Doc, so the client says what happened.
-- This is the one place that tells people about a doc or note thread; the two
-- RPCs after it (notify_doc_comment, notify_shared_doc_comment) decide only
-- whether the caller may write that thread, then hand over to it. No client
-- runs it.
-- The caller (auth.uid()) must be in good standing. Each person told must be
-- able to read the cluster and is never the caller.
-- doc.new tells the cluster's maker, and p_recipients is then the people the
-- comment names: a maker who is named is left to the doc.mention call, so one
-- comment gives one person one notice, the mention winning as on the canvas.
-- doc.mention: the people the comment names (the client passes them; bell
-- only - the mention email still comes from notify_comment_mention). At most
-- 20 people a call.
-- The budget is in people told: each person is one event in the ledger, keyed
-- on thread, comment, kind and that person, 20 people a minute and 100 an
-- hour for one caller (counted apart from the canvas events). A person
-- already told about that comment and kind within the hour is skipped, and so
-- is everyone past the budget; the others in the same call are still told. So
-- a later call for the same comment tells only the people not yet told. A
-- person who turns out not to be told (banned, cannot read) gives the event
-- back. One caller's calls run one at a time (an advisory lock on the caller,
-- which may wait; no comment write is involved), so the count is exact.
-- 0 while the switch is off. It has no handler of its own: each RPC has the
-- one around its whole body, so a failure is a warning and 0 there.
create or replace function public._doc_comment_notify(
  p_board uuid, p_card text, p_thread text, p_comment text, p_kind text,
  p_recipients uuid[], p_excerpt text)
returns integer
language plpgsql security definer
set search_path = '' as $$
declare
  c_max_recipients constant integer := 20;
  v_actor  uuid := auth.uid();
  v_thread text := left(btrim(coalesce(p_thread, '')), 200);
  v_cid    text := left(p_comment, 200);
  v_ws     uuid;
  v_maker  uuid;
  v_board  text;
  v_name   text;
  v_ex     text;
  v_key    text;
  v_n      integer := 0;
  r        record;
begin
  if v_actor is null or p_board is null or v_thread = ''
     or p_kind is null or p_kind not in ('doc.new', 'doc.reply', 'doc.resolved', 'doc.mention') then
    return 0;
  end if;
  if not public._comment_notices_on() or not public._actor_can_send() then
    return 0;
  end if;
  select b.workspace_id, b.created_by, coalesce(nullif(btrim(b.name), ''), 'a cluster')
    into v_ws, v_maker, v_board
    from public.boards b where b.id = p_board and b.deleted_at is null;
  if v_ws is null then
    return 0;
  end if;
  v_ex := public._comment_excerpt(p_excerpt);
  select coalesce(nullif(btrim(p.display_name), ''), 'Someone') into v_name
    from public.profiles p where p.user_id = v_actor;
  v_name := coalesce(v_name, 'Someone');

  -- One call at a time for one caller, so the people budget is exact.
  perform pg_advisory_xact_lock(hashtext('doc_notice:' || v_actor::text));
  for r in select distinct t.uid
             from unnest(case when p_kind <> 'doc.new' then p_recipients
                              -- the maker, unless the comment names them
                              when v_maker = any (coalesce(p_recipients, '{}')) then '{}'::uuid[]
                              else array[v_maker] end) as t(uid)
            where t.uid is not null and t.uid <> v_actor
            order by t.uid
            limit c_max_recipients loop
    v_key := 'd:' || v_thread || ':' || coalesce(v_cid, '') || ':' || p_kind || ':' || r.uid::text;
    -- Already told, or past 20 people a minute / 100 an hour: skip this person.
    continue when not public._comment_notice_take(v_actor, v_key, 20, 100);
    if public._notify_comment(r.uid, p_kind, v_actor, v_ws, p_board, null,
         v_thread, v_cid,
         v_name || case p_kind when 'doc.new' then ' commented in '
                               when 'doc.reply' then ' replied in '
                               when 'doc.mention' then ' mentioned you in '
                               else ' resolved your comment in ' end || v_board,
         v_ex,
         jsonb_build_object('board_id', p_board, 'card_id', left(p_card, 200), 'excerpt', v_ex))
       is not null then
      v_n := v_n + 1;
    else
      -- Not told (banned, cannot read the cluster): the event goes back.
      delete from public.comment_notice_ledger l
       where l.actor_id = v_actor and l.event_key = v_key;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public._doc_comment_notify(uuid, text, text, text, text, uuid[], text)
  from public, anon, authenticated;

do $proof$
declare
  v_fn constant text := 'public._doc_comment_notify(uuid,text,text,text,text,uuid[],text)';
begin
  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception '0902: % is callable by a client', v_fn;
  end if;
end $proof$;

-- ==== part 11: 0902_comment_notices_doc_rpcs — doc and note threads: the cluster RPC and the share-token RPC ====
-- The RPC a client in the cluster calls. The caller must be signed in and able
-- to WRITE the thread: an editor of the cluster (can_write_board), or someone
-- given edit on that doc card through a doc share (0426's _doc_share_access
-- for the share on p_board + p_card, the rule the doc's room asks; the link is
-- not presented here, so edit that comes from the link alone does not count:
-- that is notify_shared_doc_comment's). Someone who can only view cannot
-- write a thread and gets 0. Everything after the gate is
-- _doc_comment_notify. 0 while the switch is off; a failure is a warning and
-- 0 under the one handler here.
create or replace function public.notify_doc_comment(
  p_board uuid, p_card text, p_thread text, p_comment text, p_kind text,
  p_recipients uuid[], p_excerpt text)
returns integer
language plpgsql security definer
set search_path = '' as $$
declare
  v_share public.file_shares;
begin
  if auth.uid() is null or p_board is null or not public._comment_notices_on() then
    return 0;
  end if;
  -- Only someone who can write the thread: a cluster editor, or a person
  -- given edit on this doc through its share.
  if not coalesce(public.can_write_board(p_board), false) then
    select s.* into v_share from public.file_shares s
     where s.board_id = p_board and s.card_id = p_card;
    if not found or public._doc_share_access(v_share, false) not in ('edit', 'manage') then
      return 0;
    end if;
  end if;
  return public._doc_comment_notify(p_board, p_card, p_thread, p_comment, p_kind, p_recipients, p_excerpt);
exception when others then
  raise warning 'notify_doc_comment failed: %', sqlerrm;
  return 0;
end;
$$;
revoke all on function public.notify_doc_comment(uuid, text, text, text, text, uuid[], text) from public, anon;
grant execute on function public.notify_doc_comment(uuid, text, text, text, text, uuid[], text)
  to authenticated, service_role;

-- The same for a doc opened on its own, through its share (/f/<token> and the
-- in-app viewer), where the client knows the share's token and not the
-- cluster. The caller must be signed in; the share is found by its token and
-- must still open (_file_share_resolve: the card and its cluster live, the
-- sharer in good standing) as a doc; p_card must be the share's own card; and
-- the share must let the caller edit that doc, the link counting because it
-- was presented (_doc_share_access(share, true), what doc_room_access asks
-- for the edit room). A stranger's token, a view-only share, a dead share,
-- another card and a signed-out caller all get nothing. Then _doc_comment_notify,
-- for the share's cluster: the same people, ledger and budgets.
-- It says nothing back: it returns 0 in every case (integer only so the
-- client is unchanged). A count would let someone editing through a link learn
-- from the answer whether a user id can read the cluster (told or not told);
-- what was written is read from notifications, not from the answer.
create or replace function public.notify_shared_doc_comment(
  p_token uuid, p_card text, p_thread text, p_comment text, p_kind text,
  p_recipients uuid[], p_excerpt text)
returns integer
language plpgsql security definer
set search_path = '' as $$
declare
  v_share public.file_shares;
  v_r     jsonb;
begin
  if auth.uid() is null or p_token is null or p_card is null
     or not public._comment_notices_on() then
    return 0;
  end if;
  select s.* into v_share from public.file_shares s where s.token = p_token;
  if not found or v_share.card_id is distinct from p_card then
    return 0;
  end if;
  v_r := public._file_share_resolve(v_share.token);
  if v_r is null or v_r->'file'->>'kind' is distinct from 'doc'
     or coalesce(public._doc_share_access(v_share, true), 'none') not in ('edit', 'manage') then
    return 0;
  end if;
  perform public._doc_comment_notify(v_share.board_id, v_share.card_id, p_thread, p_comment, p_kind,
                                     p_recipients, p_excerpt);
  return 0;
exception when others then
  raise warning 'notify_shared_doc_comment failed: %', sqlerrm;
  return 0;
end;
$$;
revoke all on function public.notify_shared_doc_comment(uuid, text, text, text, text, uuid[], text)
  from public, anon;
grant execute on function public.notify_shared_doc_comment(uuid, text, text, text, text, uuid[], text)
  to authenticated, service_role;

do $proof$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.notify_doc_comment(uuid,text,text,text,text,uuid[],text)',
    'public.notify_shared_doc_comment(uuid,text,text,text,text,uuid[],text)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0902: % must be for signed-in callers only', v_fn;
    end if;
  end loop;
end $proof$;

-- ==== part 12: 0902_comment_notices_file_notify — shared files: who a reply tells ====
-- The shared-file comment trigger (0422's definition, live today).
-- Switch off: the same people get the same rows and the same email under the
-- same 30-minute throttle; the only difference is thread_id beside comment_id
-- in data (and commentId / threadId in the email's fields).
-- Switch on (F5): a reply also tells everyone else who wrote in the thread,
-- the sharer's row for a reply says "replied" (kind file.replied), and a burst
-- on one thread folds into one unread row a person.
-- In the body, at the two "0902 (F5)" marks:
--   the sharer: a reply reads as a reply for them too, folded like the rest,
--     and the email follows the row: no row (the sharer is banned, the helper
--     failed), no email;
--   the thread: switch off, the parent's author alone, as 0422 wrote it;
--     switch on, everyone else who wrote in the thread too, 30 people at most.
-- 0422 has no handler, and the switch-off path still has none. The two
-- switch-on pieces each sit under their own, so a notice that cannot be
-- written is a warning and add_file_comment still succeeds.
-- create or replace keeps the function's grants, definer rights and search
-- path; part 13's proof checks all three (this part has no room for it).
create or replace function public._tg_file_comment_notify()
returns trigger
language plpgsql security definer
set search_path = '' as $$
declare
  v_share         public.file_shares;
  v_ci            public.card_index;
  v_file          jsonb;
  v_fname         text;
  v_author_name   text;
  v_preview       text;
  v_send          boolean;
  v_creator_email text;
  v_parent_author uuid;
  -- 0902
  v_on boolean := public._comment_notices_on();
  v_thread uuid := coalesce(new.reply_to, new.id);
  v_data jsonb; v_title text; v_nid bigint; r record;
begin
  select s.* into v_share from public.file_shares s where s.id = new.share_id;
  if not found then
    return new;
  end if;
  select ci.* into v_ci from public.card_index ci
   where ci.board_id = v_share.board_id and ci.card_id = v_share.card_id;
  if found then
    v_file := public._file_share_file(v_share.workspace_id, v_ci);
  end if;
  v_fname := coalesce(v_file->>'name', 'a file');
  select coalesce(nullif(btrim(p.display_name), ''), 'Someone') into v_author_name
    from public.profiles p where p.user_id = new.author;
  v_author_name := coalesce(v_author_name, 'Someone');
  v_preview := left(new.body, 140) || case when char_length(new.body) > 140 then '…' else '' end;
  v_data := jsonb_build_object('token', v_share.token, 'share_id', v_share.id,
    'comment_id', new.id, 'thread_id', v_thread, 'file_name', v_fname);
  v_title := left(v_author_name || ' replied on “' || v_fname || '”', 200);

  if v_share.created_by is distinct from new.author
     and public._file_share_reaches(v_share, v_share.created_by) then
    v_send := not exists (
                select 1 from public.notifications n
                 where n.user_id = v_share.created_by and n.kind in ('file.commented', 'file.replied')
                   and n.data->>'share_id' = v_share.id::text
                   and n.emailed_at > now() - interval '30 minutes')
              and public._email_pref_enabled(v_share.created_by, 'email_comment_replies')
              and not public._is_user_online(v_share.created_by);
    if v_on and new.reply_to is not null then
      -- 0902 (F5)
      begin
        v_nid := public._notify_comment(v_share.created_by, 'file.replied', new.author, null, null, null,
          v_thread::text, new.id::text, v_title, v_preview, v_data);
      exception when others then
        raise warning '_tg_file_comment_notify: %', sqlerrm;
      end;
      v_send := v_send and v_nid is not null;
      update public.notifications n set emailed_at = now() where v_send and n.id = v_nid;
    else
      insert into public.notifications (user_id, kind, actor_id, title, body, data, emailed_at)
      values (v_share.created_by, 'file.commented', new.author,
              left(v_author_name || ' commented on “' || v_fname || '”', 200),
              v_preview, v_data, case when v_send then now() end);
    end if;
    if v_send then
      select u.email into v_creator_email from auth.users u where u.id = v_share.created_by;
      perform public._notify_email('file_commented', v_creator_email, jsonb_build_object(
        'commenterName', v_author_name, 'fileName', v_fname, 'commentPreview', v_preview,
        'token', v_share.token::text,
        'commentId', new.id::text, 'threadId', v_thread::text,
        'origin', coalesce((select value #>> '{}' from public.app_config where key = 'file_share_link_origin'),
                           'https://clusters.soleilpictures.com'),
        'unsubscribeToken', (select t.token from public.email_unsub_tokens t where t.user_id = v_share.created_by)));
    end if;
  end if;

  -- 0902 (F5)
  if new.reply_to is not null and v_on then
    begin
      for r in select distinct c.author as uid from public.file_comments c
                where (c.id = new.reply_to
                       or (c.reply_to = new.reply_to and c.id <> new.id and c.deleted_at is null))
                  and c.author <> new.author and c.author is distinct from v_share.created_by
                order by c.author limit 30 loop
        continue when not public._file_share_reaches(v_share, r.uid);
        perform public._notify_comment(r.uid, 'file.replied', new.author, null, null, null,
          v_thread::text, new.id::text, v_title, v_preview, v_data);
      end loop;
    exception when others then
      raise warning '_tg_file_comment_notify: %', sqlerrm;
    end;
  elsif new.reply_to is not null then
    select c.author into v_parent_author from public.file_comments c where c.id = new.reply_to;
    if v_parent_author is not null and v_parent_author <> new.author
       and v_parent_author is distinct from v_share.created_by
       and public._file_share_reaches(v_share, v_parent_author) then
      insert into public.notifications (user_id, kind, actor_id, title, body, data)
      values (v_parent_author, 'file.replied', new.author, v_title, v_preview, v_data);
    end if;
  end if;
  return new;
end;
$$;

-- ==== part 13: 0902_comment_notices_file_rpcs — shared files: a reply reopens, authors resolve their own ====
-- add_file_comment (0426's definition, live today), same signature and result.
-- One addition (F12), behind the comment_notices switch: a reply on a resolved
-- thread reopens it, where before the reply landed inside the collapsed
-- resolved section. Switch off: exactly today's behaviour.
create or replace function public.add_file_comment(p_token uuid, p_body text, p_at_ms integer default null,
                                                   p_page integer default null, p_reply_to uuid default null)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_body      text := btrim(coalesce(p_body, ''));
  v_r         jsonb;
  v_share_id  uuid;
  v_kind      text;
  v_n_burst   integer;
  v_n_day     integer;
  v_id        uuid;
begin
  if v_uid is null then
    raise exception 'sign in to comment' using errcode = '42501';
  end if;
  if not public._actor_active() then
    raise exception 'your account cannot comment' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'a comment is 1 to 2000 characters' using errcode = '22023';
  end if;
  v_r := public._file_share_resolve(p_token);
  if v_r is null then
    raise exception 'that file is gone' using errcode = 'P0002';
  end if;
  v_kind := v_r->'file'->>'kind';
  if v_kind = 'doc' then
    raise exception 'comments on a doc are made in the doc' using errcode = '22023';
  end if;
  if coalesce(v_r->>'access', 'none') not in ('comment', 'manage') then
    raise exception 'you cannot comment on this file' using errcode = '42501';
  end if;
  v_share_id := (v_r->>'share_id')::uuid;

  perform pg_advisory_xact_lock(hashtext('file_comment:' || v_uid::text));
  select count(*) filter (where c.created_at > now() - interval '10 minutes'),
         count(*)
    into v_n_burst, v_n_day
    from public.file_comments c
   where c.author = v_uid and c.created_at > now() - interval '1 day';
  if v_n_burst >= 20 or v_n_day >= 300 then
    raise exception 'too many comments: wait a few minutes'
      using errcode = 'P0001', hint = 'comment_rate_limited';
  end if;

  if p_reply_to is not null and not exists (
       select 1 from public.file_comments c
        where c.id = p_reply_to and c.share_id = v_share_id
          and c.deleted_at is null and c.reply_to is null) then
    raise exception 'that comment is gone' using errcode = 'P0002';
  end if;

  insert into public.file_comments (share_id, author, body, at_ms, page, version_key, reply_to)
  values (v_share_id, v_uid, v_body,
          case when p_reply_to is null and v_kind in ('video', 'audio')
                    and p_at_ms between 0 and 864000000 then p_at_ms end,
          case when p_reply_to is null and v_kind = 'pdf'
                    and p_page between 1 and 100000 then p_page end,
          v_r->'file'->>'src',
          p_reply_to)
  returning id into v_id;
  -- 0902 (F12): a reply reopens a resolved thread, switch on.
  if p_reply_to is not null and public._comment_notices_on() then
    update public.file_comments c set resolved_at = null, resolved_by = null
     where c.id = p_reply_to and c.resolved_at is not null;
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

-- resolve_file_comment (0421's definition, live today), same signature. One
-- addition (F11), not behind the switch (today's client never offers it): the
-- author of a top-level comment may resolve or reopen it.
create or replace function public.resolve_file_comment(p_id uuid, p_resolved boolean)
returns void
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_c     public.file_comments;
  v_token uuid;
  v_access text;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select c.* into v_c from public.file_comments c where c.id = p_id and c.deleted_at is null;
  if not found then
    raise exception 'that comment is gone' using errcode = 'P0002';
  end if;
  select s.token into v_token from public.file_shares s where s.id = v_c.share_id;
  v_access := coalesce(public._file_share_resolve(v_token)->>'access', 'none');
  -- 0902 (F11): or its author, if they can still comment.
  if v_access <> 'manage' and not (v_c.author = v_uid and v_access = 'comment') then
    raise exception 'only its author or people who can edit the cluster resolve comments' using errcode = '42501';
  end if;
  if v_c.reply_to is not null then
    raise exception 'only a top-level comment can be resolved' using errcode = '22023';
  end if;
  update public.file_comments c
     set resolved_at = case when coalesce(p_resolved, false) then now() end,
         resolved_by = case when coalesce(p_resolved, false) then v_uid end
   where c.id = p_id;
end;
$$;

do $proof$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.add_file_comment(uuid,text,integer,integer,uuid)',
    'public.resolve_file_comment(uuid,boolean)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute')
       or not (select p.prosecdef and 'search_path=""' = any (p.proconfig)
                 from pg_proc p where p.oid = v_fn::regprocedure) then
      raise exception '0902: % is not a signed-in-only definer RPC', v_fn;
    end if;
  end loop;
end $proof$;

-- ==== part 14: 0902_comment_notices_file_edit — shared files: an author edits their own comment ====
-- The author of a shared-file comment changes its words (the new client calls
-- this; today's never does). The checks and their wording are add_file_comment's
-- (0426) and the 0421 resolve / delete RPCs': signed in, an account in good
-- standing, 1 to 2000 characters after trimming, a comment that is still
-- there, its author, and a file the caller can still comment on (doc shares
-- refuse, as they do for a new comment). The body is stored trimmed, as
-- add_file_comment stores it; edited_at is set when the words change (saving
-- the same words is not an edit). No notice, and not behind the switch.
create or replace function public.edit_file_comment(p_id uuid, p_body text)
returns void
language plpgsql security definer
set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_body  text := btrim(coalesce(p_body, ''));
  v_c     public.file_comments;
  v_token uuid;
  v_r     jsonb;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if not public._actor_active() then
    raise exception 'your account cannot comment' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'a comment is 1 to 2000 characters' using errcode = '22023';
  end if;
  select c.* into v_c from public.file_comments c where c.id = p_id and c.deleted_at is null;
  if not found then
    raise exception 'that comment is gone' using errcode = 'P0002';
  end if;
  if v_c.author is distinct from v_uid then
    raise exception 'only the person who wrote a comment can change its words' using errcode = '42501';
  end if;
  select s.token into v_token from public.file_shares s where s.id = v_c.share_id;
  v_r := public._file_share_resolve(v_token);
  if v_r is null then
    raise exception 'that file is gone' using errcode = 'P0002';
  end if;
  if v_r->'file'->>'kind' = 'doc' then
    raise exception 'comments on a doc are made in the doc' using errcode = '22023';
  end if;
  if coalesce(v_r->>'access', 'none') not in ('comment', 'manage') then
    raise exception 'you cannot comment on this file' using errcode = '42501';
  end if;
  update public.file_comments c set body = v_body, edited_at = now()
   where c.id = p_id and c.deleted_at is null and c.body is distinct from v_body;
end;
$$;
revoke all on function public.edit_file_comment(uuid, text) from public, anon;
grant execute on function public.edit_file_comment(uuid, text) to authenticated;

do $proof$
declare
  v_fn constant text := 'public.edit_file_comment(uuid,text)';
  v_tg constant text := 'public._tg_file_comment_notify()';
begin
  if has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute')
     or not (select p.prosecdef and 'search_path=""' = any (p.proconfig)
               from pg_proc p where p.oid = v_fn::regprocedure) then
    raise exception '0902: % is not a signed-in-only definer RPC', v_fn;
  end if;
  -- part 12's trigger function, proved here
  if has_function_privilege('anon', v_tg, 'execute')
     or has_function_privilege('authenticated', v_tg, 'execute')
     or not (select p.prosecdef and 'search_path=""' = any (p.proconfig)
               from pg_proc p where p.oid = v_tg::regprocedure) then
    raise exception '0902: % is open to a client or is not a definer', v_tg;
  end if;
end $proof$;

-- ==== part 15: 0902_comment_notices_proof — the proof: every function ====
-- The 0311 habit: every function this migration creates or replaces, proved.
do $proof$
declare
  v_fn   text;
  v_role text;
begin
  -- Helpers and trigger functions: no client runs them.
  foreach v_fn in array array[
    'public._tg_comment_words_author()', 'public._comment_notices_on()', 'public._comment_excerpt(text)',
    'public._comment_notice_take(uuid,text,integer,integer)',
    'public._notify_comment(uuid,text,uuid,uuid,uuid,uuid,text,text,text,text,jsonb)',
    'public._comment_mention_email(bigint,uuid,uuid,uuid,uuid,text,uuid,text)',
    'public._tg_comment_notices()', 'public._tg_comment_resolved_notice()', 'public._tg_comment_reply_reopens()',
    'public._tg_comment_reply_email()', 'public._tg_mention_notification_email()',
    'public._doc_comment_notify(uuid,text,text,text,text,uuid[],text)',
    'public._tg_file_comment_notify()'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0902: % is callable by a client', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0902: service_role cannot run %', v_fn;
    end if;
  end loop;
  -- RPCs: signed-in callers only (create or replace kept the two file ACLs).
  foreach v_fn in array array[
    'public.notify_doc_comment(uuid,text,text,text,text,uuid[],text)',
    'public.notify_shared_doc_comment(uuid,text,text,text,text,uuid[],text)',
    'public.add_file_comment(uuid,text,integer,integer,uuid)',
    'public.resolve_file_comment(uuid,boolean)', 'public.edit_file_comment(uuid,text)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0902: % must be for signed-in callers only', v_fn;
    end if;
  end loop;
  -- Definer rights and an empty search_path on everything that writes notices.
  foreach v_fn in array array[
    'public._comment_notices_on()', 'public._comment_notice_take(uuid,text,integer,integer)',
    'public._notify_comment(uuid,text,uuid,uuid,uuid,uuid,text,text,text,text,jsonb)',
    'public._comment_mention_email(bigint,uuid,uuid,uuid,uuid,text,uuid,text)',
    'public._tg_comment_notices()', 'public._tg_comment_resolved_notice()', 'public._tg_comment_reply_reopens()',
    'public._doc_comment_notify(uuid,text,text,text,text,uuid[],text)',
    'public.notify_doc_comment(uuid,text,text,text,text,uuid[],text)',
    'public.notify_shared_doc_comment(uuid,text,text,text,text,uuid[],text)',
    'public._tg_file_comment_notify()', 'public.add_file_comment(uuid,text,integer,integer,uuid)',
    'public.resolve_file_comment(uuid,boolean)', 'public.edit_file_comment(uuid,text)'] loop
    if not (select p.prosecdef and 'search_path=""' = any (p.proconfig)
              from pg_proc p where p.oid = v_fn::regprocedure) then
      raise exception '0902: % lost its definer rights or its search_path', v_fn;
    end if;
  end loop;
end $proof$;

-- ==== part 16: 0902_comment_notices_proof_rest — the proof: the ledger, the words rule, the triggers ====
-- The rest of the proof: the ledger, the words rule, the email fields and the
-- triggers. (That it ships switched off is proved in part 1, in the
-- transaction that inserts the switch row; here it could never fire.)
do $proof$
begin
  -- The ledger is the definer functions' alone: RLS on, no policy, no grant.
  if has_table_privilege('anon', 'public.comment_notice_ledger', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.comment_notice_ledger', 'select, insert, update, delete')
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.comment_notice_ledger'::regclass)
     or exists (select 1 from pg_policy p where p.polrelid = 'public.comment_notice_ledger'::regclass) then
    raise exception '0902: comment_notice_ledger is open to a client';
  end if;
  -- The words rule reads the caller's role, so it must NOT be a definer.
  if (select p.prosecdef from pg_proc p
       where p.oid = 'public._tg_comment_words_author()'::regprocedure) then
    raise exception '0902: _tg_comment_words_author must run as the caller';
  end if;
  -- The two email triggers kept their rights and gained their fields.
  if position('commentId' in (select prosrc from pg_proc
        where oid = 'public._tg_comment_reply_email()'::regprocedure)) = 0
     or position('threadId' in (select prosrc from pg_proc
        where oid = 'public._tg_mention_notification_email()'::regprocedure)) = 0 then
    raise exception '0902: an email trigger does not send the comment it is about';
  end if;
  -- The five triggers are on, each on its function; the words rule also on insert.
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.comments'::regclass and t.tgenabled = 'O'
         and (t.tgname, t.tgfoid) in (
              ('comments_words_author', 'public._tg_comment_words_author()'::regprocedure::oid),
              ('comments_notices', 'public._tg_comment_notices()'::regprocedure::oid),
              ('comments_mention_notices', 'public._tg_comment_notices()'::regprocedure::oid),
              ('comments_resolved_notice', 'public._tg_comment_resolved_notice()'::regprocedure::oid),
              ('comments_reply_reopens', 'public._tg_comment_reply_reopens()'::regprocedure::oid))) <> 5
     or not exists (select 1 from pg_trigger t
                     where t.tgrelid = 'public.comments'::regclass and t.tgname = 'comments_words_author'
                       and pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE%') then
    raise exception '0902: a comments trigger is missing or off';
  end if;
end $proof$;

notify pgrst, 'reload schema';

commit;
