-- 0904_send_to.sql
--
-- Send to…: right-click a card or a cluster and send it to people in
-- Messages.
--
--   * send_to_status(board, user ids, conversation ids) tells the sheet,
--     before Send, which of the people picked can't open the cluster yet and
--     whether the sender may let them in. It only looks at people the sender
--     can already message or shares one of those conversations with. A typed
--     email is never looked up before Send, so the sheet can't be used to
--     learn whether an address has an account.
--   * send_board_to(board, workspace, user ids, emails, conversation ids)
--     does what Send promises. Anyone picked who can't read the cluster gets
--     view access through share_board, nested here, so its own checks,
--     invite budget and board_shared email all still apply (auth.uid() stays
--     the sender inside it). A typed email with no account gets
--     share_board's invite. A direct conversation is found or started with
--     each person. It returns the conversations to post into; the app posts
--     the message itself, so the messages insert policy and the thread's
--     realtime broadcast stay the one path every message takes.
--     A sender who can only view the cluster can still send it: nobody gets
--     access then, and the result names who can't open it.
--     The direct conversation starts without find_or_create_dm's can_message
--     gate when the person typed an email the sender let in, or who could
--     already read the cluster: can_message counts only direct shares, so a
--     sender whose access comes through a parent cluster would otherwise be
--     refused the person the share just let in.
--   * conversation_summary gains last_message_thing and the inbox ping gains
--     thing, both { kind: card|board, title, count } for the cards or cluster
--     a message carries, so the chat list and the toast can say "Sent a card:
--     Alley, neon" instead of "sent an attachment". message_thing() builds
--     both.
--
-- conversation_summary (0058, security_invoker since 0059) and
-- messages_fanout_inbox_pings (0605) are re-emitted from the live
-- definitions; only the lines marked 0904 change.

begin;

-- ── message_thing: what a message sends, in a few words ─────────────────────

