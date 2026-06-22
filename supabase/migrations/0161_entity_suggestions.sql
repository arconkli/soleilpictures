-- 0161 — Smarter entity suggestions (deterministic evidence rules).
--
-- get_candidate_names used to surface ANY recurring capitalized word, so it
-- suggested junk ("Red", "Age", "Eyes", "Light", profile-field labels like
-- "Relationship"/"Status") and had no notion of type. This rewrites it around
-- deterministic "entity evidence":
--
--   A capitalized token is a REAL entity iff it has evidence —
--     E1 possessive    "Astrid's …"          -> character
--     E2 "the X" (≥2)  "the Mob", "the Order" -> organization
--     E3 org-noun       "Mob goons", "X gang"  -> organization
--     E4 verb subject   "Onyx said …"          -> character
--     E5 locative (≥2)  "at Backrooms"         -> setting
--     E6 NOT a common English word (recurs ≥2) -> character (a real name)
--     E7 already an entity here (card/board/group/palette/doc title)
--   Otherwise it's dropped (a common word with no proper-noun usage:
--   Red/Age/Eyes/Light/Gold/Relationship/…).
--
-- common_words is the curated generic-word dictionary E6 keys on — it
-- deliberately EXCLUDES anything name-like (no "miller"/"chuck"/"onyx"), since
-- a raw frequency dictionary would wrongly drop real characters. Common words
-- are only kept when they ALSO show evidence (so "Mob"/"Church" stay).
--
-- Also adds the 'organization' entity_type and returns a type guess so a
-- promoted candidate lands pre-typed.

-- ── 1. Organization entity type ──────────────────────────────────────────
alter table tags drop constraint if exists tags_entity_type_check;
alter table tags add constraint tags_entity_type_check
  check (entity_type is null or entity_type = any (array[
    'character','setting','concept','thing','organization'
  ]));

create or replace function public.set_tag_entity_type(p_tag_id uuid, p_entity_type text)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare ws uuid;
begin
  if p_entity_type is not null
     and p_entity_type <> all (array['character','setting','concept','thing','organization']) then
    raise exception 'invalid entity_type: %', p_entity_type;
  end if;
  select workspace_id into ws from tags where id = p_tag_id;
  if ws is null then raise exception 'tag not found'; end if;
  if not is_workspace_member(ws) then
    raise exception 'not authorized';
  end if;
  update tags set entity_type = p_entity_type where id = p_tag_id;
end;
$function$;

-- ── 2. common_words: curated generic English dictionary (E6) ─────────────
create table if not exists public.common_words (word text primary key);
alter table public.common_words enable row level security;
drop policy if exists "common_words read" on public.common_words;
create policy "common_words read" on public.common_words for select using (true);

