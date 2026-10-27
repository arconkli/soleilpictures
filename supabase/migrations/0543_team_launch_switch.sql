-- 0543: Teams, part 14 — the launch switch (S5).
--
-- STATUS: APPLIED 2026-10-27 on the owner's go ("ship it"), right after
-- production cc3ad9a9 went live; the proof passed. It was applied once all of
-- these were true:
--   * the launch release is live on production (teamsAllowed(),
--     editorLimitAllowed() and teamPricingAllowed() open, with the docs), so
--     every app that meets a refusal already knows what it means;
--   * the Stripe Team prices exist and team-billing has their secrets
--     (STRIPE_PRODUCT_TEAM, STRIPE_PRICE_TEAM_MONTHLY, STRIPE_PRICE_TEAM_ANNUAL);
--   * the invite email is live (0541 applied after the email deploy).
--
-- Turns on, for everyone:
--   * the 10-editor limit on Free and Creator (editor_limit.enforced, which
--     _editor_limit_on reads, 0520);
--   * Teams (teams_open.open, which _teams_open_for reads, 0522).
-- Both rows keep their test_owner_ids, so setting either back to false later
-- leaves the preview's testers as they were. Nothing else changes: every door,
-- price and limit is already live and was waiting on these two values.
--
-- To undo: the same two updates with 'false'.

begin;
set local lock_timeout = '3s';

update public.app_config
   set value = jsonb_set(value, '{enforced}', 'true'::jsonb)
 where key = 'editor_limit';

update public.app_config
   set value = jsonb_set(value, '{open}', 'true'::jsonb)
 where key = 'teams_open';

-- ── Proof: on for someone who was never listed ──────────────────────────────

do $$
declare
  v_nobody uuid := gen_random_uuid();
begin
  if not public._editor_limit_on(v_nobody) then
    raise exception '0543: the editor limit is not on for everyone';
  end if;
  if not public._teams_open_for(v_nobody) then
    raise exception '0543: teams are not open to everyone';
  end if;
end $$;

commit;
