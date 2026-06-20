-- Device segmentation for the activation funnel, so we can measure whether the
-- mobile first-use fixes move mobile activation. profiles/auth.users carry no
-- device, so derive each user's modal device from analytics_events.props.
--
-- Applied to prod via MCP apply_migration (admin_activation_funnel_by_device).
-- This file mirrors it for the repo record.

-- Per-user modal device (most frequent non-null device_type; 'unknown' if none).
create or replace function public._user_device_map()
returns table(user_id uuid, device text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select e.user_id,
         coalesce(mode() within group (order by nullif(e.props->>'device_type','')), 'unknown') as device
  from public.analytics_events e
  where e.user_id is not null
  group by e.user_id
$$;
revoke all on function public._user_device_map() from public;
revoke all on function public._user_device_map() from anon;
grant execute on function public._user_device_map() to authenticated;

-- Overload of admin_activation_funnel with a device filter. NEW arity (4 args),
-- so the existing 0/3-arg versions and their callers are untouched. p_device is
-- one of 'mobile' | 'desktop' | 'tablet' | 'unknown'; null/'' = all devices.
create or replace function public.admin_activation_funnel(
  p_days integer,
  p_exclude_internal boolean,
  p_verified_only boolean,
  p_device text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_out jsonb; v_dev text;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  v_dev := nullif(trim(coalesce(p_device, '')), '');
  with p as (
    select pr.*
      from public.profiles pr
      join auth.users u on u.id = pr.user_id
      left join public._user_device_map() dm on dm.user_id = pr.user_id
     where (not p_verified_only or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
       and u.created_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
       and (v_dev is null or coalesce(dm.device, 'unknown') = v_dev)
  )
  select jsonb_build_object(
    'signed_up',       (select count(*) from p),
    'first_board',     (select count(*) from p where first_board_at           is not null),
    'first_card',      (select count(*) from p where first_card_at            is not null),
    'populated_board', (select count(*) from p where first_populated_board_at is not null),
    'first_share',     (select count(*) from p where first_share_at           is not null),
    'first_backlink',  (select count(*) from p where first_backlink_at        is not null),
    'first_paid',      (select count(*) from p where first_paid_at            is not null)
  ) into v_out;
  return v_out;
end;
$function$;
grant execute on function public.admin_activation_funnel(integer, boolean, boolean, text) to authenticated;
