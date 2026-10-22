-- 0490 — The money and referral figures count real people.
--
-- Two gaps the 0460 audit left in Analytics › Funnel:
--
--   1. What a banned account did was counted as growth. A burst of invite
--      abuse from banned accounts sat inside "Invites sent", and "Invite →
--      signup" divided real signups by it. admin_referral_stats now leaves out
--      everything a banned account did — the invites and links it sent, the
--      links it claimed, the referrals on either side of it, the editor seats
--      it owns or holds — and reports what it left out in a new
--      banned_left_out block, so the figures never drop silently. The two
--      money reads, admin_paid_reach and admin_trial_funnel, leave banned
--      accounts out of their populations as well.
--   2. The deck's "entered the code" toggle did not reach these three. Each
--      gains p_verified_only, read through 0461's _admin_entered_code(), so
--      the Funnel's money and referral figures count the same people as the
--      rest of the page. For referrals it filters the friend who joined: a
--      referral whose friend never entered the code is not a signup. It
--      defaults to false, the old behaviour, so the shipped client reads what
--      it read before until it passes the toggle.
--
-- Two smaller corrections ride along. Live invite links ignored the Internal
-- toggle while links created honoured it; both honour it now. And the trial
-- funnel's "Asked for it" counted anyone with the event, service accounts
-- included, while its other stages counted one population; it counts that
-- population now.
--
-- A new argument is a new signature, so, as in 0410 and 0460, each old
-- function is renamed out of PostgREST's way and closed to every client role,
-- and the new one restates its grants. Nothing is dropped. Each body is the
-- live one plus the filters above.

begin;

set local lock_timeout = '3s';

-- ── admin_referral_stats ────────────────────────────────────────────────────

alter function public.admin_referral_stats(integer, boolean) rename to admin_referral_stats_0377;
revoke execute on function public.admin_referral_stats_0377(integer, boolean) from public, anon, authenticated;

