// aiOptOut.test.mjs — a workspace's AI switch reaches every path that sends
// card or doc text to a model.
//
// workspaces.ai_tagger_enabled used to be read only by the embedding tagger;
// the doc cascade, the doc mention verdicts and the candidate classifier
// sent text regardless. Every caller of the model clients must sit behind the
// one gate (hooks/useWorkspaceAiEnabled.js), and a new caller fails here
// until it is classified.
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
  'hooks/useAiTagger.js': /readWorkspaceAiEnabled\(workspaceId\)/,          // never ready when off
  'lib/aiWarmup.js': null,                                                  // only from useAiTagger
  'lib/aiParagraphCascade.js': null,                                        // only from DocPageEditor's gated effect
  'components/DocPageEditor.jsx': /aiCallsAllowedRef\.current = aiEnabled === true && docWritable;/,
  'hooks/useCandidateNames.js': /if \(!\(await readWorkspaceAiEnabled\(wsId\)\)\) return;/,
  // The Worker's own embedder reads each card's workspace switch itself...
  'lib/serverEmbed.js': /if \(!w \|\| w\.ai_tagger_enabled === false\) \{ stats\.skipped\+\+; return false; \}/,
  // ...and the describe job only ever gets pictures and cards the database
  // hands out for workspaces with AI on (0593; visionMigration.test.mjs).
  'worker-vision.js': null,
  // The API's writes go through that embedder, each card under its own
  // board's workspace, the key the embedder's switch reads.
  'worker-api.js': /items\.push\(\{ workspace_id: workspaceId, board_id: boardId,/,
};

test('every caller of a model client is behind the workspace AI switch', () => {
  const callers = new Set();
  for (const p of sources()) {
    const rel = relative(SRC, p);
    if (rel === 'lib/tagsClient.js' || rel === 'lib/candidatesAiClient.js') continue;
    const src = readFileSync(p, 'utf8');
    if (/\b(embedCards|embedOne|applyCards|classifyCandidates)\(/.test(src)) callers.add(rel);
  }
  assert.ok(callers.size >= 4, `the scan found too few callers (${[...callers]})`);
  for (const rel of callers) {
    assert.ok(rel in GATED, `${rel} calls a model client but isn't classified in aiOptOut.test.mjs`);
    if (GATED[rel]) assert.match(read(rel), GATED[rel], `${rel} lost its AI gate`);
  }
});

test('the ungated helpers are only reached through gated callers', () => {
  const importers = (mod) => sources().map((p) => relative(SRC, p))
    .filter((rel) => new RegExp(`from '[./]*${mod}'`).test(read(rel)));
  assert.deepEqual(importers('lib/aiWarmup.js').sort(), ['hooks/useAiTagger.js']);
  assert.deepEqual(importers('lib/aiParagraphCascade.js').sort(), ['components/DocPageEditor.jsx']);
});

test('the doc cascade runs for editors only, and with AI off only re-anchors', () => {
  const doc = read('components/DocPageEditor.jsx');
  assert.match(doc, /if \(!docWritable\) return;/);
  assert.match(doc, /if \(aiEnabled !== true\) \{[\s\S]{0,200}await reconcilePageRanges\(/);
  assert.match(doc, /if \(uncachedToFetch\.length > 0 && aiCallsAllowedRef\.current\) \{/);
  assert.equal((doc.match(/runParagraphCascade\(/g) || []).length, 1, 'one cascade run per pause');
});

test('the Worker refuses an opted-out workspace', () => {
  const tags = read('worker-tags.js');
  assert.equal((tags.match(/if \(await workspaceAiOff\(env, request, body\.workspace_id\)\)/g) || []).length, 2,
    '/embed and /apply both check');
  assert.match(read('worker-ai.js'), /ws\[0\]\?\.ai_tagger_enabled === false/);
});
