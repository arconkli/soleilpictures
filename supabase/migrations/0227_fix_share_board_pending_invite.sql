-- 0227 — share_board: inviting a NEW person by email has never once worked.
--
-- The pending-invite branch — the only path that reaches someone who does not
-- already have an account, i.e. the entire growth half of email invites —
-- raises 42P10 on every single call:
--
--   ERROR: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- The arbiter index (0086) is
--   pending_invites_board_unclaimed_uniq
--     ON (lower(email), board_id) WHERE claimed_at IS NULL AND board_id IS NOT NULL
-- but the statement infers with only `where claimed_at is null`. Postgres
-- requires the statement's predicate to IMPLY the index's; a weaker predicate
-- cannot prove the index covers the arbiter, so no index matches and the
-- insert dies before it writes anything.
--
-- The sibling invite_workspace_member has the matching predicate
-- (`where claimed_at is null and board_id is null`) and works, which is why
-- the only pending_invites row in production — from 2026-05-29 — is a
-- workspace invite. Not one board-scoped email invite has ever been created.
--
-- Fix: add the missing `and board_id is not null` so the predicate matches the
-- index exactly, mirroring invite_workspace_member. Everything else in this
-- body is reproduced verbatim from the live definition (drift-aware: this
-- function has been rewritten by 0013 → 0016 → 0065 → 0086 → 0147 → 0188).
--
-- Regression guard: the ON CONFLICT predicate must name board_id. Re-run
--   insert into pending_invites (email, workspace_id, board_id, role, invited_by)
--   values (…) on conflict (lower(email), board_id) where claimed_at is null …
-- inside a rolled-back transaction and it must NOT raise 42P10.
--
-- Applied via Supabase MCP.

create or replace function public.share_board(p_board_id uuid, p_email text, p_role text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    --
    -- The predicate must match pending_invites_board_unclaimed_uniq EXACTLY —
    -- including `board_id is not null`. Without it Postgres cannot infer the
    -- arbiter and every call raises 42P10 (see this migration's header).
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, v_workspace, p_board_id, p_role, auth.uid())
    on conflict (lower(email), board_id) where claimed_at is null and board_id is not null
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
$function$;