create or replace function public.admin_referral_stats(
  p_days integer default 30,
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

  with banned as (
    -- What a banned account did is abuse, not growth: it is left out of every
    -- figure below and counted once, in banned_left_out.
    select bp.user_id from public.profiles bp where bp.banned_at is not null
  ),
  r as (
    select ref.*
    from public.referrals ref
    where (p_days is null or p_days <= 0 or ref.created_at >= now() - (p_days || ' days')::interval)
      and (not p_exclude_internal
           or ref.referrer_id not in (select iu.user_id from public._internal_user_ids() iu))
      and ref.referrer_id not in (select bn.user_id from banned bn)
      and ref.referee_id not in (select bn.user_id from banned bn)
      and (not p_verified_only
           or ref.referee_id in (select ec.entered_id from public._admin_entered_code() ec))
  ),
  agg as (
    select
      count(*)::int                                                              as total,
      count(*) filter (where status = 'pending')::int                            as pending,
      count(*) filter (where status = 'activated')::int                          as activated,
      count(*) filter (where reward_granted_at is not null)::int                 as rewarded,
      count(*) filter (where source = 'link')::int                               as link_total,
      count(*) filter (where source = 'link' and status = 'activated')::int      as link_activated,
      count(*) filter (where source = 'collab')::int                             as collab_total,
      count(*) filter (where source = 'collab' and status = 'activated')::int    as collab_activated,
      count(distinct referrer_id)::int                                           as referring_users,
      count(*) filter (where paid_reward_granted_at is not null)::int            as paid_conversions,
      coalesce(sum(paid_reward_months), 0)::int                                  as months_granted,
      percentile_cont(0.5) within group (order by extract(epoch from (activated_at - created_at))/86400.0)
        filter (where status='activated' and activated_at is not null)           as median_days_activate
    from r
  ),
  inv_pending as (
    select pi.invited_by
    from public.pending_invites pi
    where (p_days is null or p_days <= 0 or pi.created_at >= now() - (p_days || ' days')::interval)
      and (not p_exclude_internal
           or pi.invited_by not in (select iu.user_id from public._internal_user_ids() iu))
      and (pi.invited_by is null or pi.invited_by not in (select bn.user_id from banned bn))
  ),
  inv_grants as (
    select bs.invited_by
    from public.board_shares bs
    where bs.invited_by is not null
      and (p_days is null or p_days <= 0 or bs.created_at >= now() - (p_days || ' days')::interval)
      and (not p_exclude_internal
           or bs.invited_by not in (select iu.user_id from public._internal_user_ids() iu))
      and bs.invited_by not in (select bn.user_id from banned bn)
  ),
  inv as (
    select
      (select count(*) from inv_pending)::int as pending_signup,
      (select count(*) from inv_grants)::int  as direct_grants,
      (select count(distinct u.invited_by) from (
         select invited_by from inv_pending
         union all
         select invited_by from inv_grants
       ) u where u.invited_by is not null)::int as inviting_users
  ),
  links as (
    select
      (select count(*) from public.public_share_links l
        where l.kind = 'invite'
          and (p_days is null or p_days <= 0 or l.created_at >= now() - (p_days || ' days')::interval)
          and (not p_exclude_internal or l.created_by is null
               or l.created_by not in (select iu.user_id from public._internal_user_ids() iu))
          and (l.created_by is null or l.created_by not in (select bn.user_id from banned bn)))::int as created,
      (select count(*) from public.board_shares bs
        where bs.via_link_token is not null
          and (p_days is null or p_days <= 0 or bs.created_at >= now() - (p_days || ' days')::interval)
          and (not p_exclude_internal or bs.invited_by is null
               or bs.invited_by not in (select iu.user_id from public._internal_user_ids() iu))
          and (bs.invited_by is null or bs.invited_by not in (select bn.user_id from banned bn))
          and bs.user_id not in (select bn.user_id from banned bn))::int as claimed,
      -- Live now, whenever made: not windowed, but the same people as created.
      (select count(*) from public.public_share_links l
        where l.kind = 'invite' and l.revoked_at is null
          and (l.expires_at is null or l.expires_at > now())
          and (not p_exclude_internal or l.created_by is null
               or l.created_by not in (select iu.user_id from public._internal_user_ids() iu))
          and (l.created_by is null or l.created_by not in (select bn.user_id from banned bn)))::int as active_links
  ),
  seats as (
    select
      count(*)::int                          as workspaces_with_editors,
      coalesce(max(s.editor_seats), 0)::int  as max_editors_per_owner
    from (
      select w.created_by, count(distinct bs.user_id)::int as editor_seats
      from public.board_shares bs
      join public.boards b     on b.id = bs.board_id
      join public.workspaces w on w.id = b.workspace_id
      where bs.role = 'editor'
        and (not p_exclude_internal
             or w.created_by not in (select iu.user_id from public._internal_user_ids() iu))
        and (w.created_by is null or w.created_by not in (select bn.user_id from banned bn))
        and bs.user_id not in (select bn.user_id from banned bn)
      group by w.created_by
    ) s
  ),
  left_out_rows as (
    select 'invite'::text as kind, pi.invited_by as who
      from public.pending_invites pi
     where (p_days is null or p_days <= 0 or pi.created_at >= now() - (p_days || ' days')::interval)
       and pi.invited_by in (select bn.user_id from banned bn)
    union all
    select 'invite', bs.invited_by
      from public.board_shares bs
     where (p_days is null or p_days <= 0 or bs.created_at >= now() - (p_days || ' days')::interval)
       and bs.invited_by in (select bn.user_id from banned bn)
    union all
    select 'link', l.created_by
      from public.public_share_links l
     where l.kind = 'invite'
       and (p_days is null or p_days <= 0 or l.created_at >= now() - (p_days || ' days')::interval)
       and l.created_by in (select bn.user_id from banned bn)
    union all
    select 'referral',
           case when ref.referrer_id in (select bn.user_id from banned bn) then ref.referrer_id
                else ref.referee_id end
      from public.referrals ref
     where (p_days is null or p_days <= 0 or ref.created_at >= now() - (p_days || ' days')::interval)
       and (ref.referrer_id in (select bn.user_id from banned bn)
            or ref.referee_id in (select bn.user_id from banned bn))
  ),
  left_out as (
    select
      count(*) filter (where lr.kind = 'invite')::int   as invites,
      count(*) filter (where lr.kind = 'link')::int     as links,
      count(*) filter (where lr.kind = 'referral')::int as referrals,
      count(distinct lr.who)::int                       as accounts
    from left_out_rows lr
  ),
  top as (
    select
      r.referrer_id,
      (select au.email::text from auth.users au where au.id = r.referrer_id)     as email,
      count(*)::int                                                              as friends_joined,
      count(*) filter (where r.status = 'activated')::int                        as friends_activated,
      count(*) filter (where r.paid_reward_granted_at is not null)::int          as friends_paid,
      (count(*) filter (where r.reward_granted_at is not null) * 25)::int        as cards_earned
    from r
    group by r.referrer_id
    order by friends_activated desc, friends_joined desc
    limit 10
  )
  select jsonb_build_object(
    'days',            p_days,
    'total',           a.total,
    'pending',         a.pending,
    'activated',       a.activated,
    'activation_rate', case when a.total > 0 then round(a.activated::numeric / a.total, 4) else null end,
    'cards_granted',   a.rewarded * 25,
    'referring_users', a.referring_users,
    'paid_conversions', a.paid_conversions,
    'months_granted',  a.months_granted,
    'k_factor',        case when a.referring_users > 0 then round(a.activated::numeric / a.referring_users, 3) else null end,
    'median_days_to_activate', round(a.median_days_activate::numeric, 1),
    'by_source', jsonb_build_object(
      'link',   jsonb_build_object('total', a.link_total,   'activated', a.link_activated),
      'collab', jsonb_build_object('total', a.collab_total, 'activated', a.collab_activated)
    ),
    'invites', jsonb_build_object(
      'sent_total',     i.pending_signup + i.direct_grants,
      'pending_signup', i.pending_signup,
      'direct_grants',  i.direct_grants,
      'inviting_users', i.inviting_users
    ),
    'link_invites', jsonb_build_object(
      'created',      l.created,
      'claimed',      l.claimed,
      'active_links', l.active_links
    ),
    'editor_seats', jsonb_build_object(
      'workspaces_with_editors', s.workspaces_with_editors,
      'max_editors_per_owner',   s.max_editors_per_owner
    ),
    'banned_left_out', jsonb_build_object(
      'accounts',  lo.accounts,
      'invites',   lo.invites,
      'links',     lo.links,
      'referrals', lo.referrals
    ),
    'top_referrers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id',           t.referrer_id,
        'email',             t.email,
        'friends_joined',    t.friends_joined,
        'friends_activated', t.friends_activated,
        'friends_paid',      t.friends_paid,
        'cards_earned',      t.cards_earned
      ))
      from top t
    ), '[]'::jsonb)
  )
  into v_out
  from agg a, inv i, links l, seats s, left_out lo;

  return v_out;
