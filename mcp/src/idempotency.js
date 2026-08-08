// Idempotency keys for the MCP server's POSTs.
//
// Its own module so the property that matters can be tested directly: the key
// must be STABLE for the same call and DIFFERENT across processes. Both halves
// were wrong before — the key was `crypto.randomUUID()` per request, while the
// comment above it and the README both promised that a retry would replay
// rather than repeat. It did the exact opposite: every attempt got a fresh key,
// so a model re-issuing add_cards after a timeout added the cards twice. The
// feature was documented twice and implemented nowhere.

// One id per process. Everything below is scoped to it.
export const RUN_ID = crypto.randomUUID();

// sha256(runId : tool : args).
//
//   · Hashing (tool, args) is what makes a genuine retry replay: the same call
//     produces the same key, and /api/v1 returns the first response instead of
//     doing the work twice.
//   · Mixing in the run id scopes that to ONE process. The API remembers keys
//     for 24 hours, so without it "add the same note again tomorrow" would
//     silently return yesterday's card and add nothing. A retry happens inside
//     one session; a deliberate repeat generally does not.
//
// The residual case — asking for the identical write twice in one session, on
// purpose — returns the first result rather than making a second copy. That is
// the trade, and it is the right way round: a duplicated card is a visible mess
// someone has to clean up, while a deduplicated one still leaves the board in
// the state that was asked for.
export async function idempotencyKey(tool, args, runId = RUN_ID) {
  const data = new TextEncoder().encode(`${runId}:${tool}:${JSON.stringify(args ?? {})}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
