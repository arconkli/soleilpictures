// recipe.mjs — what a board holds, written by Claude to a subject's brief.
//
// A recipe is the /make board shape (lib/makeBoard.js reads it: sections, each
// a list of pictures, notes and palettes), plus `video` items and a note in a
// typewriter face (`font: 'script'`) for a script excerpt, plus the words for
// the board's own /c/ page should it ever be published. Photos are named by a
// search; photos.mjs finds real ones for them.
//
// validateRecipe is pure (recipe.test.mjs): every rule a board is held to
// before any photo is fetched. writeRecipe asks Claude, checks the answer, and
// asks once more with the problems when it falls short.

export const SECTION_NAMES = ['blue', 'clay', 'green', 'plum', 'teal', 'rose', 'moss', 'slate'];

export const RULES = Object.freeze({
  sections: [3, 6],
  pictures: [9, 20],
  notes: [3, 9],
  palettes: [1, 2],
  videos: [3, 6], // only when the brief wants video
  frames: 6, // the fewest captioned pictures a storyboard's frames section holds
  cards: [14, 40],
  swatches: [4, 6],
  sectionName: 28,
  noteTitle: 48,
  noteBody: 480,
  caption: 28, // one line over the picture (build.mjs fitCaption)
  // A section is a column on the board: four long notes in one makes a tower
  // beside short picture columns (the costume trial's "lopsided" grade), and a
  // pictures-only section of one or two looks like something went missing.
  sectionNotes: 3,
  sectionText: 1200, // characters of note titles + bodies in one section
  sectionPictures: 3, // the fewest in a section of pictures alone
  search: [2, 6], // words: a long search finds nothing (the costume trial's "dented steel thermos on boat deck")
  title: 70,
  story: 220,
  seoTitle: 60,
  seoDescription: [50, 155],
  seoBodyWords: 250,
});

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
// Paths the site owns: a board's /c/ slug can't be one (seedBoard.mjs's list).
const RESERVED = new Set(['c', 'explore', 'share', 'pricing', 'legal', 'api', 'assets', 'admin',
  'robots', 'sitemap', 'app', 'auth', 'login', 'signup', 'board', 'boards', 'favicon', '_headers',
  'tools', 'vs', 'use-cases', 'best', 'docs', 'templates']);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const words = (s) => str(s).split(/\s+/).filter(Boolean).length;

export const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'slug', 'story', 'sections', 'seo'],
  properties: {
    title: { type: 'string' },
    slug: { type: 'string' },
    story: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'color', 'items'],
        properties: {
          name: { type: 'string' },
          color: { type: 'string', enum: SECTION_NAMES },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind'],
              properties: {
                kind: { type: 'string', enum: ['picture', 'video', 'note', 'palette'] },
                search: { type: 'string' },
                caption: { type: 'string' },
                title: { type: 'string' },
                body: { type: 'string' },
                font: { type: 'string', enum: ['script'] },
                swatches: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'hex'],
                    properties: { name: { type: 'string' }, hex: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    seo: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'description', 'body', 'keyword'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        body: { type: 'string' },
        keyword: { type: 'string' },
      },
    },
  },
};

/**
 * Every problem with a recipe, in words Claude can act on; [] when it's good.
 *   brief: { wants?: ['video'|'script'|'frames'] }
 *   taken: slugs already used (the library's and the site's)
 */
