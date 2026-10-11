-- 0396 — Deleting a cluster takes its sub-clusters with it, and restoring it
-- brings them back together (audit APP-CORE-02, DB-01, DB-X1, DB-02).
--
-- Until now soft_delete_board re-homed a cluster's live sub-clusters onto its
-- parent before trashing it (0275). On the canvas that spilled every
-- sub-cluster onto the parent the moment you deleted the cluster that held
-- them, the delete's Undo sat buried under the spill, and restoring the
-- cluster brought it back empty. Separately, three paths could leave a LIVE
-- cluster parented to a trashed one, where nothing can reach it and where the
-- purge's ON DELETE CASCADE later destroyed it with all its cards:
--   * restoring a sub-cluster whose parent is still in the trash (DB-01),
--   * "Delete forever" on a trashed cluster that still has live children (DB-X1),
--   * creating a cluster inside one another tab had just deleted (DB-02).
--
-- Now:
--   * soft_delete_board trashes the cluster and every live descendant as ONE
--     batch: they all get the same deleted_at. Deleting a workspace root keeps
--     the 0275 re-home, so a workspace never loses its tree.
--   * restore_board restores the batch (the cluster plus the descendants that
--     were deleted with it) and checks the card cap against all of them. If
--     the cluster's parent is still in the trash, it comes back under its
--     nearest live ancestor, or the workspace root, instead of nowhere. That
--     is a third repair path allowed to write parent_board_id, next to the two
--     in 0275, and like them it only touches a row nothing else can reach.
--   * a BEFORE DELETE trigger lifts the live children of a trashed cluster
--     onto that same home before the purge or "Delete forever" removes it, so
--     the cascade only ever takes trashed rows. It stands aside while a whole
--     workspace is being deleted (the workspace row is already gone then).
--   * a BEFORE INSERT / UPDATE OF parent_board_id trigger refuses a parent
--     that is in the trash or missing: "That cluster was deleted".
--   * the live clusters stranded under a trashed parent today are lifted the
--     same way.
--
-- soft_delete_board and restore_board keep their signatures, so create or
-- replace keeps their ACL. The new helpers are server-only (the 0311 rule).
-- The blocks at the end prove the grants and that nothing is left stranded.

begin;

-- Nearest live ancestor of a board, walking up through trashed parents. Null
-- when every ancestor is in the trash, or the board has no parent.
create or replace function public._nearest_live_ancestor(p_board_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive up(id, parent_board_id, deleted_at, depth) as (
    select p.id, p.parent_board_id, p.deleted_at, 1
      from public.boards b
      join public.boards p on p.id = b.parent_board_id
     where b.id = p_board_id
    union all
    select p.id, p.parent_board_id, p.deleted_at, up.depth + 1
      from up
      join public.boards p on p.id = up.parent_board_id
     where up.deleted_at is not null
       and up.depth < 64
  )
  select id from up where deleted_at is null order by depth limit 1;
$$;

-- Where a board goes when its own parent cannot hold it: the nearest live
-- ancestor, else the workspace's live root (the oldest one, as board_tree
-- anchors on it).
create or replace function public._live_home_for(p_board_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public._nearest_live_ancestor(p_board_id),
    (select r.id
       from public.boards r
      where r.workspace_id = (select b.workspace_id from public.boards b where b.id = p_board_id)
        and r.parent_board_id is null
        and r.deleted_at is null
        and r.id <> p_board_id
      order by r.created_at asc
      limit 1)
  );
$$;

revoke execute on function public._nearest_live_ancestor(uuid) from public, anon, authenticated;
revoke execute on function public._live_home_for(uuid) from public, anon, authenticated;

-- soft_delete_board was still executable by anon through PUBLIC. can_write_board
-- refused every anonymous call anyway; this makes the ACL say what it means.
revoke execute on function public.soft_delete_board(uuid) from public, anon;
grant execute on function public.soft_delete_board(uuid) to authenticated, service_role;

