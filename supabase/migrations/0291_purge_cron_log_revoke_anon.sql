-- 0291 — purge_cron_job_run_details() was reachable by anon and authenticated.
--
-- Same trap as 0290, and worse: this one is SECURITY DEFINER and DELETES. A new
-- function in the public schema picks up the default EXECUTE grants for the
-- Supabase API roles, and `revoke all ... from public` in 0288 did not reach
-- them — PUBLIC is a distinct grantee from anon/authenticated.
--
-- It is a cron-only maintenance function. Nothing but pg_cron (running as
-- postgres) should ever call it.

revoke all on function public.purge_cron_job_run_details(integer) from anon;
revoke all on function public.purge_cron_job_run_details(integer) from authenticated;
revoke all on function public.purge_cron_job_run_details(integer) from public;
