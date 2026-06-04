-- 0115_admin_acquisition_fbclid.sql
--
-- Add a "facebook/instagram (fbclid)" row to the admin Acquisition source
-- breakdown (Analytics → Acquisition), so FB/IG ad traffic's signup→paid
-- conversion shows in the table the same way the funnel segment does.
--
-- FB ads carry no UTM (changing the ad URL resets Facebook's learning), so the
-- signal is the fbclid we now stamp into profiles.first_source. This re-buckets
-- first-touch signups carrying first_source.fbclid into a clean
-- 'facebook/instagram (fbclid)' source instead of scattering them under referrer
-- hostnames / 'direct'. utm_source still wins when present, so the buckets stay
-- mutually exclusive and the table totals stay consistent. Distinct label from
-- any existing 'meta' (utm) / 'lm.facebook.com' (referrer) rows.

create or replace function public.admin_acquisition_breakdown(p_days integer, p_exclude_internal boolean default true)
returns table(source text, signups integer, converted integer, conversion numeric)
language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  return query
  with src as (
    select coalesce(nullif(p.first_source->>'utm_source', ''),
                    case when nullif(p.first_source->>'fbclid', '') is not null
                         then 'facebook/instagram (fbclid)' end,
                    nullif(p.first_source->>'referrer', ''),
                    'direct') as source,
           p.first_paid_at is not null as paid
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where u.email_confirmed_at is not null
       and u.created_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  )
  select source,
         count(*)::int as signups,
         sum(case when paid then 1 else 0 end)::int as converted,
         round(sum(case when paid then 1 else 0 end)::numeric / nullif(count(*), 0), 4) as conversion
    from src group by source order by signups desc;
end;
$function$;
