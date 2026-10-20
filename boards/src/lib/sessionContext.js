// sessionContext.js — what the browser says about its own setup, sent once per
// app session as one session_context row (EV.SESSION_CONTEXT).
//
// Nothing here is asked of the person and nothing here is content. Every value
// is a category, a rounded number, or a code from a fixed list:
//   • where and in what language: the time zone and its offset, up to three
//     languages, and the region and network kind the Worker saw (edgeContext.js)
//   • the screen: window and screen sizes rounded to 10px, the pixel ratio to a
//     quarter, and whether the display does wide colour
//   • input: the main pointer, whether a mouse or a finger is available at all,
//     hover, and touch points
//   • preferences the browser exposes: dark mode, the app's own theme, reduced
//     motion, contrast, forced colours
//   • the device class: memory as the browser buckets it, cores capped at 16,
//     the connection's type and speed class, Data Saver, the browser's major
//     version, and whether this is the installed app, a native shell or an
//     in-app browser
//   • ff: which of appHost.js's holds were open, so a row says which features
//     that session was offered.
// No canvas, WebGL, audio or font probing, and no raw user agent: device.js
// already reduces that to type, OS and browser on every row.
//
// Why a row of its own: buildRow merges the first-source bag into every event,
// and none of this belongs on every event. One row per app session is enough to
// segment any other row by its app_session_id, and a signup's context is that
// account's first session_context row.

import { EV } from './analyticsEvents.js';
import { parseEdgeContext, CTX_META_NAME } from './edgeContext.js';

// Where the id of the last app session that sent its context is kept, so a
// reload inside one session does not send it twice.
export const CTX_SENT_KEY = 'soleil_ctx_session';

// Rows that never call for a context row of their own: the context row itself,
// and rows that describe the session rather than anything done in it.
const NOT_ACTIVITY = new Set([EV.SESSION_CONTEXT, EV.SESSION_SUMMARY, 'telemetry_drop']);

/** Is this the first row of an app session that has not sent its context yet? */
export function contextDue(row, sentFor) {
  const id = row && row.app_session_id;
  return typeof id === 'string' && id !== '' && id !== sentFor && !NOT_ACTIVITY.has(row.event);
}

const TZ_RE = /^[A-Za-z][A-Za-z0-9_+\-/]{1,47}$/;
const LANG_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;
const EFFECTIVE_TYPES = new Set(['slow-2g', '2g', '3g', '4g']);
const CONN_TYPES = new Set(['bluetooth', 'cellular', 'ethernet', 'none', 'wifi', 'wimax', 'other', 'unknown']);

const round10 = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n / 10) * 10 : null);

/**
 * The browser's major version, from the same precedence device.js names the
 * browser by, so the number belongs to the browser it reports. No OS version:
 * macOS and Windows froze theirs in the user agent years ago and Chrome freezes
 * Android's, so it would read as a version and mean nothing.
 */
