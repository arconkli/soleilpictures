// Pictures whose smaller copy could not be made, remembered across visits so a
// picture whose original won't fetch isn't tried (and reported) on every open.
// One localStorage entry: a JSON object of image key -> failedAt (ms). An entry
// lasts a week, then the picture gets another chance; at most MAX_ENTRIES are
// kept, the oldest dropped first. Storage can be missing, full or blocked: every
// access is in try/catch, and then nothing is remembered.
const KEY = 'soleil.thumbFail';
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ENTRIES = 300;

const defaultStore = () => { try { return globalThis.localStorage || null; } catch (_) { return null; } };

// The live entries (older ones dropped), or {} when there is nothing usable.
function read(store, now) {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return {};
    const all = JSON.parse(raw);
    if (!all || typeof all !== 'object' || Array.isArray(all)) return {};
    const live = {};
    for (const [k, at] of Object.entries(all)) {
      if (typeof at === 'number' && now - at < TTL_MS) live[k] = at;
    }
    return live;
  } catch (_) { return {}; }
}

export function isRemembered(key, { store = defaultStore(), now = Date.now } = {}) {
  if (!key) return false;
  return Object.prototype.hasOwnProperty.call(read(store, now()), key);
}

export function remember(key, { store = defaultStore(), now = Date.now } = {}) {
  if (!key || !store) return;
  const t = now();
  const live = read(store, t);
  live[key] = t;
  const keys = Object.keys(live);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => live[a] - live[b]);
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete live[k];
  }
  try { store.setItem(KEY, JSON.stringify(live)); } catch (_) { /* full or blocked: forget it */ }
}
