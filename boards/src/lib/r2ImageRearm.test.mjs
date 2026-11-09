// R2Image's basic flavor (cluster thumbnails, Files previews, avatars) does
// not stay padlocked after a short sign-reads outage (MEDIA-14). React-bound,
// so this pins the shape: the failure branch re-arms once (a network failure keeps
// re-arming, with a backoff), on a timer and on the browser's `online` event, and the listener is removed on cleanup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'components', 'R2Image.jsx'), 'utf8');
const basic = src.slice(src.indexOf('function R2ImageBasic'), src.indexOf('function R2ImageProgressive'));

test('the basic flavor re-arms after giving up: once for a lock, every time for the network', () => {
  assert.match(basic, /if \(isR2 && \(signFailure\(key\) === 'network' \|\| !rearmedRef\.current\)\) \{\s+rearmedRef\.current = true;/);
  assert.match(basic, /retryTimer = setTimeout\(rearm, rearmDelay\(rearmsRef\.current\+\+\)\);/);
  assert.match(basic, /window\.addEventListener\('online', onOnline\)/);
  assert.match(basic, /return \(\) => \{ cancelled = true; dropOnline\(\);/);
  assert.match(basic, /rearmedRef\.current = false;[^\n]*\}, \[src\]\);/, 'a new src earns its own re-arm');
});

test('the progressive flavor re-arms on a timer and on `online`, and lets go on cleanup', () => {
  const prog = src.slice(src.indexOf('function R2ImageProgressive'));
  assert.match(prog, /\|\| !rearmedRef\.current\) \{\s+rearmedRef\.current = true;/);
  assert.match(prog, /retryTimer = setTimeout\(rearm, rearmDelay\(rearmsRef\.current\+\+\)\);/);
  assert.match(prog, /window\.addEventListener\('online', onOnline\)/);
  assert.match(prog, /return \(\) => \{ cancelled = true; dropOnline\(\);/);
});

test('a failed forced re-sign that was the network\u2019s goes back through the sign effect, in both flavors', () => {
  const prog = src.slice(src.indexOf('function R2ImageProgressive'));
  assert.match(basic, /else if \(signFailure\(shown\.slice\(3\)\) === 'network'\) setRetryTick\(\(t\) => t \+ 1\);\s+else setFailed\(true\);/);
  assert.match(prog, /else if \(signFailure\(activeSrc\.slice\(3\)\) === 'network'\) setRetryTick\(\(t\) => t \+ 1\);\s+else setFailed\(true\);/);
});

// MEDIA-16: thumb keys are overwritten in place and served immutable, so
// every cluster-thumbnail surface must bust and remount on thumb_updated_at.
test('a cluster thumbnail in a grid cell busts on thumb_updated_at like the board card', () => {
  const cell = readFileSync(join(here, '..', 'components', 'cards', 'gridCellShared.jsx'), 'utf8');
  assert.match(cell, /<R2Image key=\{b\.thumb_updated_at \|\| b\.thumb_key\} src=\{b\.thumb_key\} bust=\{b\.thumb_updated_at\}/);
});

test('a network failure backs off from 30 s to 5 min and starts over after a good sign or a Retry', () => {
  assert.match(src, /const REARM_MS = 30000;/);
  assert.match(src, /const REARM_MAX_MS = 300000;/);
  assert.match(src, /const rearmDelay = \(n\) => Math\.min\(REARM_MS \* 2 \*\* n, REARM_MAX_MS\);/);
  const base = Number(src.match(/const REARM_MS = (\d+);/)[1]);
  const max = Number(src.match(/const REARM_MAX_MS = (\d+);/)[1]);
  const delays = [0, 1, 2, 3, 4, 5].map((n) => Math.min(base * 2 ** n, max));
  assert.deepEqual(delays, [30000, 60000, 120000, 240000, 300000, 300000]);
  const prog = src.slice(src.indexOf('function R2ImageProgressive'));
  for (const body of [basic, prog]) {
    assert.match(body, /attempt = 0;\s+rearmsRef\.current = 0;/);
    assert.match(body, /rearmedRef\.current = false;\s+rearmsRef\.current = 0;/);
  }
});
