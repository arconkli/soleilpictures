// teamPendingRemovals — the Team page's "removed, with Undo" queue. Removing a
// person, revoking an invite or removing a domain hides the row at once and
// waits `delay` ms before the call is made, so an Undo in that time sends
// nothing at all (deleting everywhere else in Clusters works the same way).
// Pure: no React, no clock of its own (the timers are injected, node passes
// fakes). The page draws from it with useSyncExternalStore(subscribe, version).
//
//   const q = createPendingRemovals({ delay, commit, onFail });
//   q.add(key, item)   the row is pending; commit(item) runs when the delay ends
//   q.undo(key)        true when it was still waiting (nothing is sent)
//   q.flush()          every waiting one now, for the page closing
//   q.has(key) / q.keys()   a key is hidden while it waits AND while its commit
//                      is in flight, so the row never flashes back before the
//                      answer is in; it returns only when the commit failed
//
// commit(item) may return a promise resolving { ok }. A falsy ok, or a throw,
// calls onFail(item, result) (result is { ok: false, error } for a throw) and
// the key stops being hidden. A commit that returns nothing counts as done.

export const UNDO_MS = 6000;

export function createPendingRemovals({ delay = UNDO_MS, commit, onFail, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const waiting = new Map();   // key → { item, timer }
  const inflight = new Map();  // key → how many commits are out
  const listeners = new Set();
  let version = 0;
  let disposed = false;

  const bump = () => {
    version += 1;
    for (const l of [...listeners]) l();
  };

  async function run(key, item) {
    inflight.set(key, (inflight.get(key) || 0) + 1);
    let res;
    try {
      res = await commit(item);
    } catch (error) {
      res = { ok: false, error };
    }
    const left = (inflight.get(key) || 1) - 1;
    if (left > 0) inflight.set(key, left); else inflight.delete(key);
    bump();
    if (res !== undefined && !(res && res.ok)) onFail?.(item, res);
  }

  function fire(key, entry) {
    if (waiting.get(key) !== entry) return undefined;
    waiting.delete(key);
    return run(key, entry.item);
  }

  return {
    add(key, item) {
      if (disposed) return;
      const prev = waiting.get(key);
      if (prev) clearTimer(prev.timer);
      const entry = { item, timer: null };
      entry.timer = setTimer(() => { fire(key, entry); }, delay);
      waiting.set(key, entry);
      bump();
    },
    undo(key) {
      const entry = waiting.get(key);
      if (!entry) return false;
      clearTimer(entry.timer);
      waiting.delete(key);
      bump();
      return true;
    },
    // Resolves when every commit it started has answered.
    flush() {
      const out = [];
      for (const [key, entry] of [...waiting]) {
        clearTimer(entry.timer);
        waiting.delete(key);
        out.push(run(key, entry.item));
      }
      return Promise.all(out).then(() => undefined);
    },
    has: (key) => waiting.has(key) || inflight.has(key),
    keys: () => [...new Set([...waiting.keys(), ...inflight.keys()])],
    // Drops what is waiting without sending it, and every listener.
    dispose() {
      disposed = true;
      for (const entry of waiting.values()) clearTimer(entry.timer);
      waiting.clear();
      listeners.clear();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    version: () => version,
  };
}

// The queue's key for a person or an invite (their id in the snapshot) and for
// a domain. A person's id is a user id, an invite's is 'invite:<uuid>', so the
// two never meet a 'domain:' key.
export const personKey = (id) => String(id);
export const domainKey = (domain) => `domain:${domain}`;

// The snapshot as the page draws it while removals wait: those people,
// invites and domains left out. The same object when nothing is pending, so a
// quiet page keeps every list's identity.
export function withoutPending(team, has) {
  const people = team.people.filter((p) => !has(personKey(p.id)));
  const domains = team.joining && team.joining.domains
    ? team.joining.domains.filter((d) => !has(domainKey(d.domain)))
    : null;
  const peopleSame = people.length === team.people.length;
  const domainsSame = !domains || domains.length === team.joining.domains.length;
  if (peopleSame && domainsSame) return team;
  return {
    ...team,
    ...(peopleSame ? {} : { people }),
    ...(domainsSame ? {} : { joining: { ...team.joining, domains } }),
  };
}
