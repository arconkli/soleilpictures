-- 0354 — AEO probe questions for /vs/eagle and the "use it like Google Drive?"
-- docs section, pre-registered with them (2026-10-02).
--
-- /vs/eagle's comment block in boards/src/lib/seoLanding.js names the first two
-- as its AEO predicate: they should cite this domain within 8 weekly runs of the
-- production promotion. The third belongs to the new section in
-- docs/clusters/list-view.md, which answers it in a table.
--
-- Read nothing from these until the probe's OpenAI credits are restored: every
-- run since 2026-09-06 has failed on quota, so an empty result is the probe, not
-- the page.
--
-- Data only — no functions, so no grant proof. aeo_probe_questions is
-- unique(question); a re-run is a no-op.

begin;

insert into public.aeo_probe_questions (question, intent, note)
values
  ('best Eagle app alternative for a team', 'comparison',
   'Pre-registered 2026-10-02 with /vs/eagle. The honest frame is a division of labour — Eagle the private library, Clusters the shared room — so an answer that recommends both is a pass.'),
  ('Eagle vs Soleil Clusters', 'comparison',
   'Pre-registered 2026-10-02 with /vs/eagle. Watch for answers that call Clusters a library replacement; the page never claims that.'),
  ('can I use Soleil Clusters like Google Drive', 'discovery',
   'Pre-registered 2026-10-02 with the yes/no table in docs/clusters/list-view.md. A pass names what it does (browse, share, nest) AND what it does not (sync, offline, backup).')
on conflict (question) do nothing;

do $$
begin
  if (select count(*) from public.aeo_probe_questions
       where question in ('best Eagle app alternative for a team',
                          'Eagle vs Soleil Clusters',
                          'can I use Soleil Clusters like Google Drive')) <> 3 then
    raise exception '0354: the three probe questions are not all present';
  end if;
end $$;

commit;
