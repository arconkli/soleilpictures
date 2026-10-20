-- 0440 — bulk import's ledger is purged once nothing can read it again.
--
-- import_items and import_folders (0430) exist so an import a reload stopped
-- can resume, or be dropped again, without making a second cluster or
-- uploading a landed file twice: one row per file, tens of thousands for one
-- import. A stopped import is offered for STOPPED_WITHIN_DAYS (30,
-- boards/src/lib/importResume.js) after its job was last touched, failed ones
-- included; a finished one (done, cancelled) is never read again. So 45 days
-- after a job's last update its ledger goes. The job row stays: it is one row,
-- and it is what the import's analytics read.
--
-- 0430 said this sweep would come with the Dropbox connector. It comes now
-- because the preview host already writes these rows into the one database
-- production uses.
--
-- importResume.test.mjs pins the 45 above STOPPED_WITHIN_DAYS, so the window
-- can't shrink under an import that is still being offered.
--
-- A run takes at most 500 jobs, oldest first: a backlog drains over days, not
-- in one delete. It runs as the cron's owner, which owns these tables and so
-- passes their row level security; no client can call it.

create or replace function public.purge_old_import_ledger(p_days integer)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_cut   timestamptz := now() - make_interval(days => p_days);
  v_items integer;
  v_dirs  integer;
begin
  with old as (
    select j.id from public.import_jobs j
     where j.updated_at < v_cut
       and (exists (select 1 from public.import_items i where i.job_id = j.id)
            or exists (select 1 from public.import_folders f where f.job_id = j.id))
     order by j.updated_at
     limit 500
  ), gone_items as (
    delete from public.import_items i using old where i.job_id = old.id returning 1
  ), gone_dirs as (
    delete from public.import_folders f using old where f.job_id = old.id returning 1
  )
  select (select count(*) from gone_items), (select count(*) from gone_dirs) into v_items, v_dirs;
  return v_items + v_dirs;
end $$;
revoke execute on function public.purge_old_import_ledger(integer) from public, anon, authenticated;

select cron.schedule('purge-import-ledger', '52 3 * * *', $$select public.purge_old_import_ledger(45)$$);

-- The 0311 habit: prove the grants rather than trust the REVOKE.
do $$
begin
  if has_function_privilege('anon', 'public.purge_old_import_ledger(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.purge_old_import_ledger(integer)', 'execute') then
    raise exception '0440: purge_old_import_ledger is client-callable';
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-import-ledger' and active
                   and command = 'select public.purge_old_import_ledger(45)') then
    raise exception '0440: the purge job is missing';
  end if;
end $$;
