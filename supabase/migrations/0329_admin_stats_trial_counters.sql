-- 0329 — the overview leads with people ON a trial, not with the free tier.
--
-- 0328 put the free-tier population on the overview. The number actually worth
-- watching is the one in motion: how many people are inside a Creator trial
-- right now, how many have ever started one, and how many of those went on to
-- pay. trialing_subs already existed; started and converted did not, and
-- computing them from the trial funnel RPC would have cost the overview a
-- second call for two integers.
--
-- 'started' reads profiles.creator_trial_started_at, which is stamped when a
-- subscription actually reaches 'trialing' rather than when a checkout session
-- is created — so someone who bounced at Stripe's card form is not counted as
-- having had their trial. 'converted' requires a currently ACTIVE subscription
-- on an account that trialed, which is the only definition under which money
-- has demonstrably changed hands.
--
-- The full body is identical to 0328's with the two counters added; see that
-- migration's header for why the card counts use the enforcer's own weighted,
-- workspace-owner-keyed sum.

create or replace function public.admin_stats(p_verified_only boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_out jsonb;
begin
  perform public._require_admin();

  select jsonb_build_object(
    'total_users',     (select count(*) from auth.users u
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))),
    'new_users_7d',    (select count(*) from auth.users u
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and u.created_at >= now() - interval '7 days'),
    'tier_counts',     coalesce((select jsonb_object_agg(tier, n) from (
                          select p.tier, count(*) as n
                          from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                          group by p.tier
                        ) t), '{}'::jsonb),
    'total_seconds_in_app',
                       (select coalesce(sum(p.seconds_in_app), 0)::bigint
                          from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))),
    -- ── The free tier, and how much pressure is behind the paywall ──────────
    'demo_users',      (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where p.tier = 'demo'
                            and not coalesce(p.is_service, false)
                            and (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))),
    'demos_near_cap',  (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          left join (
                            select w.created_by as uid, sum(c.weight)::int as cards
                              from public.card_index c
                              join public.boards b     on b.id = c.board_id
                              join public.workspaces w on w.id = b.workspace_id
                             group by 1
                          ) l on l.uid = p.user_id
                          where p.tier = 'demo'
                            and not coalesce(p.is_service, false)
                            and (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and coalesce(l.cards, 0)
                                >= 0.8 * (p.card_cap_base + coalesce(p.bonus_card_credits, 0))),
    'demos_trial_eligible',
                       (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          left join (
                            select w.created_by as uid, sum(c.weight)::int as cards
                              from public.card_index c
                              join public.boards b     on b.id = c.board_id
                              join public.workspaces w on w.id = b.workspace_id
                             group by 1
                          ) l on l.uid = p.user_id
                          where p.tier = 'demo'
                            and not coalesce(p.is_service, false)
                            and p.creator_trial_started_at is null
                            and (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            -- mirrors trialCore: a body of work OR at/near the cap
                            and (coalesce(l.cards, 0) >= 13
                                 or coalesce(l.cards, 0)
                                    >= 0.8 * (p.card_cap_base + coalesce(p.bonus_card_credits, 0)))),
    -- People inside a trial right now, ever, and out the far side of one.
    'trials_started',  (select count(*) from public.profiles p
                          where p.creator_trial_started_at is not null
                            and not coalesce(p.is_service, false)),
    'trials_converted',(select count(*) from public.profiles p
                          join public.subscriptions s on s.user_id = p.user_id
                          where p.creator_trial_started_at is not null
                            and s.status = 'active'
                            and not coalesce(p.is_service, false)),
    'sub_counts',      coalesce((select jsonb_object_agg(status, n) from (
                          select status, count(*) as n
                          from public.subscriptions
                          where status is not null
                          group by status
                        ) s), '{}'::jsonb),
    -- MONEY ONLY (0327). A trialing subscription carries the full list price
    -- and has collected nothing.
    'mrr_cents',       coalesce((
                          select sum(coalesce(
                            monthly_amount_cents,
                            case when plan = 'monthly' then 2500
                                 when plan = 'annual'  then 2000
                                 else 0 end
                          ))::int
                          from public.subscriptions
                          where status = 'active'
                        ), 0),
    'trialing_subs',   (select count(*) from public.subscriptions where status = 'trialing'),
    -- ACCESS, not money: a trialing user genuinely has the paid product.
    'comped_paid',     (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where p.tier = 'paid'
                            and (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and not exists (
                              select 1 from public.subscriptions s
                              where s.user_id = p.user_id and s.status in ('active', 'trialing')
                            )),
    'subscribed_paid', (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where p.tier = 'paid'
                            and (not p_verified_only
                                 or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
                            and exists (
                              select 1 from public.subscriptions s
                              where s.user_id = p.user_id and s.status in ('active', 'trialing')
                            )),
    'discounted_subs', (select count(*) from public.subscriptions
                          where status in ('active', 'trialing') and discount is not null),
    'waitlist_pending',(select count(*) from public.waitlist_entries where status = 'pending'),
    'waitlist_total',  (select count(*) from public.waitlist_entries)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.admin_stats(boolean) from public, anon;
grant execute on function public.admin_stats(boolean) to authenticated, service_role;

comment on function public.admin_stats(boolean) is
  'Admin overview counters. Money is active subscriptions only; trialing_subs / '
  'trials_started / trials_converted describe the Creator trial. demo_users / demos_near_cap / demos_trial_eligible describe the free tier and '
  'the pressure behind the paywall, using the cap enforcer''s own weighted, '
  'workspace-owner-keyed card count rather than the drifting profiles.demo_card_count.';

do $$
begin
  if has_function_privilege('anon', 'public.admin_stats(boolean)', 'execute') then
    raise exception '0329: admin_stats must not be anon-callable';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_stats(boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_stats(boolean)', 'execute') then
    raise exception '0329: admin_stats grants are wrong';
  end if;
end $$;
