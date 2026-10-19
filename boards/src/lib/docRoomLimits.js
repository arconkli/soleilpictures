// Limits on a shared doc's live room (DocParty) for people outside the
// cluster. One place: the party enforces them, and the docs quote them
// through {{fact:…}} (scripts/gen-docs.mjs). Members editing from the cluster
// are not held to the guest limits.
export const DOC_ROOM_FRAME_MAX_BYTES = 1024 * 1024;          // one message from a guest
export const DOC_ROOM_GUEST_UPDATES = 300;                    // edits a guest may send…
export const DOC_ROOM_GUEST_UPDATES_WINDOW_MS = 10 * 1000;    // …in this window
export const DOC_ROOM_GUEST_AWARENESS_PER_S = 5;              // cursor/presence messages a second
export const DOC_ROOM_MAX_CONNECTIONS = 50;                   // people in one shared doc at once
export const DOC_ROOM_GUEST_DOC_MAX_BYTES = 25 * 1024 * 1024; // past this size guests can only read
export const DOC_ROOM_SILENT_CLOSE_MS = 5 * 60 * 1000;        // a socket that says nothing this long
export const DOC_ROOM_RECHECK_MS = 60 * 1000;                 // who may still be here, re-asked

// A sliding count: hit(now) → true while under `limit` hits in `windowMs`.
export function rateWindow(limit, windowMs) {
  const times = [];
  return {
    hit(now = Date.now()) {
      while (times.length && now - times[0] >= windowMs) times.shift();
      if (times.length >= limit) return false;
      times.push(now);
      return true;
    },
    get count() { return times.length; },
  };
}
