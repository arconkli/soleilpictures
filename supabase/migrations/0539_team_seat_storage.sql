-- 0539: Teams — a seat brings 1 TB of drive, as Creator does.
--
-- STATUS: written 2026-10-25. Applied 2026-10-26 (owner's go). Goes with the owner's pick of the
-- Team price, $25 a seat a month or $240 a year: a seat costs what Creator
-- costs, so it carries Creator's 1 TB (teamBillingCore.mjs
-- TEAM_SEAT_UNIT_AMOUNT, teamModel.js TEAM_STORAGE_PER_SEAT).
--
-- The team drive stays greatest(1 TB, a seat's drive × seats) plus its 1 TB
-- blocks (0537 _org_storage_quota_bytes); only a seat's share changes, from
-- 250 GB to 1 TB, in the code's unit (1 TiB, as _team_storage_floor_bytes).
-- With the 3-seat minimum the floor no longer binds; it stays as a guard.
-- Rebased on 0537's body, which live matches:
--   _team_storage_seat_bytes  fcf9a52fb377396221d1db3c4c8409ba

begin;

create or replace function public._team_storage_seat_bytes()
returns bigint
language sql
immutable
set search_path = public
as $$
  select 1099511627776::bigint;
$$;
revoke execute on function public._team_storage_seat_bytes() from public, anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'public._team_storage_seat_bytes()', 'execute')
     or has_function_privilege('authenticated', 'public._team_storage_seat_bytes()', 'execute') then
    raise exception '0539: _team_storage_seat_bytes is client-executable';
  end if;
  if public._team_storage_seat_bytes() <> public._team_storage_floor_bytes() then
    raise exception '0539: a seat is not 1 TB';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname = '_team_storage_seat_bytes') <> 1 then
    raise exception '0539: an overload exists (PGRST203)';
  end if;
end $$;

commit;
