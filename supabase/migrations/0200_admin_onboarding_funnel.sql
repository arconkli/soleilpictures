-- 0200: admin_onboarding_funnel — the one canonical onboarding readout.
--
-- Every onboarding readout so far was ad-hoc SQL, and the event stream has
-- sharp edges that silently skew a hand-written query:
--   • onboarding_first_card double-fires cross-device (per-device once-guard)
--     → funnel truth is profiles.first_card_at / first_populated_board_at,
--       never event counts.
--   • onboarding_step action:'view' re-fires on every visit while a step is
--     armed → all step reads are COUNT(DISTINCT user_id).
--   • card_placed is a placement beacon: depth = sum(props->>'n'), and legacy
--     remix clone batches double-logged it alongside remix_clone (suppressed
--     client-side from this migration's release onward; the anti-join below
--     also cleans the historical rows).
--   • activation windows must be matched AND fully observed, or truncation
--     reads as decline.
-- This RPC encodes all of that once, per tour variant, so readouts reproduce.
create or replace function public.admin_onboarding_funnel(
  p_days integer default 45,
  p_window_hours integer default 96
)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_days  int := greatest(1, least(coalesce(p_days, 45), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_win   interval := make_interval(hours => greatest(1, least(coalesce(p_window_hours, 96), 720)));
begin
  perform public._require_admin();
  return (
    with seers as (
      -- One row per (user, variant): anyone who saw any step of that variant.
      select distinct e.user_id, e.props->>'variant' as variant
      from analytics_events e
      where e.occurred_at >= v_since
        and e.event = 'onboarding_step'
        and e.props->>'variant' is not null
        and e.user_id is not null
        and e.user_id not in (select public._internal_user_ids())
    ),
    base as (
      select s.user_id, s.variant, u.created_at,
        (now() - u.created_at >= v_win) as observed,
        (p.first_card_at is not null and p.first_card_at < u.created_at + v_win) as first_card_w,
        (p.first_populated_board_at is not null and p.first_populated_board_at < u.created_at + v_win) as populated_w
      from seers s
      join auth.users u on u.id = s.user_id
      left join profiles p on p.user_id = s.user_id
      where u.created_at >= v_since
    ),
    activity as (
      select b.user_id,
        count(distinct date(e.occurred_at)) as active_days,
        bool_or(date(e.occurred_at) > date(b.created_at)
                and e.occurred_at < b.created_at + v_win) as returned_w
      from base b
      join analytics_events e on e.user_id = b.user_id
      group by b.user_id
    ),
    depth as (
      -- Depth = sum of placed-card counts, excluding remix clone batches
      -- (legacy rows double-logged: same user, same n, within a minute of the
      -- remix_clone event; new clients suppress the card_placed entirely).
      select b.user_id,
        -- The case guards the left join's all-null row: a user with no
        -- card_placed rows is depth 0, not depth 1.
        coalesce(sum(case when cp.user_id is null then 0
                          else coalesce(nullif(cp.props->>'n','')::int, 1) end), 0) as cards
      from base b
      left join analytics_events cp
        on cp.user_id = b.user_id and cp.event = 'card_placed'
       and not exists (
         select 1 from analytics_events rc
         where rc.user_id = cp.user_id and rc.event = 'remix_clone'
           and rc.props->>'n' = cp.props->>'n'
           and abs(extract(epoch from rc.occurred_at - cp.occurred_at)) < 60
       )
      group by b.user_id
    ),
    steps as (
      select e.user_id, e.props->>'variant' as variant,
        bool_or(e.props->>'action' = 'skip') as skipped,
        bool_or(e.props->>'action' = 'advance' and e.props->>'done' = 'true') as completed
      from analytics_events e
      where e.occurred_at >= v_since and e.event = 'onboarding_step'
        and e.user_id is not null
        and e.user_id not in (select public._internal_user_ids())
      group by 1, 2
    ),
    remixers as (
      select distinct e.user_id from analytics_events e
      where e.occurred_at >= v_since and e.event = 'remix_clone'
    )
    select json_build_object(
      'params', json_build_object('days', v_days, 'window_hours', extract(epoch from v_win) / 3600),
      'cohorts', (
        select coalesce(json_agg(row_to_json(c) order by c.variant), '[]'::json) from (
          select b.variant,
            count(*) as users,
            count(*) filter (where st.skipped) as skipped,
            count(*) filter (where st.completed) as completed,
            count(*) filter (where b.first_card_w) as first_card_w,
            count(*) filter (where b.populated_w) as populated_w,
            count(*) filter (where b.observed) as observed,
            count(*) filter (where b.observed and a.returned_w) as returned_w_observed,
            count(*) filter (where a.active_days >= 2) as ever_returned,
            count(*) filter (where r.user_id is not null) as remixers,
            count(*) filter (where d.cards = 0) as depth_0,
            count(*) filter (where d.cards between 1 and 2) as depth_1_2,
            count(*) filter (where d.cards between 3 and 9) as depth_3_9,
            count(*) filter (where d.cards >= 10) as depth_10_plus
          from base b
          left join activity a on a.user_id = b.user_id
          left join depth d on d.user_id = b.user_id
          left join steps st on st.user_id = b.user_id and st.variant = b.variant
          left join remixers r on r.user_id = b.user_id
          group by b.variant
        ) c
      ),
      'intents', (
        select coalesce(json_agg(row_to_json(i) order by i.users desc), '[]'::json) from (
          select e.props->>'intent' as intent, count(distinct e.user_id) as users
          from analytics_events e
          where e.occurred_at >= v_since and e.event = 'onboarding_intent'
            and e.user_id not in (select public._internal_user_ids())
          group by 1
        ) i
      ),
      'reveals', (
        select coalesce(json_agg(row_to_json(rv) order by rv.reveal), '[]'::json) from (
          select e.props->>'reveal' as reveal,
            count(distinct e.user_id) filter (where e.event = 'power_reveal_shown') as shown,
            count(distinct e.user_id) filter (where e.event = 'power_reveal_engaged') as engaged,
            count(distinct e.user_id) filter (where e.event = 'power_reveal_dismissed') as dismissed
          from analytics_events e
          where e.occurred_at >= v_since
            and e.event in ('power_reveal_shown', 'power_reveal_engaged', 'power_reveal_dismissed')
            and e.user_id not in (select public._internal_user_ids())
          group by 1
        ) rv
      ),
      'mobile', (
        select row_to_json(m) from (
          select
            count(distinct e.user_id) filter (where e.event = 'onboarding_step'
              and e.props->>'variant' = 'mobile_lite' and e.props->>'step' = 'add_photos') as add_photos_viewers,
            count(distinct e.user_id) filter (where e.event = 'photo_pick_open') as picker_open,
            count(distinct e.user_id) filter (where e.event = 'photo_pick_commit') as picker_commit,
            count(distinct e.user_id) filter (where e.event = 'onboarding_step'
              and e.props->>'variant' = 'mobile_lite' and e.props->>'action' = 'advance') as advanced
          from analytics_events e
          where e.occurred_at >= v_since
            and e.user_id is not null
            and e.user_id not in (select public._internal_user_ids())
        ) m
      )
    )
  );
end;
$$;

revoke all on function public.admin_onboarding_funnel(integer, integer) from public, anon;
grant execute on function public.admin_onboarding_funnel(integer, integer) to authenticated;
