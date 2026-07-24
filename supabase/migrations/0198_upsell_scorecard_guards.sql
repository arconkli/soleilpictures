-- 0198: Harden the 0197 upsell RPCs against anon-writable props.
--
-- analytics_events INSERT is open to anon (0071), so props are attacker-
-- writable. 0197's cast-guards bounded FORMAT but not MAGNITUDE: a single
-- inserted row with e.g. {toggles_n:'9999999999'} passed `^[0-9]+$` and made
-- the `::int` cast raise 22003 (integer out of range), killing the whole
-- scorecard/feed RPC for every admin while the row sat inside the window.
-- Fixes, applied to BOTH functions via create-or-replace:
--   • every ::int guard becomes `^[0-9]{1,9}$` (max 999,999,999 < int32 max);
--   • every ::numeric guard bounds both sides: `^[0-9]{1,12}(\.[0-9]{1,6})?$`;
--   • the scorecard's group keys (surface/header/copy_rev) are length-clamped
--     in the ev CTE with left(), making the migration's "free strings are
--     length-clamped" contract true for the aggregate path too (the feed
--     already clamped).
-- Everything else is byte-identical to 0197.

create or replace function public.admin_upsell_scorecard(
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
      select e.session_id, e.user_id, e.event, e.props, e.occurred_at,
             left(coalesce(nullif(e.props->>'surface', ''), 'unknown'), 24)  as surface,
             left(coalesce(nullif(e.props->>'header', ''), 'generic'), 24)   as header,
             left(coalesce(nullif(e.props->>'copy_rev', ''), 'legacy'), 32)  as copy_rev
      from analytics_events e
      where e.occurred_at >= v_since
        and e.event in ('up_exposure_summary', 'up_feature_hover',
                        'pricing_view', 'pricing_creator_intent', 'pricing_abandon',
                        'checkout_open', 'subscription_started',
                        'up_chip_click', 'up_settings_upgrade_click',
                        'up_invite_alt_click', 'up_cap_toast_view')
        and (not p_exclude_internal
             or ((e.session_id is null
                  or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
                 and (e.user_id is null
                  or e.user_id not in (select iu.user_id from public._internal_user_ids() iu))))
    ),
    summ as (select * from ev where event = 'up_exposure_summary'),
    groups as (
      select surface, header,
             count(*)                   as exposures,
             count(distinct user_id)    as users,
             count(distinct session_id) as sessions,
             count(*) filter (where props->>'outcome' = 'cta')        as o_cta,
             count(*) filter (where props->>'outcome' = 'invite_alt') as o_invite_alt,
             count(*) filter (where props->>'outcome' = 'demo_cta')   as o_demo_cta,
             count(*) filter (where props->>'outcome' = 'dismiss')    as o_dismiss,
             count(*) filter (where props->>'outcome' = 'hidden')     as o_hidden,
             count(*) filter (where props->>'dismiss_method' = 'x')           as dm_x,
             count(*) filter (where props->>'dismiss_method' = 'backdrop')    as dm_backdrop,
             count(*) filter (where props->>'dismiss_method' = 'maybe_later') as dm_maybe_later,
             count(*) filter (where props->>'dismiss_method' = 'esc')         as dm_esc,
             count(*) filter (where props->>'dismiss_method' = 'nav')         as dm_nav,
             percentile_cont(0.5) within group (order by
               case when (props->>'dwell_ms') ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$'
                    then (props->>'dwell_ms')::numeric end)     as med_dwell_ms,
             percentile_cont(0.5) within group (order by
               case when (props->>'ttfi_ms') ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$'
                    then (props->>'ttfi_ms')::numeric end)      as med_ttfi_ms,
             percentile_cont(0.5) within group (order by
               case when (props->>'exposure_n') ~ '^[0-9]{1,9}$'
                    then (props->>'exposure_n')::numeric end)   as med_exposure_n,
             count(*) filter (where (props->>'toggles_n') ~ '^[0-9]{1,9}$'
                                and (props->>'toggles_n')::int > 0)  as toggled_n,
             count(*) filter (where (props->>'feat_ms') ~ '^[0-9]{1,9}$'
                                and (props->>'feat_ms')::int > 0)    as feat_read_n,
             sum(case when (props->>'rage_n') ~ '^[0-9]{1,9}$' then (props->>'rage_n')::int else 0 end) as rage_n,
             sum(case when (props->>'dead_n') ~ '^[0-9]{1,9}$' then (props->>'dead_n')::int else 0 end) as dead_n,
             count(*) filter (where props->>'error_seen' = 'true')   as error_seen_n
      from summ group by surface, header
    ),
    by_copy as (
      select surface, header, jsonb_object_agg(copy_rev, o) as by_copy
      from (
        select surface, header, copy_rev,
               jsonb_build_object(
                 'exposures', count(*),
                 'cta',       count(*) filter (where props->>'outcome' = 'cta'),
                 'dismiss',   count(*) filter (where props->>'outcome' = 'dismiss')
               ) as o
        from summ
        where copy_rev ~ '^[a-z0-9_]{1,32}$'   -- anon-writable — never let junk become object keys
        group by surface, header, copy_rev
      ) t group by surface, header
    ),
    feat as (
      -- Which of the 5 Creator pitch lines get read, per group. `row` is the
      -- index into CREATOR_FEATURES; `key` its stable slug (CREATOR_FEATURE_KEYS).
      select surface, header, jsonb_object_agg('r' || r, n) as feat_hover
      from (
        select surface, header, props->>'row' as r, count(*) as n
        from ev
        where event = 'up_feature_hover' and (props->>'row') in ('0','1','2','3','4')
        group by surface, header, props->>'row'
      ) x group by surface, header
    ),
    featk as (
      select surface, header, jsonb_object_agg(k, n) as feat_keys
      from (
        select surface, header, props->>'key' as k, count(*) as n
        from ev
        where event = 'up_feature_hover' and (props->>'key') ~ '^[a-z_]{1,24}$'
        group by surface, header, props->>'key'
      ) x group by surface, header
    ),
    perday as (
      select surface, header, occurred_at::date as d, count(*) as n
      from summ group by 1, 2, 3
    ),
    funnel as (
      select surface,
             count(*) filter (where event = 'pricing_view')                          as views,
             count(distinct coalesce(user_id::text, session_id::text))
               filter (where event = 'pricing_view')                                 as view_who,
             count(*) filter (where event = 'pricing_creator_intent')                as intents,
             count(distinct coalesce(user_id::text, session_id::text))
               filter (where event = 'pricing_creator_intent')                       as intent_who,
             count(*) filter (where event = 'pricing_abandon')                       as abandons,
             count(*) filter (where event = 'checkout_open')                         as checkouts,
             count(distinct coalesce(user_id::text, session_id::text))
               filter (where event = 'checkout_open')                                as checkout_who
      from ev
      where event in ('pricing_view', 'pricing_creator_intent', 'pricing_abandon', 'checkout_open')
      group by surface
    )
    select json_build_object(
      'days', v_days,
      'groups', (
        select coalesce(json_agg(json_build_object(
                 'surface',        g.surface,
                 'header',         g.header,
                 'exposures',      g.exposures,
                 'users',          g.users,
                 'sessions',       g.sessions,
                 'outcomes',       json_build_object(
                                     'cta', g.o_cta, 'invite_alt', g.o_invite_alt,
                                     'demo_cta', g.o_demo_cta, 'dismiss', g.o_dismiss,
                                     'hidden', g.o_hidden),
                 'dismiss_methods', json_build_object(
                                     'x', g.dm_x, 'backdrop', g.dm_backdrop,
                                     'maybe_later', g.dm_maybe_later, 'esc', g.dm_esc,
                                     'nav', g.dm_nav),
                 'med_dwell_ms',   round(g.med_dwell_ms),
                 'med_ttfi_ms',    round(g.med_ttfi_ms),
                 'med_exposure_n', round(g.med_exposure_n::numeric, 1),
                 'toggled_n',      g.toggled_n,
                 'feat_read_n',    g.feat_read_n,
                 'rage_n',         g.rage_n,
                 'dead_n',         g.dead_n,
                 'error_seen_n',   g.error_seen_n,
                 'by_copy',        coalesce(bc.by_copy, '{}'::jsonb),
                 'feat_hover',     coalesce(f.feat_hover, '{}'::jsonb),
                 'feat_keys',      coalesce(fk.feat_keys, '{}'::jsonb),
                 'spark',          (select json_agg(coalesce(pd.n, 0) order by gs.d)
                                    from generate_series(v_since::date, current_date, interval '1 day') gs(d)
                                    left join perday pd on pd.surface = g.surface
                                                       and pd.header = g.header
                                                       and pd.d = gs.d::date)
               ) order by g.exposures desc), '[]'::json)
        from groups g
        left join by_copy bc on bc.surface = g.surface and bc.header = g.header
        left join feat f     on f.surface = g.surface and f.header = g.header
        left join featk fk   on fk.surface = g.surface and fk.header = g.header
      ),
      'funnel', (
        select coalesce(json_agg(json_build_object(
                 'surface',       fu.surface,
                 'views',         fu.views,
                 'view_who',      fu.view_who,
                 'intents',       fu.intents,
                 'intent_who',    fu.intent_who,
                 'abandons',      fu.abandons,
                 'checkouts',     fu.checkouts,
                 'checkout_who',  fu.checkout_who
               ) order by fu.views desc), '[]'::json)
        from funnel fu
      ),
      'entry_points', (
        select json_build_object(
          'chip_clicks',       count(*) filter (where event = 'up_chip_click'),
          'settings_clicks',   count(*) filter (where event = 'up_settings_upgrade_click'),
          'invite_alt_clicks', count(*) filter (where event = 'up_invite_alt_click'),
          'cap_toast_views',   count(*) filter (where event = 'up_cap_toast_view'))
        from ev
      ),
      'subs', (select count(*) from ev where event = 'subscription_started')
    )
  );