export function validateRecipe(r, brief = {}, { taken = [] } = {}) {
  const p = [];
  const wants = new Set(brief.wants || []);
  const R = RULES;
  if (!r || typeof r !== 'object') return ['the answer is not a recipe'];

  const title = str(r.title);
  if (!title || title.length > R.title) p.push(`title must be 1–${R.title} characters`);
  const slug = str(r.slug);
  if (!SLUG_RE.test(slug) || slug.length > 60) p.push('slug must be lowercase words joined by hyphens, at most 60 characters');
  else if (RESERVED.has(slug)) p.push(`slug "${slug}" is a path the site owns`);
  else if (taken.includes(slug)) p.push(`slug "${slug}" is already taken`);
  const story = str(r.story);
  if (!story || story.length > R.story) p.push(`story must be one sentence of at most ${R.story} characters`);

  const sections = Array.isArray(r.sections) ? r.sections : [];
  if (sections.length < R.sections[0] || sections.length > R.sections[1]) {
    p.push(`a board has ${R.sections[0]}–${R.sections[1]} sections, not ${sections.length}`);
  }
  const names = new Set();
  const n = { picture: 0, video: 0, note: 0, palette: 0 };
  let script = 0;
  let frames = 0;
  const searches = new Set();
  sections.forEach((s, si) => {
    const name = str(s?.name);
    if (!name || name.length > R.sectionName) p.push(`section ${si + 1} needs a name of at most ${R.sectionName} characters`);
    if (names.has(name.toLowerCase())) p.push(`two sections are called "${name}"`);
    names.add(name.toLowerCase());
    if (!SECTION_NAMES.includes(s?.color)) p.push(`section "${name}" needs one of the colours ${SECTION_NAMES.join(', ')}`);
    const items = Array.isArray(s?.items) ? s.items : [];
    if (!items.length) p.push(`section "${name}" is empty`);
    let captioned = 0;
    for (const it of items) {
      if (!it || !(it.kind in n)) { p.push(`section "${name}" holds an item of no known kind`); continue; }
      n[it.kind] += 1;
      if (it.kind === 'picture' || it.kind === 'video') {
        const q = str(it.search);
        const w = words(q);
        if (w < R.search[0] || w > R.search[1]) p.push(`the search "${q}" must be ${R.search[0]}–${R.search[1]} words`);
        if (searches.has(q.toLowerCase())) p.push(`the search "${q}" is used twice; every photo needs its own search`);
        searches.add(q.toLowerCase());
        if (it.caption && str(it.caption).length > R.caption) p.push(`a caption in "${name}" is over ${R.caption} characters`);
        if (it.kind === 'picture' && str(it.caption)) captioned += 1;
        if (it.kind === 'video' && !wants.has('video')) p.push('this brief has no video; use pictures');
      } else if (it.kind === 'note') {
        const t = str(it.title);
        const b = str(it.body);
        if (!t && !b) p.push(`a note in "${name}" is empty`);
        if (t.length > R.noteTitle) p.push(`the note title "${t.slice(0, 30)}…" is over ${R.noteTitle} characters`);
        if (b.length > R.noteBody) p.push(`the note "${t || b.slice(0, 30)}" is over ${R.noteBody} characters`);
        if (it.font === 'script') script += 1;
      } else if (it.kind === 'palette') {
        const sw = Array.isArray(it.swatches) ? it.swatches : [];
        if (sw.length < R.swatches[0] || sw.length > R.swatches[1]) p.push(`a palette holds ${R.swatches[0]}–${R.swatches[1]} swatches`);
        if (sw.some((x) => !HEX_RE.test(str(x?.hex)) || !str(x?.name))) p.push('every swatch needs a name and a hex like "#1d3557"');
      }
    }
    frames = Math.max(frames, captioned);
    const notes = items.filter((it) => it?.kind === 'note');
    const text = notes.reduce((a, it) => a + str(it.title).length + str(it.body).length, 0);
    if (notes.length > R.sectionNotes) p.push(`section "${name}" holds ${notes.length} notes; at most ${R.sectionNotes} in one section, spread the rest beside the pictures they talk about`);
    else if (text > R.sectionText) p.push(`section "${name}" holds ${text} characters of notes; at most ${R.sectionText} in one section, shorten them or move one beside the pictures it talks about`);
    const pics = items.filter((it) => it?.kind === 'picture' || it?.kind === 'video').length;
    if (pics && pics === items.length && pics < R.sectionPictures) p.push(`section "${name}" is ${pics} picture${pics === 1 ? '' : 's'} alone; a section of pictures holds at least ${R.sectionPictures}`);
  });

  const between = (k, [lo, hi], what) => {
    if (n[k] < lo || n[k] > hi) p.push(`a board holds ${lo}–${hi} ${what}, not ${n[k]}`);
  };
  between('picture', R.pictures, 'pictures');
  between('note', R.notes, 'notes');
  between('palette', R.palettes, 'palettes');
  if (wants.has('video')) between('video', R.videos, 'videos');
  if (wants.has('script') && !script) p.push('this brief wants a script excerpt: a note with font "script" in screenplay form');
  if (wants.has('frames') && frames < R.frames) p.push(`this brief is a storyboard: one section of at least ${R.frames} captioned pictures, the frames in order`);
  const cards = n.picture + n.video + n.note + n.palette;
  if (cards < R.cards[0] || cards > R.cards[1]) p.push(`a board holds ${R.cards[0]}–${R.cards[1]} cards, not ${cards}`);

  const seo = r.seo || {};
  const st = str(seo.title);
  if (!st || st.length > R.seoTitle) p.push(`seo.title must be 1–${R.seoTitle} characters`);
  const sd = str(seo.description);
  if (sd.length < R.seoDescription[0] || sd.length > R.seoDescription[1]) {
    p.push(`seo.description must be ${R.seoDescription[0]}–${R.seoDescription[1]} characters, not ${sd.length}`);
  }
  if (words(seo.body) < R.seoBodyWords) p.push(`seo.body must be at least ${R.seoBodyWords} words, not ${words(seo.body)}`);
  const kw = str(seo.keyword).toLowerCase();
  if (!kw) p.push('seo.keyword is missing');
  else if (!`${st} ${str(seo.body)}`.toLowerCase().includes(kw)) p.push('seo.keyword must appear in seo.title or seo.body');
  return p;
}

