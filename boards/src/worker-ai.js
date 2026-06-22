// Free Cloudflare Workers AI "type + confirm" layer for candidate names.
//
//   POST /api/ai/candidates  { workspace_id, candidates: [{ name, sample, n, type }] }
//     -> { verdicts: [{ name, type, keep, confidence }], classified, cached }
//
// The deterministic get_candidate_names (migration 0162) surfaces precise
// candidate proper-nouns but guesses their TYPE with a regex and can't drop
// residual generic junk. This route runs a TINY Workers AI model over the
// candidate set to (a) pick the best entity type (character/setting/
// organization/concept/thing) and (b) flag non-entities (keep=false).
//
// COST DESIGN — uses as little AI as possible (the user's last AI attempt,
// gpt-4o per-card-per-keystroke, blew the bill):
//   * tiny model (llama-3.2-3b), free in-worker tier, no API key.
//   * per-CANDIDATE cache in candidate_ai_cache (0163): the model runs ONLY
//     on names never seen before -> ~once per brand-new name per workspace,
//     ever. After warmup almost every request is a 100% cache hit = ZERO
//     model calls. Verdicts are shared across all users in the workspace.
//   * per-workspace + global daily caps (candidate_ai_quota) that fall back
//     to the deterministic verdict instead of calling the model.
//   * purely additive: any failure/skip returns the candidate unchanged
//     (keep=true, deterministic type), never worse than 0162.
//
// Auth: any logged-in user (verifyUser) + workspace membership. Writes go
// through the service role; the client never touches candidate_ai_cache.

import { parseJsonArrayLoose, runWorkersAiChat } from './worker-llm.js';

const MODEL = '@cf/meta/llama-3.2-3b-instruct';
const MAX_CANDIDATES = 60;     // matches get_candidate_names p_limit
const SAMPLE_MAXLEN = 200;
const WS_DAILY_CAP = 200;      // candidates classified per workspace per day
const GLOBAL_DAILY_CAP = 5000; // candidates classified across all workspaces per day
const VALID_TYPES = ['character', 'setting', 'organization', 'concept', 'thing'];
const UUID_RE = /^[0-9a-f-]{36}$/i;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}
function cors204() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
    },
  });
}

// FNV-1a (32-bit) — stable, fast hash for the cache key's sample_hash.
function hashStr(s) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// Verify the caller's Supabase JWT (any logged-in user). Mirrors the
// verifyUser in worker-tags.js.
async function verifyUser(env, token) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, error: 'supabase env not configured' };
  }
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return { ok: false, status: 401, error: 'invalid token' };
  const u = await r.json().catch(() => null);
  if (!u?.id) return { ok: false, status: 401, error: 'invalid token' };
  return { ok: true, userId: u.id };
}

