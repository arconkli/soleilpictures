// shareThisTurn — one request for every call made in the same turn.
//
// The effects of one React commit run in one synchronous pass, so when two of
// them ask for the same read (Workspace's mount asks for the profile twice)
// the second takes the first's promise. The share ends with the turn: a call
// made later, even while that request is still in flight, starts its own,
// because a request already in flight may have left before a save that the
// later caller is reading after (Settings re-reads right after each save).
//
// Pure apart from the map the caller owns; no imports.

export function shareThisTurn(inFlight, key, start) {
  const same = inFlight.get(key);
  if (same) return same;
  const promise = start();
  inFlight.set(key, promise);
  queueMicrotask(() => { if (inFlight.get(key) === promise) inFlight.delete(key); });
  return promise;
}
