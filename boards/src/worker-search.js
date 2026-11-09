// Cloudflare Worker handler for picture search from any language.
//
//   POST /api/search/translate  — a search query in another language, put into
//                                 English by Workers AI (m2m100), so the app can
//                                 match it against the English picture
//                                 descriptions (entity_search.seen).
//
// App-internal, like /api/tags/*: signed-in callers only, AI switch and the
// daily AI budget respected (it spends the same budget as embeddings).

import { verifyUser } from './lib/workerAuth.js';
import { answeredWith } from './lib/workerErrors.js';
import { M2M100_LANGS } from './lib/searchTranslate.js';
import { json, workspaceAiOff, takeEmbedBudget, budgetRefusal } from './worker-tags.js';

const MODEL = '@cf/meta/m2m100-1.2b';
const TIMEOUT_MS = 8000;
const MAX_CODE_POINTS = 64;
const CACHE_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-isolate: the same query asked twice costs nothing. Oldest dropped.
const _cache = new Map();

export async function handleSearchRoute(url, request, env) {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const auth = await verifyUser(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status || 401);

    if (url.pathname === '/api/search/translate') return await handleTranslate(request, env);
    return json({ error: 'not found' }, 404);
  } catch (e) {
    answeredWith(request, e);
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return json({ error: timedOut ? 'upstream timeout' : 'internal error' }, timedOut ? 504 : 500);
  }
}

async function handleTranslate(request, env) {
  if (!env.AI) return json({ error: 'env.AI (Workers AI) binding not configured' }, 500);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'invalid body' }, 400);
  const q = String(body.q ?? '').trim();
  const points = [...q].length;
  if (points < 1 || points > MAX_CODE_POINTS) return json({ error: `q must be 1 to ${MAX_CODE_POINTS} characters` }, 400);
  const lang = body.source_lang;
  if (typeof lang !== 'string' || !M2M100_LANGS.has(lang)) return json({ error: 'unsupported source_lang' }, 400);
  if (typeof body.workspace_id !== 'string' || !UUID.test(body.workspace_id)) return json({ error: 'invalid workspace_id' }, 400);

  if (await workspaceAiOff(env, request, body.workspace_id)) {
    return json({ error: 'AI suggestions are off for this workspace' }, 403);
  }

  const key = lang + '\u0000' + q;
  if (_cache.has(key)) return json({ english: _cache.get(key) }, 200);

  const budget = await takeEmbedBudget(env, request, q.length + 200);
  if (budget !== 'ok') return budgetRefusal(budget, 'translation');

  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), TIMEOUT_MS); });
  let out;
  try {
    out = await Promise.race([
      env.AI.run(MODEL, { text: q, source_lang: lang, target_lang: 'en' }),
      timeout,
    ]);
  } catch (_) {
    return json({ error: 'translation failed' }, 502);
  } finally {
    clearTimeout(timer);
  }
  if (out === 'timeout') return json({ error: 'upstream timeout' }, 504);
  const text = typeof out?.translated_text === 'string' ? out.translated_text.trim() : '';
  if (!text) return json({ error: 'translation failed' }, 502);

  const english = text.slice(0, 200);
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(key, english);
  return json({ english }, 200);
}
