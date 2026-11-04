-- 0864: the free plan gives NEW accounts 25 cards (it gave 50 from 0229 until
-- now).
--
-- Only the column default of profiles.card_cap_base moves. Nothing else writes
-- that column (no sign-up, referral, transfer or draft path sets it), so every
-- profile made from here on starts at 25: a sign-up, an invitee, an MCP
-- draft's identity. Every existing row keeps the base it was made with, 100
-- (before 0229) or 50 (0229 until this), and is never lowered; the do-block
-- below proves no row moved. Invitees still get REFERRAL_BONUS_CARDS on top in
-- bonus_card_credits, so they start at 50.
--
-- The cap trigger (enforce_demo_card_cap_trg, 0537) already counts each
-- account against its own card_cap_base + bonus_card_credits and words its
-- refusal with that number, so no function changes, and there is no grants
-- block (0311): nothing is created or replaced. The coalesce(card_cap_base, 50)
-- fallbacks in older functions can't be reached (the column is NOT NULL) and
-- stay as they are.
--
-- The app moves with this: DEMO_CARD_LIMIT (boards/src/lib/demoCardCap.js) is
-- 25, PRIOR_DEMO_CARD_LIMIT keeps 50 for the accounts made under it, and
-- scripts/gen-docs.mjs refuses to build when the constant and the newest
-- default in these migrations disagree.
--
-- Ship order: the app and the Worker first, then this. The other order lets
-- something the old build allowed to 50 meet a 25-card account; this order
-- only means someone who signs up in between keeps 50.

set local lock_timeout = '3s';

do $$
declare
  v_before  jsonb;
  v_after   jsonb;
  v_default text;
begin
  -- Hold the table still from the first count to the last, so a sign-up in
  -- between can't read as an existing row moving.
  lock table public.profiles in access exclusive mode;

  select coalesce(jsonb_object_agg(s.base::text, s.n), '{}'::jsonb)
    into v_before
    from (select card_cap_base as base, count(*) as n
            from public.profiles group by card_cap_base) s;

  alter table public.profiles alter column card_cap_base set default 25;

  select coalesce(jsonb_object_agg(s.base::text, s.n), '{}'::jsonb)
    into v_after
    from (select card_cap_base as base, count(*) as n
            from public.profiles group by card_cap_base) s;
  if v_after is distinct from v_before then
    raise exception '0864: existing card limits moved';
  end if;

  select c.column_default into v_default
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'profiles'
     and c.column_name = 'card_cap_base';
  if v_default is distinct from '25' then
    raise exception '0864: profiles.card_cap_base defaults to %, not 25', v_default;
  end if;
end $$;
