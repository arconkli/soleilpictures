-- 0142_welcome_showcase_experiment.sql
--
-- Adds a SECOND bandit experiment, welcome_showcase, to the app_config
-- 'experiments' config-of-record (0141), and PAUSES first_card_cta. Pure jsonb
-- edit — no new functions: experiment_optimize(), get_experiment_config(),
-- admin_activation_by_experiment(), admin_get_experiment_state() all iterate
-- jsonb_each and pick the new key up automatically. The new experiment is scored
-- on the SAME composite payment-weighted reward (first_card/populated/returned/
-- paid) — correct for an activation/onboarding variant.
--
-- welcome_showcase arm B greets a brand-new user with a curated brand "showcase"
-- (logo, sample stills, palette, "how it works") seeded onto the root, cleared in
-- one click ("try it yourself"); arm A is the current minimal onboarding. Whether
-- the wow lifts long-term value or just adds clutter to clear is what the bandit
-- decides. first_card_cta is paused (its empty-board surface is subsumed by the
-- showcase; one clean lever at current volume) — already-enrolled users keep their
-- stamped arm; this only stops NEW enrollment + hides it from get_experiment_config.

-- 1. Add welcome_showcase (only if absent — never clobber optimizer-tuned weights
--    on re-run), mirroring 0141's first_card_cta shape exactly.
update public.app_config
set value = jsonb_set(
      value,
      '{welcome_showcase}',
      jsonb_build_object(
        'enabled', true,
        'arms', jsonb_build_array('A','B'),
        'weights', jsonb_build_object('A',50,'B',50),
        'default_weights', jsonb_build_object('A',50,'B',50),
        'reward_window_days', 7,            -- eligibility gate (p90 time-to-first-card = 6.2d)
        'min_trials_per_arm', 20,           -- warmup K
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
      ),
      true   -- create_missing
    )
where key = 'experiments'
  and not (value ? 'welcome_showcase');

-- 2. Pause first_card_cta (idempotent). Only touches the operator-owned `enabled`
--    flag; weights/stats/arm stamps are untouched.
update public.app_config
set value = jsonb_set(value, '{first_card_cta,enabled}', 'false'::jsonb, false)
where key = 'experiments'
  and value ? 'first_card_cta';
