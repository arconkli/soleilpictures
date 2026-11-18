import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkersAiChat, parseJsonLoose, parseJsonArrayLoose, responseText } from '../worker-llm.js';
import { handleSearchRoute } from '../worker-search.js';
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
    const text = await runChat({ CF_ACCOUNT_ID: 'acct', CF_AI_TOKEN: 't' }, '@cf/google/gemma-4-26b-a4b-it', 's', 'u');
    assert.deepEqual(parseJsonLoose(text), { topic: 'Scene 4 - Diner', action: 'ingest' });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(called, 'https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/google/gemma-4-26b-a4b-it');
  assert.match(read('./scoutIntent.js'), /const MODEL = '@cf\/google\/gemma-4-26b-a4b-it';/);
  // The Node service has no AI binding, so a binding-only call threw every time.
  const pipeline = read('../../../scout/src/pipeline.js');
  assert.doesNotMatch(pipeline, /runWorkersAiChat\(|import \{[^}]*runWorkersAiChat/);
  assert.match(pipeline, /await runChat\(\s*cfg, '@cf\/google\/gemma-4-26b-a4b-it'/);
});

test("Scout runs on a model Cloudflare still serves", () => {
  // The plain id was retired on 2026-05-30 (error 5028), the fp8 build on 2026-11-20.
  assert.doesNotMatch(read('./scoutIntent.js'), /llama-3\.1-8b-instruct-fp8/);
  assert.doesNotMatch(read('../../../scout/src/pipeline.js'), /llama-3\.1-8b-instruct-fp8/);
});

test('runWorkersAiChat turns thinking off only when asked', async () => {
  const bodies = [];
  const env = { AI: { run: async (_m, body) => { bodies.push(body); return { response: 'x' }; } } };
  await runWorkersAiChat(env, 'm', 's', 'u', { noThinking: true });
  await runWorkersAiChat(env, 'm', 's', 'u');
  assert.deepEqual(bodies[0].chat_template_kwargs, { enable_thinking: false });
  assert.equal('chat_template_kwargs' in bodies[1], false);
});

test("Scout's REST path sends enable_thinking: false when asked", async () => {
  const realFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ success: true, result: { response: 'x' } }));
  };
  try {
    const env = { CF_ACCOUNT_ID: 'acct', CF_AI_TOKEN: 't' };
    await runChat(env, 'm', 's', 'u', { noThinking: true });
    await runChat(env, 'm', 's', 'u');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(bodies[0].chat_template_kwargs, { enable_thinking: false });
  assert.equal('chat_template_kwargs' in bodies[1], false);
});

// Gemma 4 reasons its whole answer away unless thinking is off, so every call
// to it must say noThinking.
test('every call that reaches Gemma 4 passes noThinking: true', () => {
  const files = ['./scoutIntent.js', '../../../scout/src/pipeline.js'];
  for (const f of files) {
    const src = read(f);
    let seen = 0;
    for (const m of src.matchAll(/(?:runWorkersAiChat|runChat)\(/g)) {
      const before = src.slice(Math.max(0, m.index - 20), m.index);
      if (/function $/.test(before)) continue;
      // The argument list: up to the matching close paren.
      let depth = 0; let end = m.index + m[0].length - 1;
      for (; end < src.length; end++) {
        if (src[end] === '(') depth++;
        else if (src[end] === ')' && --depth === 0) break;
      }
      const args = src.slice(m.index, end + 1);
      if (args === 'runWorkersAiChat(env, model, system, user, opts)') continue;
      if (!/gemma-4-26b-a4b-it|\b(?:APPLY_MODEL|MODEL)\b/.test(args)) continue;
      seen++;
      assert.match(args, /noThinking: true/, `${f}: ${args.slice(0, 60)}`);
    }
    assert.ok(seen >= 1, `${f}: found no call to check`);
  }
  const seo = read('../worker-seo.js');
  const part = seo.match(/visionRequest\('part'[^)]*\)/);
  assert.ok(part, 'worker-seo.js asks Gemma 4 for alt text');
  assert.match(part[0], /noThinking: true/);
});

// The translation route against a stand-in Supabase: the token is always good,
// the workspace's AI switch is on, and the daily budget answers `budget`.
// Records what each call was charged and what reached the model.
async function withRoutes(budget, fn) {
  const charged = [];
  const runs = [];
  const env = {
    SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon',
    AI: { run: async (model, input) => {
      runs.push({ model, input });
      return { translated_text: 'a red car' };
    } },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1' }));
    if (String(url).includes('/rest/v1/workspaces')) return new Response(JSON.stringify([{ ai_tagger_enabled: true }]));
    if (String(url).includes('/rpc/tags_embed_budget_take')) {
      charged.push(JSON.parse(init.body).p_chars);
      if (budget === 'error') return new Response('boom', { status: 500 });
      return new Response(JSON.stringify(budget));
    }
    throw new Error('unexpected fetch ' + url);
  };
  const call = (body) => handleSearchRoute(new URL('https://x.test/api/search/translate'),
    new Request('https://x.test/api/search/translate', {
      method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body),
    }), env);
  try { await fn({ call, charged, runs }); } finally { globalThis.fetch = realFetch; }
}
const translateBody = { q: 'voiture rouge', source_lang: 'fr', workspace_id: '11111111-1111-4111-8111-111111111111' };

test('a translation reaches the model only on a budget yes', async () => {
  await withRoutes(false, async ({ call, runs }) => {
    assert.equal((await call(translateBody)).status, 429);
    assert.equal(runs.length, 0, 'a no never reaches the model');
  });
  await withRoutes(true, async ({ call, charged, runs }) => {
    assert.equal((await call(translateBody)).status, 200);
    assert.equal(runs.length, 1);
    assert.equal(charged[0], translateBody.q.length + 200);
  });
});

test('a failed budget check is a 503 (retry in a minute), not a spent budget (429, an hour)', async () => {
  await withRoutes('error', async ({ call, runs }) => {
    // A different query: an answer already cached never asks the budget.
    assert.equal((await call({ ...translateBody, q: 'chat noir' })).status, 503);
    assert.equal(runs.length, 0);
  });
});
