-- 0346 — an empty grid costs no card.
--
-- The demo card cap sums card_index.weight. A grid's weight is meant to be its
-- filled cells (boards/src/lib/gridCount.js), but the client wrote
-- max(1, filled), and this trigger independently forced every INSERT to cost at
-- least one:
--
--     greatest(coalesce(new.weight, 1), 1)
--
-- so an empty grid always spent a card. Generate matrix stamps a grid into an
-- N×M family of separate grid cards — the docs call the result "an empty N×M
-- grid" — and a 5×5 storyboard spent half of a free account before a single
-- frame was drawn. People were walled within minutes of signing up by frames
-- with nothing in them, while canvas/grids.md promised an empty box "adds
-- nothing to your card count".
--
-- The client now writes weight 0 for an empty grid, and for a grid whose only
-- text is the sequence label every stamped copy carries. This migration lets the
-- trigger take the row at its word: the INSERT delta is the row's weight, so a
-- zero-weight insert takes the existing `v_delta = 0` early return. UPDATE is
-- unchanged: a lowered weight already passes, and a raised one is still checked.
--
-- CHECK (weight >= 0). There has never been a constraint, so a negative weight
-- would have SUBTRACTED from the meter. The derived-table spec (2026-09-29,
-- Phase A) asks for `weight > 0`; with an empty grid now legitimately weighing
-- 0, the bound is `>= 0`, and the spec is amended to say so. No existing row
-- violates it (every weight today is between 1 and 8).
--
-- No backfill. card_index.meta cannot re-weigh a grid faithfully — it stores
-- labels already resolved ("01", not "[#]"), stops at 60 cells, and drops the
-- link/file/board identifiers isCellFilled reads. And lowering weights before the
-- new client ships would be undone by the old one, which re-sends weight 1 and,
-- at the cap, gets that raise refused — failing the board's whole retry batch.
-- Each board re-weighs its grids on its next sync instead (the sync signature
-- includes weight), and a lowered weight always passes.
--
-- (0341–0344 are reserved by the card_index derived-table spec.)

alter table public.card_index
  add constraint card_index_weight_nonnegative check (weight >= 0);

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
  v_delta := case when tg_op = 'UPDATE'
                  then greatest(coalesce(new.weight, 1) - coalesce(old.weight, 1), 0)
                  else greatest(coalesce(new.weight, 1), 0) end;
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

-- Proofs. CREATE OR REPLACE keeps the function's ACL, and a REVOKE reporting
-- success proves nothing, so check the state rather than assert it.
do $$
begin
  if has_function_privilege('anon', 'public.enforce_demo_card_cap_trg()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enforce_demo_card_cap_trg()', 'EXECUTE') then
    raise exception '0346: a client role can execute enforce_demo_card_cap_trg';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.card_index'::regclass
       and conname = 'card_index_weight_nonnegative' and contype = 'c'
  ) then
    raise exception '0346: card_index_weight_nonnegative is missing';
  end if;
  if position('greatest(coalesce(new.weight, 1), 0)' in
             pg_get_functiondef('public.enforce_demo_card_cap_trg()'::regprocedure)) = 0 then
    raise exception '0346: the INSERT delta still forces a minimum of 1';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.card_index'::regclass
       and tgname = 'card_index_demo_cap_ins' and not tgisinternal
  ) then
    raise exception '0346: the cap trigger is no longer attached to card_index';
  end if;
end $$;
