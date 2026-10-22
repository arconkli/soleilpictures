// Presence across a shared doc's mirror (party/bridge.ts ↔ party/doc.ts): the
// doc's readers and its cluster's members see each other's cursors, carets and
// selections in THAT doc, and nothing else of each other.
//
// The board room is the hub. A doc room sends its guests' presence to the
// board, which shows it to the members and passes it on to the doc's other
// room (edit ↔ view); the board sends its members' presence in the doc to each
// doc room. What crosses is docPresenceOf(): the name and color, and the doc
// fields (docCursor, docCaret, docSelection, set by components/DocPresence.jsx)
// whose boardId is this doc's card. A member's canvas cursor, location or user
// id never crosses; neither does a guest's. Each peer crosses as p:<client id>.
//
// The caret and selection are Yjs relative positions, and the mirror keeps the
// doc's own Yjs ids (docRoomBridge.js), so a position resolves on either side.
//
// The wire format is y-protocols' awareness update (a count, then client id,
// clock and JSON state for each), so each side applies it with
// applyAwarenessUpdate and the room's own broadcast does the rest.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

// How long a burst of presence changes waits before it crosses.
export const PRESENCE_FLUSH_MS = 200;
export const PRESENCE_MAX_ENTRIES = 200;
const PRESENCE_STATE_MAX = 4096;
const DOC_FIELDS = ['docCursor', 'docCaret', 'docSelection'];

// The part of a presence that shows this doc, or null when none of it does.
export function docPresenceOf(state, cardKey, clientId) {
  if (!state || typeof state !== 'object' || !state.user || typeof state.user !== 'object' || !cardKey) return null;
  const out = {};
  let here = false;
  for (const f of DOC_FIELDS) {
    const v = state[f];
    if (v && typeof v === 'object' && v.boardId === cardKey) { out[f] = v; here = true; }
  }
  if (!here) return null;
  const u = state.user;
  out.user = {
    id: `p:${Number(clientId) >>> 0}`,
    name: String(u.name || '').slice(0, 80),
    color: typeof u.color === 'string' ? u.color.slice(0, 32) : '#4f8df8',
    ...(u.guest ? { guest: true } : {}),
  };
  return JSON.stringify(out).length > PRESENCE_STATE_MAX ? null : out;
}

// [{ id, clock, state | null }] → an awareness update.
export function encodePresence(entries) {
  const list = (entries || []).slice(0, PRESENCE_MAX_ENTRIES);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, list.length);
  for (const e of list) {
    encoding.writeVarUint(enc, Number(e.id) >>> 0);
    encoding.writeVarUint(enc, Math.max(0, Number(e.clock) || 0));
    encoding.writeVarString(enc, JSON.stringify(e.state ?? null));
  }
  return encoding.toUint8Array(enc);
}

// An awareness update → [{ id, clock, state | null }], or [] when it does not
// read as one. At most PRESENCE_MAX_ENTRIES.
export function decodePresence(bytes) {
  try {
    const dec = decoding.createDecoder(bytes);
    const n = decoding.readVarUint(dec);
    if (n > PRESENCE_MAX_ENTRIES) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const id = decoding.readVarUint(dec);
      const clock = decoding.readVarUint(dec);
      const raw = decoding.readVarString(dec);
      if (raw.length > PRESENCE_STATE_MAX) return [];
      const state = JSON.parse(raw);
      out.push({ id, clock, state: state && typeof state === 'object' ? state : null });
    }
    return out;
  } catch (_) {
    return [];
  }
}
