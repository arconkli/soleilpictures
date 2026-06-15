-- 0143_staging_redirect.sql
-- Staging-preview auto-redirect for admins/testers.
--
-- get_staging_redirect() returns the current preview ("latest build") URL, but
-- ONLY for eligible users (admins OR the internal_accounts allowlist — the
-- founder is tier=demo but allowlisted) and ONLY while the stored URL is fresh
-- (set within 14 days, so an abandoned/stale URL auto-disables the redirect and
-- never strands anyone). Everyone else gets null and is never redirected.
--
-- The client (src/lib/stagingRedirect.js) calls this on the prod domain; on a
-- non-null result it redirects the admin to that URL with their Supabase session
-- handed off in the URL hash, which AuthGate.consumeAuthCallback() already adopts.
--
-- security definer so it can read app_config + internal_accounts (both admin-only
-- RLS) on behalf of a non-admin internal user. Returns only a single URL string;
-- no data leak. anon EXECUTE revoked (Supabase default-grants it otherwise).
create or replace function public.get_staging_redirect()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_admin()
      or exists (select 1 from public.internal_accounts ia where ia.user_id = auth.uid())
    then (
      select c.value->>'url'
        from public.app_config c
       where c.key = 'staging_url'
         and nullif(c.value->>'url', '') is not null
         and coalesce((c.value->>'updated_at')::timestamptz, to_timestamp(0))
               > now() - interval '14 days'
    )
    else null
  end;
$$;

revoke all on function public.get_staging_redirect() from public;
grant execute on function public.get_staging_redirect() to authenticated;
revoke execute on function public.get_staging_redirect() from anon;

-- Holds the current preview URL. Updated after each push to main (the value is
-- {"url": "...", "updated_at": "<iso ts>"}); seeded empty so the feature is
-- dormant until a URL is set. app_config already has admin-only RLS (0113).
insert into public.app_config (key, value)
  values ('staging_url', jsonb_build_object('url', null, 'updated_at', null))
  on conflict (key) do nothing;
