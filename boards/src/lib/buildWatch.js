// Reload a tab that is running against a party host the server has moved off.
//
// Until October 2026 nothing could make an open tab reload: BUILD_SHA only
// stamped analytics, nothing polled /api/build-info, and there is no service
// worker. Only a stale-chunk error (lazyWithReload) reloaded a tab, so an idle
// tab could sit on the previous deploy for days. That was harmless until the
// party moved hosts (PartyKit's hosted platform shut down): the party host is
// baked into the bundle at build time, so a tab that never reloads keeps its
// socket to the OLD host, where nobody else is, and stops working altogether
// once that host is gone.
//
// So the tab asks. /api/build-info names the party host the server's current
// build uses (`party`, stamped into buildInfo.js from the same variable the
// bundle is built with, so the two can only differ across builds) and an
// optional floor (`minBuild`, a build date). When the server's host is not this
// tab's, or this tab's build is older than the floor, the tab reloads at a
// moment that loses nothing:
//
//   never while an upload is in flight or a folder import holds the page, a
//   film or sound is playing, or the page is fullscreen;
//   not while a dialog is open, text is typed into a field, or an editor
//   outside the board has focus — until `reloadBy`, when only the hard rules
//   above still apply, and then only in a hidden tab;
//   a hidden tab after two minutes hidden, a visible one after ten idle.
//
// A reload loses nothing on the board itself: pagehide writes the board's local
// draft and its snapshot (yboard.js), exactly as closing the tab does.
//
// Loop guard: one reload per target per 30 minutes, three per tab session. If
// sessionStorage is unusable (some private modes), the watcher does nothing,
// because without the guard a mismatch the reload cannot fix would loop.

import { BUILD_DATE, PARTY_HOST } from './buildInfo.js';
import { anyModalOpen } from './modalGuard.js';

export const CHECK_EVERY_MS = 10 * 60_000;
export const FIRST_CHECK_MS = 30_000;
export const HIDDEN_FOR_MS = 2 * 60_000;
export const IDLE_FOR_MS = 10 * 60_000;
export const QUIET_XHR_MS = 30_000;
export const GUARD_WINDOW_MS = 30 * 60_000;
export const MAX_RELOADS = 3;
const GUARD_KEY = 'soleil:build-watch';
const TICK_MS = 30_000;

// 'https://Host.example/' → 'host.example'. Empty for nothing usable.
export function normalizeHost(h) {
  if (typeof h !== 'string') return '';
  return h.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
}

// What, if anything, the server's answer asks of this tab.
export function reloadTarget(server, mine) {
  if (!server || typeof server !== 'object') return null;
  const theirs = normalizeHost(server.party);
  const ours = normalizeHost(mine.party);
  if (theirs && ours && theirs !== ours) return `party:${theirs}`;
  const floor = typeof server.minBuild === 'string' ? server.minBuild : '';
  if (floor && /^\d{4}-\d{2}-\d{2}$/.test(floor) && /^\d{4}-\d{2}-\d{2}$/.test(mine.buildDate || '') && mine.buildDate < floor) {
    return `build:${floor}`;
  }
  return null;
}

// The loop guard. `raw` is the stored JSON (or null).
export function guardAllows(raw, target, now) {
  let g = null;
  try { g = raw ? JSON.parse(raw) : null; } catch (_) { g = null; }
  const count = Number(g?.count) || 0;
  if (count >= MAX_RELOADS) return false;
  if (g?.target === target && now - (Number(g?.at) || 0) < GUARD_WINDOW_MS) return false;
  return true;
}

export function nextGuard(raw, target, now) {
  let g = null;
  try { g = raw ? JSON.parse(raw) : null; } catch (_) { g = null; }
  return JSON.stringify({ target, at: now, count: (Number(g?.count) || 0) + 1 });
}

// s: { hidden, hiddenForMs, idleForMs, xhrInFlight, xhrQuietForMs, held,
//      mediaPlaying, fullscreen, modalOpen, typing, pastDeadline }
export function safeToReload(s) {
  if (s.xhrInFlight > 0 || s.xhrQuietForMs < QUIET_XHR_MS) return false;
  if (s.held || s.mediaPlaying || s.fullscreen) return false;
  if (s.pastDeadline) return !!s.hidden && s.hiddenForMs >= HIDDEN_FOR_MS;
  if (s.modalOpen || s.typing) return false;
  if (s.hidden) return s.hiddenForMs >= HIDDEN_FOR_MS;
  return s.idleForMs >= IDLE_FOR_MS;
}

// ── Holding the page ─────────────────────────────────────────────────────────
// Work that a reload would cut short and that no other signal shows (a folder
// import between two uploads) holds the page while it runs.
let holds = 0;
export function holdReload() {
  holds++;
  let released = false;
  return () => { if (!released) { released = true; holds = Math.max(0, holds - 1); } };
}
export function reloadHeld() { return holds > 0; }

// ── The browser side ─────────────────────────────────────────────────────────

let xhrInFlight = 0;
let lastXhrEnd = 0;
// Work that a party socket parking (lib/partyPark.js) would hold up: a hold,
// or an upload on the wire.
export function pageBusy() { return holds > 0 || xhrInFlight > 0; }

