-- 0140_experiment_harness.sql
--
-- Server side of the minimal A/B harness (see boards/src/lib/experiments.js).
-- Assignment is deterministic + client-side, so this migration is intentionally
-- small: a stamp-once write so the assigned arm is queryable per user, and a
-- retention RPC that splits the existing curve by arm. NOTE: get_my_tier is
-- deliberately NOT touched — the client recomputes arms deterministically and
-- never needs the server to echo them back, which avoids the risky byte-identical
-- reproduction of that function.
--
-- Arms are stored in profiles.settings.experiments as a flat { "<key>": "<arm>" }
-- map — no new table, no new column — exactly how admin_retention_by_source reads
-- profiles.first_source. Conventions mirror 0080/0120 (stamp-once 'first-touch
-- wins', _require_admin, internal exclusion, revoke/grant).

------------------------------------------------------------------
-- 1. set_experiment_arm — stamp the caller's arm ONCE per experiment key.
--    Absent-only (first enrollment wins), so a later weight change never
--    re-buckets an already-enrolled user. jsonb_set can't create the nested
--    'experiments' object, so ensure it exists first.
------------------------------------------------------------------
create or replace function public.set_experiment_arm(p_key text, p_arm text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce(p_key,'') = '' or coalesce(p_arm,'') = '' then return; end if;
  update public.profiles
     set settings = jsonb_set(
           case when coalesce(settings, '{}'::jsonb) ? 'experiments'
                then coalesce(settings, '{}'::jsonb)
                else coalesce(settings, '{}'::jsonb) || '{"experiments":{}}'::jsonb end,
           array['experiments', p_key],
           to_jsonb(p_arm::text),
           true)
   where user_id = v_uid
     and coalesce(settings->'experiments'->>p_key, '') = '';   -- first-touch wins
end $function$;
revoke all on function public.set_experiment_arm(text, text) from public;
grant execute on function public.set_experiment_arm(text, text) to authenticated;

------------------------------------------------------------------
-- 2. admin_retention_by_experiment — the pooled retention curve split by arm for
--    one experiment key. A near-clone of admin_retention_by_source (0120):
--    same observable-window clamp + internal exclusion, grouping on the stamped
--    arm instead of the acquisition-source bucket. Only enrolled users (an arm
--    present for p_key) are included.
------------------------------------------------------------------
create or replace function public.admin_retention_by_experiment(
  p_key text, p_window_days integer default 30, p_exclude_internal boolean default true
)
returns table(arm text, day_offset integer, eligible integer, active integer, active_pct numeric)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_track_start date;
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day,
           p.settings->'experiments'->>p_key as arm
      from auth.users usr
      join public.profiles p on p.user_id = usr.id
     where usr.email_confirmed_at is not null
       and p.settings->'experiments'->>p_key is not null
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  grid as (
    select u.arm, u.user_id, d.day_offset, (u.signup_day + d.day_offset) as cal_day
      from u cross join generate_series(0, p_window_days) as d(day_offset)
     where u.signup_day + d.day_offset <= current_date
       and u.signup_day + d.day_offset >= v_track_start
  ),
  marked as (
    select g.arm, g.day_offset,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id and a.day = g.cal_day) as is_active
      from grid g
  )
  select m.arm, m.day_offset,
         count(*)::int,
         sum(case when m.is_active then 1 else 0 end)::int,
         round(sum(case when m.is_active then 1 else 0 end)::numeric / nullif(count(*), 0), 4)
    from marked m
   group by m.arm, m.day_offset
   order by m.arm, m.day_offset;
end $function$;
revoke all on function public.admin_retention_by_experiment(text, integer, boolean) from public;
grant execute on function public.admin_retention_by_experiment(text, integer, boolean) to authenticated;
