// R2Image's basic flavor (cluster thumbnails, Files previews, avatars) does
// not stay padlocked after a short sign-reads outage (MEDIA-14). React-bound,
// so this pins the shape: the failure branch re-arms once, on a timer and on
// the browser's `online` event, and the listener is removed on cleanup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'components', 'R2Image.jsx'), 'utf8');
const basic = src.slice(src.indexOf('function R2ImageBasic'), src.indexOf('function R2ImageProgressive'));

test('the basic flavor re-arms once after giving up', () => {
  assert.match(basic, /if \(isR2 && !rearmedRef\.current\) \{\s+rearmedRef\.current = true;/);
  assert.match(basic, /retryTimer = setTimeout\(rearm, 30000\);/);
  assert.match(basic, /window\.addEventListener\('online', onOnline\)/);
  assert.match(basic, /return \(\) => \{ cancelled = true; dropOnline\(\);/);
  assert.match(basic, /rearmedRef\.current = false;[^\n]*\}, \[src\]\);/, 'a new src earns its own re-arm');
});
