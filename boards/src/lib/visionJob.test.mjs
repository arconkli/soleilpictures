// The describe job (worker-vision.js) and the server embedder
// (serverEmbed.js) against a fake Worker: what they pay for, in what order,
// what they write, and what they never say in a log.
//
// Run: node --test src/lib/visionJob.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { describeImage, runImageDescribe, runImageEmbedLane } from '../worker-vision.js';
import { embedCards, embedRow, docPageText } from './serverEmbed.js';
import { embedTextForCard, embedHash } from './embedText.js';

const LLAMA = '@cf/meta/llama-3.2-11b-vision-instruct';
const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
const SECRET = 'A lighthouse keeper reads by a green lamp on a stormy night.';
const ANSWER = JSON.stringify({
  description: SECRET, keywords: ['lighthouse', 'storm', 'lamp'], medium: 'film still', shot_type: 'wide',
  lighting: 'night', palette: ['green', 'black'], era: 'period', location: 'interior, lighthouse', text_in_image: null,
});

// A fake Worker: env.AI, env.IMAGES and the Supabase REST calls, each recorded.
function fakeWorld({ claim = [], budget = () => true, finishCards = [], spaces = null, stored = [], ai = {} } = {}) {
  const log = [];
  const env = {
    SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'svc',
    AI: {
      run: async (id, input) => {
        log.push(['ai', id]);
        if (ai[id]) return ai[id](input);
        if (id === '@cf/baai/bge-m3') return { data: input.text.map(() => new Array(1024).fill(0.5)) };
        if (id === GEMMA) return { choices: [{ message: { content: ANSWER } }], usage: { prompt_tokens: 690, completion_tokens: 150 } };
        return { response: ANSWER, usage: { prompt_tokens: 3600, completion_tokens: 110 } };
      },
    },
    IMAGES: {
      get: async (key) => {
        log.push(['r2', key]);
        return { httpMetadata: { contentType: 'image/webp' }, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer, body: { cancel() {} } };
      },
    },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace('/rest/v1/', '');
    const body = init.body ? JSON.parse(init.body) : null;
    const reply = (v, status = 200) => new Response(v == null ? null : JSON.stringify(v), { status });
    log.push(['rest', init.method || 'GET', path, body]);
    if (path === 'rpc/_image_describe_claim') return reply(claim);
    if (path === 'rpc/_ai_budget_take') return reply(budget(body));
    if (path === 'rpc/_image_describe_finish') return reply(body.p_status === 'done' ? finishCards : []);
    if (path === 'rpc/_image_describe_release') return reply(null, 204);
    if (path === 'rpc/_image_card_embed_due') return reply(claim);
    if (path === 'workspaces') return reply(spaces || [{ id: 'ws1', created_by: 'owner1', ai_tagger_enabled: true }]);
    if (path === 'card_embeddings' && (init.method || 'GET') === 'GET') return reply(stored);
    if (path === 'card_embeddings') return reply(null, 204);
    return reply({ message: `unexpected ${path}` }, 500);
  };
  const said = [];
  const realLog = console.log, realWarn = console.warn;
  console.log = (...a) => said.push(a.join(' '));
  console.warn = (...a) => said.push(a.join(' '));
  const restore = () => { globalThis.fetch = realFetch; console.log = realLog; console.warn = realWarn; };
  return { env, log, said, restore };
}

const row = (over = {}) => ({
  image_id: 'img1', lease_token: 'tok1', owner_id: 'owner1', workspace_id: 'ws1',
  storage_path: 'ws1/a.png', preview_path: 'ws1/previews/a.webp', preview_sm_path: 'ws1/previews/a-sm.webp',
  size_bytes: 900000, width: 1200, height: 800, ...over,
});
const card = { workspace_id: 'ws1', board_id: 'b1', card_id: 'c1', title: 'Lighthouse', body: '' };
const calls = (log, path) => log.filter((e) => e[0] === 'rest' && e[2] === path);

