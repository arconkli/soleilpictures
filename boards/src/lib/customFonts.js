// Custom-font registry. Workspace-wide list of fonts the user has added,
// stored in localStorage and surfaced in every font picker (doc toolbar,
// canvas note rich-text bar, etc.).
//
// Each entry:
//   { id, name, css, source: { kind: 'google' | 'url' | 'system', value? } }
//
//   - 'system'  → user typed a CSS family name they trust is installed.
//   - 'google'  → name resolves to a Google Font; we inject a <link> tag
//                  the first time the registry loads.
//   - 'url'     → user provided a font-file URL; we inject an @font-face.

const STORAGE_KEY = 'soleil.customFonts';
let cache = null;
const listeners = new Set();
let injectedRoot = null;

function load() {
  if (cache) return cache;
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(cache)) cache = [];
  } catch (_) { cache = []; }
  return cache;
}
function save(list) {
  cache = list;
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (_) {}
  }
  ensureInjected(list);
  for (const fn of listeners) fn(list);
}

export function getCustomFonts() { return load().slice(); }

export function addCustomFont(entry) {
  const list = load();
  const id = entry.id || ('font-' + Math.random().toString(36).slice(2, 9));
  const item = {
    id,
    name: entry.name?.trim() || entry.css || 'Custom font',
    css: entry.css?.trim() || `'${entry.name?.trim()}', sans-serif`,
    source: entry.source || { kind: 'system' },
  };
  save([...list.filter(f => f.id !== id), item]);
  return item;
}

export function removeCustomFont(id) {
  save(load().filter(f => f.id !== id));
}

export function subscribeFonts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Inject the appropriate Google Fonts <link> + @font-face rules so the user's
// chosen font actually renders. Idempotent — we re-derive every time the list
// changes and replace a single managed <style> + <link> pair.
function ensureInjected(list) {
  if (typeof document === 'undefined') return;
  if (!injectedRoot) {
    injectedRoot = document.createElement('div');
    injectedRoot.dataset.role = 'soleil-custom-fonts';
    document.head.appendChild(document.createElement('style')).id = 'soleil-custom-fonts-style';
    document.head.appendChild(Object.assign(document.createElement('link'), { id: 'soleil-custom-fonts-link', rel: 'stylesheet' }));
  }
  const styleEl = document.getElementById('soleil-custom-fonts-style');
  const linkEl  = document.getElementById('soleil-custom-fonts-link');

  const googleFamilies = list
    .filter(f => f.source?.kind === 'google')
    .map(f => (f.source.value || f.name).trim().replace(/\s+/g, '+'));
  if (googleFamilies.length) {
    const families = googleFamilies.map(f => `family=${f}:wght@400;500;600;700`).join('&');
    linkEl.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  } else {
    linkEl.removeAttribute('href');
  }

  const faces = list
    .filter(f => f.source?.kind === 'url' && f.source.value)
    .map(f => `@font-face { font-family: '${f.name.replace(/'/g, "\\'")}'; src: url(${JSON.stringify(f.source.value)}) format('woff2'), url(${JSON.stringify(f.source.value)}); font-display: swap; }`)
    .join('\n');
  styleEl.textContent = faces;
}

// Initialize injection on first load so cached fonts work without any UI.
load();
ensureInjected(load());

// ── Recent fonts ────────────────────────────────────────────────────────────
// Track the most-recently used fonts (any source: built-in, Google, custom).
// Used by the font picker to pin recent picks at the top.
const RECENT_KEY = 'soleil.recentFonts';
const recentListeners = new Set();
let recentCache = null;

function loadRecent() {
  if (recentCache) return recentCache;
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    recentCache = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(recentCache)) recentCache = [];
  } catch (_) { recentCache = []; }
  return recentCache;
}
function saveRecent(list) {
  recentCache = list;
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (_) {}
  }
  for (const fn of recentListeners) fn(list);
}
export function getRecentFonts() { return loadRecent().slice(); }
export function addRecentFont(entry) {
  if (!entry?.css) return;
  const cur = loadRecent();
  const next = [
    { name: entry.name, css: entry.css, gfName: entry.gfName || null },
    ...cur.filter(f => f.css !== entry.css),
  ].slice(0, 6);
  saveRecent(next);
}
export function subscribeRecentFonts(fn) {
  recentListeners.add(fn);
  return () => recentListeners.delete(fn);
}
