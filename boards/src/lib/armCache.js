// armCache.js — the experiment arms this browser knows, per account.
//
// The arms ride every analytics event as exp_<key> (analytics.js buildRow) and
// decide what some first-run surfaces render (getEnrolledArm). They used to be
// one map per BROWSER, replaced wholesale by each enrollment and filled from the
// server only when empty, so a second account on a shared machine sent the
// first one's arms on every event, and an arm the server never stamped rode
// events forever. Readouts were safe, because they read the server's stamp
// (profiles.settings.experiments); event-level slicing was not.
//
// Now each account has its own map, under soleil_experiments:<uid>, and the
// server's stamp is the truth for it:
//   * an enrollment (the App seed loop, the setup gate) merges its keys in and
//     marks them as enrolled this page load;
//   * the server's stamp, read once a page load, then REPLACES the map: every
//     key it holds, at its value, plus any key this page load enrolled that it
//     has not stored yet (at a fresh signup the gate stamps its arm while its
//     set_experiment_arm call is still in flight, and the server answers {}).
//     Anything else, it never stamped, so events stop claiming it.
// Signed out there is no map, so events carry no arms.
//
// The old browser-wide map is never put on an event. Until the server's stamp
// has been read once on this browser it answers getEnrolledArm for a key the
// account's own map lacks, so a returning user mid-onboarding keeps the
// treatment App draws at first render; the first stamp read deletes it.
//
// Pure, with storage injected, so it runs under node (armCache.test.mjs).

export const ARMS_PREFIX = 'soleil_experiments:';
export const LEGACY_ARMS_KEY = 'soleil_experiments';

export function createArmCache(getStorage) {
  const byUid = new Map();   // uid → { arms, fresh: keys enrolled this page load }
  let legacy;                // the old map: undefined until read, null once gone

  const storage = () => { try { return getStorage() || null; } catch (_) { return null; } };

  function read(key) {
    try {
      const raw = storage()?.getItem(key);
      const m = raw ? JSON.parse(raw) : null;
      return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
    } catch (_) { return null; }
  }

  function entry(uid) {
    let e = byUid.get(uid);
    if (!e) { e = { arms: read(ARMS_PREFIX + uid) || {}, fresh: new Set() }; byUid.set(uid, e); }
    return e;
  }

  // Memory is the copy that counts; storage only carries it to the next load.
  function save(uid, arms) {
    try { storage()?.setItem(ARMS_PREFIX + uid, JSON.stringify(arms)); } catch (_) {}
  }

  return {
    // What rides this account's events ({} signed out). Read-only.
    arms: (uid) => (uid ? entry(uid).arms : {}),

    // What the UI draws for one experiment: this account's arm, else the old
    // map's until the server has been read, else null.
    arm(uid, key) {
      const k = `exp_${key}`;
      const own = uid ? entry(uid).arms[k] : null;
      if (own) return own;
      if (legacy === undefined) legacy = read(LEGACY_ARMS_KEY);
      return legacy?.[k] || null;
    },

    // An enrollment: { exp_<key>: arm }, merged into that account's map.
    enroll(map, uid) {
      if (!uid || !map || typeof map !== 'object') return;
      const e = entry(uid);
      e.arms = { ...e.arms, ...map };
      for (const k in map) e.fresh.add(k);
      save(uid, e.arms);
    },

    // The server's stamp, { <key>: arm }, as get_my_experiments returns it.
    // Only a confirmed answer comes here: an error must not empty the map.
    adoptServer(stamped, uid) {
      if (!uid || !stamped || typeof stamped !== 'object' || Array.isArray(stamped)) return;
      const e = entry(uid);
      const next = {};
      for (const k of e.fresh) if (e.arms[k] != null) next[k] = e.arms[k];
      for (const k in stamped) {
        if (typeof stamped[k] === 'string' && stamped[k]) next[`exp_${k}`] = stamped[k];
      }
      e.arms = next;
      save(uid, next);
      legacy = null;
      try { storage()?.removeItem(LEGACY_ARMS_KEY); } catch (_) {}
    },
  };
}
