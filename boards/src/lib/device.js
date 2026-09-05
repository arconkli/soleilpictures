// device.js — best-effort device classification for analytics. Parses the
// browser into CLEAN CATEGORIES (device_type / os / browser); we never store the
// raw user-agent in analytics_events (privacy + trivial server-side aggregation).
// Memoized — computed once per page load. Zero dependencies, so it adds nothing
// to the size-sensitive landing chunk.
//
// Signal priority: Capacitor native platform (window.Capacitor, no static import)
// → UA-Client-Hints (navigator.userAgentData) → navigator.userAgent regex.

let cached = null;

// Automated clients, matched against the lowercased UA. This matters more than
// it looks: Googlebot-Smartphone's UA is a real Android Chrome string with
// "compatible; Googlebot/2.1" appended, so without this it classifies as
// mobile/Android/Chrome and lands in the same bucket as a human on a Pixel —
// which is exactly how a crawler fleet came to outnumber real visitors in the
// mobile split of the SEO pages. Only JS-executing clients ever reach this
// module, but the list is broad because spoofed and headless traffic does too.
//
// Tokens are deliberately specific ("slackbot", not "slack") — an in-app
// browser carries the app's name and belongs to a person, not a crawler.
// One literal, no imports: device.js stays dependency-free for the
// size-sensitive landing chunk.
const BOT_RE = /bot\b|bot[/_-]|crawler|spider|crawling|headless|phantomjs|puppeteer|playwright|selenium|webdriver|scrapy|curl\/|wget\/|python-requests|node-fetch|axios\/|go-http-client|okhttp|libwww|httrack|feedfetcher|facebookexternalhit|whatsapp\/|lighthouse|pagespeed|gtmetrix|pingdom|ahrefs|semrush|mj12|dotbot|petalbot|dataforseo|screaming frog|google-extended|gptbot|oai-searchbot|chatgpt-user|claude-web|anthropic-ai|perplexity|cohere-ai|bytespider|amazonbot|meta-externalagent|applebot|duckduckbot|yandex(bot|images)|baiduspider|slurp|sogou|exabot|ia_archiver/;

// Pure classifier — exported so it can be unit-tested with fixed UA strings
// (see the DEV bridge in main.jsx). nativePlatform is 'ios' | 'android' | null.
export function parseUserAgent(ua, uaData = null, nativePlatform = null, maxTouchPoints = 0) {
  const low = String(ua || '').toLowerCase();
  const bot = BOT_RE.test(low);

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

  return { device_type, os, browser, bot };
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
    cached = { device_type: 'unknown', os: 'other', browser: 'other', bot: false };
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
  // Automation that does not announce itself in the UA still sets this flag —
  // Playwright, Puppeteer and Selenium all do. Our own e2e suite trips it, which
  // is correct: those rows are already labelled `synthetic` as well.
  try { if (navigator.webdriver) cached.bot = true; } catch (_) {}
  return cached;
}
