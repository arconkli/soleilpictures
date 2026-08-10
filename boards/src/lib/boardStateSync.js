// Make the ROOM responsible for persisting board_state, instead of the browser.
//
// Plain JS rather than TypeScript, and in src/lib rather than party/, for the
// reason opLog.ts already imports op_classifier.js from here: party code is
// bundled by esbuild without typechecking and cannot be unit-tested, and this
// module is the one place a mistake silently destroys a board. See
// boardStateSync.test.mjs.
//
// ── WHY ──────────────────────────────────────────────────────────────────────
//
// Every writer of board_state writes the WHOLE Y.Doc, because the column holds
// one base64 snapshot. The browser does that on a ~250ms debounce while a user
// is active (yboard.js snapTimer → saveBoardSnapshot), and /api/v1 did it once
// per card mutation: download the whole doc, decode, re-encode, upload. The
// cost of adding ONE card grew with the size of the board.
//
// Production already holds a doc of 596,720 bytes for TWO cards — Yjs history
// never shrinks, so the size tracks total edits ever, not current cards — and a
// Worker isolate has 128MB for the four copies that a read-modify-write needs.
// Bulk ingest was quadratic with a ceiling in the low thousands of cards.
//
// The room is the one place already holding the authoritative doc in memory all
// the time. Moving the write here makes an append cost O(update) for everyone:
// /api/v1 can push a delta and leave, and the browser stops uploading the whole
// board several times a second.
//
// It also removes a lost-update race. board_state is written with a blind
// full-document upsert, so two writers that loaded the same baseline overwrite
// each other — and the cards that lose keep their card_index rows, so they go
// on consuming the owner's cap and appearing in search while rendering nothing.
// One Durable Object per board, single-threaded, is a single writer.
//
// ── THE INVARIANT THAT MAKES THIS SAFE ───────────────────────────────────────
//
// A flush writes the room's doc OVER whatever is in board_state, so the room's
// doc must never be a subset of what is stored. That is what `load` buys:
// y-partykit calls it while constructing the doc and applies the result BEFORE
// binding DO storage (verified in y-partykit/dist/index.js — `load` is awaited
// and applied, then `bindState()`), so the room always starts at
// board_state ∪ DO-storage, and a Yjs merge only ever adds.
//
// This is not hypothetical. App.jsx:3653 already carries a workaround for the
// same hazard from the other direction — a fresh room whose empty in-memory doc
// gets persisted over a good snapshot, which the code comments describe as the
// board opening EMPTY and recompute_image_refs then stripping the image grant.
// Loading board_state into the room is what actually closes that.
//
// Deletions still work: a Yjs delete is an operation carried in the update, not
// an absence, so it survives the merge and lands in the flush.
//
// ── WHY A PLAIN UPSERT IS SAFE WHILE THE BROWSER ALSO WRITES ─────────────────
//
// For now there are two writers, and they do not need a compare-and-set. Both
// write a superset of board_state and they converge: the client is synced to
// the room and the room to the client, so the only divergence is the last few
// hundred ms of in-flight edits. Whichever write is momentarily stale is
// corrected by the next flush — the trailing one fires FLUSH_DEBOUNCE_MS after
// the last edit, by which point the room has received everything. The failure
// mode is a few seconds of staleness that heals itself, not loss.
//
// A writer that updates board_state while the room is DOWN is also fine, and
// this is what lets /api/v1 keep a direct fallback: `load` re-reads board_state
// on every DO boot, so anything written while the room was not running is
// picked up the next time it starts.

import * as Y from 'yjs';

// Base64 in chunks: `String.fromCharCode(...bytes)` on a whole document blows
// the argument limit somewhere around 100KB, and these are already larger.
const CHUNK = 0x8000;

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// y-partykit runs `callback` through lodash.debounce with maxWait, so a flush
// lands FLUSH_DEBOUNCE_MS after editing stops and no later than
// FLUSH_MAX_WAIT_MS into a continuous edit. Against the browser's ~250ms that
// is up to 40x fewer whole-document writes for the same board.
export const FLUSH_DEBOUNCE_MS = 2_000;
export const FLUSH_MAX_WAIT_MS = 10_000;

const svcHeaders = (key, extra) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  ...(extra || {}),
});

