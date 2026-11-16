// Who "@" offers on a cluster, kept while that cluster is the one open, so
// opening one conversation after another asks the database once and not on
// every press. Pure: the caller does the asking.
//
//   get(scope, key, load) → Promise(value)
//     scope   the cluster; a different one drops everything kept
//     key     what was asked (workspace : cluster : may-edit)
//     load()  → Promise({ value, keep }); asked once per key, two asks at the
//             same moment share one. keep: false (a list could not be
//             fetched) hands the value over but does not keep it.
//   peek(scope, key) → the kept value, or null
export function createPeopleCache() {
  let scope = null;
  let kept = new Map();      // key → value
  let asking = new Map();    // key → Promise(value)
  const enter = (s) => {
    if (s === scope) return;
    scope = s; kept = new Map(); asking = new Map();
  };
  return {
    peek(s, key) {
      return s === scope && kept.has(key) ? kept.get(key) : null;
    },
    get(s, key, load) {
      enter(s);
      if (kept.has(key)) return Promise.resolve(kept.get(key));
      if (asking.has(key)) return asking.get(key);
      const mine = asking;
      const p = Promise.resolve().then(load).then((r) => {
        // the cluster changed while this was on its way: not kept
        if (mine === asking) {
          asking.delete(key);
          if (r && r.keep !== false) kept.set(key, r.value);
        }
        return r ? r.value : null;
      }, (err) => {
        if (mine === asking) asking.delete(key);
        throw err;
      });
      asking.set(key, p);
      return p;
    },
  };
}
