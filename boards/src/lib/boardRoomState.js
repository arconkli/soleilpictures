// How a board's room reads and writes board_state on PartyServer.
//
// Plain JS in src/lib, for the reason boardStateSync.js gives: party code is
// bundled without typechecking, and this is the one place a mistake silently
// destroys a board. See boardRoomState.test.mjs.
//
// ── WHY NOT boardStateSync.js ────────────────────────────────────────────────
//
// boardStateSync.js is what the PartyKit room ran: a blind full-document upsert,
// trusting that the room's doc is always a superset of what is stored. That held
// while there was one room per board. Moving hosts breaks it for a few days: a
// tab that has not reloaded keeps its socket to the OLD room, which keeps
// flushing its own view over board_state, and the new room would flush its view
// straight back. Each would erase the other's edits. The old room cannot be
// changed (PartyKit stopped accepting deploys on 2026-10-16), so the new one has
// to be the one that never overwrites what it has not seen.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────
//
// A flush is a compare-and-set on updated_at: write only if board_state still
// holds what this room last saw. If anyone else wrote in between (the old room,
// a browser's backstop save, /api/v1 falling back when it could not reach the
// room), the write matches no row, and the room reads what is there, MERGES it
// into its own doc, and tries again. A Yjs merge only ever adds (a deletion is an
// operation the update carries), so nobody's edits are lost, and whatever the
// other writer had reaches the people in this room as an ordinary update.
//
// ── THE ONE WRITE THAT MUST NOT BE MERGED ────────────────────────────────────
//
// A version restore (bulletproofRestore, the cross-board move, workspace
// rewind) REPLACES the board: it writes the restored bytes to board_state and
// then POSTs /reset, which wipes the room. Merging that write would bring back
// everything the restore removed. The gap between the write and the /reset is
// a few hundred milliseconds, and under PartyKit a flush landing in it undid the
// restore (the "known gap" in bulletproofRestore). So a foreign write is never
// merged at once: the room waits FOREIGN_GRACE_MS, writing nothing, and only
// then merges. A /reset inside the window stops this object (stop()) before it
// merges anything.
//
// ── FAILURE IS NEVER EMPTINESS ───────────────────────────────────────────────
//
// An unreachable database is not an empty board. Every read that fails leaves
// `lastSeen` UNKNOWN, and a flush with an unknown baseline reads before it
// writes. Nothing here can turn a failed read into an overwrite.

import * as Y from 'yjs';
import { bytesToB64, b64ToBytes } from './boardStateSync.js';

// Origin for everything merged in from board_state. opLog.ts skips this origin,
// so another writer's content is not logged a second time as this room's edit
// (the old room already logged it, and a browser's own edits reach the log
// through whichever room it is connected to).
export const MERGE_ORIGIN = 'soleil:cold-load';

export const FOREIGN_GRACE_MS = 3_000;
const READ_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 20_000;

// Sent with every request this room makes, so a board_state write can be told
// apart in request.headers (PostgREST) from the old room's and a browser's.
export const WRITER_HEADER = 'x-soleil-writer';
export const WRITER_NAME = 'board-room';

const headers = (key, extra) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  [WRITER_HEADER]: WRITER_NAME,
  ...(extra || {}),
});

const stateUrl = (supabaseUrl, query) => `${supabaseUrl}/rest/v1/board_state?${query}`;

// { ok: true, exists, doc, updatedAt } or { ok: false, status, reason }.
// `doc` is the stored base64 ('' for a root made empty by
// get_or_create_personal_workspace), or null when withDoc is false.
export async function readBoardState({
  boardId, supabaseUrl, serviceRoleKey, fetchImpl = fetch, withDoc = true,
}) {
  if (!serviceRoleKey) return { ok: false, status: 0, reason: 'no service key' };
  try {
    const select = withDoc ? 'doc,updated_at' : 'updated_at';
    const res = await fetchImpl(
      stateUrl(supabaseUrl, `board_id=eq.${encodeURIComponent(boardId)}&select=${select}`),
      { headers: headers(serviceRoleKey), signal: AbortSignal.timeout(READ_TIMEOUT_MS) },
    );
    if (!res.ok) return { ok: false, status: res.status, reason: await res.text().catch(() => '') };
    const rows = await res.json();
    if (!Array.isArray(rows)) return { ok: false, status: res.status, reason: 'not an array' };
    if (rows.length === 0) return { ok: true, exists: false, doc: null, updatedAt: null };
    return {
      ok: true,
      exists: true,
      doc: withDoc ? (rows[0].doc ?? '') : null,
      updatedAt: rows[0].updated_at ?? null,
    };
  } catch (e) {
    return { ok: false, status: 0, reason: String(e?.message || e) };
  }
}

