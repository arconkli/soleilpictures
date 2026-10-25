// errorToastContract.test.mjs — every error toast names its failure.
//
//   node --test src/lib/errorToastContract.test.mjs
//
// An error toast is reported by its `code` (components/AppFeedback.jsx →
// lib/errorReporting.js reportToast), never by its words, which can quote a
// cluster's or a file's name. One without a code is reported as 'uncoded', and
// every uncoded toast in the app lands in the same group, which tells nobody
// anything. So every object literal holding `type: 'error'` in the app carries
// `code: 'snake_case'` beside it.
//
// The extractor hard-fails when it matches too few: one that matched nothing
// would agree with everything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('..', import.meta.url).pathname;

// Not a person's toast: the admin's screens (pages/admin/, AdminPage.jsx),
// which only staff see, and the Universe simulation worker's own messages
// (pages/admin/universeSimWorker.js), which say type: 'error' to its page.
const exempt = (rel) => rel.startsWith('pages/admin/') || rel === 'pages/AdminPage.jsx';

const CODE_RE = /\bcode:\s*'([a-z][a-z0-9_]{1,59})'/;

function sources(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

// The object literal around `at`: back to its unmatched `{`, forward to its
// matching `}`. Braces inside strings and templates are rare enough in a
// toast's arguments that counting them all is fine here.
function enclosingObject(s, at) {
  let depth = 0;
  let open = -1;
  for (let i = at; i >= 0; i -= 1) {
    if (s[i] === '}') depth += 1;
    else if (s[i] === '{') {
      if (depth === 0) { open = i; break; }
      depth -= 1;
    }
  }
  if (open < 0) return null;
  depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(open, i + 1);
    }
  }
  return null;
}

function errorToasts() {
  const found = [];
  for (const file of sources()) {
    const rel = relative(SRC, file);
    if (exempt(rel)) continue;
    const s = readFileSync(file, 'utf8');
    for (const m of s.matchAll(/\btype:\s*'error'/g)) {
      const line = s.slice(0, m.index).split('\n').length;
      found.push({ where: `${rel}:${line}`, object: enclosingObject(s, m.index) });
    }
  }
  return found;
}

test('every error toast carries a code', () => {
  const toasts = errorToasts();
  assert.ok(toasts.length >= 200, `the extractor found the app's error toasts (${toasts.length})`);
  const missing = toasts.filter((t) => !t.object || !CODE_RE.test(t.object)).map((t) => t.where);
  assert.deepEqual(missing, [], `error toasts without a code: 'snake_case' beside type: 'error':\n  ${missing.join('\n  ')}`);
});

test('a code says what failed', () => {
  for (const { where, object } of errorToasts()) {
    const code = object && CODE_RE.exec(object)?.[1];
    if (!code) continue;
    assert.notEqual(code, 'uncoded', `${where}: 'uncoded' is what a toast without a code is reported as`);
    assert.ok(code.split('_').length >= 2, `${where}: ${code} — say what failed, e.g. restore_failed`);
  }
});
