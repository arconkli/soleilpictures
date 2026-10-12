// rpcCatchLint.test.mjs — nothing calls .catch() straight on a supabase.rpc()
// builder (DB-11).
//
// The PostgREST builder is a thenable that defines then() and nothing else, so
// `supabase.rpc('x').catch(...)` is a TypeError thrown where it is written.
// Inside Settings → Connections' Promise.all array it threw before the batch
// ran, and the Scout block said "Couldn't generate a code" every time, though
// the code had been minted. Use `.then(ok, err)`, or await it inside try.
//
// Catches the one-line form, which is how this has been written every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(name) && !name.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}

test('no supabase.rpc(...) builder is .catch()ed directly', () => {
  const RX = /\.rpc\(\s*'[A-Za-z0-9_]+'\s*(?:,\s*\{[^}]*\})?\s*\)\s*\.catch\(/;
  const hits = [];
  for (const f of walk(SRC)) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (RX.test(line)) hits.push(`${relative(SRC, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], 'use .then(ok, err) or await in try: .catch is not a builder method');
});
