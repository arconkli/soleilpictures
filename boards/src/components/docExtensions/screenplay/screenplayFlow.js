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
// rarely-used element reachable only via the toolbar/slash menu, so it's out of
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
// NEW line. Mirrors the Final Draft / Highland flow. `isEmpty` = the current
// line has no text (so e.g. an empty Character line resets to Action).
export function nextOnEnter(element, isEmpty = false) {
  if (isEmpty) {
    // Pressing Enter on an empty cue/transition/parenthetical bails to action.
    if (element === 'character' || element === 'transition' || element === 'parenthetical') return 'action';
  }
  switch (element) {
    case 'scene': return 'action';
    case 'action': return 'action';
    case 'character': return 'dialogue';
    case 'parenthetical': return 'dialogue';
    case 'dialogue': return 'action';
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

// Unique character names already used in the doc (for autocomplete).
export function collectCharacterNames(doc) {
  const set = new Set();
  walkScreenplayBlocks(doc, (el, text) => {
    if (el !== 'character') return;
    const name = baseCharacterName(text);
    if (name) set.add(name);
  });
  return [...set].sort();
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
