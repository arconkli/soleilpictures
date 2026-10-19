// Answer a close that arrived without a status code (party/board.ts,
// party/workspace.ts).
//
// A browser's ws.close() with no code sends an empty Close frame, which the
// runtime hands the server as 1005. partyserver (0.5.10, closeQuietly) never
// answers a 1005: it takes it for a transport that is already gone. So the
// browser waits out its own closing-handshake timer before the socket counts as
// closed, about a minute in Chrome, and until then YProvider cannot open a new
// one: connect() stands down while the old socket is still set. y-partyserver's
// disconnect() and destroy() close exactly that way, so this was every parked
// tab and every switch to another board. Measured 2026-10-18 on the live party:
// close() had not completed on a board room after 70 s, and took 10 s and an
// abnormal 1006 on a workspace room; close(1000) took 16 ms and 39 ms.

const NO_STATUS = 1005;

export function answerEmptyClose(conn, code) {
  if (code !== NO_STATUS) return;
  try { conn.close(1000, ''); } catch (_) { /* already closed */ }
}
