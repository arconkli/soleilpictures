// What status the party sends when get_share_bundle / get_public_board_bundle
// fails: 404 when the database looked and refused the link, the upstream 5xx
// when nothing is known about it (MEDIA-03, read by lib/shareLoadError.js).
//
// The trap: PostgREST answers the RPCs' own refusal — `raise … using errcode
// 'P0002'` ("invalid or expired share link", "no such public board") — with
// HTTP 500, not 404. Passing every 5xx through therefore told everyone holding
// an expired link that the board was "temporarily unavailable" and offered a
// Retry that could never work. That is what the first PartyServer deploy did,
// on 2026-10-17, before any client used it.
//
// So the status alone decides nothing; the body does. A PostgREST error body
// carries the SQLSTATE in `code`. A code that names an infrastructure failure
// (no connection, a timeout, an overloaded or restarting server, a deadlock)
// says nothing about the link and stays retryable. Any other code is the
// database answering, and the answer was no.
//
// Pure, for node tests (bundleRefusal.test.mjs); bundled into party/upload.ts.

// SQLSTATE classes and codes that are about the server, not the request.
const RETRYABLE_SQLSTATE = [
  /^08/,          // connection exception
  /^53/,          // insufficient resources
  /^57/,          // operator intervention: 57014 statement timeout, 57P0x shutdown
  /^58/,          // system error
  /^XX/,          // internal error
  /^40001$/,      // serialization failure
  /^40P01$/,      // deadlock detected
];

// PostgREST's own errors: PGRST000-PGRST003 mean it could not reach or use the
// database. Its other codes describe the request (and come with 4xx).
const RETRYABLE_PGRST = /^PGRST00[0-3]$/;

export function bundleRefusalStatus(status, bodyText) {
  const s = Number(status) || 0;
  if (s > 0 && s < 500) return 404;
  let code = '';
  try {
    const body = JSON.parse(bodyText || '');
    if (body && typeof body.code === 'string') code = body.code;
  } catch (_) { /* not a PostgREST error body: a gateway or a timeout */ }
  if (!code) return s >= 500 ? s : 502;
  if (RETRYABLE_PGRST.test(code)) return s >= 500 ? s : 503;
  if (code.startsWith('PGRST')) return 404;
  if (RETRYABLE_SQLSTATE.some((re) => re.test(code))) return s >= 500 ? s : 503;
  return 404;
}
