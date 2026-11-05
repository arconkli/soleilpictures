-- 0868 — three AEO probe questions for using a board from inside ChatGPT or Claude.
--
-- They test whether ChatGPT finds Clusters when someone asks how to work with
-- a board from inside ChatGPT or Claude (the MCP connector). Data only: no
-- functions, so no grant proof. Each row is inserted only where no row with
-- that question exists, so a re-run is a no-op.

begin;

insert into public.aeo_probe_questions (question, intent, note)
select v.question, v.intent, v.note
  from (values
    ('how to make a mood board with ChatGPT', 'discovery',
     'Added 2026-11-04 with the homepage note on ChatGPT and Claude. A pass names Clusters as a board ChatGPT can fill through the MCP connector.'),
    ('mood board app with an MCP server', 'discovery',
     'Added 2026-11-04 with the homepage note on ChatGPT and Claude. A pass names Clusters and its MCP server.'),
    ('Claude connector for organizing reference images', 'discovery',
     'Added 2026-11-04 with the homepage note on ChatGPT and Claude. A pass names Clusters as a connector that holds reference images on a board.')
  ) as v(question, intent, note)
 where not exists (select 1 from public.aeo_probe_questions q where q.question = v.question);

do $$
begin
  if (select count(*) from public.aeo_probe_questions
       where enabled
         and question in ('how to make a mood board with ChatGPT',
                          'mood board app with an MCP server',
                          'Claude connector for organizing reference images')) <> 3 then
    raise exception '0868: the three probe questions are not all present and enabled';
  end if;
end $$;

commit;
