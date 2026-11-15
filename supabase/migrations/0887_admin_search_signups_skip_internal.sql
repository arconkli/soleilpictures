-- 0887 — the admin search and AI sign-up counts leave our own accounts out.
--
-- Two admin readers count sign-ups straight from profiles.first_source and
-- never removed the internal accounts (admin-tier profiles plus the
-- internal_accounts allowlist, _internal_user_ids() from 0110):
--
--   admin_seo_page_stats(integer)   sign-ups by the search page they landed on
--   admin_ai_referrals(integer)     sign-ups (and activations) that arrived
--                                   from an AI assistant, in Admin > Discover
--
-- The landing scorecard beside them (admin_landing_scorecard, 0461) already
-- leaves internal accounts out, so a test account made from a search page or
-- from an assistant's link showed in these two and not in the scorecard. Both
-- now carry the same exclusion.
--
-- Each body is 0335's with that one predicate added (marked -- 0887). The
-- page views and sessions in admin_seo_page_stats are unchanged: only the
-- sign-up count was asked about, and analytics_events already diverts QA and
-- crawler rows on insert. Same signatures, so create or replace keeps the
-- ACLs; the proof checks them. No rows are written.

create or replace function public.admin_seo_page_stats(p_days integer default 30)
returns json language plpgsql security definer set search_path = public as $fn$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, coalesce(p_days, 30)));
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    with ev as (
      select props->>'path' as path,
             session_id,
             seo_source_class(props->>'referrer_host', props->>'utm_source') as cls
      from analytics_events
      where event = 'seo_landing_view' and occurred_at >= v_since
    ),
    by_class as (
      select path, cls, count(*) as n from ev group by path, cls
    ),
    classes as (
      select path, jsonb_object_agg(cls, n) as referrers from by_class group by path
    ),
    pages as (
      select path, count(*) as views, count(distinct session_id) as sessions
      from ev group by path
    )
    select coalesce(json_agg(json_build_object(
             'path',      p.path,
             'views',     p.views,
             'sessions',  p.sessions,
             'signups',   (select count(*) from profiles pr
                            join auth.users au on au.id = pr.user_id
                            where pr.first_source->>'landing_path' = p.path
                              and au.created_at >= v_since
                              -- 0887: our own accounts are not sign-ups.
                              and pr.user_id not in (select iu.user_id from public._internal_user_ids() iu)),
             'referrers', c.referrers
           ) order by p.views desc), '[]'::json)
    from pages p
    left join classes c on c.path = p.path
  );
end;
$fn$;

create or replace function public.admin_ai_referrals(p_days int default 90)
returns json language plpgsql security definer set search_path = public as $fn$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, coalesce(p_days, 90)));
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select coalesce(json_agg(to_jsonb(t) order by t.signups desc, t.ref_host), '[]'::json)
    from (
      select
        -- A referrer-stripped arrival is labelled by the utm it carried, so a
        -- row never reads "(direct) · ai".
        coalesce(nullif(lower(pr.first_source->>'referrer_host'), ''),
                 'utm:' || lower(pr.first_source->>'utm_source'))   as ref_host,
        coalesce(pr.first_source->>'landing_path', '/')             as landing_path,
        count(*)                                                    as signups,
        count(*) filter (where exists (
          select 1 from analytics_events e
          where e.user_id = pr.user_id and e.event like 'card_placed%'
        ))                                                          as activated
      from profiles pr
      join auth.users au on au.id = pr.user_id
      where au.created_at >= v_since
        and seo_source_class(pr.first_source->>'referrer_host', pr.first_source->>'utm_source') = 'ai'
        -- 0887: our own accounts are not sign-ups.
        and pr.user_id not in (select iu.user_id from public._internal_user_ids() iu)
      group by 1, 2
    ) t
  );
end;
$fn$;

-- Proof (0311 habit): the admin RPCs are client-called, so create or replace
-- must have kept EXECUTE for authenticated and kept anon out; the helper the
-- new predicate reads must stay closed to clients.
do $proof$
declare
  f text;
begin
  foreach f in array array['public.admin_seo_page_stats(integer)',
                           'public.admin_ai_referrals(integer)'] loop
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '0887: % lost EXECUTE for authenticated', f;
    end if;
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0887: % is executable by anon', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public._internal_user_ids()', 'execute')
     or has_function_privilege('authenticated', 'public._internal_user_ids()', 'execute') then
    raise exception '0887: _internal_user_ids() is executable by a client';
  end if;
end $proof$;
