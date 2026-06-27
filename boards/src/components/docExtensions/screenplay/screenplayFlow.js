// Pure screenplay element-flow logic. NO Tiptap/ProseMirror imports so it is
// trivially unit-testable and importable by the QA bridge. The editor keymap
// (ScreenplayKeymap) and autocomplete (ScreenplaySuggest) consume these.
//
// A screenplay line is a `screenplayBlock` node with an `element` attr.

// All element types.
export const ELEMENTS = [
  'scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'centered',
];

// Tab cycles through this canonical ring (Shift-Tab reverses). `centered` is a
// rarely-used element reachable via the toolbar "+" insert menu, so it's out of
// the Tab ring.
const TAB_RING = ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot'];

// Display labels for menus/toolbar.
export const ELEMENT_LABELS = {
  scene: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  shot: 'Shot',
  centered: 'Centered',
};

// What pressing Enter at the end of a line of the given element produces for the
// NEW line. `isEmpty` = the current line has no text. The empty-line cases drive
// the "keep pressing Enter to escalate" flow the user asked for:
//   dialogue(text) → Enter → CHARACTER (new speaker; cast is suggested)
//   empty character → Enter → ACTION
//   empty action   → Enter → SCENE HEADING
export function nextOnEnter(element, isEmpty = false) {
  if (isEmpty) {
    // An empty Action line escalates to a new Scene Heading; every other empty
    // element drops to Action. (So: char→action→scene as you keep hitting Enter.)
    return element === 'action' ? 'scene' : 'action';
  }
  switch (element) {
    case 'scene': return 'action';
    case 'action': return 'action';
    case 'character': return 'dialogue';
    case 'parenthetical': return 'dialogue';
    // Enter at the end of a line of dialogue starts a NEW character cue — most
    // scenes alternate speakers, and the cast autocomplete pops up so you pick
    // the next one fast.
    case 'dialogue': return 'character';
    case 'transition': return 'scene';
    case 'shot': return 'action';
    case 'centered': return 'action';
    default: return 'action';
  }
}

// Tab forward / Shift-Tab backward through TAB_RING. Non-ring elements (centered)
// enter the ring at the start.
export function nextOnTab(element) {
  const i = TAB_RING.indexOf(element);
  if (i < 0) return TAB_RING[0];
  return TAB_RING[(i + 1) % TAB_RING.length];
}
export function prevOnTab(element) {
  const i = TAB_RING.indexOf(element);
  if (i < 0) return TAB_RING[TAB_RING.length - 1];
  return TAB_RING[(i - 1 + TAB_RING.length) % TAB_RING.length];
}

// Scene headings, character cues, and transitions are conventionally uppercase.
export function shouldUppercase(element) {
  return element === 'scene' || element === 'character' || element === 'transition';
}

// ── Doc collectors (operate on ProseMirror JSON) ─────────────────────────────
// Walk a doc JSON, invoking visit(element, text) for each screenplayBlock.
function walkScreenplayBlocks(doc, visit) {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'screenplayBlock') {
      const text = (node.content || []).map(c => (c.type === 'text' ? (c.text || '') : '')).join('');
      visit(node.attrs?.element || 'action', text);
    }
    (node.content || []).forEach(walk);
  };
  walk(doc);
}

// Strip a character-cue extension like "(CONT'D)" / "(V.O.)" to the base name.
export function baseCharacterName(text) {
  return String(text || '').split('(')[0].trim().toUpperCase();
}

