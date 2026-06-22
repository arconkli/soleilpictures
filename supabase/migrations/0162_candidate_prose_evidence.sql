-- 0162 — Candidate qualification by PROSE EVIDENCE, not blocklist.
--
-- 0161 kept a recurring capitalized word UNLESS it was a common word — making
-- the common_words dictionary the primary gate, which is whack-a-mole against
-- templated character-profile cards ("Religion: Catholic  Relationship Status:
-- Dating  Fears: Snakes…") and freeform scratch notes ("To fix: …").
--
-- Real entities vs that junk differ STRUCTURALLY, not by vocabulary:
--   - real names appear capitalized MID-SENTENCE in prose ("Scared of Onyx")
--   - form labels are followed by a colon ("Religion:", "Status:")
--   - values / sentence-starts never appear mid-sentence (Catholic, Make)
--
-- So flip the default: keep only with POSITIVE proper-noun evidence, and drop
-- form-field labels. common_words stays as a secondary backstop (for common
-- words that DO appear mid-sentence, e.g. Bipolar/Catholic), not the gate.

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
    select ci.body as txt from card_index ci
      where ci.workspace_id = p_workspace_id and ci.body is not null
    union all select ci.title from card_index ci
      where ci.workspace_id = p_workspace_id and ci.title is not null
    union all select dp.page_text from doc_page_index dp
      where dp.workspace_id = p_workspace_id and dp.page_text is not null
    union all select dp.page_title from doc_page_index dp
      where dp.workspace_id = p_workspace_id and dp.page_title is not null
  ),
  toks as (
    select (regexp_matches(s.txt, '\m([A-Z][a-z]{2,})\M', 'g'))[1] as tok, s.txt from src s
  ),
  counted as (
    select tok, count(*) as n, (array_agg(txt order by length(txt)))[1] as any_txt
    from toks group by tok
  ),
  ev_the as (  -- E2: "the X" ≥2 -> organization
    select t from (select lower((regexp_matches(txt,'\mthe ([A-Z][a-z]{2,})\M','g'))[1]) as t from src) q
    group by t having count(*) >= 2
  ),
  ev_org as (  -- E3: "X goons/gang/army/..." -> organization
    select distinct lower((regexp_matches(txt,
      '\m([A-Z][a-z]{2,})[ ]+(goons|gang|gangs|army|armies|crew|crews|family|families|cartel|order|cult|clan|clans|members|member|soldiers|forces|empire|tribe|tribes|syndicate|squad|band|mafia|brotherhood|faction)\M','g'))[1]) as t
    from src
  ),
  ev_poss as (  -- E1: "X's" -> character
    select distinct lower((regexp_matches(txt,
      '\m([A-Z][a-z]{2,})[' || chr(39) || chr(8217) || ']s\M','g'))[1]) as t
    from src
  ),
  ev_verb as (  -- E4: "X said/walks/..." -> character
    select distinct lower((regexp_matches(txt,
      '\m([A-Z][a-z]{2,})[ ]+(said|says|asked|asks|walks|walked|runs|ran|grabs|grabbed|turns|turned|nods|nodded|smiles|smiled|shouts|shouted|screams|screamed|whispers|whispered|replies|replied|looks|looked|stares|stared|stands|stood|sits|sat|yells|yelled|laughs|laughed|sighs|sighed|steps|stepped|points|pointed)\M','g'))[1]) as t
    from src
  ),
  ev_loc as (  -- E5: "at/inside/near/outside X" ≥2 -> setting
    select t from (select lower((regexp_matches(txt,
      '\m(at|inside|near|outside) ([A-Z][a-z]{2,})\M','g'))[2]) as t from src) q
    group by t having count(*) >= 2
  ),
  -- NEW structural signals:
  prose as (  -- capitalized MID-SENTENCE (preceded by a lowercase letter/comma) = used as a name in prose
    select t, count(*) as c from (
      select lower((regexp_matches(txt,'[a-z,] +([A-Z][a-z]{2,})\M','g'))[1]) as t from src
    ) q group by t
  ),
  fieldlbl as (  -- immediately followed by a colon = a form-field label, not an entity
    select t, count(*) as c from (
      select lower((regexp_matches(txt,'\m([A-Z][a-z]{2,}) *:','g'))[1]) as t from src
    ) q group by t
  ),
  flagged as (
    select c.tok, c.n, c.any_txt,
      (lower(c.tok) in (select word from common_words)) as is_common,
      exists(select 1 from entity_search es
             where es.workspace_id = p_workspace_id and lower(es.title) = lower(c.tok)) as has_title,
      (lower(c.tok) in (select t from ev_the))  as e_the,
      (lower(c.tok) in (select t from ev_org))  as e_org,
      (lower(c.tok) in (select t from ev_poss)) as e_poss,
      (lower(c.tok) in (select t from ev_verb)) as e_verb,
      (lower(c.tok) in (select t from ev_loc))  as e_loc,
      coalesce(pr.c, 0) as prose_mid,
      coalesce(fl.c, 0) as field_lbl
    from counted c
    left join prose pr on pr.t = lower(c.tok)
    left join fieldlbl fl on fl.t = lower(c.tok)
  )
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
    and lower(f.tok) <> all(stop)
    and not exists (select 1 from tags t where t.workspace_id = p_workspace_id and t.slug = lower(f.tok))
    and not exists (select 1 from entity_ignore_terms ig
                    where ig.workspace_id = p_workspace_id and lower(ig.term) = lower(f.tok) and ig.scope = 'workspace')
    -- NOT predominantly a form-field label ("Religion:", "Status:")
    and f.field_lbl < greatest(1, f.prose_mid)
    -- Positive proper-noun evidence required: strong patterns / existing entity
    -- (these override the common-word backstop), OR it reads as a name in prose.
    and (
         f.has_title or f.e_the or f.e_org or f.e_poss or f.e_verb or f.e_loc
      or (f.prose_mid >= 1 and not f.is_common)
    )
  order by f.n desc, f.tok
  limit greatest(1, p_limit);
end $function$;
