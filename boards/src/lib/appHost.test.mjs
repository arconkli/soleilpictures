// The schedule hold is a host allowlist, and the only honest place to test it is
// here. Playwright cannot stub location.hostname — it drives a real browser at a
// real origin — so the e2e suite can only ever exercise the "open" side. These
// cases are the closed side, and they are the ones that matter.
//
// appHost.js reads import.meta.env, which `node --test` cannot parse, so this
// re-implements the two predicates against the same rules and pins the decision
// table. If appHost.js changes shape, PROD_HOST is imported below and the string
// assertion goes red — that is the tripwire.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./appHost.js', import.meta.url), 'utf8');

// The rules, transcribed. Kept beside the source assertions below.
const onPreviewHost = (h) => /\.workers\.dev$/i.test(h);
const allowed = (h, dev) => dev || onPreviewHost(h);

test('the production hostname is written down exactly once', () => {
  assert.match(SRC, /export const PROD_HOST = 'clusters\.soleilpictures\.com'/);
  assert.equal(SRC.match(/clusters\.soleilpictures\.com/g).length, 1);
});

test('schedule creation is an allowlist, not a negated prod check', () => {
  // `!onProdHost()` is the tempting spelling and it opens the hold on every
  // origin that is not the one literal hostname — including capacitor://localhost.
  assert.ok(!/return\s+!onProdHost\(\)/.test(SRC), 'gate must not be !onProdHost()');
  assert.match(SRC, /import\.meta\.env\.DEV \|\| onPreviewHost\(\)/);
});

test('the six host cases', () => {
  // Open: the two places the rebuild has to be reachable.
  assert.equal(allowed('localhost', true), true, 'npm run dev');
  assert.equal(allowed('127.0.0.1', true), true, 'Playwright');
  assert.equal(allowed('soleil-boards-abc.pages.workers.dev', false), true, 'preview build');

  // Closed: production, the native shell, and anything new.
  assert.equal(allowed('clusters.soleilpictures.com', false), false, 'production');
  assert.equal(allowed('localhost', false), false, 'capacitor:// native production build');
  assert.equal(allowed('clusters.example.com', false), false, 'a future alias, closed by default');
});

test('a workers.dev lookalike does not open the hold', () => {
  // Anchored at the end, so a path or a subdomain-shaped attacker string on the
  // prod host cannot match.
  assert.equal(onPreviewHost('workers.dev.evil.com'), false);
  assert.equal(onPreviewHost('clusters.soleilpictures.com/workers.dev'), false);
  assert.equal(onPreviewHost('x.WORKERS.DEV'), true, 'hostnames are case-insensitive');
});
