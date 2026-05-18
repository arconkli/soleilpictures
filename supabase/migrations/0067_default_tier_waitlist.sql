-- 0067_default_tier_waitlist.sql — every new account starts on the
-- waitlist instead of demo. The user has to either be auto-accepted
-- (cron flips waitlist→demo) or pay (stripe webhook flips →paid)
-- before they can use the app.
--
-- Existing profile rows are NOT touched — the 4 accounts already in
-- the DB keep their grandfathered admin/demo tiers.

alter table public.profiles alter column tier set default 'waitlist';

create or replace function public.ensure_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, tier)
  values (new.id, 'waitlist')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
-- trigger already exists from 0065; no need to re-create.
