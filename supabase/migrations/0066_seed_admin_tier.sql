-- 0066_seed_admin_tier.sql — pre-seed admin tier for the two founder
-- accounts. Preserves all existing data; only flips the tier column.
--
-- Every other existing user keeps the default 'demo' tier from 0065.
-- Their existing cards/boards stay editable (workspace member rules
-- still apply); they just hit the 100-card cap on new card additions.

update public.profiles
   set tier = 'admin'
 where user_id in (
   select id from auth.users
    where lower(email) in ('andrew@andrewconklin.com', 'pchristopher205@gmail.com')
 );

-- Defensive: if the profile row didn't exist yet for these accounts
-- (e.g. they never opened the app post-0030_profiles), the 0065 trigger
-- backfill already inserted one. The UPDATE above just flips its tier.
