import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Every QA harness main.jsx mounts on its own has to label the analytics rows
// it sends (localMode.js isAnyQaMode → synthetic:true), or a run against a dev
// server holding the real credentials writes them to production as if a person
// had. The list is kept by hand, and twice a harness was left off it: ?imgeditqa
// (a misspelling) and then ?sidebarqa and ?importqa, quiet until the sidebar
// started logging. Source scans: localMode.js reads import.meta.env.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('every harness main.jsx mounts on its own is in QA_MODE_PARAMS', () => {
  const main = read('../main.jsx');
  const local = read('./localMode.js');
  const list = /const QA_MODE_PARAMS = \[([\s\S]*?)\];/.exec(local);
  assert.ok(list, 'QA_MODE_PARAMS not found');
  const labelled = new Set([...list[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]));
  // ?fileshareqa takes a fixture name, not 1, and isAnyQaMode checks it apart.
  assert.match(local, /\|\| !!q\.get\('fileshareqa'\)/);
  labelled.add('fileshareqa');

  const mounted = [...main.matchAll(/import\.meta\.env\.DEV && (is[A-Za-z]+Mode)\(\)/g)].map((m) => m[1]);
  assert.ok(mounted.length >= 15, `found only ${mounted.length} harness branches in main.jsx`);
  const unlabelled = [];
  for (const fn of mounted) {
    const body = new RegExp(`export function ${fn}\\(\\) \\{([\\s\\S]*?)\\n\\}`).exec(local);
    assert.ok(body, `${fn} is not in localMode.js`);
    const param = /\.get\('([a-z]+)'\)/.exec(body[1]);
    assert.ok(param, `${fn} reads no query param`);
    if (!labelled.has(param[1])) unlabelled.push(`${fn} (?${param[1]})`);
  }
  assert.deepEqual(unlabelled, [], 'add these to QA_MODE_PARAMS in localMode.js');
});
