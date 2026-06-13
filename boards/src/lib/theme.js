// Single source of truth for applying the light/dark theme to the DOM.
//
// Theme precedence everywhere (pre-React bootstrap, runtime, every toggle):
//   1. an explicit user choice  — persisted server-side in
//      profiles.settings.ui.theme and mirrored into the `soleil.ui`
//      localStorage blob for synchronous reads;
//   2. the OS preference        — prefers-color-scheme, for users who have
//      never picked;
//   3. dark                     — the historical default.
//
// `<html data-theme>` is the rendered result; CSS keys off it. All theme
// controls (the topbar quick toggle, Settings → Theme pills, and the
// index.html bootstrap) funnel through here so they can never drift out of
// sync — drift between two independent stores was the cause of the
// "theme resets when you open the admin dashboard" bug.

const UI_CACHE_KEY = 'soleil.ui';

// Read the live attribute. Anything that isn't explicitly 'light' is dark.
export function currentTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

// True when the OS asks for light. Guarded for SSR / old browsers.
export function osPrefersLight() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  } catch (_) { return false; }
}

// Resolve the theme to render: explicit choice → OS preference → dark.
export function resolveTheme(explicit) {
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return osPrefersLight() ? 'light' : 'dark';
}

// Apply an *explicit* theme choice: set data-theme AND mirror it into the
// soleil.ui cache synchronously, so a remount or the next cold load reads
// the right value with zero dependency on the async profile fetch. Writing
// `theme` into the cache is also what marks the choice as explicit (vs. an
// OS default). Returns the normalised value applied.
export function applyThemeNow(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', t);
  }
  try {
    const raw = localStorage.getItem(UI_CACHE_KEY);
    const ui = raw ? (JSON.parse(raw) || {}) : {};
    ui.theme = t;
    localStorage.setItem(UI_CACHE_KEY, JSON.stringify(ui));
  } catch (_) { /* private mode / quota — the attribute is still set */ }
  return t;
}
