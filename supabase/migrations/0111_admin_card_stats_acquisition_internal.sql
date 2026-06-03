-- 0111_admin_card_stats_acquisition_internal.sql
--
-- Follow-up to 0110: two more product-metric RPCs surfaced by the analytics
-- views still counted internal traffic, which broke honesty *within* a screen
-- (e.g. admin_cards_per_day excluded the founder's 514 cards but admin_card_stats
-- did not, so the line chart and the kind breakdown disagreed). Give both the
-- same p_exclude_internal boolean DEFAULT true toggle, reusing the
-- _internal_user_ids() helper created in 0110.

-- admin_card_stats — owner via boards.created_by; exclude internal-owned cards.
drop function if exists public.admin_card_stats(integer);
create or replace function public.admin_card_stats(p_days integer DEFAULT 30, p_exclude_internal boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare v_out jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  with c as (
    select ci.kind, coalesce(p.tier, 'demo')::text as tier
    from public.card_index ci
    join public.boards b on b.id = ci.board_id
    left join public.profiles p on p.user_id = b.created_by
    where ci.updated_at >= now() - (p_days || ' days')::interval
      and (not p_exclude_internal or b.created_by is null or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))
  )
  select jsonb_build_object(
    'total',        (select count(*) from c),
    'by_kind',      coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) as n from c group by kind) k), '{}'::jsonb),
    'by_tier',      coalesce((select jsonb_object_agg(tier, n) from (select tier, count(*) as n from c group by tier) t), '{}'::jsonb),
    'kind_by_tier', coalesce((select jsonb_object_agg(kind, by_t) from (
                       select kind, jsonb_object_agg(tier, n) as by_t
                       from (select kind, tier, count(*) as n from c group by kind, tier) inner_q
                       group by kind
                     ) kt), '{}'::jsonb)
  ) into v_out;
  return v_out;
end;
$function$;
revoke all on function public.admin_card_stats(integer, boolean) from public;
grant execute on function public.admin_card_stats(integer, boolean) to authenticated;

-- admin_acquisition_breakdown — first-touch source; exclude internal signups.
drop function if exists public.admin_acquisition_breakdown(integer);
create or replace function public.admin_acquisition_breakdown(p_days integer, p_exclude_internal boolean DEFAULT true)
 RETURNS TABLE(source text, signups integer, converted integer, conversion numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  return query
  with src as (
    select coalesce(nullif(p.first_source->>'utm_source', ''),
                    nullif(p.first_source->>'referrer', ''),
                    'direct') as source,
           p.first_paid_at is not null as paid
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where u.email_confirmed_at is not null
       and u.created_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  )
  select source,
         count(*)::int as signups,
         sum(case when paid then 1 else 0 end)::int as converted,
         round(sum(case when paid then 1 else 0 end)::numeric / nullif(count(*), 0), 4) as conversion
    from src group by source order by signups desc;
end;
$function$;
revoke all on function public.admin_acquisition_breakdown(integer, boolean) from public;
grant execute on function public.admin_acquisition_breakdown(integer, boolean) to authenticated;

create or replace function public.admin_acquisition_breakdown()
 RETURNS TABLE(source text, signups integer, converted integer, conversion numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ select * from public.admin_acquisition_breakdown(36500); $function$;
