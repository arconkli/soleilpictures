// Yjs helpers — byte/base64 encoding + Y.Map ⇄ plain object converters.

import * as Y from 'yjs';

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

// Convert a plain card object into a Y.Map suitable for inserting into the
// cards Y.Map. Returns the new Y.Map.
export function cardToYMap(card) {
  const m = new Y.Map();
  for (const [k, v] of Object.entries(card)) m.set(k, v);
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
export function readCards(ydoc) {
  const cards = ydoc.getMap('cards');
  const out = [];
  cards.forEach((ym, key) => {
    const card = yMapToCard(ym);
    card.id = key;
    out.push(card);
  });
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
