-- 0334 — restore_board's cap check counted a live board's cards twice.
--
-- 0333 gave restore_board a cap check and this comment:
--
--   "The board is still soft-deleted here, so _owner_card_count excludes
--    exactly these rows and cannot double count."
--
-- That is true only if the board IS soft-deleted, and nothing enforced it. The
-- single deleted_at predicate in the function sits on the UPDATE at the end —
-- after the raise. So calling restore on a board that is already live counts
-- its cards once in _owner_card_count and again in v_restoring, and refuses
-- with a number the account is not at:
--
--   cap 50, 25 cards elsewhere, a 20-card cluster in the trash.
--   First restore succeeds  → 45/50.
--   Call it again           → _owner_card_count now returns 45, v_restoring is
--                             still 20, 65 > 50, and the caller is told
--                             "would take you to 65 cards, past your limit of
--                             50" for a cluster that is already restored on an
--                             account sitting at 45.
--
-- It is not a corner case. The REST endpoint fetches the board with
-- includeDeleted and calls the RPC unconditionally, every MCP tool call mints
-- a fresh idempotency key so an agent's retry is a real second call, and in the
-- UI the Trash list does not await its own refresh before re-enabling the
-- button — so a double click, a stale second tab, or any retry lands here.
--
-- The fix is the guard the comment assumed. A restore of a board that is not
-- soft-deleted is now a no-op, exactly as it was before 0333: the UPDATE
-- already matched no rows, and the cap must not speak for a board it is
-- already counting.

begin;

create or replace function public.restore_board(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_owner     uuid;
  v_tier      text;
  v_cap       integer;
  v_used      integer;
  v_restoring integer;
  v_deleted   boolean;
begin
  if not public.can_write_board(p_board_id) then
    raise exception 'not authorized to restore board %', p_board_id using errcode = '42501';
  end if;

  -- Is there anything to restore at all? Everything below this line assumes
  -- the board's cards are NOT currently counted against the owner, which is
  -- only true while it is soft-deleted. A live board falls straight through to
  -- the no-op UPDATE it always was.
  select (b.deleted_at is not null) into v_deleted
    from public.boards b where b.id = p_board_id;

  if coalesce(v_deleted, false) then
    -- What this restore hands back. The board is soft-deleted, so
    -- _owner_card_count excludes exactly these rows — now guaranteed, not
    -- assumed.
    select coalesce(sum(ci.weight), 0)::integer into v_restoring
      from public.card_index ci
     where ci.board_id = p_board_id;

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
  end if;

  update boards set deleted_at = null, updated_at = now()
    where id = p_board_id and deleted_at is not null;
end;
$function$;

-- Prove the thing that was wrong: a board that is not soft-deleted must not
-- reach the cap arithmetic at all. Asserted against the live tree rather than
-- described, because 0333's prose already asserted it and the code did not.
do $$
declare
  v_body text;
  v_guard_at int;
  v_count_at int;
begin
  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.proname = 'restore_board';

  v_guard_at := position('deleted_at is not null) into v_deleted' in v_body);
  v_count_at := position('_owner_card_count(v_owner)' in v_body);

  if v_guard_at = 0 then
    raise exception '0334: restore_board has no soft-delete guard';
  end if;
  if v_count_at = 0 then
    raise exception '0334: restore_board no longer consults _owner_card_count';
  end if;
  if v_guard_at > v_count_at then
    raise exception '0334: the soft-delete guard must precede the cap arithmetic';
  end if;

  -- And the grants 0333 set are still what they were.
  if has_function_privilege('anon', 'public.restore_board(uuid)', 'execute')
     or has_function_privilege('public', 'public.restore_board(uuid)', 'execute') then
    raise exception '0334: restore_board is reachable by anon/PUBLIC';
  end if;
  if not has_function_privilege('authenticated', 'public.restore_board(uuid)', 'execute') then
    raise exception '0334: restore_board is not executable by authenticated';
  end if;
end $$;

commit;