create or replace function public.message_thing(p_attachments jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  with a as (
    select x.value as v, x.ord
      from jsonb_array_elements(
             case when jsonb_typeof(p_attachments) = 'array'
                  then p_attachments else '[]'::jsonb end
           ) with ordinality as x(value, ord)
     where jsonb_typeof(x.value) = 'object'
       and x.value->>'kind' in ('card', 'board')
  )
  select jsonb_build_object(
           'kind',  f.v->>'kind',
           'title', left(coalesce(btrim(f.v->>'title'), ''), 80),
           'count', (select count(*) from a where a.v->>'kind' = 'card')
         )
    from a f
   order by f.ord
   limit 1;
$$;

-- ── internal helpers (send_board_to and send_to_status only) ────────────────

-- May the sender let people into this cluster? share_board's own gate
-- (0521): an active account, not on the waitlist, and the owner or a
-- co-owner of its workspace, or able to edit the cluster.
create or replace function public._send_to_can_grant(p_board_id uuid, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._actor_active()
     and coalesce(
           (select p.tier from public.profiles p where p.user_id = auth.uid()),
           'demo'
         ) <> 'waitlist'
     and (public.can_manage_workspace(p_workspace_id)
          or public.can_write_board(p_board_id));
$$;

-- View access for one person who has an account, through share_board. A
-- refusal (the daily invite limit, a hold on sending) answers instead of
-- undoing the whole send.
create or replace function public._send_to_grant(p_board_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    return 'error';
  end if;
  begin
    if public.share_board(p_board_id, v_email, 'viewer') = 'granted' then
      return 'granted';
    end if;
    return 'error';
  exception when others then
    return case when sqlerrm like 'invite limit reached%' then 'limit' else 'error' end;
  end;
end;
$$;

-- The direct conversation between the sender and one person, as
-- find_or_create_dm (0605) finds or starts it. Its gates are send_board_to's:
-- the person is someone the sender can message, or both can now read the
-- cluster being sent.
create or replace function public._send_to_dm(p_workspace uuid, p_peer uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null or p_peer is null or v_me = p_peer then
    raise exception 'cannot start this conversation' using errcode = '22023';
  end if;

  select c.id into v_id
  from conversations c
  where exists (select 1 from conversation_participants where conversation_id = c.id and user_id = v_me)
    and exists (select 1 from conversation_participants where conversation_id = c.id and user_id = p_peer)
    and (select count(*) from conversation_participants where conversation_id = c.id) = 2
    and not exists (select 1 from conversation_participants
                     where conversation_id = c.id and revoked_at is not null)
  limit 1;

  if v_id is not null then
    update conversation_participants
       set left_at = null
     where conversation_id = v_id and user_id = v_me and left_at is not null;
    return v_id;
  end if;

  insert into conversations (workspace_id, created_by) values (p_workspace, v_me)
    returning id into v_id;
  insert into conversation_participants (conversation_id, user_id) values (v_id, v_me);
  insert into conversation_participants (conversation_id, user_id) values (v_id, p_peer);
  return v_id;
end;
$$;

-- ── send_to_status: what the sheet says before Send ─────────────────────────

create or replace function public.send_to_status(
  p_board_id         uuid,
  p_user_ids         uuid[] default '{}',
  p_conversation_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_ws     uuid;
  v_closed uuid[];
begin
  if v_me is null then
    raise exception 'must be authenticated' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_user_ids, '{}')) > 50
     or cardinality(coalesce(p_conversation_ids, '{}')) > 50 then
    raise exception 'too many at once' using errcode = '22023';
  end if;

  select b.workspace_id into v_ws
    from public.boards b
   where b.id = p_board_id and b.deleted_at is null;
  if v_ws is null or not public.can_read_board(p_board_id) then
    raise exception 'cluster not found' using errcode = '42501';
  end if;

  -- Only people the sender can already message, or shares one of these
  -- conversations with.
  select coalesce(array_agg(distinct t.user_id), '{}') into v_closed
    from (
      select u as user_id
        from unnest(coalesce(p_user_ids, '{}')) u
       where u is not null and u <> v_me and public.can_message(u)
      union
      select p.user_id
        from public.conversation_participants p
       where p.conversation_id = any(coalesce(p_conversation_ids, '{}'))
         and public.is_active_conversation_participant(p.conversation_id)
         and p.user_id <> v_me
         and p.left_at is null
         and p.revoked_at is null
    ) t
   where not public._user_can_read_board(t.user_id, p_board_id);

  return jsonb_build_object(
    'can_grant', public._send_to_can_grant(p_board_id, v_ws),
    'closed',    to_jsonb(v_closed)
  );
end;
$$;

-- ── send_board_to: Send ─────────────────────────────────────────────────────
--
-- Returns
--   { can_grant,
--     targets:       [conversation id]   the conversations to post into,
--     people:        [{ user_id | email, conversation_id, access, why }],
--     conversations: [{ conversation_id, granted: [user id], closed: [user id],
--                        limited: [user id] (the closed ones left out by the invite limit) }
--                     | { conversation_id, refused: true }] }
-- access: had (could already open it), granted (view access now), invited
-- (an email invite; no account yet), closed (gets the message but can't open
-- it), refused (not sent). why, for closed and refused: viewer (the sender
-- can't let people in), limit (share_board refused: the daily invite limit),
-- error, not_messageable, bad_email, self.

create or replace function public.send_board_to(
  p_board_id         uuid,
  p_workspace_id     uuid,
  p_user_ids         uuid[] default '{}',
  p_emails           text[] default '{}',
  p_conversation_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_ws        uuid;
  v_can_grant boolean;
  v_users     uuid[] := array(select distinct u from unnest(coalesce(p_user_ids, '{}')) u
                               where u is not null);
  v_emails    text[] := array(select distinct lower(btrim(e)) from unnest(coalesce(p_emails, '{}')) e
                               where nullif(btrim(e), '') is not null);
  v_convs     uuid[] := array(select distinct c from unnest(coalesce(p_conversation_ids, '{}')) c
                               where c is not null);
  v_seen      uuid[] := '{}';
  v_targets   uuid[] := '{}';
  v_people    jsonb  := '[]'::jsonb;
  v_rooms     jsonb  := '[]'::jsonb;
  v_user      uuid;
  v_email     text;
  v_conv      uuid;
  v_access    text;
  v_why       text;
  v_got       text;
  v_granted   uuid[];
  v_closed    uuid[];
  v_limited   uuid[];
  -- The most people, addresses and conversations one send reaches. The sheet
  -- stops picking at the same number (SEND_MAX_PEOPLE, boards/src/lib/sendBus.js);
  -- gen-docs checks the two agree and prints it in the help.
  c_max_targets constant integer := 25;
  r           record;
begin
  if v_me is null then
    raise exception 'must be authenticated' using errcode = '42501';
  end if;
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  if cardinality(v_users) + cardinality(v_emails) + cardinality(v_convs) = 0 then
    raise exception 'nobody to send to' using errcode = '22023';
  end if;
  if cardinality(v_users) + cardinality(v_emails) + cardinality(v_convs) > c_max_targets then
    raise exception 'too many people at once' using errcode = '22023';
  end if;

  select b.workspace_id into v_ws
    from public.boards b
   where b.id = p_board_id and b.deleted_at is null;
  if v_ws is null or not public.can_read_board(p_board_id) then
    raise exception 'cluster not found' using errcode = '42501';
  end if;
  -- A new direct conversation is anchored where the sender is, and the
  -- message is posted from there, as every message is (0605).
  if not public.is_workspace_member(p_workspace_id)
     or not public.can_write_workspace(p_workspace_id) then
    raise exception 'cannot post in this workspace' using errcode = '42501';
  end if;

  v_can_grant := public._send_to_can_grant(p_board_id, v_ws);

  -- People picked from the list: someone the sender can message already.
  foreach v_user in array v_users loop
    if v_user = v_me or v_user = any(v_seen) then
      continue;
    end if;
    v_seen := v_seen || v_user;
    if not public.can_message(v_user) then
      v_people := v_people || jsonb_build_object(
        'user_id', v_user, 'access', 'refused', 'why', 'not_messageable');
      continue;
    end if;
    v_why := null;
    if public._user_can_read_board(v_user, p_board_id) then
      v_access := 'had';
    elsif v_can_grant then
      v_got := public._send_to_grant(p_board_id, v_user);
      if v_got = 'granted' then
        v_access := 'granted';
      else
        v_access := 'closed';
        v_why := v_got;
      end if;
    else
      v_access := 'closed';
      v_why := 'viewer';
    end if;
    v_conv := public._send_to_dm(p_workspace_id, v_user);
    if v_conv <> all(v_targets) then
      v_targets := v_targets || v_conv;
    end if;
    v_people := v_people || jsonb_build_object(
      'user_id', v_user, 'conversation_id', v_conv, 'access', v_access, 'why', v_why);
  end loop;

  -- Typed emails. Someone with an account the sender can neither let in nor
  -- already reach through this cluster isn't sent anything, and neither is
  -- an address with no account when the sender can't invite.
  foreach v_email in array v_emails loop
    if length(v_email) > 254
       or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_people := v_people || jsonb_build_object(
        'email', v_email, 'access', 'refused', 'why', 'bad_email');
      continue;
    end if;
    -- Looked up as share_board looks it up.
    select u.id into v_user from auth.users u where u.email = v_email;
    if v_user is not null then
      if v_user = v_me then
        v_people := v_people || jsonb_build_object(
          'email', v_email, 'access', 'refused', 'why', 'self');
        continue;
      end if;
      if v_user = any(v_seen) then
        continue;
      end if;
      v_seen := v_seen || v_user;
      if public._user_can_read_board(v_user, p_board_id) then
        v_access := 'had';
      elsif v_can_grant then
        v_got := public._send_to_grant(p_board_id, v_user);
        if v_got <> 'granted' then
          v_people := v_people || jsonb_build_object(
            'email', v_email, 'access', 'refused', 'why', v_got);
          continue;
        end if;
        v_access := 'granted';
      else
        v_people := v_people || jsonb_build_object(
          'email', v_email, 'access', 'refused', 'why', 'viewer');
        continue;
      end if;
      v_conv := public._send_to_dm(p_workspace_id, v_user);
      if v_conv <> all(v_targets) then
        v_targets := v_targets || v_conv;
      end if;
      v_people := v_people || jsonb_build_object(
        'email', v_email, 'conversation_id', v_conv, 'access', v_access, 'why', null);
    elsif not v_can_grant then
      v_people := v_people || jsonb_build_object(
        'email', v_email, 'access', 'refused', 'why', 'viewer');
    else
      begin
        perform public.share_board(p_board_id, v_email, 'viewer');
        v_people := v_people || jsonb_build_object(
          'email', v_email, 'conversation_id', null, 'access', 'invited', 'why', null);
      exception when others then
        v_people := v_people || jsonb_build_object(
          'email', v_email, 'access', 'refused',
          'why', case when sqlerrm like 'invite limit reached%' then 'limit' else 'error' end);
      end;
    end if;
  end loop;

  -- Conversations picked from Recent (direct or group): everyone else in it
  -- who can't read the cluster gets view access when the sender may give it.
  foreach v_conv in array v_convs loop
    if not public.is_active_conversation_participant(v_conv) then
      v_rooms := v_rooms || jsonb_build_object('conversation_id', v_conv, 'refused', true);
      continue;
    end if;
    v_granted := '{}';
    v_closed := '{}';
    v_limited := '{}';
    for r in
      select p.user_id
        from public.conversation_participants p
       where p.conversation_id = v_conv
         and p.user_id <> v_me
         and p.left_at is null
         and p.revoked_at is null
    loop
      if public._user_can_read_board(r.user_id, p_board_id) then
        continue;
      end if;
      v_got := case when v_can_grant then public._send_to_grant(p_board_id, r.user_id) end;
      if v_got = 'granted' then
        v_granted := v_granted || r.user_id;
      else
        v_closed := v_closed || r.user_id;
        if v_got = 'limit' then
          v_limited := v_limited || r.user_id;
        end if;
      end if;
    end loop;
    if v_conv <> all(v_targets) then
      v_targets := v_targets || v_conv;
    end if;
    v_rooms := v_rooms || jsonb_build_object(
      'conversation_id', v_conv, 'granted', to_jsonb(v_granted), 'closed', to_jsonb(v_closed),
      'limited', to_jsonb(v_limited));
  end loop;

  return jsonb_build_object(
    'can_grant',     v_can_grant,
    'targets',       to_jsonb(v_targets),
    'people',        v_people,
    'conversations', v_rooms
  );
end;
$$;

-- ── conversation_summary: the chat list's last line ─────────────────────────

create or replace view public.conversation_summary
  with (security_invoker = true) as
with last_msg as (
  select distinct on (conversation_id)
    conversation_id, body, sender_id, sender_email, created_at, kind,
    attachments                                              -- 0904
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
     where conversation_id = c.id and left_at is null) as active_participant_count,
  public.message_thing(lm.attachments) as last_message_thing  -- 0904
from conversations c
left join last_msg lm on lm.conversation_id = c.id;

-- ── messages_fanout_inbox_pings: the toast's words ──────────────────────────

CREATE OR REPLACE FUNCTION public.messages_fanout_inbox_pings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  preview text;
  payload jsonb;
  recipient record;
begin
  if new.kind = 'system' then
    return new;
  end if;

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
    'thing',           public.message_thing(new.attachments),  -- 0904
    'parent_id',       new.parent_id,
    'created_at',      new.created_at
  );

  for recipient in
    select user_id
    from conversation_participants
    where conversation_id = new.conversation_id
      and left_at is null
      and revoked_at is null
      and user_id <> new.sender_id
  loop
    perform realtime.send(
      payload,
      'inbox-ping',
      'user:' || recipient.user_id::text,
      true
    );
  end loop;

  return new;
end;
$function$;

-- ── grants (the 0311 habit) ─────────────────────────────────────────────────

-- conversation_summary is security_invoker, so whoever reads it calls this.
revoke all on function public.message_thing(jsonb) from public, anon;
grant execute on function public.message_thing(jsonb) to authenticated, service_role;

revoke all on function public.send_to_status(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.send_to_status(uuid, uuid[], uuid[]) to authenticated;

revoke all on function public.send_board_to(uuid, uuid, uuid[], text[], uuid[]) from public, anon;
grant execute on function public.send_board_to(uuid, uuid, uuid[], text[], uuid[]) to authenticated;

revoke execute on function public._send_to_can_grant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._send_to_grant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._send_to_dm(uuid, uuid) from public, anon, authenticated;

-- Send to… logs send_to with ok and code (components/SendSheet.jsx): a send
-- that went nowhere belongs in Admin, Failed actions, like msg_send. The list
-- is 0582's with send_to added; adminIssuesMigration.test.mjs reads the latest.
create or replace function public._outcome_events()
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select array['checkout_verify_result', 'editor_limit_make_room', 'files_delete', 'files_move',
               'files_put', 'folder_import', 'import_job', 'invite_link_claim_result', 'invite_sent',
               'msg_action', 'msg_send', 'scout_signup_ok', 'send_to', 'shared_file_save', 'shared_file_shortcut',
               'web_image_save', 'workspace_link_claim_result', 'workspace_link_landed']
$$;

revoke all on function public._outcome_events() from public, anon, authenticated;

-- Proofs (a REVOKE reporting success proves nothing)

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.message_thing(jsonb)',
    'public.send_to_status(uuid, uuid[], uuid[])',
    'public.send_board_to(uuid, uuid, uuid[], text[], uuid[])'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0904: % is callable signed out', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '0904: % is not callable signed in', f;
    end if;
  end loop;
  foreach f in array array[
    'public._send_to_can_grant(uuid, uuid)',
    'public._send_to_grant(uuid, uuid)',
    'public._send_to_dm(uuid, uuid)',
    'public._outcome_events()'
  ] loop
    if has_function_privilege('anon', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0904: % is callable from the app', f;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.message_thing(jsonb)', 'execute') then
    raise exception '0904: conversation_summary would fail for service_role';
  end if;
  if not exists (
    select 1 from pg_class
     where oid = 'public.conversation_summary'::regclass
       and 'security_invoker=true' = any(reloptions)
  ) then
    raise exception '0904: conversation_summary lost security_invoker';
  end if;
end $$;

commit;
