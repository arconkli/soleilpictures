-- 0856: at most 10 workspaces of your own on Free and Creator.
--
-- The owner (2026-11-04): an account that is not on Team can own at most 10
-- workspaces; a group that needs more buys a Team, which has no limit.
--
-- Counted per ACCOUNT: workspaces.created_by = the account and org_id is null.
-- Workspaces it is invited into, co-owns or that belong to a team never count.
-- Two doors make a personal workspace by choice: create_workspace_with_root,
-- and keep_mcp_draft (keeping an AI draft hands its workspace to the keeper as
-- one of their own). Both refuse at the limit with 42501 + hint workspace_limit
-- (the editor limit's family, 0520); create_workspace_with_root checks the
-- new-account cap (54000) first.
--
-- The paths that can raise the count without that door (a transfer, a closed
-- team, moving a workspace out of a team, an account deletion's heirs) are
-- deliberately NOT refused: someone over 10 keeps everything and simply cannot
-- create another until under 10 (the same freeze as the editor limit).
--
-- On for everyone at once: nobody is near the limit today, so there is no switch.

begin;

create or replace function public._workspace_limit()
returns integer
language sql
immutable
set search_path = public
as $$
  select 10;
$$;

create or replace function public._account_personal_workspaces(p_owner uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.workspaces w
   where w.created_by = p_owner
     and w.org_id is null;
$$;

revoke execute on function public._workspace_limit() from public, anon, authenticated;
revoke execute on function public._account_personal_workspaces(uuid) from public, anon, authenticated;

-- create_workspace_with_root(text, text): 0375's body, plus the advisory lock
-- before the new-account check and the limit check right after it.
CREATE OR REPLACE FUNCTION public.create_workspace_with_root(p_name text, p_root_name text DEFAULT 'Studio'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid;
  ws_id uuid;
  brd_id uuid;
  c_new_account_workspaces constant integer := 4;
  v_personal integer;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'must be authenticated';
  end if;
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  -- 0856: one create at a time per account, so two tabs cannot both pass the count.
  perform pg_advisory_xact_lock(hashtext('workspace_count:' || uid::text));
  -- 0375: a new account gets a handful of workspaces, not an endless supply.
  if public._account_is_new()
     and (select count(*) from workspaces w where w.created_by = uid) >= c_new_account_workspaces then
    raise exception 'a new account can have % workspaces for now; more open up once it is three days old',
      c_new_account_workspaces using errcode = '54000', hint = 'new_account';
  end if;
  -- 0856: outside Team an account owns at most _workspace_limit() workspaces of
  -- its own. Ones it is invited into, co-owns or that belong to a team never count.
  v_personal := public._account_personal_workspaces(uid);
  if v_personal >= public._workspace_limit() then
    raise exception 'workspace limit reached: you have % workspaces of your own, the most outside Team', v_personal
      using errcode = '42501', hint = 'workspace_limit';
  end if;

  insert into workspaces (name, created_by)
    values (coalesce(nullif(trim(p_name), ''), 'Workspace'), uid)
    returning id into ws_id;

  insert into workspace_members (workspace_id, user_id, role)
    values (ws_id, uid, 'owner');

  insert into boards (workspace_id, parent_board_id, name, view, created_by)
    values (ws_id, null, coalesce(nullif(trim(p_root_name), ''), 'Studio'), 'canvas', uid)
    returning id into brd_id;

  insert into board_state (board_id, doc)
    values (brd_id, '');

  return jsonb_build_object(
    'workspace_id', ws_id,
    'root_board_id', brd_id
  );
end $function$;

revoke execute on function public.create_workspace_with_root(text, text) from public, anon;
grant execute on function public.create_workspace_with_root(text, text) to authenticated;

-- keep_mcp_draft(text): 0706's body, plus the same lock and limit check before
-- it decides the draft sits beside the keeper's own workspace.
create or replace function public.keep_mcp_draft(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_me      uuid := auth.uid();
  v_email   text;
  d         public.mcp_drafts;
  v_has_own boolean;
  v_board   uuid;
  v_name    text;
  v_tier    text;
  v_cap     integer;
  v_count   integer;
  v_personal integer;
begin
  if v_me is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = v_me;
  if v_email is null or public._synthetic_address(v_email) then
    raise exception 'sign in with your own email address to keep a draft'
      using errcode = '42501', hint = 'not_a_person';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'that is not a keep link' using errcode = '22023', hint = 'draft_unknown';
  end if;

  select * into d from public.mcp_drafts m
   where m.keep_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   for update;
  if d.id is null then
    raise exception 'there is no draft at that link' using errcode = 'P0002', hint = 'draft_unknown';
  end if;
  if d.claimed_at is not null then
    if d.claimed_by = v_me then
      -- Twice, from two tabs or a retry: the same answer, nothing done again.
      return jsonb_build_object('status', 'kept', 'already', true, 'workspace_id', d.workspace_id,
                                'board_id', public._mcp_draft_main_board(d.workspace_id));
    end if;
    raise exception 'someone has already kept this draft' using errcode = '42501', hint = 'draft_kept';
  end if;
  if d.reaped_at is not null or d.expires_at <= now() or d.workspace_id is null or d.user_id is null then
    raise exception 'this draft has been deleted' using errcode = 'P0002', hint = 'draft_expired';
  end if;

  -- 0856: keeping a draft hands the keeper one more workspace of their own, so
  -- it meets the same limit as create_workspace_with_root. The draft's workspace
  -- is still the draft user's here, so it is not counted.
  perform pg_advisory_xact_lock(hashtext('workspace_count:' || v_me::text));
  v_personal := public._account_personal_workspaces(v_me);
  if v_personal >= public._workspace_limit() then
    raise exception 'workspace limit reached: you have % workspaces of your own, the most outside Team', v_personal
      using errcode = '42501', hint = 'workspace_limit';
  end if;

  -- Someone who already has a workspace of their own gets this one beside it,
  -- named after its cluster; someone new gets it as theirs.
  v_has_own := exists (select 1 from public.workspaces w
                        where w.created_by = v_me and w.org_id is null and w.id <> d.workspace_id);
  v_board := public._mcp_draft_main_board(d.workspace_id);
  select b.name into v_name from public.boards b where b.id = v_board and b.id is distinct from public._mcp_draft_root(d.workspace_id);
  perform public._mcp_draft_hand_over(d.id, v_me, v_has_own, v_name);

  perform public._log_security_event('workspace.draft_kept', d.workspace_id,
    jsonb_build_object('draft_id', d.id, 'host', d.host, 'from_user', d.user_id));
  begin
    insert into public.analytics_events (user_id, event, props)
    values (v_me, 'mcp_draft_kept', jsonb_build_object('host', d.host, 'beside_own', v_has_own));
  exception when others then null;
  end;

  select coalesce(p.tier, 'demo'), coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
    into v_tier, v_cap
    from public.profiles p where p.user_id = v_me;
  v_count := public._owner_card_count(v_me);

  return jsonb_build_object(
    'status', 'kept',
    'already', false,
    'workspace_id', d.workspace_id,
    'board_id', v_board,
    'beside_own', v_has_own,
    'card_count', v_count,
    'card_limit', case when coalesce(v_tier, 'demo') = 'demo' then coalesce(v_cap, 50) end);
end;
$$;
revoke execute on function public.keep_mcp_draft(text) from public, anon;
grant execute on function public.keep_mcp_draft(text) to authenticated;

-- Proofs (the 0311 habit: a REVOKE reporting success proves nothing)

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public._workspace_limit()', 'public._account_personal_workspaces(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0856: % is client-executable', v_fn;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.create_workspace_with_root(text,text)', 'execute') then
    raise exception '0856: create_workspace_with_root is callable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.create_workspace_with_root(text,text)', 'execute') then
    raise exception '0856: create_workspace_with_root is not callable signed in';
  end if;

  if has_function_privilege('anon', 'public.keep_mcp_draft(text)', 'execute') then
    raise exception '0856: keep_mcp_draft is callable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.keep_mcp_draft(text)', 'execute') then
    raise exception '0856: keep_mcp_draft is not callable signed in';
  end if;
end $$;

commit;
