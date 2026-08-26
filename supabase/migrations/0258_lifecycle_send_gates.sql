-- 0258_lifecycle_send_gates.sql — a per-type off switch, and one bounce guard
-- that covers every type instead of one.
--
-- Two gaps, both closed at the same place.
--
-- 1. THERE IS NO WAY TO TURN A LIFECYCLE TYPE OFF WITHOUT A DEPLOY.
--    lifecycle-email-cron calls runType() for each type unconditionally. The
--    `enabled` key that already sits on every entry of app_config
--    'lifecycle_email_experiments' is read only by the variant draw — it has
--    never gated a send, so a type that turns out not to earn its sends can
--    only be stopped by editing and redeploying the edge function. The local
--    Supabase CLI is authenticated to another organisation and cannot see this
--    project, so that redeploy is a hand-passed MCP call over the whole source
--    tree. Far too much ceremony for "stop sending this".
--
--    whats_new is the exception: migration 0211 gave it its own edition switch
--    in app_config 'lifecycle_whats_new', and the cron checks it before it even
--    asks who is eligible. That switch stays authoritative for whats_new; the
--    one added here is the general case, for the six types that had none.
--
-- 2. 0237 ADDED THE BOUNCE GUARD TO ONE ELIGIBILITY RPC OUT OF SEVEN.
--    _email_deliverable() went onto lifecycle_due_whats_new and that migration's
--    own comment records the other six as owed, one line each. They are still
--    owed. An address that has bounced and never delivered since stays in six
--    audiences forever, and repeat sends to dead addresses are precisely what
--    the mailbox providers grade a sender on.
--
-- WHY BOTH LAND IN lifecycle_claim_send RATHER THAN THE ELIGIBILITY RPCS.
-- The claim is already the last gate before a send and already re-checks
-- consent, which is the same class of question. Putting these beside that check
-- is one edit to one small function instead of seven edits to seven large
-- queries whose date arithmetic is the delicate part of this system. It also
-- covers any type added later for free.
--
-- The visible cost is telemetry shape: the cron's summary will report a type as
-- `eligible: N, skipped: N` rather than `eligible: 0`, because the audience is
-- still computed before the claim refuses it. That is arguably the more useful
-- reading — it keeps showing how large the suppressed audience is.
--
-- APPLIED ALONGSIDE THIS MIGRATION, as config rather than schema, because the
-- whole point of a switch is that reversing it must not need a migration:
--
--   nudge_dormant_early  → lifecycle_email_experiments.nudge_dormant_early.enabled = false
--   whats_new            → lifecycle_whats_new.enabled = false
--
-- Both types mail a dormant, never-activated segment, and over a month of
-- sending neither showed any measurable effect on whether those readers came
-- back and did work — judged on work in the app within 72h of a send, not on
-- opens, which were healthy throughout. The activation nudges and the two
-- win-backs aimed at people who still have something in the app are untouched
-- and still sending.
--
-- Note the two switches live in different rows on purpose. whats_new keeps the
-- edition switch 0211 gave it, which the cron consults before it computes an
-- audience at all; the general one added here is for the six types that had no
-- switch of any kind. One switch per type — do not add a second.
--
-- To reverse either, set the flag back to true. Nothing else is required.

-- ── The switch ───────────────────────────────────────────────────────────────
-- Reads the `enabled` flag already present on each type in
-- 'lifecycle_email_experiments'. Absent, unreadable or non-boolean all mean ON:
-- a config typo must not silently mute the whole programme, and every type in
-- that row is currently sending, so this changes nothing until a flag is set.
--
-- Compared as jsonb rather than cast to boolean on purpose — `'nonsense'::boolean`
-- raises, and a raise here would abort the claim and take the send with it. This
-- mirrors _email_pref_enabled's `<> 'false'` shape.
create or replace function public.lifecycle_type_enabled(p_type text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    ((select value from public.app_config where key = 'lifecycle_email_experiments')
       -> p_type -> 'enabled') <> 'false'::jsonb,
    true
  );
$$;
revoke all on function public.lifecycle_type_enabled(text) from public, anon, authenticated;
grant execute on function public.lifecycle_type_enabled(text) to service_role;

comment on function public.lifecycle_type_enabled(text) is
  'Per-type lifecycle send switch, read from app_config lifecycle_email_experiments.<type>.enabled. Defaults ON when absent or unparseable. whats_new additionally has its own edition switch in lifecycle_whats_new, which the cron checks first.';

-- ── The gate ─────────────────────────────────────────────────────────────────
-- Signature is unchanged, so create or replace is correct here and the existing
-- ACL survives. (Adding or defaulting a parameter would NOT be — that makes the
-- old call ambiguous rather than resolving to the new form, which is what forced
-- the DROP in 0211 and 0236.)
create or replace function public.lifecycle_claim_send(
  p_user_id         uuid,
  p_email_type      text,
  p_recipient_email text,
  p_variant         text default null,
  p_content_version text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.lifecycle_email_log
    (user_id, email_type, recipient_email, status, variant, content_version)
  select p_user_id, p_email_type, p_recipient_email, 'claimed', p_variant, p_content_version
  where public._email_pref_enabled(p_user_id, 'email_lifecycle')
    and public.lifecycle_type_enabled(p_email_type)
    and public._email_deliverable(p_user_id)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;

comment on function public.lifecycle_claim_send(uuid, text, text, text, text) is
  'Claim-before-send for lifecycle mail. Re-checks consent, the per-type switch and deliverability, then takes the once-ever / once-per-day unique indexes. Returns the log id, or null when the send must not happen.';
