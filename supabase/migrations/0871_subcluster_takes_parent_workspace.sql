-- 0871_subcluster_takes_parent_workspace.sql
--
-- A cluster always lives in its parent's workspace. Older versions of the app
-- broke that when someone invited to edit a shared cluster made a sub-cluster
-- inside it: the new row took the editor's OWN workspace_id while its
-- parent_board_id pointed into the owner's workspace. The app lists a
-- workspace's clusters by workspace_id (listBoards, the Trash), so the owner's
-- workspace never shows the sub-cluster, and the editor's workspace has it
-- with a parent it cannot place. board_tree happens to walk into it, because
-- it follows parent_board_id without re-checking the workspace. The boards
-- insert policy let the row through because the editor can write their own
-- workspace; for the same reason anyone, a viewer or a stranger, could hang a
-- cluster under someone else's cluster by naming their own workspace.
--
-- The app is fixed separately. This is the server's half, for clients still
-- running the old code, and the repair.
--
-- 1. The repair. Every cluster whose parent is in another workspace moves to
--    the parent's workspace, one level at a time, so its sub-clusters follow
--    it on the next pass. With each moved cluster go the rows that record its
--    workspace and belong to the cluster itself: card_index, card_embeddings,
--    group_index, board_meta_history, card_alts, object_props, comments,
--    vote_cards, starred_items and the entity_links it is the source of. Only
--    rows carrying the cluster's old workspace move.
--    * object_identifiers is unique per address per workspace. A stamp whose
--      address is already stamped in the new workspace stays with the card
--      already there, as an import copy's does (1fbb0d9d); the moved card's
--      stamp is dropped rather than left pointing across workspaces.
--    * Tags belong to a workspace. Links and suggestions from a moved cluster
--      to a tag of the old workspace are dropped; tagging resumes against the
--      new workspace's tags.
--    * images is deliberately NOT moved. An images row's storage_path must
--      start with its own workspace_id (the images insert policy), its bytes
--      are charged to that workspace, and an editor's upload into a shared
--      cluster is filed under the editor's workspace on purpose, so rows like
--      these already exist for clusters that were never broken. Pictures are
--      signed through images RLS (sign-reads), which admits a row by its
--      workspace or by its board; the move keeps both true for the owner, the
--      workspace's members and the editor.
--    * Logs and outbound records (notifications, webhook_events, file_views,
--      import_jobs, invites, file shares, media copies) stay as written.
--    * Workspace roots (no parent) are never selected. No card weight changes
--      and no card_index row changes board, so the card-cap trigger does not
--      fire; the cards now count toward the workspace that holds them.
--
-- 2. boards_a_parent_workspace, BEFORE INSERT on boards: when the new row has
--    a parent in another workspace, the row takes the parent's workspace_id.
--    RLS WITH CHECK runs after BEFORE triggers, so the insert policy judges
--    the corrected row: an editor of the parent passes through its
--    "can_write_board(parent) and _board_in_workspace(parent, workspace)"
--    branch, and someone who cannot write the parent is now refused. The name
--    sorts it ahead of the other BEFORE INSERT trigger
--    (boards_parent_must_be_live), and every AFTER trigger sees the corrected
--    row. There is no UPDATE trigger: move_boards_under owns moves and refuses
--    cross-workspace ones. CREATE TRIGGER locks boards against writes until
--    commit, so it comes after the repair and its proofs, last; CREATE OR
--    REPLACE rather than DROP + CREATE, because DROP TRIGGER would lock boards
--    against reads too.
--
-- Checked on production in transactions that were rolled back: the repair
-- moved the clusters it found (none had sub-clusters) with their index,
-- embedding and history rows, and afterwards nothing disagreed with its
-- parent; the owner and the editor read the same cards and pictures before
-- and after. With the trigger, an invited editor's sub-cluster filed under
-- their own workspace landed in the parent's and passed the insert policy, a
-- member's was unchanged, and a viewer's and a stranger's were refused 42501
-- (both were accepted without it).

begin;

-- Waiting on boards behind a long transaction would hold up every cluster
-- write queued behind this one: give up fast and run it again instead.
set local lock_timeout = '2s';

-- ── 1. Repair the clusters already stranded ─────────────────────────────────

create temp table _0871_moved (
  board_id uuid primary key,
  from_ws  uuid not null,
  to_ws    uuid not null
) on commit drop;

do $$
declare
  v_n    int;
  v_pass int := 0;
begin
  loop
    with m as (
      select c.id, c.workspace_id as from_ws, p.workspace_id as to_ws
        from public.boards c
        join public.boards p on p.id = c.parent_board_id
       where c.workspace_id <> p.workspace_id
    ), rec as (
      insert into _0871_moved (board_id, from_ws, to_ws)
      select id, from_ws, to_ws from m
      on conflict (board_id) do update set to_ws = excluded.to_ws
      returning 1
    )
    update public.boards b
       set workspace_id = m.to_ws
      from m
     where b.id = m.id;
    get diagnostics v_n = row_count;
    exit when v_n = 0;
    v_pass := v_pass + 1;
    if v_pass > 64 then
      raise exception '0871: clusters still disagree with their parents after 64 passes';
    end if;
  end loop;
