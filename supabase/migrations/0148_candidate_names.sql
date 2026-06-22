-- 0148: Deterministic "candidate names" detection for the tags rework.
--
-- Powers the in-context character/setting discovery: recurring capitalized
-- proper nouns in a workspace's docs/cards (e.g. "Enoch", "Astrid") that
-- aren't already tags get a soft dotted underline in docs; one tap promotes
-- them to a real tag. No AI — pure word-frequency + a stoplist + the user's
-- one-tap confirm/dismiss (dismiss = entity_ignore_terms tombstone).
--
-- Also adds tags.entity_type so a promoted tag can be typed 'character' /
-- 'setting' / 'concept' (tags.kind keeps its user/auto/ai CHECK — entity_type
-- is the orthogonal "what kind of thing" axis).

alter table public.tags
  add column if not exists entity_type text
    check (entity_type is null or entity_type in ('character','setting','concept','thing'));

comment on column public.tags.entity_type is
  'Optional semantic type for a tag (character/setting/concept/thing). Distinct from kind (provenance: user/auto/ai).';

-- get_candidate_names(workspace): recurring capitalized proper nouns not yet
-- tagged and not dismissed. Returns the term, its occurrence count, and a short
-- sample of surrounding text for the in-context popover.
create or replace function public.get_candidate_names(
  p_workspace_id uuid,
  p_min_count integer default 2,
  p_limit integer default 60
)
returns table(name text, n bigint, sample text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  stop text[] := array[
    -- pronouns / determiners / conjunctions / prepositions
    'the','and','but','for','with','from','into','this','that','then','there','here',
    'they','them','their','your','you','his','her','she','him','our','out','one','two',
    'all','now','not','some','any','what','who','how','why','was','were','are','has','had',
    'have','get','got','see','can','will','would','could','should','its','off','put','let',
    'over','more','very','only','each','same','than','when','while','after','before','about',
    'because','around','through','against','between','behind','below','above','under','also',
    'just','like','well','back','down','up','onto','upon','as','at','by','in','of','on','to',
    'an','or','if','it','is','be','do','we','he','my','me','us','so','no','yes',
    -- screenplay / production artifacts + common scene words
    'cut','close','shot','scene','int','ext','est','black','white','pan','zoom','fade',
    'open','smash','slam','cont','contd','vhs','pov','title','card','montage','edit','music',
    'wide','wideshot','closeup','intercut','aerial','establishing','retro','split','screen',
    'main','final','first','second','third','last','next','still','suddenly','meanwhile',
    'inside','outside','later','months','weeks','days','beat','quick','slow','loud','everyone',
    'everything','someone','something','anyone','nobody','people','guy','guys','girl','girls',
    'man','men','woman','women','kid','room','rooms','door','doors','side','time','day','night',
    'morning','city','street','streets','wall','walls','floor','ground','blood','face','faces',
    'head','hand','hands','gun','guns','knife','fire','water','door','god','lord',
    -- months / days (commonly capitalized)
    'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
    'january','february','march','april','june','july','august','september','october',
    'november','december',
    -- card-type / app words
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
    union all
    select ci.title from card_index ci
      where ci.workspace_id = p_workspace_id and ci.title is not null
    union all
    select dp.page_text from doc_page_index dp
      where dp.workspace_id = p_workspace_id and dp.page_text is not null
    union all
    select dp.page_title from doc_page_index dp
      where dp.workspace_id = p_workspace_id and dp.page_title is not null
  ),
  toks as (
    select (regexp_matches(s.txt, '\m([A-Z][a-z]{2,})\M', 'g'))[1] as tok, s.txt
    from src s
  ),
  counted as (
    select tok, count(*) as n, (array_agg(txt order by length(txt)))[1] as any_txt
    from toks
    group by tok
  )
  select c.tok as name, c.n,
         -- a short snippet around the first occurrence, for the popover
         left(
           regexp_replace(
             substr(c.any_txt, greatest(1, position(c.tok in c.any_txt) - 24), 80),
             '\s+', ' ', 'g'
           ), 80
         ) as sample
  from counted c
  where c.n >= greatest(2, p_min_count)
    and lower(c.tok) <> all(stop)
    -- not already a tag in this workspace
    and not exists (
      select 1 from tags t
      where t.workspace_id = p_workspace_id and t.slug = lower(c.tok)
    )
    -- not dismissed (workspace-scoped ignore)
    and not exists (
      select 1 from entity_ignore_terms ig
      where ig.workspace_id = p_workspace_id
        and lower(ig.term) = lower(c.tok)
        and ig.scope = 'workspace'
    )
  order by c.n desc, c.tok
  limit greatest(1, p_limit);
end $function$;

grant execute on function public.get_candidate_names(uuid, integer, integer) to authenticated;