create or replace function public.soft_delete_board(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_parent uuid;
  v_now    timestamptz := now();
begin
  if not public.can_write_board(p_board_id) then
    raise exception 'not authorized to delete board %', p_board_id using errcode = '42501';
  end if;
  select parent_board_id into v_parent from boards where id = p_board_id;

  if v_parent is null then
    -- A workspace root (0275): its children move up, so the workspace keeps a
    -- tree for board_tree to anchor on.
    update boards set parent_board_id = v_parent, updated_at = v_now
     where parent_board_id = p_board_id and deleted_at is null;
    update boards set deleted_at = v_now, updated_at = v_now
      where id = p_board_id and deleted_at is null;
    return;
  end if;

  -- One batch: the cluster and every live descendant share this deleted_at,
  -- which is how restore_board brings them back together.
  with recursive sub(id, depth) as (
    select p_board_id, 0
    union all
    select b.id, sub.depth + 1
      from boards b
      join sub on b.parent_board_id = sub.id
     where b.deleted_at is null
       and sub.depth < 64
  )
  update boards set deleted_at = v_now, updated_at = v_now
   where id in (select id from sub)
     and deleted_at is null;
end;
$function$;

create or replace function public.restore_board(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_owner      uuid;
  v_tier       text;
  v_cap        integer;
  v_used       integer;
  v_restoring  integer;
  v_deleted    boolean;
  v_deleted_at timestamptz;
  v_parent     uuid;
  v_home       uuid;
  v_batch      uuid[];
begin
  if not public.can_write_board(p_board_id) then
    raise exception 'not authorized to restore board %', p_board_id using errcode = '42501';
  end if;

  select (b.deleted_at is not null) into v_deleted
    from public.boards b where b.id = p_board_id;

  if coalesce(v_deleted, false) then
    select b.deleted_at, b.parent_board_id into v_deleted_at, v_parent
      from public.boards b where b.id = p_board_id;

    -- The batch soft_delete_board trashed together: this cluster plus the
    -- descendants that carry the same deleted_at.
    with recursive sub(id, depth) as (
      select p_board_id, 0
      union all
      select b.id, sub.depth + 1
        from public.boards b
        join sub on b.parent_board_id = sub.id
       where b.deleted_at = v_deleted_at
         and sub.depth < 64
    )
    select array_agg(id) into v_batch from sub;

    select coalesce(sum(ci.weight), 0)::integer into v_restoring
      from public.card_index ci
     where ci.board_id = any(v_batch);

    if v_restoring > 0 then
      v_owner := public.board_workspace_owner(p_board_id);
      if v_owner is not null then
        select p.tier, coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
          into v_tier, v_cap
          from public.profiles p where p.user_id = v_owner;
        if v_tier is not distinct from 'demo' then
          v_used := public._owner_card_count(v_owner);
          if v_used + v_restoring > coalesce(v_cap, 50) then
            raise exception
              'Restoring this cluster would take you to % cards, past your limit of %. Delete some cards first, or upgrade to Creator.',
              v_used + v_restoring, coalesce(v_cap, 50)
              using errcode = '42501';
          end if;
        end if;
      end if;
    end if;

    -- A parent still in the trash would leave the cluster reachable from
    -- nowhere, and doomed when the purge cascades from that parent: bring it
    -- back under the nearest live ancestor, or the workspace root, instead.
    if v_parent is not null
       and exists (select 1 from public.boards p where p.id = v_parent and p.deleted_at is not null) then
      v_home := public._live_home_for(p_board_id);
      if v_home is not null then
        update boards set parent_board_id = v_home, updated_at = now()
         where id = p_board_id;
      end if;
    end if;

    update boards set deleted_at = null, updated_at = now()
      where id = any(v_batch) and deleted_at = v_deleted_at;
  end if;
end;
$function$;

-- The purge and "Delete forever" remove a trashed cluster; the self-FK then
-- cascades to its children. Lift the LIVE ones first, so only trashed rows
-- can ever go with it.
create or replace function public._boards_rehome_live_children()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_home uuid;
begin
  if old.deleted_at is null
     or not exists (select 1 from public.workspaces w where w.id = old.workspace_id)
     or not exists (select 1 from public.boards c
                     where c.parent_board_id = old.id and c.deleted_at is null) then
    return old;
  end if;
  v_home := public._live_home_for(old.id);
  if v_home is not null and v_home <> old.id then
    update public.boards set parent_board_id = v_home, updated_at = now()
     where parent_board_id = old.id and deleted_at is null;
  end if;
  return old;
end;
$$;

create trigger boards_rehome_live_children
  before delete on public.boards
  for each row execute function public._boards_rehome_live_children();

-- A cluster cannot be created in, or moved into, one that is in the trash.
create or replace function public._boards_parent_must_be_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_board_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parent_board_id is not distinct from old.parent_board_id then
    return new;
  end if;
  if not exists (select 1 from public.boards p
                  where p.id = new.parent_board_id and p.deleted_at is null) then
    raise exception 'That cluster was deleted' using errcode = '23503',
      hint = 'parent_board_deleted';
  end if;
  return new;
end;
$$;

create trigger boards_parent_must_be_live
  before insert or update of parent_board_id on public.boards
  for each row execute function public._boards_parent_must_be_live();

-- Bring back the live clusters stranded under a trashed parent today.
update public.boards c
   set parent_board_id = public._live_home_for(c.id), updated_at = now()
 where c.deleted_at is null
   and c.parent_board_id is not null
   and exists (select 1 from public.boards p
                where p.id = c.parent_board_id and p.deleted_at is not null)
   and public._live_home_for(c.id) is not null;

do $$
begin
  if has_function_privilege('anon', 'public.soft_delete_board(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.soft_delete_board(uuid)', 'execute')
     or has_function_privilege('anon', 'public.restore_board(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.restore_board(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._nearest_live_ancestor(uuid)', 'execute')
     or has_function_privilege('anon', 'public._nearest_live_ancestor(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._live_home_for(uuid)', 'execute')
     or has_function_privilege('anon', 'public._live_home_for(uuid)', 'execute') then
    raise exception '0396: grants are wrong';
  end if;
  if exists (select 1 from public.boards c
               join public.boards p on p.id = c.parent_board_id
              where c.deleted_at is null and p.deleted_at is not null) then
    raise exception '0396: a live cluster is still parented to a trashed one';
  end if;
end $$;

commit;
