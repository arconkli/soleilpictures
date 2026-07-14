-- 0188_free_editor_collab.sql — editor collaboration is FREE; capacity is
-- what's paid for.
--
-- Product decision (2026-07-13): collaboration should ignite the growth loop,
-- not sit behind the paywall. The demo tier was locked out of collaborating
-- at three server layers, all deliberate hardening from 0083/0091, relaxed
-- here because owner-pays (0187) now makes it safe — every card/byte a
-- collaborator adds charges the BOARD OWNER's plan, so free editors cannot
-- mint free capacity:
--
--   1. share_board: "demo can only invite viewers" (actor-keyed) — REMOVED.
--   2. can_write_board: a demo user's editor share granted no write — now
--      editor shares write regardless of the actor's tier (waitlist still
--      blocked). Realtime write auth flows through this same function, so
--      PartyKit/RLS pick the change up automatically.
--   3. can_write_workspace: demo required being the workspace CREATOR — now
--      membership writes for demo like it does for paid.
--
-- Safety valve: a DORMANT config brake. app_config['collab_free_editor_cap']
-- = {"cap": null} means unlimited (today's setting); an admin can set a
-- number later (admin_set_collab_editor_cap) and share_board / the invite
-- claim paths start enforcing "max N distinct free editors per workspace
-- owner" with NO code ship. Seat growth is watched via admin_referral_stats
-- (0190) — multi-editor paid workspaces are the future Team-plan list, not a
-- leak to block today.

-----------------------------------------------------------------------
-- 1. The dormant brake: config reader + admin setter.
-----------------------------------------------------------------------
create or replace function public._collab_editor_cap()
returns integer
language sql stable security definer
set search_path = public as $$
  select case
    when (value->>'cap') is null then null
    when (value->>'cap')::integer <= 0 then null
    else (value->>'cap')::integer
  end
  from public.app_config where key = 'collab_free_editor_cap';
$$;
revoke all on function public._collab_editor_cap() from public;

create or replace function public.admin_set_collab_editor_cap(p_cap integer)
returns integer
language plpgsql security definer
set search_path = public as $$
begin
  perform public._require_admin();
  insert into public.app_config (key, value, updated_at)
    values ('collab_free_editor_cap', jsonb_build_object('cap', p_cap), now())
  on conflict (key) do update
    set value = jsonb_build_object('cap', p_cap), updated_at = now();
  return p_cap;
end;
$$;
revoke all on function public.admin_set_collab_editor_cap(integer) from public;
grant execute on function public.admin_set_collab_editor_cap(integer) to authenticated;

insert into public.app_config (key, value, updated_at)
values ('collab_free_editor_cap', jsonb_build_object('cap', null), now())
on conflict (key) do nothing;

-----------------------------------------------------------------------
-- 2. can_write_board — editor shares + membership write for every
--    non-waitlist tier. The owner check is kept explicit (an owner is not
--    necessarily a workspace_members row).
-----------------------------------------------------------------------
create or replace function public.can_write_board(p_board_id uuid)
returns boolean
language sql stable security definer
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
    else exists (
      select 1 from chain
      where is_workspace_member(chain.workspace_id)
         or exists (
           select 1 from public.workspaces w
           where w.id = chain.workspace_id and w.created_by = auth.uid()
         )
         or exists (
           select 1 from public.board_shares s
           where s.board_id = chain.id
             and s.user_id  = auth.uid()
             and s.role     = 'editor'
         )
    )
  end;
$$;

-----------------------------------------------------------------------
-- 3. can_write_workspace — membership writes for demo like paid.
-----------------------------------------------------------------------
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
    else is_workspace_member(ws)
      or exists (
        select 1 from public.workspaces w
        where w.id = ws and w.created_by = auth.uid()
      )
  end;
$$;

-----------------------------------------------------------------------
-- 4. share_board — demo→editor block removed; dormant editor-seat brake
--    added. Body otherwise verbatim from the live 0147 version.
-----------------------------------------------------------------------
create or replace function public.share_board(
  p_board_id uuid, p_email text, p_role text
) returns text
language plpgsql security definer
set search_path = public as $$
declare
  v_owner                uuid;
  v_is_owner             boolean;
  v_user                 uuid;
  v_workspace            uuid;
  v_my_tier              text;
  v_existing_invited_by  uuid;
  v_email_norm           text := lower(trim(p_email));
  v_cap                  integer;
  v_editor_seats         integer;
begin
  if p_role not in ('viewer','editor') then
    raise exception 'role must be viewer or editor' using errcode = '22023';
  end if;

  select coalesce(
    (select tier from public.profiles where user_id = auth.uid()),
    'demo'
  ) into v_my_tier;

  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;
  -- (The 0147 "demo can only invite viewers" block was here. Editor
  -- collaboration is free now — owner-pays caps (0187) are the resource
  -- gate; the config brake below is the emergency lever.)

  select b.workspace_id into v_workspace
  from boards b where b.id = p_board_id;
  if v_workspace is null then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;

  select w.created_by into v_owner from workspaces w where w.id = v_workspace;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to share this board'
      using errcode = '42501';
  end if;

  -- Dormant editor-seat brake: only bites when an admin sets a cap.
  if p_role = 'editor' then
    v_cap := public._collab_editor_cap();
    if v_cap is not null then
      select count(distinct bs.user_id) into v_editor_seats
      from board_shares bs
      join boards b     on b.id = bs.board_id
      join workspaces w on w.id = b.workspace_id
      where w.created_by = v_owner and bs.role = 'editor';
      if v_editor_seats >= v_cap then
        raise exception 'this workspace has reached its free editor limit'
          using errcode = '42501';
      end if;
    end if;
  end if;

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
    -- Pending path: invitee has no account yet. Re-inviting/refreshing is an
    -- "add" action — allowed for owners and editors; latest inviter owns the
    -- not-yet-claimed pending row.
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, v_workspace, p_board_id, p_role, auth.uid())
    on conflict (lower(email), board_id) where claimed_at is null
    do update set role       = excluded.role,
                  invited_by = auth.uid(),
                  expires_at = now() + interval '30 days';
    return 'pending';
  end if;

  if v_user = auth.uid() then
    raise exception 'cannot share with yourself' using errcode = '22023';
  end if;

  -- Editors may add anyone, but may only CHANGE an existing share if they
  -- created it. A brand-new INSERT is always allowed (subject to tier/role).
  select invited_by into v_existing_invited_by
  from board_shares where board_id = p_board_id and user_id = v_user;
  if FOUND and not v_is_owner and v_existing_invited_by is distinct from auth.uid() then
    raise exception 'you can only change the access of people you invited'
      using errcode = '42501';
  end if;

  insert into board_shares (board_id, user_id, role, invited_by)
  values (p_board_id, v_user, p_role, auth.uid())
  on conflict (board_id, user_id)
  do update set role = excluded.role,
                invited_by = auth.uid();

  insert into share_notifications (user_id, board_id, role, shared_by)
  values (v_user, p_board_id, p_role, auth.uid());

  return 'granted';
end;
$$;
