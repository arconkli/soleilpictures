// aiOptOut.test.mjs — a workspace's AI switch reaches every path that sends
// picture or search text to a model.
//
// workspaces.ai_tagger_enabled now gates picture reading, search translation
// and the server's embedder. Every caller of the model clients must sit behind
// the switch, and a new caller fails here until it is classified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('..', import.meta.url).pathname;
const read = (rel) => readFileSync(join(SRC, rel), 'utf8');

function sources(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

// Where each model client is called, and how that place is gated.
const GATED = {
  // The Worker's own embedder reads each card's workspace switch itself...
  'lib/serverEmbed.js': /if \(!w \|\| w\.ai_tagger_enabled === false\) \{ stats\.skipped\+\+; return false; \}/,
  // ...and the describe job only ever gets pictures and cards the database
  // hands out for workspaces with AI on (0593; visionMigration.test.mjs).
  'worker-vision.js': null,
};

test('every caller of a model client is behind the workspace AI switch', () => {
  const callers = new Set();
  for (const p of sources()) {
    const rel = relative(SRC, p);
    const src = readFileSync(p, 'utf8');
    if (/\b(embedCards|embedOne)\(/.test(src)) callers.add(rel);
  }
  assert.ok(callers.size >= 2, `the scan found too few callers (${[...callers]})`);
  for (const rel of callers) {
    assert.ok(rel in GATED, `${rel} calls a model client but isn't classified in aiOptOut.test.mjs`);
    if (GATED[rel]) assert.match(read(rel), GATED[rel], `${rel} lost its AI gate`);
  }
});

test('the Worker refuses an opted-out workspace', () => {
  const search = read('worker-search.js');
  assert.match(search, /if \(await workspaceAiOff\(env, request, body\.workspace_id\)\)/);
  assert.match(read('worker-aiShared.js'), /rows\[0\]\?\.ai_tagger_enabled === false/);
});
