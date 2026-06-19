-- 0150_admin_stats_total_time.sql
--
-- Add total_seconds_in_app to admin_stats — the summed time-in-app across every
-- registered user (profiles.seconds_in_app), so the Command Center can show a
-- "Time in app" stat in place of the tier-mix donut. Summed over the same
-- verified population as the other admin_stats counts (anyone with accumulated
-- time has logged in anyway, so the verified filter is consistent, not lossy).
--
-- Same signature as 0149's admin_stats(boolean) → CREATE OR REPLACE, no DROP,
-- grants persist (re-issued below to match house style).

create or replace function public.admin_stats(p_verified_only boolean default true)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
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
    'sub_counts',      coalesce((select jsonb_object_agg(status, n) from (
                          select status, count(*) as n
                          from public.subscriptions
                          where status is not null
                          group by status
                        ) s), '{}'::jsonb),
    'mrr_cents',       coalesce((
                          select sum(coalesce(
                            monthly_amount_cents,
                            case when plan = 'monthly' then 2500
                                 when plan = 'annual'  then 2000
                                 else 0 end
                          ))::int
                          from public.subscriptions
                          where status in ('active', 'trialing')
                        ), 0),
    'comped_paid',     (select count(*) from public.profiles p
                          where p.tier = 'paid'
                            and not exists (
                              select 1 from public.subscriptions s
                              where s.user_id = p.user_id and s.status in ('active', 'trialing')
                            )),
    'discounted_subs', (select count(*) from public.subscriptions
                          where status in ('active', 'trialing') and discount is not null),
    'waitlist_pending',(select count(*) from public.waitlist_entries where status = 'pending'),
    'waitlist_total',  (select count(*) from public.waitlist_entries)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.admin_stats(boolean) from public;
grant execute on function public.admin_stats(boolean) to authenticated;
