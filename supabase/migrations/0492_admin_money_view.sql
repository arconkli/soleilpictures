-- 0492 — Analytics › Money: the path from a price to a payment, and the
-- people on it.
--
-- Two reads for the Money view, each failing on its own:
--
--   admin_money_path(p_exclude_internal, p_verified_only)
--     The path in people, nested: saw a price, then pressed the Creator
--     button, opened checkout, finished it, started Creator, paid. Each step
--     counts the people who reached it AND every step before it, so no step
--     is ever larger than the one before. How people first got to the plans
--     is reported beside it as routes (the cap wall, an Upgrade button,
--     anywhere else), because the steps are not a sequence of screens: a
--     press of Start trial can come through the cap wall from someone who
--     never pressed an Upgrade button, so a path that ran "clicked Upgrade →
--     pressed Start trial" would not be nested, and would lose those people
--     between its steps. Also what people did with the offer once it opened
--     (up_exposure_summary outcomes and how they closed it), the trial on the
--     button, and the answers to "why not".
--
--   admin_money_people(p_exclude_internal, p_verified_only)
--     Who: free accounts at or near the cap and how many came back in the
--     last 7 days, the running trials, comped and ever-paid counts, and
--     everyone who has hit the cap with what happened next.
--
-- People are signed-in accounts: never a service account, never a banned one
-- (what a banned account did is abuse, not demand), the team left out under
-- p_exclude_internal, and only accounts whose owner entered the emailed code
-- under p_verified_only. Revenue itself stays with admin_stats, which reads
-- what Stripe reported.
--
-- New functions, so the 0311 grant habit: EXECUTE for authenticated and
-- service_role only, proved below.

begin;

set local lock_timeout = '3s';

