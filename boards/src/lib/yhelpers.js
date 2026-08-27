// Yjs helpers — byte/base64 encoding + Y.Map ⇄ plain object converters.

import * as Y from 'yjs';

// Re-exported so anything OUTSIDE boards/ (the scout service) can get Yjs from
// the same module instance these helpers use, instead of resolving its own copy.
//
// This matters more than it looks. Node resolves bare specifiers by walking up
// from the importing FILE, so in a repo checkout scout/src/* finds
// scout/node_modules/yjs while boards/src/lib/* finds boards/node_modules/yjs —
// two separate Yjs modules. Yjs itself warns about this ("breaks constructor
// checks"): a Y.Doc built by one copy fails the internal instanceof checks of
// the other, so readCards() on a foreign doc can silently misbehave. It bit the
// dryrun harness, which is precisely the tool used to prove an ingest was
// correct. The Docker image installs once at the root and has one copy, so this
// is a local-only hazard — which makes it worse, not better: it only misleads
// during verification.
export { Y };

// Uint8Array → base64 (browser-safe, no Buffer).
export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// base64 → Uint8Array.
export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ── Copying cards ────────────────────────────────────────────────────────────
//
// A card is NOT a flat bag of scalars. note cards carry a live Y.XmlFragment
// (`noteFragment`), doc cards carry a whole store (`docPages` Y.Array +
// `docPageContent`/`docComments`/`docMeta` Y.Maps), grid cards carry
// `gridCells`/`gridMeta`. readCards/yMapToCard hand those out BY REFERENCE —
// deliberately, see cardHash below.
//
// A Yjs type can only ever belong to one place. Re-inserting one that is
// already integrated re-runs its _integrate, where `_prelimContent` is already
// null → "Cannot read properties of null (reading 'forEach')" out of
// YMap._integrate, or "(reading 'length')" out of YArray._integrate. That is
// the production yjs-transact cluster: 9 users, every cross-board move and
// every ⌘D of a note/doc/grid card.
//
// And it does damage on the way down. AbstractType._integrate assigns
// `this.doc = y` and `this._item = item` BEFORE the throw, so the SOURCE
// board's live fragment gets repointed at the destination doc — which, on a
// cross-board move, is a temp doc that is destroyed moments later. The board
// the user is still looking at is corrupted by a move that "failed".
//
// So: deep-copy into fresh, un-integrated types. cloneYXmlNode below is the
// node-level clone docState has always used for the sheet migration ("Yjs
// types can't be re-parented"); cloneYValue applies that idea to every type a
// card value can be, and cardToYMap applies it to a whole card.

// Is this a Y type that ALREADY lives in a document? `doc` is assigned by
// _integrate on every AbstractType subclass, so it's the one uniform marker.
// A freshly-constructed (prelim) type has doc === null and is safe to insert
// as-is — that's the legitimate "I just made this for you" case, and cloning
// it would be wrong (prelim types don't answer forEach/toArray yet).
function isIntegratedYType(v) {
  return isYType(v) && v.doc != null;
}

// Deep-clone an XML node (XmlElement | XmlText) — the two things that can be a
// child of a fragment. XmlText carries its inline marks in the delta;
// XmlElement recurses over attributes + children. Inline leaves (hardBreak,
// mentions) are sibling XmlElements, so the recursion covers them.
export function cloneYXmlNode(src) {
  if (src && typeof src.toDelta === 'function' && typeof src.toArray !== 'function') {
    const t = new Y.XmlText();
    try { t.applyDelta(src.toDelta()); } catch (_) {}
    return t;
  }
  if (src && typeof src.toArray === 'function' && src.nodeName) {
    const el = new Y.XmlElement(src.nodeName);
    try {
      const attrs = src.getAttributes ? src.getAttributes() : {};
      for (const k of Object.keys(attrs || {})) el.setAttribute(k, attrs[k]);
    } catch (_) {}
    const kids = [];
    for (const c of src.toArray()) { const cl = cloneYXmlNode(c); if (cl) kids.push(cl); }
    if (kids.length) el.insert(0, kids);
    return el;
  }
  return null;
}

// Deep-clone any Y type a card value can be, into a fresh un-integrated one.
// Duck-typed rather than instanceof: constructor names are mangled in prod
// builds, AND scout can resolve a second copy of yjs (see the note on the Y
// re-export above), which breaks instanceof outright.
export function cloneYValue(v) {
  if (!isYType(v)) return v;
  // XmlFragment / XmlElement — createTreeWalker is unique to the XML types and
  // separates them from Y.Array, which also answers toArray.
  if (typeof v.createTreeWalker === 'function') {
    if (v.nodeName) return cloneYXmlNode(v);
    const frag = new Y.XmlFragment();
    const kids = [];
    for (const c of v.toArray()) { const cl = cloneYXmlNode(c); if (cl) kids.push(cl); }
    if (kids.length) frag.insert(0, kids);
    return frag;
  }
  if (typeof v.toArray === 'function') {            // Y.Array
    const arr = new Y.Array();
    const items = v.toArray().map(cloneYValue);
    if (items.length) arr.push(items);
    return arr;
  }
  if (typeof v.toDelta === 'function') {            // Y.Text
    const t = new Y.Text();
    try { t.applyDelta(v.toDelta()); } catch (_) {}
    return t;
  }
  if (typeof v.forEach === 'function' && typeof v.set === 'function') {   // Y.Map
    const m = new Y.Map();
    v.forEach((val, k) => { m.set(k, cloneYValue(val)); });
    return m;
  }
  // Unknown Y type: drop it rather than re-integrate and corrupt the source.
  // Losing a value is recoverable; a repointed _item is not.
  return undefined;
}

