// errorNoise.js — what errorReporting.js never records. Pure (errorCore.test.mjs).
//
// Third-party / un-actionable noise we don't want cluttering the prod table:
//  - cross-origin "Script error." (opaque, no stack we can act on)
//  - Android in-app-browser bridges (iabjs:// + navigation_performance_logger)
//    injected by the FB/IG webview, not our code — grows with ad traffic
//  - browser-extension crashes (chrome-extension:// / moz-extension:// frames)
//  - benign ResizeObserver loop warnings the browser emits as errors
// Search-engine / social crawlers execute the SPA and emit fetch failures
// (Failed to fetch / Load failed) that are environmental, never our bug — and
// they grow with SEO + public /share traffic. Drop by UA (not by message) so
// REAL users' fetch failures still log and stay visible/actionable.

export function isBotUA(ua) {
  return /bot|crawl|spider|slurp|bingpreview|applebot|duckduckbot|yandex|baiduspider|facebookexternalhit|googlebot/i.test(ua || '');
}

export function isNoise(message, stack, ua) {
  const m = message || '';
  const s = stack || '';
  if (isBotUA(ua)) return true;
  if (m === 'Script error.') return true;
  if (/^ResizeObserver loop/i.test(m)) return true;
  if (/iabjs:\/\/|navigation_performance_logger/i.test(s + m)) return true;
  if (/chrome-extension:\/\/|moz-extension:\/\/|safari-extension:\/\/|safari-web-extension:\/\/|webkit-masked-url:\/\//i.test(s)) return true;
  // Extension / embedded-webview artifacts injected INTO the page context, so
  // they carry no extension:// stack frame to match the rule above:
  //  - "Object Not Found Matching Id:N, MethodName:update, ParamCount:4" — a
  //    known antivirus/webview bridge rejection with no real stack, not ours.
  //  - crypto-wallet extensions redefining window.ethereum.
  //  - Firefox / iOS reader-mode injecting __firefox__.
  // (We still keep real users' "Failed to fetch" / "Load failed" — dropped by
  // UA only — so genuine network failures stay actionable.)
  if (/Object Not Found Matching Id:\d+/i.test(m)) return true;
  if (/__firefox__/.test(s + m)) return true;
  if (/window\.ethereum|\bselectedAddress\b|Cannot redefine property: ethereum/i.test(m)) return true;
  // Cloudflare's own Web Analytics beacon, failing inside its own bundle on
  // ancient browsers ("t.entries.at is not a function" on Chrome 79). Third-
  // party script, nothing we can fix, and it arrives with a clean
  // static.cloudflareinsights.com stack — match the source, not the message.
  if (/static\.cloudflareinsights\.com/i.test(s)) return true;
  // A request the page itself called off (a search typed over, a panel
  // closed mid-load) is the app working, not failing.
  if (/^AbortError\b|The user aborted a request|The operation was aborted|signal is aborted without reason|Fetch is aborted/i.test(m)) return true;
  return false;
}