export function recipePrompt(brief, { taken = [], redo = null } = {}) {
  const R = RULES;
  const wants = new Set(brief.wants || []);
  return [
    'You are making one board for Clusters, a canvas app where film crews and creative teams keep their',
    'reference: pictures, notes and colour palettes laid out in named sections. The board will be shown as an',
    'example of what a real working board looks like, so it must read as made by a working professional in the',
    'middle of a real project: specific, practical, beautiful. Never mention Clusters, AI or this brief on it.',
    '',
    `The brief: ${brief.brief}`,
    '',
    'Make:',
    `- title: the board's name as its maker would title it (at most ${R.title} characters), e.g. "Saltmarsh — Costume Board".`,
    '- slug: the title as lowercase-hyphenated words, at most 60 characters, naming the subject plainly.',
    `- story: one sentence (at most ${R.story} characters) on what the board is for, for our own library.`,
    `- sections: ${R.sections[0]}–${R.sections[1]}, each with a short working name (at most ${R.sectionName} characters, e.g.`,
    '  "Silhouettes", "Night exteriors", "Props + set dressing") and one of the colours given, no colour twice in a row.',
    `- pictures: ${R.pictures[0]}–${R.pictures[1]} in all. Most boards lead with one or two sections of pictures alone. Each picture`,
    `  is a stock photo search of ${R.search[0]}–${R.search[1]} plain words a photo site would match (subject, setting, light; e.g.`,
    '  "foggy harbour at dawn", "wool coat texture close up", "neon diner interior night"). No brand names, no famous',
    '  people, no logos, no illustrations, no text in the picture, no two searches alike. A caption only where the maker',
    `  would write one: a label of two to four words, at most ${R.caption} characters, shown on one line over the picture`,
    '  ("Relief boat landing", "Sc. 20 cottage").',
    '  The pictures must read as one world, as if from one shoot: settle the light, season and place first, and let',
    '  every search carry them where a photo site would use them ("overcast", "winter", "tungsten", "1970s"), so the',
    '  photos come back in one light. Prefer places, textures, objects and light over posed people. Photo sites match',
    '  short searches best: the subject first, then one or two words of light, season or place; a search that stacks',
    '  details ("dented steel thermos on boat deck overcast") finds nothing. Small objects (gloves, a hat, a flask) come',
    '  back as studio product shots, so show them in use or in place ("fisherman gloves fish crate") or leave them to a note.',
    '  Every picture must be a modern colour photograph a stock site holds today: never people in period dress, never',
    '  archival, sepia or black-and-white photos. Where the story is set in the past, show it through what still exists',
    '  (buildings, fabrics, tools, landscapes, light), so no search asks for something nobody photographs any more.',
    `- notes: ${R.notes[0]}–${R.notes[1]}, each a title and a short body in the maker's voice: concrete decisions, names, numbers,`,
    `  lists with "- ". At most ${R.noteBody} characters each. No marketing words, no emojis, no exclamation marks.`,
    `- palette: ${R.palettes[0]}–${R.palettes[1]}, each ${R.swatches[0]}–${R.swatches[1]} swatches named as the maker would ("Harbour fog") with hex colours taken`,
    '  from the look; put a palette in the section it belongs to.',
    ...(wants.has('video') ? [`- videos: ${R.videos[0]}–${R.videos[1]} video items (kind "video"), each a stock footage search, for motion references.`] : []),
    ...(wants.has('script') ? ['- a script excerpt: one note with font "script", the title the scene heading, the body a few lines of the scene in screenplay form.'] : []),
    ...(wants.has('frames') ? [`- frames: one section of ${R.frames}–12 pictures in shot order, every one captioned like "3 · CLOSE — brake lever".`] : []),
    `- In all, ${R.cards[0]}–${R.cards[1]} cards. Each section becomes one column on the board, so keep them even: at most`,
    `  ${R.sectionNotes} notes and ${R.sectionText} characters of notes in a section, a section of pictures alone holds at least`,
    `  ${R.sectionPictures}, and character or scene notes sit beside the pictures they talk about rather than stacked in one column.`,
    '- seo: the words for this board\'s own public page: title (at most 60 characters, the subject + what the board is),',
    `  description (${R.seoDescription[0]}–${R.seoDescription[1]} characters), keyword (the search phrase someone would type to find a board like`,
    `  this, e.g. "costume design mood board"), and body: at least ${R.seoBodyWords} words of plain paragraphs (no headings, no lists)`,
    '  walking through how this board was put together and why each section is there, useful to someone making their',
    '  own; the keyword in it once, naturally.',
    ...(taken.length ? ['', `Slugs already taken: ${taken.slice(-60).join(', ')}.`] : []),
    ...(redo ? ['', 'Your last recipe fell short. Fix every one of these and keep what was good:', ...redo.problems.map((x) => `- ${x}`), '', 'The last recipe:', JSON.stringify(redo.recipe)] : []),
  ].join('\n');
}

/**
 * Asks Claude for a recipe to `brief`; one more try with the problems when
 * the first falls short. → { recipe, problems } (problems [] when it passed).
 *   claude: claudeJson from ~/soleil-social/lib/claude.mjs
 */
export async function writeRecipe(brief, { claude, taken = [], log = () => {}, notes = null, last = null } = {}) {
  let redo = notes && last ? { problems: notes, recipe: last } : null;
  let recipe = null;
  let problems = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    recipe = await claude({
      prompt: recipePrompt(brief, { taken, redo }),
      schema: RECIPE_SCHEMA, model: 'opus', effort: 'medium', budgetUsd: 2, log,
    });
    problems = validateRecipe(recipe, brief, { taken });
    if (!problems.length) return { recipe, problems };
    log(`recipe: ${problems.length} problem(s): ${problems.slice(0, 4).join('; ')}`);
    redo = { problems, recipe };
  }
  return { recipe, problems };
}