// Convert a plain card object into a Y.Map suitable for inserting into the
// cards Y.Map. Returns the new Y.Map.
//
// Any value that is a live (integrated) Y type is deep-copied first — see the
// block comment above. This is deliberately handled HERE rather than at the
// call sites: there are a dozen of them (duplicate, cross-board move + its
// undo, cross-pane drop, scout ingest), several of which read cards straight
// out of a doc, and the failure mode of missing one is silent corruption of
// the board the user is looking at.
export function cardToYMap(card) {
  const m = new Y.Map();
  for (const [k, v] of Object.entries(card)) {
    if (isIntegratedYType(v)) {
      const copy = cloneYValue(v);
      if (copy !== undefined) m.set(k, copy);
    } else {
      m.set(k, v);
    }
  }
  return m;
}

// Convert a Y.Map (a card row) back into a plain object for rendering.
export function yMapToCard(ym) {
  const o = {};
  ym.forEach((v, k) => { o[k] = v; });
  return o;
}

// Read all cards out of the cards Y.Map as a plain array of objects.
// Anchors `card.id` to the Y.Map key — historically `id` was stored in
// the value too, but if the two ever drift (peer corruption, an old
// migration), code that does `m.delete(card.id)` becomes a silent no-op
// and effects that depend on cards loop forever. The key is canonical.
//
// Cards are memoized by content hash so unchanged cards return the SAME
// object reference between calls. This lets per-card React.memo (and any
// downstream useMemo keyed on card identity) actually short-circuit — a
// single card edit no longer reshuffles all N card object identities,
// even though the surrounding array is rebuilt.
const readCardsCache = new WeakMap(); // ydoc → Map<id, { hash, card }>

// A live Yjs type (Y.Map/Y.Array/Y.XmlFragment/…). Duck-typed (constructor
// names are mangled by the bundler) on toJSON + an observe method.
function isYType(v) {
  return v !== null && typeof v === 'object'
    && typeof v.toJSON === 'function'
    && (typeof v.observe === 'function' || typeof v.observeDeep === 'function' || v._item !== undefined);
}

function cardHash(card) {
  // Sort keys so iteration-order quirks don't cause false negatives.
  const keys = Object.keys(card).sort();
  let s = '';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = card[k];
    s += k + '=';
    // NEVER JSON.stringify a nested Y type. Doc cards carry their whole
    // doc store (docPageContent/docPages/…) as Y types; serializing them
    // here re-encoded EVERY doc on the board on EVERY keystroke (readCards
    // runs per ydoc update). RichDocCard observes its own content for the
    // preview, so the card object identity doesn't need to change on edits.
    if (isYType(v)) { s += 'Y|'; continue; }
    s += (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v);
    s += '|';
  }
  return s;
}

export function readCards(ydoc) {
  const cards = ydoc.getMap('cards');
  let cache = readCardsCache.get(ydoc);
  if (!cache) {
    cache = new Map();
    readCardsCache.set(ydoc, cache);
  }
  const seen = new Set();
  const out = [];
  cards.forEach((ym, key) => {
    seen.add(key);
    const fresh = yMapToCard(ym);
    fresh.id = key;
    const hash = cardHash(fresh);
    const prev = cache.get(key);
    if (prev && prev.hash === hash) {
      out.push(prev.card);
    } else {
      cache.set(key, { hash, card: fresh });
      out.push(fresh);
    }
  });
  // Evict cache entries for cards that were removed.
  if (cache.size > seen.size) {
    for (const k of [...cache.keys()]) {
      if (!seen.has(k)) cache.delete(k);
    }
  }
  return out;
}

// Read arrows array.
export function readArrows(ydoc) {
  const arr = ydoc.getArray('arrows');
  return arr.toArray().map(v => (v && typeof v.toJSON === 'function') ? v.toJSON() : v);
}

// Read drawing strokes array.
export function readStrokes(ydoc) {
  const arr = ydoc.getArray('strokes');
  return arr.toArray().map(v => (v && typeof v.toJSON === 'function') ? v.toJSON() : v);
}

// Card groups — keyed by groupId. Each value is a Y.Map of
// { id, name, outline:bool, color, width }. Cards reference a
// group via `groupId` on the card row. Members move together; the
// optional outline draws a soft pill around the bounding box.
export function readGroups(ydoc) {
  const map = ydoc.getMap('groups');
  const out = [];
  map.forEach((ym, id) => {
    const o = { id };
    ym.forEach((v, k) => { o[k] = v; });
    out.push(o);
  });
  return out;
}

// Grid shared state — both are plain-object Y.Maps keyed by id (the values are
// plain objects, not nested Y types, so a layout edit is a whole-record LWW which
// is the acceptable v1 model). Returned as objects keyed by id so the renderer can
// do templates[card.templateId]; callers wanting a list use Object.values.
export function readGridTemplates(ydoc) {
  const map = ydoc.getMap('gridTemplates');
  const out = {};
  map.forEach((v, id) => { out[id] = (v && typeof v.toJSON === 'function') ? { id, ...v.toJSON() } : { id, ...v }; });
  return out;
}
export function readGridSequences(ydoc) {
  const map = ydoc.getMap('gridSequences');
  const out = {};
  map.forEach((v, id) => { out[id] = (v && typeof v.toJSON === 'function') ? { id, ...v.toJSON() } : { id, ...v }; });
  return out;
}
