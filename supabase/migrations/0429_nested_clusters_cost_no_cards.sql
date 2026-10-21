-- 0429 — a nested cluster's card costs nothing against the card cap (the
-- cluster-adoption release, 2026-10-21).
--
-- Owner decision (2026-10-18): making a cluster should never be the thing that
-- walls someone, so a cluster weighs 0; the cap itself is unchanged. The client
-- says the same in the same release: gridCount.CLUSTER_CARD_COST is 0, so the
-- cap pre-checks, the folder planner and bulk import stop charging for one.
--
-- (1) _tg_card_weight_by_kind, 0389's live body with one branch added: a row of
--     kind 'board' weighs 0 only when its card_id names a real cluster in the
--     same workspace — a cluster's card is keyed by the cluster's own id. Any
--     other 'board' row weighs 1, so relabelling a note as a board (0403 prices
--     a change of kind) buys nothing. A linked cluster (kind 'boardlink') is
--     not a cluster of yours and keeps weighing 1. The lookup runs as the
--     function's owner (security definer, new here): the caller's read policy
--     on boards must not decide what a row weighs. The id test comes first, in
--     its own IF, so a card_id that is not a uuid never reaches the cast.
--     The cap trigger (card_index_demo_cap_ins) still sorts after this one
--     (0403), so it prices the weight that will be stored; the proof checks it.
--
-- (2) Backfill: every existing cluster card drops to 0. Triggers are off for
--     the update (0254's precedent), or card_index_active_day would stamp a
--     day of work for every cluster's owner and the webhooks would fire for
--     rows nobody touched (the migration refuses to start if any trigger on
--     card_index is already off). _owner_card_count() is unchanged: it sums weight,
--     so every owner's count falls by their cluster count at once.

begin;

create or replace function public._tg_card_weight_by_kind()
returns trigger
language plpgsql
security definer
set search_path = public as $$
begin
  if coalesce(new.kind, 'note') = 'grid' then
    return new;
  elsif new.kind = 'schedule' then
    new.weight := greatest(1, coalesce(new.weight, 1));
  elsif new.kind = 'board' then
    -- 0429: a real cluster in this workspace is free; anything else is a card.
    new.weight := 1;
    if new.card_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      if exists (select 1 from public.boards b
                  where b.id = new.card_id::uuid and b.workspace_id = new.workspace_id) then
        new.weight := 0;
      end if;
    end if;
  else
    new.weight := 1;
  end if;
  return new;
end;
$$;
revoke execute on function public._tg_card_weight_by_kind() from public, anon, authenticated;

-- `enable trigger user` below turns on every user trigger, so it must not meet
-- one that was off on purpose.
do $$
begin
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.card_index'::regclass and not tgisinternal and tgenabled = 'D') then
    raise exception '0429: a card_index trigger is already disabled; the backfill would turn it back on';
  end if;
end $$;

alter table public.card_index disable trigger user;
update public.card_index ci
   set weight = 0
 where ci.kind = 'board'
   and ci.weight is distinct from 0
   and exists (select 1 from public.boards b
                where b.id::text = ci.card_id and b.workspace_id = ci.workspace_id);
alter table public.card_index enable trigger user;

do $$
declare
  v_first text;
  v_left  integer;
begin
  -- The function's grants: a trigger function is no one's to call.
  if has_function_privilege('anon', 'public._tg_card_weight_by_kind()', 'execute')
     or has_function_privilege('authenticated', 'public._tg_card_weight_by_kind()', 'execute') then
    raise exception '0429: _tg_card_weight_by_kind is callable by a client';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public._tg_card_weight_by_kind()'::regprocedure) then
    raise exception '0429: _tg_card_weight_by_kind is not security definer';
  end if;
  -- The weight trigger is still there, enabled, and still fires before the cap.
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.card_index'::regclass
                    and tgname = 'card_index_a_weight_by_kind' and tgenabled <> 'D') then
    raise exception '0429: the weight trigger is missing or disabled';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.card_index'::regclass
                    and tgname = 'card_index_demo_cap_ins' and tgenabled <> 'D') then
    raise exception '0429: the cap trigger is missing or disabled';
  end if;
  select min(tgname::text collate "C") into v_first
    from pg_trigger
   where tgrelid = 'public.card_index'::regclass and not tgisinternal
     and tgname in ('card_index_a_weight_by_kind', 'card_index_demo_cap_ins');
  if v_first is distinct from 'card_index_a_weight_by_kind' then
    raise exception '0429: the weight trigger does not fire before the cap';
  end if;
  -- Every other user trigger on card_index came back on after the backfill.
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.card_index'::regclass and not tgisinternal and tgenabled = 'D') then
    raise exception '0429: a card_index trigger was left disabled';
  end if;
  -- The backfill reached every cluster card, on trashed clusters too (they
  -- come back with a restore). card-count-lint: activity
  select count(*) into v_left
    from public.card_index ci
   where ci.kind = 'board' and ci.weight is distinct from 0
     and exists (select 1 from public.boards b
                  where b.id::text = ci.card_id and b.workspace_id = ci.workspace_id);
  if v_left > 0 then
    raise exception '0429: % cluster cards still weigh something', v_left;
  end if;
end $$;

commit;