create or replace function public.admin_money_path(
  p_exclude_internal boolean default true,
  p_verified_only boolean default false
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_out jsonb;
begin
  perform public._require_admin();

  with ext as (
    select p.user_id, p.creator_trial_started_at, p.first_paid_at
      from public.profiles p
     where not coalesce(p.is_service, false)
       and p.banned_at is null
       and (not p_exclude_internal
            or p.user_id not in (select iu.user_id from public._internal_user_ids() iu))
       and (not p_verified_only
            or p.user_id in (select ec.entered_id from public._admin_entered_code() ec))
  ),
  ev as (
    select e.user_id, e.event, e.props, e.occurred_at
      from public.analytics_events e
     where e.event in ('pricing_view', 'price_seen', 'pricing_creator_intent', 'checkout_open',
                       'checkout_success', 'checkout_error', 'up_chip_click', 'up_settings_upgrade_click',
                       'first_value_upgrade_cta', 'up_cap_toast_cta', 'up_exposure_summary',
                       'upgrade_reason_shown', 'upgrade_reason_answered')
       and e.user_id in (select x.user_id from ext x)
  ),
  per as (
    select ev.user_id,
           min(ev.occurred_at) filter (where ev.event in ('pricing_view', 'price_seen'))      as saw_at,
           -- coalesce: a pricing_view without a header makes the comparison
           -- NULL, and someone whose only views were those would otherwise
           -- drop out of every route, "elsewhere" included.
           coalesce(bool_or(ev.event = 'pricing_view'
                            and ev.props->>'header' = 'cap-hit'), false)               as via_wall,
           coalesce(bool_or(ev.event in ('up_chip_click', 'up_settings_upgrade_click',
                                         'first_value_upgrade_cta', 'up_cap_toast_cta')), false) as via_button,
           min(ev.occurred_at) filter (where ev.event = 'pricing_creator_intent')             as pressed_at,
           coalesce(bool_or(ev.event = 'pricing_creator_intent'
                            and ev.props->>'trial' = 'true'), false)                   as pressed_trial,
           min(ev.occurred_at) filter (where ev.event = 'checkout_open')                      as checkout_at,
           min(ev.occurred_at) filter (where ev.event = 'checkout_success')                   as finished_at,
           coalesce(bool_or(ev.event = 'checkout_error'), false)                             as checkout_error
      from ev
     group by ev.user_id
  ),
  -- Everyone who saw a price, with each later step only when every step
  -- before it was reached too.
  path as (
    select pr.user_id, pr.saw_at, pr.via_wall, pr.via_button,
           pr.pressed_at, pr.pressed_trial, pr.checkout_error,
           (pr.pressed_at is not null)                                             as s_pressed,
           (pr.pressed_at is not null and pr.checkout_at is not null)               as s_checkout,
           (pr.pressed_at is not null and pr.checkout_at is not null
            and pr.finished_at is not null)                                         as s_finished,
           (pr.pressed_at is not null and pr.checkout_at is not null
            and pr.finished_at is not null
            and (x.creator_trial_started_at is not null or x.first_paid_at is not null)) as s_started,
           (pr.pressed_at is not null and pr.checkout_at is not null
            and pr.finished_at is not null and x.first_paid_at is not null)         as s_paid,
           pr.finished_at, x.creator_trial_started_at as trial_at, x.first_paid_at as paid_at,
           s.status as sub_status, s.current_period_end, s.cancel_at_period_end
      from per pr
      join ext x on x.user_id = pr.user_id
      left join public.subscriptions s on s.user_id = pr.user_id
     where pr.saw_at is not null
  ),
  summ as (
    select ev.user_id, ev.props, ev.occurred_at
      from ev where ev.event = 'up_exposure_summary'
  ),
  outcome_rows as (
    select coalesce(sm.props->>'outcome', 'unknown') as outcome,
           count(*)::int as times, count(distinct sm.user_id)::int as people
      from summ sm group by 1
  ),
  method_rows as (
    select coalesce(sm.props->>'dismiss_method', 'unknown') as method, count(*)::int as times
      from summ sm where sm.props->>'outcome' = 'dismiss' group by 1
  ),
  reason_rows as (
    select ev.props->>'choice' as choice, count(*)::int as n
      from ev where ev.event = 'upgrade_reason_answered' and ev.props->>'choice' is not null
     group by 1
  )
  select jsonb_build_object(
    'since', (select min(pa.saw_at) from path pa),
    'steps', jsonb_build_object(
      'saw',            (select count(*) from path)::int,
      'pressed',        (select count(*) from path where s_pressed)::int,
      'pressed_trial',  (select count(*) from path where s_pressed and pressed_trial)::int,
      'checkout',       (select count(*) from path where s_checkout)::int,
      'finished',       (select count(*) from path where s_finished)::int,
      'started',        (select count(*) from path where s_started)::int,
      'started_trial',  (select count(*) from path where s_started and trial_at is not null)::int,
      'paid',           (select count(*) from path where s_paid)::int,
      'first_pressed',  (select min(pressed_at) from path where s_pressed),
      'first_finished', (select min(finished_at) from path where s_finished),
      'first_paid',     (select min(paid_at) from path where s_paid),
      'trial_running',  (select count(*) from path where s_started and sub_status = 'trialing')::int,
      'trial_cancelling', (select count(*) from path where s_started and sub_status = 'trialing'
                                                     and cancel_at_period_end)::int,
      'trial_ends',     (select min(current_period_end) from path where s_started and sub_status = 'trialing'),
      'trial_ended_unpaid', (select count(*) from path
                              where s_started and trial_at is not null
                                and coalesce(sub_status, 'canceled') <> 'trialing'
                                and (paid_at is null or paid_at < trial_at))::int,
      'checkout_error_people', (select count(*) from path where s_checkout and checkout_error)::int
    ),
    'routes', jsonb_build_object(
      'wall',      jsonb_build_object('people',  (select count(*) from path where via_wall)::int,
                                      'pressed', (select count(*) from path where via_wall and s_pressed)::int),
      'button',    jsonb_build_object('people',  (select count(*) from path where via_button)::int,
                                      'pressed', (select count(*) from path where via_button and s_pressed)::int),
      'elsewhere', jsonb_build_object('people',  (select count(*) from path where not via_wall and not via_button)::int,
                                      'pressed', (select count(*) from path where not via_wall and not via_button and s_pressed)::int),
      'both',      (select count(*) from path where via_wall and via_button)::int
    ),
    'offer', jsonb_build_object(
      'since',    (select min(sm.occurred_at) from summ sm),
      'times',    (select count(*) from summ)::int,
      'people',   (select count(distinct sm.user_id) from summ sm)::int,
      'outcomes', coalesce((select jsonb_object_agg(o.outcome, jsonb_build_object('times', o.times, 'people', o.people))
                              from outcome_rows o), '{}'::jsonb),
      'dismiss_methods', coalesce((select jsonb_object_agg(m.method, m.times) from method_rows m), '{}'::jsonb),
      'trial_on_button', jsonb_build_object(
        'since',   (select min(sm.occurred_at) from summ sm where sm.props->>'trial' = 'true'),
        'times',   (select count(*) from summ sm where sm.props->>'trial' = 'true')::int,
        'people',  (select count(distinct sm.user_id) from summ sm where sm.props->>'trial' = 'true')::int,
        'pressed', (select count(distinct ev.user_id) from ev
                     where ev.event = 'pricing_creator_intent' and ev.props->>'trial' = 'true')::int,
        'pressed_first', (select min(ev.occurred_at) from ev
                           where ev.event = 'pricing_creator_intent' and ev.props->>'trial' = 'true'),
        'pressed_last',  (select max(ev.occurred_at) from ev
                           where ev.event = 'pricing_creator_intent' and ev.props->>'trial' = 'true')
      ),
      'reasons', jsonb_build_object(
        'since',    (select min(ev.occurred_at) from ev where ev.event = 'upgrade_reason_shown'),
        'shown',    (select count(*) from ev where ev.event = 'upgrade_reason_shown')::int,
        'answered', (select count(*) from ev where ev.event = 'upgrade_reason_answered')::int,
        'choices',  coalesce((select jsonb_agg(jsonb_build_object(
                                'choice', r.choice,
                                'label',  public._upgrade_reason_label(r.choice),
                                'n',      r.n) order by r.n desc, r.choice)
                                from reason_rows r), '[]'::jsonb)
      )
    )
  )
  into v_out;

  return v_out;
end $function$;

comment on function public.admin_money_path(boolean, boolean) is
  'Analytics › Money (0492): the path from a price to a payment in people, each step nested in the one before (saw a price, pressed the Creator button, opened checkout, finished it, started Creator, paid), the routes to the plans (cap wall, Upgrade button, elsewhere), and what people did with the offer: outcomes, how they closed it, the trial on the button and the answers to why not. Signed-in people; service and banned accounts never; team out under p_exclude_internal; only accounts that entered the code under p_verified_only.';

revoke execute on function public.admin_money_path(boolean, boolean) from public, anon;
grant execute on function public.admin_money_path(boolean, boolean) to authenticated, service_role;


create or replace function public.admin_money_people(
  p_exclude_internal boolean default true,
  p_verified_only boolean default false
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_out jsonb;
begin
  perform public._require_admin();

  with ext as (
    select p.user_id, p.tier, p.creator_trial_started_at, p.first_paid_at,
           coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0) as cap,
           u.email::text as email, u.created_at as joined_at
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where not coalesce(p.is_service, false)
       and p.banned_at is null
       and (not p_exclude_internal
            or p.user_id not in (select iu.user_id from public._internal_user_ids() iu))
       and (not p_verified_only
            or p.user_id in (select ec.entered_id from public._admin_entered_code() ec))
  ),
  j as (
    select x.*, coalesce(c.cards, 0) as cards, s.status as sub_status
      from ext x
      left join public._live_card_counts() c on c.user_id = x.user_id
      left join public.subscriptions s on s.user_id = x.user_id
  ),
  -- admin_stats' demos_near_cap, for these people.
  near as (
    select j.user_id from j where j.tier = 'demo' and j.cards >= 0.8 * j.cap
  ),
  -- A card refused at the cap, or the cap wall opened for them.
  hits as (
    select e.user_id, min(e.occurred_at) as first_hit
      from public.analytics_events e
     where ((e.event = 'card_create_blocked' and e.props->>'reason' in ('server_cap', 'demo_cap', 'demo_cap_cell'))
         or (e.event = 'pricing_view' and e.props->>'header' = 'cap-hit'))
       and e.user_id in (select x.user_id from ext x)
     group by e.user_id
  ),
  hit_rows as (
    select h.user_id, h.first_hit, j.email, j.joined_at, j.cap, j.cards, j.tier, j.sub_status,
           (select count(*) from public.analytics_events a
             where a.user_id = h.user_id and a.event = 'up_exposure_summary'
               and a.props->>'outcome' = 'dismiss')::int                                  as closed_offer,
           exists (select 1 from public.analytics_events a
                    where a.user_id = h.user_id and a.event = 'pricing_creator_intent')        as pressed,
           exists (select 1 from public.analytics_events a
                    where a.user_id = h.user_id and a.event = 'checkout_open')                 as checkout,
           (select a.props->>'choice' from public.analytics_events a
             where a.user_id = h.user_id and a.event = 'upgrade_reason_answered'
             order by a.occurred_at desc limit 1)                                            as why,
           (select count(*) from public.analytics_events a
             where a.user_id = h.user_id and a.event = 'card_deleted'
               and a.occurred_at >= h.first_hit)::int                                       as deleted_after,
           -- The most cards refused in one go: a batch of 85 dropped on an
           -- empty cluster is how someone holding no cards hits the cap.
           (select max(case when a.props->>'n' ~ '^[0-9]{1,6}$' then (a.props->>'n')::int end)
              from public.analytics_events a
             where a.user_id = h.user_id and a.event = 'card_create_blocked'
               and a.props->>'reason' in ('server_cap', 'demo_cap', 'demo_cap_cell'))           as refused_most,
           (select count(*) from public.user_active_day d
             where d.user_id = h.user_id
               and d.day > (h.first_hit at time zone 'utc')::date)::int                     as days_back,
           (select max(d.day) from public.user_active_day d where d.user_id = h.user_id)     as last_seen
      from hits h
      join j on j.user_id = h.user_id
  ),
  trials as (
    select j.user_id, j.email, j.cap, j.cards, s.plan, s.monthly_amount_cents,
           s.cancel_at_period_end, s.current_period_end, s.trial_reminder_sent_at,
           j.creator_trial_started_at as started_at,
           (select count(*) from public.user_active_day d
             where d.user_id = j.user_id
               and d.day > (j.creator_trial_started_at at time zone 'utc')::date)::int      as days_back,
           (select max(d.day) from public.user_active_day d where d.user_id = j.user_id)     as last_seen,
           (select h.first_hit from hits h where h.user_id = j.user_id)                       as hit_cap_at,
           (select min(a.occurred_at) from public.analytics_events a
             where a.user_id = j.user_id and a.event = 'pricing_creator_intent')             as pressed_at,
           (select min(a.occurred_at) from public.analytics_events a
             where a.user_id = j.user_id and a.event = 'checkout_open')                      as checkout_at
      from j
      join public.subscriptions s on s.user_id = j.user_id
     where s.status = 'trialing'
  )
  select jsonb_build_object(
    'near_cap', jsonb_build_object(
      'people',    (select count(*) from near)::int,
      'active_7d', (select count(*) from near n
                     where exists (select 1 from public.user_active_day d
                                    where d.user_id = n.user_id and d.day >= current_date - 6))::int
    ),
    'paid_plan', (select count(*) from j where j.tier = 'paid')::int,
    -- On the paid tier with no live subscription. A past_due account is a
    -- subscriber whose card failed, not a comp, so it is not counted here
    -- (admin_stats' comped_paid still counts one as comped).
    'comped',    (select count(*) from j
                   where j.tier = 'paid'
                     and coalesce(j.sub_status, '') not in ('active', 'trialing', 'past_due'))::int,
    'paid_ever', (select count(*) from j where j.first_paid_at is not null)::int,
    'trials', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id',      t.user_id,
        'email',        t.email,
        'plan',         t.plan,
        'amount_cents', t.monthly_amount_cents,
        'cancelling',   coalesce(t.cancel_at_period_end, false),
        'ends_at',      t.current_period_end,
        'started_at',   t.started_at,
        'reminder_at',  t.trial_reminder_sent_at,
        'cards',        t.cards,
        'cap',          t.cap,
        'days_back',    t.days_back,
        'last_seen',    t.last_seen,
        'hit_cap_at',   t.hit_cap_at,
        'pressed_at',   t.pressed_at,
        'checkout_at',  t.checkout_at
      ) order by t.current_period_end) from trials t), '[]'::jsonb),
    'cap_hits', jsonb_build_object(
      'since', (select min(h.first_hit) from hits h),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'user_id',       r.user_id,
          'email',         r.email,
          'joined_at',     r.joined_at,
          'first_hit',     r.first_hit,
          'cap',           r.cap,
          'cards',         r.cards,
          'tier',          r.tier,
          'sub_status',    r.sub_status,
          'closed_offer',  r.closed_offer,
          'pressed',       r.pressed,
          'checkout',      r.checkout,
          'why',           r.why,
          'why_label',     case when r.why is null then null else public._upgrade_reason_label(r.why) end,
          'deleted_after', r.deleted_after,
          'refused_most',  r.refused_most,
          'days_back',     r.days_back,
          'last_seen',     r.last_seen
        ) order by r.first_hit desc) from hit_rows r), '[]'::jsonb)
    )
  )
  into v_out;

  return v_out;
