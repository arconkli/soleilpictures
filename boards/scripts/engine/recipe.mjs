// recipe.mjs — what a board holds, written by Claude to a subject's brief.
//
// A recipe is the /make board shape (lib/makeBoard.js reads it: sections, each
// a list of pictures, notes and palettes), plus the rest of the canvas's tools:
// `video` items, a `script` (a scene in Fountain, which build.mjs makes a real
// screenplay doc: the app's own script card, as a dropped .fountain file
// becomes one), tables, checklists, docs, reference links, photo-grid sections
// and arrows between cards, plus the words for the board's own /c/ page should
// it ever be published. Photos are named by a search; photos.mjs finds real
// ones for them. Each board is written to a style (styles.mjs: its ground, its
// arrangement, its font and the tools it leads with), so boards side by side
// don't look alike and each shows a wide spread of the tools (the owner, 10-30).
//
// validateRecipe is pure (recipe.test.mjs): every rule a board is held to
// before any photo is fetched. writeRecipe asks Claude, checks the answer, and
// asks once more with the problems when it falls short.

import { fountainToBlocks } from '../../src/lib/screenplayIO.js';
import { LINK_RE } from './links.mjs';
import { TOOLS, styleNamed } from './styles.mjs';

export const SECTION_NAMES = ['blue', 'clay', 'green', 'plum', 'teal', 'rose', 'moss', 'slate'];

export const RULES = Object.freeze({
  sections: [3, 6],
  pictures: [9, 20],
  notes: [2, 8],
  palettes: [1, 2],
  videos: [3, 6], // when the brief wants video
  video: 1, // any other board: at most one, a motion reference
  frames: 6, // the fewest captioned pictures a storyboard's frames section holds
  cards: [14, 40],
  // The rest of the tools: how many of each a board may hold.
  tables: [0, 2],
  checklists: [0, 2],
  docs: [0, 1],
  links: [0, 2],
  arrows: [0, 3],
  tools: 6, // the fewest different tools a board shows (styles.mjs TOOLS)
  tableRows: [3, 9], // the header row included
  tableCols: [2, 5],
  tableCell: 40,
  checks: [3, 8],
  check: 60,
  doc: [400, 2500], // characters of Markdown: a page
  arrowLabel: 24,
  grid: [3, 9], // pictures in a photo-grid section (a mosaic)
  gridFrames: [6, 12], // or a storyboard sheet's frames
  swatches: [4, 6],
  sectionName: 28,
  noteTitle: 48,
  noteBody: 480,
  caption: 28, // one line over the picture (build.mjs fitCaption)
  scripts: 1, // a board holds at most one script (the owner, 10-29: scenes go in the app's screenplay docs)
  script: [300, 2400], // characters of Fountain: a scene or two, a page or so
  // A section is a column on the board: four long notes in one makes a tower
  // beside short picture columns (the costume trial's "lopsided" grade), and a
  // pictures-only section of one or two looks like something went missing.
  sectionNotes: 3, // notes, checklists, docs and scripts
  sectionCards: 5, // text cards of any kind (tables and links too)
  sectionText: 1200, // characters of note titles + bodies in one section
  sectionPictures: 3, // the fewest in a section of pictures alone
  search: [2, 6], // words: a long search finds nothing (the costume trial's "dented steel thermos on boat deck")
  title: 70,
  story: 220,
  seoTitle: 60,
  seoDescription: [50, 155],
  seoBodyWords: 250,
});

export const ITEM_KINDS = ['picture', 'video', 'note', 'palette', 'script', 'table', 'checklist', 'doc', 'link'];
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
          grid: { type: 'boolean' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind'],
              properties: {
                kind: { type: 'string', enum: ITEM_KINDS },
                search: { type: 'string' },
                caption: { type: 'string' },
                title: { type: 'string' },
                body: { type: 'string' },
                fountain: { type: 'string' },
                markdown: { type: 'string' },
                url: { type: 'string' },
                rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
                checks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['text', 'done'],
                    properties: { text: { type: 'string' }, done: { type: 'boolean' } },
                  },
                },
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
    arrows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to'],
        properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } },
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
 * A script reads as a scene once the app parses it (screenplayIO.js, the same
 * parse a dropped .fountain file gets): a scene heading, some action and at
 * least one speech, a page or so long. → problems, [] when it's good.
 */
