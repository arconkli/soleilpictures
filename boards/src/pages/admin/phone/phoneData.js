// phoneData.js — the phone admin panel's reads (the table is phoneCalls.js),
// behind one cache (lib/phoneCache.js).
//
// The heaviest reports go through lib/adminReport.js: the database keeps each
// for 10 minutes and shares it with the computer, and a forced refresh (the
// pull down, the header, Try again) asks for a new one.
//
// The last visit's numbers are kept in this browser (lib/adminSnapshot.js):
// seedPhoneData(uid) puts them in the cache when the panel opens, so Today and
// the pages paint at once, and every good read saves what phoneCalls.js'
// snapOf() allows. A seed is never treated as fresh: it is always read over.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase.js';
import { cachedReport, forgetReports } from '../../../lib/slowReportCache.js';
import { createCache } from '../../../lib/phoneCache.js';
import { adminReport, SHARED_REPORTS } from '../../../lib/adminReport.js';
import { readSnap, writeSnap, forgetSnaps } from '../../../lib/adminSnapshot.js';
import { CALLS, SLOW_TTL, SNAP_KEYS, snapName, snapOf } from './phoneCalls.js';

export { CALLS, FILTERS, SLOW_TTL, FIRST, SECOND, PAGE_CALLS } from './phoneCalls.js';

const cache = createCache();
let owner = null;   // whose numbers are kept; null keeps nothing

// The two slowest reports are also held for an hour (lib/slowReportCache.js).
const HOURLY = new Set(['admin_return_fixed_horizon', 'admin_activity_heatmap']);

/**
 * One call, through the cache. Resolves { data, error, at, stale } (see
 * phoneCache.js). Slow calls are reused for SLOW_TTL; `force` skips that, the
 * hour's hold and the database's 10 minutes.
 */
export function fetchCall(key, { force = false } = {}) {
  const call = CALLS[key];
  if (!call) return Promise.resolve({ data: null, error: new Error(`unknown call ${key}`), at: null, stale: false });
  const uid = owner;
  return cache.get(key, async () => {
    // Never `.catch()` the builder: it is a thenable, not a promise.
    const read = () => (SHARED_REPORTS.includes(call.rpc)
      ? adminReport(supabase, call.rpc, call.args, { fresh: force })
      : supabase.rpc(call.rpc, call.args));
    let res;
    if (HOURLY.has(call.rpc)) {
      if (force) forgetReports();
      res = await cachedReport(call.rpc, call.args, read);
    } else {
      res = await read();
    }
    const { data, error } = res;
    if (error) return { error };
    const picked = call.pick ? call.pick(data) : data;
    // For the next visit. Not when the account changed while this was out.
    if (uid && uid === owner) {
      const keep = snapOf(key, picked);
      if (keep !== undefined) writeSnap(uid, snapName(key), keep);
    }
    return { data: picked };
  }, { ttl: call.slow ? SLOW_TTL : 0, force });
}

/**
 * The panel opened for this account: its last visit's numbers go into the
 * cache (only where nothing is held yet), and its good reads are kept from now
 * on. No uid keeps and seeds nothing.
 */
export function seedPhoneData(uid) {
  if (owner && owner !== uid) cache.clear();
  owner = uid || null;
  if (!owner) return;
  for (const key of SNAP_KEYS) {
    const snap = readSnap(owner, snapName(key));
    if (snap) cache.seed(key, snap.data, snap.at);
  }
}

/** Forget everything cached (tests, sign-out). */
export function clearPhoneData() { owner = null; cache.clear(); }

// Signing out, in this tab or another, forgets the numbers held here and every
// kept snapshot. AuthGate forgets the snapshots too, for a tab that never
// opened the panel.
try {
  supabase?.auth?.onAuthStateChange?.((event) => {
    if (event !== 'SIGNED_OUT') return;
    clearPhoneData();
    forgetSnaps();
  });
} catch { /* no auth to listen to (a fixture client) */ }

function known(keys) {
  const values = {};
  for (const k of keys) {
    const held = cache.peek(k);
    if (held) values[k] = held.data;
  }
  return values;
}

const seeds = (keys) => keys.filter((k) => cache.peek(k)?.seeded);

/**
 * The values for `keys`, refetched whenever refresh.n changes (refresh.force
 * skips the slow calls' 30-minute reuse and asks the database for new reports,
 * once, for the reads on screen when the refresh was asked).
 *
 *   values[key]  undefined  never loaded
 *                null       failed with nothing to show (or answered null)
 *                data       the last good value; stays on screen while refetching
 *   errors[key]  the latest error, even when stale data is still shown
 *   loading      true while any of the keys is being fetched
 *   updating     true while a value on screen is the last visit's and its
 *                read has not come back (a failed read ends it too: the error
 *                says the rest)
 *
 * { enabled: false } makes no calls, so the second wave can wait for the first.
 */
export function usePhoneData(keys, refresh, { enabled = true } = {}) {
  const keyList = keys.join('|');
  const [state, setState] = useState(() => ({
    values: known(keys), errors: {}, loading: false, updating: seeds(keys).length > 0,
  }));
  const latest = useRef(refresh);
  latest.current = refresh;
  // A forced refresh asks for new numbers once, from the reads on screen when
  // it was asked for (Today's second wave included, when it starts). A page,
  // sheet or Today opened afterwards reads normally instead of recomputing
  // what was just computed.
  const forcedFor = useRef(refresh?.n);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const n = latest.current?.n;
    const force = !!latest.current?.force && n !== forcedFor.current;
    forcedFor.current = n;
    let pending = keys.length;
    const waiting = new Set(seeds(keys));
    // Anything already cached shows at once; nothing is cleared to empty.
    setState((s) => ({
      values: { ...known(keys), ...s.values }, errors: s.errors, loading: pending > 0, updating: waiting.size > 0,
    }));
    keys.forEach((key) => {
      fetchCall(key, { force }).then((r) => {
        if (cancelled) return;
        pending -= 1;
        waiting.delete(key);
        setState((s) => {
          const prev = s.values[key];
          const kept = r.data != null ? r.data : (prev != null ? prev : null);
          return {
            values: { ...s.values, [key]: kept },
            errors: { ...s.errors, [key]: r.error || null },
            loading: pending > 0,
            updating: waiting.size > 0,
          };
        });
      });
    });
    return () => { cancelled = true; };
  }, [keyList, refresh?.n, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
