-- 0174_lifecycle_email_bandit.sql
-- Two enhancements to the lifecycle email program (0173):
--   A. Per-user send-time optimization — deliver each nudge during the hour the
--      user is typically active (modal active hour from analytics_events).
--   B. Copy A/B with an auto-optimizing bandit — 2 variants per email type, a
--      weighted draw on send, and a nightly optimizer that shifts weight toward
--      the better-converting copy. Reuses the bandit *approach* of the onboarding
--      experiment engine (config-driven weights in app_config, warmup→running),
--      but with an email-correct reward read from lifecycle_email_log relative to
--      sent_at. The onboarding experiment_optimize() is left untouched (separate
--      app_config key, so it never sees these).

-- ════════════════════════════════════════════════════════════════════════════
-- A. SEND-TIME OPTIMIZATION
-- ════════════════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists preferred_send_hour smallint;

-- Modal active hour (UTC, 0-23) per user from the last 90 days of activity.
-- Refreshed nightly. Users with no events stay NULL → eligibility falls back to
-- their signup hour (see the RPCs below).
create or replace function public.lifecycle_refresh_send_hours()
returns void language sql security definer set search_path = public as $$
  with hourly as (
    select user_id, extract(hour from occurred_at)::int as hr, count(*) as n
    from public.analytics_events
    where user_id is not null and occurred_at > now() - interval '90 days'
    group by user_id, extract(hour from occurred_at)::int
  ),
  best as (
    select distinct on (user_id) user_id, hr
    from hourly
    order by user_id, n desc, hr
  )
  update public.profiles p
     set preferred_send_hour = b.hr
    from best b
   where b.user_id = p.user_id
     and p.preferred_send_hour is distinct from b.hr;
$$;
revoke all on function public.lifecycle_refresh_send_hours() from public;
grant execute on function public.lifecycle_refresh_send_hours() to service_role;

-- prime it once now
select public.lifecycle_refresh_send_hours();

-- ════════════════════════════════════════════════════════════════════════════
-- B. COPY A/B BANDIT
-- ════════════════════════════════════════════════════════════════════════════
alter table public.lifecycle_email_log add column if not exists variant text;

-- Bandit config — one object per email type. Separate app_config key from the
-- onboarding 'experiments' row, so experiment_optimize() never touches it.
insert into public.app_config (key, value)
values ('lifecycle_email_experiments', jsonb_build_object(
  'activate_nudge_1', jsonb_build_object(
    'enabled', true, 'arms', jsonb_build_array('A','B'),
    'weights', jsonb_build_object('A',50,'B',50),
    'reward_window_days', 7, 'min_trials_per_arm', 30, 'floor', 5, 'phase', 'warmup',
    'stats', '{}'::jsonb),
  'activate_nudge_2', jsonb_build_object(
    'enabled', true, 'arms', jsonb_build_array('A','B'),
    'weights', jsonb_build_object('A',50,'B',50),
    'reward_window_days', 7, 'min_trials_per_arm', 30, 'floor', 5, 'phase', 'warmup',
    'stats', '{}'::jsonb),
  'reengage_1', jsonb_build_object(
    'enabled', true, 'arms', jsonb_build_array('A','B'),
    'weights', jsonb_build_object('A',50,'B',50),
    'reward_window_days', 14, 'min_trials_per_arm', 30, 'floor', 5, 'phase', 'warmup',
    'stats', '{}'::jsonb)
))
on conflict (key) do nothing;

-- Read the whole bandit config (the cron draws variants from these weights).
create or replace function public.lifecycle_email_variant_weights()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_config where key = 'lifecycle_email_experiments'), '{}'::jsonb);
$$;
revoke all on function public.lifecycle_email_variant_weights() from public;
grant execute on function public.lifecycle_email_variant_weights() to service_role;