export function scriptProblems(it, section = '') {
  const p = [];
  const where = section ? ` in "${section}"` : '';
  const t = str(it?.title);
  const f = str(it?.fountain);
  if (!t || t.length > RULES.noteTitle) p.push(`the script${where} needs a title of at most ${RULES.noteTitle} characters`);
  if (f.length < RULES.script[0] || f.length > RULES.script[1]) {
    p.push(`the script${where} must be ${RULES.script[0]}–${RULES.script[1]} characters of Fountain, not ${f.length}`);
  }
  const blocks = fountainToBlocks(f);
  const has = (e) => blocks.some((b) => b.element === e && str(b.text));
  if (!has('scene')) p.push(`the script${where} needs a scene heading line like "INT. LANTERN ROOM - NIGHT"`);
  if (!has('action')) p.push(`the script${where} needs action lines: what we see, in plain sentences`);
  if (!has('character') || !has('dialogue')) {
    p.push(`the script${where} needs a speech: a name in capitals on its own line after a blank line, the dialogue on the line under it`);
  }
  return p;
}

const norm = (s) => str(s).toLowerCase().replace(/\s+/g, ' ');
const isPic = (it) => it?.kind === 'picture' || it?.kind === 'video';
// A section is a photo grid (one grid card: a mosaic, or a storyboard sheet
// when its pictures are captioned frames) when it says so.
const isGrid = (s) => s?.grid === true;

/** The tools a recipe uses (styles.mjs TOOLS), as the board will show them. */
export function toolsOf(r) {
  const used = new Set();
  for (const s of Array.isArray(r?.sections) ? r.sections : []) {
    const items = Array.isArray(s?.items) ? s.items : [];
    if (isGrid(s) && items.filter((it) => it?.kind === 'picture').length >= RULES.grid[0]) used.add('grid');
    for (const it of items) {
      if (!it || !ITEM_KINDS.includes(it.kind)) continue;
      if (it.kind === 'picture' && isGrid(s)) continue;
      used.add(it.kind);
    }
  }
  if (Array.isArray(r?.arrows) && r.arrows.length) used.add('arrows');
  return TOOLS.filter((t) => used.has(t));
}

function tableProblems(it, where) {
  const p = [];
  const R = RULES;
  if (!str(it.title) || str(it.title).length > R.noteTitle) p.push(`the table${where} needs a title of at most ${R.noteTitle} characters`);
  const rows = Array.isArray(it.rows) ? it.rows : [];
  if (rows.length < R.tableRows[0] || rows.length > R.tableRows[1]) {
    p.push(`the table "${str(it.title)}" holds ${R.tableRows[0]}–${R.tableRows[1]} rows (the first is the header), not ${rows.length}`);
  }
  const cols = Array.isArray(rows[0]) ? rows[0].length : 0;
  if (cols < R.tableCols[0] || cols > R.tableCols[1]) p.push(`the table "${str(it.title)}" holds ${R.tableCols[0]}–${R.tableCols[1]} columns, not ${cols}`);
  else if (rows.some((row) => !Array.isArray(row) || row.length !== cols)) p.push(`every row of the table "${str(it.title)}" needs ${cols} cells, as its header has`);
  if (rows.some((row) => Array.isArray(row) && row.some((c) => str(c).length > R.tableCell))) {
    p.push(`a cell in the table "${str(it.title)}" is over ${R.tableCell} characters; a table holds short entries`);
  }
  if (Array.isArray(rows[0]) && rows[0].some((c) => !str(c))) p.push(`the table "${str(it.title)}" needs a word over every column`);
  return p;
}

