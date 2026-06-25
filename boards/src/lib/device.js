// device.js — best-effort device classification for analytics. Parses the
// browser into CLEAN CATEGORIES (device_type / os / browser); we never store the
// raw user-agent in analytics_events (privacy + trivial server-side aggregation).
// Memoized — computed once per page load. Zero dependencies, so it adds nothing
// to the size-sensitive landing chunk.
//
// Signal priority: Capacitor native platform (window.Capacitor, no static import)
// → UA-Client-Hints (navigator.userAgentData) → navigator.userAgent regex.

let cached = null;

// Pure classifier — exported so it can be unit-tested with fixed UA strings
// (see the DEV bridge in main.jsx). nativePlatform is 'ios' | 'android' | null.
export function parseUserAgent(ua, uaData = null, nativePlatform = null, maxTouchPoints = 0) {
  const low = String(ua || '').toLowerCase();

  // ── OS ──
  let os = 'other';
  if (nativePlatform === 'ios' || /iphone|ipad|ipod/.test(low)) os = 'iOS';
  else if (nativePlatform === 'android' || /android/.test(low)) os = 'Android';
  else if (/windows|win32|win64/.test(low)) os = 'Windows';
  else if (/mac os x|macintosh/.test(low)) os = 'macOS';
  else if (/linux|x11|cros/.test(low)) os = 'Linux';

  // ── device_type ──
  const uaMobile = uaData && typeof uaData.mobile === 'boolean' ? uaData.mobile : null;
  const isTabletUA = /ipad|tablet|playbook|silk/.test(low) || (/android/.test(low) && !/mobile/.test(low));
  // iPadOS 13+ reports a desktop "Macintosh" UA; touch points disambiguate it.
  const iPadAsMac = os === 'macOS' && maxTouchPoints > 1;

  let device_type;
  if (nativePlatform === 'ios' || nativePlatform === 'android') {
    device_type = isTabletUA ? 'tablet' : 'mobile';
  } else if (isTabletUA || iPadAsMac) {
    device_type = 'tablet';
    if (iPadAsMac) os = 'iOS';
  } else if (uaMobile === true || /mobi|iphone|ipod|android.*mobile|windows phone/.test(low)) {
    device_type = 'mobile';
  } else {
    device_type = 'desktop';
  }

  // ── browser ── (order matters: Chrome/Edge UAs also contain the "safari" token)
  let browser = 'other';
  if (/edg(e|a|ios)?\//.test(low)) browser = 'Edge';
  else if (/(opr|opera)\//.test(low)) browser = 'Opera';
  else if (/firefox|fxios/.test(low)) browser = 'Firefox';
  else if (/chrome|crios|chromium/.test(low)) browser = 'Chrome';
  else if (/safari/.test(low)) browser = 'Safari';

  return { device_type, os, browser };
}

// True for clients with a hard/limited memory ceiling where simultaneous
// full-resolution image decode + WebP encode bursts can OOM/freeze the tab:
// iOS Safari (strict per-tab memory budget) and any device reporting ≤4GB RAM.
// Used to halve image-processing concurrency (backfillGate + upload ingest).
// Memoized via getDeviceInfo; navigator.deviceMemory is Chromium-only (absent
// on Safari) so the iOS check carries the iPad/iPhone case on its own.
export function lowMemoryDevice() {
  try {
    const { os } = getDeviceInfo();
    const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0;
    return os === 'iOS' || (mem > 0 && mem <= 4);
  } catch (_) { return false; }
}

export function getDeviceInfo() {
  if (cached) return cached;
  if (typeof navigator === 'undefined') {
    cached = { device_type: 'unknown', os: 'other', browser: 'other' };
    return cached;
  }
  let nativePlatform = null;
  try {
    const cap = typeof window !== 'undefined' && window.Capacitor;
    if (cap && typeof cap.getPlatform === 'function') {
      const p = cap.getPlatform();
      if (p === 'ios' || p === 'android') nativePlatform = p;
    }
  } catch (_) { /* web — no Capacitor */ }
  cached = parseUserAgent(
    navigator.userAgent,
    navigator.userAgentData || null,
    nativePlatform,
    navigator.maxTouchPoints || 0,
  );
  return cached;
}
