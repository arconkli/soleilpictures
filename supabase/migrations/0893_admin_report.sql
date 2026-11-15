-- 0893 — admin_report: the seven heavy admin reports through one door, each
-- answer kept ten minutes. 0892's header says why, and what comes back.
-- No dynamic SQL: only these seven can run.

begin;

create or replace function public.admin_report(
  p_fn text,
  p_args jsonb default '{}'::jsonb,
  p_fresh boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  a jsonb := coalesce(p_args, '{}'::jsonb);
  v jsonb;
  v_at timestamptz;
  v_since date; v_h int; v_ex boolean; v_ver boolean; v_merge int; v_weeks int;
begin
  perform public._require_admin();

  if p_fn is null or p_fn not in (
       'admin_return_fixed_horizon', 'admin_built_return', 'admin_second_sitting',
       'admin_return_by_mode', 'admin_activity_heatmap', 'admin_sharing_overview',
       'admin_tests_read')
     or jsonb_typeof(a) <> 'object' or length(a::text) > 2000 then
    raise exception 'admin_report: bad report or arguments' using errcode = '22023';
  end if;

  if p_fresh is not true then
    select c.result, c.computed_at into v, v_at
    from public.admin_report_cache c
     where c.fn = p_fn and c.args = a and c.computed_at > now() - interval '10 minutes';
    if found then
      -- read_at only holds off the purge; one write an hour is enough.
      update public.admin_report_cache set read_at = now()
       where fn = p_fn and args = a and read_at < now() - interval '1 hour';
      return jsonb_build_object('data', v, 'at', v_at);
    end if;
  end if;

  -- Arguments the reports share; p_since has a second default below.
  v_since := case when a ? 'p_since' then (a->>'p_since')::date else '2026-08-17' end;
  v_h := case when a ? 'p_horizon_days' then (a->>'p_horizon_days')::int else 7 end;
  v_ex := case when a ? 'p_exclude_internal' then (a->>'p_exclude_internal')::boolean else true end;
  v_ver := case when a ? 'p_verified_only' then (a->>'p_verified_only')::boolean else true end;
  v_merge := case when a ? 'p_merge_hours' then (a->>'p_merge_hours')::int else 2 end;
  v_weeks := case when a ? 'p_weeks' then (a->>'p_weeks')::int else 12 end;

  -- Table reports: an array of row objects in the report's order.
  if p_fn = 'admin_return_fixed_horizon' then
    select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by ordinality), '[]') into v
    from public.admin_return_fixed_horizon(
      case when a ? 'p_since' then v_since else '2026-06-16' end,
      v_h, v_ex, v_ver, v_merge, v_weeks) with ordinality r;
  elsif p_fn = 'admin_built_return' then
    select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by ordinality), '[]') into v
    from public.admin_built_return(v_since, v_h, v_ex, v_ver, v_merge, v_weeks) with ordinality r;
  elsif p_fn = 'admin_second_sitting' then
    select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by ordinality), '[]') into v
    from public.admin_second_sitting(v_since, v_ex, v_ver, v_merge, v_weeks,
      case when a ? 'p_gap_minutes' then (a->>'p_gap_minutes')::int else 30 end) with ordinality r;
  elsif p_fn = 'admin_return_by_mode' then
    select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by ordinality), '[]') into v
    from public.admin_return_by_mode(v_since, v_h,
      case when a ? 'p_measure' then a->>'p_measure' else 'any' end,
      v_ex, v_ver, v_merge) with ordinality r;
  elsif p_fn = 'admin_activity_heatmap' then
    select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by ordinality), '[]') into v
    from public.admin_activity_heatmap(
      case when a ? 'p_days' then (a->>'p_days')::int else 30 end,
      case when a ? 'p_tz' then a->>'p_tz' else 'UTC' end,
      v_ex) with ordinality r;
  elsif p_fn = 'admin_sharing_overview' then
    v := public.admin_sharing_overview(
      case when a ? 'p_days' then (a->>'p_days')::int else 90 end, v_ex);
  else
    v := public.admin_tests_read(
      case when a ? 'p_now' then (a->>'p_now')::timestamptz else now() end);
  end if;

  v_at := now();
  -- Stored, and old rows purged, by _admin_report_keep (0892).
  perform public._admin_report_keep(p_fn, a, v, v_at);

  return jsonb_build_object('data', v, 'at', v_at);
end
$fn$;

revoke execute on function public.admin_report(text, jsonb, boolean) from public, anon;
grant execute on function public.admin_report(text, jsonb, boolean) to authenticated, service_role;

-- Proof (0311 habit); the table's is in 0892.
do $proof$
declare
  f constant text := 'public.admin_report(text, jsonb, boolean)';
begin
  if has_function_privilege('anon', f, 'execute') then
    raise exception '0893: anon can run admin_report';
  end if;
  if not has_function_privilege('authenticated', f, 'execute') then
    raise exception '0893: authenticated cannot run admin_report';
  end if;
end $proof$;

commit;