end;
$$;

revoke all on function public.admin_upsell_scorecard(integer, boolean) from public, anon;
grant execute on function public.admin_upsell_scorecard(integer, boolean) to authenticated;

create or replace function public.admin_upsell_exposures(
  p_days integer default 30,
  p_limit integer default 50,
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
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  perform public._require_admin();
  return (
    select coalesce(json_agg(row_j order by occurred_at desc), '[]'::json)
    from (
      select e.occurred_at,
             json_build_object(
               'occurred_at',    e.occurred_at,
               'user_id',        e.user_id,
               -- Free strings are anon-writable: clamp length, render as text only.
               'surface',        left(coalesce(e.props->>'surface', ''), 24),
               'header',         left(coalesce(e.props->>'header', ''), 24),
               'via',            left(coalesce(e.props->>'via', ''), 24),
               'copy_rev',       left(coalesce(e.props->>'copy_rev', ''), 32),
               'tier',           left(coalesce(e.props->>'tier', ''), 16),
               'outcome',        left(coalesce(e.props->>'outcome', ''), 16),
               'dismiss_method', left(coalesce(e.props->>'dismiss_method', ''), 16),
               'plan_final',     left(coalesce(e.props->>'plan_final', ''), 12),
               'toggle_seq',     left(coalesce(e.props->>'toggle_seq', ''), 24),
               'device_type',    left(coalesce(e.props->>'device_type', ''), 12),
               'toggles_n',   case when (e.props->>'toggles_n')   ~ '^[0-9]{1,9}$' then (e.props->>'toggles_n')::int end,
               'dwell_ms',    case when (e.props->>'dwell_ms')    ~ '^[0-9]{1,9}$' then (e.props->>'dwell_ms')::int end,
               'ttfi_ms',     case when (e.props->>'ttfi_ms')     ~ '^[0-9]{1,9}$' then (e.props->>'ttfi_ms')::int end,
               'feat_ms',     case when (e.props->>'feat_ms')     ~ '^[0-9]{1,9}$' then (e.props->>'feat_ms')::int end,
               'cta_hes_ms',  case when (e.props->>'cta_hes_ms')  ~ '^[0-9]{1,9}$' then (e.props->>'cta_hes_ms')::int end,
               'price_hes_ms',case when (e.props->>'price_hes_ms')~ '^[0-9]{1,9}$' then (e.props->>'price_hes_ms')::int end,
               'rage_n',      case when (e.props->>'rage_n')      ~ '^[0-9]{1,9}$' then (e.props->>'rage_n')::int end,
               'dead_n',      case when (e.props->>'dead_n')      ~ '^[0-9]{1,9}$' then (e.props->>'dead_n')::int end,
               'exposure_n',  case when (e.props->>'exposure_n')  ~ '^[0-9]{1,9}$' then (e.props->>'exposure_n')::int end,
               'cap_pct',     case when (e.props->>'cap_pct')     ~ '^[0-9]{1,9}$' then (e.props->>'cap_pct')::int end,
               'acct_days',   case when (e.props->>'acct_days')   ~ '^[0-9]{1,9}$' then (e.props->>'acct_days')::int end,
               'error_seen',  (e.props->>'error_seen' = 'true'),
               -- feat_rows is a small int array; keep only well-formed values.
               'feat_rows',   (select coalesce(jsonb_agg(v), '[]'::jsonb)
                               from jsonb_array_elements(
                                      case when jsonb_typeof(e.props->'feat_rows') = 'array'
                                           then e.props->'feat_rows' else '[]'::jsonb end) v
                               where jsonb_typeof(v) = 'number')
             ) as row_j
      from analytics_events e
      where e.occurred_at >= v_since
        and e.event = 'up_exposure_summary'
        and (not p_exclude_internal
             or ((e.session_id is null
                  or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
                 and (e.user_id is null
                  or e.user_id not in (select iu.user_id from public._internal_user_ids() iu))))
      order by e.occurred_at desc
      limit v_limit
    ) t
  );
end;
$$;

revoke all on function public.admin_upsell_exposures(integer, integer, boolean) from public, anon;
grant execute on function public.admin_upsell_exposures(integer, integer, boolean) to authenticated;
