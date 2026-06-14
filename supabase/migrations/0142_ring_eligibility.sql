-- 0142_ring_eligibility.sql
-- Canary "ring" eligibility for the staging-preview pipeline.
--
-- am_i_ring_eligible() answers "should this user be auto-routed to the latest
-- (staging) build on the real domain?" — true for admins AND for the
-- internal_accounts allowlist (the founder/test accounts, which are tier='demo'
-- but explicitly allowlisted in 0110). The Cloudflare prod Worker calls this
-- with the caller's JWT from POST /api/ring/join; on true it mints the signed
-- soleil_ring cookie and from then on proxies that user's requests to the
-- staging Worker. Mirrors the gating set of _internal_user_ids() (0110) but is
-- callable by the requesting user as themselves.
--
-- security definer so it can read internal_accounts (admin-only RLS, 0110)
-- on behalf of a non-admin internal user; it only ever returns the caller's
-- OWN boolean, so there is no data leak. auth.uid() is null for anon/service
-- callers → returns false (fail closed); grant is authenticated-only.
create or replace function public.am_i_ring_eligible()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.internal_accounts ia
      where ia.user_id = auth.uid()
    );
$$;

revoke all on function public.am_i_ring_eligible() from public;
grant execute on function public.am_i_ring_eligible() to authenticated;
-- Supabase default privileges auto-grant EXECUTE to anon on new public
-- functions; revoke it explicitly. The Worker only ever calls this as an
-- authenticated user, and anon would get false anyway (fail-closed), but this
-- keeps it off the exposed API and clears the security advisor.
revoke execute on function public.am_i_ring_eligible() from anon;
