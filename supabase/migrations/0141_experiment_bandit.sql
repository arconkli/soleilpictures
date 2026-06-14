-- 0141_experiment_bandit.sql
--
-- Turns the static A/B harness (0140) into a SELF-OPTIMIZING multi-armed bandit.
-- Weights become live state in app_config, recomputed nightly by a pure-SQL
-- pg_cron optimizer from realized rewards; the client draws from those weights
-- and stamps once (set_experiment_arm, 0140, absent-only → first-touch wins).
--
-- REWARD (per the product goal): we do NOT optimize a shallow first-card proxy —
-- a variant that wins more first-cards but those users churn/never pay would be a
-- FALSE win. The reward is a COMPOSITE, PAYMENT-WEIGHTED, EVOLVING score per user:
--   normalized = ( w_card·[first_card] + w_pop·[populated] + w_ret·[returned]
--                + w_paid·[paid] ) / (w_card+w_pop+w_ret+w_paid)   ∈ [0,1]
-- Defaults {1,2,3,14} (max 20) → a payer is worth ~14–20× a bare activator.
-- EVOLVING = no upper time bound: recomputed nightly, so a user who pays on day 30
-- retroactively rewards their arm. At current volume (0 payers/90d) the paid term
-- is dormant and the bandit learns from the activation+retention proxies; the
-- moment payments land they dominate, with zero code change.
--
-- get_my_tier is deliberately NOT touched. Conventions mirror 0120/0140.

------------------------------------------------------------------
-- 1. Config-of-record: one app_config row, key 'experiments'.
--    The optimizer only ever writes weights/stats/phase/updated_at; operator
--    knobs (enabled/arms/floor/gamma/reward_weights/...) are never overwritten,
--    so "add an arm later" is a pure config edit.
------------------------------------------------------------------
insert into public.app_config (key, value)
values ('experiments', jsonb_build_object(
  'first_card_cta', jsonb_build_object(
    'enabled', true,
    'arms', jsonb_build_array('A','B'),
    'weights', jsonb_build_object('A',50,'B',50),
    'default_weights', jsonb_build_object('A',50,'B',50),
    'reward_window_days', 7,            -- eligibility gate (p90 time-to-first-card = 6.2d)
    'min_trials_per_arm', 20,           -- warmup K (= MIN_RATE_FLAG)
    'floor', 0.10,                      -- exploration floor per arm
    'max_shift', 0.15,                  -- max per-night fraction change
    'gamma', 3,                         -- exploit sharpness (prop ∝ score^gamma)
    'c', 1.0,                           -- UCB uncertainty bonus (mean + c·std)
    'reward_weights', jsonb_build_object('first_card',1,'populated',2,'returned',3,'paid',14),
    'phase', 'warmup',
    'updated_at', to_jsonb(now()),
    'stats', jsonb_build_object(
      'A', jsonb_build_object('n',0,'reward_sum',0,'mean',null),
      'B', jsonb_build_object('n',0,'reward_sum',0,'mean',null))
  )
))
on conflict (key) do nothing;

------------------------------------------------------------------
-- 2. The optimizer.
------------------------------------------------------------------
create or replace function public.experiment_optimize()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_cfg jsonb; v_out jsonb; v_key text; v_exp jsonb;
  v_arms jsonb; v_arm text;
  v_rwd int; v_K int; v_floor numeric; v_shift numeric; v_gamma numeric; v_c numeric;
  v_rw jsonb; v_wmax numeric;
  v_n int; v_reward numeric; v_mean numeric; v_std numeric;
  v_stats jsonb; v_scores jsonb; v_warm boolean;
  v_raw numeric; v_sumraw numeric; v_neww jsonb;
  v_frac numeric; v_sumnew numeric; v_curw jsonb; v_curtot numeric; v_curfrac numeric; v_delta numeric;
  v_intw jsonb;
