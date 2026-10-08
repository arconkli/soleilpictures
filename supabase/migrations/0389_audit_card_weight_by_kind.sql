-- 0389 — a card's weight follows its kind, whoever writes the row (audit AC-6).
--
-- card_index is written by the browser, and the card cap sums its weight
-- column. cardWeight (boards/src/lib/gridCount.js) says a grid weighs its
-- filled cells, a schedule at least one, and every other card exactly one —
-- but nothing on the server said so, so a note or an image filed with weight
-- 0 cost nothing against the cap.
--
-- This trigger applies the same rule to every insert and update: kinds other
-- than grid and schedule weigh 1, a schedule at least 1. A grid keeps the
-- weight it was given (an empty grid really does weigh nothing; 0346), which
-- leaves one gap: a card filed AS a grid. Closing that needs the board room to
-- write card_index itself — the follow-up, noted in the audit.

begin;

create or replace function public._tg_card_weight_by_kind()
returns trigger
language plpgsql
set search_path = public as $$
begin
  if coalesce(new.kind, 'note') = 'grid' then
    return new;
  elsif new.kind = 'schedule' then
    new.weight := greatest(1, coalesce(new.weight, 1));
  else
    new.weight := 1;
  end if;
  return new;
end;
$$;
revoke execute on function public._tg_card_weight_by_kind() from public, anon, authenticated;

create trigger card_index_weight_by_kind
  before insert or update of weight, kind on public.card_index
  for each row execute function public._tg_card_weight_by_kind();

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.card_index'::regclass and tgname = 'card_index_weight_by_kind') then
    raise exception '0389: the weight trigger is missing';
  end if;
end $$;

commit;
