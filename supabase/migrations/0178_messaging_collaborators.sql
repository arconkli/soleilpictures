-- 0178_messaging_collaborators.sql
--
-- Messaging: let users search for and start conversations with the people they
-- COLLABORATE with (anyone they share a board with) plus their workspace
-- teammates — not just formal workspace_members.
--
-- Why: collaboration in this app happens via per-board shares (board_shares),
-- which never add a user to workspace_members. But find_or_create_dm /
-- create_group_conversation required the peer to be a workspace member, and the
-- New-chat picker only listed workspace_members. So for a typical user the
-- picker was empty and DMing a collaborator raised 'peer is not a workspace
-- member'. This migration widens the messageable set to co-collaborators.

----------------------------------------------------------------------
-- 1. can_message(peer): may the caller start a conversation with peer?
--    True when caller and peer share a workspace OR share a board (both
--    have direct access to the same board — via workspace membership of
--    the board's workspace, or a board_shares row on that board).
----------------------------------------------------------------------
create or replace function can_message(p_peer uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_peer is null or p_peer = auth.uid() then false
    else exists (
      -- share a workspace
      select 1
      from workspace_members me
      join workspace_members them
        on them.workspace_id = me.workspace_id
       and them.user_id = p_peer
      where me.user_id = auth.uid()
    ) or exists (
      -- share a board the caller can access and the peer can also access
      select 1
      from boards b
      where (
              exists (select 1 from workspace_members wm
                        where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid())
           or exists (select 1 from board_shares s
                        where s.board_id = b.id and s.user_id = auth.uid())
            )
        and (
              exists (select 1 from workspace_members wm2
                        where wm2.workspace_id = b.workspace_id and wm2.user_id = p_peer)
           or exists (select 1 from board_shares s2
                        where s2.board_id = b.id and s2.user_id = p_peer)
            )
    )
  end;
$$;
revoke all on function can_message(uuid) from public;
grant execute on function can_message(uuid) to authenticated;

----------------------------------------------------------------------
-- 2. list_messageable_users(workspace, query):
--    the people the caller can search for + start a conversation with =
--    workspace teammates ∪ board co-collaborators. Returns display name +
--    color from profiles when available (falls back to auth metadata /
--    email). Optional ILIKE filter on name/email.
----------------------------------------------------------------------
create or replace function list_messageable_users(p_workspace uuid, p_query text default null)
returns table(user_id uuid, email text, name text, color text)
language sql stable security definer set search_path = public as $$
  with cands as (
    -- workspace teammates (only when the caller actually belongs to p_workspace)
    select wm.user_id
    from workspace_members wm
    where wm.workspace_id = p_workspace
      and is_workspace_member(p_workspace)
    union
    -- co-collaborators: anyone who shares a board the caller can access
    select o.other_uid
    from (
      select b.id as board_id, b.workspace_id
      from boards b
      where exists (select 1 from workspace_members wm
                      where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid())
         or exists (select 1 from board_shares s
                      where s.board_id = b.id and s.user_id = auth.uid())
    ) mb
    cross join lateral (
      select wm2.user_id as other_uid from workspace_members wm2 where wm2.workspace_id = mb.workspace_id
      union
      select s2.user_id  as other_uid from board_shares s2     where s2.board_id = mb.board_id
    ) o
  )
  select
    u.id::uuid                                                                   as user_id,
    u.email::text                                                                as email,
    coalesce(nullif(pr.display_name, ''), u.raw_user_meta_data->>'full_name', u.email)::text as name,
    pr.color::text                                                               as color
  from (select distinct user_id from cands) c
  join auth.users u on u.id = c.user_id
  left join profiles pr on pr.user_id = u.id
  where c.user_id <> auth.uid()
    and (
      p_query is null or btrim(p_query) = ''
      or coalesce(pr.display_name, '')                        ilike '%' || p_query || '%'
      or coalesce(u.raw_user_meta_data->>'full_name', '')     ilike '%' || p_query || '%'
      or coalesce(u.email, '')                                ilike '%' || p_query || '%'
    )
  order by name nulls last;
$$;
revoke all on function list_messageable_users(uuid, text) from public;
grant execute on function list_messageable_users(uuid, text) to authenticated;

----------------------------------------------------------------------
-- 3. Relax find_or_create_dm: peer may be any messageable co-collaborator.
--    The existing-DM lookup is now workspace-agnostic so two personal-
--    workspace users don't create duplicate DMs when starting from
--    different active workspaces. New DMs still anchor to the caller's
--    workspace (workspace_id stays NOT NULL).
----------------------------------------------------------------------
create or replace function find_or_create_dm(p_workspace uuid, p_peer uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
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
  if not can_message(p_peer) then
    raise exception 'cannot message this user' using errcode = '42501';
  end if;

  -- Existing 2-person DM between us, in ANY workspace.
  select c.id into v_id
  from conversations c
  where exists (select 1 from conversation_participants where conversation_id = c.id and user_id = v_me)
    and exists (select 1 from conversation_participants where conversation_id = c.id and user_id = p_peer)
    and (select count(*) from conversation_participants where conversation_id = c.id) = 2
  limit 1;

  if v_id is not null then
    -- Re-engage the DM: clear left_at for the caller if they'd left.
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
revoke all on function find_or_create_dm(uuid, uuid) from public;
grant execute on function find_or_create_dm(uuid, uuid) to authenticated;

----------------------------------------------------------------------
-- 4. Relax create_group_conversation: every selected member must be a
--    messageable co-collaborator (was: workspace member).
----------------------------------------------------------------------
create or replace function create_group_conversation(
  p_workspace uuid,
  p_title text,
  p_member_ids uuid[]
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_id  uuid;
  v_uid uuid;
begin
  if v_me is null then
    raise exception 'must be authenticated' using errcode = '42501';
  end if;
  if not is_workspace_member(p_workspace) then
    raise exception 'must be a workspace member' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(p_member_ids) m(uid)
    where not can_message(m.uid)
  ) then
    raise exception 'cannot message one or more selected users' using errcode = '42501';
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