-- Nightly optimizer. For each email type + variant: among 'sent' rows whose
-- reward window has fully elapsed, mean conversion = activation (activate_*) or
-- return (reengage_1) within the window AFTER sent_at. Hold even weights until
-- every arm clears min_trials (warmup); then weight ∝ mean with an exploration
-- floor so no arm starves. Greedy-with-floor bandit.
create or replace function public.lifecycle_email_optimize()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb; etype text; econf jsonb; arms text[]; arm text;
  reward_window int; min_trials int; v_floor numeric;
  n_arm int; r_arm int; mean numeric;
  means jsonb; stats jsonb; sum_means numeric; warmup boolean; nfloors int;
  new_weights jsonb; w int; acc int; result jsonb := '{}'::jsonb;
begin
  select value into cfg from public.app_config where key = 'lifecycle_email_experiments';
  if cfg is null then return '{}'::jsonb; end if;

  for etype in select jsonb_object_keys(cfg) loop
    econf := cfg->etype;
    if coalesce((econf->>'enabled')::boolean, false) = false then continue; end if;
    arms := array(select jsonb_array_elements_text(econf->'arms'));
    reward_window := coalesce((econf->>'reward_window_days')::int, 7);
    min_trials := coalesce((econf->>'min_trials_per_arm')::int, 30);
    v_floor := coalesce((econf->>'floor')::numeric, 5);
    means := '{}'::jsonb; stats := '{}'::jsonb; sum_means := 0; warmup := false;

    foreach arm in array arms loop
      select count(*)::int, count(*) filter (where converted)::int
        into n_arm, r_arm
      from (
        select
          case when etype like 'activate%' then
            (p.first_populated_board_at is not null
             and p.first_populated_board_at >  l.sent_at
             and p.first_populated_board_at <= l.sent_at + make_interval(days => reward_window))
          else
            exists (select 1 from public.user_active_day d
                    where d.user_id = l.user_id
                      and d.day >  l.sent_at::date
                      and d.day <= (l.sent_at + make_interval(days => reward_window))::date)
          end as converted
        from public.lifecycle_email_log l
        join public.profiles p on p.user_id = l.user_id
        where l.email_type = etype and l.variant = arm and l.status = 'sent'
          and l.sent_at <= now() - make_interval(days => reward_window)
      ) s;

      if n_arm < min_trials then warmup := true; end if;
      mean := case when n_arm > 0 then r_arm::numeric / n_arm else 0 end;
      means := means || jsonb_build_object(arm, mean);
      sum_means := sum_means + mean;
      stats := stats || jsonb_build_object(arm, jsonb_build_object('n', n_arm, 'reward', r_arm, 'mean', round(mean, 4)));
    end loop;

    new_weights := '{}'::jsonb;
    if warmup or sum_means <= 0 then
      foreach arm in array arms loop
        new_weights := new_weights || jsonb_build_object(arm, (100 / array_length(arms,1)));
      end loop;
      econf := jsonb_set(econf, '{phase}', to_jsonb('warmup'::text));
    else
      nfloors := array_length(arms,1);
      acc := 0;
      foreach arm in array arms loop
        w := round( v_floor + ((means->>arm)::numeric / sum_means) * (100 - v_floor*nfloors) )::int;
        new_weights := new_weights || jsonb_build_object(arm, w);
        acc := acc + w;
      end loop;
      -- absorb rounding drift into the first arm so weights sum to 100
      new_weights := jsonb_set(new_weights, array[arms[1]], to_jsonb(((new_weights->>arms[1])::int + (100 - acc))));
      econf := jsonb_set(econf, '{phase}', to_jsonb('running'::text));
    end if;

    econf := jsonb_set(econf, '{weights}', new_weights);
    econf := jsonb_set(econf, '{stats}', stats);
    cfg := jsonb_set(cfg, array[etype], econf);
    result := result || jsonb_build_object(etype, jsonb_build_object('weights', new_weights, 'phase', econf->>'phase', 'stats', stats));
  end loop;

  update public.app_config set value = cfg, updated_at = now() where key = 'lifecycle_email_experiments';
  return result;
