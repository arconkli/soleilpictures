// webview.js — is this an in-app browser rather than a real one?
//
// Written to test one specific hypothesis. About one in eight current signups
// completes email verification and then never reaches the product: server-side
// they have last_sign_in_at set, and client-side they have no workspace, no
// board, no analytics event and no error. Nothing ran.
//
// That shape fits an embedded browser. Supabase's /auth/v1/verify stamps
// last_sign_in_at BEFORE it redirects to us, so a magic link opened inside
// Gmail or Outlook's in-app webview can authenticate and then be closed with
// the session stranded in a view the real browser never sees — leaving exactly
// the trace we observe, or rather the absence of one.
//
// Detection is a heuristic and is labelled as one. It exists to say "webviews
// are over-represented in the drop" or "they are not", which is enough to
// decide whether to chase the redirect. It is never used to gate behaviour.

// Named in-app browsers, most specific first — several UAs carry more than one
// of these tokens (the Facebook browser also says Safari; the Google app also
// says Chrome), so order is what makes the answer stable.
const NAMED = [
  [/FBAN|FBAV|FB_IAB|FBIOS/i,      'facebook'],
  [/Instagram/i,                    'instagram'],
  [/\bLine\//i,                     'line'],
  [/MicroMessenger/i,               'wechat'],
  [/\bTwitter\b|TwitterAndroid/i,   'twitter'],
  [/LinkedInApp/i,                  'linkedin'],
  [/Snapchat/i,                     'snapchat'],
  [/Pinterest/i,                    'pinterest'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'tiktok'],
  [/\bSlack\b/i,                    'slack'],
  [/DiscordBot|Discord\//i,         'discord'],
  [/OutlookMobile|Outlook-(iOS|Android)/i, 'outlook'],
  [/\bGSA\//i,                      'google_app'],   // the Google/Gmail iOS app
  [/\bYaBrowser\b/i,                'yandex'],
  [/EdgiOS|EdgA/i,                  'edge'],         // real browsers, matched to
  [/CriOS/i,                        'chrome_ios'],   // stop the iOS rule below
  [/FxiOS/i,                        'firefox_ios'],  // misreading them as webviews
];

// Real iOS browsers that are NOT Safari and therefore lack the Safari token
// legitimately. Matching these first prevents a false positive.
const IOS_REAL = new Set(['chrome_ios', 'firefox_ios', 'edge']);

/**
 * @param {string} ua        navigator.userAgent
 * @param {object} opts
 * @param {boolean} opts.standalone  navigator.standalone / display-mode
 * @param {boolean} opts.hasRNBridge window.ReactNativeWebView present
 * @returns {{is_webview: boolean, webview_app: string|null}}
 */
export function detectWebview(ua, opts = {}) {
  const s = typeof ua === 'string' ? ua : '';
  if (!s) return { is_webview: false, webview_app: null };

  // An explicit React Native bridge is not a guess.
  if (opts.hasRNBridge) return { is_webview: true, webview_app: 'react_native' };

  let named = null;
  for (const [re, name] of NAMED) {
    if (re.test(s)) { named = name; break; }
  }
  if (named && !IOS_REAL.has(named)) return { is_webview: true, webview_app: named };

  // Android states it outright.
  if (/\bwv\b/.test(s) || /Android.*Version\/[\d.]+\s+Chrome/i.test(s)) {
    return { is_webview: true, webview_app: named || 'android_webview' };
  }

  // iOS: a real browser always carries a Safari token. A WKWebView does not.
  // Home-screen PWAs (standalone) also lack it and are NOT in-app browsers,
  // so they are excluded — that distinction is the whole point of the flag.
  const isIOS = /iPhone|iPad|iPod/i.test(s);
  if (isIOS && !named && !/Safari/i.test(s) && !opts.standalone) {
    return { is_webview: true, webview_app: 'ios_webview' };
  }

  return { is_webview: false, webview_app: named && IOS_REAL.has(named) ? null : null };
}

/** Live reading for the current browser. Safe outside one. */
export function getWebviewInfo() {
  try {
    if (typeof navigator === 'undefined') return { is_webview: false, webview_app: null };
    const standalone = !!(navigator.standalone
      || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches));
    return detectWebview(navigator.userAgent, {
      standalone,
      hasRNBridge: typeof window !== 'undefined' && !!window.ReactNativeWebView,
    });
  } catch (_) {
    return { is_webview: false, webview_app: null };
  }
}