end $function$;

revoke execute on function public.admin_referral_stats(integer, boolean, boolean) from public, anon;
grant execute on function public.admin_referral_stats(integer, boolean, boolean) to authenticated, service_role;

comment on function public.admin_referral_stats(integer, boolean, boolean) is
  'Admin. Referrals, invites, invite links and editor seats in the window. Everything a banned account did is left '
  'out and counted in banned_left_out; p_verified_only keeps only referrals whose friend entered the emailed code (0490).';

-- ── admin_paid_reach ────────────────────────────────────────────────────────

alter function public.admin_paid_reach(date, boolean) rename to admin_paid_reach_0333;
revoke execute on function public.admin_paid_reach_0333(date, boolean) from public, anon, authenticated;

create or replace function public.admin_paid_reach(
  p_since date default '2026-06-16'::date,
  p_exclude_internal boolean default true,
  p_verified_only boolean default false
)
returns table(band text, band_order integer, users bigint, saw_price bigint, price_seen bigint, saw_wall bigint,
              saw_banner bigint, saw_toast bigint, clicked bigint, blocked bigint, intent bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  perform public._require_admin();
  return query
  with ext as (
    select p.user_id,
           coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0) as cap
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where u.created_at >= p_since
       and p.tier = 'demo'
       and not coalesce(p.is_service, false)
       and p.banned_at is null
       and (not p_exclude_internal or p.user_id not in (select _internal_user_ids()))
       and (not p_verified_only
            or p.user_id in (select ec.entered_id from public._admin_entered_code() ec))
  ),
  ci as (
    select l.user_id, l.cards from public._live_card_counts() l
  ),
  ev as (
    select e.user_id,
           bool_or(e.event = 'pricing_view')                                          as saw_price,
           bool_or(e.event = 'price_seen')                                            as price_seen,
           bool_or(e.event = 'pricing_view' and e.props->>'header' = 'cap-hit')        as saw_wall,
           bool_or(e.event = 'first_value_upgrade_view')                              as saw_banner,
           bool_or(e.event = 'up_cap_toast_view')                                     as saw_toast,
           bool_or(e.event in ('up_chip_click', 'up_settings_upgrade_click'))         as clicked,
           bool_or(e.event = 'card_create_blocked'
                   and e.props->>'reason' in ('server_cap', 'demo_cap', 'demo_cap_cell')) as blocked,
           bool_or(e.event = 'pricing_creator_intent')                                as intent
      from public.analytics_events e
     where e.user_id is not null
       and e.event in ('pricing_view', 'price_seen', 'first_value_upgrade_view', 'up_cap_toast_view',
                       'up_chip_click', 'up_settings_upgrade_click', 'card_create_blocked',
                       'pricing_creator_intent')
     group by 1
  ),
  banded as (
    select e.user_id,
           case when coalesce(ci.cards, 0) >= 0.8 * e.cap then 'At or near the cap (>=80%)'
                when coalesce(ci.cards, 0) >= 30 then '30+ cards'
                when coalesce(ci.cards, 0) >= 13 then '13-29 cards'
                when coalesce(ci.cards, 0) >= 6  then '6-12 cards'
                else 'Under 6 cards' end as band,
           case when coalesce(ci.cards, 0) >= 0.8 * e.cap then 1
                when coalesce(ci.cards, 0) >= 30 then 2
                when coalesce(ci.cards, 0) >= 13 then 3
                when coalesce(ci.cards, 0) >= 6  then 4
                else 5 end as band_order,
           v.*
      from ext e
      left join ci on ci.user_id = e.user_id
      left join ev v on v.user_id = e.user_id
  )
  select b.band, b.band_order,
         count(*)::bigint,
         count(*) filter (where b.saw_price)::bigint,
         count(*) filter (where b.price_seen)::bigint,
         count(*) filter (where b.saw_wall)::bigint,
         count(*) filter (where b.saw_banner)::bigint,
         count(*) filter (where b.saw_toast)::bigint,
         count(*) filter (where b.clicked)::bigint,
         count(*) filter (where b.blocked)::bigint,
         count(*) filter (where b.intent)::bigint
    from banded b
   group by b.band, b.band_order
   order by b.band_order;