begin
  select value into v_cfg from public.app_config where key = 'experiments';
  if v_cfg is null then return '{}'::jsonb; end if;
  v_out := v_cfg;

  for v_key, v_exp in select key, value from jsonb_each(v_cfg) loop
    if coalesce((v_exp->>'enabled')::boolean, false) is not true then continue; end if;
    v_arms  := v_exp->'arms';
    v_rwd   := coalesce((v_exp->>'reward_window_days')::int, 7);
    v_K     := coalesce((v_exp->>'min_trials_per_arm')::int, 20);
    v_floor := coalesce((v_exp->>'floor')::numeric, 0.10);
    v_shift := coalesce((v_exp->>'max_shift')::numeric, 0.15);
    v_gamma := coalesce((v_exp->>'gamma')::numeric, 3);
    v_c     := coalesce((v_exp->>'c')::numeric, 1.0);
    v_rw    := coalesce(v_exp->'reward_weights', '{"first_card":1,"populated":2,"returned":3,"paid":14}'::jsonb);
    v_wmax  := coalesce((v_rw->>'first_card')::numeric,1) + coalesce((v_rw->>'populated')::numeric,2)
             + coalesce((v_rw->>'returned')::numeric,3)  + coalesce((v_rw->>'paid')::numeric,14);
    if v_wmax <= 0 then v_wmax := 1; end if;

    -- Measure n + composite reward sum per arm (over ELIGIBLE non-internal enrollees).
    v_stats := '{}'::jsonb; v_scores := '{}'::jsonb; v_warm := false;
    for v_arm in select jsonb_array_elements_text(v_arms) loop
      select count(*),
             coalesce(sum(
               ( coalesce((v_rw->>'first_card')::numeric,1) * (case when pr.first_card_at is not null then 1 else 0 end)
               + coalesce((v_rw->>'populated')::numeric,2)  * (case when pr.first_populated_board_at is not null then 1 else 0 end)
               + coalesce((v_rw->>'returned')::numeric,3)   * (case when exists(
                     select 1 from public.user_active_day a where a.user_id = pr.user_id and a.day > u.created_at::date) then 1 else 0 end)
               + coalesce((v_rw->>'paid')::numeric,14)      * (case when pr.first_paid_at is not null then 1 else 0 end)
               ) / v_wmax
             ), 0)
        into v_n, v_reward
        from public.profiles pr
        join auth.users u on u.id = pr.user_id
       where u.email_confirmed_at is not null
         and pr.settings->'experiments'->>v_key = v_arm
         and u.created_at <= now() - (v_rwd || ' days')::interval
         and u.id not in (select user_id from public._internal_user_ids());

      -- Beta(1+reward, 1+(n-reward)) relaxation for a bounded [0,1] reward.
      v_mean := (1 + v_reward) / (2 + v_n);
      v_std  := sqrt( ((1 + v_reward) * (1 + v_n - v_reward))
                      / ( power((2 + v_n)::numeric, 2) * (3 + v_n) ) );
      v_stats  := v_stats  || jsonb_build_object(v_arm, jsonb_build_object(
                    'n', v_n, 'reward_sum', round(v_reward,3), 'mean', round(v_mean,4)));
      v_scores := v_scores || jsonb_build_object(v_arm, v_mean + v_c * v_std);   -- UCB score
      if v_n < v_K then v_warm := true; end if;
    end loop;

    -- Decide weights.
    if v_warm then
      v_intw := v_exp->'default_weights';                 -- warmup: hold uniform/registry
    else
      -- prop ∝ score^gamma
      v_sumraw := 0; v_neww := '{}'::jsonb;
      for v_arm in select jsonb_array_elements_text(v_arms) loop
        v_raw := power( (v_scores->>v_arm)::numeric, v_gamma );
        v_neww := v_neww || jsonb_build_object(v_arm, v_raw);
        v_sumraw := v_sumraw + v_raw;
      end loop;
      for v_arm in select jsonb_array_elements_text(v_arms) loop
        v_neww := jsonb_set(v_neww, array[v_arm], to_jsonb( (v_neww->>v_arm)::numeric / nullif(v_sumraw,0) ));
      end loop;
      -- exploration floor + renormalize
      v_sumnew := 0;
      for v_arm in select jsonb_array_elements_text(v_arms) loop
        v_frac := greatest((v_neww->>v_arm)::numeric, v_floor);
        v_neww := jsonb_set(v_neww, array[v_arm], to_jsonb(v_frac)); v_sumnew := v_sumnew + v_frac;
      end loop;
      for v_arm in select jsonb_array_elements_text(v_arms) loop
        v_neww := jsonb_set(v_neww, array[v_arm], to_jsonb( (v_neww->>v_arm)::numeric / v_sumnew ));
      end loop;
      -- max per-night shift vs current weights, then renormalize
      v_curw := v_exp->'weights'; v_curtot := 0;
      for v_arm in select jsonb_array_elements_text(v_arms) loop
        v_curtot := v_curtot + coalesce((v_curw->>v_arm)::numeric, 0);
      end loop;
      if v_curtot > 0 then
        v_sumnew := 0;
        for v_arm in select jsonb_array_elements_text(v_arms) loop
          v_curfrac := coalesce((v_curw->>v_arm)::numeric,0) / v_curtot;
          v_frac := (v_neww->>v_arm)::numeric;
          v_delta := v_frac - v_curfrac;
          if v_delta >  v_shift then v_frac := v_curfrac + v_shift; end if;
          if v_delta < -v_shift then v_frac := v_curfrac - v_shift; end if;
          v_neww := jsonb_set(v_neww, array[v_arm], to_jsonb(v_frac)); v_sumnew := v_sumnew + v_frac;
        end loop;
        for v_arm in select jsonb_array_elements_text(v_arms) loop
          v_neww := jsonb_set(v_neww, array[v_arm], to_jsonb( (v_neww->>v_arm)::numeric / nullif(v_sumnew,0) ));
        end loop;
      end if;
      -- to integer weights (~100)
      v_intw := '{}'::jsonb;
      for v_arm in select jsonb_array_elements_text(v_arms) loop
        v_intw := v_intw || jsonb_build_object(v_arm, round((v_neww->>v_arm)::numeric * 100));
      end loop;
    end if;

    v_out := jsonb_set(v_out, array[v_key,'weights'],    v_intw);
    v_out := jsonb_set(v_out, array[v_key,'stats'],      v_stats);
    v_out := jsonb_set(v_out, array[v_key,'phase'],      to_jsonb(case when v_warm then 'warmup' else 'active' end));
    v_out := jsonb_set(v_out, array[v_key,'updated_at'], to_jsonb(now()));
  end loop;

  update public.app_config set value = v_out, updated_at = now() where key = 'experiments';
  return v_out;
