// Tracks recently-used colors across the app. Persisted to localStorage so
// they survive reloads. Most-recent first; capped at MAX. Subscribers are
// notified after each change so React hooks can re-render.

const STORAGE_KEY = 'soleil.boards.recentColors';
const MAX = 16;

let listeners = new Set();
let cache = null;

function load() {
  if (cache) return cache;
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(cache)) cache = [];
  } catch (_) {
    cache = [];
  }
  return cache;
}

function save(list) {
  cache = list;
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (_) {}
}

function normalize(color) {
  if (!color || color === 'transparent') return null;
  const m = String(color).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return ('#' + h).toLowerCase();
}

export function getRecentColors() {
  return load().slice();
}

export function addRecentColor(color) {
  const c = normalize(color);
  if (!c) return;
  const list = load();
  const next = [c, ...list.filter(x => x !== c)].slice(0, MAX);
  if (next.length === list.length && next.every((v, i) => v === list[i])) return;
  save(next);
  for (const fn of listeners) fn(next);
}

export function clearRecentColors() {
  save([]);
  for (const fn of listeners) fn([]);
}

export function subscribeRecent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
