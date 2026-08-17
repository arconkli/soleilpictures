// collabSession.js — did anyone actually work together?
//
// The invite side of collaboration was well measured: invite_sent,
// invite_link_created, invite_link_claimed, share_link_copied. The other side
// emitted nothing at all — presence, co-editing and comments were silent — so
// the growth loop was unfalsifiable. We could watch invitations go out and
// never tell whether two people were ever on a board at the same time, which
// is the part that actually predicts a return.
//
// This turns a stream of presence updates into one event per real overlap.
// Pure and node-testable, because the interesting behaviour is entirely in the
// edges: sockets flap, a peer's tab wakes for two seconds, someone navigates
// between boards, and none of those are collaboration.

// Below this, an "overlap" is a reconnect blip rather than two people working.
export const MIN_OVERLAP_MS = 5000;

/**
 * @param {object} opts
 * @param {() => number} opts.now    injectable clock
 * @param {number} opts.minMs        overlaps shorter than this are discarded
 * @returns {{update: Function, end: Function, peek: Function}}
 *
 * update(boardId, peerCount) and end() each return an emission
 * `{ board_id, peak_peers, ms }` or null. The caller logs it; this module
 * never imports the emitter, which is what keeps it testable.
 */
export function createCollabTracker({ now = () => Date.now(), minMs = MIN_OVERLAP_MS } = {}) {
  let cur = null;   // { boardId, startedAt, peak }

  function close(at) {
    if (!cur) return null;
    const ms = at - cur.startedAt;
    const out = (ms >= minMs)
      ? { board_id: cur.boardId, peak_peers: cur.peak, ms }
      : null;   // a flicker is not a session
    cur = null;
    return out;
  }

  return {
    update(boardId, peerCount) {
      const t = now();
      const alone = !boardId || !(peerCount > 0);

      // Left the board, or everyone else did.
      if (alone) return close(t);

      // Moved to a different board while still sharing — the previous overlap
      // is over on its own terms, and a new one starts here.
      if (cur && cur.boardId !== boardId) {
        const ended = close(t);
        cur = { boardId, startedAt: t, peak: peerCount };
        return ended;
      }

      if (!cur) { cur = { boardId, startedAt: t, peak: peerCount }; return null; }
      if (peerCount > cur.peak) cur.peak = peerCount;
      return null;
    },

    /** Tab closing or component unmounting — bank whatever is open. */
    end() { return close(now()); },

    /** Test/debug view of the open overlap. */
    peek() { return cur ? { ...cur } : null; },
  };
}
