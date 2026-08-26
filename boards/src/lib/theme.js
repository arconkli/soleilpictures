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

// Apply a theme choice: set data-theme AND mirror it into the soleil.ui cache
// synchronously, so a remount or the next cold load reads the right value with
// zero dependency on the async profile fetch.
//
// `null` is a real, choosable value — it means "follow the OS", which is what a
// user who has never picked already gets. PRESENCE of `theme` in the cache is
// what marks a choice as explicit, so returning to null has to DELETE the key
// rather than write a resolved colour into it: writing 'dark' there would make
// the choice explicit again and silently strand the user on whatever the OS
// happened to be at that moment. This used to coerce every non-'light' input to
// 'dark', which is exactly why null was unreachable once you had picked once.
//
// Returns the theme actually rendered ('light' | 'dark'), never null — callers
// use it to drive UI that has to name a colour.
export function applyThemeNow(theme) {
  const explicit = (theme === 'light' || theme === 'dark') ? theme : null;
  const rendered = explicit || (osPrefersLight() ? 'light' : 'dark');
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', rendered);
  }
  try {
    const raw = localStorage.getItem(UI_CACHE_KEY);
    const ui = raw ? (JSON.parse(raw) || {}) : {};
    if (explicit) ui.theme = explicit; else delete ui.theme;
    localStorage.setItem(UI_CACHE_KEY, JSON.stringify(ui));
  } catch (_) { /* private mode / quota — the attribute is still set */ }
  return rendered;
}