// Read board_state into a fresh Y.Doc, for y-partykit's `load` hook.
//
// Returning null on ANY failure is deliberate and is the most important line in
// this file: null means "carry on with DO storage alone", which is exactly
// today's behaviour. Treating an unreachable database as an empty board is the
// one bug here that would destroy data.
export async function loadBoardState({
  boardId, supabaseUrl, serviceRoleKey, fetchImpl = fetch, seen, storage,
}) {
  if (!serviceRoleKey) return null;
  try {
    // Skip the read entirely when the room already has its own persisted state.
    //
    // y-partykit calls `load` on EVERY doc construction, not only when its
    // storage is empty, so without this check every cold boot of a room paid a
    // full board_state download before the first client could finish
    // connecting. Measured at 4.36MB that was ~6s added to opening a large
    // board — a latency regression introduced by this file, in the one place
    // users would actually feel it.
    //
    // Non-empty DO storage is authoritative: it IS the live room state, which
    // is always a superset of board_state because that is what the flush below
    // writes. The one case where board_state is deliberately NEWER — a restore
    // — already wipes DO storage first (App.jsx forceResetBoardRoom), which is
    // precisely the empty case this still handles.
    if (storage) {
      const existing = await storage.list({ limit: 1 }).catch(() => null);
      if (existing && existing.size > 0) return null;
    }
    const res = await fetchImpl(
      `${supabaseUrl}/rest/v1/board_state?board_id=eq.${encodeURIComponent(boardId)}&select=doc`,
      { headers: svcHeaders(serviceRoleKey), signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      console.warn(`[boardStateSync ${boardId}] load failed status=${res.status}`);
      return null;
    }
    const rows = await res.json();
    const b64 = rows?.[0]?.doc;
    if (!b64) return null;

    const doc = new Y.Doc();
    Y.applyUpdate(doc, b64ToBytes(b64), 'soleil:cold-load');
    // Seed the dedupe cache, so a room that boots, syncs a client and changes
    // nothing does not immediately write back exactly what it just read.
    seen?.set(boardId, b64);
    return doc;
  } catch (e) {
    console.warn(`[boardStateSync ${boardId}] load threw: ${e?.message || e}`);
    return null;
  }
}

export async function flushBoardState(doc, { boardId, supabaseUrl, serviceRoleKey, fetchImpl = fetch, seen }) {
  if (!serviceRoleKey) return false;
  try {
    const b64 = bytesToB64(Y.encodeStateAsUpdate(doc));
    // A client's cold-load sync produces an update whose RESULT is identical to
    // what is already stored; re-uploading the whole document to say nothing is
    // the most common wasted write here.
    if (seen?.get(boardId) === b64) return false;

    const res = await fetchImpl(`${supabaseUrl}/rest/v1/board_state?on_conflict=board_id`, {
      method: 'POST',
      headers: svcHeaders(serviceRoleKey, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([{ board_id: boardId, doc: b64, updated_at: new Date().toISOString() }]),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[boardStateSync ${boardId}] flush failed status=${res.status} ${text.slice(0, 200)}`);
      return false;
    }
    // Only after a CONFIRMED write. Recording it on failure would suppress the
    // retry that the next update would otherwise produce.
    seen?.set(boardId, b64);
    return true;
  } catch (e) {
    console.warn(`[boardStateSync ${boardId}] flush threw: ${e?.message || e}`);
    return false;
  }
}

// The `load` + `callback` half of a board room's y-partykit options.
//
// Returned as options rather than installed as a listener (the way opLog is)
// because y-partykit reads both while CONSTRUCTING the doc and ignores options
// supplied afterwards. The same object must also go to the matching
// unstable_getYDoc call or y-partykit warns that the document was initialised
// with different options.
export function boardStateSync(opts) {
  // Per-room, so it cannot leak between boards sharing an isolate.
  const seen = new Map();
  const withSeen = { ...opts, seen };
  return {
    load: () => loadBoardState(withSeen),
    callback: {
      handler: (doc) => flushBoardState(doc, withSeen),
      debounceWait: FLUSH_DEBOUNCE_MS,
      debounceMaxWait: FLUSH_MAX_WAIT_MS,
    },
  };
}
