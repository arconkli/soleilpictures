// firstBoardCopy.js — what the first board says, given what we already know.
//
// Every new account met one panel: a rotating "Start your moodboard / script /
// shot list…" headline, an image hero and six tiles offering Grid, Script,
// Cluster, Note, Doc and Any file as peers. Three things the data said about it:
//
//   * The people who come back are the ones who were working in ANOTHER window
//     and pasted or dropped into this one. The panel never said "paste" or
//     "drag from your browser" in its headline; it said "pick several".
//   * The single most common first move was placing an empty container, and it
//     was the worst-returning first move by a wide margin. The tiles offered it
//     as an equal of adding an image.
//   * The app already knew the landing page, the referrer and the intent the
//     person picked — and read none of it back. "Collecting references" is the
//     best-returning stated intent and the word never appeared on the screen.
//
// So: one hero that asks for material from wherever it already is, a headline
// that names the job when we can tell it, and — on a person's FIRST board only —
// no container tiles. Pure and node-testable, like depthDock.js.

export const FIRST_BOARD_WORDS = Object.freeze(['reference wall', 'moodboard', 'storyboard', 'lookbook', 'shot list']);

// The tiles a first board offers beside the hero. Writing, not containers: a
// board with words on it comes back; a box with nothing in it does not.
export const FIRST_BOARD_TILE_IDS = Object.freeze(['note', 'doc']);

const KINDS = new Set(['references', 'moodboard', 'storyboard']);

export function firstBoardKindFrom(src) {
  if (!src || typeof src !== 'object') return null;
  const intent = typeof src.intent === 'string' ? src.intent.toLowerCase() : '';
  if (KINDS.has(intent)) return intent;
  const path = typeof src.landingPath === 'string' ? src.landingPath.toLowerCase() : '';
  if (path.startsWith('/vs/pureref') || path.includes('reference-board')) return 'references';
  if (path.includes('storyboard') || path.includes('shot-list')) return 'storyboard';
  // A treatment is built from references before it is written; the document
  // itself arrives from its own page (starterDocs.js).
  if (path.includes('treatment')) return 'treatment';
  if (path.includes('mood-board') || path.includes('look-book') || path.includes('lookbook')) return 'moodboard';
  const ref = typeof src.referrerHost === 'string' ? src.referrerHost.toLowerCase() : '';
  const utm = typeof src.utmSource === 'string' ? src.utmSource.toLowerCase() : '';
  if (ref.includes('chatgpt') || ref.includes('openai') || utm.includes('chatgpt') || utm.includes('openai')) return 'references';
  if (ref.includes('reddit')) return 'moodboard';
  return null;
}

const HINT = 'Paste or drag images from any tab, or drop a whole folder';
const HINT_COARSE = 'Pick several from your camera roll at once';
const HINT_FRAMES = 'Paste or drag images from any tab, or drop a folder of frames';
// Where the setup runs (appHost.js workspaceSetupAllowed) the hint names links
// too: a link pasted on the first day is the one first-day habit that still
// goes with coming back once how much was added is accounted for.
const HINT_LINKS = 'Paste images or links from any tab, or drop a whole folder';
const HINT_FRAMES_LINKS = 'Paste images or links from any tab, or drop a folder of frames';

// What every workspace was called before the setup asked for a name. Read
// back to a joiner it would sound like a name someone chose.
const UNNAMED_WORKSPACE = 'Personal Workspace';

const clean = (s, max) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// Someone else's workspace with nothing in it yet, as a joiner first sees it:
// it names the workspace and whose it is, and says what they add is seen.
function joinCopy(join, coarse) {
  const ws = clean(join.ws, 60);
  const name = ws && ws !== UNNAMED_WORKSPACE ? ws : 'this workspace';
  const by = clean(join.by, 40);
  return {
    head: by ? `Start ${name} with ${by}` : `Start ${name}`,
    heroLabel: 'Add the first images',
    heroHint: `${coarse ? 'Pick several from your camera roll at once.' : 'Paste images or links from any tab, or drop a folder.'} ${by ? `${by} sees` : 'Everyone in it sees'} them as they land.`,
  };
}

// opts: coarse (a touch screen), links (name links in the hint), join
// ({ ws, by }: someone else's empty workspace, which wins over the kind).
export function firstBoardCopy(kind, opts = {}) {
  const coarse = !!(opts && opts.coarse);
  const links = !!(opts && opts.links);
  if (opts && opts.join) return joinCopy(opts.join, coarse);
  const hint = coarse ? HINT_COARSE : links ? HINT_LINKS : HINT;
  switch (kind) {
    case 'references': return { head: 'Start your reference wall', heroLabel: 'Drop your references here', heroHint: hint };
    case 'moodboard':  return { head: 'Start your moodboard',      heroLabel: 'Bring your images in',      heroHint: hint };
    case 'storyboard': return { head: 'Start your storyboard',     heroLabel: 'Bring your frames in',      heroHint: coarse ? HINT_COARSE : links ? HINT_FRAMES_LINKS : HINT_FRAMES };
    case 'treatment':  return { head: 'Start your treatment',      heroLabel: 'Bring your references in',  heroHint: hint };
    default:           return { head: null,                        heroLabel: 'Add images',                heroHint: hint };
  }
}
