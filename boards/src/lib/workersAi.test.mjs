import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkersAiChat, parseJsonLoose, parseJsonArrayLoose, responseText } from '../worker-llm.js';
import { handleTagsRoute } from '../worker-tags.js';
import { runChat } from './scoutIntent.js';

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

test('every text-model answer is read through responseText, the SEO drafts and Scout too', () => {
  assert.equal(responseText({ response: { a: 1 } }), '{"a":1}');
  assert.equal(responseText({ response: 'plain' }), 'plain');
  assert.equal(responseText({ response: false }), 'false');
  assert.equal(responseText(undefined), '');
  const seo = read('../worker-seo.js');
  assert.doesNotMatch(seo, /function parseJsonLoose/, 'one parser, from worker-llm.js');
  assert.match(seo, /const draft = parseJsonLoose\(responseText\(out\)\);/);
  assert.match(read('./scoutIntent.js'), /return responseText\(body\?\.result\);/);
});

test("Scout's REST path reads a parsed answer as text, and its classifier can reach the model", async () => {
  const realFetch = globalThis.fetch;
  let called = '';
  globalThis.fetch = async (url) => {
    called = String(url);
    return new Response(JSON.stringify({ success: true, result: { response: { topic: 'Scene 4 - Diner', action: 'ingest' } } }));
  };
  try {
    const text = await runChat({ CF_ACCOUNT_ID: 'acct', CF_AI_TOKEN: 't' }, '@cf/meta/llama-3.1-8b-instruct-fp8', 's', 'u');
    assert.deepEqual(parseJsonLoose(text), { topic: 'Scene 4 - Diner', action: 'ingest' });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(called, 'https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/meta/llama-3.1-8b-instruct-fp8');
  assert.match(read('./scoutIntent.js'), /const MODEL = '@cf\/meta\/llama-3\.1-8b-instruct-fp8';/);
  // The Node service has no AI binding, so a binding-only call threw every time.
  const pipeline = read('../../../scout/src/pipeline.js');
  assert.doesNotMatch(pipeline, /runWorkersAiChat\(|import \{[^}]*runWorkersAiChat/);
  assert.match(pipeline, /await runChat\(\s*cfg, '@cf\/meta\/llama-3\.1-8b-instruct-fp8'/);
});

test('doc word-tagging runs on a model Cloudflare still serves', () => {
  const src = read('../worker-tags.js');
  // The plain id was retired on 2026-05-30; every call answered error 5028.
  assert.doesNotMatch(src, /'@cf\/meta\/llama-3\.1-8b-instruct'/);
  assert.match(src, /const APPLY_MODEL = '@cf\/meta\/llama-3\.1-8b-instruct-fp8';/);
});

test('emergent-theme naming is retired: no route, no client, no discovery', () => {
  // It named clusters that no screen showed (useDiscoveredTags was never
  // imported), on every client, every session.
  const worker = read('../worker-tags.js');
  assert.doesNotMatch(worker, /cluster-name|handleClusterName|CLUSTER_NAME/);
  assert.doesNotMatch(read('./tagsClient.js'), /nameCluster|cluster-name/);
  assert.doesNotMatch(read('../hooks/useAiTagger.js'), /runWorkspaceDiscovery|aiDiscovery/);
  assert.throws(() => read('./aiDiscovery.js'), /ENOENT/);
});

test('the canvas scorer never suggests a tag the card already carries', () => {
  const src = read('../hooks/useAiTagger.js');
  assert.match(src, /const toInbox = suggestable\.filter\(c => !alreadyApplied\.has\(c\.tag\.id\)\);/);
  assert.match(src, /if \(toInbox\.length > 0 && target\?\.kind && target\?\.id\) \{\s*const rows = toInbox\.map\(/);
});

// The tag routes against a stand-in Supabase: the token is always good, and the
// daily budget answers `budget`. Records what each call was charged and what
// reached the model.
async function withRoutes(budget, fn) {
  const charged = [];
  const runs = [];
  const env = {
    SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon',
    AI: { run: async (model, input) => {
      runs.push({ model, input });
      return { response: { name: 'Scene Coverage', description: 'Shots', verdicts: [] } };
    } },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1' }));
    if (String(url).includes('/rpc/tags_embed_budget_take')) {
      charged.push(JSON.parse(init.body).p_chars);
      if (budget === 'error') return new Response('boom', { status: 500 });
      return new Response(JSON.stringify(budget));
    }
    throw new Error('unexpected fetch ' + url);
  };
  const call = (path, body) => handleTagsRoute(new URL('https://x.test' + path),
    new Request('https://x.test' + path, {
      method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body),
    }), env);
  try { await fn({ call, charged, runs }); } finally { globalThis.fetch = realFetch; }
}
const applyBody = { cards: [{ id: 'p1', text: 'MARA steps onto the porch.', candidate_tags: [{ id: 'mara', name: 'Mara' }] }] };

test('doc word-tagging reaches the model only on a budget yes', async () => {
  await withRoutes(false, async ({ call, runs }) => {
    assert.equal((await call('/api/tags/apply', applyBody)).status, 429);
    assert.equal(runs.length, 0, 'a no never reaches the model');
  });
  await withRoutes(true, async ({ call, charged, runs }) => {
    assert.equal((await call('/api/tags/apply', applyBody)).status, 200);
    assert.equal(runs.length, 1);
    // Each call is charged everything it sends, the instructions included.
    runs.forEach(({ input }, i) => {
      const [system, user] = input.messages;
      assert.equal(charged[i], system.content.length + user.content.length);
      assert.ok(system.content.length > 1000, 'the instructions are counted');
    });
  });
});

test('one doc word-tagging call is capped however much a client sends', async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ id: `tag-${i}`, name: 'N'.repeat(500), description: 'D'.repeat(900) }));
  await withRoutes(true, async ({ call, runs }) => {
    const res = await call('/api/tags/apply', { cards: [{ id: 'x'.repeat(900), text: 'T'.repeat(20000), candidate_tags: many }] });
    assert.equal(res.status, 200);
    const sent = JSON.parse(runs[0].input.messages[1].content.split('\n\nReturn ONLY')[0]);
    const card = sent.cards[0];
    assert.equal(card.candidate_tags.length, 30);
    assert.ok(card.candidate_tags.every(t => t.name.length === 80 && t.description.length === 200 && t.id.length <= 200));
    assert.equal(card.text.length, 4000);
    assert.equal(card.id.length, 200);
  });
  // A malformed tag list is no tags, not a crash.
  await withRoutes(true, async ({ call, runs }) => {
    assert.equal((await call('/api/tags/apply', { cards: [{ id: 'p', text: 't', candidate_tags: 'oops' }] })).status, 200);
    assert.deepEqual(JSON.parse(runs[0].input.messages[1].content.split('\n\nReturn ONLY')[0]).cards[0].candidate_tags, []);
  });
});

test('a failed budget check is a 503 (retry in a minute), not a spent budget (429, an hour)', async () => {
  await withRoutes('error', async ({ call, runs }) => {
    assert.equal((await call('/api/tags/apply', applyBody)).status, 503);
    assert.equal((await call('/api/tags/embed', { cards: [{ id: 'c', text: 'hello' }] })).status, 503);
    assert.equal(runs.length, 0);
  });
});
