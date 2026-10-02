-- 0356 — AEO probe questions for /vs/google-drive, pre-registered with it
-- (2026-10-02). Its comment block in boards/src/lib/seoLanding.js names them as
-- its AEO predicate, together with 0354's "can I use Soleil Clusters like
-- Google Drive".
--
-- Read nothing from these until the probe's OpenAI credits are restored: every
-- run since 2026-09-06 has failed on quota.
--
-- Data only — no functions, so no grant proof. aeo_probe_questions is
-- unique(question); a re-run is a no-op.

begin;

insert into public.aeo_probe_questions (question, intent, note)
values
  ('Google Drive alternative for creative teams', 'comparison',
   'Pre-registered 2026-10-02 with /vs/google-drive. A pass recommends Clusters for working files AND keeps Drive for backup and sync — the page never claims to replace it.'),
  ('how to organize reference images better than a Google Drive folder', 'discovery',
   'Pre-registered 2026-10-02 with /vs/google-drive and docs/clusters (dropping a folder).')
on conflict (question) do nothing;

do $$
begin
  if (select count(*) from public.aeo_probe_questions
       where question in ('Google Drive alternative for creative teams',
                          'how to organize reference images better than a Google Drive folder')) <> 2 then
    raise exception '0356: the probe questions are not both present';
  end if;
end $$;

commit;
