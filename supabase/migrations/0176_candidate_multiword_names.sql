-- 0176 — Multi-word candidate names ("Lost Time" → one candidate, not "Lost" + "Time").
--
-- The candidate-name detector (0162) only ever extracted SINGLE capitalized
-- words (`\m([A-Z][a-z]{2,})\M`), so a two-word proper noun like "Lost Time"
-- surfaced as two separate candidates — and tapping each produced two wrong
-- tags. Everything downstream already supports multi-word tags (the entity-name
-- trie is char-level and prefers the longest match; ensureTag/promote never
-- split). The only gap was detection.
--
-- This rev adds a PHRASE stream — maximal runs of ≥2 consecutive Title-Case
-- words — as its own candidate source, and SUPPRESSES the constituent single
-- words when they appear (almost) only inside a phrase. A recurring multi-word
-- Title-Case run is itself strong proper-noun evidence, so phrase qualification
-- is light (recurs ≥2×, ≥1 non-stop word, not already a tag / dismissed).
--
-- Everything else (signature, evidence CTEs, single-word gate) is unchanged.

create or replace function public.get_candidate_names(p_workspace_id uuid, p_min_count integer default 2, p_limit integer default 60)
returns table(name text, n bigint, sample text, entity_type text)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  stop text[] := array[
    'the','and','but','for','with','from','into','this','that','then','there','here',
    'they','them','their','your','you','his','her','she','him','our','out','one','two',
    'all','now','not','some','any','what','who','how','why','was','were','are','has','had',
    'have','get','got','see','can','will','would','could','should','its','off','put','let',
    'over','more','very','only','each','same','than','when','while','after','before','about',
    'because','around','through','against','between','behind','below','above','under','also',
    'just','like','well','back','down','up','onto','upon','as','at','by','in','of','on','to',
    'an','or','if','it','is','be','do','we','he','my','me','us','so','no','yes',
    'cut','close','shot','scene','int','ext','est','black','white','pan','zoom','fade',
    'open','smash','slam','cont','contd','vhs','pov','title','card','montage','edit','music',
    'wide','wideshot','closeup','intercut','aerial','establishing','retro','split','screen',
    'main','final','first','second','third','last','next','still','suddenly','meanwhile',
    'inside','outside','later','months','weeks','days','beat','quick','slow','loud','everyone',
    'everything','someone','something','anyone','nobody','people','guy','guys','girl','girls',
    'man','men','woman','women','kid','room','rooms','door','doors','side','time','day','night',
    'morning','city','street','streets','wall','walls','floor','ground','blood','face','faces',
    'head','hand','hands','gun','guns','knife','fire','water','god','lord',
    'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
    'january','february','march','april','june','july','august','september','october',
    'november','december',
    'palette','board','note','image','doc','tag','swag'
  ];
