// Tracks recently-used colors across the app. Persisted to localStorage so
// they survive reloads. Most-recent first; capped at MAX. Subscribers are
// notified after each change so React hooks can re-render.

const STORAGE_KEY = 'soleil.boards.recentColors';
const SAVED_KEY = 'soleil.boards.savedColors';
const MAX = 16;
const SAVED_MAX = 32;

let listeners = new Set();
let savedListeners = new Set();
let cache = null;
let savedCache = null;

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

// ─── Saved colors (pinned by the user; survive across sessions) ────────
function loadSaved() {
  if (savedCache) return savedCache;
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    savedCache = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(savedCache)) savedCache = [];
  } catch (_) { savedCache = []; }
  return savedCache;
}

function saveSaved(list) {
  savedCache = list;
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch (_) {}
}

export function getSavedColors() {
  return loadSaved().slice();
}

export function addSavedColor(color) {
  const c = normalize(color);
  if (!c) return;
  const list = loadSaved();
  if (list.includes(c)) return; // already saved
  const next = [c, ...list].slice(0, SAVED_MAX);
  saveSaved(next);
  for (const fn of savedListeners) fn(next);
}

export function removeSavedColor(color) {
  const c = normalize(color);
  if (!c) return;
  const list = loadSaved();
  const next = list.filter(x => x !== c);
  if (next.length === list.length) return;
  saveSaved(next);
  for (const fn of savedListeners) fn(next);
}

export function isColorSaved(color) {
  const c = normalize(color);
  if (!c) return false;
  return loadSaved().includes(c);
}

export function subscribeSaved(fn) {
  savedListeners.add(fn);
  return () => savedListeners.delete(fn);
}
