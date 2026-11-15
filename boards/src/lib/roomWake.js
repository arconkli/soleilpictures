// What a hibernating board room decides from timestamps instead of timers.
//
// party/board.ts uses this. Cloudflare evicts the room after a quiet spell and
// re-runs its constructor and onStart on the next event, so a setInterval or
// anything kept only in memory does not survive. The room instead wakes on a
// storage alarm, asks these pure functions whether a periodic job is due or a
// socket has gone silent, and keeps the little it must remember (who is on a
// socket, what it last heard) in socket attachments and storage. Pure, so it is
// tested in roomWake.test.mjs; party/*.ts cannot be loaded by node.

// How often the periodic checks (foreign-write probe, retry, together tick) run.
export const CHECK_EVERY_MS = 60_000;
// The alarm comes this soon while people are working, and this late when
// sockets are open but nothing has happened.
export const ACTIVE_ALARM_MS = 60_000;
export const QUIET_ALARM_MS = 5 * 60_000;
// An empty room keeps retrying a failed save for this long, then stops: the
// edits wait in the room's local copy and the next open's cold start saves them.
// Without a limit a save that can never land would wake the room every minute.
export const EMPTY_RETRY_FOR_MS = 15 * 60_000;
// "Working" lasts this long after the last real activity.
export const ACTIVE_FOR_MS = 2 * 60_000;
// A socket that has said nothing for this long is closed.
export const SILENT_CLOSE_MS = 5 * 60_000;
// How often the room writes what it last heard / its last activity to storage.
export const HEARD_SAVE_EVERY_MS = 60_000;
export const ACTIVITY_SAVE_EVERY_MS = 30_000;

// A socket's presence is kept in its attachment (small, and it survives a nap)
// so the room can show it again and remove it properly when the socket ends.
export const PRESENCE_KEY = 'soleilAw';
export const PRESENCE_FIELD_MAX = 512;
export const PRESENCE_MAX = 2048;
export const PRESENCE_IDS_MAX = 4;

export function checkDue(now, lastCheckAt) {
  return now - (Number(lastCheckAt) || 0) >= CHECK_EVERY_MS;
}

// ms until the next alarm, or null when there is nothing to wake for. A save
// that failed (dirty) has a retry coming while sockets are open, and in an empty
// room for EMPTY_RETRY_FOR_MS after the later of its first failure and the
// room's last activity (the room emptying counts as one, party/board.ts
// roomEmptied), so a save that failed while people worked still gets its full
// window once they leave; an empty room with a save
// or a merge still running (busy) is checked again soon, because that work can
// fail after this was asked.
export function nextAlarmIn({ now, sockets, lastActivityAt, dirty, dirtySince, busy }) {
  const active = now - (Number(lastActivityAt) || 0) < ACTIVE_FOR_MS;
  if (sockets > 0) return dirty || active ? ACTIVE_ALARM_MS : QUIET_ALARM_MS;
  if (dirty) {
    const since = Math.max(Number(dirtySince) || now, Number(lastActivityAt) || 0);
    return now - since < EMPTY_RETRY_FOR_MS ? ACTIVE_ALARM_MS : null;
  }
  return busy ? ACTIVE_ALARM_MS : null;
}

// The latest of several times, each a number of ms or a Date; 0 when none is.
export function lastHeardAt(...times) {
  let best = 0;
  for (const t of times) {
    let n = 0;
    if (typeof t === 'number') n = t;
    else if (t instanceof Date) n = t.getTime();
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

export function isSilent(now, heardAt) {
  return heardAt > 0 && now - heardAt > SILENT_CLOSE_MS;
}

const isPlain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const jsonLen = (v) => {
  try {
    const s = JSON.stringify(v);
    return typeof s === 'string' ? s.length : null;
  } catch (_) {
    return null;
  }
};

// The part of a presence state worth keeping on a socket: `user` always, and
// every other field that is small. A cursor or selection is cheap to lose, a
// huge field is not worth the attachment's room.
export function presenceToKeep(state) {
  if (!isPlain(state)) return null;
  const copy = {};
  if (state.user !== undefined && state.user !== null) copy.user = state.user;
  for (const [k, v] of Object.entries(state)) {
    if (k === 'user' || v === null || v === undefined) continue;
    const n = jsonLen(v);
    if (n !== null && n <= PRESENCE_FIELD_MAX) copy[k] = v;
  }
  if (Object.keys(copy).length === 0) return null;
  const total = jsonLen(copy);
  if (total === null) return null;
  if (total > PRESENCE_MAX) {
    const u = jsonLen(copy.user);
    if (copy.user !== undefined && u !== null && u <= PRESENCE_MAX) return { user: copy.user };
    return null;
  }
  return copy;
}

const isId = (n) => Number.isInteger(n) && n >= 0;

// [id, clock, state] for each of a socket's awareness ids that still has a state.
export function keptPresence(ids, awareness) {
  try {
    const out = [];
    if (!Array.isArray(ids)) return out;
    for (const id of ids.slice(0, PRESENCE_IDS_MAX)) {
      if (!isId(id)) continue;
      const state = awareness.states.get(id);
      const clock = awareness.meta.get(id)?.clock;
      if (state === undefined || typeof clock !== 'number') continue;
      const kept = presenceToKeep(state);
      if (kept) out.push([id, clock, kept]);
    }
    return out;
  } catch (_) {
    return [];
  }
}

// Put kept presence back into a woken room's awareness. Sets the maps directly
// and emits nothing, on purpose: nobody should be told, and it is not a move.
// Its point is that the room can later remove the id, with clock + 1, when the
// socket ends. An id already present is left alone. → how many were restored.
export function restorePresence(awareness, entries, now) {
  let n = 0;
  try {
    if (!Array.isArray(entries)) return 0;
    for (const e of entries) {
      if (!Array.isArray(e)) continue;
      const [id, clock, state] = e;
      if (!isId(id) || !isId(clock) || !isPlain(state)) continue;
      if (awareness.states.has(id)) continue;
      awareness.states.set(id, state);
      awareness.meta.set(id, { clock, lastUpdated: now });
      n++;
    }
  } catch (_) { /* return what was restored */ }
  return n;
}

export function sameEntries(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
