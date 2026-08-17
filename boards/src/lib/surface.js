// surface.js — what is the user actually looking at?
//
// profiles.seconds_in_app is a single undimensioned integer: it can say someone
// spent forty minutes in the app and nothing about what they spent it on. That
// makes "which parts of this product hold attention" — the question behind
// every retention decision — unanswerable from the data we keep.
//
// This resolves one canonical surface name, which then rides on every event
// (via setAnalyticsContext) and keys the per-surface time slices in
// usage_session. Kept pure and node-testable, because the precedence order is
// the whole design and it is easy to get quietly wrong.
//
// A note on what is deliberately NOT a surface:
//
//   • The messages panel is a docked, persisted toggle (tweak.showMessages).
//     Someone who pins it open once would have every subsequent second
//     credited to 'messages', which would be a fabrication. Docked panels are
//     measured by their own events instead.
//   • Schedule cards live ON the canvas — there is no fullscreen schedule
//     overlay — so their time honestly belongs to 'canvas'. Schedule usage is
//     measured by events, not by dwell.
//
// Only things that genuinely replace what is on screen are surfaces.

// Public routes own their own instrumentation (lp_trace) and are not app usage.
// Same prefix list the router and useAppTrace use; '/' is absent because for a
// signed-in user it IS the app.
const PUBLIC_PREFIXES = [
  '/share', '/c/', '/explore', '/tools', '/vs', '/best', '/use-cases',
  '/pricing', '/docs', '/scout', '/resume', '/legal', '/oauth',
];

export const SURFACES = Object.freeze([
  'canvas', 'list', 'doc', 'universe', 'tag', 'settings', 'public',
]);

export function isPublicPath(pathname) {
  if (typeof pathname !== 'string' || !pathname) return false;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * Resolve the current surface.
 *
 * Precedence is by what OCCLUDES what: a public route isn't the app at all; an
 * open settings modal covers the board; an open doc card covers the canvas;
 * only then does the board's own view mode decide.
 *
 * @param {object} s
 * @param {string} s.pathname        location.pathname
 * @param {string} s.currentSurface  App.jsx: 'board' | 'home' | 'tag'
 * @param {string} s.view            App.jsx: 'canvas' | 'list'
 * @param {boolean} s.docOpen        a doc card is open over the board
 * @param {boolean} s.settingsOpen   the settings modal is open
 */
export function resolveSurface({
  pathname, currentSurface, view, docOpen, settingsOpen,
} = {}) {
  if (isPublicPath(pathname)) return 'public';
  if (settingsOpen) return 'settings';
  if (docOpen) return 'doc';
  if (currentSurface === 'home') return 'universe';
  if (currentSurface === 'tag') return 'tag';
  if (view === 'list') return 'list';
  return 'canvas';
}

/**
 * The board whose time this is. Null on surfaces that aren't about one board,
 * so per-board dwell never attributes universe or settings time to whatever
 * board happened to be open behind them.
 */
export function surfaceBoardId(surface, boardId) {
  if (!boardId) return null;
  return (surface === 'canvas' || surface === 'list' || surface === 'doc') ? boardId : null;
}