// Write `b64` only if board_state is still what this room last saw.
//   expected: the updated_at string the room last saw, or null when the room
//             KNOWS there is no row (then this is an insert that refuses to
//             replace one).
// → { ok: true, updatedAt } | { ok: false, conflict: true }
//   | { ok: false, conflict: false, status, reason }
export async function writeBoardStateIfUnchanged({
  boardId, b64, expected, supabaseUrl, serviceRoleKey, fetchImpl = fetch, now = () => new Date(),
}) {
  if (!serviceRoleKey) return { ok: false, conflict: false, status: 0, reason: 'no service key' };
  const updatedAt = now().toISOString();
  try {
    let res;
    if (expected === null) {
      res = await fetchImpl(stateUrl(supabaseUrl, 'on_conflict=board_id&select=updated_at'), {
        method: 'POST',
        headers: headers(serviceRoleKey, { Prefer: 'resolution=ignore-duplicates,return=representation' }),
        body: JSON.stringify([{ board_id: boardId, doc: b64, updated_at: updatedAt }]),
        signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      });
    } else {
      // encodeURIComponent turns the '+' of a UTC offset into %2B. Left raw it
      // would read as a space, the filter would match nothing, and every flush
      // would look like a conflict.
      res = await fetchImpl(
        stateUrl(supabaseUrl, `board_id=eq.${encodeURIComponent(boardId)}&updated_at=eq.${encodeURIComponent(expected)}&select=updated_at`),
        {
          method: 'PATCH',
          headers: headers(serviceRoleKey, { Prefer: 'return=representation' }),
          body: JSON.stringify({ doc: b64, updated_at: updatedAt }),
          signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
        },
      );
    }
    if (!res.ok) {
      return { ok: false, conflict: false, status: res.status, reason: (await res.text().catch(() => '')).slice(0, 300) };
    }
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return { ok: false, conflict: false, status: res.status, reason: 'not an array' };
    if (rows.length === 0) return { ok: false, conflict: true };
    return { ok: true, updatedAt: rows[0].updated_at ?? updatedAt };
  } catch (e) {
    return { ok: false, conflict: false, status: 0, reason: String(e?.message || e) };
  }
}

// The restore marker. perform_board_restore (version history, workspace rewind)
// and mark_board_restored (bulletproofRestore, 0414) advance
// board_state_version.version when they REPLACE a board. Nothing else does:
// ordinary edits move latest_seq, not version.
// → { ok: true, version: number|null } | { ok: false }
export async function readRestoreVersion({ boardId, supabaseUrl, serviceRoleKey, fetchImpl = fetch }) {
  if (!serviceRoleKey) return { ok: false };
  try {
    const res = await fetchImpl(
      `${supabaseUrl}/rest/v1/board_state_version?board_id=eq.${encodeURIComponent(boardId)}&select=version`,
      { headers: headers(serviceRoleKey), signal: AbortSignal.timeout(READ_TIMEOUT_MS) },
    );
    if (!res.ok) return { ok: false };
    const rows = await res.json();
    if (!Array.isArray(rows)) return { ok: false };
    const v = rows.length ? Number(rows[0].version) : null;
    return { ok: true, version: Number.isFinite(v) ? v : null };
  } catch (_) {
    return { ok: false };
  }
}