end $function$;
revoke all on function public.experiment_optimize() from public;
grant execute on function public.experiment_optimize() to service_role;

-- Nightly, after the last existing 3am job (:40). Guarded unschedule + schedule.
do $$ begin perform cron.unschedule('experiment_optimize_nightly'); exception when others then null; end $$;
select cron.schedule('experiment_optimize_nightly', '50 3 * * *',
  $cron$ select public.experiment_optimize(); $cron$);

------------------------------------------------------------------
-- 3. Client read RPCs.
------------------------------------------------------------------
-- Live weights for the seed-time draw — enabled experiments only, projection
-- without operator knobs/stats. anon+authenticated (seed may run early).
create or replace function public.get_experiment_config()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(
    (select jsonb_object_agg(k, jsonb_build_object('enabled', v->'enabled', 'arms', v->'arms', 'weights', v->'weights'))
       from jsonb_each((select value from public.app_config where key = 'experiments')) as t(k, v)
      where coalesce((v->>'enabled')::boolean, false)),
    '{}'::jsonb);
$function$;
revoke all on function public.get_experiment_config() from public;
grant execute on function public.get_experiment_config() to anon, authenticated;

-- The caller's own stamped arms — cross-browser cache backfill.
create or replace function public.get_my_experiments()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select settings->'experiments' from public.profiles where user_id = auth.uid()), '{}'::jsonb);
$function$;
revoke all on function public.get_my_experiments() from public;
grant execute on function public.get_my_experiments() to authenticated;