function checklistProblems(it, where) {
  const p = [];
  const R = RULES;
  if (!str(it.title) || str(it.title).length > R.noteTitle) p.push(`the checklist${where} needs a title of at most ${R.noteTitle} characters`);
  const checks = Array.isArray(it.checks) ? it.checks : [];
  if (checks.length < R.checks[0] || checks.length > R.checks[1]) {
    p.push(`the checklist "${str(it.title)}" holds ${R.checks[0]}–${R.checks[1]} items, not ${checks.length}`);
  }
  if (checks.some((c) => !str(c?.text) || str(c.text).length > R.check)) p.push(`every item of the checklist "${str(it.title)}" is 1–${R.check} characters`);
  if (!checks.some((c) => c?.done === true) || !checks.some((c) => c?.done !== true)) {
    p.push(`the checklist "${str(it.title)}" needs some items ticked (done) and some still open, as on a real job`);
  }
  return p;
}

/**
 * Every problem with a recipe, in words Claude can act on; [] when it's good.
 *   brief: { wants?: ['video'|'script'|'frames'] }
 *   taken: slugs already used (the library's and the site's)
 *   style: styles.mjs's, the look the board is written to (default: the one the recipe names)
 */
export function validateRecipe(r, brief = {}, { taken = [], style = styleNamed(r?.style) } = {}) {
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
  const n = Object.fromEntries(ITEM_KINDS.map((k) => [k, 0]));
  let frames = 0;
  let cards = 0;
  const searches = new Set();
  const targets = new Map(); // a name an arrow can use → the section it's in
  sections.forEach((s, si) => {
    const name = str(s?.name);
    const where = name ? ` in "${name}"` : '';
    if (!name || name.length > R.sectionName) p.push(`section ${si + 1} needs a name of at most ${R.sectionName} characters`);
    if (names.has(name.toLowerCase())) p.push(`two sections are called "${name}"`);
    names.add(name.toLowerCase());
    if (!SECTION_NAMES.includes(s?.color)) p.push(`section "${name}" needs one of the colours ${SECTION_NAMES.join(', ')}`);
    const items = Array.isArray(s?.items) ? s.items : [];
    if (!items.length) p.push(`section "${name}" is empty`);
    const target = (t) => { if (norm(t) && !targets.has(norm(t))) targets.set(norm(t), si); };
    if (isGrid(s)) target(name);
    let captioned = 0;
    for (const it of items) {
      if (!it || !ITEM_KINDS.includes(it.kind)) { p.push(`section "${name}" holds an item of no known kind`); continue; }
      n[it.kind] += 1;
      target(it.title);
      target(it.caption);
      if (isPic(it)) {
        const q = str(it.search);
        const w = words(q);
        if (w < R.search[0] || w > R.search[1]) p.push(`the search "${q}" must be ${R.search[0]}–${R.search[1]} words`);
        if (searches.has(q.toLowerCase())) p.push(`the search "${q}" is used twice; every photo needs its own search`);
        searches.add(q.toLowerCase());
        if (it.caption && str(it.caption).length > R.caption) p.push(`a caption in "${name}" is over ${R.caption} characters`);
        if (it.kind === 'picture' && str(it.caption)) captioned += 1;
      } else if (it.kind === 'note') {
        const t = str(it.title);
        const b = str(it.body);
        if (!t && !b) p.push(`a note in "${name}" is empty`);
        if (t.length > R.noteTitle) p.push(`the note title "${t.slice(0, 30)}…" is over ${R.noteTitle} characters`);
        if (b.length > R.noteBody) p.push(`the note "${t || b.slice(0, 30)}" is over ${R.noteBody} characters`);
      } else if (it.kind === 'script') {
        p.push(...scriptProblems(it, name));
      } else if (it.kind === 'palette') {
        const sw = Array.isArray(it.swatches) ? it.swatches : [];
        if (sw.length < R.swatches[0] || sw.length > R.swatches[1]) p.push(`a palette holds ${R.swatches[0]}–${R.swatches[1]} swatches`);
        if (sw.some((x) => !HEX_RE.test(str(x?.hex)) || !str(x?.name))) p.push('every swatch needs a name and a hex like "#1d3557"');
      } else if (it.kind === 'table') {
        p.push(...tableProblems(it, where));
      } else if (it.kind === 'checklist') {
        p.push(...checklistProblems(it, where));
      } else if (it.kind === 'doc') {
        const md = str(it.markdown);
        if (!str(it.title) || str(it.title).length > R.noteTitle) p.push(`the doc${where} needs a title of at most ${R.noteTitle} characters`);
        if (md.length < R.doc[0] || md.length > R.doc[1]) p.push(`the doc "${str(it.title)}" must be ${R.doc[0]}–${R.doc[1]} characters of Markdown, not ${md.length}`);
      } else if (it.kind === 'link') {
        if (!LINK_RE.test(str(it.url))) p.push(`the link${where} must be an English Wikipedia article's address, like "https://en.wikipedia.org/wiki/Film_noir", not "${str(it.url).slice(0, 60)}"`);
      }
    }
    frames = Math.max(frames, style?.needs.includes('grid') && !isGrid(s) ? 0 : captioned);

    const pictures = items.filter((it) => it?.kind === 'picture').length;
    const others = items.filter((it) => it && !isPic(it)).length;
    if (isGrid(s)) {
      const asFrames = captioned >= Math.ceil(pictures / 2) && pictures >= R.gridFrames[0];
      const [lo, hi] = asFrames ? R.gridFrames : R.grid;
      if (pictures < lo || pictures > hi) p.push(`the photo grid "${name}" holds ${lo}–${hi} pictures${asFrames ? ' (frames)' : ''}, not ${pictures}`);
      if (!others) p.push(`the photo grid "${name}" needs a note, palette, table or checklist beside it in its section, or it reads as a stray picture`);
      cards += 1 + items.length - pictures;
    } else cards += items.length;

    // A section is a column on the board: keep the words in it to a column's worth.
    const long = items.filter((it) => ['note', 'checklist', 'doc', 'script'].includes(it?.kind));
    const text = items.filter((it) => it && !isPic(it) && it.kind !== 'palette');
    const chars = items.reduce((a, it) => a + (it?.kind === 'note' ? str(it.title).length + str(it.body).length
      : it?.kind === 'checklist' ? (it.checks || []).reduce((b, c) => b + str(c?.text).length, 0) : 0), 0);
    if (long.length > R.sectionNotes) p.push(`section "${name}" holds ${long.length} notes, checklists and docs; at most ${R.sectionNotes} in one section, spread the rest beside the pictures they talk about`);
    else if (text.length > R.sectionCards) p.push(`section "${name}" holds ${text.length} cards of words; at most ${R.sectionCards} in one section`);
    else if (chars > R.sectionText) p.push(`section "${name}" holds ${chars} characters of notes; at most ${R.sectionText} in one section, shorten them or move one beside the pictures it talks about`);
    const pics = items.filter(isPic).length;
    if (!isGrid(s) && pics && pics === items.length && pics < R.sectionPictures) p.push(`section "${name}" is ${pics} picture${pics === 1 ? '' : 's'} alone; a section of pictures holds at least ${R.sectionPictures}`);
  });

  const between = (k, [lo, hi], what) => {
    if (n[k] < lo || n[k] > hi) p.push(`a board holds ${lo}–${hi} ${what}, not ${n[k]}`);
  };
  between('picture', R.pictures, 'pictures');
  between('note', R.notes, 'notes');
  between('palette', R.palettes, 'palettes');
  between('table', R.tables, 'tables');
  between('checklist', R.checklists, 'checklists');
  between('doc', R.docs, 'docs');
  between('link', R.links, 'links');
  if (wants.has('video')) between('video', R.videos, 'videos');
  else if (n.video > R.video) p.push(`this brief has at most ${R.video} video, a motion reference; use pictures for the rest`);
  if (n.script > R.scripts) p.push(`a board holds at most ${R.scripts} script, not ${n.script}`);
  if (wants.has('script') && !n.script) p.push('this brief wants a script: one item of kind "script", the scene written in Fountain');
  if (wants.has('frames') && frames < R.frames) {
    p.push(`this brief is a storyboard: one ${style?.needs.includes('grid') ? 'photo-grid section (grid: true)' : 'section'} of at least ${R.frames} captioned pictures, the frames in order`);
  }
  if (cards < R.cards[0] || cards > R.cards[1]) p.push(`a board holds ${R.cards[0]}–${R.cards[1]} cards (a photo grid counts as one), not ${cards}`);

  const arrows = Array.isArray(r.arrows) ? r.arrows : [];
  if (arrows.length > R.arrows[1]) p.push(`a board holds at most ${R.arrows[1]} arrows, not ${arrows.length}`);
  for (const a of arrows) {
    const f = targets.get(norm(a?.from));
    const t = targets.get(norm(a?.to));
    if (f == null || t == null) p.push(`the arrow "${str(a?.from)}" → "${str(a?.to)}" must name two cards by their exact title or caption`);
    else if (norm(a.from) === norm(a.to)) p.push(`the arrow "${str(a.from)}" points at itself`);
    else if (f !== t) p.push(`the arrow "${str(a.from)}" → "${str(a.to)}" joins two sections; an arrow joins two cards in the same section`);
    if (str(a?.label).length > R.arrowLabel) p.push(`the arrow label "${str(a.label)}" is over ${R.arrowLabel} characters`);
  }

  const tools = toolsOf(r);
  if (tools.length < R.tools) p.push(`the board shows ${tools.length} tools (${tools.join(', ')}); it should show at least ${R.tools}: add ${TOOLS.filter((t) => !tools.includes(t) && t !== 'script' && t !== 'video').slice(0, 3).join(', ')}`);
  for (const need of style?.needs || []) {
    if (!tools.includes(need)) p.push(`this board is a ${style.name}: it needs ${need === 'grid' ? 'a photo-grid section (grid: true, 3–9 pictures)' : need === 'arrows' ? 'arrows (1–3)' : `a ${need}`}`);
  }
  if (style?.needs.includes('arrows') && arrows.length < 2) p.push('this style leans on arrows: draw 2–3, each from a note to the card it talks about in the same section');

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

/**
 * What is on a board, as short plain strings for someone writing about it: the title, the story, then each
 * section's name and what its cards say (a picture's caption, else what it shows; a note's title and opening;
 * a palette's swatch names). At most `max` strings, each cut to 140 characters.
 */
export function recipeContents(r, max = 40) {
  const out = [];
  const cut = (s) => { const t = str(s).replace(/\s+/g, ' '); return t.length > 140 ? `${t.slice(0, 139)}…` : t; };
  const add = (s) => { const t = cut(s); if (t) out.push(t); };
  add(`Title: ${r.title}`);
  add(`About: ${r.story}`);
  for (const s of r.sections || []) {
    add(`Section: ${s.name}`);
    for (const it of s.items || []) {
      if (it.kind === 'picture') add(it.caption ? `Photo "${str(it.caption)}" (${str(it.search)})` : `Photo: ${str(it.search)}`);
      else if (it.kind === 'video') add(`Video: ${str(it.search)}${it.caption ? ` "${str(it.caption)}"` : ''}`);
      else if (it.kind === 'note') add(`Note "${str(it.title)}": ${str(it.body)}`);
      else if (it.kind === 'palette') add(`Palette ${str(it.title)}: ${(it.swatches || []).map((w) => str(w.name)).join(', ')}`);
    }
  }
  return out.slice(0, max);
}

export function recipePrompt(brief, { taken = [], redo = null, style = null } = {}) {
  const R = RULES;
  const wants = new Set(brief.wants || []);
  return [
    'You are making one board for Clusters, a canvas app where film crews and creative teams keep their',
    'reference: pictures, notes, palettes, tables, checklists, docs and links laid out in named sections. The board',
    'will be shown as an example of what a real working board looks like, so it must read as made by a working',
    'professional in the middle of a real project: specific, practical, beautiful. Never mention Clusters, AI or this',
    'brief on it.',
    '',
    `The brief: ${brief.brief}`,
    ...(style ? ['', `The look: ${style.words}. Write the board to that look; it must use: ${style.needs.map((x) => TOOL_WORDS[x]).join('; ')}.`] : []),
    '',
    'Make:',
    `- title: the board's name as its maker would title it (at most ${R.title} characters), e.g. "Saltmarsh — Costume Board".`,
    '- slug: the title as lowercase-hyphenated words, at most 60 characters, naming the subject plainly.',
    `- story: one sentence (at most ${R.story} characters) on what the board is for, for our own library.`,
    `- sections: ${R.sections[0]}–${R.sections[1]}, each with a short working name (at most ${R.sectionName} characters, e.g.`,
    '  "Silhouettes", "Night exteriors", "Props + set dressing") and one of the colours given, no colour twice in a row.',
    `- pictures: ${R.pictures[0]}–${R.pictures[1]} in all. Each picture`,
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
    `- a photo grid: a section with "grid": true sets its ${R.grid[0]}–${R.grid[1]} pictures as one grid card (a hero picture with a`,
    '  strip under it), and must hold a note, palette, table or checklist beside the grid. Other sections set each picture',
    '  as its own card.',
    `- notes: ${R.notes[0]}–${R.notes[1]}, each a title and a short body in the maker's voice: concrete decisions, names, numbers,`,
    `  lists with "- ". At most ${R.noteBody} characters each. No marketing words, no emojis, no exclamation marks.`,
    `- palette: ${R.palettes[0]}–${R.palettes[1]}, each ${R.swatches[0]}–${R.swatches[1]} swatches named as the maker would ("Harbour fog") with hex colours taken`,
    '  from the look; put a palette in the section it belongs to.',
    `- tables (kind "table", ${R.tables[0]}–${R.tables[1]}): a title and "rows", ${R.tableRows[0]}–${R.tableRows[1]} rows of ${R.tableCols[0]}–${R.tableCols[1]} short cells (at most ${R.tableCell}`,
    '  characters), the first row the column names: a shot list, call times, kit, fittings, locations, a budget, a',
    '  schedule; real names, numbers and times.',
    `- checklists (kind "checklist", ${R.checklists[0]}–${R.checklists[1]}): a title and "checks", ${R.checks[0]}–${R.checks[1]} items of what is still to do, each`,
    `  { "text": at most ${R.check} characters, "done": true or false }, some done, some still open.`,
    `- a doc (kind "doc", ${R.docs[0]}–${R.docs[1]}): a title and "markdown", ${R.doc[0]}–${R.doc[1]} characters: the treatment, the look in a page,`,
    '  the brief or the plan, as the maker would write it, with "## " headings, short paragraphs and "- " lists.',
    `- links (kind "link", ${R.links[0]}–${R.links[1]}): a reference the maker saved, as "url": an English Wikipedia article's address`,
    '  ("https://en.wikipedia.org/wiki/Film_noir", "https://en.wikipedia.org/wiki/Andrew_Wyeth"): a painter, a',
    '  photographer, a film, a place, a technique, a period. Only articles you are sure exist, under their exact title.',
    '  Give it a "title" too, a few words, for arrows to name.',
    `- arrows: ${R.arrows[0]}–${R.arrows[1]}, each { "from", "to", "label" }, joining two cards in the SAME section, named by`,
    `  their exact title or caption (a photo grid by its section's name): from a note to the picture it talks about, from a`,
    `  checklist to the table it works through. A label of at most ${R.arrowLabel} characters, two or three words.`,
    `- Use a wide spread of these: at least ${R.tools} different kinds in all (pictures, a photo grid, notes, a palette, a table,`,
    '  a checklist, a doc, a link, arrows), as a real working board does.',
    ...(wants.has('video') ? [`- videos: ${R.videos[0]}–${R.videos[1]} video items (kind "video"), each a stock footage search, for motion references.`]
      : [`- a video (kind "video", at most ${R.video}): only where motion is the point (water, smoke, a crowd, traffic), a stock footage search.`]),
    ...(wants.has('script') ? [
      '- a script: one item of kind "script". It becomes a real screenplay document on the board, so write it as the',
      `  scene itself, in Fountain (${R.script[0]}–${R.script[1]} characters in "fountain"): a scene heading line ("INT. LANTERN ROOM - NIGHT"),`,
      '  action in plain lines, a character\'s name in capitals on its own line after a blank line with their dialogue on',
      '  the next line, a (parenthetical) on its own line between them when needed, a blank line between every element;',
      '  one or two scenes, no title page, no markdown. Its "title" is the name the doc goes by ("Sc. 4 — The last lamp").',
    ] : []),
    ...(wants.has('frames') ? [`- frames: one photo-grid section ("grid": true) of ${R.gridFrames[0]}–${R.gridFrames[1]} pictures in shot order, every one captioned like "3 · CLOSE — brake lever".`] : []),
    `- In all, ${R.cards[0]}–${R.cards[1]} cards (a photo grid counts as one). Each section becomes one column or block on the board,`,
    `  so keep them even: at most ${R.sectionNotes} notes, checklists and docs and ${R.sectionCards} cards of words in a section, at most`,
    `  ${R.sectionText} characters of notes, a section of pictures alone holds at least ${R.sectionPictures}, and notes sit beside the`,
    '  pictures they talk about rather than stacked in one column.',
    '- seo: the words for this board\'s own public page: title (at most 60 characters, the subject + what the board is),',
    `  description (${R.seoDescription[0]}–${R.seoDescription[1]} characters), keyword (the search phrase someone would type to find a board like`,
    `  this, e.g. "costume design mood board"), and body: at least ${R.seoBodyWords} words of plain paragraphs (no headings, no lists)`,
    '  walking through how this board was put together and why each section is there, useful to someone making their',
    '  own; the keyword in it once, naturally.',
    ...(taken.length ? ['', `Slugs already taken: ${taken.slice(-60).join(', ')}.`] : []),
    ...(redo ? ['', 'Your last recipe fell short. Fix every one of these and keep what was good:', ...redo.problems.map((x) => `- ${x}`), '', 'The last recipe:', JSON.stringify(redo.recipe)] : []),
  ].join('\n');
}

// How the prompt names each tool a style needs.
const TOOL_WORDS = {
  picture: 'pictures', note: 'notes', palette: 'a palette', grid: 'a photo-grid section', table: 'a table',
  checklist: 'a checklist', doc: 'a doc', script: 'a script', link: 'a reference link', arrows: 'two or three arrows', video: 'a video',
};

/**
 * Asks Claude for a recipe to `brief`, written to `style`; one more try with
 * the problems when the first falls short. → { recipe, problems } (problems []
 * when it passed). The recipe carries the style's name.
 *   claude: claudeJson from ~/soleil-social/lib/claude.mjs
 */
export async function writeRecipe(brief, { claude, taken = [], log = () => {}, notes = null, last = null, style = null } = {}) {
  let redo = notes && last ? { problems: notes, recipe: last } : null;
  let recipe = null;
  let problems = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    recipe = await claude({
      prompt: recipePrompt(brief, { taken, redo, style }),
      schema: RECIPE_SCHEMA, model: 'opus', effort: 'medium', budgetUsd: 2, log,
    });
    if (recipe && typeof recipe === 'object' && style) recipe.style = style.name;
    problems = validateRecipe(recipe, brief, { taken, style });
    if (!problems.length) return { recipe, problems };
    log(`recipe: ${problems.length} problem(s): ${problems.slice(0, 4).join('; ')}`);
    redo = { problems, recipe };
  }
  return { recipe, problems };
}