end;
$function$;

revoke execute on function public.admin_paid_reach(date, boolean, boolean) from public, anon;
grant execute on function public.admin_paid_reach(date, boolean, boolean) to authenticated, service_role;

comment on function public.admin_paid_reach(date, boolean, boolean) is
  'Admin. Of demo accounts that signed up since p_since, by live-card band: how many were ever shown a price '
  '(pricing_view, price_seen), the wall, the banner, the toast; how many clicked an upgrade entry, were cap-blocked, '
  'or clicked Get Creator. Distinct users per column. The reach read the price-visibility change is graded on. '
  'Banned accounts are left out; p_verified_only keeps only those who entered the emailed code (0490).';

-- ── admin_trial_funnel ──────────────────────────────────────────────────────

alter function public.admin_trial_funnel(boolean) rename to admin_trial_funnel_0332;
revoke execute on function public.admin_trial_funnel_0332(boolean) from public, anon, authenticated;

create or replace function public.admin_trial_funnel(
  p_exclude_internal boolean default true,
  p_verified_only boolean default false
)
returns table(stage text, sort_order integer, people bigint, note text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_min_cards constant int := 13;
  v_cap_frac  constant numeric := 0.8;
begin
  perform public._require_admin();
  return query
  with ext as (
    select p.user_id,
           p.tier,
           p.creator_trial_started_at,
           p.first_paid_at,
           coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0) as cap
      from public.profiles p
     where not coalesce(p.is_service, false)
       and p.banned_at is null
       and (not p_exclude_internal or p.user_id not in (select _internal_user_ids()))
       and (not p_verified_only
            or p.user_id in (select ec.entered_id from public._admin_entered_code() ec))
  ),
  j as (
    select e.*, coalesce(c.cards, 0) as live_cards, s.status as sub_status
      from ext e
      left join public._live_card_counts() c on c.user_id = e.user_id
      left join public.subscriptions s on s.user_id = e.user_id
  )
  select * from (
    values
      ('Eligible for the trial today', 1,
       (select count(*) from j
         where tier = 'demo' and creator_trial_started_at is null
           and (live_cards >= v_min_cards or live_cards >= v_cap_frac * cap))::bigint,
       'Demo, never trialed, and holding a real body of work'),
      -- The same people as every other stage, not anyone who fired the event.
      ('Asked for it', 2,
       (select count(distinct a.user_id) from public.analytics_events a
         where a.event = 'pricing_creator_intent' and a.props->>'trial' = 'true'
           and a.user_id in (select e.user_id from ext e))::bigint,
       'Clicked the trial button'),
      ('Started one', 3,
       (select count(*) from j where creator_trial_started_at is not null)::bigint,
       'A subscription actually reached trialing'),
      ('On trial right now', 4,
       (select count(*) from j where sub_status = 'trialing')::bigint,
       'Paid access, no money yet, never counted as revenue'),
      ('Converted to paying', 5,
       (select count(*) from j
         where creator_trial_started_at is not null
           and first_paid_at is not null
           and first_paid_at >= creator_trial_started_at)::bigint,
       'Trialed, then a first charge cleared — counted once, forever'),
      ('Ended without paying', 6,
       (select count(*) from j
         where creator_trial_started_at is not null
           and coalesce(sub_status, 'canceled') <> 'trialing'
           and (first_paid_at is null or first_paid_at < creator_trial_started_at))::bigint,
       'Trial is over and no first charge ever cleared')
  ) as t(stage, sort_order, people, note)
  order by 2;