test('a claimed picture is paid for, described from its 640px copy, finished and its card embedded', async () => {
  const w = fakeWorld({ claim: [row()], finishCards: [card] });
  try {
    const stats = await runImageDescribe(w.env);
    assert.deepEqual({ claimed: stats.claimed, done: stats.done, cards: stats.cards, embedded: stats.embedded }, { claimed: 1, done: 1, cards: 1, embedded: 1 });
    assert.deepEqual(w.log.find((e) => e[0] === 'r2'), ['r2', 'ws1/previews/a-sm.webp']);
    const budgetAt = w.log.findIndex((e) => e[2] === 'rpc/_ai_budget_take' && e[3].p_kind === 'vision');
    const modelAt = w.log.findIndex((e) => e[0] === 'ai' && e[1] === GEMMA);
    assert.ok(budgetAt >= 0 && budgetAt < modelAt, 'the budget is taken before the model call');
    const fin = calls(w.log, 'rpc/_image_describe_finish')[0][3];
    assert.equal(fin.p_status, 'done');
    assert.equal(fin.p_token, 'tok1');
    assert.equal(fin.p_description, SECRET);
    assert.deepEqual(fin.p_attrs.palette, ['green', 'black']);
    assert.equal(fin.p_tokens_in, 690);
    assert.equal(fin.p_model, GEMMA, 'Gemma 4 first');
    const up = calls(w.log, 'card_embeddings').find((e) => e[1] === 'POST')[3][0];
    const text = embedTextForCard({ title: 'Lighthouse', body: '' }, `${SECRET} lighthouse, storm, lamp`);
    assert.equal(up.content_hash, embedHash(text), 'the browser\'s hash for the same text');
    assert.equal(up.entity_kind, 'card');
    const embedBudget = calls(w.log, 'rpc/_ai_budget_take').find((e) => e[3].p_kind === 'embed')[3];
    assert.deepEqual(embedBudget, { p_owner: 'owner1', p_kind: 'embed', p_units: text.length });
  } finally { w.restore(); }
});

test('a refused budget frees the lease, calls no model and finishes nothing', async () => {
  const w = fakeWorld({ claim: [row()], budget: () => false });
  try {
    const stats = await runImageDescribe(w.env);
    assert.equal(stats.refused, 1);
    assert.equal(w.log.filter((e) => e[0] === 'ai').length, 0);
    assert.equal(calls(w.log, 'rpc/_image_describe_finish').length, 0);
    assert.deepEqual(calls(w.log, 'rpc/_image_describe_release')[0][3], { p_image: 'img1', p_token: 'tok1' });
  } finally { w.restore(); }
});

test('a picture with nothing the model can read is skipped without a call', async () => {
  const w = fakeWorld({ claim: [row({ storage_path: 'ws1/a.heic', preview_path: null, preview_sm_path: null })] });
  try {
    const stats = await runImageDescribe(w.env);
    assert.equal(stats.skipped, 1);
    assert.equal(w.log.filter((e) => e[0] === 'ai' || e[0] === 'r2').length, 0);
    const fin = calls(w.log, 'rpc/_image_describe_finish')[0][3];
    assert.deepEqual([fin.p_status, fin.p_error], ['skipped', 'no_rendition']);
  } finally { w.restore(); }
});

test('a model that fails outright hands over to the next, which is paid for again; a poor answer does not', async () => {
  const broken = { [GEMMA]: async () => { throw new Error('3040: capacity'); } };
  const w = fakeWorld({ claim: [row()], finishCards: [], ai: broken });
  try {
    const stats = await runImageDescribe(w.env);
    assert.equal(stats.done, 1);
    assert.equal(calls(w.log, 'rpc/_ai_budget_take').filter((e) => e[3].p_kind === 'vision').length, 2);
    assert.equal(calls(w.log, 'rpc/_image_describe_finish')[0][3].p_model, LLAMA);
  } finally { w.restore(); }
  const poor = { [GEMMA]: async () => ({ choices: [{ message: { content: 'A lighthouse at night, seen from the sea.' } }] }) };
  const w2 = fakeWorld({ claim: [row()], ai: poor });
  try {
    const stats = await runImageDescribe(w2.env);
    assert.equal(stats.failed, 1);
    assert.equal(w2.log.filter((e) => e[0] === 'ai').length, 1, 'no second call for an answer that was not JSON');
    assert.deepEqual(calls(w2.log, 'rpc/_image_describe_finish')[0][3].p_error, 'malformed');
  } finally { w2.restore(); }
});

