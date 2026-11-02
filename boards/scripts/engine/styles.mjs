// styles.mjs — how an engine board looks, so no two boards side by side look
// alike (the owner, 10-30: "they all kindof look the same. add some variety"
// and "use more of our tools in each board they should show a wide selection
// of our tools").
//
// A style is the board's ground (boards.bg_color, the colour the canvas is
// painted), the way the app's own auto layout sets out its sections
// (layoutAuto's arrangements: pictures leading, columns, blocks), the notes'
// font, and the tools the board leads with. Claude writes the board to the
// style (recipe.mjs); the engine picks the style, by turns, so a batch of
// boards and a week of daily ones each run through all of them.
//
// Every tool here is something a person can add from the canvas: pictures,
// notes, palettes, tables and photo grids (grid cards), checklists (a note's
// checklist), docs, scripts (a doc in screenplay mode), links, arrows and
// videos, and since 11-01 sounds (audio cards), PDFs, sub-clusters, tags,
// comments and votes, which every board holds whatever its style (recipe.mjs
// EVERY) bar the PDF, which the paper-minded looks lean on. Schedules are
// retired and never used (scheduleRetired.test.mjs).

// The notes' fonts, as the toolbar's font picker stores them on a card
// (ToolOptionsBar.jsx FONTS; boardsEngineStyles.test.mjs keeps them in step).
export const FONTS = Object.freeze({
  sans: null, // the app's own: nothing stored
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'JetBrains Mono, ui-monospace, monospace',
});

// What a board uses, as validateRecipe counts it.
export const TOOLS = Object.freeze(['picture', 'note', 'palette', 'grid', 'table', 'checklist', 'doc', 'script', 'link', 'arrows', 'video',
  'audio', 'pdf', 'cluster', 'tags', 'comments', 'vote']);

export const STYLES = Object.freeze([
  {
    name: 'moodboard',
    ground: null, // the app's own canvas, light or dark with the theme
    arrangement: 'pictures',
    font: 'sans',
    needs: ['grid', 'palette', 'link', 'checklist'],
    words: 'a moodboard: the pictures lead, one section is a photo grid (a hero shot and a strip under it), two palettes, a reference link and a short checklist of what is still to find',
  },
  {
    name: 'night lookbook',
    ground: '#0e1013',
    arrangement: 'pictures',
    font: 'serif',
    needs: ['grid', 'doc', 'link', 'arrows'],
    words: 'a lookbook on a near-black ground, set in a serif: a photo grid up top, a doc that puts the look into a page of prose, a reference link, and arrows from notes to the pictures they talk about',
  },
  {
    name: 'production binder',
    ground: '#f2ede3',
    arrangement: 'columns',
    font: 'mono',
    needs: ['table', 'checklist', 'doc', 'pdf', 'arrows'],
    words: 'a production binder on warm paper, set in a typewriter mono, read left to right as columns: one or two tables (a shot list, call times, kit, fittings), a checklist with some items ticked, a doc with the plan, a PDF filed in it (the call sheet), a contact sheet of the photos as a grid, and an arrow or two tying a note to what it is about',
  },
  {
    name: 'storyboard wall',
    ground: '#121418',
    arrangement: 'blocks',
    font: 'sans',
    needs: ['grid', 'table', 'arrows'],
    words: 'a storyboard wall on a dark ground: the frames or the key images as a photo grid, a table (the shot list, or what each beat needs), and arrows linking notes to the frames they talk about',
  },
  {
    name: 'pitch',
    ground: '#17120d',
    arrangement: 'blocks',
    font: 'serif',
    needs: ['doc', 'grid', 'table', 'link', 'pdf'],
    words: 'a pitch board on a deep umber ground, set in a serif: a doc (the treatment, the brief or the statement), a photo grid, a table (cast, deliverables, budget lines or schedule), a one-page PDF (the brief or the deck summary) and a reference link',
  },
  {
    name: 'field notes',
    ground: '#e8ebee',
    arrangement: 'columns',
    font: 'sans',
    needs: ['checklist', 'table', 'link', 'arrows', 'pdf'],
    words: 'a working board on a cool grey ground, read left to right as columns: notes and pictures side by side, a photo grid of the recce, a checklist or two, a table, a PDF (the schedule or the release form), a reference link and arrows between related cards',
  },
]);

const byName = new Map(STYLES.map((s) => [s.name, s]));
export const styleNamed = (name) => byName.get(name) || null;

// A brief that wants frames needs a photo grid (the frames become a storyboard
// sheet); since 11-01 every board holds one (recipe.mjs EVERY), so every style fits.
export function fits(_style, _brief = {}) {
  return true;
}

/**
 * The style for a board: the one that fits the brief and was used longest ago
 * (never used first, then in STYLES order). `recent`: style names, oldest
 * first, of the boards made before this one.
 */
export function nextStyle(brief, recent = []) {
  const last = new Map();
  recent.forEach((name, i) => last.set(name, i));
  const ok = STYLES.filter((s) => fits(s, brief));
  return [...ok].sort((a, b) => (last.has(a.name) ? last.get(a.name) : -1) - (last.has(b.name) ? last.get(b.name) : -1)
    || STYLES.indexOf(a) - STYLES.indexOf(b))[0];
}
