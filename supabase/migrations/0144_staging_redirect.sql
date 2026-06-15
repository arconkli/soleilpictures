-- 0144_staging_redirect.sql  (renumbered from 0143 to avoid colliding with
-- 0143_showcase_clone.sql from a concurrent change)
--
-- Staging-preview auto-redirect for admins/testers. get_staging_redirect()
-- returns the current preview ("latest build") URL, but ONLY for eligible users
-- (admins OR the internal_accounts allowlist — the founder is tier=demo but
-- allowlisted). Everyone else gets null and is never redirected.
--
-- We point app_config.staging_url at Cloudflare's STABLE per-branch preview
-- alias (https://main-soleil-boards.<sub>.workers.dev), which always serves the
-- latest main build — so it's set once and never goes stale, and there is no
-- time-based freshness gate (unlike the earlier per-version-URL design). To
-- disable the redirect, set app_config.staging_url.url to null.
--
-- security definer so it can read app_config + internal_accounts (both admin-only
-- RLS) on behalf of a non-admin internal user. Returns only a URL string; no data
-- leak. anon EXECUTE revoked (Supabase default-grants it otherwise).
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
    then (select nullif(c.value->>'url', '') from public.app_config c where c.key = 'staging_url')
    else null
  end;
$$;

revoke all on function public.get_staging_redirect() from public;
grant execute on function public.get_staging_redirect() to authenticated;
revoke execute on function public.get_staging_redirect() from anon;

-- app_config.staging_url holds the preview URL ({"url": "...", "updated_at": "..."}),
-- seeded empty (dormant until set). app_config already has admin-only RLS (0113).
insert into public.app_config (key, value)
  values ('staging_url', jsonb_build_object('url', null, 'updated_at', null))
  on conflict (key) do nothing;
