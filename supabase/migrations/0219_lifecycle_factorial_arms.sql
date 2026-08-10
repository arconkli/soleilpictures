-- 0219_lifecycle_factorial_arms.sql
--
-- Widen lifecycle copy testing from 2 flat arms to a subject x body factorial
-- on the four high-volume types, and give the optimizer an objective it can
-- actually resolve at this volume.
--
-- WHY. Five weeks of A/B produced 16 clicks across 522 delivered emails. No
-- click-scored test will ever separate two arms on that, let alone five. But
-- the same period produced 210 opens — and hiding in them was a settled result
-- the bandit could not see:
--
--   nudge_dormant_early, 167 delivered
--     A "your workspace is still here"     105 delivered, 54 opened  51.4%
--     B "still here whenever you want it"   62 delivered, 11 opened  17.7%
--     z = 4.9, p < 1e-6; holds in all three weeks independently and within
--     gmail.com alone, so it is not a timing or inbox-mix artifact.
--
-- The bandit scored these same arms 0.059 vs 0.031 (6 rewards vs 2) — noise —
-- and kept rotating them 50/50 for five weeks while one of them lost two thirds
-- of its audience at the inbox line. Arm B is deleted in this migration.
--
-- THE DESIGN. Each send now draws a subject arm and a body arm INDEPENDENTLY,
-- logged as "<subject>.<body>" (e.g. "s3.b2"). Each factor is scored
-- MARGINALLY, pooling over the other:
--
--   subject arm -> objective 'open',            denominator = delivered
--   body arm    -> objective 'click_or_return', denominator = OPENED
--
-- Two consequences worth being explicit about:
--   * 5 subjects x 3 bodies costs the sample of 5 arms, not 15. Per subject
--     arm n ~ 34 on nudge_dormant_early, enough to catch a 2x open gap; per
--     body arm n ~ 57 sends but only ~20 opens, which stays directional.
--   * The body denominator is opens, not delivered, so a body is judged only by
--     people who actually saw it. This is safe rather than a collider because
--     opens depend only on the subject factor — which is exactly why the
--     preheader is grouped with the SUBJECT arm in templates.ts, not the body.
--
-- Mode stays 'rotate' everywhere. At ~14 sends/day the deliverable is a clean
-- marginal estimate per arm, not an auto-tuned weight; acting on a result means
-- deleting the loser by hand, as this migration does for nudge_dormant_early B.
--
-- Types NOT converted: reengage_1 (22 lifetime sends), board_waiting (26) and
-- whats_new (0). They keep the flat A/B path, which the optimizer still honours.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Split the composite variant into its factors.
--
--    Generated columns rather than new parameters on lifecycle_claim_send:
--    adding a defaulted param to that function would make every existing call
--    ambiguous and force a drop/recreate in lockstep with an already-deployed
--    cron (the 0211 gotcha, and 0209's before it). The composite string stays
--    the wire format; these are derived and always consistent with it.
--
--    Legacy rows: variant 'A' yields subject_arm 'A', body_arm NULL. Those
--    values match no current arm, so they drop out of the new stats unless a
--    factor explicitly claims them via legacy_arms below.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.lifecycle_email_log
  add column if not exists subject_arm text
    generated always as (nullif(split_part(variant, '.', 1), '')) stored,
  add column if not exists body_arm text
    generated always as (nullif(split_part(variant, '.', 2), '')) stored;

create index if not exists lifecycle_email_log_subject_arm_idx
  on public.lifecycle_email_log (email_type, subject_arm) where subject_arm is not null;
create index if not exists lifecycle_email_log_body_arm_idx
  on public.lifecycle_email_log (email_type, body_arm) where body_arm is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Factor-aware optimizer.
--
--    Types carrying a 'factors' object are scored per factor; everything else
--    keeps the flat path from 0211 unchanged.
--
--    Note the activate_* types lose their first_populated_board_at reward here.
--    That outcome is the right north star but the wrong copy signal: 3 rewards
--    across 120 mature sends, and conditioning on opens makes it sparser still.
--    Activation remains measured by the admin funnel RPCs; copy is scored on
--    what copy can actually move at this volume.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.lifecycle_email_optimize()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb; etype text; econf jsonb; result jsonb := '{}'::jsonb;
  fname text; fconf jsonb; factors_out jsonb;
  arms text[]; arm text; v_legacy text[];
  v_obj text; v_window int; v_min int; v_floor numeric; v_mode text;
  reward_window int; min_trials int;
  n_arm int; r_arm int; mean numeric;
  means jsonb; stats jsonb; sum_means numeric; warmup boolean; nfloors int;
  new_weights jsonb; w int; acc int;
begin
  select value into cfg from public.app_config where key = 'lifecycle_email_experiments';
  if cfg is null then return '{}'::jsonb; end if;

  for etype in select jsonb_object_keys(cfg) loop
    econf := cfg->etype;
    if coalesce((econf->>'enabled')::boolean, false) = false then continue; end if;
    v_mode := coalesce(econf->>'mode', 'optimize');

    if econf ? 'factors' then
      factors_out := '{}'::jsonb;

      for fname in select jsonb_object_keys(econf->'factors') loop
        fconf    := econf->'factors'->fname;
        arms     := array(select jsonb_array_elements_text(fconf->'arms'));
        v_obj    := coalesce(fconf->>'objective', 'click_or_return');
        v_window := coalesce((fconf->>'reward_window_days')::int, 2);
        v_min    := coalesce((fconf->>'min_trials_per_arm')::int, 40);
        v_floor  := coalesce((fconf->>'floor')::numeric, 5);
        means := '{}'::jsonb; stats := '{}'::jsonb; sum_means := 0; warmup := false;

        foreach arm in array arms loop
          -- Arms whose subject line AND preheader are byte-identical to a
          -- pre-0219 flat variant inherit its history. Only ever set on the
          -- subject factor: opens depend on the inbox line alone, so pooling
          -- across the bodies those old sends happened to carry is valid.
          -- Bodies were reshaped, so they start from zero.
          v_legacy := case
                        when fconf->'legacy_arms' ? arm
                          then array(select jsonb_array_elements_text(fconf->'legacy_arms'->arm))
                        else '{}'::text[]
                      end;

          select count(*)::int, count(*) filter (where conv)::int
            into n_arm, r_arm
          from (
            select
              case when v_obj = 'open' then es.opened_at is not null
                   else (es.clicked_at is not null
                         or exists (select 1 from public.analytics_events a
                                    where a.user_id = l.user_id
                                      and a.occurred_at >  l.sent_at
                                      and a.occurred_at <= l.sent_at + interval '24 hours'))
              end as conv
            from public.lifecycle_email_log l
            join public.email_sends es on es.resend_id = l.resend_id
            where l.email_type = etype
              and l.status = 'sent'
              and l.sent_at <= now() - make_interval(days => v_window)
              and ( (case when fname = 'subject' then l.subject_arm else l.body_arm end) = arm
                    or l.variant = any (v_legacy) )
              and (case when v_obj = 'open' then es.delivered_at is not null
                        else es.opened_at is not null end)
          ) s;

          if n_arm < v_min then warmup := true; end if;
          mean := case when n_arm > 0 then r_arm::numeric / n_arm else 0 end;
          means := means || jsonb_build_object(arm, mean);
          sum_means := sum_means + mean;
          stats := stats || jsonb_build_object(arm,
                     jsonb_build_object('n', n_arm, 'reward', r_arm, 'mean', round(mean, 4)));
        end loop;

        new_weights := '{}'::jsonb;
        if v_mode = 'rotate' or warmup or sum_means <= 0 then
          foreach arm in array arms loop
            new_weights := new_weights || jsonb_build_object(arm, (100 / array_length(arms,1)));
          end loop;
        else
          nfloors := array_length(arms,1);
          acc := 0;
          foreach arm in array arms loop
            w := round( v_floor + ((means->>arm)::numeric / sum_means) * (100 - v_floor*nfloors) )::int;
            new_weights := new_weights || jsonb_build_object(arm, w);
            acc := acc + w;
          end loop;
          new_weights := jsonb_set(new_weights, array[arms[1]],
                           to_jsonb(((new_weights->>arms[1])::int + (100 - acc))));
        end if;

        fconf := jsonb_set(fconf, '{weights}', new_weights);
        fconf := jsonb_set(fconf, '{stats}', stats);
        factors_out := factors_out || jsonb_build_object(fname, fconf);
      end loop;

      econf := jsonb_set(econf, '{factors}', factors_out);
      econf := jsonb_set(econf, '{phase}',
                 to_jsonb(case when v_mode = 'rotate' then 'rotate' else 'running' end));
      result := result || jsonb_build_object(etype,
                  jsonb_build_object('factors', factors_out, 'phase', econf->>'phase'));

    else
      -- ── flat A/B path, unchanged from 0211 ────────────────────────────────
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
              exists (select 1 from public.analytics_events a
                      where a.user_id = l.user_id
                        and a.occurred_at >  l.sent_at
                        and a.occurred_at <= l.sent_at + interval '24 hours')
              or exists (select 1 from public.email_sends es
                         where es.resend_id = l.resend_id
                           and es.clicked_at is not null)
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
      if v_mode = 'rotate' or warmup or sum_means <= 0 then
        foreach arm in array arms loop
          new_weights := new_weights || jsonb_build_object(arm, (100 / array_length(arms,1)));
        end loop;
        econf := jsonb_set(econf, '{phase}',
                   to_jsonb(case when v_mode = 'rotate' then 'rotate' else 'warmup' end));
      else
        nfloors := array_length(arms,1);
        acc := 0;
        foreach arm in array arms loop
          w := round( v_floor + ((means->>arm)::numeric / sum_means) * (100 - v_floor*nfloors) )::int;
          new_weights := new_weights || jsonb_build_object(arm, w);
          acc := acc + w;
        end loop;
        new_weights := jsonb_set(new_weights, array[arms[1]], to_jsonb(((new_weights->>arms[1])::int + (100 - acc))));
        econf := jsonb_set(econf, '{phase}', to_jsonb('running'::text));
      end if;

      econf := jsonb_set(econf, '{weights}', new_weights);
      econf := jsonb_set(econf, '{stats}', stats);
      result := result || jsonb_build_object(etype, jsonb_build_object('weights', new_weights, 'phase', econf->>'phase', 'stats', stats));
    end if;

    cfg := jsonb_set(cfg, array[etype], econf);
  end loop;

  update public.app_config set value = cfg, updated_at = now() where key = 'lifecycle_email_experiments';
  return result;
end $$;
revoke all on function public.lifecycle_email_optimize() from public;
grant execute on function public.lifecycle_email_optimize() to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Reshape the four high-volume types into factorial config.
--
--    legacy_arms carries forward the open-rate history of subject arms whose
--    subject line and preheader are byte-identical to the flat variant they
--    replace, verified line by line against the pre-0219 templates.ts:
--      activate_nudge_1     A -> s1, B -> s3
--      activate_nudge_2     A -> s1, B -> s3
--      welcome_board        A -> s1, B -> s2
--      nudge_dormant_early  A -> s1   (B is deleted, not remapped)
--    So nudge_dormant_early s1 starts from n=105 at 51.4% rather than zero.
-- ───────────────────────────────────────────────────────────────────────────
update public.app_config
   set value = value
     || jsonb_build_object('activate_nudge_1',
          ((value->'activate_nudge_1') - 'arms' - 'weights' - 'stats')
          || jsonb_build_object('mode','rotate','phase','rotate','factors',
               jsonb_build_object(
                 'subject', jsonb_build_object(
                   'arms', jsonb_build_array('s1','s2','s3','s4','s5'),
                   'weights', jsonb_build_object('s1',20,'s2',20,'s3',20,'s4',20,'s5',20),
                   'objective','open','reward_window_days',2,
                   'min_trials_per_arm',40,'floor',5,'stats','{}'::jsonb,
                   'legacy_arms', jsonb_build_object('s1', jsonb_build_array('A'),
                                                     's3', jsonb_build_array('B'))),
                 'body', jsonb_build_object(
                   'arms', jsonb_build_array('b1','b2','b3'),
                   'weights', jsonb_build_object('b1',33,'b2',33,'b3',33),
                   'objective','click_or_return','reward_window_days',2,
                   'min_trials_per_arm',40,'floor',5,'stats','{}'::jsonb))))
     || jsonb_build_object('activate_nudge_2',
          ((value->'activate_nudge_2') - 'arms' - 'weights' - 'stats')
          || jsonb_build_object('mode','rotate','phase','rotate','factors',
               jsonb_build_object(
                 'subject', jsonb_build_object(
                   'arms', jsonb_build_array('s1','s2','s3','s4','s5'),
                   'weights', jsonb_build_object('s1',20,'s2',20,'s3',20,'s4',20,'s5',20),
                   'objective','open','reward_window_days',2,
                   'min_trials_per_arm',40,'floor',5,'stats','{}'::jsonb,
                   'legacy_arms', jsonb_build_object('s1', jsonb_build_array('A'),
                                                     's3', jsonb_build_array('B'))),
                 'body', jsonb_build_object(
                   'arms', jsonb_build_array('b1','b2','b3'),
                   'weights', jsonb_build_object('b1',33,'b2',33,'b3',33),
                   'objective','click_or_return','reward_window_days',2,
                   'min_trials_per_arm',40,'floor',5,'stats','{}'::jsonb))))
     || jsonb_build_object('welcome_board',
          ((value->'welcome_board') - 'arms' - 'weights' - 'stats')
          || jsonb_build_object('mode','rotate','phase','rotate','factors',
               jsonb_build_object(
                 'subject', jsonb_build_object(
                   'arms', jsonb_build_array('s1','s2','s3','s4','s5'),
                   'weights', jsonb_build_object('s1',20,'s2',20,'s3',20,'s4',20,'s5',20),
                   'objective','open','reward_window_days',2,
                   'min_trials_per_arm',40,'floor',5,'stats','{}'::jsonb,
                   'legacy_arms', jsonb_build_object('s1', jsonb_build_array('A'),
                                                     's2', jsonb_build_array('B'))),
                 'body', jsonb_build_object(
                   'arms', jsonb_build_array('b1','b2','b3'),
                   'weights', jsonb_build_object('b1',33,'b2',33,'b3',33),
                   'objective','click_or_return','reward_window_days',2,
                   'min_trials_per_arm',40,'floor',5,'stats','{}'::jsonb))))
     || jsonb_build_object('nudge_dormant_early',
          ((value->'nudge_dormant_early') - 'arms' - 'weights' - 'stats')
          || jsonb_build_object('mode','rotate','phase','rotate','factors',
               jsonb_build_object(
                 'subject', jsonb_build_object(
                   'arms', jsonb_build_array('s1','s2','s3','s4','s5'),
                   'weights', jsonb_build_object('s1',20,'s2',20,'s3',20,'s4',20,'s5',20),
                   'objective','open','reward_window_days',2,
                   'min_trials_per_arm',40,'floor',5,'stats','{}'::jsonb,
                   'legacy_arms', jsonb_build_object('s1', jsonb_build_array('A'))),
                 'body', jsonb_build_object(
                   'arms', jsonb_build_array('b1','b2','b3'),
                   'weights', jsonb_build_object('b1',33,'b2',33,'b3',33),
                   'objective','click_or_return','reward_window_days',2,
                   'min_trials_per_arm',40,'floor',5,'stats','{}'::jsonb)))),
       updated_at = now()
 where key = 'lifecycle_email_experiments';

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Read the experiment without opening a jsonb blob.
--
--    Computed live rather than read back from app_config.stats so the admin
--    tab is correct even if the nightly optimizer hasn't run. Un-pivots each
--    send into one row per factor, which is what makes marginal scoring
--    legible: a subject arm's row pools every body it was paired with.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.admin_email_arm_stats(p_days int default 90)
returns table (
  email_type text, factor text, arm text,
  sends bigint, delivered bigint, opened bigint, clicked bigint, returned_24h bigint
) language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  with base as (
    select l.email_type, l.subject_arm, l.body_arm,
           es.delivered_at, es.opened_at, es.clicked_at,
           exists (select 1 from public.analytics_events a
                   where a.user_id = l.user_id
                     and a.occurred_at >  l.sent_at
                     and a.occurred_at <= l.sent_at + interval '24 hours') as returned
    from public.lifecycle_email_log l
    left join public.email_sends es on es.resend_id = l.resend_id
    where l.status = 'sent'
      and l.sent_at >= now() - make_interval(days => p_days)
  )
  select b.email_type, f.factor, f.arm,
         count(*)::bigint,
         count(b.delivered_at)::bigint,
         count(b.opened_at)::bigint,
         count(b.clicked_at)::bigint,
         count(*) filter (where b.returned)::bigint
  from base b
  cross join lateral (values ('subject', b.subject_arm), ('body', b.body_arm)) as f(factor, arm)
  where f.arm is not null
  group by 1, 2, 3
  order by 1, 2, 3;
end $$;
revoke all on function public.admin_email_arm_stats(int) from public;
grant execute on function public.admin_email_arm_stats(int) to authenticated;