const CONTD_RE = /\(\s*CONT['’]?D\s*\)/i;

// Auto (CONT'D): a character cue that resumes after the SAME character already
// spoke earlier in the scene (with only action/other in between, no other
// speaker) should display "(CONT'D)". Pure + render-time — `blocks` is the flat
// [{ element, text }] array; returns a Set of block indices whose cue should
// show (CONT'D). The stored text is never modified; callers append for display.
export function computeAutoContd(blocks) {
  const out = new Set();
  let lastSpeaker = null;
  (blocks || []).forEach((b, i) => {
    const el = b.element || 'action';
    if (el === 'scene') { lastSpeaker = null; return; }
    if (el !== 'character') return;
    const name = baseCharacterName(b.text);
    if (!name) return;
    if (name === lastSpeaker && !CONTD_RE.test(String(b.text || ''))) out.add(i);
    lastSpeaker = name;
  });
  return out;
}

// Display string for a character cue, applying auto (CONT'D) when `contd` and it
// isn't already present.
export function characterCueDisplay(text, contd) {
  const t = String(text || '');
  if (!contd || CONTD_RE.test(t)) return t;
  return `${t} (CONT'D)`;
}

// 1→A, 2→B, … 26→Z, 27→AA — for inserted-scene letter suffixes.
function letterFor(n) {
  let s = '';
  while (n > 0) { n -= 1; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

// Scene-number display strings. `blocks` is the flat [{ element, sceneNumber }]
// array. If NO scene carries a locked `sceneNumber`, scenes are numbered 1..N by
// order. If ANY does (locked mode), locked scenes keep their stamped number and
// scenes inserted after a locked #N get A/B suffixes (5A, 5B…). Returns a Map of
// block index → display string for scene blocks only.
export function computeSceneNumbers(blocks) {
  const out = new Map();
  const list = blocks || [];
  const anyLocked = list.some(b => b && b.element === 'scene' && b.sceneNumber);
  let auto = 0, lastBase = null, letter = 0;
  list.forEach((b, i) => {
    if (!b || b.element !== 'scene') return;
    if (!anyLocked) { auto += 1; out.set(i, String(auto)); return; }
    if (b.sceneNumber) { out.set(i, String(b.sceneNumber)); lastBase = String(b.sceneNumber); letter = 0; return; }
    letter += 1;
    out.set(i, lastBase != null ? `${lastBase}${letterFor(letter)}` : `${letterFor(letter)}1`);
  });
  return out;
}

// Unique character names already used in the doc, sorted alphabetically.
export function collectCharacterNames(doc) {
  const set = new Set();
  walkScreenplayBlocks(doc, (el, text) => {
    if (el !== 'character') return;
    const name = baseCharacterName(text);
    if (name) set.add(name);
  });
  return [...set].sort();
}

// Character names ordered by how OFTEN they speak (most-used first, ties broken
// alphabetically) — so a fresh character cue suggests your main characters at
// the top. baseCharacterName folds JOHN / JOHN (V.O.) / JOHN (CONT'D) into one.
export function collectCharacterNamesByFrequency(doc) {
  const counts = new Map();
  walkScreenplayBlocks(doc, (el, text) => {
    if (el !== 'character') return;
    const name = baseCharacterName(text);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

// Parse a scene-heading location from "INT./EXT. LOCATION - TIME". Returns the
// LOCATION segment (uppercased). Used for INT./EXT. autocomplete.
export function parseSceneLocation(text) {
  const t = String(text || '').trim().toUpperCase();
  const m = t.match(/^(?:INT\.?\/EXT\.?|INT\.?|EXT\.?|EST\.?|I\/E\.?)\s+(.*)$/);
  const rest = m ? m[1] : t;
  // Drop a trailing " - TIME OF DAY".
  const loc = rest.split(/\s+-\s+/)[0].trim();
  return loc;
}

// Unique scene locations already used (for autocomplete).
export function collectLocations(doc) {
  const set = new Set();
  walkScreenplayBlocks(doc, (el, text) => {
    if (el !== 'scene') return;
    const loc = parseSceneLocation(text);
    if (loc) set.add(loc);
  });
  return [...set].sort();
}

// Common scene-heading prefixes + times of day for autocomplete seeding.
export const SCENE_PREFIXES = ['INT. ', 'EXT. ', 'INT./EXT. ', 'EST. '];
export const TIMES_OF_DAY = ['DAY', 'NIGHT', 'MORNING', 'EVENING', 'CONTINUOUS', 'LATER', 'DAWN', 'DUSK'];

// Common transitions + character-cue extensions. Shared by the autocomplete
// (ScreenplaySuggest) AND the auto-detector below so there's ONE list.
export const TRANSITIONS = ['CUT TO:', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'FADE TO:', 'FADE OUT.', 'INTERCUT WITH:'];
export const EXTENSIONS = ['(V.O.)', '(O.S.)', "(CONT'D)"];

// A scene-heading slugline starts with one of these prefixes FOLLOWED BY a
// space — so "INT. " / "EXT " / "I/E " trigger but "Interior" / "Inter" don't.
const SCENE_DETECT_RE = /^(?:INT\.?\/EXT\.?|INT\.?|EXT\.?|EST\.?|I\/E\.?)\s/i;

// Auto-format: as the writer types on an ACTION line, promote it to the element
// its text clearly implies — a slugline → Scene Heading, a "… TO:" line → a
// Transition. Returns the new element, or null to leave it as-is. ONLY ever
// promotes FROM action (never overrides a deliberately-chosen element), so it
// can run on every keystroke without fighting the writer. Pure + caller applies
// the change locally (collab-safe, single-undo).
export function detectElementFromText(currentElement, text) {
  if (currentElement !== 'action') return null;
  const t = String(text || '');
  if (SCENE_DETECT_RE.test(t)) return 'scene';
  const trimmed = t.trim().toUpperCase();
  // A known transition verbatim, or any line ending in "… TO:" (CUT TO:, etc.).
  if (trimmed && (TRANSITIONS.includes(trimmed) || /\sTO:$/.test(trimmed))) return 'transition';
  return null;
}
