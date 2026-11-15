// Haptic feedback at a few key moments (lift, drop, snap, hold menu, delete).
// Fires only after a touch or pen pointerdown, so mice, trackpads and
// keyboards never buzz. Call sites just call haptic('kind'); this never throws.
//
// Routes: the native shell uses @capacitor/haptics (loaded on demand); browsers
// with the Vibration API use navigator.vibrate; iPhone Safari has neither, so
// HapticTap.jsx buzzes there through a native <input switch> instead.

import { Capacitor } from '@capacitor/core';

const KEY = 'soleil.haptics';
const MIN_GAP_MS = 60;
const PATTERNS = { tick: 10, lift: 15, delete: 15, drop: [18, 40, 18], warn: [22, 60, 22] };
const SWITCH_ID = 'soleil-haptic-switch';

export function createHaptics(env = {}) {
  const { win, nav, storage, capacitor, loadPlugin, now } = env;
  const subs = new Set();
  let lastInput = null;
  let lastBuzz = -Infinity;
  let pluginPromise = null;
  let selectionStarted = false;
  let storageHooked = false;
  let trickMemo;
  let switchEl = null;

  if (win && win.addEventListener) {
    try {
      win.addEventListener('pointerdown', (e) => { lastInput = e && e.pointerType; }, { capture: true, passive: true });
      win.addEventListener('keydown', () => { lastInput = 'key'; }, { capture: true, passive: true });
    } catch (_) {}
  }

  function hapticsEnabled() {
    try { return !(storage && storage.getItem(KEY) === 'off'); } catch (_) { return true; }
  }

  function notify() {
    for (const fn of [...subs]) { try { fn(); } catch (_) {} }
  }

  function setHapticsEnabled(on) {
    try {
      if (storage) {
        if (on) storage.removeItem(KEY); else storage.setItem(KEY, 'off');
      }
    } catch (_) {}
    notify();
  }

  function subscribeHaptics(fn) {
    subs.add(fn);
    if (!storageHooked && win && win.addEventListener) {
      storageHooked = true;
      try { win.addEventListener('storage', (e) => { if (!e || !e.key || e.key === KEY) notify(); }); } catch (_) {}
    }
    return () => { subs.delete(fn); };
  }

  function isNative() {
    try { return !!(capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform()); } catch (_) { return false; }
  }

  function isTouchDevice() {
    try {
      if (nav && nav.maxTouchPoints > 0) return true;
      return !!(win && win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
    } catch (_) { return false; }
  }

  function usesSwitchTrick() {
    if (trickMemo !== undefined) return trickMemo;
    try {
      trickMemo = !!(nav && /iP(hone|od)/.test(nav.userAgent || '') && !isNative()
        && win && win.document && 'switch' in win.document.createElement('input'));
    } catch (_) { trickMemo = false; }
    return trickMemo;
  }

  // Can anything here buzz at all: the app with the plugin, a browser with the
  // Vibration API, or iPhone Safari's switch. iPads have no vibration motor
  // (iPadOS reports itself as a Mac with touch points).
  function hapticsAvailable() {
    try {
      const ua = (nav && nav.userAgent) || '';
      if (/iPad/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) return false;
      if (isNative()) return !!(capacitor.isPluginAvailable && capacitor.isPluginAvailable('Haptics'));
      return !!(nav && typeof nav.vibrate === 'function') || usesSwitchTrick();
    } catch (_) { return false; }
  }

  function ensureHapticSwitch() {
    if (switchEl) return switchEl;
    const doc = win && win.document;
    if (!doc) return null;
    const existing = doc.getElementById && doc.getElementById(SWITCH_ID);
    if (existing) { switchEl = existing; return existing; }
    const el = doc.createElement('input');
    el.type = 'checkbox';
    el.id = SWITCH_ID;
    el.setAttribute('switch', '');
    el.setAttribute('aria-hidden', 'true');
    // No tabindex: WebKit focuses a control with an explicit tabindex when its
    // label is tapped, which left focus on this hidden input after every tap
    // (and the app then took the page for typing). Without one a tap never
    // focuses it; anything else that does is bounced straight off.
    el.addEventListener('focus', () => { try { el.blur(); } catch (_) {} });
    el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;margin:0';
    doc.body.appendChild(el);
    switchEl = el;
    return el;
  }

  function nativeBuzz(kind) {
    if (!pluginPromise) pluginPromise = Promise.resolve().then(loadPlugin);
    pluginPromise.then((mod) => {
      const { Haptics, ImpactStyle, NotificationType } = mod;
      if (kind === 'lift' || kind === 'delete') return Haptics.impact({ style: ImpactStyle.Light });
      if (kind === 'drop') return Haptics.impact({ style: ImpactStyle.Medium });
      if (kind === 'warn') return Haptics.notification({ type: NotificationType.Warning });
      // selectionChanged does nothing until selectionStart has run.
      if (!selectionStarted) {
        selectionStarted = true;
        Promise.resolve(Haptics.selectionStart()).catch(() => {});
      }
      return Haptics.selectionChanged();
    }).catch(() => {});
  }

  function haptic(kind) {
    try {
      if (!Object.prototype.hasOwnProperty.call(PATTERNS, kind)) return false;
      if (!hapticsEnabled()) return false;
      if (lastInput !== 'touch' && lastInput !== 'pen') return false;
      const t = now();
      if (t - lastBuzz < MIN_GAP_MS) return false;

      if (isNative() && capacitor.isPluginAvailable && capacitor.isPluginAvailable('Haptics') && loadPlugin) {
        lastBuzz = t;
        nativeBuzz(kind);
        return true;
      }
      if (nav && typeof nav.vibrate === 'function') {
        lastBuzz = t;
        nav.vibrate(PATTERNS[kind]);
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  return { haptic, hapticsEnabled, setHapticsEnabled, subscribeHaptics, isTouchDevice, usesSwitchTrick, hapticsAvailable, ensureHapticSwitch };
}

const hasWin = typeof window !== 'undefined';
let realStorage = null;
try { realStorage = hasWin ? window.localStorage : null; } catch (_) {}
const clockNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const real = createHaptics({
  win: hasWin ? window : null,
  nav: typeof navigator !== 'undefined' ? navigator : null,
  storage: realStorage,
  capacitor: Capacitor,
  loadPlugin: () => import('@capacitor/haptics'),
  now: clockNow,
});

export const haptic = real.haptic;
export const hapticsEnabled = real.hapticsEnabled;
export const setHapticsEnabled = real.setHapticsEnabled;
export const subscribeHaptics = real.subscribeHaptics;
export const isTouchDevice = real.isTouchDevice;
export const usesSwitchTrick = real.usesSwitchTrick;
export const hapticsAvailable = real.hapticsAvailable;
export const ensureHapticSwitch = real.ensureHapticSwitch;

// Snap ticks for the canvas: one per newly caught alignment, never for losing
// one. `hints` is the canvas's snap-guide set ({ xs, ys, spacings, sizes }).
// The guides blink off whenever a drag speeds past the placing threshold, so a
// guide that comes straight back doesn't tick again; one gone 200ms does.
// Make one per gesture.
function snapParts(h) {
  return h ? [
    ...(h.xs || []).map((g) => `x${Math.round(g.x)}`),
    ...(h.ys || []).map((g) => `y${Math.round(g.y)}`),
    ...(h.spacings || []).map((g) => `s${g.axis}${g.gap}`),
    ...(h.sizes || []).map((g) => `z${g.axis}${g.value}`),
  ] : [];
}
export function createSnapTicker(buzz = () => haptic('tick'), now = clockNow) {
  let on = new Set();
  const goneAt = new Map();
  return (hints) => {
    const t = now();
    const cur = new Set(snapParts(hints));
    let fresh = false;
    for (const p of cur) {
      if (on.has(p)) continue;
      const g = goneAt.get(p);
      if (g === undefined || t - g > 200) fresh = true;
    }
    for (const p of on) if (!cur.has(p)) goneAt.set(p, t);
    on = cur;
    if (fresh) buzz();
  };
}
