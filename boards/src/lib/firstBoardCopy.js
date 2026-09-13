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
  if (path.includes('mood-board') || path.includes('look-book')) return 'moodboard';
  const ref = typeof src.referrerHost === 'string' ? src.referrerHost.toLowerCase() : '';
  const utm = typeof src.utmSource === 'string' ? src.utmSource.toLowerCase() : '';
  if (ref.includes('chatgpt') || ref.includes('openai') || utm.includes('chatgpt') || utm.includes('openai')) return 'references';
  if (ref.includes('reddit')) return 'moodboard';
  return null;
}

const HINT = 'Paste or drag images from any tab, or drop a whole folder';
const HINT_COARSE = 'Pick several from your camera roll at once';

export function firstBoardCopy(kind, opts = {}) {
  const coarse = !!(opts && opts.coarse);
  const hint = coarse ? HINT_COARSE : HINT;
  switch (kind) {
    case 'references': return { head: 'Start your reference wall', heroLabel: 'Drop your references here', heroHint: hint };
    case 'moodboard':  return { head: 'Start your moodboard',      heroLabel: 'Bring your images in',      heroHint: hint };
    case 'storyboard': return { head: 'Start your storyboard',     heroLabel: 'Bring your frames in',      heroHint: coarse ? HINT_COARSE : 'Paste or drag images from any tab, or drop a folder of frames' };
    default:           return { head: null,                        heroLabel: 'Add images',                heroHint: hint };
  }
}
