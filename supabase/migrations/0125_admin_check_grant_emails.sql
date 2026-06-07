-- 0125_admin_check_grant_emails.sql
--
-- Grants are how we personally reach out to filmmakers. To avoid emailing the same
-- person twice, the grant form needs to know which pasted emails were ALREADY
-- contacted. This read-only RPC returns the subset of the input emails that have
-- prior history — any user_outreach (which now includes past grants, 0124) OR any
-- paid_grants record (covers grants issued before 0124) — with enough detail to
-- label each in the UI.

create or replace function public.admin_check_grant_emails(p_emails text[])
returns table(
  email                 text,
  has_grant             boolean,
  grant_status          text,
  granted_at            timestamptz,
  granted_by_email      text,
  outreach_count        integer,
  last_reached_out_at   timestamptz,
  last_reached_by_email text
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._require_admin();
  return query
  with input as (
    select distinct lower(trim(e)) as email
    from unnest(coalesce(p_emails, array[]::text[])) e
    where position('@' in coalesce(e, '')) > 0
  ),
  ox as (
    select lower(o.email) as email,
           count(*)::int as outreach_count,
           max(o.reached_at) as last_reached_out_at,
           (array_agg(o.reached_by_email order by o.reached_at desc))[1] as last_reached_by_email
    from public.user_outreach o
    join input i on lower(o.email) = i.email
    group by lower(o.email)
  )
  select
    i.email,
    (g.email is not null)                                                          as has_grant,
    case when g.email is not null then public._grant_status(g.revoked_at, g.expires_at) end as grant_status,
    g.granted_at,
    g.granted_by_email,
    coalesce(ox.outreach_count, 0)                                                 as outreach_count,
    ox.last_reached_out_at,
    ox.last_reached_by_email
  from input i
  left join public.paid_grants g on g.email = i.email
  left join ox on ox.email = i.email
  where g.email is not null or ox.email is not null;
end $$;
revoke all on function public.admin_check_grant_emails(text[]) from public;
grant execute on function public.admin_check_grant_emails(text[]) to authenticated;
