-- 0403 — Three ways around the card cap, closed (audit DB-07, DB-08, DB-09).
--
-- The app never sends any of these requests; each takes a hand-made call. They
-- matter because the cap is the one thing a free account is metered by, and
-- 0333/0389 each closed a path like them.
--
-- DB-07. card_index_demo_cap_ins and card_index_weight_by_kind are both BEFORE
-- ROW triggers, and those fire in name order: the cap priced the weight the
-- client SENT, and 0389's rule rewrote it afterwards. {kind:'note', weight:0}
-- cost nothing and was stored as 1. Worse, the cap fired only on UPDATE OF
-- weight, so turning an empty grid (weight 0) into a note by changing `kind`
-- alone was never priced at all, while the weight trigger still made it 1.
-- The weight trigger is renamed so it sorts first, and the cap now also fires
-- on `kind`: it always prices the weight that will be stored.
--
-- DB-08. A card moved by UPDATE into a cluster another person owns (the API's
-- cards/move does exactly that) cost the new owner nothing: the delta was
-- new.weight - old.weight = 0, and the trigger did not even fire on board_id.
-- A move onto a meter that never counted the card — another owner's, or out
-- of a cluster in the Trash — now costs what an insert would.
--
-- DB-09. A direct PATCH of boards.deleted_at back to null took a cluster out
-- of the Trash without restore_board's cap check (boardsApi dropped its own
-- fallback for this reason, and the RLS UPDATE policy cannot see the column).
-- Only a definer function — restore_board, the rewind, the 0275/0396 repairs —
-- may clear deleted_at now. Definer functions run as their owner, so the
-- trigger refuses only the caller's own UPDATE; soft-deleting by UPDATE
-- (deleteBoard's fallback) is untouched.
--
-- The cap formula and _owner_card_count are unchanged.

begin;

-- DB-07: the normaliser runs before the meter.
alter trigger card_index_weight_by_kind on public.card_index rename to card_index_a_weight_by_kind;

create or replace function public.enforce_demo_card_cap_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_tier  text;
  v_count integer;
  v_cap   integer;
  v_delta integer;
begin
  if tg_op = 'INSERT' and exists (
    select 1 from public.card_index
     where board_id = new.board_id and card_id = new.card_id
  ) then
    return new;
  end if;
  -- INSERT costs the row's own weight: an empty grid weighs 0 (0346).
  -- new.weight is already normalised: card_index_a_weight_by_kind sorts first (0403).
  v_delta := case when tg_op = 'UPDATE'
                  then greatest(coalesce(new.weight, 1) - coalesce(old.weight, 1), 0)
                  else greatest(coalesce(new.weight, 1), 0) end;
  -- 0403: a card moved onto a meter that never counted it (another owner's
  -- cluster, or out of one in the Trash) costs what an insert would.
  if tg_op = 'UPDATE' and new.board_id is distinct from old.board_id
     and (public.board_workspace_owner(new.board_id) is distinct from public.board_workspace_owner(old.board_id)
          or exists (select 1 from public.boards b where b.id = old.board_id and b.deleted_at is not null)) then
    v_delta := greatest(coalesce(new.weight, 1), 0);
  end if;
  if v_delta = 0 then
    return new;
  end if;
  v_owner := public.board_workspace_owner(new.board_id);
  if v_owner is null then
    return new;
  end if;
  select tier, coalesce(card_cap_base, 50) + coalesce(bonus_card_credits, 0)
    into v_tier, v_cap
    from public.profiles where user_id = v_owner;
  if v_tier is distinct from 'demo' then
    return new;
  end if;
  v_count := public._owner_card_count(v_owner);
  if v_count + v_delta > coalesce(v_cap, 50) then
    raise exception
      'Demo accounts are limited to % cards. Invite friends or upgrade to add more.', coalesce(v_cap, 50)
      using errcode = '42501';
  end if;
  return new;
end $function$;

-- DB-07/DB-08: price a change of kind and a move, not only a change of weight.
create or replace trigger card_index_demo_cap_ins
  before insert or update of weight, kind, board_id on public.card_index
  for each row execute function public.enforce_demo_card_cap_trg();

-- DB-09: out of the Trash only through restore_board.
create or replace function public._boards_restore_by_rpc_only()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.deleted_at is not null and new.deleted_at is null
     and current_user in ('authenticated', 'anon') then
    raise exception 'Restore a cluster from the Trash'
      using errcode = '42501', hint = 'restore_board';
  end if;
  return new;
end $function$;

revoke execute on function public._boards_restore_by_rpc_only() from public, anon, authenticated;

create or replace trigger boards_restore_by_rpc_only
  before update of deleted_at on public.boards
  for each row execute function public._boards_restore_by_rpc_only();

do $$
declare
  v_first text;
begin
  -- The order is the fix: BEFORE ROW triggers fire in byte order of their
  -- names, so the normaliser must sort before the meter.
  select min(tgname::text collate "C") into v_first
    from pg_trigger
   where tgrelid = 'public.card_index'::regclass and not tgisinternal
     and tgname in ('card_index_a_weight_by_kind', 'card_index_demo_cap_ins');
  if v_first is distinct from 'card_index_a_weight_by_kind' then
    raise exception '0403: the weight trigger does not fire before the cap';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.boards'::regclass
                    and tgname = 'boards_restore_by_rpc_only' and tgenabled <> 'D') then
    raise exception '0403: boards_restore_by_rpc_only is missing';
  end if;
  if has_function_privilege('authenticated', 'public._boards_restore_by_rpc_only()', 'execute')
     or has_function_privilege('anon', 'public._boards_restore_by_rpc_only()', 'execute') then
    raise exception '0403: grants are wrong on _boards_restore_by_rpc_only';
  end if;
end $$;

commit;
