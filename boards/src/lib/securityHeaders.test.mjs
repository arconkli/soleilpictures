// securityHeaders.test.mjs — the app had no security headers at all until now.
//
//   node --test src/lib/securityHeaders.test.mjs
//
// Two places must agree, because neither covers everything on its own:
//   public/_headers   — everything the Cloudflare assets service serves
//   src/worker.js     — everything the Worker synthesizes (OG images, share and
//                       public JSON, /api/*, injected crawlable HTML), which
//                       never passes through _headers
//
// This matters more here than in a typical app: note bodies and grid text cells
// are authored through the CRDT and rendered with dangerouslySetInnerHTML on the
// same origin where the Supabase session lives in localStorage. sanitizeNoteHtml
// is the real defence; these headers are the backstop for the day it misses.
//
// IF THIS GOES RED: a header was dropped or renamed. Put it back rather than
// relaxing the test — the point is that removing one is never silent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '../..');
const read = (p) => readFileSync(resolve(BOARDS, p), 'utf8');

const REQUIRED = [
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'strict-transport-security',
  'content-security-policy',
];

test('public/_headers carries the sitewide security block', () => {
  const headers = read('public/_headers').toLowerCase();
  for (const h of REQUIRED) {
    assert.ok(headers.includes(h + ':'), `public/_headers is missing ${h}`);
  }
  assert.ok(headers.includes("frame-ancestors 'none'"), 'CSP must deny framing');
  assert.ok(headers.includes('nosniff'), 'X-Content-Type-Options must be nosniff');
});

test('the Worker applies the same headers to responses it synthesizes', () => {
  const src = read('src/worker.js');
  assert.ok(/const SECURITY_HEADERS\s*=/.test(src), 'worker.js lost SECURITY_HEADERS');
  const block = src.slice(src.indexOf('const SECURITY_HEADERS'), src.indexOf('function withRevalidate'));
  for (const h of REQUIRED) {
    assert.ok(block.includes(`'${h}'`), `worker.js SECURITY_HEADERS is missing ${h}`);
  }
});

test('every Worker response passes through withSecurityHeaders', () => {
  const src = read('src/worker.js');
  // The wrapper exists precisely so new routes cannot forget. If the exported
  // fetch stops delegating to handleFetch through it, that guarantee is gone.
  assert.ok(
    /async fetch\([^)]*\)\s*\{\s*return withSecurityHeaders\(await worker\.handleFetch\(/.test(src),
    'exported fetch must wrap handleFetch in withSecurityHeaders',
  );
  assert.ok(/^export default worker;/m.test(src), 'worker.js must export the named worker object');
  // `this` would be undefined if the runtime invokes fetch detached.
  assert.ok(!/this\.handleFetch/.test(src), 'use the named `worker` binding, not `this`');
});

test('admin tier checks never fall back to the service-role key', () => {
  // A missing SUPABASE_ANON_KEY used to silently promote these requests to
  // carrying the service-role secret. Failing closed is the fix; this asserts
  // the fallback does not come back.
  for (const f of ['src/worker.js', 'src/worker-seo.js']) {
    const src = read(f);
    assert.ok(
      !/SUPABASE_ANON_KEY\s*\|\|\s*env\.SUPABASE_SERVICE_ROLE_KEY/.test(src),
      `${f} reintroduced the anon-key -> service-role fallback`,
    );
  }
});
