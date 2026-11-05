// 0865: the daily security check's HTTP allowlist (check 1) knows _indexnow_send,
// and every live function that calls net.http is on it, so a new sender fails
// here at test time instead of paging the owner a day after it ships (0800).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { definitionsOf, migrationFiles, MIGRATIONS_DIR } from './migrationText.mjs';

const ws = s => s.replace(/\s+/g, ' ').trim();

test('0865 is 0863\'s daily check plus the _indexnow_send token', () => {
  const defs = definitionsOf('check_security_invariants');
  const cur = defs[defs.length - 1];
  const prev = defs[defs.length - 2];
  assert.match(cur.file, /^0865_security_invariants_indexnow\.sql$/);
  assert.ok(prev.file.startsWith('0863_'), `previous definition is ${prev.file}`);
  const token = /,\s*'_indexnow_send'/;
  assert.ok(token.test(cur.body));
  assert.equal(ws(cur.body.replace(token, '')), ws(prev.body));
});

test('every live function that calls net.http is on check 1\'s reviewed list', () => {
  const files = migrationFiles();
  const created = new Map(); // name -> { at: [fileIdx, offset], body, file }
  const dropped = new Map(); // name -> [fileIdx, offset]
  const after = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  const createRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\([\s\S]*?as\s*(\$[a-z_]*\$)[\s\S]*?\2\s*;/gi;
  const dropRe = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/gi;
  files.forEach((f, i) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    for (const m of sql.matchAll(createRe)) created.set(m[1], { at: [i, m.index], body: m[0], file: f });
    for (const m of sql.matchAll(dropRe)) dropped.set(m[1], [i, m.index]);
  });

  const live = [...created].filter(([name, c]) => !dropped.has(name) || after(c.at, dropped.get(name)));
  const callers = live.filter(([, c]) => /net\.http/i.test(c.body));

  const checkBody = definitionsOf('check_security_invariants').at(-1).body;
  const list = checkBody.match(/p\.prosrc ilike '%net\.http%'\s+and p\.proname not in \(([^)]*)\)/);
  assert.ok(list, 'check 1 list found');
  const allowed = [...list[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

  const names = callers.map(([n]) => n);
  assert.ok(names.includes('_indexnow_send'), 'scan finds _indexnow_send');
  assert.ok(names.includes('_cron_edge_post'), 'scan finds _cron_edge_post');
  for (const [name, c] of callers) {
    assert.ok(allowed.includes(name),
      `${name} (${c.file}) calls net.http but is not on check_security_invariants check 1's list: review it, then add it there`);
  }
});
