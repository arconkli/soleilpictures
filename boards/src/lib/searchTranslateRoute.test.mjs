// POST /api/search/translate: the real handleSearchRoute with a fake Workers AI
// binding and a stubbed fetch for the token check, the workspace's AI switch
// and the daily budget. Pins the refusals (method, auth, bad input, AI off,
// budget), the model call, the per-isolate cache (answered before the budget is
// charged) and a failing model.
//
// Run: node --test src/lib/searchTranslateRoute.test.mjs

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleSearchRoute } from '../worker-search.js';

const W1 = '99999999-9999-4999-8999-999999999999';
const realFetch = globalThis.fetch;
let aiOn, budgetOk, charged, runs, aiThrows;
let env;

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  aiOn = true; budgetOk = true; charged = 0; runs = []; aiThrows = false;
  env = {
    SUPABASE_URL: 'https://db.test',
    SUPABASE_ANON_KEY: 'anon',
    AI: { run: async (model, input) => { runs.push([model, input]); if (aiThrows) throw new Error('boom'); return { translated_text: ' The car ' }; } },
  };
  globalThis.fetch = async (input) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.pathname === '/auth/v1/user') return reply({ id: 'u1', email: 'a@b.c' });
    if (u.pathname === '/rest/v1/workspaces') return reply([{ ai_tagger_enabled: aiOn }]);
    if (u.pathname === '/rest/v1/rpc/tags_embed_budget_take') { charged++; return reply(budgetOk); }
    return reply(null, 404);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const call = (body, { method = 'POST', auth = 'Bearer tok' } = {}) => handleSearchRoute(
  new URL('https://x.test/api/search/translate'),
  new Request('https://x.test/api/search/translate', {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  }),
  env,
);
const ok = { q: '자동차', source_lang: 'ko', workspace_id: W1 };

test('refusals', async () => {
  assert.equal((await call(null, { method: 'GET' })).status, 405);
  assert.equal((await call(ok, { auth: null })).status, 401);
  assert.equal((await call({ ...ok, q: '  ' })).status, 400);
  assert.equal((await call({ ...ok, q: '가'.repeat(65) })).status, 400);
  assert.equal((await call({ ...ok, source_lang: 'en' })).status, 400);
  assert.equal((await call({ ...ok, source_lang: 'xx' })).status, 400);
  assert.equal((await call({ ...ok, workspace_id: 'nope' })).status, 400);
  assert.equal(runs.length, 0);
});

test('workspace AI off is 403', async () => {
  aiOn = false;
  const r = await call({ ...ok, q: '가나' });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, 'AI suggestions are off for this workspace');
});

test('budget spent is 429', async () => {
  budgetOk = false;
  assert.equal((await call({ ...ok, q: '다라' })).status, 429);
  assert.equal(runs.length, 0);
});

test('translates, then answers the same query from the cache', async () => {
  const r = await call(ok);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { english: 'The car' });
  assert.deepEqual(runs[0], ['@cf/meta/m2m100-1.2b', { text: '자동차', source_lang: 'ko', target_lang: 'en' }]);
  assert.equal(charged, 1);
  const again = await call(ok);
  assert.deepEqual(await again.json(), { english: 'The car' });
  assert.equal(runs.length, 1);
  assert.equal(charged, 1);
});

test('a failing model is 502', async () => {
  aiThrows = true;
  const r = await call({ ...ok, q: '사아' });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, 'translation failed');
});
