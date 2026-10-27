// tagColorKey.test.mjs — a tag wears one colour everywhere.
//
// An uncoloured tag's colour is a hash, and the sidebar and the tag page
// hashed its slug while the canvas chips, the picker, Cmd-K and the doc
// hashed its name: "Onyx" was green in the sidebar and pink on its card.
// Every surface goes through resolveTagColor (lib/tagColor.js), which hashes
// the name first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('..', import.meta.url).pathname;

function sources(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

test('no surface hashes a tag\'s colour from its slug', () => {
  const bad = [];
  for (const p of sources()) {
    const rel = relative(SRC, p);
    if (rel === 'lib/tagColor.js') continue;
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/tagFallbackColor\(([^)]*)\)/g)) {
      if (/\.slug\b/.test(m[1])) bad.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, [], 'use resolveTagColor(tag)');
});

test('resolveTagColor hashes the name first', () => {
  const src = readFileSync(join(SRC, 'lib/tagColor.js'), 'utf8');
  assert.match(src, /return tag\.color \|\| tagFallbackColor\(tag\.name \|\| tag\.slug \|\| tag\.id\);/);
});
