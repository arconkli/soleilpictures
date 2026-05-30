-- 0083_demo_strict_writes.sql — lock demo tier out of writes on workspaces
-- they didn't create.
--
-- Before this migration:
--   • can_write_board (from 0065) treated any workspace member as a writer
--     for the demo tier. That meant a paid workspace owner could add a
--     demo user to workspace_members and the demo user could write to the
--     owner's boards — contradicting the 0065 comment that promised
--     "workspace they created" only.
--   • A pile of sibling RLS policies (messages, images, conversations,
--     entity_links, autotag_log, tags, group_index, …) gated writes on
--     raw is_workspace_member with no tier consideration. So even though
--     can_write_board would have blocked board edits, demo users could
--     still send chat messages, upload images, mutate tags, etc. in
--     workspaces they didn't own.
--
-- This migration:
--   1. Adds can_write_workspace(ws) as the tier-aware analogue of
--      is_workspace_member. admin/paid behave identically to before;
--      demo requires workspace.created_by = auth.uid(); waitlist is false.
--   2. Tightens the demo branch of can_write_board so it walks the
--      board's ancestor chain for an OWNED workspace, not just any
--      workspace membership. Signature unchanged → PartyKit auth.ts,
--      board_state RLS, realtime y:% broadcast, comments, card_tags,
--      board_tags, etc. all keep working but now correctly deny demo
--      writes on shared boards.
--   3. Rewrites the write-side policies of every workspace-scoped table
--      that previously used is_workspace_member to use can_write_workspace.
--      Read policies are left alone — demo users keep seeing what they're
--      invited to.
--   4. Switches the workspace_member checks inside chatty / tag-editing
--      RPCs to can_write_workspace so the error message ("must be a
--      workspace member") fires for demo users in other people's
--      workspaces too.
--
-- Service-role writes (board_ops, board_op_batches, board_snapshots,
-- board_state_version, r2_sweep_audit, job_runs, inconsistency_audit)
-- are unchanged — they bypass RLS and are gated at the worker / edge
-- function call sites.

------------------------------------------------------------------
-- 1. NEW HELPER: can_write_workspace
------------------------------------------------------------------
create or replace function public.can_write_workspace(ws uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  with t as (
    select coalesce(
      (select tier from public.profiles where user_id = auth.uid()),
      'demo'
    ) as tier
  )
  select case
    when (select tier from t) = 'waitlist' then false
    when (select tier from t) in ('admin','paid') then is_workspace_member(ws)
    -- demo (and anything unrecognized): must be the workspace creator,
    -- not merely a member.
    else exists (
      select 1 from public.workspaces w
      where w.id = ws and w.created_by = auth.uid()
    )
  end;
$$;
revoke all on function public.can_write_workspace(uuid) from public;
grant execute on function public.can_write_workspace(uuid) to authenticated;

------------------------------------------------------------------
-- 2. TIGHTEN can_write_board FOR DEMO
-- For demo, the chain walk must hit a workspace the caller CREATED
-- (workspaces.created_by = auth.uid()), not merely one they're a
-- member of. admin/paid unchanged. waitlist still false.
------------------------------------------------------------------
create or replace function public.can_write_board(p_board_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  with recursive t as (
    select coalesce(
      (select tier from public.profiles where user_id = auth.uid()),
      'demo'
    ) as tier
  ),
  chain as (
    select id, workspace_id, parent_board_id
    from public.boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id
    from public.boards b
    join chain c on b.id = c.parent_board_id
  )
  select case
    when (select tier from t) = 'waitlist' then false
    when (select tier from t) in ('admin','paid') then exists (
      select 1 from chain
      where is_workspace_member(chain.workspace_id)
         or exists (
           select 1 from public.board_shares s
           where s.board_id = chain.id
             and s.user_id  = auth.uid()
             and s.role     = 'editor'
         )
    )
    -- demo: owned workspace only. board_shares.role = 'editor' on someone
    -- else's board does NOT grant write — that's a paid feature.
    else exists (
      select 1 from chain
      join public.workspaces w on w.id = chain.workspace_id
      where w.created_by = auth.uid()
    )
  end;
$$;
revoke all on function public.can_write_board(uuid) from public;
grant execute on function public.can_write_board(uuid) to authenticated;

------------------------------------------------------------------
-- 3. BOARDS — INSERT/UPDATE/DELETE
-- Reads (0013) still go via can_read_board; only writes change.
-- Insert still allows per-board share-editors to nest children, but
-- that path is gated by can_write_board (already tier-aware), so it
-- naturally rejects demo.
------------------------------------------------------------------
drop policy if exists "boards insert by members or share editors" on public.boards;
create policy "boards insert by members or share editors" on public.boards for insert
  with check (
    can_write_workspace(workspace_id)
    or (
      parent_board_id is not null
      and can_write_board(parent_board_id)
    )
  );

drop policy if exists "boards update by members" on public.boards;
create policy "boards update by members" on public.boards for update
  using (can_write_workspace(workspace_id));

drop policy if exists "boards delete by members" on public.boards;
create policy "boards delete by members" on public.boards for delete
  using (can_write_workspace(workspace_id));

------------------------------------------------------------------
-- 4. CARD_INDEX (0003) — write side
-- Reads stay open (is_workspace_member). Writes now tier-aware.
-- card_index is maintained client-side by syncCardIndex; this also
-- means the demo_card_count trigger fires only for the workspace
-- creator's own boards, which is the correct cap-counting semantic.
------------------------------------------------------------------
drop policy if exists "card_index member write" on public.card_index;
create policy "card_index write" on public.card_index for all
  using (can_write_workspace(workspace_id))
  with check (can_write_workspace(workspace_id));

------------------------------------------------------------------
-- 5. GROUP_INDEX (0023) — write side
------------------------------------------------------------------
drop policy if exists "group_index member write" on public.group_index;
create policy "group_index write" on public.group_index for all
  using (can_write_workspace(workspace_id))
  with check (can_write_workspace(workspace_id));

------------------------------------------------------------------
-- 6. AUTOTAG_LOG (0037) — write side
------------------------------------------------------------------
drop policy if exists "autotag_log write" on public.autotag_log;
create policy "autotag_log write" on public.autotag_log for all
  using (can_write_workspace(workspace_id))
  with check (can_write_workspace(workspace_id));

------------------------------------------------------------------
-- 7. AUTOTAG_IGNORED (0038) — write side
------------------------------------------------------------------
drop policy if exists "autotag_ignored write" on public.autotag_ignored;
create policy "autotag_ignored write" on public.autotag_ignored for all
  using (can_write_workspace(workspace_id))
  with check (can_write_workspace(workspace_id));

------------------------------------------------------------------
-- 8. TAGS (0032) — workspace-level tag library writes
-- card_tags / board_tags already gate via can_write_board (tier-aware
-- as of step 2), so they don't need changes here.
------------------------------------------------------------------
drop policy if exists "tags insert" on public.tags;
create policy "tags insert" on public.tags for insert
  with check (can_write_workspace(workspace_id));

drop policy if exists "tags update" on public.tags;
create policy "tags update" on public.tags for update
  using (can_write_workspace(workspace_id))
  with check (can_write_workspace(workspace_id));

drop policy if exists "tags delete" on public.tags;
create policy "tags delete" on public.tags for delete
  using (can_write_workspace(workspace_id));

------------------------------------------------------------------
-- 9. IMAGES (0014) — write side
-- Writes from a workspace member OR from a per-board share editor.
-- Replace the workspace-member half with can_write_workspace so a
-- demo user added to someone else's workspace can't upload there.
-- The board-scoped half goes through can_write_board (already tightened).
------------------------------------------------------------------
drop policy if exists "images insert" on public.images;
create policy "images insert" on public.images for insert
  to authenticated with check (
    can_write_workspace(workspace_id)
    or (board_id is not null and can_write_board(board_id))
  );

drop policy if exists "images delete" on public.images;
create policy "images delete" on public.images for delete
  using (
    can_write_workspace(workspace_id)
    or (board_id is not null and can_write_board(board_id))
  );

------------------------------------------------------------------
-- 10. ENTITY_LINKS (0036b) — write side
------------------------------------------------------------------
drop policy if exists "entity_links write" on public.entity_links;
create policy "entity_links write" on public.entity_links for all
  using (
    can_write_workspace(source_workspace)
    or (source_board_id is not null and can_write_board(source_board_id))
  )
  with check (
    can_write_workspace(source_workspace)
    or (source_board_id is not null and can_write_board(source_board_id))
  );

------------------------------------------------------------------
-- 11. CONVERSATIONS + MESSAGES (0058)
-- Read paths stay participant-based (demo can still SEE conversations
-- they were added to). Sends require workspace-level write authority.
------------------------------------------------------------------
drop policy if exists "conversations insert" on public.conversations;
create policy "conversations insert" on public.conversations for insert
  with check (
    can_write_workspace(workspace_id)
    and created_by = auth.uid()
  );

drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages for insert
  with check (
    sender_id = auth.uid()
    and is_active_conversation_participant(conversation_id)
    and can_write_workspace(workspace_id)
  );

-- conversation_participants: an active participant can add a workspace
-- co-member. Tighten so demo users on someone else's workspace can't
-- add other people to its conversations.
drop policy if exists "participants insert" on public.conversation_participants;
create policy "participants insert" on public.conversation_participants for insert
  to authenticated
  with check (
    (
      is_active_conversation_participant(conversation_id)
      and exists (
        select 1 from public.conversations c
        where c.id = conversation_id
          and can_write_workspace(c.workspace_id)
      )
    )
    or (
      user_id = auth.uid()
      and exists (
        select 1 from public.conversations c
        where c.id = conversation_id and c.created_by = auth.uid()
      )
    )
  );

------------------------------------------------------------------
-- 12. WORKSPACE_ANOMALY_ALERTS (0060) — ack write
------------------------------------------------------------------
drop policy if exists "anomaly_alerts ack by members" on public.workspace_anomaly_alerts;
create policy "anomaly_alerts ack by members" on public.workspace_anomaly_alerts for update
  using (can_write_workspace(workspace_id))
  with check (can_write_workspace(workspace_id));

------------------------------------------------------------------
-- 13. RPCs: switch is_workspace_member guards → can_write_workspace
-- on functions that perform writes in a workspace context.
------------------------------------------------------------------

-- find_or_create_dm (0058). Demo users invited to a paid workspace
-- shouldn't be able to spin up DMs there.
create or replace function public.find_or_create_dm(p_workspace uuid, p_peer uuid)
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
  if not can_write_workspace(p_workspace) then
    raise exception 'must be a workspace member with write access'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace and user_id = p_peer
  ) then
    raise exception 'peer is not a workspace member' using errcode = '42501';
  end if;

  select c.id into v_id
  from public.conversations c
  where c.workspace_id = p_workspace
    and exists (select 1 from public.conversation_participants
                where conversation_id = c.id and user_id = v_me)
    and exists (select 1 from public.conversation_participants
                where conversation_id = c.id and user_id = p_peer)
    and (select count(*) from public.conversation_participants
         where conversation_id = c.id) = 2
  limit 1;

  if v_id is not null then
    update public.conversation_participants
       set left_at = null
     where conversation_id = v_id and user_id = v_me and left_at is not null;
    return v_id;
  end if;

  insert into public.conversations (workspace_id, created_by) values (p_workspace, v_me)
    returning id into v_id;
  insert into public.conversation_participants (conversation_id, user_id) values (v_id, v_me);
  insert into public.conversation_participants (conversation_id, user_id) values (v_id, p_peer);
  return v_id;
end;
$$;
revoke all on function public.find_or_create_dm(uuid, uuid) from public;
grant execute on function public.find_or_create_dm(uuid, uuid) to authenticated;

-- create_group_conversation (0058)
create or replace function public.create_group_conversation(
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
  if not can_write_workspace(p_workspace) then
    raise exception 'must be a workspace member with write access'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(p_member_ids) m(uid)
    where not exists (select 1 from public.workspace_members
                      where workspace_id = p_workspace and user_id = m.uid)
  ) then
    raise exception 'all members must belong to the workspace' using errcode = '42501';
  end if;

  insert into public.conversations (workspace_id, title, created_by)
    values (p_workspace, nullif(trim(coalesce(p_title, '')), ''), v_me)
    returning id into v_id;

  insert into public.conversation_participants (conversation_id, user_id)
    values (v_id, v_me)
    on conflict do nothing;
  foreach v_uid in array p_member_ids loop
    insert into public.conversation_participants (conversation_id, user_id)
      values (v_id, v_uid)
      on conflict do nothing;
  end loop;

  return v_id;
end;
$$;
revoke all on function public.create_group_conversation(uuid, text, uuid[]) from public;
grant execute on function public.create_group_conversation(uuid, text, uuid[]) to authenticated;