begin
  if not is_workspace_member(p_workspace_id) then
    return;
  end if;
  return query
  with src as (
    select ci.body as txt from card_index ci where ci.workspace_id = p_workspace_id and ci.body is not null
    union all select ci.title from card_index ci where ci.workspace_id = p_workspace_id and ci.title is not null
    union all select dp.page_text from doc_page_index dp where dp.workspace_id = p_workspace_id and dp.page_text is not null
    union all select dp.page_title from doc_page_index dp where dp.workspace_id = p_workspace_id and dp.page_title is not null
  ),
  toks as (select (regexp_matches(s.txt, '\m([A-Z][a-z]{2,})\M', 'g'))[1] as tok, s.txt from src s),
  counted as (select tok, count(*) as n, (array_agg(txt order by length(txt)))[1] as any_txt from toks group by tok),
  -- Multi-word phrase stream: maximal runs of ≥2 consecutive Title-Case words.
  phrase_toks as (
    select (regexp_matches(s.txt, '\m([A-Z][a-z]{2,}( [A-Z][a-z]{2,})+)\M', 'g'))[1] as tok, s.txt from src s
  ),
  phrase_counted as (
    select tok, count(*) as n, (array_agg(txt order by length(txt)))[1] as any_txt
    from phrase_toks group by tok
  ),
  -- How often each word appears INSIDE a phrase — used to suppress single words
  -- that are (almost) only ever part of a phrase.
  phrase_words as (
    select lower(w) as word, count(*) as c
    from phrase_toks pt, regexp_split_to_table(pt.tok, ' ') w
    group by lower(w)
  ),
  -- Phrase used MID-SENTENCE (preceded by a lowercase letter / comma) = real
  -- proper-noun usage in prose, not a heading / font name / form value.
  phrase_prose as (
    select lower(t) as tok, count(*) as c from (
      select (regexp_matches(txt,'[a-z,] +([A-Z][a-z]{2,}( [A-Z][a-z]{2,})+)\M','g'))[1] as t from src
    ) q group by lower(t)
  ),
  -- Phrase immediately followed by a colon = a form-field label
  -- ("Favorite Food:", "Relationship Status:"), not an entity.
  phrase_lbl as (
    select lower(t) as tok, count(*) as c from (
      select (regexp_matches(txt,'\m([A-Z][a-z]{2,}( [A-Z][a-z]{2,})+) *:','g'))[1] as t from src
    ) q group by lower(t)
  ),
  ev_the as (select t from (select lower((regexp_matches(txt,'\mthe ([A-Z][a-z]{2,})\M','g'))[1]) as t from src) q group by t having count(*) >= 2),
  ev_org as (select distinct lower((regexp_matches(txt,'\m([A-Z][a-z]{2,})[ ]+(goons|gang|gangs|army|armies|crew|crews|family|families|cartel|order|cult|clan|clans|members|member|soldiers|forces|empire|tribe|tribes|syndicate|squad|band|mafia|brotherhood|faction)\M','g'))[1]) as t from src),
  ev_poss as (select distinct lower((regexp_matches(txt,'\m([A-Z][a-z]{2,})[' || chr(39) || chr(8217) || ']s\M','g'))[1]) as t from src),
  ev_verb as (select distinct lower((regexp_matches(txt,'\m([A-Z][a-z]{2,})[ ]+(said|says|asked|asks|walks|walked|runs|ran|grabs|grabbed|turns|turned|nods|nodded|smiles|smiled|shouts|shouted|screams|screamed|whispers|whispered|replies|replied|looks|looked|stares|stared|stands|stood|sits|sat|yells|yelled|laughs|laughed|sighs|sighed|steps|stepped|points|pointed)\M','g'))[1]) as t from src),
  ev_loc as (select t from (select lower((regexp_matches(txt,'\m(at|inside|near|outside) ([A-Z][a-z]{2,})\M','g'))[2]) as t from src) q group by t having count(*) >= 2),
  prose as (select t, count(*) as c from (select lower((regexp_matches(txt,'[a-z,] +([A-Z][a-z]{2,})\M','g'))[1]) as t from src) q group by t),
  fieldlbl as (select t, count(*) as c from (select lower((regexp_matches(txt,'\m([A-Z][a-z]{2,}) *:','g'))[1]) as t from src) q group by t),
  flagged as (
    select c.tok, c.n, c.any_txt,
      (lower(c.tok) in (select word from common_words)) as is_common,
      exists(select 1 from entity_search es where es.workspace_id = p_workspace_id and lower(es.title) = lower(c.tok)) as has_title,
      (lower(c.tok) in (select t from ev_the))  as e_the,
      (lower(c.tok) in (select t from ev_org))  as e_org,
      (lower(c.tok) in (select t from ev_poss)) as e_poss,
      (lower(c.tok) in (select t from ev_verb)) as e_verb,
      (lower(c.tok) in (select t from ev_loc))  as e_loc,
      coalesce(pr.c, 0) as prose_mid,
      coalesce(fl.c, 0) as field_lbl,
      coalesce(pw.c, 0) as in_phrase
    from counted c
    left join prose pr on pr.t = lower(c.tok)
    left join fieldlbl fl on fl.t = lower(c.tok)
    left join phrase_words pw on pw.word = lower(c.tok)
  ),
  -- Single-word candidates (unchanged evidence gate) MINUS words subsumed by a
  -- phrase: keep only if the standalone (non-phrase) count still clears threshold.
  single_out as (
    select f.tok as name, f.n,
      left(regexp_replace(substr(f.any_txt, greatest(1, position(f.tok in f.any_txt) - 24), 80), '\s+', ' ', 'g'), 80) as sample,
      case
        when f.e_the or f.e_org then 'organization'
        when f.e_poss or f.e_verb then 'character'
        when f.e_loc then 'setting'
        else guess_entity_type(f.tok)
      end as entity_type
    from flagged f
    where f.n >= greatest(2, p_min_count)
      and (f.n - f.in_phrase) >= greatest(2, p_min_count)
      and lower(f.tok) <> all(stop)
      and not exists (select 1 from tags t where t.workspace_id = p_workspace_id and t.slug = lower(f.tok))
      and not exists (select 1 from entity_ignore_terms ig where ig.workspace_id = p_workspace_id and lower(ig.term) = lower(f.tok) and ig.scope = 'workspace')
      and f.field_lbl < greatest(1, f.prose_mid)
      and (
           f.has_title or f.e_the or f.e_org or f.e_poss or f.e_verb or f.e_loc
        or (f.prose_mid >= 1 and not f.is_common)
      )
  ),
  -- Phrase candidates. Qualified by the same prose-evidence philosophy as
  -- single words: keep only with positive proper-noun evidence (used mid-prose,
  -- or an existing entity title) and drop form-field labels. This filters font
  -- names ("Courier New") and profile-card labels ("Favorite Food") while
  -- keeping real names ("Lost Time", "Maria Hernandez").
  phrase_out as (
    select pc.tok as name, pc.n,
      left(regexp_replace(substr(pc.any_txt, greatest(1, position(pc.tok in pc.any_txt) - 24), 80), '\s+', ' ', 'g'), 80) as sample,
      guess_entity_type(pc.tok) as entity_type
    from phrase_counted pc
    left join phrase_prose pp on pp.tok = lower(pc.tok)
    left join phrase_lbl pl on pl.tok = lower(pc.tok)
    where pc.n >= greatest(2, p_min_count)
      -- at least one word is not a stop word (drops "Final Draft"-style junk)
      and exists (select 1 from regexp_split_to_table(pc.tok, ' ') w where lower(w) <> all(stop))
      and not exists (select 1 from tags t where t.workspace_id = p_workspace_id and t.slug = lower(pc.tok))
      and not exists (select 1 from entity_ignore_terms ig where ig.workspace_id = p_workspace_id and lower(ig.term) = lower(pc.tok) and ig.scope = 'workspace')
      -- NOT predominantly a form-field label
      and coalesce(pl.c, 0) < greatest(1, coalesce(pp.c, 0))
      -- Positive evidence: reads as a name in prose, OR is already an entity.
      and (
           coalesce(pp.c, 0) >= 1
        or exists (select 1 from entity_search es where es.workspace_id = p_workspace_id and lower(es.title) = lower(pc.tok))
      )
  )
  select u.name, u.n, u.sample, u.entity_type
  from (select * from single_out union all select * from phrase_out) u
  order by u.n desc, u.name
  limit greatest(1, p_limit);
end $function$;

grant execute on function public.get_candidate_names(uuid, integer, integer) to authenticated;