export function browserMajor(ua) {
  const s = typeof ua === 'string' ? ua : '';
  const pick = (re) => {
    const m = s.match(re);
    const n = m ? Number(m[1]) : NaN;
    return Number.isInteger(n) && n > 0 && n < 1000 ? n : null;
  };
  if (/edg(e|a|ios)?\//i.test(s)) return pick(/edg(?:e|a|ios)?\/(\d+)/i);
  if (/(opr|opera)\//i.test(s)) return pick(/(?:opr|opera)\/(\d+)/i);
  if (/firefox|fxios/i.test(s)) return pick(/(?:firefox|fxios)\/(\d+)/i);
  if (/chrome|crios|chromium/i.test(s)) return pick(/(?:chrome|crios|chromium)\/(\d+)/i);
  if (/safari/i.test(s)) return pick(/version\/(\d+)/i);
  return null;
}

/**
 * Read the context from a browser-like global. Never throws; anything the
 * browser does not expose is null.
 *
 * @param {object} g        window, or a stand-in in tests
 * @param {object} extra    { flags: featureFlags(), webview: getWebviewInfo(), now: Date }
 */
export function readSessionContext(g = globalThis, extra = {}) {
  const safe = (fn, fallback = null) => { try { const v = fn(); return v === undefined ? fallback : v; } catch (_) { return fallback; } };
  const mm = (q) => safe(() => !!(typeof g.matchMedia === 'function' && g.matchMedia(q).matches), false);
  const nav = safe(() => g.navigator) || {};
  const conn = safe(() => nav.connection);

  const tz = safe(() => g.Intl.DateTimeFormat().resolvedOptions().timeZone);
  const offset = safe(() => -(extra.now || new Date()).getTimezoneOffset());
  const language = safe(() => nav.language);
  const lang = typeof language === 'string' && LANG_RE.test(language) ? language : null;
  const langs = safe(() => [...new Set([...nav.languages].filter((l) => typeof l === 'string' && LANG_RE.test(l)))].slice(0, 3), []);

  const dpr = Number(safe(() => g.devicePixelRatio));
  const mem = Number(safe(() => nav.deviceMemory));
  const cores = Number(safe(() => nav.hardwareConcurrency));
  const touch = Number(safe(() => nav.maxTouchPoints));
  const metaContent = safe(() => g.document.querySelector(`meta[name="${CTX_META_NAME}"]`).getAttribute('content'));
  const edge = parseEdgeContext(metaContent);
  const theme = safe(() => g.document.documentElement.getAttribute('data-theme'));
  const native = safe(() => (g.Capacitor && g.Capacitor.isNativePlatform && g.Capacitor.isNativePlatform()
    ? g.Capacitor.getPlatform() : null));
  const webview = extra.webview || {};

  const ff = {};
  if (extra.flags && typeof extra.flags === 'object') {
    for (const k of Object.keys(extra.flags).slice(0, 40)) {
      if (/^[A-Za-z0-9_]{1,32}$/.test(k)) ff[k] = extra.flags[k] === true;
    }
  }

  return {
    tz: typeof tz === 'string' && TZ_RE.test(tz) ? tz : null,
    tz_offset_min: Number.isInteger(offset) && Math.abs(offset) <= 16 * 60 ? offset : null,
    lang,
    langs,
    region: edge.region,
    net_kind: edge.net_kind,
    // Where those two came from: the page's tag, or (set by analytics.js) the
    // Worker's /api/ctx for a session that started on `/`, which no tag reaches.
    edge_src: edge.region || edge.net_kind ? 'meta' : null,

    vw: round10(safe(() => g.innerWidth)),
    vh: round10(safe(() => g.innerHeight)),
    sw: round10(safe(() => g.screen.width)),
    sh: round10(safe(() => g.screen.height)),
    dpr: Number.isFinite(dpr) && dpr > 0 ? Math.round(dpr * 4) / 4 : null,
    gamut: mm('(color-gamut: rec2020)') ? 'rec2020' : mm('(color-gamut: p3)') ? 'p3' : mm('(color-gamut: srgb)') ? 'srgb' : null,

    pointer: mm('(pointer: coarse)') ? 'coarse' : mm('(pointer: fine)') ? 'fine' : mm('(pointer: none)') ? 'none' : null,
    any_fine: mm('(any-pointer: fine)'),
    any_coarse: mm('(any-pointer: coarse)'),
    hover: mm('(hover: hover)'),
    touch_points: Number.isFinite(touch) && touch >= 0 ? Math.min(Math.round(touch), 10) : null,

    scheme: mm('(prefers-color-scheme: dark)') ? 'dark' : 'light',
    theme: theme === 'light' || theme === 'dark' ? theme : null,
    reduced_motion: mm('(prefers-reduced-motion: reduce)'),
    contrast: mm('(prefers-contrast: more)') ? 'more' : mm('(prefers-contrast: less)') ? 'less' : null,
    forced_colors: mm('(forced-colors: active)'),

    mem_gb: Number.isFinite(mem) && mem > 0 ? Math.min(mem, 64) : null,
    cores: Number.isFinite(cores) && cores > 0 ? Math.min(Math.round(cores), 16) : null,
    net_type: safe(() => (EFFECTIVE_TYPES.has(conn.effectiveType) ? conn.effectiveType : null)),
    conn_type: safe(() => (CONN_TYPES.has(conn.type) ? conn.type : null)),
    save_data: safe(() => conn.saveData === true, false),
    browser_major: browserMajor(safe(() => nav.userAgent)),

    standalone: mm('(display-mode: standalone)') || safe(() => nav.standalone === true, false),
    native: native === 'ios' || native === 'android' ? native : null,
    webview: webview.is_webview === true,
    webview_app: webview.is_webview === true && typeof webview.webview_app === 'string'
      ? webview.webview_app.slice(0, 32) : null,

    ff,
  };
}
