-- 0275 — a workspace must always have a reachable root cluster.
--
-- Twelve workspaces (twelve users, eight of them with no working workspace at
-- all) were stuck on a permanent loading spinner. The client resolves a
-- workspace by asking for its root board:
--
--   boardsApi.getRootBoard() -> boards where parent_board_id is null
--                                      and deleted_at is null
--
-- and App.jsx renders <LoadingShell/> until that resolves. It returns null —
-- not an error — for a workspace with no live root, so the app waits forever
-- with no error state and no way out. The stored workspace id lives in
-- localStorage, so every reload replays it.
--
-- Two things put a workspace in that state:
--
--  1. The existing heal in 0026 looks for a root WITHOUT filtering deleted_at.
--     It finds the tombstone of a deleted root, concludes a root exists, and
--     no-ops — while the client, which does filter, sees nothing. Server and
--     client disagreed about whether a root existed.
--
--  2. That heal only ever runs against the user's OLDEST workspace
--     (order by created_at asc limit 1 in get_or_create_personal_workspace),
--     so any other workspace could never be healed at all.
--
-- soft_delete_board had no guard and no cascade, so deleting a root also
-- stranded its live children under a tombstone, making them unreachable
-- through board_tree (whose recursive anchor requires a live root).

-- ---------------------------------------------------------------------------
-- 1. The heal must ignore tombstones.
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_personal_workspace(p_user_id uuid, p_name text default 'Soleil'::text)
returns workspaces
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lock_key bigint := hashtextextended('ws_bootstrap:' || p_user_id::text, 0);
  v_ws       workspaces%rowtype;
  v_root_id  uuid;
begin
  perform pg_advisory_xact_lock(v_lock_key);

  select w.* into v_ws
  from workspaces w
  join workspace_members m on m.workspace_id = w.id
  where m.user_id = p_user_id
  order by w.created_at asc
  limit 1;

  if not found then
    insert into workspaces (name, created_by) values (p_name, p_user_id) returning * into v_ws;
    insert into workspace_members (workspace_id, user_id, role)
      values (v_ws.id, p_user_id, 'owner');
  end if;

  -- Always ensure the workspace has at least one root board. Heals
  -- orphan workspaces that the old failing flow left behind, and lets
  -- old (pre-fix) clients work without their createBoard fallback.
  --
  -- 0275: `deleted_at is null` was missing here. Without it this found the
  -- tombstone of a deleted root and skipped the heal, which is the exact
  -- reason the heal never fired for the accounts it was written to rescue.
  select id into v_root_id
  from boards
  where workspace_id = v_ws.id and parent_board_id is null and deleted_at is null
  order by created_at asc
  limit 1;

  if v_root_id is null then
    insert into boards (workspace_id, parent_board_id, name, view, created_by)
      values (v_ws.id, null, 'Studio', 'canvas', p_user_id)
      returning id into v_root_id;
    insert into board_state (board_id, doc) values (v_root_id, '')
      on conflict (board_id) do nothing;
  end if;

  return v_ws;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. A heal that works on ANY workspace, not just the user's oldest.