------------------------------------------------------------------
-- 4. Admin readout: per-arm composite outcomes (the bandit's target).
------------------------------------------------------------------
create or replace function public.admin_activation_by_experiment(
  p_key text, p_days integer default 30, p_exclude_internal boolean default true
)
returns table(arm text, enrolled integer,
              first_card integer, first_card_pct numeric,
              populated integer, populated_pct numeric,
              returned integer, returned_pct numeric,
              paid integer, paid_pct numeric,
              mean_reward numeric)
language plpgsql stable security definer set search_path to 'public' as $function$
#variable_conflict use_column
declare v_rw jsonb; v_wmax numeric;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  select coalesce(value->p_key->'reward_weights', '{"first_card":1,"populated":2,"returned":3,"paid":14}'::jsonb)
    into v_rw from public.app_config where key = 'experiments';
  v_rw := coalesce(v_rw, '{"first_card":1,"populated":2,"returned":3,"paid":14}'::jsonb);
  v_wmax := coalesce((v_rw->>'first_card')::numeric,1) + coalesce((v_rw->>'populated')::numeric,2)
          + coalesce((v_rw->>'returned')::numeric,3)  + coalesce((v_rw->>'paid')::numeric,14);
  if v_wmax <= 0 then v_wmax := 1; end if;
  return query
  with p as (
    select pr.user_id,
           pr.first_card_at, pr.first_populated_board_at, pr.first_paid_at,
           pr.settings->'experiments'->>p_key as arm,
           exists(select 1 from public.user_active_day a where a.user_id = pr.user_id and a.day > u.created_at::date) as did_return
      from public.profiles pr
      join auth.users u on u.id = pr.user_id
     where u.email_confirmed_at is not null
       and u.created_at >= now() - (p_days || ' days')::interval
       and pr.settings->'experiments'->>p_key is not null
       and (not p_exclude_internal or u.id not in (select user_id from public._internal_user_ids()))
  )
  select p.arm,
         count(*)::int,
         count(*) filter (where p.first_card_at is not null)::int,
         round(count(*) filter (where p.first_card_at is not null)::numeric / nullif(count(*),0), 4),
         count(*) filter (where p.first_populated_board_at is not null)::int,
         round(count(*) filter (where p.first_populated_board_at is not null)::numeric / nullif(count(*),0), 4),
         count(*) filter (where p.did_return)::int,
         round(count(*) filter (where p.did_return)::numeric / nullif(count(*),0), 4),
         count(*) filter (where p.first_paid_at is not null)::int,
         round(count(*) filter (where p.first_paid_at is not null)::numeric / nullif(count(*),0), 4),
         round(avg(
           ( coalesce((v_rw->>'first_card')::numeric,1) * (case when p.first_card_at is not null then 1 else 0 end)
           + coalesce((v_rw->>'populated')::numeric,2)  * (case when p.first_populated_board_at is not null then 1 else 0 end)
           + coalesce((v_rw->>'returned')::numeric,3)   * (case when p.did_return then 1 else 0 end)
           + coalesce((v_rw->>'paid')::numeric,14)      * (case when p.first_paid_at is not null then 1 else 0 end)
           ) / v_wmax), 4)
    from p group by p.arm order by p.arm;
end $function$;
revoke all on function public.admin_activation_by_experiment(text, integer, boolean) from public;
grant execute on function public.admin_activation_by_experiment(text, integer, boolean) to authenticated;

-- Live bandit state (weights/stats/phase) for the admin strip.
create or replace function public.admin_get_experiment_state()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  perform public._require_admin();
  return coalesce((select value from public.app_config where key = 'experiments'), '{}'::jsonb);
end $function$;
revoke all on function public.admin_get_experiment_state() from public;
grant execute on function public.admin_get_experiment_state() to authenticated;
