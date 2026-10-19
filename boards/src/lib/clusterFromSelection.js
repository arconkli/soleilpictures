// clusterFromSelection — "New cluster from N cards": what moves, where the new
// cluster lands, and what it is called.
//
// Pure, so the canvas menu, the list view's selection bar and the Studio bar all
// plan the same way:
//   · A group travels whole, the way it does when dragged and in "Move to
//     cluster…" (CanvasSurface's expandWithGroupmates: 2+ members on the board).
//   · A cluster card never moves this way. Nesting a cluster is a different
//     operation (move_boards_under), so an explicit selection holding one is
//     refused rather than half-moved — the same rule "Move N cards to…" keeps. A
//     sweep of a whole canvas passes clusters: 'skip' and leaves them where
//     they are, since a cluster is already filed.
//   · A card still uploading stays put: its upload writes into THIS card by id
//     (abandonedUploads.js), and a moved copy would never be told.
//   · The new cluster's card lands where the cards were: the centre of the
//     placed ones (a card waiting in Files has no place — lib/placement.js).
//
// The name is a suggestion for the naming field, never a silent default:
// a canvas group's own name, else what the files' names share, else the first
// note's first line, else nothing (and the field shows its placeholder).

import { htmlToText } from './cardIndexRow.js';
import { isStillUploading } from './abandonedUploads.js';
import { isUnplaced } from './placement.js';

export const NAME_MAX = 60;

const isClusterRef = (c) => c?.kind === 'board' || c?.kind === 'boardlink';
const isSeed = (c) => c?.seed === true || String(c?.id ?? '').startsWith('onb-');

export function planClusterFromSelection({ cards, ids, clusters = 'refuse', skipSeeds = false, wholeGroups = true } = {}) {
  const list = Array.isArray(cards) ? cards.filter(Boolean) : [];
  const byId = new Map(list.map((c) => [c.id, c]));
  const picked = (ids || []).map((id) => byId.get(id)).filter(Boolean);
  const out = new Map(picked.map((c) => [c.id, c]));
  // The list view moves exactly what is selected, as its own Move to… does.
  const groupIds = new Set(wholeGroups ? picked.map((c) => c.groupId).filter(Boolean) : []);
  if (groupIds.size) {
    const members = new Map();
    for (const c of list) {
      if (!c.groupId || !groupIds.has(c.groupId)) continue;
      if (!members.has(c.groupId)) members.set(c.groupId, []);
      members.get(c.groupId).push(c);
    }
    for (const ms of members.values()) if (ms.length >= 2) ms.forEach((m) => out.set(m.id, m));
  }
  let all = [...out.values()];
  if (all.some(isClusterRef)) {
    if (clusters !== 'skip') return { ids: [], cards: [], refused: 'cluster', held: [], center: null, groupId: null };
    all = all.filter((c) => !isClusterRef(c));
  }
  if (skipSeeds) all = all.filter((c) => !isSeed(c));
  const moving = all.filter((c) => !isStillUploading(c));
  const shared = moving.length ? moving[0].groupId : null;
  return {
    ids: moving.map((c) => c.id),
    cards: moving,
    refused: null,
    held: all.filter((c) => isStillUploading(c)),   // the caller says why they stayed
    center: centerOf(moving),
    // The one group every moving card belongs to, when there is one — its name
    // is the best suggestion there is.
    groupId: shared && moving.every((c) => c.groupId === shared) ? shared : null,
  };
}

function centerOf(cards) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cards) {
    if (isUnplaced(c)) continue;
    const x = Number(c.x), y = Number(c.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = Math.max(0, Number(c.w) || 0), h = Math.max(0, Number(c.h) || 0);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) };
}

// Words a camera, a phone or an OS puts in front of every file, which name
// nothing anybody is working on.
const GENERIC_STEMS = new Set([
  'img', 'image', 'images', 'dsc', 'dscf', 'dscn', 'dji', 'gopr', 'pxl', 'mvimg', 'photo', 'photos',
  'pic', 'picture', 'screenshot', 'screen', 'shot', 'recording', 'scan', 'untitled', 'file',
  'download', 'copy', 'new', 'video', 'mov', 'vid', 'clip', 'audio', 'document', 'doc',
]);
const STOP_WORDS = new Set(['at', 'on', 'of', 'the', 'and', 'a', 'an', 'to', 'in', 'for', 'from', 'by', 'with']);
const GENERIC_GROUPS = new Set(['group', 'untitled group', 'untitled', 'new group']);

const clip = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= NAME_MAX) return t;
  const cut = t.slice(0, NAME_MAX + 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > NAME_MAX / 2 ? cut.slice(0, sp) : t.slice(0, NAME_MAX)).trim();
};

const baseName = (name) => String(name || '').split(/[\\/]/).pop().replace(/\.[a-z0-9]{1,5}$/i, '');

// What a set of file names share, as words: "kitchen-ref_01.jpg" and
// "kitchen-ref_02.jpg" → "Kitchen ref". One name works too. Too short, or a
// camera's prefix, is not a name.
export function sharedStem(names) {
  const bases = (names || []).map(baseName).filter(Boolean);
  if (!bases.length) return null;
  let prefix = bases[0];
  for (const b of bases.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < b.length && prefix[i].toLowerCase() === b[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return null;
  }
  // "kitchen" and "kitten" share "kit", which is half a word: back off to the
  // last whole one.
  const isLetter = (ch) => /\p{L}/u.test(ch || '');
  if (isLetter(prefix[prefix.length - 1]) && bases.some((b) => isLetter(b[prefix.length]))) {
    prefix = prefix.replace(/\p{L}+$/u, '');
  }
  const tokens = prefix
    .replace(/[\d\s_\-.()[\]#,]+$/, '')   // the counter, and what joins it
    .replace(/[_\-.]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  // "Screenshot 2026-10-18 at" → nothing: a date and a joining word after a
  // camera's prefix are not a name either.
  while (tokens.length && (STOP_WORDS.has(tokens[tokens.length - 1].toLowerCase()) || !/\p{L}/u.test(tokens[tokens.length - 1]))) tokens.pop();
  const meaningful = tokens.filter((t) => /\p{L}/u.test(t) && !GENERIC_STEMS.has(t.toLowerCase()) && !STOP_WORDS.has(t.toLowerCase()));
  if ((meaningful.join('').match(/\p{L}/gu) || []).length < 3) return null;
  const words = tokens.join(' ');
  return clip(words.charAt(0).toUpperCase() + words.slice(1));
}

const fileNameOf = (c) => (c && !isClusterRef(c) && c.kind !== 'note' && c.kind !== 'doc' ? (c.fileName || null) : null);

export function suggestClusterName({ groupName = null, cards = [] } = {}) {
  const g = String(groupName || '').replace(/\s+/g, ' ').trim();
  if (g && !GENERIC_GROUPS.has(g.toLowerCase())) return clip(g);
  const stem = sharedStem((cards || []).map(fileNameOf).filter(Boolean));
  if (stem) return stem;
  for (const c of cards || []) {
    if (c?.kind !== 'note') continue;
    const line = htmlToText(c.html || c.body || '').split('\n').map((s) => s.trim()).find(Boolean);
    if (line) return clip(line);
  }
  return null;
}
