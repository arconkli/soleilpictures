// Unit tests for the device classifier. Pure function, no DOM — run with:
//   node --test boards/src/lib/device.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUserAgent } from './device.js';

const UA = {
  iphone:   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipad:     'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  androidP: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidT: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  winChrome:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  winEdge:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  winFox:   'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  macSafari:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
};

test('iPhone → mobile / iOS / Safari', () => {
  assert.deepEqual(parseUserAgent(UA.iphone), { device_type: 'mobile', os: 'iOS', browser: 'Safari', bot: false });
});
test('iPad → tablet / iOS / Safari (despite the Mobile token)', () => {
  assert.deepEqual(parseUserAgent(UA.ipad), { device_type: 'tablet', os: 'iOS', browser: 'Safari', bot: false });
});
test('Android phone → mobile / Android / Chrome', () => {
  assert.deepEqual(parseUserAgent(UA.androidP), { device_type: 'mobile', os: 'Android', browser: 'Chrome', bot: false });
});
test('Android tablet (no Mobile token) → tablet / Android / Chrome', () => {
  assert.deepEqual(parseUserAgent(UA.androidT), { device_type: 'tablet', os: 'Android', browser: 'Chrome', bot: false });
});
test('Windows Chrome → desktop / Windows / Chrome', () => {
  assert.deepEqual(parseUserAgent(UA.winChrome), { device_type: 'desktop', os: 'Windows', browser: 'Chrome', bot: false });
});
test('Windows Edge → Edge wins over the Chrome token', () => {
  assert.deepEqual(parseUserAgent(UA.winEdge), { device_type: 'desktop', os: 'Windows', browser: 'Edge', bot: false });
});
test('Windows Firefox → desktop / Windows / Firefox', () => {
  assert.deepEqual(parseUserAgent(UA.winFox), { device_type: 'desktop', os: 'Windows', browser: 'Firefox', bot: false });
});
test('macOS Safari (no touch) → desktop / macOS / Safari', () => {
  assert.deepEqual(parseUserAgent(UA.macSafari, null, null, 0), { device_type: 'desktop', os: 'macOS', browser: 'Safari', bot: false });
});
test('iPadOS-as-Mac (Macintosh UA + touch points) → tablet / iOS', () => {
  const r = parseUserAgent(UA.macSafari, null, null, 5);
  assert.equal(r.device_type, 'tablet');
  assert.equal(r.os, 'iOS');
});
test('Capacitor native iOS → mobile / iOS regardless of UA', () => {
  const r = parseUserAgent('some-webview-ua', null, 'ios', 0);
  assert.equal(r.device_type, 'mobile');
  assert.equal(r.os, 'iOS');
});
test('UA-Client-Hints mobile:true forces mobile', () => {
  const r = parseUserAgent(UA.winChrome, { mobile: true }, null, 0);
  assert.equal(r.device_type, 'mobile');
});
test('empty UA → safe defaults', () => {
  assert.deepEqual(parseUserAgent(''), { device_type: 'desktop', os: 'other', browser: 'other', bot: false });
});

// ── Bot detection ──
// Crawlers that execute JS reach the analytics emitter and, once classified,
// are indistinguishable from humans. Googlebot-Smartphone is the one that
// actually polluted the data: a real Android Chrome UA with the bot token
// appended, so it read as mobile/Android/Chrome and swamped the mobile split
// on the SEO pages.
const BOTS = {
  googlebotSmartphone: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  googlebotDesktop:    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/120.0.0.0 Safari/537.36',
  bingbot:             'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  gptbot:              'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
  claudebot:           'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  perplexity:          'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  applebot:            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  headlessChrome:      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
  facebookPreview:     'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  ahrefs:              'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
};

for (const [name, ua] of Object.entries(BOTS)) {
  test(`bot: ${name} is flagged`, () => {
    assert.equal(parseUserAgent(ua).bot, true, ua);
  });
}

test('Googlebot-Smartphone still classifies as mobile/Android/Chrome — the bot flag is the only thing separating it from a Pixel', () => {
  const r = parseUserAgent(BOTS.googlebotSmartphone);
  assert.deepEqual(r, { device_type: 'mobile', os: 'Android', browser: 'Chrome', bot: true });
  const human = parseUserAgent(UA.androidP);
  assert.equal(r.device_type, human.device_type);
  assert.equal(r.os, human.os);
  assert.equal(r.browser, human.browser);
  assert.equal(human.bot, false);
});

test('real browsers are never flagged', () => {
  for (const [name, ua] of Object.entries(UA)) {
    assert.equal(parseUserAgent(ua).bot, false, name);
  }
});

test('in-app browsers belong to people, not crawlers', () => {
  // Tokens are specific ("slackbot", not "slack") so an app's own webview,
  // which carries the app name, is not mistaken for its link-preview fetcher.
  const inApp = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Slack/23.10 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 300.0',
  ];
  for (const ua of inApp) assert.equal(parseUserAgent(ua).bot, false, ua);
  assert.equal(parseUserAgent('Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)').bot, true);
});
