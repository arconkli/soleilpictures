-- 0493 — Analytics › Money counts who is paying the way it counts everyone
-- else.
--
-- 0492's admin_money_people gave the Money view every people figure but one:
-- the Paying tile had only admin_stats' sub_counts, which counts every
-- subscription in the table, the team's included, while the tiles beside it
-- follow the Internal and code-entered toggles. So this restates the read with
-- two more figures from the same rows:
--
--   paying    an active subscription
--   past_due  a subscriber whose card is failing: not paying, and not a comp
--
-- Everything else in the body is 0492's, unchanged. Revenue stays with
-- admin_stats (mrr_cents), which is money, not people.
--
-- Restated, so the 0311 grants are restated with it and proved below.

begin;

set local lock_timeout = '3s';

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
    -- People, not revenue: admin_stats' mrr_cents is what Stripe charges
    -- everyone, team included; these follow the toggles like every count here.
    'paying',    (select count(*) from j where j.sub_status = 'active')::int,
    'past_due',  (select count(*) from j where j.sub_status = 'past_due')::int,
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
  'Analytics › Money (0492, 0493): free accounts at or near the cap (80% of their cap or more, as admin_stats counts them) and how many were active in the last 7 days; paid-plan, paying, past-due, comped and ever-paid counts; the running trials; and everyone who has hit the cap (a card refused at it, or the cap wall opened), newest first, with what they did after. Same people as admin_money_path.';

revoke execute on function public.admin_money_people(boolean, boolean) from public, anon;
grant execute on function public.admin_money_people(boolean, boolean) to authenticated, service_role;

-- ── Proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  v_sig constant text := 'public.admin_money_people(boolean,boolean)';
  v_def text;
begin
  if to_regprocedure(v_sig) is null then
    raise exception '0493: % is missing', v_sig;
  end if;
  if has_function_privilege('anon', v_sig, 'execute') then
    raise exception '0493: % is reachable signed out', v_sig;
  end if;
  if not has_function_privilege('authenticated', v_sig, 'execute')
     or not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception '0493: % lost its grant', v_sig;
  end if;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if v_def not like '%perform public._require_admin();%'
     or v_def not like '%p.banned_at is null%'
     or v_def not like '%''paying'',    (select count(*) from j where j.sub_status = ''active'')::int%' then
    raise exception '0493: % lost its gate, its ban rule or its paying count', v_sig;
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_money_people') <> 1 then
    raise exception '0493: an overload sits beside admin_money_people';
  end if;
end $proof$;

notify pgrst, 'reload schema';

commit;
