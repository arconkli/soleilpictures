// op_classifier.js
//
// Given a "before" Y.Doc state and an incoming Y.Update (bytes), figure out:
//   - op_kind: a semantic label like 'card.add', 'card.delete', 'card.move',
//              'text.insert', 'text.delete', 'meta.update', 'media.attach', 'op.bulk'
//   - card_ids: text[] of card IDs touched by this update (for cherry-pick / filter)
//   - r2_keys: text[] of r2 storage keys referenced (for history-aware orphan sweep)
//
// Used by the PartyKit DO before persisting each Y.Update to board_ops, and by
// migration tooling that needs to reconstruct semantic history from raw bytes.
//
// Approach: clone the before state into a tmp Y.Doc, observe the canonical Y
// types (cards, groups, docPageContent, etc.), apply the update, and inspect
// the resulting events. This is O(update size + #affected types) and runs in
// microseconds for typical edits.

import * as Y from 'yjs';

const CARDS_MAP = 'cards';
const GROUPS_MAP = 'groups';
const ARROWS_ARRAY = 'arrows';
const STROKES_ARRAY = 'strokes';
const DOC_PAGES_ARRAY = 'docPages';
const DOC_PAGE_CONTENT = 'docPageContent';
const DOC_BOOKMARKS = 'docBookmarks';
const DOC_COMMENTS = 'docComments';
const META_MAP = 'meta';

// Walk an arbitrary value and collect R2 keys it references.
// R2 references are strings of the form 'r2:<uuid-or-key>'. They appear on
// card values like { kind: 'image', url: 'r2:abc-123' }.
function collectR2Keys(value, out) {
  if (value == null) return;
  if (typeof value === 'string') {
    if (value.startsWith('r2:')) out.add(value.slice(3));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectR2Keys(v, out);
    return;
  }
  if (value instanceof Y.Map) {
    value.forEach((v) => collectR2Keys(v, out));
    return;
  }
  if (value instanceof Y.Array) {
    value.forEach((v) => collectR2Keys(v, out));
    return;
  }
  if (typeof value === 'object') {
    for (const k of Object.keys(value)) collectR2Keys(value[k], out);
  }
}

function pickCardR2Keys(yMap, out) {
  // Look at known fields that carry r2 references on cards.
  const fields = ['url', 'src', 'audioUrl', 'videoUrl', 'image', 'thumbnail'];
  for (const f of fields) {
    const v = yMap.get?.(f);
    if (typeof v === 'string' && v.startsWith('r2:')) out.add(v.slice(3));
  }
  // Also scan all string values as a fallback.
  yMap.forEach?.((v) => collectR2Keys(v, out));
}

/**
 * Decode a Y.Update against a known prior state, return classification.
 *
 * @param {Uint8Array} beforeState - Y.encodeStateAsUpdate(beforeDoc)
 * @param {Uint8Array} updateBytes - the incoming Y.Update
 * @returns {{ op_kind: string, card_ids: string[], r2_keys: string[], affected_types: string[] }}
 */
