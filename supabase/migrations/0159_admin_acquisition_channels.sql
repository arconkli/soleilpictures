-- 0159_admin_acquisition_channels.sql
--
-- Powers the Users-list "source" filter dropdown: the distinct acquisition
-- channels actually present (with counts), derived through the SAME normalizer
-- (public.derive_acquisition_channel) the list/count use — so every dropdown
-- value matches the column exactly and filtering can never silently return zero.
-- Scoped to a verification bucket so the options track the list's verification.
--
-- Applied to prod via MCP apply_migration; this file mirrors it for the repo record.

create or replace function public.admin_acquisition_channels(p_verification text DEFAULT 'all'::text)
 returns TABLE(channel text, n integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_v text := lower(coalesce(nullif(trim(p_verification), ''), 'all'));
begin
  perform public._require_admin();
  return query
  select public.derive_acquisition_channel(p.first_source) as channel, count(*)::int as n
    from auth.users u
    left join public.profiles p on p.user_id = u.id
   where (case v_v
            when 'verified'   then (u.email_confirmed_at is not null and u.last_sign_in_at is not null)
            when 'unverified' then (u.email_confirmed_at is null     or  u.last_sign_in_at is null)
            else true
          end)
   group by 1
   order by n desc, channel asc;
end $function$;

grant execute on function public.admin_acquisition_channels(text) to authenticated;