end $$;
revoke all on function public.lifecycle_email_optimize() from public;
grant execute on function public.lifecycle_email_optimize() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- C. Claim RPC gains a variant; eligibility RPCs gain a preferred-hour filter.
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.lifecycle_claim_send(uuid, text, text);
create or replace function public.lifecycle_claim_send(
  p_user_id uuid, p_email_type text, p_recipient_email text, p_variant text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.lifecycle_email_log (user_id, email_type, recipient_email, status, variant)
  select p_user_id, p_email_type, p_recipient_email, 'claimed', p_variant
  where public._email_pref_enabled(p_user_id, 'email_lifecycle')
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.lifecycle_claim_send(uuid, text, text, text) from public;
grant execute on function public.lifecycle_claim_send(uuid, text, text, text) to service_role;

-- helper: a user's effective send hour = computed modal hour, else signup hour.
-- (inlined into each RPC below; kept here as documentation of the fallback.)

drop function if exists public.lifecycle_due_activate_nudge_1(int,int,int,boolean);
create or replace function public.lifecycle_due_activate_nudge_1(
  p_min_hours int default 24, p_max_hours int default 120,
  p_quiet_hours int default 24, p_exclude_internal boolean default true,
  p_hour int default null)
returns table(user_id uuid, email text, display_name text, workspace_id uuid, unsub_token text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text,
         coalesce(nullif(p.display_name,''), initcap(split_part(u.email,'@',1))),
         ws.workspace_id, t.token
  from auth.users u
  join public.profiles p on p.user_id = u.id
  join public.email_unsub_tokens t on t.user_id = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join lateral (
    select w.id as workspace_id from public.workspaces w
    where w.created_by = u.id order by w.created_at limit 1
  ) ws on true
  where u.email_confirmed_at is not null and u.email is not null
    and p.tier = 'demo'
    and coalesce(p.activated_access_at, u.created_at) <= now() - make_interval(hours => p_min_hours)
    and coalesce(p.activated_access_at, u.created_at) >  now() - make_interval(hours => p_max_hours)
    and p.first_populated_board_at is null
    and (pr.last_seen_at is null or pr.last_seen_at < now() - make_interval(hours => p_quiet_hours))
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and (p_hour is null or coalesce(p.preferred_send_hour,
          extract(hour from coalesce(p.activated_access_at, u.created_at))::int) = p_hour)
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'activate_nudge_1');
$$;
revoke all on function public.lifecycle_due_activate_nudge_1(int,int,int,boolean,int) from public;
grant execute on function public.lifecycle_due_activate_nudge_1(int,int,int,boolean,int) to service_role;

drop function if exists public.lifecycle_due_activate_nudge_2(int,int,int,boolean);
create or replace function public.lifecycle_due_activate_nudge_2(
  p_min_hours int default 120, p_max_hours int default 336,
  p_quiet_hours int default 24, p_exclude_internal boolean default true,
  p_hour int default null)
returns table(user_id uuid, email text, display_name text, workspace_id uuid, unsub_token text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text,
         coalesce(nullif(p.display_name,''), initcap(split_part(u.email,'@',1))),
         ws.workspace_id, t.token
  from auth.users u
  join public.profiles p on p.user_id = u.id
  join public.email_unsub_tokens t on t.user_id = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join lateral (
    select w.id as workspace_id from public.workspaces w
    where w.created_by = u.id order by w.created_at limit 1
  ) ws on true
  where u.email_confirmed_at is not null and u.email is not null
    and p.tier = 'demo'
    and coalesce(p.activated_access_at, u.created_at) <= now() - make_interval(hours => p_min_hours)
    and coalesce(p.activated_access_at, u.created_at) >  now() - make_interval(hours => p_max_hours)
    and p.first_populated_board_at is null
    and (pr.last_seen_at is null or pr.last_seen_at < now() - make_interval(hours => p_quiet_hours))
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and (p_hour is null or coalesce(p.preferred_send_hour,
          extract(hour from coalesce(p.activated_access_at, u.created_at))::int) = p_hour)
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'activate_nudge_2');
$$;
revoke all on function public.lifecycle_due_activate_nudge_2(int,int,int,boolean,int) from public;
grant execute on function public.lifecycle_due_activate_nudge_2(int,int,int,boolean,int) to service_role;

drop function if exists public.lifecycle_due_reengage_1(int,int,boolean);
create or replace function public.lifecycle_due_reengage_1(
  p_dormant_days int default 21, p_cooldown_days int default 45,
  p_exclude_internal boolean default true, p_hour int default null)
returns table(user_id uuid, email text, display_name text,
              workspace_id uuid, board_id uuid, board_name text, unsub_token text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text,
         coalesce(nullif(p.display_name,''), initcap(split_part(u.email,'@',1))),
         bd.workspace_id, bd.board_id, bd.board_name, t.token
  from auth.users u
  join public.profiles p on p.user_id = u.id
  join public.email_unsub_tokens t on t.user_id = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join lateral (
    select b.id as board_id, b.workspace_id, b.name as board_name
    from public.boards b
    where b.created_by = u.id
      and (select count(*) from public.card_index ci
           where ci.board_id = b.id and ci.card_id not like 'onb-%') >= 3
    order by b.updated_at desc limit 1
  ) bd on true
  where u.email_confirmed_at is not null and u.email is not null
    and p.tier in ('demo','paid')
    and p.first_populated_board_at is not null
    and (pr.last_seen_at is null or pr.last_seen_at < now() - make_interval(days => p_dormant_days))
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and (p_hour is null or coalesce(p.preferred_send_hour,
          extract(hour from coalesce(p.activated_access_at, u.created_at))::int) = p_hour)
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'reengage_1'
                      and l.sent_at > now() - make_interval(days => p_cooldown_days));
$$;
revoke all on function public.lifecycle_due_reengage_1(int,int,boolean,int) from public;
grant execute on function public.lifecycle_due_reengage_1(int,int,boolean,int) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- D. Admin stats — per email type AND variant (sent + converted in window).
-- ════════════════════════════════════════════════════════════════════════════
-- 0173 created this with a different return shape; return type changes need DROP.
drop function if exists public.admin_lifecycle_email_stats(int);
create or replace function public.admin_lifecycle_email_stats(p_window_days int default 14)
returns table(email_type text, variant text, sent bigint, activated_or_returned bigint)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._require_admin();
  return query
  select l.email_type,
         coalesce(l.variant, '(none)'),
         count(*) filter (where l.status = 'sent'),
         count(*) filter (where l.status = 'sent' and (
           (l.email_type like 'activate%' and p.first_populated_board_at > l.sent_at
              and p.first_populated_board_at <= l.sent_at + make_interval(days => p_window_days))
           or
           (l.email_type = 'reengage_1' and pr.last_seen_at > l.sent_at
              and pr.last_seen_at <= l.sent_at + make_interval(days => p_window_days))))
  from public.lifecycle_email_log l
  join public.profiles p on p.user_id = l.user_id
  left join public.user_presence pr on pr.user_id = l.user_id
  group by l.email_type, coalesce(l.variant, '(none)');
end $$;
revoke all on function public.admin_lifecycle_email_stats(int) from public;
grant execute on function public.admin_lifecycle_email_stats(int) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- E. Nightly maintenance crons (pure SQL, no HTTP — like experiment_optimize).
-- ════════════════════════════════════════════════════════════════════════════
create extension if not exists pg_cron;

do $$ declare v_jobid bigint; begin
  for v_jobid in select jobid from cron.job
    where jobname in ('lifecycle-refresh-send-hours','lifecycle-email-optimize-nightly') loop
    perform cron.unschedule(v_jobid);
  end loop;
end$$;

select cron.schedule('lifecycle-refresh-send-hours',   '40 4 * * *', $$ select public.lifecycle_refresh_send_hours(); $$);
select cron.schedule('lifecycle-email-optimize-nightly','45 4 * * *', $$ select public.lifecycle_email_optimize(); $$);
