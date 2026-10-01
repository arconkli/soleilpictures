-- 0345 — one trial-ending reminder per subscription, before the first charge.
--
-- The Creator trial is card-required and converts automatically on day 14.
-- Nothing told anyone that day was coming: stripe-webhook has no
-- customer.subscription.trial_will_end case, and whether Stripe's own reminder
-- is switched on is a Dashboard setting nobody has verified. A charge nobody
-- saw coming is the worst outcome a trial can have.
--
-- billing-reconcile-cron (daily) now sends the `trial_ending` email about
-- three days ahead, reading the subscriptions mirror rather than depending on
-- which events the webhook endpoint is subscribed to. This column is its
-- claim: set before the send, cleared again if the send fails, so each
-- subscription is reminded once and a failed send retries the next day.
--
-- (Ordinals 0341–0344 are reserved by the card_index derived-table spec.)
--
-- No new grants: subscriptions is written only by service_role; anon and
-- authenticated hold SELECT (RLS: own row / admin), so a new column is not
-- client-writable. Proven below rather than asserted.

alter table public.subscriptions
  add column if not exists trial_reminder_sent_at timestamptz;

comment on column public.subscriptions.trial_reminder_sent_at is
  'When billing-reconcile-cron sent the trial_ending reminder for this subscription (null = not sent). Claimed before the send, released on a failed send.';

do $$
begin
  if has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')
     or has_column_privilege('authenticated', 'public.subscriptions', 'trial_reminder_sent_at', 'UPDATE')
     or has_table_privilege('anon', 'public.subscriptions', 'UPDATE')
     or has_column_privilege('anon', 'public.subscriptions', 'trial_reminder_sent_at', 'UPDATE') then
    raise exception '0345: a client role can write subscriptions.trial_reminder_sent_at';
  end if;
  if not has_column_privilege('service_role', 'public.subscriptions', 'trial_reminder_sent_at', 'UPDATE') then
    raise exception '0345: service_role cannot write the reminder stamp';
  end if;
end $$;
