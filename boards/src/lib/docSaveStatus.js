// A doc's save line (the doc look's footer, and the line under a phone's
// title: hooks/useDocStatus.js), saying only what is proven.
//
// "Saved" means the cluster's live room has stored every change made here:
// the line asks the room over its socket and the room answers (lib/roomAck.js
// has why an answer is proof), or a whole-board save held them all. "Saving…"
// is a change on its way. When the room can't be reached for a few seconds the
// line says so, and whether the changes are kept on this device: lib/yboard.js
// drafts them to it, and marks the doc when a draft didn't take.
//
// One tracker per doc (acquireSaveTracker), however many lines show it, and
// only while one does: its questions are messages the room is billed for.

import * as Y from 'yjs';
import { ROOM_ANSWERS, ackAsk, readAck } from './roomAck.js';

export const SAVE_TIMING = Object.freeze({
  askDelayMs: 300,      // a burst of changes settles this long before the room is asked
  askEveryMs: 1000,     // and the room is asked at most this often
  askTimeoutMs: 5000,   // an answer this late isn't coming
  retryMaxMs: 8000,     // asked again, backing off to this
  graceMs: 3000,        // down this long before the line says so
});

const systemClock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id),
};

// `doc`: the cluster's Y.Doc; every change made to it here counts. `room`: its
// live room, y-partyserver's YProvider (lib/yPartyKit.js hangs it on the doc
// as `_soleilRoom`), which may come later (setRoom), or never, where there is
// no realtime. `boardId`: whose whole-board saves (yboard.js's
// `soleil-board-save-state`) and end of access count.
export function createSaveTracker({ doc = null, room = null, boardId = null, clock = systemClock } = {}) {
  const listeners = new Set();
  let snap = {
    mode: 'none',         // 'room' once the cluster's live room is known
    live: false, everLive: false, downLong: false, ended: false,
    acks: null,           // whether this connection's room answers: true, false (a room from before), null (not known yet)
    pending: false, viewOnly: false, failed: false, savedAt: null,
  };
  const set = (patch) => {
    let changed = false;
    for (const k in patch) if (snap[k] !== patch[k]) { changed = true; break; }
    if (!changed) return;
    snap = { ...snap, ...patch };
    for (const fn of [...listeners]) fn();
  };

  const timers = new Set();
  const after = (ms, fn) => {
    const id = clock.set(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id) => { if (id != null) { clock.clear(id); timers.delete(id); } };

  // The changes made here, counted, and how many of them are proven stored.
  let edits = 0;
  let covered = 0;
  let sentUpTo = 0;
  const pendingNow = () => edits > covered;
  const confirm = (upTo) => {
    covered = Math.max(covered, upTo);
    set({ pending: pendingNow(), savedAt: clock.now(), failed: false });
  };
  const noteEdit = () => {
    edits++;
    set({ pending: true });
    askSoon();
  };
  // Applied updates (a peer's through the room, a copy kept on this device)
  // were stored by whoever made them; everything else is a change made here,
  // counted where something can say it was stored: a board's saves, or a room.
  const onDocUpdate = (_update, origin, _doc, tr) => {
    if (tr ? tr.local === false : origin === room) return;
    if (boardId || room) noteEdit();
  };

  // The whole-board save: 'saved' is board_state holding every change made
  // here, 'error' one that failed. 'sent' is one that wasn't due, which proves
  // nothing, except to a room from before the answers, as the line always took it.
  const backstop = (state) => {
    if (snap.ended) return;
    if (state === 'saving') { if (!doc) noteEdit(); }
    else if (state === 'saved') confirm(edits);
    else if (state === 'sent') { sentUpTo = edits; if (snap.acks === false) confirm(edits); }
    else if (state === 'error') set({ failed: true });
  };

  // ── the room ──────────────────────────────────────────────────────────────
  let n = 0;
  let asking = null;        // the question on its way: { n, upTo, k }
  let askTimer = null;
  let lateTimer = null;
  let graceTimer = null;
  let lastAskAt = -Infinity;
  let retryMs = SAVE_TIMING.askEveryMs;
  const backoff = () => { const ms = retryMs; retryMs = Math.min(retryMs * 2, SAVE_TIMING.retryMaxMs); return ms; };
  const live = () => !!(room && room.wsconnected && room.synced);
  const trying = () => !!room && room.shouldConnect !== false;
  // Whether this connection's room answers: a room that does says so first,
  // and lib/yPartyKit.js marks the socket; synced without it, it's from before.
  const answers = () => (room.ws?._acks === true ? true : room.synced ? false : null);

  const ask = () => {
    askTimer = null;
    if (snap.ended || snap.viewOnly || asking || !live() || !pendingNow() || answers() !== true) return;
    const c = doc.clientID;
    const q = { n: ++n, upTo: edits, k: Y.getState(doc.store, c) };
    try { room.sendMessage(ackAsk(c, q.n)); } catch (_) { askSoon(backoff()); return; }
    asking = q;
    lastAskAt = clock.now();
    lateTimer = after(SAVE_TIMING.askTimeoutMs, () => {
      // A socket that died unnoticed (yPartyKit's keepalive replaces it), or a
      // room too busy to answer: still Saving…, and asked again.
      lateTimer = null;
      asking = null;
      askSoon(backoff());
    });
  };
  function askSoon(delay = SAVE_TIMING.askDelayMs) {
    // An answer asks again, and so does the room coming back.
    if (asking || !live() || answers() !== true) return;
    cancel(askTimer);
    askTimer = after(Math.max(delay, lastAskAt + SAVE_TIMING.askEveryMs - clock.now()), ask);
  }

  const refresh = () => {
    if (!room || snap.ended) return;
    const acks = answers();
    if (live()) {
      cancel(graceTimer); graceTimer = null;
      set({ live: true, everLive: true, downLong: false, acks });
    } else {
      // Let go of on purpose (lib/partyPark.js) is quiet; trying, for longer
      // than a blip, isn't.
      if (!trying()) { cancel(graceTimer); graceTimer = null; }
      else if (graceTimer == null && !snap.downLong) {
        graceTimer = after(SAVE_TIMING.graceMs, () => {
          graceTimer = null;
          if (!live() && trying() && !snap.ended) set({ downLong: true });
        });
      }
      set({ live: false, downLong: trying() && snap.downLong, acks });
    }
    if (acks === false && sentUpTo > covered) confirm(sentUpTo);
    if (pendingNow()) askSoon();
  };
  const onStatus = (e) => {
    if (e?.status === 'connecting') {
      // A new connection: what the last one's room said doesn't carry over.
      retryMs = SAVE_TIMING.askEveryMs;
      set({ viewOnly: false });
    } else if (e?.status === 'disconnected') {
      // A question on the old socket is never answered.
      asking = null;
      cancel(lateTimer); lateTimer = null;
    }
    refresh();
  };
  const onMessage = (text) => {
    if (text === ROOM_ANSWERS) {
      if (room.ws) room.ws._acks = true;   // as yPartyKit marks it, whichever hears it first
      refresh();
      return;
    }
    const a = readAck(text);
    if (!a || !asking || a.n !== asking.n) return;
    const q = asking;
    asking = null;
    cancel(lateTimer); lateTimer = null;
    // A read-only connection: the room drops its writes.
    if (!a.w) { set({ viewOnly: true }); return; }
    if (a.have >= q.k) {
      retryMs = SAVE_TIMING.askEveryMs;
      confirm(q.upTo);
      if (pendingNow()) askSoon();
    } else {
      askSoon(backoff());
    }
  };
  const detachRoom = () => {
    if (!room) return;
    room.off('status', onStatus);
    room.off('sync', refresh);
    room.off('custom-message', onMessage);
  };
  function setRoom(p) {
    if (!p || p === room || snap.ended || (doc && p.doc !== doc)) return;
    detachRoom();
    room = p;
    if (!doc) { doc = p.doc; doc.on('update', onDocUpdate); }
    p.on('status', onStatus);
    p.on('sync', refresh);
    p.on('custom-message', onMessage);
    set({ mode: 'room' });
    refresh();
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  const onWindowSave = (e) => { if (e?.detail?.boardId === boardId) backstop(e.detail.state); };
  const onEnded = (e) => { if (e?.detail?.boardId === boardId) end(); };
  const win = boardId && typeof window !== 'undefined' ? window : null;
  win?.addEventListener('soleil-board-save-state', onWindowSave);
  win?.addEventListener('soleil-board-access-ended', onEnded);
  doc?.on('update', onDocUpdate);
  const r0 = room;
  room = null;
  setRoom(r0);

  function end() {
    set({ ended: true });
    asking = null;
    timers.forEach((id) => clock.clear(id));
    timers.clear();
  }

  return {
    get: () => snap,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    backstop,
    setRoom,
    end,
    dispose() {
      end();
      detachRoom();
      doc?.off('update', onDocUpdate);
      win?.removeEventListener('soleil-board-save-state', onWindowSave);
      win?.removeEventListener('soleil-board-access-ended', onEnded);
      listeners.clear();
    },
  };
}

// The tracker for a doc, shared by every line that shows it; released by the
// last one, which takes its listeners and timers with it. Without a doc yet,
// one of its own, which follows the whole-board saves alone.
const shared = new WeakMap();
export function acquireSaveTracker(doc, { room = null, boardId = null } = {}) {
  if (!doc) {
    const tracker = createSaveTracker({ boardId });
    return { tracker, release: () => tracker.dispose() };
  }
  let s = shared.get(doc);
  if (!s) { s = { tracker: createSaveTracker({ doc, boardId }), users: 0 }; shared.set(doc, s); }
  s.users++;
  s.tracker.setRoom(room);
  let released = false;
  return {
    tracker: s.tracker,
    release() {
      if (released) return;
      released = true;
      if (--s.users > 0) return;
      s.tracker.dispose();
      if (shared.get(doc) === s) shared.delete(doc);
    },
  };
}

// What the line says: `text` is the footer's, `short` the phone's line's.
// `kept`: whether this device holds a draft of the changes (doc._soleilKept).
export function saveLine(s, { online = true, now = Date.now(), kept = true } = {}) {
  if (s.viewOnly) return { state: 'viewonly', text: "View only — changes aren't saved", short: 'View only' };
  if (s.ended) return { state: 'ended', text: "Can't save — access ended", short: "Can't save" };
  const held = kept ? ' — changes kept on this device' : ' — keep this tab open';
  if (!online) return { state: 'offline', text: s.pending ? `Offline${held}` : 'Offline', short: 'Offline' };
  const down = s.mode === 'room' && s.downLong;
  if (s.pending && s.failed && (s.mode !== 'room' || down || s.acks === false)) {
    return { state: 'error', text: `Couldn't save${held}`, short: "Couldn't save" };
  }
  if (down) {
    const word = s.everLive ? 'Reconnecting' : 'Connecting';
    return { state: 'reconnecting', text: s.pending ? `${word}${held}` : `${word}…`, short: `${word}…` };
  }
  if (s.pending) return { state: 'saving', text: 'Saving…', short: 'Saving…' };
  return { state: 'saved', text: savedText(s.savedAt, now), short: 'Saved' };
}

function savedText(savedAt, now) {
  if (!savedAt) return 'All changes saved';
  const ago = Math.max(0, Math.floor((now - savedAt) / 1000));
  if (ago < 5) return 'Saved just now';
  if (ago < 60) return `Saved ${ago}s ago`;
  if (ago < 3600) return `Saved ${Math.floor(ago / 60)}m ago`;
  return `Saved ${Math.floor(ago / 3600)}h ago`;
}
