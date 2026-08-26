// sidebarPref — whether the sidebar starts expanded.
//
// This setting existed in Settings → Appearance and did NOTHING. It wrote
// `profiles.settings.ui.sidebarOpen`, and nothing anywhere read that key: the
// real state was `tweak.compactSidebar`, a per-device localStorage blob owned
// by the dev TweaksPanel. So the toggle that says "when you launch the app,
// start with the sidebar expanded" could be flipped, saved, reloaded, and the
// sidebar would sit exactly where it was.
//
// `ui.sidebarOpen` is now the single source of truth, and ⌘B and the collapse
// chevron write it — which also makes the preference follow the account
// between devices instead of being stranded per browser, like every other key
// in `ui`.
//
// Same module-store shape as lib/wheelMode.js and lib/theme.js, for the same
// reason: the value has to be readable synchronously on a cold load, before
// the profile fetch resolves, or the sidebar renders open and then snaps shut.
// The `soleil.ui` mirror is what makes that possible.

const UI_CACHE_KEY = 'soleil.ui';

// Absent means open. That is the historical default and matches
// HARDCODED_FALLBACKS.ui.sidebarOpen — only an explicit `false` collapses.
const normalize = (v) => v !== false;

function readCache() {
  try {
    const raw = localStorage.getItem(UI_CACHE_KEY);
    return normalize((raw ? JSON.parse(raw) : null)?.sidebarOpen);
  } catch (_) {
    // No storage, private mode, or no DOM at all (node tests). Default open.
    return true;
  }
}

let open = readCache();

export function getSidebarOpen() { return open; }

// Apply now and mirror it for the next cold load. Mirrors applyWheelModeNow.
export function applySidebarOpenNow(next) {
  const v = normalize(next);
  open = v;
  try {
    const raw = localStorage.getItem(UI_CACHE_KEY);
    const ui = raw ? (JSON.parse(raw) || {}) : {};
    ui.sidebarOpen = v;
    localStorage.setItem(UI_CACHE_KEY, JSON.stringify(ui));
  } catch (_) { /* the in-memory value is still right for this session */ }
  return v;
}
