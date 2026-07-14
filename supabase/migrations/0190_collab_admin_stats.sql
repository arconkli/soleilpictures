-- 0190_collab_admin_stats.sql — invite-link + editor-seat visibility in the
-- admin referral widget.
--
-- Two additions to admin_referral_stats (re-created from the live 0185 body):
--   'link_invites'  — invite links created / claimed in the window + links
--                     currently live (0189's kind='invite' + via_link_token).
--   'editor_seats'  — the seat-watch for the fully-free-editors decision
--                     (0188): how many workspace owners have external editors
--                     and the largest seat count. ALL-TIME by design — this is
--                     the "is anyone piggybacking a whole org on one paid
--                     seat" gauge, and the future Team-plan prospect list.
--                     When it grows teeth, the dormant brake
--                     (admin_set_collab_editor_cap) is the lever.
--
-- admin_event_breakdown gains the collab-loop curated rows (invite_nudge_*,
-- invite_sent, invite_link_*).

create or replace function public.admin_referral_stats(p_days integer default 30, p_exclude_internal boolean default true)
returns jsonb
language plpgsql stable security definer
set search_path = public as $$
declare
  v_out jsonb;
begin
  perform public._require_admin();

  with r as (
    select ref.*
    from public.referrals ref
    where (p_days is null or p_days <= 0 or ref.created_at >= now() - (p_days || ' days')::interval)
      and (not p_exclude_internal
           or ref.referrer_id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  agg as (
    select
      count(*)::int                                                              as total,
      count(*) filter (where status = 'pending')::int                            as pending,
      count(*) filter (where status = 'activated')::int                          as activated,
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
  ),
  inv_grants as (
    select bs.invited_by
    from public.board_shares bs
    where bs.invited_by is not null
      and (p_days is null or p_days <= 0 or bs.created_at >= now() - (p_days || ' days')::interval)
      and (not p_exclude_internal
           or bs.invited_by not in (select iu.user_id from public._internal_user_ids() iu))
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
               or l.created_by not in (select iu.user_id from public._internal_user_ids() iu)))::int as created,
      (select count(*) from public.board_shares bs
        where bs.via_link_token is not null
          and (p_days is null or p_days <= 0 or bs.created_at >= now() - (p_days || ' days')::interval)
          and (not p_exclude_internal or bs.invited_by is null
               or bs.invited_by not in (select iu.user_id from public._internal_user_ids() iu)))::int as claimed,
      (select count(*) from public.public_share_links l
        where l.kind = 'invite' and l.revoked_at is null
          and (l.expires_at is null or l.expires_at > now()))::int as active_links
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
      group by w.created_by
    ) s
  ),
  top as (
    select
      r.referrer_id,
      (select au.email::text from auth.users au where au.id = r.referrer_id)     as email,
      count(*)::int                                                              as friends_joined,
      count(*) filter (where r.status = 'activated')::int                        as friends_activated,
      count(*) filter (where r.paid_reward_granted_at is not null)::int          as friends_paid,
      (count(*) filter (where r.status = 'activated') * 25)::int                 as cards_earned
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
    'cards_granted',   a.activated * 25,
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
  from agg a, inv i, links l, seats s;

  return v_out;
end $$;

create or replace function public.admin_event_breakdown(p_days integer default 30, p_exclude_internal boolean default true)
returns table(event text, sessions bigint, users bigint, total bigint, ord integer)
language plpgsql stable security definer
set search_path = public as $$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
  with ev as (
    select * from public.analytics_events
    where occurred_at >= now() - (p_days || ' days')::interval
      and (not p_exclude_internal or session_id is null or session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  curated(event, ord) as (
    values ('email_submit_error',1),('otp_verify_error',2),('landing_callback_error',3),('landing_edit_email',4),
           ('landing_explore_click',5),('welcome_cta',6),('waitlist_abandon',7),('waitlist_plan_toggle',8),
           ('waitlist_subscribe_cta',9),('pricing_plan_toggle',10),('pricing_demo_cta',11),('pricing_creator_intent',12),
           ('pricing_abandon',13),('checkout_error',14),('billing_portal_error',15),('checkout_stalled',16),
           ('checkout_verify_retry',17),('checkout_missing_session',18),('checkout_support_click',19),
           ('referral_open',20),('referral_tab_view',21),('referral_link_copied',22),('referral_link_shared',23),
           ('referral_nudge_view',24),('referral_nudge_cta',25),('referral_nudge_dismiss',26),
           ('referral_signup',27),('referral_activated',28),('referral_reward_granted',29),
           ('invite_nudge_view',30),('invite_nudge_cta',31),('invite_nudge_dismiss',32),('invite_sent',33),
           ('invite_link_created',34),('invite_link_view',35),('invite_link_join_click',36),('invite_link_claimed',37)
  )
  select c.event, count(distinct ev.session_id) as sessions, count(distinct ev.user_id) as users, count(ev.*) as total, c.ord
  from curated c left join ev on ev.event = c.event group by c.event, c.ord order by c.ord;
end;
$$;
