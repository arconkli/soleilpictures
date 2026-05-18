-- 0073_fix_admin_profile_recursion.sql — fix RLS recursion on profiles.
--
-- The "admin read all profiles" policy added in 0070 had an inline
-- `exists (select 1 from public.profiles p where ... and p.tier = 'admin')`
-- check. That subselect re-enters the same RLS policy on profiles →
-- infinite recursion → every query that mentions profiles in its policy
-- chain errors with 42P17.
--
-- The visible symptom: WaitlistConfirm calls
--   select ... from waitlist_entries where email = $1
-- which has its own "waitlist read admin" policy that ALSO queries
-- profiles. PostgREST surfaces the recursion as a generic error and the
-- client sees no rows → "No waitlist entry found".
--
-- Fix: replace the inline EXISTS with a SECURITY DEFINER `is_admin()`
-- function. Security-definer functions run with the function owner's
-- privileges and bypass RLS on the tables they read, so the recursion
-- is broken cleanly. Both the waitlist_entries admin policy and the
-- profiles admin-read policy switch over to it.

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select tier from public.profiles where user_id = auth.uid()),
    'demo'
  ) = 'admin';
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Rewrite the profiles admin-read policy to use is_admin() instead of
-- a recursive EXISTS on profiles.
drop policy if exists "admin read all profiles" on public.profiles;
create policy "admin read all profiles" on public.profiles for select
  using (public.is_admin());

-- Same fix on the waitlist_entries admin policy. (The "waitlist read
-- self" policy is fine — it only consults auth.jwt().)
drop policy if exists "waitlist read admin" on public.waitlist_entries;
create policy "waitlist read admin" on public.waitlist_entries for select
  using (public.is_admin());

-- And on the subscriptions admin policy from 0065.
drop policy if exists "subs read admin" on public.subscriptions;
create policy "subs read admin" on public.subscriptions for select
  using (public.is_admin());