-- ---------------------------------------------------------------------------
--
-- The unchecked worker. Split out so the backfill at the bottom of this
-- migration can run it as the migration role, without weakening the
-- membership check on the RPC clients actually call.
--
-- NOTE ON AN INVARIANT: CLAUDE.md says move_boards_under is the only path
-- that may write parent_board_id. This function is a deliberate second
-- exception — it is a repair path, not a user-facing move. It only ever
-- touches rows whose parent is already a tombstone, i.e. rows that are
-- unreachable from board_tree and so cannot be moved by any normal means.
create or replace function public._ensure_workspace_root(p_workspace_id uuid, p_actor uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lock_key bigint := hashtextextended('ws_root:' || p_workspace_id::text, 0);
  v_root_id  uuid;
  v_actor    uuid;
begin
  perform pg_advisory_xact_lock(v_lock_key);

  -- De-orphan first: a live board whose parent is a tombstone is unreachable
  -- through board_tree no matter what else is true, so lift it to the top.
  update boards c
     set parent_board_id = null, updated_at = now()
   where c.workspace_id = p_workspace_id
     and c.deleted_at is null
     and c.parent_board_id is not null
     and exists (
       select 1 from boards p
       where p.id = c.parent_board_id and p.deleted_at is not null
     );

  select id into v_root_id
  from boards
  where workspace_id = p_workspace_id and parent_board_id is null and deleted_at is null
  order by created_at asc
  limit 1;

  if v_root_id is not null then
    return v_root_id;
  end if;

  -- Nothing to rescue — give the workspace the same starting shape
  -- create_workspace_with_root would have.
  v_actor := coalesce(p_actor, (select created_by from workspaces where id = p_workspace_id));

  insert into boards (workspace_id, parent_board_id, name, view, created_by)
    values (p_workspace_id, null, 'Studio', 'canvas', v_actor)
    returning id into v_root_id;
  insert into board_state (board_id, doc) values (v_root_id, '')
    on conflict (board_id) do nothing;

  return v_root_id;
end;
$function$;

-- Never callable by a client. `revoke from public` does not cover anon /
-- authenticated, so name them explicitly.
revoke all on function public._ensure_workspace_root(uuid, uuid) from public;
revoke all on function public._ensure_workspace_root(uuid, uuid) from anon;
revoke all on function public._ensure_workspace_root(uuid, uuid) from authenticated;

-- The client-callable wrapper: membership-checked, actor is the caller.
create or replace function public.ensure_workspace_root(p_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'you are not a member of this workspace' using errcode = '42501';
  end if;
  return public._ensure_workspace_root(p_workspace_id, auth.uid());
end;
$function$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, so granting to
-- `authenticated` does not by itself keep anon out — and `revoke from public`
-- alone does not cover anon either. Name both.
revoke all on function public.ensure_workspace_root(uuid) from public;
revoke all on function public.ensure_workspace_root(uuid) from anon;
grant execute on function public.ensure_workspace_root(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stop new occurrences: deleting a cluster must not orphan its children.
-- ---------------------------------------------------------------------------
--
-- Behaviour change, deliberate: live children are adopted by the deleted
-- board's own parent rather than being stranded under a tombstone. For a root
-- (parent null) they become roots. Previously they stayed pointed at the
-- deleted board, which removed them from board_tree with no trash entry and
-- no way back.
create or replace function public.soft_delete_board(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_parent uuid;
begin
  if not public.can_write_board(p_board_id) then
    raise exception 'not authorized to delete board %', p_board_id using errcode = '42501';
  end if;

  select parent_board_id into v_parent from boards where id = p_board_id;

  update boards
     set parent_board_id = v_parent, updated_at = now()
   where parent_board_id = p_board_id
     and deleted_at is null;

  update boards set deleted_at = now(), updated_at = now()
    where id = p_board_id and deleted_at is null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Repair the workspaces already in the broken state.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  n_healed int := 0;
  n_deorphaned int;
begin
  -- Live boards stranded under a tombstone, in workspaces that DO still have a
  -- live root (so _ensure_workspace_root would never be called for them).
  with lifted as (
    update boards c
       set parent_board_id = null, updated_at = now()
     where c.deleted_at is null
       and c.parent_board_id is not null
       and exists (
         select 1 from boards p
         where p.id = c.parent_board_id and p.deleted_at is not null
       )
    returning 1
  )
  select count(*) into n_deorphaned from lifted;

  -- Every member-visible workspace with no live root.
  for r in
    select w.id
    from workspaces w
    where exists (select 1 from workspace_members m where m.workspace_id = w.id)
      and not exists (
        select 1 from boards b
        where b.workspace_id = w.id
          and b.parent_board_id is null
          and b.deleted_at is null
      )
  loop
    perform public._ensure_workspace_root(r.id, null);
    n_healed := n_healed + 1;
  end loop;

  raise notice '0275: de-orphaned % board(s), healed % rootless workspace(s)',
    n_deorphaned, n_healed;
end $$;
