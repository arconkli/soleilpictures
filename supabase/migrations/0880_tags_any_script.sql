-- 0880 — Tags in any script (2026-11-09).
--
-- A tag matched text only where it sat between ASCII non-alphanumerics
-- (_tag_slug_word_re, 0044: '(^|[^a-z0-9])' || slug || '($|[^a-z0-9])'), so
-- every non-ASCII letter counted as a word break: "кино" was found inside
-- "кинотеатр", "sum" inside "résumé", "हिन" inside "हिन्दी". Tags of two
-- characters never spread (_tag_is_spreadable, 0152: three or more), which
-- left out most Chinese, Japanese and Korean names ("東京", "서울").
-- get_candidate_names (0176) only saw ASCII capitals ([A-Z][a-z]{2,}).
--
-- Word characters are now [[:alnum:]] (Unicode under the database's ICU
-- collation, en-US) plus the combining-mark blocks, so a Hindi or Thai word
-- stays one word. Edges of a slug:
--   * Han, Kana, Thai, Lao, Myanmar, Khmer (written without spaces): no
--     boundary needed on that side.
--   * Hangul: a boundary on the left, none on the right (particles attach:
--     "서울에서").
--   * anything else: the next character must not be a word character, or be
--     one of the scripts above (so "art" is found in "我喜欢art展").
--   * Arabic (3+ letters): one optional و/ف then one optional ب/ل/ك before
--     the slug ("بالقاهرة"). Hebrew (3+ letters): up to two of ו ב ה ל מ ש כ.
-- English text (ASCII) matches exactly as before: on live, 2026-11-09, the
-- old and new regex agreed on every (tag, card or page) pair.
--
-- _tag_is_spreadable also lets a slug of exactly two Han, Katakana or Hangul
-- characters spread. Hiragana-only pairs stay out (これ, それ, こと are
-- grammar, not names); one character never spreads.
--
-- get_candidate_names reads capitals in any cased script
-- ([[:upper:]][[:lower:]]{2,}, '[[:lower:],] +'). Scripts without case
-- (Chinese, Japanese, Korean, Arabic, Hebrew, Thai, Hindi) give no
-- candidates: capitalisation is the whole proper-noun signal here, and
-- without it every frequent word would qualify. guess_entity_type reads a
-- capital in any cased script the same way.
--
-- tags.name is NFC from now on (BEFORE trigger; the generated slug follows).
-- No existing row needs it (checked on live 2026-11-09).
--
-- These functions need the database's ICU collation: under a "C" collation
-- [[:alnum:]] and lower() are ASCII-only, and the proof below fails.
--
-- Ship: this migration, then the app (the app's matcher mirrors these rules
-- in lib/tagWordMatch.js; either order is safe).

begin;
set local lock_timeout = '3s';

