-- 0185 — Extend admin_referral_stats with the invite-side of the k-factor.
--
-- The referrals ledger only sees SIGNUPS, so "invites per activated user" —
-- the numerator of the collaboration growth loop — was invisible. Add an
-- `invites` object counting what actually went out: pending_invites rows
-- (email invites to non-users, the signup-capable kind) + board_shares grants
-- (invitee already had an account). The client-side invite_sent event ships in
-- the same release, but the ledger tables backfill history the event can't.
--
-- Same signature, safe CREATE OR REPLACE; existing fields reproduced verbatim
-- from 0170 (drift-aware). Applied via Supabase MCP.
create or replace function public.admin_referral_stats(p_days integer default 30, p_exclude_internal boolean default true)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
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
  from agg a, inv i;

  return v_out;
end $$;