// The room's side of board_state. One per board room; `getDoc` returns the
// room's live Y.Doc (looked up on every call, never captured).
export class BoardRoomState {
  constructor({
    boardId, supabaseUrl, serviceRoleKey, getDoc,
    // Called, once, when a foreign write turns out to be a restore: the room
    // must reset itself (exactly what /reset does) rather than merge it.
    onRestore = null,
    // Until this time (ms), a foreign write is overwritten rather than merged.
    // Set by the room for RESET_FENCE_MS after a /reset or an adopted restore.
    fenceUntil = 0,
    fetchImpl = fetch, graceMs = FOREIGN_GRACE_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
    log = (...a) => console.warn(...a), now, clock = () => Date.now(),
  }) {
    this.boardId = boardId;
    this.cfg = { boardId, supabaseUrl, serviceRoleKey, fetchImpl, ...(now ? { now } : {}) };
    this.getDoc = getDoc;
    this.graceMs = graceMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.log = log;
    // undefined = unknown (never read, or the last read failed)
    // null      = known: there is no row
    // string    = the updated_at of the row this room last read or wrote
    this.lastSeen = undefined;
    this.lastFlushedB64 = null;
    this.stopped = false;
    this.dirty = false;           // a flush failed and has not succeeded since
    this.inFlight = null;         // the running flush, so flushes never overlap
    this.again = false;           // a flush was asked for while one ran
    this.forceNext = false;       // ...and that ask was a forced one
    this.foreignTimer = null;     // the pending, deferred merge of a foreign write
    this.onRestore = onRestore;
    this.fenceUntil = fenceUntil;
    this.clock = clock;
    // board_state_version.version at load: a number, null (no row), or
    // undefined (the read failed, so no write can be recognised as a restore).
    this.versionBaseline = undefined;
  }

  get pendingForeign() { return this.foreignTimer !== null; }

  // Cold start: merge board_state into `doc` (the room's doc-to-be, already
  // holding whatever the room kept locally). Never throws. On a failed read
  // the doc is left as it is and lastSeen stays unknown, so the first flush
  // reads again before it writes.
  async loadInto(doc) {
    const [cur, ver] = await Promise.all([
      readBoardState({ ...this.cfg, withDoc: true }),
      readRestoreVersion(this.cfg),
    ]);
    if (ver.ok) this.versionBaseline = ver.version;
    if (!cur.ok) {
      this.log(`[boardRoomState ${this.boardId}] load failed status=${cur.status} ${String(cur.reason).slice(0, 200)}`);
      return false;
    }
    this.lastSeen = cur.exists ? cur.updatedAt : null;
    if (cur.doc) {
      try {
        Y.applyUpdate(doc, b64ToBytes(cur.doc), MERGE_ORIGIN);
      } catch (e) {
        // A row that will not decode is not a reason to stop the room. Leave
        // lastSeen unknown so nothing overwrites it without a fresh read.
        this.lastSeen = undefined;
        this.log(`[boardRoomState ${this.boardId}] stored doc did not decode: ${e?.message || e}`);
        return false;
      }
    }
    return true;
  }

  // Record that board_state holds exactly `doc` as it is now, so the next
  // flush can skip writing the same bytes back. Used once, after loadInto,
  // when the merged doc is byte-identical to the row.
  noteStored(b64) { this.lastFlushedB64 = b64; }

  // Persist the room's doc. Serialized: a call while one runs is folded into
  // one more pass after it. Resolves when the doc is written, refused, or
  // deferred to the grace window; never throws.
  flush({ force = false } = {}) {
    if (this.stopped) return Promise.resolve(false);
    if (this.inFlight) {
      this.again = true;
      if (force) this.forceNext = true;
      return this.inFlight;
    }
    this.inFlight = this._flushLoop(force).finally(() => {
      this.inFlight = null;
      if (this.again && !this.stopped) {
        this.again = false;
        const f = !!this.forceNext;
        this.forceNext = false;
        void this.flush({ force: f });
      }
    });
    return this.inFlight;
  }

  async _flushLoop(force) {
    if (this.stopped) return false;
    // A foreign write is waiting out its grace window; writing now would put
    // this room's view over it before it is merged. The merge flushes.
    if (this.pendingForeign) return false;
    const doc = this.getDoc();
    if (!doc) return false;
    const b64 = bytesToB64(Y.encodeStateAsUpdate(doc));
    if (!force && !this.dirty && b64 === this.lastFlushedB64) return false;

    if (this.lastSeen === undefined) {
      // Unknown baseline: read before writing, every time.
      const cur = await readBoardState({ ...this.cfg, withDoc: false });
      if (this.stopped) return false;
      if (!cur.ok) { this.dirty = true; return false; }
      if (cur.exists) { this.deferForeign(); return false; }
      this.lastSeen = null;
    }

    const res = await writeBoardStateIfUnchanged({ ...this.cfg, b64, expected: this.lastSeen });
    if (res.ok) {
      // A /reset that lands while this write is in flight cannot be undone by
      // it: the restore's own write either came first (and this one then
      // matched no row) or comes after (and replaces this one).
      this.lastSeen = res.updatedAt;
      this.lastFlushedB64 = b64;
      this.dirty = false;
      return true;
    }
    if (res.conflict) {
      // Someone else wrote. Merge it after the grace window, never now.
      this.deferForeign();
      return false;
    }
    this.dirty = true;
    this.log(`[boardRoomState ${this.boardId}] flush failed status=${res.status} ${res.reason || ''}`);
    return false;
  }

