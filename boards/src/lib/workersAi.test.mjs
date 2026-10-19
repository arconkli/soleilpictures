import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkersAiChat, parseJsonLoose, parseJsonArrayLoose } from '../worker-llm.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const envAnswering = (response) => ({ AI: { run: async () => ({ response }) } });

test('an answer Workers AI already parsed still reaches the parsers as JSON text', async () => {
  // What llama-3.2-3b returned for a cluster name on 2026-10-19.
  const obj = { name: 'Film Shoot', description: 'Camera shots and coverage for a movie scene' };
  const text = await runWorkersAiChat(envAnswering(obj), 'm', 's', 'u');
  assert.equal(typeof text, 'string');
  assert.deepEqual(parseJsonLoose(text), obj);
  const arr = [{ name: 'Mob', type: 'organization', keep: true, confidence: 0.9 }];
  assert.deepEqual(parseJsonArrayLoose(await runWorkersAiChat(envAnswering(arr), 'm', 's', 'u')), arr);
});

test('a text answer passes through untouched, and an empty one is empty', async () => {
  const fenced = '```json\n{"verdicts":[]}\n```';
  assert.equal(await runWorkersAiChat(envAnswering(fenced), 'm', 's', 'u'), fenced);
  assert.deepEqual(parseJsonLoose(fenced), { verdicts: [] });
  assert.equal(await runWorkersAiChat(envAnswering(undefined), 'm', 's', 'u'), '');
  assert.equal(await runWorkersAiChat(envAnswering(null), 'm', 's', 'u'), '');
});

test('doc word-tagging runs on a model Cloudflare still serves', () => {
  const src = read('../worker-tags.js');
  // The plain id was retired on 2026-05-30; every call answered error 5028.
  assert.doesNotMatch(src, /'@cf\/meta\/llama-3\.1-8b-instruct'/);
  assert.match(src, /const APPLY_MODEL = '@cf\/meta\/llama-3\.1-8b-instruct-fp8';/);
});

test('a cluster is rejected only by the model, never by a failed call', () => {
  const src = read('./aiDiscovery.js');
  const skip = src.indexOf('if (!named) continue;');
  const decide = src.indexOf("const status = name ? 'named' : 'rejected';");
  assert.ok(skip > 0 && decide > skip, 'a failed naming call records nothing and is asked again next pass');
});

test('the canvas scorer never suggests a tag the card already carries', () => {
  const src = read('../hooks/useAiTagger.js');
  assert.match(src, /const toInbox = suggestable\.filter\(c => !alreadyApplied\.has\(c\.tag\.id\)\);/);
  assert.match(src, /if \(toInbox\.length > 0 && target\?\.kind && target\?\.id\) \{\s*const rows = toInbox\.map\(/);
});
