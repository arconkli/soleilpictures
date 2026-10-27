-- 0706 — A draft's clusters sit beside its root, not under it.
--
-- 0705 took a draft's own clusters to be the ones under its root cluster. The
-- API puts them beside it: create_boards with no parent makes a top-level
-- cluster, next to the root get_or_create_personal_workspace made with the
-- workspace. So on a real draft the keep page would have opened on the empty
-- root and listed none of what the AI made, and keeping it beside a workspace
-- of the keeper's own would not have named it after the cluster.
--
-- The root is now one cluster, the workspace's oldest live top-level one
-- (_mcp_draft_root, the pick _ensure_workspace_root and
-- get_or_create_personal_workspace make), and every other live cluster is the
-- draft's own, wherever it sits:
--   _mcp_draft_main_board  the most recently changed cluster beside the root or
--                          under it, so a sub-cluster never opens in place of
--                          the cluster it is in; else any other; else the root;
--   mcp_draft_keep_view    lists every live cluster but the root;
--   keep_mcp_draft         names the workspace after any cluster but the root.
-- keep_view and keep_mcp_draft are 0705's, restated with only that line
-- changed (mcpDraftsMigration.test.mjs holds them to it). Nothing in the
-- Worker changes, and a cluster made under the root still counts.

-- ── 1. The root ──────────────────────────────────────────────────────────────
create or replace function public._mcp_draft_root(p_workspace_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select r.id from public.boards r
   where r.workspace_id = p_workspace_id and r.parent_board_id is null and r.deleted_at is null
   order by r.created_at, r.id
   limit 1;
$$;
revoke execute on function public._mcp_draft_root(uuid) from public, anon, authenticated;

-- ── 2. The cluster a draft opens on ──────────────────────────────────────────
create or replace function public._mcp_draft_main_board(p_workspace_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select b.id from public.boards b
      where b.workspace_id = p_workspace_id and b.deleted_at is null and b.id is distinct from r.id
        and (b.parent_board_id is null or b.parent_board_id = r.id)
      order by b.updated_at desc, b.created_at desc limit 1),
    (select b.id from public.boards b
      where b.workspace_id = p_workspace_id and b.deleted_at is null and b.id is distinct from r.id
      order by b.updated_at desc, b.created_at desc limit 1),
    r.id)
  from (select public._mcp_draft_root(p_workspace_id) as id) r;
$$;
revoke execute on function public._mcp_draft_main_board(uuid) from public, anon, authenticated;

-- ── 3. The keep page's view: every cluster but the root ──────────────────────
create or replace function public.mcp_draft_keep_view(p_keep_hash text, p_board_id uuid default null)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  d          public.mcp_drafts;
  v_target   uuid;
  v_board    record;
  v_snapshot text;
  v_keys     text[];
  v_meta     json;
  v_nav      json;
  v_cards    integer;
  v_limit    integer;
begin
  select * into d from public.mcp_drafts m where m.keep_hash = p_keep_hash;
  if d.id is null then
    return json_build_object('state', 'unknown');
  end if;
  if d.claimed_at is not null then
    return json_build_object('state', 'kept', 'host', d.host);
  end if;
  if d.reaped_at is not null or d.expires_at <= now() or d.workspace_id is null then
    return json_build_object('state', 'expired', 'host', d.host);
  end if;

  v_target := public._mcp_draft_main_board(d.workspace_id);
  if p_board_id is not null and exists (
       select 1 from public.boards b
        where b.id = p_board_id and b.workspace_id = d.workspace_id and b.deleted_at is null) then
    v_target := p_board_id;
  end if;

  select b.id, b.name, b.view, b.cover, b.bg_color into v_board from public.boards b where b.id = v_target;
  select s.doc into v_snapshot from public.board_state s where s.board_id = v_target;

  -- get_share_bundle's three key sets, for this board.
  select coalesce(array_agg(distinct k), '{}'::text[]) into v_keys
  from (
    select i.storage_path as k from public.images i
     where i.storage_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
    union
    select i.preview_path from public.images i
     where i.preview_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
    union
    select i.preview_sm_path from public.images i
     where i.preview_sm_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
  ) s;

  select coalesce(jsonb_object_agg(i.storage_path, jsonb_build_object(
           'blur', i.blur_hash, 'preview', i.preview_path, 'preview_w', i.preview_w, 'preview_h', i.preview_h,
           'preview_sm', i.preview_sm_path, 'preview_sm_w', i.preview_sm_w, 'preview_sm_h', i.preview_sm_h)),
         '{}'::jsonb)::json
    into v_meta
    from public.images i
   where i.storage_path is not null
     and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
     and (i.blur_hash is not null or i.preview_path is not null);

  -- Every live cluster in the draft but its root, so the page can move between them.
  select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name) order by b.created_at), '[]'::json)
    into v_nav
    from public.boards b
   where b.workspace_id = d.workspace_id and b.id is distinct from public._mcp_draft_root(d.workspace_id) and b.deleted_at is null;

  v_cards := public._owner_card_count(d.user_id);
  select coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0) into v_limit
    from public.profiles p where p.user_id = d.user_id;

  return json_build_object(
    'state', 'live',
    'host', d.host,
    'expires_at', d.expires_at,
    'card_count', v_cards,
    'card_limit', coalesce(v_limit, 50),
    'bundle', json_build_object(
      'board', json_build_object('id', v_board.id, 'name', v_board.name, 'view', v_board.view,
                                 'cover', v_board.cover, 'bg_color', v_board.bg_color),
      'snapshot', v_snapshot,
      'image_keys', v_keys,
      'image_meta', v_meta,
      'role', 'viewer',
      'root_id', v_target,
      'include_subboards', true,
      'nav_boards', v_nav,
      'join', null));
end;
$$;
revoke execute on function public.mcp_draft_keep_view(text, uuid) from public, anon, authenticated;

-- ── 4. Keeping it: named after any cluster but the root ─────────────────────
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

-- ── 5. The 0311 habit: prove the grants ──────────────────────────────────────
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._mcp_draft_root(uuid)',
    'public._mcp_draft_main_board(uuid)',
    'public.mcp_draft_keep_view(text, uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0706: % is callable by a client', f;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.mcp_draft_keep_view(text, uuid)', 'execute') then
    raise exception '0706: the Worker (service_role) cannot run mcp_draft_keep_view';
  end if;
  if has_function_privilege('anon', 'public.keep_mcp_draft(text)', 'execute') then
    raise exception '0706: keep_mcp_draft is callable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.keep_mcp_draft(text)', 'execute') then
    raise exception '0706: a signed-in person cannot run keep_mcp_draft';
  end if;
end;
$$;