function trackXhr() {
  if (typeof XMLHttpRequest === 'undefined' || XMLHttpRequest.prototype.__soleilTracked) return;
  const send = XMLHttpRequest.prototype.send;
  // Uploads are the only XMLHttpRequests the app makes (fetch cannot report
  // upload progress); counting them is how the watcher knows one is running
  // without uploads.js having to tell it.
  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    xhrInFlight++;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      xhrInFlight = Math.max(0, xhrInFlight - 1);
      lastXhrEnd = Date.now();
    };
    this.addEventListener('loadend', end);
    try {
      return send.apply(this, args);
    } catch (e) {
      end();
      throw e;
    }
  };
  XMLHttpRequest.prototype.__soleilTracked = true;
}

function mediaPlaying() {
  try {
    return [...document.querySelectorAll('video, audio')].some((m) => !m.paused && !m.ended && m.readyState > 2);
  } catch (_) { return false; }
}

// Someone may be mid-sentence: a text field or an editor has focus, or a visible
// field holds text. Deliberately blunt. A board's own notes would survive a
// reload (they are Yjs documents), but a comment, a message or an address typed
// into the share dialog would not, and from here they look the same. React
// keeps a controlled input's value attribute in sync, so "differs from its
// default" cannot tell typed text from a pre-filled field either; any text
// counts.
const TEXTY = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password']);
const inputType = (el) => (el.getAttribute('type') || 'text').toLowerCase();
function typing() {
  try {
    const a = document.activeElement;
    if (a && (a.isContentEditable || a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && TEXTY.has(inputType(a))))) return true;
    for (const el of document.querySelectorAll('textarea, input')) {
      if (el.disabled || el.readOnly || !el.value) continue;
      if (el.tagName === 'INPUT' && !TEXTY.has(inputType(el))) continue;
      if (!el.getClientRects().length) continue;          // not on screen
      return true;
    }
  } catch (_) { /* nothing readable: assume nothing typed */ }
  return false;
}

function enabledHere() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (import.meta.env?.DEV) return false;
  try { if (window.Capacitor?.isNativePlatform?.()) return false; } catch (_) { return false; }
  if (window.location.protocol !== 'https:') return false;
  const host = window.location.hostname;
  return host === 'clusters.soleilpictures.com' || /\.workers\.dev$/i.test(host);
}

let started = false;

export function startBuildWatch() {
  if (started || !enabledHere()) return;
  // The guard lives in sessionStorage. If it cannot be read AND written, a
  // reload that does not fix the mismatch would repeat forever: stay off.
  try {
    const probe = `${GUARD_KEY}:probe`;
    sessionStorage.setItem(probe, '1');
    sessionStorage.removeItem(probe);
  } catch (_) { return; }
  const mine = { party: PARTY_HOST, buildDate: BUILD_DATE };
  if (!normalizeHost(mine.party)) return;   // an unstamped build has nothing to compare
  started = true;
  trackXhr();

  let wanted = null;          // the target the server asked for
  let deadline = 0;           // reloadBy, ms
  let hiddenAt = document.hidden ? Date.now() : 0;
  let lastInput = Date.now();
  let lastCheck = 0;
  let ticker = null;

  const onInput = () => { lastInput = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(ev, onInput, { passive: true, capture: true });
  }

  const tryReload = () => {
    if (!wanted) return;
    const now = Date.now();
    const state = {
      hidden: document.hidden,
      hiddenForMs: document.hidden && hiddenAt ? now - hiddenAt : 0,
      idleForMs: now - lastInput,
      xhrInFlight,
      xhrQuietForMs: lastXhrEnd ? now - lastXhrEnd : Infinity,
      held: reloadHeld(),
      mediaPlaying: mediaPlaying(),
      fullscreen: !!document.fullscreenElement,
      modalOpen: anyModalOpen(),
      typing: typing(),
      pastDeadline: deadline > 0 && now >= deadline,
    };
    if (!safeToReload(state)) return;
    let raw = null;
    try { raw = sessionStorage.getItem(GUARD_KEY); } catch (_) { return; }
    if (!guardAllows(raw, wanted, now)) return;
    try { sessionStorage.setItem(GUARD_KEY, nextGuard(raw, wanted, now)); } catch (_) { return; }
    console.log('[build-watch] reloading for', wanted);
    window.location.reload();
  };

  const check = async () => {
    const now = Date.now();
    if (now - lastCheck < 60_000) return;
    lastCheck = now;
    let server = null;
    try {
      const res = await fetch('/api/build-info', { cache: 'no-store', credentials: 'omit' });
      if (!res.ok) return;
      server = await res.json();
    } catch (_) { return; }
    wanted = reloadTarget(server, mine);
    const by = Date.parse(server?.reloadBy || '');
    deadline = Number.isFinite(by) ? by : 0;
    if (wanted && !ticker) ticker = setInterval(tryReload, TICK_MS);
    if (!wanted && ticker) { clearInterval(ticker); ticker = null; }
    tryReload();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else {
      hiddenAt = 0;
      void check();
    }
  });
  window.addEventListener('online', () => { void check(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) void check(); });
  setTimeout(() => { void check(); }, FIRST_CHECK_MS);
  setInterval(() => { void check(); }, CHECK_EVERY_MS);
}
