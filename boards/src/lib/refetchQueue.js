// refetchQueue: run a "refetch the whole list" at most one at a time, never
// drop a request, and never apply a result after its owner has gone.
//
// The realtime hooks refetch a list whenever a postgres_changes event lands.
// The comment hook used to guard that with a busy flag that simply DROPPED any
// event arriving while a refetch was in flight, so the second of two close
// writes (often your own just-posted comment, which relies on that refetch to
// appear at all) never showed. Its flag was also shared across board changes
// and its result unguarded, so board A's late refetch could paint A's
// comments over board B.
//
// Here a request made while one is running sets `pending`, and exactly one
// trailing run follows, which sees every write before it. stop() makes every
// later result a no-op, for the effect's cleanup.
//
// Pure and dependency-free: see refetchQueue.test.mjs.

export function createRefetchQueue(fetchRows, applyRows, onError) {
  let alive = true;
  let inFlight = false;
  let pending = false;

  const run = () => {
    if (!alive) return;
    if (inFlight) { pending = true; return; }
    inFlight = true;
    pending = false;
    Promise.resolve()
      .then(fetchRows)
      .then(
        (rows) => { if (alive) applyRows(rows); },
        (err) => { if (alive && onError) onError(err); },
      )
      .finally(() => {
        inFlight = false;
        if (alive && pending) run();
      });
  };

  return {
    request: run,
    stop() { alive = false; pending = false; },
  };
}
