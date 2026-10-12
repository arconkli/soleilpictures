// Is a failed /share or /c/ bundle load the LINK's fault, or the network's?
// Pure, so node tests can pin it (MEDIA-03).
//
// Every failure used to land on "This link is no longer live — expired or
// revoked, ask the owner for a new one": a dropped mobile connection, a
// PartyKit timeout and a Supabase 5xx all told a visitor holding a perfectly
// good link to go and bother its owner. Only an answer from the server that
// the link or board does not exist says that now; everything else is
// "Couldn't load this board" with a Retry.

// Statuses the party sends when it actually looked and the link is not good:
// 404 (expired / revoked / unpublished / not in the subtree) and 400 (no token
// or slug). 403 and 410 are the same verdict in any future wording.
const LINK_DEAD = new Set([400, 403, 404, 410]);

// 'invalid' → the link itself is bad; 'retry' → nothing is known about the
// link (fetch rejected, 5xx, 429, a body that did not parse).
export function bundleFailureKind(err) {
  const status = Number(err && err.status);
  return LINK_DEAD.has(status) ? 'invalid' : 'retry';
}

// The thrown value for a non-ok bundle response, carrying its status.
export function bundleHttpError(res) {
  const e = new Error('bundle-failed');
  e.status = res ? res.status : 0;
  return e;
}
