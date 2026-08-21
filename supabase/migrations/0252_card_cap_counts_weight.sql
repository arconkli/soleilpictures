-- 0252 — the card cap counts WEIGHT, on UPDATE too.
--
-- The cap trigger (card_index_demo_cap_ins) was BEFORE INSERT only and its
-- check ignored NEW.weight entirely, which left two holes in the "the trigger
-- is what actually blocks" contract:
--
--   • grid-cell fills grow an EXISTING card_index row's weight via the sync's
--     upsert — an UPDATE, which no trigger examined. A demo account could
--     exceed its cap without limit by filling grid cells (the client gate is
--     best-effort and reads a cached count).
--   • a weight-25 filled grid INSERTed at 49/50 passed the `count >= cap`
--     check and landed the owner at 74/50 in one statement (duplicate of a
--     filled grid near the cap did exactly this).
--
-- The check now charges the weight DELTA — full weight on a fresh insert, the
-- increase on an update — and the trigger fires on weight growth. Weight
-- DECREASE is always allowed so a user at the wall can always free space.
--
-- Boundary semantics are unchanged for weight-1 cards: at 49/50 an add passes
-- (49+1 > 50 is false), at 50/50 it raises — same 42501 message the client's
-- rejection round-trip already parses (boardsApi.js `limited to N cards`).
--
-- Note on moves: moving a card across boards has always inserted a new
-- (board_id, card_id) pair before the old one is removed, so a move at the
-- wall could already be refused; with weight charging this now applies to a
-- grid's full weight. Deliberate — the alternative is the 74/50 hole above.

create or replace function public.enforce_demo_card_cap_trg()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_owner uuid;
  v_tier  text;
  v_count integer;
  v_cap   integer;
  v_delta integer;
begin
  -- Idempotent re-insert of a known pair (the sync's upsert conflict path
  -- charges through the UPDATE branch instead).
  if tg_op = 'INSERT' and exists (
    select 1 from public.card_index
     where board_id = new.board_id and card_id = new.card_id
  ) then
    return new;
  end if;
  v_delta := case when tg_op = 'UPDATE'
                  then greatest(coalesce(new.weight, 1) - coalesce(old.weight, 1), 0)
                  else greatest(coalesce(new.weight, 1), 1) end;
  if v_delta = 0 then
    return new;   -- unchanged or shrinking weight — always allowed
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
  select coalesce(sum(ci.weight), 0) into v_count
    from public.card_index ci
    join public.boards b     on b.id = ci.board_id
    join public.workspaces w on w.id = b.workspace_id
   where w.created_by = v_owner;
  if v_count + v_delta > coalesce(v_cap, 50) then
    raise exception
      'Demo accounts are limited to % cards. Invite friends or upgrade to add more.', coalesce(v_cap, 50)
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists card_index_demo_cap_ins on public.card_index;
create trigger card_index_demo_cap_ins
  before insert or update of weight on public.card_index
  for each row execute function public.enforce_demo_card_cap_trg();