end $$;

-- A cluster that moved twice (a nested case) records its final workspace;
-- its rows still carry the first one.
update public.card_index x set workspace_id = m.to_ws
  from _0871_moved m where x.board_id = m.board_id and x.workspace_id = m.from_ws;
update public.card_embeddings x set workspace_id = m.to_ws
  from _0871_moved m where x.board_id = m.board_id and x.workspace_id = m.from_ws;
update public.group_index x set workspace_id = m.to_ws
  from _0871_moved m where x.board_id = m.board_id and x.workspace_id = m.from_ws;
update public.board_meta_history x set workspace_id = m.to_ws
  from _0871_moved m where x.board_id = m.board_id and x.workspace_id = m.from_ws;
update public.card_alts x set workspace_id = m.to_ws
  from _0871_moved m where x.board_id = m.board_id and x.workspace_id = m.from_ws;
update public.object_props x set workspace_id = m.to_ws
  from _0871_moved m where x.board_id = m.board_id and x.workspace_id = m.from_ws;
update public.comments x set workspace_id = m.to_ws
  from _0871_moved m where x.board_id = m.board_id and x.workspace_id = m.from_ws;
update public.vote_cards x set workspace_id = m.to_ws
  from _0871_moved m where x.board_id = m.board_id and x.workspace_id = m.from_ws;
update public.starred_items x set workspace_id = m.to_ws
  from _0871_moved m where x.board_id = m.board_id and x.workspace_id = m.from_ws;

-- Identifiers: the address already stamped in the new workspace keeps its
-- stamp; the moved card's duplicate goes.
delete from public.object_identifiers x
 using _0871_moved m
 where x.board_id = m.board_id and x.workspace_id = m.from_ws
   and exists (select 1 from public.object_identifiers o
                where o.workspace_id = m.to_ws and o.object_type = x.object_type
                  and o.scope = x.scope and o.value = x.value);
update public.object_identifiers x set workspace_id = m.to_ws
  from _0871_moved m where x.board_id = m.board_id and x.workspace_id = m.from_ws;

-- Tags are per workspace: links and suggestions to the old workspace's tags go.
delete from public.entity_links x
 using _0871_moved m
 where x.source_board_id = m.board_id and x.source_workspace = m.from_ws
   and x.target_kind = 'tag'
   and not exists (select 1 from public.tags t
                    where t.id = x.target_id and t.workspace_id = m.to_ws);
update public.entity_links x set source_workspace = m.to_ws
  from _0871_moved m where x.source_board_id = m.board_id and x.source_workspace = m.from_ws;
delete from public.tag_suggestions x
 using _0871_moved m
 where x.board_id = m.board_id and x.workspace_id = m.from_ws
   and not exists (select 1 from public.tags t
                    where t.id = x.tag_id and t.workspace_id = m.to_ws);
update public.tag_suggestions x set workspace_id = m.to_ws
  from _0871_moved m where x.board_id = m.board_id and x.workspace_id = m.from_ws;

-- The repair's proofs run before the trigger takes its lock on boards.
do $$
begin
  if exists (select 1 from public.boards c
               join public.boards p on p.id = c.parent_board_id
              where c.workspace_id <> p.workspace_id) then
    raise exception '0871: a cluster is still in a different workspace from its parent';
  end if;
  if exists (select 1 from public.card_index x
               join public.boards b on b.id = x.board_id
               join _0871_moved m on m.board_id = b.id
              where x.workspace_id <> b.workspace_id) then
    raise exception '0871: a moved cluster still has card_index rows in its old workspace';
  end if;
end $$;

-- ── 2. A new sub-cluster takes its parent's workspace ───────────────────────

create or replace function public._boards_take_parent_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  if new.parent_board_id is null then
    return new;
  end if;
  select p.workspace_id into v_ws from public.boards p where p.id = new.parent_board_id;
  if v_ws is not null and v_ws is distinct from new.workspace_id then
    new.workspace_id := v_ws;
  end if;
  return new;
end;
$$;
revoke execute on function public._boards_take_parent_workspace() from public, anon, authenticated;

create or replace trigger boards_a_parent_workspace
  before insert on public.boards
  for each row execute function public._boards_take_parent_workspace();

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
begin
  if has_function_privilege('anon', 'public._boards_take_parent_workspace()', 'execute')
     or has_function_privilege('authenticated', 'public._boards_take_parent_workspace()', 'execute') then
    raise exception '0871: a client role can execute _boards_take_parent_workspace';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.boards'::regclass
                    and tgname = 'boards_a_parent_workspace' and not tgisinternal) then
    raise exception '0871: boards_a_parent_workspace is not attached to boards';
  end if;
  -- It must fire first among the BEFORE INSERT row triggers (name order).
  if (select min(tgname) from pg_trigger
       where tgrelid = 'public.boards'::regclass and not tgisinternal
         and (tgtype & 1) = 1      -- row
         and (tgtype & 2) = 2      -- before
         and (tgtype & 4) = 4)     -- insert
     is distinct from 'boards_a_parent_workspace' then
    raise exception '0871: another BEFORE INSERT trigger on boards sorts ahead of boards_a_parent_workspace';
  end if;
end $$;

commit;
