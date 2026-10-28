-- 0748_admin_user_placements.sql — how many cards a person placed in
-- workspaces shared with them (the owner, 2026-10-28, on the sharing insight).
--
-- admin_user_placements(p_user_id): every cluster in a workspace they don't own
-- that they placed cards on, with its workspace, its ancestors (so a profile
-- can total a shared cluster's whole subtree), the cards placed and when last.
--
-- The count is sum(card_placed.n), the event's own depth reading
-- (analyticsEvents.js: "read depth as sum(n)"): cards they PLACED, not cards
-- still there, from the first card_placed (2026-06-04) on. A guest's
-- card_placed carries the guest's own workspace_id in props, so the workspace
-- is the board's (props board_id → boards.workspace_id), never props'.
-- Deleted clusters still count, named as deleted; a board that no longer
-- exists at all is left out.
--
-- New function, admin only (_require_admin), EXECUTE for authenticated and
-- service_role only (0311).

begin;

set local lock_timeout = '3s';

create or replace function public.admin_user_placements(p_user_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = 'public'
as $fn$
declare
  v_out jsonb;
begin
  perform public._require_admin();
  with recursive
  placed as (
    select (e.props->>'board_id')::uuid as board_id,
           sum(case when (e.props->>'n') ~ '^\d+$' then (e.props->>'n')::int else 1 end)::int as n,
           max(e.occurred_at) as last_at
      from public.analytics_events e
     where e.user_id = p_user_id
       and e.event = 'card_placed'
       and (e.props->>'board_id') ~ '^[0-9a-f-]{36}$'
     group by 1
  ),
  theirs as (
    select p.board_id, p.n, p.last_at, b.workspace_id, b.name as title, b.deleted_at is not null as deleted
      from placed p
      join public.boards b on b.id = p.board_id
      join public.workspaces w on w.id = b.workspace_id
     where w.created_by is distinct from p_user_id
  ),
  up as (
    select t.board_id, b.parent_board_id as anc, 1 as depth
      from theirs t join public.boards b on b.id = t.board_id
     where b.parent_board_id is not null
    union all
    select up.board_id, b.parent_board_id, up.depth + 1
      from up join public.boards b on b.id = up.anc
     where b.parent_board_id is not null and up.depth < 32
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'board_id', t.board_id, 'workspace_id', t.workspace_id, 'title', t.title, 'deleted', t.deleted,
           'ancestors', coalesce((select jsonb_agg(up.anc order by up.depth) from up where up.board_id = t.board_id), '[]'::jsonb),
           'placed', t.n, 'last_at', t.last_at)
           order by t.n desc, t.board_id), '[]'::jsonb)
    into v_out
    from theirs t;
  return v_out;
end
$fn$;

revoke execute on function public.admin_user_placements(uuid) from public, anon;
grant execute on function public.admin_user_placements(uuid) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.admin_user_placements(uuid)', 'execute') then
    raise exception '0748: anon can execute admin_user_placements';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_user_placements(uuid)', 'execute') then
    raise exception '0748: authenticated cannot execute admin_user_placements';
  end if;
  if not has_function_privilege('service_role', 'public.admin_user_placements(uuid)', 'execute') then
    raise exception '0748: service_role cannot execute admin_user_placements';
  end if;
end
$$;

commit;