insert into public.common_words (word) values
('abandon'),('abandoned'),('abandons'),('abilities'),('ability'),('acid'),('act'),('acts'),('actually'),('afraid'),('afternoon'),('age'),('ages'),('agnostic'),('alive'),('alley'),('allowed'),('allows'),('almost'),('altar'),('although'),('always'),('ambitious'),('anger'),('angry'),('ankle'),('another'),('anxiety'),('anxious'),('appearance'),('appeared'),('appears'),('applied'),('apply'),('apr'),('area'),('arm'),('armor'),('arms'),('army'),('arrives'),('arriving'),('arrow'),('ash'),('ashes'),('asking'),('asks'),('atheist'),('attack'),('attacked'),('attractive'),('aug'),('aunt'),('autism'),('avoids'),('axe'),('baby'),('background'),('backstory'),('barely'),('bark'),('barrel'),('basically'),('basket'),('battle'),('beach'),('beard'),('beast'),('beautiful'),('became'),('become'),('becomes'),('becoming'),('begins'),('beige'),('believed'),('believes'),('belly'),('bench'),('betray'),('betrayed'),('bio'),('biography'),('bipolar'),('birth'),('birthdate'),('birthday'),('bisexual'),('blade'),('blame'),('blamed'),('blames'),('blessing'),('blue'),('body'),('bold'),('bomb'),('bone'),('bones'),('boot'),('boots'),('border'),('bored'),('born'),('boss'),('bottom'),('boy'),('boys'),('brain'),('branch'),('brass'),('brave'),('breath'),('breeze'),('brick'),('bridge'),('briefly'),('bright'),('bronze'),('brother'),('brow'),('brown'),('bucket'),('buddhist'),('build'),('building'),('bulb'),('bullet'),('bullets'),('bush'),('business'),('button'),('cabinet'),('cable'),('cage'),('called'),('calling'),('calls'),('calm'),('camera'),('candle'),('canyon'),('capital'),('cardboard'),('castle'),('catch'),('categories'),('category'),('catholic'),('caught'),('cave'),('ceiling'),('cell'),('cement'),('center'),('century'),('certain'),('certainly'),('chain'),('chains'),('chair'),('chance'),('changes'),('changing'),('chaos'),('chapter'),('chapters'),('character'),('characters'),('chase'),('chased'),('cheek'),('cheeks'),('chest'),('child'),('children'),('chin'),('chunk'),('citizen'),('claims'),('clay'),('clean'),('clearly'),('clever'),('cliff'),('cliffs'),('clock'),('closet'),('cloth'),('cloud'),('clouds'),('coat'),('coin'),('coins'),('color'),('colors'),('coming'),('concept'),('concepts'),('concrete'),('confident'),('conflict'),('confused'),('constantly'),('continued'),('continues'),('cop'),('copper'),('cops'),('corner'),('corners'),('corridor'),('cotton'),('couch'),('country'),('county'),('course'),('cousin'),('coward'),('cowardly'),('crack'),('cracks'),('crate'),('crazy'),('creative'),('creature'),('creek'),('crew'),('crews'),('cried'),('crime'),('criminology'),('crimson'),('crowd'),('crowds'),('crown'),('cruel'),('cry'),('crying'),('cure'),('curious'),('currently'),('curse'),('cyan'),('dagger'),('dance'),('dark'),('darkness'),('date'),('dates'),('dating'),('daughter'),('dead'),('deal'),('death'),('dec'),('decade'),('decided'),('decides'),('deeply'),('defend'),('demon'),('depend'),('depending'),('depends'),('depressed'),('depressing'),('depression'),('depth'),('describes'),('description'),('desert'),('desk'),('despair'),('despite'),('detail'),('details'),('development'),('devil'),('die'),('died'),('different'),('differently'),('direction'),('dirt'),('dirty'),('disappointed'),('disappointing'),('disease'),('dislike'),('dislikes'),('disorder'),('distance'),('distant'),('district'),('divorced'),('doctor'),('doubt'),('draft'),('drafts'),('drawer'),('dread'),('dream'),('dreams'),('dress'),('drill'),('drug'),('drugs'),('drunk'),('dumb'),('dusk'),('dust'),('dying'),('ear'),('ears'),('earth'),('echo'),('edge'),('edges'),('either'),('elbow'),('ended'),('energy'),('engaged'),('engine'),('enjoys'),('entering'),('enters'),('episode'),('episodes'),('era'),('escape'),('escaped'),('especially'),('essentially'),('ethnicity'),('evening'),('eventually'),('every'),('excited'),('explains'),('eye'),('eyelid'),('eyes'),('fabric'),('fact'),('facts'),('fails'),('failure'),('failures'),('fairly'),('falsely'),('farm'),('fate'),('father'),('fear'),('feared'),('fears'),('feb'),('feeling'),('feelings'),('feels'),('felt'),('fence'),('field'),('fields'),('fight'),('fighting'),('finally'),('find'),('finger'),('fingers'),('flame'),('flames'),('flesh'),('flower'),('flowers'),('foam'),('fog'),('folk'),('fool'),('foolish'),('force'),('forehead'),('forest'),('form'),('fortune'),('fought'),('found'),('frame'),('freedom'),('frequently'),('front'),('frost'),('fruit'),('fruits'),('frustrated'),('frustrating'),('fuel'),('fully'),('funny'),('furious'),('fury'),('future'),('gale'),('game'),('games'),('gang'),('gangs'),('garden'),('gate'),('gates'),('gay'),('gender'),('general'),('generally'),('gentle'),('getting'),('ghost'),('glad'),('glass'),('glove'),('gloves'),('goal'),('goals'),('going'),('gold'),('golden'),('gov'),('government'),('gradually'),('granite'),('grass'),('gravel'),('gray'),('grease'),('greatly'),('greedy'),('green'),('grenade'),('grey'),('grief'),('group'),('growing'),('grows'),('growth'),('guard'),('guards'),('gut'),('hair'),('half'),('hall'),('hallway'),('hammer'),('handsome'),('happening'),('happens'),('happy'),('harsh'),('hate'),('hated'),('hates'),('haze'),('health'),('healthy'),('heard'),('hearing'),('hears'),('heart'),('heel'),('height'),('heights'),('helmet'),('helping'),('helps'),('heterosexual'),('hide'),('high'),('highly'),('hill'),('hills'),('hindu'),('hip'),('hips'),('history'),('hobbies'),('hobby'),('holding'),('holds'),('hole'),('holes'),('home'),('homosexual'),('honest'),('honestly'),('hope'),('hoped'),('hopes'),('hour'),('hours'),('house'),('however'),('hunger'),('hungry'),('hurt'),('husband'),('ice'),('idea'),('ideas'),('immediately'),('includes'),('including'),('indicates'),('indigo'),('info'),('information'),('instant'),('instead'),('involved'),('involves'),('iron'),('island'),('jacket'),('jan'),('jaw'),('jealous'),('jewel'),('jewels'),('jewish'),('job'),('journey'),('jul'),('jun'),('jungle'),('justice'),('keeping'),('keeps'),('kill'),('killed'),('killer'),('killing'),('kind'),('kinds'),('king'),('kiss'),('kissed'),('kissing'),('knee'),('knees'),('knowing'),('known'),('knows'),('ladder'),('lady'),('lake'),('lamp'),('land'),('lands'),('lantern'),('laugh'),('lavender'),('law'),('layer'),('lazy'),('lead'),('leader'),('leaf'),('leather'),('leaves'),('leaving'),('length'),('lesbian'),('letter'),('level'),('lever'),('liar'),('lie'),('lies'),('light'),('lightning'),('like'),('liked'),('likely'),('likes'),('limb'),('limbs'),('line'),('lines'),('lip'),('lips'),('list'),('lists'),('literally'),('live'),('lived'),('living'),('location'),('lock'),('lonely'),('look'),('looking'),('looks'),('lose'),('losing'),('love'),('loved'),('loves'),('loyal'),('luck'),('lung'),('lungs'),('lying'),('machine'),('mad'),('magenta'),('magic'),('mainly'),('making'),('manic'),('map'),('mar'),('marble'),('maroon'),('married'),('marsh'),('mask'),('master'),('maybe'),('meadow'),('means'),('meant'),('medicine'),('meet'),('meets'),('memories'),('memory'),('merely'),('met'),('metal'),('middle'),('midnight'),('mind'),('minute'),('minutes'),('mirror'),('mist'),('mob'),('mobs'),('moment'),('moments'),('monk'),('monster'),('month'),('months'),('mood'),('moodboard'),('moodboards'),('mostly'),('mother'),('motivation'),('motivations'),('motor'),('mountain'),('mouth'),('moves'),('moving'),('mud'),('muscle'),('muscles'),('muslim'),('nail'),('nation'),('nationality'),('navy'),('nearly'),('neck'),('necklace'),('need'),('needed'),('needs'),('neighbor'),('neither'),('nerve'),('nerves'),('nervous'),('never'),('nightmare'),('noise'),('noon'),('normally'),('nose'),('nov'),('nun'),('nurse'),('obviously'),('occasionally'),('occupation'),('ocean'),('oct'),('office'),('officer'),('offices'),('often'),('oil'),('once'),('orange'),('org'),('organization'),('organizations'),('orgs'),('origin'),('originally'),('origins'),('otherwise'),('overview'),('page'),('pages'),('pain'),('palace'),('pale'),('palm'),('panic'),('pants'),('paper'),('parent'),('parents'),('park'),('part'),('particular'),('particularly'),('partly'),('parts'),('past'),('path'),('pattern'),('peace'),('peak'),('perhaps'),('person'),('personality'),('petal'),('photo'),('picture'),('piece'),('pieces'),('pink'),('pistol'),('place'),('places'),('plan'),('plans'),('plastic'),('playing'),('plays'),('pleasure'),('plot'),('pocket'),('point'),('points'),('poison'),('police'),('polite'),('pond'),('pool'),('poor'),('pop'),('position'),('poster'),('poverty'),('powder'),('power'),('powers'),('prayer'),('prefers'),('present'),('pretty'),('previously'),('priest'),('prince'),('prison'),('probably'),('profession'),('profile'),('protect'),('protestant'),('proud'),('pull'),('pulled'),('pulling'),('pulls'),('purple'),('purse'),('push'),('pushed'),('pushes'),('pushing'),('queen'),('quite'),('quote'),('quotes'),('race'),('radio'),('rage'),('rain'),('rarely'),('rather'),('realizes'),('realm'),('rear'),('recently'),('red'),('refuses'),('region'),('regret'),('regrets'),('regretted'),('regretting'),('relationship'),('relationships'),('religion'),('religious'),('remained'),('remains'),('represents'),('required'),('requires'),('rest'),('returning'),('returns'),('reveals'),('rich'),('ridge'),('rifle'),('ring'),('rings'),('river'),('road'),('roads'),('rock'),('role'),('roles'),('roof'),('root'),('roots'),('rope'),('route'),('rubber'),('rude'),('rule'),('rules'),('running'),('rust'),('sack'),('sad'),('salt'),('sand'),('save'),('saved'),('saves'),('saying'),('scar'),('scared'),('scars'),('scream'),('sea'),('season'),('second'),('seconds'),('secret'),('secrets'),('section'),('sections'),('seed'),('seeing'),('seek'),('seeking'),('seeks'),('seemed'),('seems'),('seldom'),('selfish'),('sep'),('sept'),('serious'),('servant'),('setting'),('settings'),('several'),('sex'),('sexuality'),('shade'),('shadow'),('shadows'),('shape'),('shapes'),('shelf'),('shield'),('shirt'),('shock'),('shoe'),('shoes'),('shore'),('shoulder'),('shoulders'),('shows'),('shrine'),('shrub'),('shy'),('sick'),('sickness'),('sidewalk'),('sigh'),('sight'),('silence'),('silk'),('silly'),('silver'),('similar'),('similarly'),('simply'),('single'),('sister'),('sitting'),('size'),('skill'),('skilled'),('skills'),('skin'),('skull'),('slave'),('sleep'),('slice'),('slightly'),('smart'),('smell'),('smile'),('smoke'),('snake'),('snakes'),('snow'),('sober'),('sofa'),('soil'),('soldier'),('soldiers'),('sometimes'),('somewhat'),('son'),('song'),('songs'),('soon'),('soot'),('sorrow'),('soul'),('sound'),('sounds'),('space'),('spaces'),('spark'),('sparks'),('speaking'),('spear'),('specific'),('spell'),('spine'),('spirit'),('spoke'),('spot'),('squad'),('stage'),('staircase'),('stairs'),('standing'),('started'),('starting'),('starts'),('state'),('statue'),('status'),('steel'),('step'),('steps'),('stomach'),('stone'),('stool'),('stopped'),('stopping'),('stops'),('stories'),('storm'),('story'),('straight'),('strange'),('stranger'),('stream'),('strength'),('strengths'),('student'),('studied'),('studies'),('study'),('studying'),('stupid'),('style'),('succeeds'),('sugar'),('suggests'),('suicidal'),('suicide'),('summary'),('sunrise'),('sunset'),('surface'),('swamp'),('sweat'),('switch'),('table'),('take'),('taken'),('takes'),('taking'),('talked'),('talking'),('talks'),('tan'),('taste'),('teacher'),('teal'),('team'),('tear'),('tears'),('teeth'),('telling'),('temple'),('tends'),('territory'),('terror'),('theme'),('themes'),('thief'),('thinking'),('thinks'),('thirst'),('thorn'),('though'),('thought'),('thoughts'),('threw'),('throat'),('throw'),('thumb'),('thunder'),('tide'),('tight'),('timber'),('tin'),('tired'),('today'),('toe'),('toes'),('tomorrow'),('tone'),('tongue'),('tooth'),('top'),('topic'),('topics'),('torch'),('touch'),('tower'),('town'),('track'),('trade'),('trail'),('trait'),('traits'),('trauma'),('travel'),('treasure'),('tree'),('trees'),('tried'),('tries'),('trip'),('troop'),('troops'),('trust'),('truth'),('trying'),('tunnel'),('turquoise'),('twice'),('twilight'),('type'),('types'),('typically'),('ugly'),('uncle'),('understands'),('universe'),('unlike'),('unlikely'),('upset'),('used'),('uses'),('using'),('usually'),('valley'),('various'),('vein'),('veins'),('version'),('versions'),('vibe'),('victim'),('village'),('villain'),('vine'),('vines'),('voice'),('voices'),('waist'),('waiting'),('walking'),('wallet'),('want'),('wanted'),('wanting'),('wants'),('war'),('wars'),('watched'),('watches'),('watching'),('wave'),('waves'),('weakness'),('weaknesses'),('wealth'),('weapon'),('weapons'),('wear'),('wearing'),('wears'),('weed'),('weeds'),('week'),('weekend'),('weeks'),('weight'),('weird'),('whatever'),('wheel'),('wheels'),('whenever'),('wherever'),('whether'),('whisper'),('widowed'),('width'),('wife'),('wild'),('wilderness'),('win'),('wind'),('window'),('windows'),('wire'),('wise'),('witch'),('wizard'),('won'),('wood'),('woods'),('wool'),('word'),('words'),('worker'),('working'),('works'),('world'),('worlds'),('worn'),('wound'),('wrist'),('yard'),('year'),('years'),('yellow'),('yesterday'),('zone')
on conflict (word) do nothing;

-- ── 3. Smart get_candidate_names ─────────────────────────────────────────
drop function if exists public.get_candidate_names(uuid, integer, integer);
create function public.get_candidate_names(p_workspace_id uuid, p_min_count integer default 2, p_limit integer default 60)
returns table(name text, n bigint, sample text, entity_type text)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  -- unconditional screenplay/structural stoplist (always dropped)
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
  ev_loc as (  -- E5: "at/inside/near/outside X" ≥2 -> setting (strong locatives only)
    select t from (select lower((regexp_matches(txt,
      '\m(at|inside|near|outside) ([A-Z][a-z]{2,})\M','g'))[2]) as t from src) q
    group by t having count(*) >= 2
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
      (lower(c.tok) in (select t from ev_loc))  as e_loc
    from counted c
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
    -- KEEP: not a common word, OR it shows proper-noun evidence / is an entity
    and ((not f.is_common) or f.has_title or f.e_the or f.e_org or f.e_poss or f.e_verb or f.e_loc)
  order by f.n desc, f.tok
  limit greatest(1, p_limit);
end $function$;

grant execute on function public.get_candidate_names(uuid, integer, integer) to authenticated;
