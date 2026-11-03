// homeScreenApp.test.mjs — the staging redirect must never fire from a Home
// Screen app, and the admin web manifest must keep the whole origin in scope.
//
//   node --test src/lib/homeScreenApp.test.mjs
//
// What this guards:
//   * maybeRedirectToLatest() returns on inHomeScreenApp() before it asks for
//     the staging target (the hop opened the preview outside the app, and the
//     two origins then shared one refresh-token family: the session was revoked);
//   * inHomeScreenApp() is true for iOS navigator.standalone and for the
//     standalone / fullscreen display modes, false in a browser tab;
//   * admin.webmanifest keeps scope "/" (so "/" links stay inside the app) and
//     starts at /admin.
//
// stagingRedirect.js imports supabase.js, which reads import.meta.env and so
// cannot load under node; the function is lifted out of the source text and
// run against stubbed globals instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = readFileSync(resolve(ROOT, 'src/lib/stagingRedirect.js'), 'utf8');

// The text of a top-level function: from its `function` line to the first
// closing brace in column 0.
function bodyOf(name) {
  const m = SRC.match(new RegExp(`(?:export )?(?:async )?function ${name}\\(\\) \\{\\n([\\s\\S]*?)\\n\\}\\n`));
  assert.ok(m, `${name} not found in stagingRedirect.js`);
  return m[1];
}

test('maybeRedirectToLatest returns from a Home Screen app before it reads the staging target', () => {
  const body = bodyOf('maybeRedirectToLatest');
  const guard = body.indexOf('if (inHomeScreenApp()) return;');
  const target = body.indexOf('getStagingTarget()');
  assert.ok(guard >= 0, 'the inHomeScreenApp guard is missing');
  assert.ok(target >= 0, 'getStagingTarget() call not found');
  assert.ok(guard < target, 'the guard must come before getStagingTarget()');
});

function run({ navigator, matchMedia }) {
  const fn = new Function('navigator', 'matchMedia', `${bodyOf('inHomeScreenApp')}`);
  // `typeof navigator` / `typeof matchMedia` inside the body see these params.
  return fn(navigator, matchMedia);
}

const media = (...on) => (q) => ({ matches: on.some((m) => q === `(display-mode: ${m})`) });

test('inHomeScreenApp is true for iOS navigator.standalone', () => {
  assert.equal(run({ navigator: { standalone: true }, matchMedia: media() }), true);
});

test('inHomeScreenApp is true for the standalone and fullscreen display modes', () => {
  assert.equal(run({ navigator: {}, matchMedia: media('standalone') }), true);
  assert.equal(run({ navigator: {}, matchMedia: media('fullscreen') }), true);
});

test('inHomeScreenApp is false in an ordinary browser tab', () => {
  assert.equal(run({ navigator: {}, matchMedia: media() }), false);
  assert.equal(run({ navigator: { standalone: false }, matchMedia: media('browser') }), false);
  assert.equal(run({ navigator: undefined, matchMedia: undefined }), false);
});

test('inHomeScreenApp is false, not a throw, when matchMedia throws', () => {
  const boom = () => { throw new Error('nope'); };
  assert.equal(run({ navigator: {}, matchMedia: boom }), false);
});

test('admin.webmanifest scopes the whole origin and starts at /admin', () => {
  const m = JSON.parse(readFileSync(resolve(ROOT, 'public/admin.webmanifest'), 'utf8'));
  assert.equal(m.scope, '/');
  assert.equal(m.start_url, '/admin');
});