end;
$function$;

revoke execute on function public.admin_trial_funnel(boolean, boolean) from public, anon;
grant execute on function public.admin_trial_funnel(boolean, boolean) to authenticated, service_role;

comment on function public.admin_trial_funnel(boolean, boolean) is
  'Admin. The Creator trial stage by stage, every stage over one population: no service or banned accounts, the '
  'team out under p_exclude_internal, and only those who entered the emailed code under p_verified_only (0490). '
  'A trial in flight is never revenue.';

-- ── Proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  r     record;
  v_def text;
  v_n   integer;
begin
  for r in
    select * from (values
      ('public.admin_referral_stats(integer,boolean,boolean)'),
      ('public.admin_paid_reach(date,boolean,boolean)'),
      ('public.admin_trial_funnel(boolean,boolean)')
    ) as t(sig)
  loop
    if to_regprocedure(r.sig) is null then
      raise exception '0490: % is missing', r.sig;
    end if;
    if has_function_privilege('anon', r.sig, 'execute') then
      raise exception '0490: % is reachable signed out', r.sig;
    end if;
    if not has_function_privilege('authenticated', r.sig, 'execute')
       or not has_function_privilege('service_role', r.sig, 'execute') then
      raise exception '0490: % lost its grant', r.sig;
    end if;
    v_def := pg_get_functiondef(r.sig::regprocedure);
    if v_def not like '%perform public._require_admin();%'
       or v_def not like '%public._admin_entered_code()%'
       or v_def not like '%banned_at is %' then
      raise exception '0490: % lost its gate, its code-entry rule or its ban rule', r.sig;
    end if;
  end loop;

  -- One function per name: a leftover overload makes PostgREST's call ambiguous.
  select count(*) into v_n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('admin_referral_stats', 'admin_paid_reach', 'admin_trial_funnel');
  if v_n <> 3 then
    raise exception '0490: % functions answer to these three names, not 3', v_n;
  end if;

  -- The retired signatures are out of PostgREST's way, and out of reach.
  for r in
    select * from (values
      ('public.admin_referral_stats(integer,boolean)'),
      ('public.admin_paid_reach(date,boolean)'),
      ('public.admin_trial_funnel(boolean)')
    ) as t(sig)
  loop
    if to_regprocedure(r.sig) is not null then
      raise exception '0490: % is still there beside its replacement', r.sig;
    end if;
  end loop;
  for r in
    select * from (values
      ('public.admin_referral_stats_0377(integer,boolean)'),
      ('public.admin_paid_reach_0333(date,boolean)'),
      ('public.admin_trial_funnel_0332(boolean)')
    ) as t(sig)
  loop
    if has_function_privilege('anon', r.sig, 'execute')
       or has_function_privilege('authenticated', r.sig, 'execute') then
      raise exception '0490: the retired % is still callable', r.sig;
    end if;
  end loop;
end $proof$;

notify pgrst, 'reload schema';

commit;
