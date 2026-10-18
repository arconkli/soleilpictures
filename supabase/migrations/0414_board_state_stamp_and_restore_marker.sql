-- 0414 — board_state's updated_at is the database's, and a restore says so.
--
-- The party moved off PartyKit in October 2026 to a board room that never
-- overwrites what it has not seen: every flush is a compare-and-set on
-- board_state.updated_at (boards/src/lib/boardRoomState.js). Until now that
-- token was whatever each writer sent — a browser's clock, a room's, the API's
-- — so two writes could carry the same instant, and a future writer that left
-- the column out would slip past the check.
--
-- 1. A BEFORE INSERT OR UPDATE trigger sets updated_at := clock_timestamp() on
--    every write. Every current writer already sends updated_at (the browser's
--    saveBoardSnapshot, /api/v1 through scoutInsert, both rooms,
--    perform_board_restore, the workspace-root inserts), so none of them
--    changes behaviour; each now gets back a unique, server-assigned value.
--
-- 2. mark_board_restored(p_board_id): the restore marker. bulletproofRestore
--    (version history, the drag safety net) REPLACES a board: it writes an
--    older version to board_state, then resets the room. perform_board_restore
--    (workspace rewind) already advances board_state_version.version when it
--    does the same; this lets the client do it too, right after its write. The
--    room treats a foreign write that comes with an advanced version as a
--    restore and resets itself instead of merging it, so a restore now holds
--    even when its /reset is late or fails. Advancing version also emits
--    board_restore_events (0097), so every open copy of the board reloads.
--    can_write_board decides, and it already refuses a suspended account.

begin;

-- board_state is written every few seconds by every open board; give up
-- rather than queue them.
set local lock_timeout = '5s';

create or replace function public._board_state_stamp()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke execute on function public._board_state_stamp() from public, anon, authenticated;

drop trigger if exists board_state_stamp on public.board_state;
create trigger board_state_stamp
  before insert or update on public.board_state
  for each row execute function public._board_state_stamp();

create or replace function public.mark_board_restored(p_board_id uuid)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_version bigint;
begin
  if p_board_id is null then
    raise exception 'a board id is required' using errcode = '22023';
  end if;
  if auth.uid() is null or not public.can_write_board(p_board_id) then
    raise exception 'not allowed to restore this board' using errcode = '42501';
  end if;
  insert into public.board_state_version (board_id) values (p_board_id)
  on conflict (board_id) do nothing;
  update public.board_state_version
     set version = version + 1
   where board_id = p_board_id
  returning version into v_version;
  return v_version;
end;
$$;

revoke execute on function public.mark_board_restored(uuid) from public, anon;
grant execute on function public.mark_board_restored(uuid) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.mark_board_restored(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.mark_board_restored(uuid)', 'execute')
     or has_function_privilege('anon', 'public._board_state_stamp()', 'execute')
     or has_function_privilege('authenticated', 'public._board_state_stamp()', 'execute') then
    raise exception '0414: grants are wrong';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.board_state'::regclass
                    and tgname = 'board_state_stamp' and not tgisinternal) then
    raise exception '0414: the stamp trigger is missing';
  end if;
end $$;

commit;