export function classifyUpdate(beforeState, updateBytes) {
  const tmp = new Y.Doc();
  Y.applyUpdate(tmp, beforeState, 'classifier:seed');

  const cards = tmp.getMap(CARDS_MAP);
  const groups = tmp.getMap(GROUPS_MAP);
  const arrows = tmp.getArray(ARROWS_ARRAY);
  const strokes = tmp.getArray(STROKES_ARRAY);
  const docPages = tmp.getArray(DOC_PAGES_ARRAY);
  const docPageContent = tmp.getMap(DOC_PAGE_CONTENT);
  const docBookmarks = tmp.getMap(DOC_BOOKMARKS);
  const docComments = tmp.getMap(DOC_COMMENTS);
  const meta = tmp.getMap(META_MAP);

  // Counters extracted inside event handlers (Y.js requires reading
  // event.changes within the handler, not later).
  const cardIds = new Set();
  const r2Keys = new Set();
  const affectedTypes = new Set();
  let cardAdds = 0;
  let cardDeletes = 0;
  let cardMoves = 0;
  let cardOtherUpdates = 0;
  let textInsert = 0;
  let textDelete = 0;
  let metaUpdates = 0;
  let mediaAttach = 0;
  let docPageEdits = 0;

  const processCardsEvent = (event) => {
    const target = event.target;
    if (target === cards) {
      const keys = event.changes?.keys;
      if (!keys) return;
      keys.forEach((change, key) => {
        cardIds.add(key);
        if (change.action === 'add') {
          cardAdds++;
          const newYMap = cards.get(key);
          if (newYMap) pickCardR2Keys(newYMap, r2Keys);
          if (newYMap && (newYMap.get('kind') === 'image' ||
                          newYMap.get('kind') === 'audio' ||
                          newYMap.get('kind') === 'video')) {
            mediaAttach++;
          }
        } else if (change.action === 'delete') {
          cardDeletes++;
        } else if (change.action === 'update') {
          cardOtherUpdates++;
        }
      });
    } else if (target instanceof Y.Map) {
      const path = event.path;
      if (Array.isArray(path) && path.length >= 1) {
        const cardId = path[0];
        if (typeof cardId === 'string') cardIds.add(cardId);
      }
      const k = event.changes?.keys;
      if (k && k.size > 0) {
        let posChange = false;
        let nonPosChange = false;
        k.forEach((_change, key) => {
          if (key === 'x' || key === 'y' || key === 'z' || key === 'w' || key === 'h') {
            posChange = true;
          } else {
            nonPosChange = true;
          }
        });
        if (posChange && !nonPosChange) cardMoves++;
        else cardOtherUpdates++;
      }
    } else if (event.constructor?.name === 'YTextEvent') {
      const path = event.path;
      if (Array.isArray(path) && path.length >= 1 && typeof path[0] === 'string') {
        cardIds.add(path[0]);
      }
      const delta = event.delta || [];
      for (const d of delta) {
        if (d.insert) textInsert++;
        else if (d.delete) textDelete++;
      }
    }
  };

  const processDocEvent = (event) => {
    docPageEdits++;
    if (event.constructor?.name === 'YTextEvent') {
      const delta = event.delta || [];
      for (const d of delta) {
        if (d.insert) textInsert++;
        else if (d.delete) textDelete++;
      }
    }
  };

  const subscribe = (label, type, processor) => {
    const handler = (evts) => {
      affectedTypes.add(label);
      for (const e of evts) {
        if (processor) processor(e);
      }
    };
    type.observeDeep?.(handler);
    return () => type.unobserveDeep?.(handler);
  };

  const unsubs = [
    subscribe('cards', cards, processCardsEvent),
    subscribe('groups', groups, null),
    subscribe('arrows', arrows, null),
    subscribe('strokes', strokes, null),
    subscribe('docPages', docPages, processDocEvent),
    subscribe('docPageContent', docPageContent, processDocEvent),
    subscribe('docBookmarks', docBookmarks, processDocEvent),
    subscribe('docComments', docComments, processDocEvent),
    subscribe('meta', meta, () => { metaUpdates++; }),
  ];

  try {
    Y.applyUpdate(tmp, updateBytes, 'classifier:apply');
  } catch (e) {
    for (const u of unsubs) try { u(); } catch (_) {}
    tmp.destroy();
    return {
      op_kind: 'op.error',
      card_ids: [],
      r2_keys: [],
      affected_types: [],
      error: String(e?.message || e),
    };
  }

  for (const u of unsubs) try { u(); } catch (_) {}
  tmp.destroy();

  // media.attach is a specialization of card.add — every image/audio/video
  // card-add is also counted as media.attach. Subtract so they don't both
  // dominate the signal vote.
  const netCardAdds = Math.max(0, cardAdds - mediaAttach);

  let op_kind = 'op.other';
  const signals = [];
  if (netCardAdds) signals.push(['card.add', netCardAdds]);
  if (cardDeletes) signals.push(['card.delete', cardDeletes]);
  if (cardMoves) signals.push(['card.move', cardMoves]);
  if (cardOtherUpdates) signals.push(['card.update', cardOtherUpdates]);
  if (textInsert) signals.push(['text.insert', textInsert]);
  if (textDelete) signals.push(['text.delete', textDelete]);
  if (metaUpdates) signals.push(['meta.update', metaUpdates]);
  if (mediaAttach) signals.push(['media.attach', mediaAttach]);
  if (docPageEdits && !textInsert && !textDelete) signals.push(['doc.edit', docPageEdits]);

  if (signals.length === 1) {
    op_kind = signals[0][0];
  } else if (signals.length > 1) {
    signals.sort((a, b) => b[1] - a[1]);
    const total = signals.reduce((s, x) => s + x[1], 0);
    if (signals[0][1] / total >= 0.7) op_kind = signals[0][0];
    else op_kind = 'op.bulk';
  }

  return {
    op_kind,
    card_ids: Array.from(cardIds),
    r2_keys: Array.from(r2Keys),
    affected_types: Array.from(affectedTypes),
  };
}

/**
 * Classify by running the update against an EMPTY initial state, then taking
 * the resulting Y.Doc's contents as the description. Useful for migration
 * (no "before" state for legacy snapshots).
 *
 * @param {Uint8Array} updateBytes
 * @returns {{ op_kind: string, card_ids: string[], r2_keys: string[] }}
 */
export function classifyStandalone(updateBytes) {
  const empty = Y.encodeStateAsUpdate(new Y.Doc());
  return classifyUpdate(empty, updateBytes);
}

/**
 * Cheap content hash for an update. SHA-256 over the bytes, hex-encoded.
 * Used as `update_hash` on board_ops rows and for batch hash verification.
 *
 * Browser/runtime-agnostic: uses Web Crypto when present, otherwise a
 * deterministic fallback (FNV-1a; sufficient for dedup, not cryptographic).
 */
export async function hashUpdateBytes(bytes) {
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const arr = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
    return 'sha256:' + hex;
  }
  // Fallback non-crypto hash (only used in environments without WebCrypto).
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = (h * 0x01000193) >>> 0;
  }
  return 'fnv:' + h.toString(16).padStart(8, '0');
}
