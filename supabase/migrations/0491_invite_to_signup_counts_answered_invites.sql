-- 0491 — "Invite → signup" divides answered invites by invites.
--
-- The referral panel's "Invite → signup" was every collaboration referral
-- divided by the emailed invites to people without an account. Collaboration
-- referrals also come in through invite links, which the denominator never
-- counted, so the rate ran past 100% in an ordinary window and said nothing
-- about whether an emailed invite gets answered.
--
-- admin_referral_stats now reports invites.signed_up: the emailed invites in
-- the window that someone signed up with (claimed_by, written when the
-- account is created), and under p_verified_only only once that person
-- entered the code, since the claim lands before they do. The panel divides
-- that by invites.pending_signup, the same invites. Links keep their own
-- figure, claimed against created.
--
-- Same signature as 0490, so create or replace keeps its grants and comment;
-- the proof says so. Every other line is 0490's.

begin;

set local lock_timeout = '3s';

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
    select pi.invited_by, pi.claimed_by
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
      -- An emailed invite someone signed up with. The claim is written when
      -- the account is created, before its owner enters the code.
      (select count(*) from inv_pending ip
        where ip.claimed_by is not null
          and ip.claimed_by not in (select bn.user_id from banned bn)
          and (not p_verified_only
               or ip.claimed_by in (select ec.entered_id from public._admin_entered_code() ec)))::int as signed_up,
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
      'signed_up',      i.signed_up,
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

-- ── Proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  v_sig constant text := 'public.admin_referral_stats(integer,boolean,boolean)';
  v_def text;
begin
  if has_function_privilege('anon', v_sig, 'execute') then
    raise exception '0491: % is reachable signed out', v_sig;
  end if;
  if not has_function_privilege('authenticated', v_sig, 'execute')
     or not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception '0491: % lost its grant', v_sig;
  end if;
  if obj_description(v_sig::regprocedure, 'pg_proc') not like '%banned_left_out%' then
    raise exception '0491: % lost its comment', v_sig;
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_referral_stats') <> 1 then
    raise exception '0491: admin_referral_stats has an overload beside it';
  end if;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if v_def not like '%perform public._require_admin();%'
     or v_def not like '%public._admin_entered_code()%'
     or v_def not like '%banned_at is not null%'
     or v_def not like '%''signed_up'',      i.signed_up%' then
    raise exception '0491: % lost its gate, its code-entry rule, its ban rule or signed_up', v_sig;
  end if;
end $proof$;

notify pgrst, 'reload schema';

commit;