test('nothing the model said reaches a log line', async () => {
  const w = fakeWorld({ claim: [row(), row({ image_id: 'img2', lease_token: 'tok2' })], finishCards: [card] });
  try {
    await runImageDescribe(w.env);
    assert.ok(w.said.length > 0, 'the run logs its counts');
    for (const line of w.said) {
      assert.ok(!line.includes('lighthouse') && !line.includes('Lighthouse') && !line.includes('lamp'), line);
    }
  } finally { w.restore(); }
});

test('without a payer only the first model is tried', async () => {
  const w = fakeWorld({ ai: { [GEMMA]: async () => { throw new Error('boom'); } } });
  try {
    const r = await describeImage(w.env, { bytes: new Uint8Array([1, 2]), mime: 'image/png' });
    assert.deepEqual([r.ok, r.reason], [false, 'model_error']);
    assert.equal(w.log.filter((e) => e[0] === 'ai').length, 1);
  } finally { w.restore(); }
});

test('the embedder touches an unchanged row, skips a workspace with AI off and embeds doc pages as the browser does', async () => {
  const text = embedTextForCard({ title: 'Lighthouse', body: '' }, 'A lighthouse.');
  const w = fakeWorld({
    stored: [{ card_id: 'c1', content_hash: embedHash(text) }],
    spaces: [{ id: 'ws1', created_by: 'owner1', ai_tagger_enabled: true }, { id: 'off', created_by: 'o2', ai_tagger_enabled: false }],
  });
  try {
    const res = await embedCards(w.env, [
      { ...card, description: 'A lighthouse.', content_hash: null },
      { workspace_id: 'off', board_id: 'b2', card_id: 'c2', title: 'x', body: 'y' },
      { entity_kind: 'doc-page', page_id: 'p1', doc_card_id: 'd1', board_id: 'b1', workspace_id: 'ws1', page_title: 'Plan', page_text: 'Shoot at dawn.' },
    ]);
    assert.deepEqual({ embedded: res.embedded, unchanged: res.unchanged, skipped: res.skipped }, { embedded: 1, unchanged: 1, skipped: 1 });
    assert.ok(calls(w.log, 'card_embeddings').some((e) => e[1] === 'PATCH' && 'embedded_at' in e[3]), 'the unchanged row is touched');
    const up = calls(w.log, 'card_embeddings').find((e) => e[1] === 'POST')[3];
    assert.equal(up.length, 1);
    assert.deepEqual([up[0].entity_kind, up[0].card_id, up[0].doc_card_id], ['doc-page', 'p1', 'd1']);
    assert.equal(up[0].content_hash, embedHash('Plan\nShoot at dawn.'));
    assert.equal(w.log.filter((e) => e[0] === 'ai').length, 1, 'one model call, for the page');
  } finally { w.restore(); }
  assert.equal(docPageText('', 'Only text'), 'Only text');
  assert.equal(embedRow({ workspace_id: 'ws1', card_id: 'c1', title: '', body: '' }), null, 'nothing to embed');
});

test('the embed lane re-embeds a described card whose embedding is stale', async () => {
  const w = fakeWorld({
    claim: [{ ...card, description: SECRET, keywords: ['lighthouse'], content_hash: 'old', owner_id: 'owner1' }],
  });
  try {
    const res = await runImageEmbedLane(w.env);
    assert.deepEqual([res.due, res.embedded], [1, 1]);
    const up = calls(w.log, 'card_embeddings').find((e) => e[1] === 'POST')[3][0];
    assert.equal(up.content_hash, embedHash(embedTextForCard({ title: 'Lighthouse', body: '' }, `${SECRET} lighthouse`)));
  } finally { w.restore(); }
});
