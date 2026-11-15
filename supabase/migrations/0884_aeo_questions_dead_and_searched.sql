-- 0884 — the answer check stops asking two dead questions and starts asking
-- three that people really search.
--
-- Dead: "how to make a director's treatment" (id 14) and "how to make a
-- cinematography lookbook" (id 17). Both are how-to questions the assistant
-- answers from what it already knows, without searching: every run on record
-- came back with no sources at all, so neither can ever cite anyone and each
-- only lowers the cited share. They are switched off, not deleted, so their
-- past results keep their question (aeo_retrieval_results.question_id). They
-- are matched by id AND question, so a row that is not the one read on
-- 2026-11-14 is left alone and the proof below says so.
--
-- New: the three intents the question set did not cover. The Worker's weekly
-- sweep (worker-aeo.js) reads enabled rows, so they are asked on the next run
-- with no deploy. A question needs three runs before its result is read.
--
-- Data only: no functions, so no grant proof. Each row is inserted only where
-- no row with that question exists (unique(question)), so a re-run is a no-op.

begin;

update public.aeo_probe_questions
   set enabled = false,
       note = note || ' Switched off 2026-11-14 (0884): every run returned no sources, so it could never cite anyone.'
 where enabled
   and (id, question) in (
     (14, 'how to make a director''s treatment'),
     (17, 'how to make a cinematography lookbook'));

insert into public.aeo_probe_questions (question, intent, note)
select v.question, v.intent, v.note
  from (values
    ('is there an online version of PureRef', 'discovery',
     'Added 2026-11-14 for the question /vs/pureref answers. A pass says PureRef has no web version and names Clusters as one that runs in the browser.'),
    ('free mood board maker no sign up', 'discovery',
     'Added 2026-11-14 with /tools/free-mood-board-maker. A pass names Clusters with what its free plan holds. Check what an answer says about needing an account against that page.'),
    ('how to share a mood board with a client', 'discovery',
     'Added 2026-11-14 for share links. A pass names Clusters as a board a client opens from a view-only link with no account.')
  ) as v(question, intent, note)
 where not exists (select 1 from public.aeo_probe_questions q where q.question = v.question);

do $$
begin
  if exists (select 1 from public.aeo_probe_questions
              where enabled
                and question in ('how to make a director''s treatment',
                                 'how to make a cinematography lookbook')) then
    raise exception '0884: a dead probe question is still enabled';
  end if;

  if (select count(*) from public.aeo_probe_questions
       where enabled
         and question in ('is there an online version of PureRef',
                          'free mood board maker no sign up',
                          'how to share a mood board with a client')) <> 3 then
    raise exception '0884: the three new probe questions are not all present and enabled';
  end if;

  -- q23 to q25 (0868) keep running: they have not had their three runs yet.
  if (select count(*) from public.aeo_probe_questions
       where enabled
         and question in ('how to make a mood board with ChatGPT',
                          'mood board app with an MCP server',
                          'Claude connector for organizing reference images')) <> 3 then
    raise exception '0884: the 0868 questions must stay enabled';
  end if;
end $$;

commit;
