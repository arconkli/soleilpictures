// workspaceErrorScreen.test.mjs — a workspace that can't be read says why in
// words, and a refused sign-in (the server's sign_in_again hint, migration 0854) is told to sign in again, not shown a raw error.
//
//   node --test src/lib/workspaceErrorScreen.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, '..', 'App.jsx'), 'utf8');

test('a refused workspace read tells the person to sign in with the emailed code', () => {
  for (const bit of ["refused={signInAgain(wsError)}", 'refused={signInAgain(activeRootError)}', "e?.code === '42501' && e?.hint === 'sign_in_again'", 'Sign in again to open your clusters', 'Sign in with your email code']) {
    assert.ok(app.includes(bit), bit);
  }
  const from = app.indexOf('function FullScreenError(');
  const refusedBranch = app.slice(from, app.indexOf('const own =', from));
  assert.ok(from > 0 && refusedBranch.length > 0);
  assert.ok(!refusedBranch.includes('<pre'), 'the refusal shows no raw message');
});

test('any other failure offers a reload, or the caller\'s own way out', () => {
  assert.ok(app.includes("own ? actionLabel : 'Try again'"));
  assert.ok(app.includes('window.location.reload()'));
});