// Workspace membership check under the caller's JWT (so RLS/auth.uid()
// applies). Prevents poisoning another workspace's cache / quota.
async function isMember(env, token, workspaceId) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/is_workspace_member`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ws: workspaceId }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return false;
    return (await r.json().catch(() => null)) === true;
  } catch { return false; }
}

// Service-role REST helpers (used after the auth + membership gate).
async function sbGet(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`sbGet ${path} ${res.status}`);
  return res.json();
}
async function sbUpsert(env, table, rows, onConflict) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`sbUpsert ${table} ${res.status}`);
}
async function sbRpc(env, fn, args) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args || {}),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`sbRpc ${fn} ${res.status}`);
  return res.json();
}

export async function handleAiRoute(url, request, env) {
  if (request.method === 'OPTIONS') return cors204();
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'auth required' }, 401);
  let auth;
  try { auth = await verifyUser(env, token); } catch { return json({ error: 'auth check failed' }, 502); }
  if (!auth.ok) return json({ error: auth.error }, auth.status || 401);

  try {
    if (url.pathname === '/api/ai/candidates') return await handleClassifyCandidates(request, env, token);
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
  return json({ error: 'not found' }, 404);
}

const CLASSIFY_SYSTEM = [
  'You classify candidate "entities" surfaced from a creative-writing / film & TV production app (Soleil Clusters). Users write screenplays, character bios, world-building docs, and moodboard notes.',
  'Each candidate is a recurring capitalized word plus a short snippet of the prose it appears in ("context") and how many times it occurs ("count").',
  'For EACH candidate decide two things:',
  '1) keep — true if it is a genuine STORY ENTITY worth turning into a tag: a specific character, place/setting, organization/group, named thing, or a meaningful recurring concept in the user\'s fiction or project. false if it is generic noise: a common word, a form-field label (e.g. "Status", "Religion", "Fears"), a sentence-starting verb, a screenplay/UI term (e.g. "Scene", "Cut"), a day/month, or anything too generic to be a useful tag.',
  '2) type — the best single category:',
  '   - "character": a person, being, or creature (usually a single capitalized name used in prose).',
  '   - "setting": a place or location (city, building, room, planet, region).',
  '   - "organization": a group, faction, company, family, gang, cult, or army (e.g. "the Mob", "Lumon", "the Cavalry").',
  '   - "thing": a specific named object, artifact, vehicle, or work (a weapon, a ship, a film/book title).',
  '   - "concept": a recurring theme/idea/topic that is not a person, place, org, or object.',
  'Judge from the CONTEXT, not just the word. Use count as a weak signal (higher = more likely a real entity).',
  'Be strict on keep: if you are not confident it is a real, specific story entity, set keep=false.',
].join('\n');

async function handleClassifyCandidates(request, env, token) {
  if (!env.AI) return json({ error: 'env.AI (Workers AI) binding not configured' }, 500);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, 500);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const workspaceId = (body.workspace_id || '').trim();
  if (!UUID_RE.test(workspaceId)) return json({ error: 'valid workspace_id required' }, 400);
  if (!(await isMember(env, token, workspaceId))) return json({ error: 'not a workspace member' }, 403);

  // Normalize + dedupe candidates.
  const byLc = new Map();
  for (const c of (Array.isArray(body.candidates) ? body.candidates : [])) {
    const name = typeof c?.name === 'string' ? c.name.trim() : '';
    if (!name) continue;
    const name_lc = name.toLowerCase();
    if (byLc.has(name_lc)) continue;
    const sample = String(c.sample || '').slice(0, SAMPLE_MAXLEN);
    byLc.set(name_lc, {
      name,
      name_lc,
      sample,
      n: Number(c.n) || 0,
      type: VALID_TYPES.includes(c.type) ? c.type : null, // deterministic guess
      sample_hash: hashStr(name_lc + '|' + sample),
    });
    if (byLc.size >= MAX_CANDIDATES) break;
  }
  const cands = [...byLc.values()];
  if (cands.length === 0) return json({ verdicts: [], classified: 0, cached: 0 }, 200);

  // 1. Cache lookup — fetch this workspace's cached verdicts, match by
  //    (name_lc, sample_hash). A workspace's cache is small, so one GET.
  const cacheMap = new Map();
  try {
    const rows = await sbGet(env,
      `candidate_ai_cache?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=name_lc,sample_hash,type,keep,confidence`);
    for (const r of (rows || [])) cacheMap.set(`${r.name_lc}|${r.sample_hash}`, r);
  } catch { /* cache read failed -> treat all as misses; still safe */ }

  const verdicts = [];
  const misses = [];
  for (const c of cands) {
    const hit = cacheMap.get(`${c.name_lc}|${c.sample_hash}`);
    if (hit) {
      verdicts.push({ name: c.name, type: hit.type || c.type, keep: hit.keep !== false, confidence: hit.confidence ?? null });
    } else {
      misses.push(c);
    }
  }

  // 2. No misses -> all cached -> ZERO model calls.
  if (misses.length === 0) {
    return json({ verdicts, classified: 0, cached: verdicts.length }, 200);
  }

  // 3. Quota guard — over budget -> deterministic passthrough, no model call.
  let wsToday = 0, globalToday = 0;
  try {
    const q = await sbRpc(env, 'candidate_ai_quota', { p_workspace_id: workspaceId });
    const row = Array.isArray(q) ? q[0] : q;
    wsToday = Number(row?.ws_today) || 0;
    globalToday = Number(row?.global_today) || 0;
  } catch { /* if quota read fails, fall through and allow (caps are a backstop) */ }
  if (wsToday >= WS_DAILY_CAP || globalToday >= GLOBAL_DAILY_CAP) {
    for (const c of misses) verdicts.push({ name: c.name, type: c.type, keep: true, confidence: null });
    return json({ verdicts, classified: 0, cached: verdicts.length - misses.length, throttled: true }, 200);
  }

  // 4. ONE batched model call over the misses only.
  let aiArr = null;
  try {
    const userMsg = JSON.stringify({
      candidates: misses.map((c) => ({ name: c.name, context: c.sample, count: c.n })),
    }) + '\n\nReturn ONLY a JSON array, one object per candidate in the same order: '
      + `[{"name": string, "type": one of ${JSON.stringify(VALID_TYPES)}, "keep": boolean, "confidence": number between 0 and 1}]. No markdown, no prose.`;
    const resp = await runWorkersAiChat(env, MODEL, CLASSIFY_SYSTEM, userMsg, { max_tokens: 900, temperature: 0.2 });
    aiArr = parseJsonArrayLoose(resp);
  } catch { aiArr = null; }

  const aiByName = new Map();
  if (Array.isArray(aiArr)) {
    for (const a of aiArr) {
      if (a && typeof a.name === 'string') aiByName.set(a.name.trim().toLowerCase(), a);
    }
  }

  // 5. Merge — model verdict where present, deterministic passthrough where
  //    the model gave nothing. Only CACHE real model verdicts so a transient
  //    failure retries next load instead of sticking as junk.
  const toUpsert = [];
  for (const c of misses) {
    const a = aiByName.get(c.name_lc);
    let type = c.type, keep = true, confidence = null;
    if (a) {
      type = VALID_TYPES.includes(a.type) ? a.type : (c.type || 'concept');
      keep = a.keep !== false;
      confidence = (typeof a.confidence === 'number' && a.confidence >= 0 && a.confidence <= 1) ? a.confidence : null;
      toUpsert.push({ workspace_id: workspaceId, name_lc: c.name_lc, sample_hash: c.sample_hash, type, keep, confidence });
    }
    verdicts.push({ name: c.name, type, keep, confidence });
  }

  if (toUpsert.length) {
    try { await sbUpsert(env, 'candidate_ai_cache', toUpsert, 'workspace_id,name_lc,sample_hash'); } catch { /* best effort */ }
  }

  return json({ verdicts, classified: toUpsert.length, cached: verdicts.length - misses.length }, 200);
}
