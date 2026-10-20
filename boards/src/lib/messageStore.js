// What this tab has done to a conversation that the last server read may not
// show yet. Pure, so node --test can pin it.
//
// A thread holds two things: `rows`, the server's snapshot (the newest page
// plus any history paged back to), and `writes`, an ordered log of local
// changes replayed over it — a message being sent, an optimistic reaction,
// edit or pin, a delete waiting out its undo, a row re-read after a peer's
// nudge. The screen shows applyWrites(rows, writes).
//
// A write lives until a server read that STARTED after the server
// acknowledged it lands: that read already reflects it, so pruneWrites drops
// it. A read that started earlier can't take it back — an older snapshot once
// removed a message you had just sent (COMMS-23); now it yields to the write.
// Writes the server hasn't acknowledged (a send in flight, a failed send kept
// for Retry, an optimistic patch) survive every read.
//
// A write: { opId, id, op: 'upsert' | 'patch' | 'remove', row?, patch?, ackedAt }
//   ackedAt — the epoch the server acknowledged it at, or null while in flight.
// The caller owns the epoch counter: bump it on every acknowledgement, and
// stamp each read with the counter's value when the read starts.

let opSeq = 0;
export function nextOpId() {
  opSeq += 1;
  return `op-${opSeq}`;
}

export function upsertWrite(row, { opId = nextOpId(), ackedAt = null } = {}) {
  return { opId, id: row.id, op: 'upsert', row, ackedAt };
}

export function patchWrite(id, patch, { opId = nextOpId(), ackedAt = null } = {}) {
  return { opId, id, op: 'patch', patch, ackedAt };
}

export function removeWrite(id, { opId = nextOpId(), ackedAt = null } = {}) {
  return { opId, id, op: 'remove', ackedAt };
}

// The server acknowledged a write. Its answer (the stored row, or the fields it
// settled on, e.g. the reaction map toggle_message_reaction returns) replaces
// the optimistic guess, so a later replay shows exactly what the server holds.
export function ackWrite(writes, opId, epoch, { row = null, patch = null } = {}) {
  return writes.map((w) => {
    if (w.opId !== opId) return w;
    const next = { ...w, ackedAt: epoch };
    if (row) next.row = row;
    if (patch) next.patch = { ...w.patch, ...patch };
    return next;
  });
}

export function updateWrite(writes, opId, fn) {
  return writes.map((w) => (w.opId === opId ? fn(w) : w));
}

// Undo an optimistic change that failed (or a send the user discarded).
export function dropWrite(writes, opId) {
  const next = writes.filter((w) => w.opId !== opId);
  return next.length === writes.length ? writes : next;
}

// A server read that started at `issuedAt` has landed: drop every write it
// already reflects. Same array back when nothing changes, so React can skip.
export function pruneWrites(writes, issuedAt) {
  const keep = writes.filter((w) => w.ackedAt == null || w.ackedAt > issuedAt);
  return keep.length === writes.length ? writes : keep;
}

const time = (m) => Date.parse(m?.created_at || '') || 0;
const unsent = (m) => !!m?.sendState;

// Sent rows in time order (id breaks ties); rows still being sent, or kept
// after a failed send, after them in the order they were written. An unsent
// row's created_at is this device's clock, which can be behind the server's:
// sorting it by that would drop it in among messages that arrived meanwhile.
export function sortRows(rows) {
  const sent = rows.filter((m) => !unsent(m));
  const pending = rows.filter(unsent);
  sent.sort((a, b) => (time(a) - time(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return pending.length ? sent.concat(pending) : sent;
}

// rows + writes → what the thread shows.
export function applyWrites(rows, writes) {
  const base = rows || [];
  if (!writes || writes.length === 0) return base;
  const out = base.slice();
  let reorder = false;
  for (const w of writes) {
    const at = out.findIndex((m) => m.id === w.id);
    if (w.op === 'remove') {
      if (at >= 0) out.splice(at, 1);
      continue;
    }
    if (w.op === 'patch') {
      if (at >= 0) out[at] = { ...out[at], ...w.patch };
      continue;
    }
    // upsert. A send the server already has (a read found its id) shows the
    // server's row: the message was saved, even if its own answer was lost.
    if (at >= 0) {
      if (w.ackedAt == null && unsent(w.row)) continue;
      out[at] = { ...out[at], ...w.row };
    } else {
      out.push(w.row);
      reorder = true;
    }
  }
  return reorder ? sortRows(out) : out;
}

// A reaction toggle as the server applies it: { emoji: [userIds] }, the emoji
// dropped when its last reactor leaves.
export function toggleReactionMap(reactions, emoji, userId) {
  const next = { ...(reactions || {}) };
  const who = new Set(next[emoji] || []);
  if (who.has(userId)) who.delete(userId); else who.add(userId);
  if (who.size === 0) delete next[emoji]; else next[emoji] = [...who];
  return next;
}