-- ── _tag_slug_word_re ───────────────────────────────────────────────────────
-- Latest: 0044 (search_path set since). Callers, all security definer and
-- owned by postgres: autotag_on_card_index_change, autotag_on_doc_page_change,
-- autotag_on_group_index_change, autotag_on_board_rename,
-- autotag_on_tag_slug_change, backfill_tag_applications. Each does
-- lower(text) ~ _tag_slug_word_re(t.slug); none of them changes.
create or replace function public._tag_slug_word_re(slug text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  with k as (
    select lower(slug) as s,
           -- word characters: letters and digits, plus combining marks
           '[:alnum:]\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0900-\u0963\u0966-\u0DFF\u0E00-\u0EFF\u0F00-\u109F\u1780-\u17FF\u1AB0-\u1AFF\u1DC0-\u1DFF\u200C\u200D\u20D0-\u20FF\u3099\u309A\uFE00-\uFE0F\uFE20-\uFE2F'::text as w,
           -- scripts written without spaces: Thai, Lao, Myanmar, Khmer, Kana, Han
           '\u0E00-\u0EFF\u1000-\u109F\u1780-\u17FF\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F\U00020000-\U0003134F'::text as ns,
           -- Hangul
           '\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF'::text as hg
  )
  select case
           when left(k.s, 1) ~ ('[' || k.ns || ']') then ''
           when left(k.s, 1) ~ ('[' || k.hg || ']') then '(^|[^' || k.w || ']|[' || k.ns || '])'
           else '(^|[^' || k.w || ']|[' || k.ns || k.hg || '])'
         end
      || case
           when char_length(k.s) >= 3 and left(k.s, 1) ~ '[ؠ-ي]' then '[وف]?[بلك]?'
           when char_length(k.s) >= 3 and left(k.s, 1) ~ '[א-ת]' then '[ובהלמשכ]{0,2}'
           else ''
         end
      || regexp_replace(k.s, '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
      || case
           when right(k.s, 1) ~ ('[' || k.ns || k.hg || ']') then ''
           else '($|[^' || k.w || ']|[' || k.ns || k.hg || '])'
         end
    from k
$$;

revoke execute on function public._tag_slug_word_re(text) from public, anon, authenticated;
grant execute on function public._tag_slug_word_re(text) to service_role;

-- ── _tag_is_spreadable ──────────────────────────────────────────────────────
-- Latest: 0152. Same callers as above, plus _suggest_tags_for_card, whose own
-- filter (three ASCII letters or digits) still keeps non-Latin tags out of
-- vision suggestions, so it behaves exactly as before.
create or replace function public._tag_is_spreadable(p_slug text, p_status text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(p_status,'active') = 'active'
     and (char_length(coalesce(p_slug,'')) >= 3
          or coalesce(p_slug,'') ~ '^[\u30A1-\u30FA\u30FC\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F\U00020000-\U0003134F\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]{2}$')
     and lower(coalesce(p_slug,'')) <> all (array[
       'the','and','but','for','nor','yet','with','from','into','onto','upon','over','under','above','below',
       'about','after','before','between','through','during','without','within','against','among','across','behind','beside',
       'are','was','were','has','had','have','will','would','could','should','can','may','might','must','get','got','gets','see','saw','seen','let','put','set',
       'you','your','they','them','their','this','that','these','those','here','there','what','which','who','whom','whose','his','her','hers','our','ours','its','him','she',
       'not','now','all','any','some','one','two','more','most','very','only','each','same','than','then','when','while','also','just','like','well','back','down','even','much','many','such','both','out','off','for','per','via',
       'monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february','march','april','june','july','august','september','october','november','december',
       'note','notes','image','images','board','boards','doc','docs','tag','tags','card','cards','page','pages','item','items','new','old','draft','todo','done','misc','stuff','thing','things',
       'shot','scene','cut','int','ext','pov','fade','title','montage','close','wide','angle','est'
     ]::text[]);
$$;

revoke execute on function public._tag_is_spreadable(text, text) from public, anon, authenticated;
grant execute on function public._tag_is_spreadable(text, text) to service_role;

-- ── tags.name in NFC ────────────────────────────────────────────────────────
-- slug is generated (lower(name)) and is computed after BEFORE triggers, so it
-- follows.
create or replace function public._tags_name_nfc()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.name is not null and NEW.name is not nfc normalized then
    NEW.name := normalize(NEW.name, nfc);
  end if;
  return NEW;
end
$$;

revoke execute on function public._tags_name_nfc() from public, anon, authenticated;
grant execute on function public._tags_name_nfc() to service_role;

drop trigger if exists tags_name_nfc on public.tags;
create trigger tags_name_nfc
  before insert or update of name on public.tags
  for each row execute function public._tags_name_nfc();

-- ── guess_entity_type ───────────────────────────────────────────────────────
-- Latest: live definition (search_path public, extensions). Grants unchanged
-- (create or replace keeps them).
create or replace function public.guess_entity_type(p_name text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when coalesce(p_name, '') ~ '^[[:upper:]][[:alpha:]''\-]*$' then 'character'
    else 'concept'
  end;
$$;

-- ── get_candidate_names ─────────────────────────────────────────────────────
-- Latest: 0176. Only change: [A-Z][a-z]{2,} -> [[:upper:]][[:lower:]]{2,} and
-- [a-z,] -> [[:lower:],] in every pattern. Everything else is 0176's text.
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
  toks as (select (regexp_matches(s.txt, '\m([[:upper:]][[:lower:]]{2,})\M', 'g'))[1] as tok, s.txt from src s),
  counted as (select tok, count(*) as n, (array_agg(txt order by length(txt)))[1] as any_txt from toks group by tok),
  -- Multi-word phrase stream: maximal runs of ≥2 consecutive Title-Case words.
  phrase_toks as (
    select (regexp_matches(s.txt, '\m([[:upper:]][[:lower:]]{2,}( [[:upper:]][[:lower:]]{2,})+)\M', 'g'))[1] as tok, s.txt from src s
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
      select (regexp_matches(txt,'[[:lower:],] +([[:upper:]][[:lower:]]{2,}( [[:upper:]][[:lower:]]{2,})+)\M','g'))[1] as t from src
    ) q group by lower(t)
  ),
  -- Phrase immediately followed by a colon = a form-field label
  -- ("Favorite Food:", "Relationship Status:"), not an entity.
  phrase_lbl as (
    select lower(t) as tok, count(*) as c from (
      select (regexp_matches(txt,'\m([[:upper:]][[:lower:]]{2,}( [[:upper:]][[:lower:]]{2,})+) *:','g'))[1] as t from src
    ) q group by lower(t)
  ),
  ev_the as (select t from (select lower((regexp_matches(txt,'\mthe ([[:upper:]][[:lower:]]{2,})\M','g'))[1]) as t from src) q group by t having count(*) >= 2),
  ev_org as (select distinct lower((regexp_matches(txt,'\m([[:upper:]][[:lower:]]{2,})[ ]+(goons|gang|gangs|army|armies|crew|crews|family|families|cartel|order|cult|clan|clans|members|member|soldiers|forces|empire|tribe|tribes|syndicate|squad|band|mafia|brotherhood|faction)\M','g'))[1]) as t from src),
  ev_poss as (select distinct lower((regexp_matches(txt,'\m([[:upper:]][[:lower:]]{2,})[' || chr(39) || chr(8217) || ']s\M','g'))[1]) as t from src),
  ev_verb as (select distinct lower((regexp_matches(txt,'\m([[:upper:]][[:lower:]]{2,})[ ]+(said|says|asked|asks|walks|walked|runs|ran|grabs|grabbed|turns|turned|nods|nodded|smiles|smiled|shouts|shouted|screams|screamed|whispers|whispered|replies|replied|looks|looked|stares|stared|stands|stood|sits|sat|yells|yelled|laughs|laughed|sighs|sighed|steps|stepped|points|pointed)\M','g'))[1]) as t from src),
  ev_loc as (select t from (select lower((regexp_matches(txt,'\m(at|inside|near|outside) ([[:upper:]][[:lower:]]{2,})\M','g'))[2]) as t from src) q group by t having count(*) >= 2),
  prose as (select t, count(*) as c from (select lower((regexp_matches(txt,'[[:lower:],] +([[:upper:]][[:lower:]]{2,})\M','g'))[1]) as t from src) q group by t),
  fieldlbl as (select t, count(*) as c from (select lower((regexp_matches(txt,'\m([[:upper:]][[:lower:]]{2,}) *:','g'))[1]) as t from src) q group by t),
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
  -- or an existing entity title) and drop form-field labels.
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

revoke execute on function public.get_candidate_names(uuid, integer, integer) from public, anon;
grant execute on function public.get_candidate_names(uuid, integer, integer) to authenticated, service_role;

-- ── proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  r record;
  got boolean;
begin
  -- Grants (the 0311 habit: a REVOKE reporting success proves nothing).
  if has_function_privilege('public', 'public._tag_slug_word_re(text)', 'execute')
     or has_function_privilege('anon', 'public._tag_slug_word_re(text)', 'execute')
     or has_function_privilege('authenticated', 'public._tag_slug_word_re(text)', 'execute')
     or not has_function_privilege('service_role', 'public._tag_slug_word_re(text)', 'execute') then
    raise exception '0880: _tag_slug_word_re grants are wrong';
  end if;
  if has_function_privilege('public', 'public._tag_is_spreadable(text, text)', 'execute')
     or has_function_privilege('anon', 'public._tag_is_spreadable(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public._tag_is_spreadable(text, text)', 'execute')
     or not has_function_privilege('service_role', 'public._tag_is_spreadable(text, text)', 'execute') then
    raise exception '0880: _tag_is_spreadable grants are wrong';
  end if;
  if has_function_privilege('public', 'public._tags_name_nfc()', 'execute')
     or has_function_privilege('anon', 'public._tags_name_nfc()', 'execute')
     or has_function_privilege('authenticated', 'public._tags_name_nfc()', 'execute') then
    raise exception '0880: _tags_name_nfc grants are wrong';
  end if;
  if has_function_privilege('public', 'public.get_candidate_names(uuid, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.get_candidate_names(uuid, integer, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_candidate_names(uuid, integer, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.get_candidate_names(uuid, integer, integer)', 'execute') then
    raise exception '0880: get_candidate_names grants are wrong';
  end if;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.tags'::regclass and tgname = 'tags_name_nfc' and tgenabled = 'O') then
    raise exception '0880: trigger tags_name_nfc is missing';
  end if;

  -- The word regex, fixture by fixture.
  for r in select * from (values
    ('art',      'smart art.',              true),
    ('art',      'darts',                   false),
    ('art',      'smart',                   false),
    ('rough cut','a rough cut.',            true),
    ('c++',      'we use c++ daily',        true),
    ('sum',      'résumé',                  false),
    ('art',      '我喜欢art展',              true),
    ('서울',     '서울에서 영화를 찍었다',    true),
    ('서울',     '경서울',                   false),
    ('영화',     '영화를 찍었습니다',         true),
    ('東京',     '東京駅で映画を撮影',        true),
    ('カメラ',   '新しいカメラはARRI',        true),
    ('电影',     '我们在北京拍摄电影，导演',   true),
    ('кино',     'Хорошее кино!',           true),
    ('кино',     'кинотеатр',               false),
    ('القاهرة',  'صورنا في القاهرة.',         true),
    ('القاهرة',  'بالقاهرة',                 true),
    ('القاهرة',  'مالقاهرة',                 false),
    ('ירושלים',  'צילמנו בירושלים',           true),
    ('हिन',      'हिन्दी',                    false),
    ('हिन्दी',    'हिन्दी फ़िल्म',               true),
    ('ภาพยนตร์', 'ถ่ายทำภาพยนตร์ที่กรุงเทพ',     true)
  ) v(slug, txt, expected)
  loop
    got := lower(r.txt) ~ public._tag_slug_word_re(r.slug);
    if got is distinct from r.expected then
      raise exception '0880: _tag_slug_word_re(%) on % gave %, expected %', r.slug, r.txt, got, r.expected;
    end if;
  end loop;

  -- English unchanged: on ASCII text the new regex answers as 0044's did.
  for r in select * from (values
    ('art', 'smart art.'), ('art', 'darts'), ('art', 'Art_Dept'), ('art', 'art-house'),
    ('rough cut', 'a rough cut.'), ('c++', 'we use c++ daily'), ('q&a', 'the q&a went well'),
    ('4k', 'shot in 4k.'), ('pov', 'pov shot')
  ) v(slug, txt)
  loop
    if (lower(r.txt) ~ public._tag_slug_word_re(r.slug))
       is distinct from
       (lower(r.txt) ~ ('(^|[^a-z0-9])' || regexp_replace(lower(r.slug), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '($|[^a-z0-9])')) then
      raise exception '0880: English changed for % on %', r.slug, r.txt;
    end if;
  end loop;

  -- Which tags spread.
  for r in select * from (values
    ('東京', 'active', true), ('서울', 'active', true), ('カメラ', 'active', true),
    ('これ', 'active', false), ('猫', 'active', false), ('ab', 'active', false),
    ('the', 'active', false), ('art', 'active', true), ('кино', 'active', true),
    ('東京', 'deleted', false)
  ) v(slug, status, expected)
  loop
    if public._tag_is_spreadable(r.slug, r.status) is distinct from r.expected then
      raise exception '0880: _tag_is_spreadable(%, %) is not %', r.slug, r.status, r.expected;
    end if;
  end loop;

  -- Candidate patterns (copied from get_candidate_names) under this database's collation.
  if (regexp_match('we met Anna there', '[[:lower:],] +([[:upper:]][[:lower:]]{2,})\M'))[1] is distinct from 'Anna'
     or (regexp_match('Мы были в Москве, потом', '[[:lower:],] +([[:upper:]][[:lower:]]{2,})\M'))[1] is distinct from 'Москве'
     or '서울에서 영화를 찍었다' ~ '\m([[:upper:]][[:lower:]]{2,})\M'
     or '東京駅で映画を撮影' ~ '\m([[:upper:]][[:lower:]]{2,})\M'
     or 'صورنا في القاهرة' ~ '\m([[:upper:]][[:lower:]]{2,})\M' then
    raise exception '0880: candidate patterns do not behave (is the collation ICU?)';
  end if;
  if public.guess_entity_type('Lumon') <> 'character' or public.guess_entity_type('Анна') <> 'character'
     or public.guess_entity_type('Lost Time') <> 'concept' or public.guess_entity_type('東京') <> 'concept' then
    raise exception '0880: guess_entity_type does not behave';
  end if;
end
$proof$;

commit;
