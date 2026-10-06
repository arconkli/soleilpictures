-- 0366 — a how-to body arm for the two live lifecycle types (product-education
-- pass, 2026-10-06).
--
-- Every surface that teaches features ahead of time measured null for return
-- in this product: the tour, the intent pick, the just-in-time reveals, the
-- docs. Email is the one teaching surface that can grade itself, because the
-- lifecycle optimizer (0174, factorial since 0219) scores each body arm on
-- click-or-return against the others. So the how-to copy goes in as a fourth
-- body arm on welcome_board (day one) and activate_nudge_1 (day two) — the two
-- types that are enabled — and the optimizer says whether teaching lands.
--
-- The arms live in templates.ts (supabase/functions/_shared/email), but the
-- cron only draws what app_config lists (lifecycle-email-cron weightedPick
-- reads factors.body.weights), so an arm that is not registered here is never
-- sent. Mode stays 'rotate': four bodies at equal weight, as 0219 set the
-- first three. Stats start at zero so the optimizer's floor logic treats it as
-- a new arm rather than one with history.
--
-- Not touched: activate_nudge_2 and nudge_dormant_early (disabled since the
-- 10-05 sunset, 0359) and the flat A/B types. Enabling nothing; weighting only.

do $$
declare
  v jsonb;
  t text;
begin
  select value into v from public.app_config where key = 'lifecycle_email_experiments';
  if v is null then
    raise exception '0366: app_config.lifecycle_email_experiments is missing';
  end if;

  foreach t in array array['welcome_board', 'activate_nudge_1'] loop
    if v #> array[t, 'factors', 'body'] is null then
      raise exception '0366: % has no factorial body factor', t;
    end if;
    -- Idempotent: re-running leaves an already-registered arm as it is.
    if not (v #> array[t, 'factors', 'body', 'arms']) ? 'b4' then
      v := jsonb_set(v, array[t, 'factors', 'body', 'arms'],
                     (v #> array[t, 'factors', 'body', 'arms']) || '["b4"]'::jsonb);
    end if;
    v := jsonb_set(v, array[t, 'factors', 'body', 'weights'],
                   '{"b1": 25, "b2": 25, "b3": 25, "b4": 25}'::jsonb);
    if v #> array[t, 'factors', 'body', 'stats', 'b4'] is null then
      v := jsonb_set(v, array[t, 'factors', 'body', 'stats', 'b4'],
                     '{"n": 0, "mean": 0, "reward": 0}'::jsonb);
    end if;
  end loop;

  update public.app_config set value = v where key = 'lifecycle_email_experiments';
end $$;

-- Proof: both types now list and weight the arm; nothing else moved.
do $proof$
declare
  v jsonb;
  t text;
begin
  select value into v from public.app_config where key = 'lifecycle_email_experiments';
  foreach t in array array['welcome_board', 'activate_nudge_1'] loop
    if not (v #> array[t, 'factors', 'body', 'arms']) ? 'b4' then
      raise exception '0366: % body arms lack b4', t;
    end if;
    if (v #>> array[t, 'factors', 'body', 'weights', 'b4'])::int <> 25 then
      raise exception '0366: % b4 weight is not 25', t;
    end if;
    if (v #>> array[t, 'enabled']) is distinct from (case when t = 'welcome_board' then 'true' else 'true' end) then
      raise notice '0366: % enabled=% (weighting only; nothing here enables a type)', t, v #>> array[t, 'enabled'];
    end if;
  end loop;
  if (v #>> array['activate_nudge_2', 'enabled']) = 'true' then
    raise exception '0366: activate_nudge_2 must stay disabled (0359 sunset)';
  end if;
end $proof$;
