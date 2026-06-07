-- 0126_admin_paid_grants_status_counts.sql
--
-- Powers the Grants tab's at-a-glance stat strip (Active · Forever · Expired ·
-- Revoked). Buckets every paid_grants row by public._grant_status (0085).

create or replace function public.admin_paid_grants_status_counts()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_out jsonb;
begin
  perform public._require_admin();
  select jsonb_build_object(
    'total',   count(*),
    'active',  count(*) filter (where public._grant_status(revoked_at, expires_at) = 'active'),
    'forever', count(*) filter (where public._grant_status(revoked_at, expires_at) = 'forever'),
    'expired', count(*) filter (where public._grant_status(revoked_at, expires_at) = 'expired'),
    'revoked', count(*) filter (where public._grant_status(revoked_at, expires_at) = 'revoked')
  ) into v_out from public.paid_grants;
  return v_out;
end $$;
revoke all on function public.admin_paid_grants_status_counts() from public;
grant execute on function public.admin_paid_grants_status_counts() to authenticated;
