// Unit tests for the crawler classifier. Pure function, no DOM — run with:
//   node --test boards/src/lib/crawlerUa.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCrawler, isCrawlablePath } from './crawlerUa.js';

// Real user-agents as each vendor publishes them.
const UA = {
  gptbot:        'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
  oaiSearch:     'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
  chatgptUser:   'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  claudebot:     'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  claudeUser:    'Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
  perplexity:    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  googleExt:     'Mozilla/5.0 (compatible; Google-Extended/1.0)',
  ccbot:         'CCBot/2.0 (https://commoncrawl.org/faq/)',
  googlebot:     'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot:       'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  applebot:      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  appleExt:      'Mozilla/5.0 (compatible; Applebot-Extended/0.1; +http://www.apple.com/go/applebot)',
  facebook:      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  humanChrome:   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  humanIphone:   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

test('AI crawlers are recognized and classed as ai', () => {
  for (const k of ['gptbot', 'oaiSearch', 'chatgptUser', 'claudebot', 'claudeUser',
                   'perplexity', 'googleExt', 'ccbot', 'appleExt']) {
    const r = classifyCrawler(UA[k]);
    assert.ok(r, `${k} unrecognized`);
    assert.equal(r.kind, 'ai', `${k} → ${r.kind}`);
  }
});

test('search crawlers are classed as search, not ai', () => {
  for (const k of ['googlebot', 'bingbot', 'applebot']) {
    assert.equal(classifyCrawler(UA[k]).kind, 'search', k);
  }
});

// Order matters in CRAWLERS: a prefix token would otherwise swallow the
// specific one, and these three pairs are the ones that actually collide.
test('specific tokens win over the prefixes they contain', () => {
  assert.equal(classifyCrawler(UA.oaiSearch).bot,   'OAI-SearchBot');
  assert.equal(classifyCrawler(UA.chatgptUser).bot, 'ChatGPT-User');
  assert.equal(classifyCrawler(UA.appleExt).bot,    'Applebot-Extended');
  assert.equal(classifyCrawler(UA.appleExt).kind,   'ai');
  assert.equal(classifyCrawler(UA.applebot).bot,    'Applebot');
  assert.equal(classifyCrawler(UA.applebot).kind,   'search');
  assert.equal(classifyCrawler(UA.googleExt).bot,   'Google-Extended');
  assert.equal(classifyCrawler(UA.googlebot).bot,   'Googlebot');
});

test('unfurlers are recognized but are neither ai nor search', () => {
  assert.deepEqual(classifyCrawler(UA.facebook), { bot: 'facebookexternalhit', kind: 'other' });
});

// A hit here is reported as fact, so an unrecognized agent must stay
// unattributed rather than be guessed at.
test('humans and unknown agents return null', () => {
  assert.equal(classifyCrawler(UA.humanChrome), null);
  assert.equal(classifyCrawler(UA.humanIphone), null);
  assert.equal(classifyCrawler('some-unknown-agent/1.0'), null);
  assert.equal(classifyCrawler(''), null);
  assert.equal(classifyCrawler(null), null);
  assert.equal(classifyCrawler(undefined), null);
});

test('matching is case-insensitive', () => {
  assert.equal(classifyCrawler('MOZILLA/5.0 (COMPATIBLE; GPTBOT/1.1)').bot, 'GPTBot');
});

test('isCrawlablePath keeps pages and machine mirrors, drops assets and APIs', () => {
  for (const p of ['/', '/vs/pureref', '/best/pureref-alternatives', '/docs/canvas/cards',
                   '/tools/mood-board-maker', '/changelog', '/c/neon-noir-look-book']) {
    assert.equal(isCrawlablePath(p), true, p);
  }
  // The machine-readable twins are the whole point of the AEO surface.
  for (const p of ['/vs/pureref.md', '/llms.txt', '/sitemap.xml', '/robots.txt', '/changelog.xml']) {
    assert.equal(isCrawlablePath(p), true, p);
  }
  // Assets and machine endpoints say nothing about what is being READ, and
  // would swamp the page-level signal.
  for (const p of ['/api/og', '/assets/index-abc123.js', '/oauth/token',
                   '/.well-known/oauth-authorization-server', '/og/templates.png',
                   '/favicon.ico', '/landing/neon-noir.webp']) {
    assert.equal(isCrawlablePath(p), false, p);
  }
  assert.equal(isCrawlablePath(''), false);
  assert.equal(isCrawlablePath('not-a-path'), false);
});
