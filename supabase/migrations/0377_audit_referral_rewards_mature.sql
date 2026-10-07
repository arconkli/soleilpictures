-- 0377 — a referral pays the referrer once the friend is real, a few at a time.
--
-- A referral credited the referrer with bonus cards the moment the new
-- account placed its first card, usually minutes after it signed up (audit
-- AC-12). Accounts cost nothing to make, so one person could sign up through
-- their own link again and again, drop a card in each, and mint free capacity
-- without limit. Emailed invitations and edit links make referrals too (source
-- 'collab'), so the same reward paid for invitation spam that found a taker.
--
-- "Got started" still counts the moment it happens, and the friend's own
-- bonus at signup is untouched. The referrer's reward now waits until:
--
--   - the friend's account is c_mature_hours old,
--   - it has been opened in the app (a user_presence row, touch_presence),
--   - neither account is banned,
--   - and the referrer has had fewer than c_per_30_days rewards in the last
--     30 days. Past that, rewards wait their turn, oldest first.
--
-- _pay_referral_rewards() runs hourly and on every activation. The stats
-- count cards actually credited ("Cards earned") and, separately, rewards
-- still on their way. The paid-referral reward (a free month when a friend
-- subscribes) is a real payment and is left as it was.

begin;

create or replace function public._pay_referral_rewards(p_referee uuid default null)
returns integer
language plpgsql security definer
set search_path = public, auth as $$
declare
  c_mature_hours constant integer := 72;
  c_per_30_days  constant integer := 4;
  c_reward_cards constant integer := 25;
  r   record;
  v_n integer := 0;
begin
  for r in
    select rf.id, rf.referrer_id, rf.referee_id
      from public.referrals rf
      join auth.users u on u.id = rf.referee_id
     where rf.status = 'activated'
       and rf.reward_granted_at is null
       and (p_referee is null or rf.referee_id = p_referee)
       and u.created_at <= now() - make_interval(hours => c_mature_hours)
       and exists (select 1 from public.user_presence pr where pr.user_id = rf.referee_id)
       and not public._user_banned(rf.referee_id)
       and not public._user_banned(rf.referrer_id)
     order by rf.activated_at, rf.id
     for update of rf skip locked
  loop
    -- One referrer at a time, so two payouts can't both read "3 this month".
    perform pg_advisory_xact_lock(hashtext('referral_rewards:' || r.referrer_id::text));
    if (select count(*) from public.referrals x
         where x.referrer_id = r.referrer_id
           and x.reward_granted_at > now() - interval '30 days') >= c_per_30_days then
      continue;
    end if;
    update public.referrals set reward_granted_at = now() where id = r.id;
    update public.profiles
       set bonus_card_credits = coalesce(bonus_card_credits, 0) + c_reward_cards
     where user_id = r.referrer_id;
    insert into public.analytics_events (user_id, event, props)
    values (r.referrer_id, 'referral_reward_granted',
            jsonb_build_object('referee', r.referee_id, 'amount', c_reward_cards));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Called when the friend places their first card (_stamp_first_card) or joins
-- through an edit link with a card already placed (claim_collab_link). Marks
-- them started, then pays whatever is already due. A payout failure must not
-- undo the activation: _stamp_first_card fires once per account, so a lost
-- activation is lost for good. The hourly run pays it instead.
create or replace function public.grant_referral_reward(p_referee uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare v_referrer uuid;
begin
  update public.referrals
     set status = 'activated', activated_at = coalesce(activated_at, now())
   where referee_id = p_referee and status = 'pending'
  returning referrer_id into v_referrer;

  if v_referrer is not null then
    insert into public.analytics_events (user_id, event, props)
    values (p_referee, 'referral_activated', '{}'::jsonb);
  end if;

  begin
    perform public._pay_referral_rewards(p_referee);
  exception when others then
    raise warning 'grant_referral_reward: payout deferred: %', sqlerrm;
  end;
end;
$$;

-- "Cards earned" is what was credited; rewards_waiting is what is on its way.
-- The return type changes, so the function is dropped and its grant restated.
drop function public.get_my_referral_stats();
create function public.get_my_referral_stats()
returns table(code text, friends_joined integer, friends_activated integer, pending integer,
              cards_earned integer, friends_paid integer, months_earned integer,
              rewards_waiting integer)
language sql stable security definer
set search_path = public as $$
  select
    (select referral_code from public.profiles where user_id = auth.uid()),
    count(*)::integer,
    count(*) filter (where status = 'activated')::integer,
    count(*) filter (where status = 'pending')::integer,
    (count(*) filter (where reward_granted_at is not null) * 25)::integer,
    count(*) filter (where paid_reward_granted_at is not null)::integer,
    coalesce(sum(paid_reward_months), 0)::integer,
    count(*) filter (where status = 'activated' and reward_granted_at is null)::integer
  from public.referrals where referrer_id = auth.uid();
$$;
revoke execute on function public.get_my_referral_stats() from public, anon;
grant execute on function public.get_my_referral_stats() to authenticated, service_role;

-- The admin read counted every activation as cards granted.
CREATE OR REPLACE FUNCTION public.admin_referral_stats(p_days integer DEFAULT 30, p_exclude_internal boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

revoke execute on function public._pay_referral_rewards(uuid) from public, anon, authenticated;
revoke execute on function public.grant_referral_reward(uuid) from public, anon, authenticated;

select cron.schedule('referral-rewards', '23 * * * *', $$select public._pay_referral_rewards()$$);

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
begin
  if has_function_privilege('anon', 'public._pay_referral_rewards(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._pay_referral_rewards(uuid)', 'execute')
     or has_function_privilege('anon', 'public.grant_referral_reward(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.grant_referral_reward(uuid)', 'execute') then
    raise exception '0377: a referral payout is client-callable';
  end if;
  if has_function_privilege('anon', 'public.get_my_referral_stats()', 'execute')
     or not has_function_privilege('authenticated', 'public.get_my_referral_stats()', 'execute') then
    raise exception '0377: get_my_referral_stats grants are wrong';
  end if;
  if has_function_privilege('authenticated', 'public.admin_referral_stats(integer, boolean)', 'execute')
     and position('_require_admin' in (select prosrc from pg_proc
                                         where oid = 'public.admin_referral_stats(integer, boolean)'::regprocedure)) = 0 then
    raise exception '0377: admin_referral_stats lost its admin check';
  end if;
  if not exists (select 1 from cron.job where jobname = 'referral-rewards' and active) then
    raise exception '0377: the payout schedule is missing';
  end if;
end $$;

commit;
