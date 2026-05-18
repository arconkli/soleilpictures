-- 0068_waitlist_accept_cron.sql — schedule the waitlist-accept-cron
-- Edge Function to run every 10 minutes.
--
-- pg_cron uses pg_net to POST to the function, with the service role
-- key pulled from Vault. The Vault row MUST be inserted before the
-- cron will succeed — see the one-time bootstrap in the comment at
-- the bottom of this file.

create extension if not exists pg_cron;

-- Remove any prior version of this job before re-scheduling, so re-runs
-- of this migration are idempotent.
do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job where jobname = 'waitlist-accept-every-10-min'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end$$;

select cron.schedule(
  'waitlist-accept-every-10-min',
  '*/10 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://ehlhlmbpwwalmeisvmdp.supabase.co/functions/v1/waitlist-accept-cron',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
        )
      ),
      body    := jsonb_build_object()
    );
  $cron$
);

-- ── One-time bootstrap (run by hand in Supabase SQL Editor after this
--    migration applies) ──────────────────────────────────────────────────
--
-- Grab the service role key from: Supabase Dashboard → Project Settings →
-- API → 'service_role' secret. Then:
--
--   INSERT INTO vault.secrets (name, secret)
--   VALUES ('service_role_key', 'eyJ…YOUR_KEY…')
--   ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;
--
-- Verify the cron works:
--   SELECT cron.schedule, jobid, jobname FROM cron.job WHERE jobname = 'waitlist-accept-every-10-min';
--   SELECT * FROM cron.job_run_details
--     WHERE jobid = (select jobid from cron.job where jobname = 'waitlist-accept-every-10-min')
--     ORDER BY start_time DESC LIMIT 5;
