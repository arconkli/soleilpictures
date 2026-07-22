-- 0195: Landing-page scorecard over the uniform lp_* engagement family.
--
-- The client now instruments EVERY public page (the 9 SEO landing pages, /,
-- /pricing, /explore, /c/<slug>, /share aggregate) with a uniform event set —
-- lp_view / lp_scroll / lp_dwell {ms,max_depth} / lp_cta_click {pos,intent} —
-- all carrying props {page, page_kind} (see boards/src/lib/landingMetrics.js).
-- This RPC turns that into ONE ranked row per page: traffic, engagement
-- medians, signup-CTA reach, attributed signups, referrer classes, and a
-- per-day views series for the sparkline. It supersedes admin_seo_page_stats
-- in the Discover tab UI (the 0180 function stays in place, untouched).
--
-- Continuity: seo_landing_view rows from BEFORE the lp_* client shipped still
-- count as views. Instead of a hard cutover timestamp (deploys hit preview and
-- production at different times), a seo_landing_view row is counted only when
-- the same session has NO lp_view for the same page in the window — new
-- clients emit both, so their seo_landing_view is deduped away; old rows have
-- no lp_view and keep counting.
--
-- Honesty contract with the UI: raw numerators/denominators only — the client
-- RateCell/small-N layer computes and gates every rate. Engagement medians
-- come with dwell_n so the UI can suppress noise. lp_trace is deliberately
-- absent from the event filter so trace batches are never scanned here.

create or replace function public.admin_landing_scorecard(
  p_days integer default 30,
  p_exclude_internal boolean default true
)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_days  int := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  perform public._require_admin();
  return (
    with ev as (
      select coalesce(e.props->>'page', e.props->>'path') as page,
             e.session_id, e.event, e.props, e.occurred_at
      from analytics_events e
      where e.occurred_at >= v_since
        and e.event in ('lp_view', 'lp_dwell', 'lp_cta_click', 'seo_landing_view')
        and coalesce(e.props->>'page', e.props->>'path') is not null
        and (not p_exclude_internal
             or e.session_id is null
             or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
    ),
    -- A view = lp_view, plus legacy seo_landing_view rows whose session never
    -- emitted lp_view for that page (pre-lp_* clients).
    view_ev as (
      select page, session_id, occurred_at,
             max(props->>'page_kind') over (partition by page) as page_kind
      from ev where event = 'lp_view'
      union all
      select s.page, s.session_id, s.occurred_at, null
      from ev s
      where s.event = 'seo_landing_view'
        and not exists (
          select 1 from ev v
          where v.event = 'lp_view' and v.page = s.page
            and v.session_id is not distinct from s.session_id
        )
    ),
    views as (
      select page,
             count(*)                    as views,
             count(distinct session_id)  as sessions,
             max(page_kind)              as page_kind
      from view_ev group by page
    ),
    dwell as (
      select page,
             count(*) as dwell_n,
             percentile_cont(0.5) within group (order by (props->>'ms')::numeric) as med_dwell_ms,
             percentile_cont(0.5) within group (order by
               case when (props->>'max_depth') ~ '^[0-9]+(\.[0-9]+)?$'
                    then (props->>'max_depth')::numeric end)                      as med_scroll
      from ev
      where event = 'lp_dwell'
        and (props->>'ms') ~ '^[0-9]+(\.[0-9]+)?$'          -- props are anon-writable; never cast junk
      group by page
    ),
    ctas as (
      select page,
             count(*)                   as cta_clicks,
             count(distinct session_id) as cta_sessions
      from ev
      where event = 'lp_cta_click' and coalesce(props->>'intent', 'signup') = 'signup'
      group by page
    ),
    refs as (
      select page, jsonb_object_agg(cls, n) as referrers
      from (
        select page, seo_referrer_class(props->>'referrer_host') as cls, count(*) as n
        from ev where event in ('lp_view', 'seo_landing_view')
        group by 1, 2
      ) t group by page
    ),
    signups as (
      select pr.first_source->>'landing_path' as page, count(*) as n
      from profiles pr
      join auth.users au on au.id = pr.user_id
      where au.created_at >= v_since
        and au.email_confirmed_at is not null
        and (not p_exclude_internal
             or pr.user_id not in (select iu.user_id from public._internal_user_ids() iu))
      group by 1
    ),
    perday as (
      select page, occurred_at::date as d, count(*) as n
      from view_ev group by 1, 2
    )
    select coalesce(json_agg(json_build_object(
             'page',         v.page,
             'page_kind',    v.page_kind,
             'views',        v.views,
             'sessions',     v.sessions,
             'dwell_n',      coalesce(d.dwell_n, 0),
             'med_dwell_ms', round(d.med_dwell_ms),
             'med_scroll',   round(d.med_scroll::numeric, 2),
             'cta_clicks',   coalesce(c.cta_clicks, 0),
             'cta_sessions', coalesce(c.cta_sessions, 0),
             'signups',      coalesce(s.n, 0),
             'referrers',    coalesce(r.referrers, '{}'::jsonb),
             'spark',        (select json_agg(coalesce(pd.n, 0) order by gs.d)
                              from generate_series(v_since::date, current_date, interval '1 day') gs(d)
                              left join perday pd on pd.page = v.page and pd.d = gs.d::date)
           ) order by v.sessions desc, v.views desc), '[]'::json)
    from views v
    left join dwell d   on d.page = v.page
    left join ctas c    on c.page = v.page
    left join refs r    on r.page = v.page
    left join signups s on s.page = v.page
  );
end;
$$;

revoke all on function public.admin_landing_scorecard(integer, boolean) from public, anon;
grant execute on function public.admin_landing_scorecard(integer, boolean) to authenticated;
