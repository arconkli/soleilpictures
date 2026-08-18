// webview.test.mjs — the detector has to be right about REAL browsers first.
//
//   node --test src/lib/webview.test.mjs
//
// A false positive here is worse than a miss: it would manufacture evidence for
// the very hypothesis the flag exists to test. So the real-browser cases are
// the ones that matter most, especially iOS Chrome and Firefox, which lack the
// Safari token for legitimate reasons and would otherwise read as webviews.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectWebview } from './webview.js';

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const AND = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko)';

test('real desktop browsers are never webviews', () => {
  for (const ua of [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  ]) {
    assert.equal(detectWebview(ua).is_webview, false, ua.slice(0, 40));
  }
});

test('real mobile browsers are never webviews', () => {
  assert.equal(detectWebview(`${IOS} Version/17.5 Mobile/15E148 Safari/604.1`).is_webview, false, 'iOS Safari');
  assert.equal(detectWebview(`${AND} Chrome/126.0.0.0 Mobile Safari/537.36`).is_webview, false, 'Android Chrome');
});

test('iOS Chrome and Firefox lack the Safari token but are REAL browsers', () => {
  // The single most dangerous false positive: these would otherwise trip the
  // "no Safari token on iOS" rule and inflate the webview share.
  assert.equal(detectWebview(`${IOS} CriOS/126.0 Mobile/15E148`).is_webview, false, 'iOS Chrome');
  assert.equal(detectWebview(`${IOS} FxiOS/127.0 Mobile/15E148`).is_webview, false, 'iOS Firefox');
  assert.equal(detectWebview(`${IOS} EdgiOS/126.0 Mobile/15E148`).is_webview, false, 'iOS Edge');
});

test('a home-screen PWA is standalone, not an in-app browser', () => {
  const ua = `${IOS} Mobile/15E148`;
  assert.equal(detectWebview(ua, { standalone: true }).is_webview, false,
    'installed PWAs must not be counted as webviews — they are the opposite of the problem');
  assert.equal(detectWebview(ua, { standalone: false }).is_webview, true,
    'the same UA without standalone IS a bare WKWebView');
});

test('named in-app browsers are identified', () => {
  const cases = [
    [`${IOS} Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBAV/450.0]`, 'facebook'],
    [`${AND} Chrome/126.0 Mobile Safari/537.36 Instagram 300.0`,   'instagram'],
    [`${IOS} Mobile/15E148 MicroMessenger/8.0.44`,                 'wechat'],
    [`${IOS} Mobile/15E148 GSA/300.0 Safari/604.1`,                'google_app'],
    [`${AND} Chrome/126.0 Mobile Safari/537.36 Line/14.0`,         'line'],
    [`${IOS} Mobile/15E148 OutlookMobile/4.2`,                     'outlook'],
  ];
  for (const [ua, app] of cases) {
    const r = detectWebview(ua);
    assert.equal(r.is_webview, true, `${app} should be a webview`);
    assert.equal(r.webview_app, app);
  }
});

test('the Facebook browser is caught even though it also claims Safari', () => {
  // It carries a Safari token, so the iOS rule alone would miss it — the named
  // list has to win.
  const ua = `${IOS} Version/17.5 Mobile/15E148 Safari/604.1 [FBAN/FBIOS]`;
  assert.deepEqual(detectWebview(ua), { is_webview: true, webview_app: 'facebook' });
});

test('Android declares itself with the wv token', () => {
  assert.equal(detectWebview(`${AND}; wv) Chrome/126.0 Mobile Safari/537.36`.replace('Pixel 8)', 'Pixel 8')).is_webview, true);
  assert.equal(detectWebview('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/126.0 Mobile').is_webview, true);
});

test('an Android WebView using the Version/ + Chrome pattern is caught', () => {
  assert.equal(
    detectWebview('Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 Version/4.0 Chrome/114.0 Mobile Safari/537.36').is_webview,
    true, 'the legacy Version/4.0 + Chrome signature is a WebView');
});

test('an explicit React Native bridge is definitive, not a guess', () => {
  const r = detectWebview('anything at all', { hasRNBridge: true });
  assert.deepEqual(r, { is_webview: true, webview_app: 'react_native' });
});

test('junk input never throws into the emitter', () => {
  for (const bad of [null, undefined, '', 42, {}]) {
    assert.deepEqual(detectWebview(bad), { is_webview: false, webview_app: null });
  }
});