end $function$;

comment on function public.admin_money_people(boolean, boolean) is
  'Analytics › Money (0492): free accounts at or near the cap (80% of their cap or more, as admin_stats counts them) and how many were active in the last 7 days; paid-plan, comped and ever-paid counts; the running trials; and everyone who has hit the cap (a card refused at it, or the cap wall opened), newest first, with what they did after. Same people as admin_money_path.';

revoke execute on function public.admin_money_people(boolean, boolean) from public, anon;
grant execute on function public.admin_money_people(boolean, boolean) to authenticated, service_role;

-- ── Proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  v_sig text;
  v_def text;
begin
  foreach v_sig in array array['public.admin_money_path(boolean,boolean)', 'public.admin_money_people(boolean,boolean)'] loop
    if to_regprocedure(v_sig) is null then
      raise exception '0492: % is missing', v_sig;
    end if;
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '0492: % is reachable signed out', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig, 'execute')
       or not has_function_privilege('service_role', v_sig, 'execute') then
      raise exception '0492: % lost its grant', v_sig;
    end if;
    if obj_description(v_sig::regprocedure, 'pg_proc') not like 'Analytics › Money (0492)%' then
      raise exception '0492: % has no comment', v_sig;
    end if;
    v_def := pg_get_functiondef(v_sig::regprocedure);
    if v_def not like '%perform public._require_admin();%'
       or v_def not like '%p.banned_at is null%'
       or v_def not like '%public._admin_entered_code()%' then
      raise exception '0492: % lost its gate, its ban rule or its code-entry rule', v_sig;
    end if;
  end loop;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('admin_money_path', 'admin_money_people')) <> 2 then
    raise exception '0492: an overload sits beside the money reads';
  end if;
end $proof$;

notify pgrst, 'reload schema';

commit;