  // Cheap probe (updated_at only). Called on the room's alarm, so content that
  // reached board_state some other way reaches this room within a minute even
  // when nobody in it is typing.
  async checkForeign() {
    if (this.stopped || this.pendingForeign) return;
    if (this.lastSeen === undefined) { this.deferForeign(); return; }
    const cur = await readBoardState({ ...this.cfg, withDoc: false });
    if (this.stopped || !cur.ok) return;
    const seen = cur.exists ? cur.updatedAt : null;
    if (seen !== this.lastSeen) this.deferForeign();
  }

  // A failed flush is retried on the room's alarm as well as on the next edit.
  async retryIfDirty() {
    if (this.dirty && !this.stopped && !this.pendingForeign) await this.flush({ force: true });
  }

  deferForeign() {
    if (this.stopped || this.foreignTimer) return;
    this.foreignTimer = this.setTimer(() => {
      this.foreignTimer = null;
      void this.mergeForeign();
    }, this.graceMs);
  }

  // Decide what a foreign write is, then act on it:
  //   a restore (the marker moved)        → the room resets itself; no merge.
  //   inside the fence after a reset      → overwrite it; never merge.
  //   anything else                       → merge it and write the union.
  async mergeForeign() {
    if (this.stopped) return false;
    const [cur, ver] = await Promise.all([
      readBoardState({ ...this.cfg, withDoc: true }),
      readRestoreVersion(this.cfg),
    ]);
    if (this.stopped) return false;
    if (!cur.ok) {
      // Leave the baseline unknown: the next flush reads again before writing.
      this.lastSeen = undefined;
      this.dirty = true;
      return false;
    }
    if (ver.ok && typeof ver.version === 'number') {
      if (typeof this.versionBaseline === 'number' && ver.version > this.versionBaseline) {
        // Somebody replaced this board. Merging would bring back everything the
        // restore removed, and overwriting would undo it outright.
        this.log(`[boardRoomState ${this.boardId}] restore detected (version ${this.versionBaseline} → ${ver.version}); resetting`);
        this.stop();
        try { this.onRestore?.(); } catch (_) { /* the room logs its own failure */ }
        return false;
      }
      if (this.versionBaseline === undefined || this.versionBaseline === null) this.versionBaseline = ver.version;
    }
    const doc = this.getDoc();
    if (!doc) return false;
    if (this.clock() < this.fenceUntil) {
      // Just after a reset, whatever arrives from elsewhere is a stale echo of
      // the board BEFORE it: the frozen old room's pending debounced flush, or a
      // backstop save from a tab that has not remounted yet. Merging it would
      // undo the reset. Write this room's (reset) state over it.
      this.lastSeen = cur.exists ? cur.updatedAt : null;
      this.lastFlushedB64 = null;
      return this.flush({ force: true });
    }
    let changed = false;
    if (cur.doc) {
      const mark = () => { changed = true; };
      doc.on('update', mark);
      try {
        Y.applyUpdate(doc, b64ToBytes(cur.doc), MERGE_ORIGIN);
      } catch (e) {
        this.log(`[boardRoomState ${this.boardId}] foreign doc did not decode: ${e?.message || e}`);
        // Do not adopt a baseline we could not read: overwriting it later
        // would destroy whatever it held. Try again after another window.
        this.lastSeen = undefined;
        this.dirty = true;
        return false;
      } finally {
        doc.off('update', mark);
      }
    }
    this.lastSeen = cur.exists ? cur.updatedAt : null;
    // A browser in this room saving the same document it got from the room is
    // the commonest foreign write. When the merge added nothing and the row
    // already holds exactly this room's bytes, there is nothing to write back.
    if (!changed && cur.doc && bytesToB64(Y.encodeStateAsUpdate(doc)) === cur.doc) {
      this.lastFlushedB64 = cur.doc;
      this.dirty = false;
      return true;
    }
    // Otherwise the row lacks something this room holds: write the union.
    this.lastFlushedB64 = null;
    return this.flush({ force: true });
  }

  // A /reset is replacing this board. Drop every pending merge and write.
  stop() {
    this.stopped = true;
    if (this.foreignTimer) {
      this.clearTimer(this.foreignTimer);
      this.foreignTimer = null;
    }
  }
}
