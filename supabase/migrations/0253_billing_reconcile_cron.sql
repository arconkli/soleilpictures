-- 0253 — schedule billing-reconcile-cron daily (decided 2026-08-21).
--
-- Webhook-outage insurance: Stripe retries a failing webhook for ~3 days and
-- then gives up, after which a canceled subscriber would stay tier='paid'
-- forever (current_period_end was never used as an access boundary). The edge
-- function re-anchors every non-grant paid user to live Stripe truth in both
-- directions — repairing mirrors for renewals the webhook missed, demoting
-- subscribers Stripe says are dead, and flagging billing-invisible comps for
-- the operator without touching them. See
-- supabase/functions/billing-reconcile-cron/index.ts for the full policy.
--
-- Scheduling matches the LIVE pattern of jobs 6/20/21/22 (x-cron-secret; the
-- vault-bearer pattern in 0069's file text was superseded in the live jobs).
-- THE REPO IS PUBLIC: <CRON_SECRET> below is a placeholder — the applied
-- migration carries the real value (Supabase dashboard → edge function
-- secrets → CRON_SECRET), same value the sibling cron jobs send.

do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job where jobname = 'billing-reconcile-daily'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end$$;

select cron.schedule(
  'billing-reconcile-daily',
  '47 6 * * *',
  $cron$
    select net.http_post(
      url     := 'https://ehlhlmbpwwalmeisvmdp.supabase.co/functions/v1/billing-reconcile-cron',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '<CRON_SECRET>'
      ),
      body    := jsonb_build_object()
    );
  $cron$
);
