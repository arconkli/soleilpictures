-- profiles.demo_card_count was a cache of a number nothing now reads.
--
-- It was never a lifetime total and could not be made into one: it moved only
-- while tier = 'demo', it decremented on card_index row DELETE, and
-- purge_old_deleted_boards()'s cascade never decremented it at all -- so once a
-- deleted cluster aged out at 30 days its cards were overstated permanently.
-- It was also keyed on boards.created_by, a third key agreeing with neither
-- the cap nor a lifetime reading, and clamped with greatest(0, ...) on the way
-- down. 0339 moved its last reader (admin_user_detail) onto
-- _owner_card_counts.
--
-- get_my_tier() returns an output column of the same name whose VALUE is
-- _owner_card_count(u.id). That is the authoritative number, it is what
-- useMyTier.js and create-checkout-session read, and it is untouched here.
--
-- Dropping the triggers also removes an UPDATE on public.profiles from every
-- single card insert: a bulk drop of n cards took n sequential row locks on
-- one profile row, on the same statement as the cap check.
--
-- No CASCADE on the column drop, deliberately. If anything still depends on
-- it, this must fail loudly rather than take the dependency down with it.

drop trigger if exists card_index_demo_count_ins on public.card_index;
drop trigger if exists card_index_demo_count_del on public.card_index;
drop function if exists public.bump_demo_card_count_trg();
alter table public.profiles drop column if exists demo_card_count;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'demo_card_count'
  ) then
    raise exception 'profiles.demo_card_count still exists';
  end if;

  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.card_index'::regclass
       and not tgisinternal
       and tgname in ('card_index_demo_count_ins', 'card_index_demo_count_del')
  ) then
    raise exception 'the demo card counter triggers still exist';
  end if;

  -- The cap trigger must survive. Dropping it would make the cap decorative.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.card_index'::regclass
       and not tgisinternal
       and tgname = 'card_index_demo_cap_ins'
  ) then
    raise exception 'card_index_demo_cap_ins is missing -- the cap is unenforced';
  end if;

  -- get_my_tier must still resolve, and must still return the authoritative
  -- count rather than the column that just went away.
  if pg_get_functiondef('public.get_my_tier()'::regprocedure) ilike '%p.demo_card_count%' then
    raise exception 'get_my_tier still reads the dropped column';
  end if;
  if pg_get_functiondef('public.get_my_tier()'::regprocedure) not ilike '%_owner_card_count(u.id)%' then
    raise exception 'get_my_tier no longer computes _owner_card_count';
  end if;
end $$;
