// SEO AI tooling routes (migration 0137). Admin-only. Two endpoints:
//
//   POST /api/seo/draft  { board_id }
//     A text model drafts { seo_title, seo_description, seo_body, suggested_keyword }
//     GROUNDED in the board's real content (name, tags, card titles, notes) so
//     the output is unique per board. Returns the draft to the client — does NOT
//     save. The admin edits + saves via the normal publish flow (human-in-loop).
//
//   POST /api/seo/alt    { board_id }
//     A vision model writes descriptive alt text for image cards that lack it,
//     into the card_alts sidecar (source='ai'). Fixes the empty-alt gap that
//     blocks Google Images. Returns the generated set for admin spot-check.
//
// Inference runs on Cloudflare Workers AI via env.AI (free in-worker tier — no
// API key/credits). Both gate on tier='admin' (get_my_tier with the caller's
// JWT), then use the service-role key for privileged reads/writes — same admin
// pattern as handleBackfillImageSizes in worker.js.
//
//   POST /api/seo/indexnow  { slug } | { paths: [...] } | { all: true }
//     Tell IndexNow (Bing/Yandex) a public URL changed. Admin-only like the
//     others, but it needs no Workers AI and its body is not a board_id — see
//     handleSeoRoute for why that mattered. The request itself is sent by the
//     database (_indexnow_send, 0800): IndexNow answers 429 to Worker egress.

import { SEO_LANDING_LISTED } from './lib/seoLanding.js';
import { SEO_LISTICLE_INDEX } from './lib/seoListicleIndex.js';
import { DOCS_PATHS } from './lib/docsiteIndex.js';
import { parseJsonLoose, responseText } from './worker-llm.js';
import { answeredWith, jobFailed } from './lib/workerErrors.js';

// Cloudflare Workers AI (free in-worker tier — no API key/credits). The vision
// model captions images for alt text; the text model drafts SEO copy. Both run
// via the env.AI binding (declared in wrangler.toml). Models are swappable.
const VISION_MODEL = '@cf/llava-hf/llava-1.5-7b-hf';
const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const UUID_RE = /^[0-9a-f-]{36}$/i;
const SITE_ORIGIN = 'https://clusters.soleilpictures.com';
// IndexNow ownership key (public token, not a secret). Worker serves it at
// /<key>.txt (see worker.js) so Bing/Yandex can verify our submissions.
// NOTE: IndexNow is Bing/Yandex only — Google ignores it; Google indexing is
// driven by the sitemap + GSC. Kept because it's near-free coverage.
export const INDEXNOW_KEY = 'a7f3c1e94b8d4f26a0e5c7d213b6f80a';
const ALT_BATCH = 12;          // images per /api/seo/alt call (re-run for more)
const ALT_CONCURRENCY = 3;     // vision calls in flight
const ALT_MAXLEN = 125;

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

// REST helpers (service-role) — used after the admin gate passes, and by the
// cron's build ping (runIndexNowForBuild), which has no caller to gate.
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
  if (!res.ok) throw new Error(`sbUpsert ${table} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
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
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`sbRpc ${fn} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}
async function sbInsert(env, table, row) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`sbInsert ${table} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

// Returns the caller's tier, or null if it cannot be established. Every caller
// treats null as "not an admin", so failing closed here is a denial.
export async function getTier(env, userToken) {
  // Previously `SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY`. The role comes
  // from the user JWT below, so the fallback was not live escalation — but a
  // missing binding would silently put the service-role secret on the wire for
  // a plain tier lookup. Deny instead; a misconfigured deploy should fail the
  // admin check, not quietly upgrade the credential it uses.
  if (!env.SUPABASE_ANON_KEY || !userToken) return null;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_my_tier`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${userToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) ? data[0]?.tier : data?.tier;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const out = new Array(items.length);
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function handleSeoRoute(url, request, env) {
  if (request.method === 'OPTIONS') return cors204();
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const userToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!userToken) return json({ error: 'auth required' }, 401);
  let tier;
  try { tier = await getTier(env, userToken); } catch { return json({ error: 'tier check failed' }, 502); }
  if (tier !== 'admin') return json({ error: 'admin only' }, 403);

  let body = {};
  try { body = await request.json(); } catch (_) {}

  // IndexNow first. It needs no Workers AI, and its body is { slug } / { paths } — never a board_id. It sat BELOW the
  // draft/alt preconditions from the day it shipped, so every ping the admin
  // client ever sent was answered 400 'valid board_id required' and swallowed
  // by the best-effort caller: the route had never once reached its handler.
  if (url.pathname === '/api/seo/indexnow') {
    try { return await handleIndexNow(env, body); } catch (e) { answeredWith(request, e); return json({ error: e?.message || String(e) }, 500); }
  }

  if (!env.AI) return json({ error: 'Workers AI (env.AI) binding not configured on the Worker' }, 500);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set on the Worker' }, 500);
  const boardId = (body.board_id || '').trim();
  if (!UUID_RE.test(boardId)) return json({ error: 'valid board_id required' }, 400);

  try {
    if (url.pathname === '/api/seo/draft') return await handleSeoDraft(env, boardId);
    if (url.pathname === '/api/seo/alt') return await handleSeoAlt(env, boardId);
  } catch (e) {
    answeredWith(request, e);
    return json({ error: e?.message || String(e) }, 500);
  }
  return json({ error: 'not found' }, 404);
}

// ── /api/seo/indexnow ───────────────────────────────────────────────────────
// Submit public URLs to IndexNow (Bing/Yandex). Called by the admin client
// after publishing a board ({ slug }) and from the Discover tab for the
// marketing/docs pages ({ paths } or { all: true }). Best-effort — never
// throws upward. Bing's index is what ChatGPT search reads, which is why the
// marketing pages go through this door at all.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

// Every public URL IndexNow may be told about, derived from the registries so
// a new landing/listicle/docs page is submittable the moment it exists and
// nothing tokened or private ever is — the allow-list IS the set of pages a
// crawler is meant to index. LISTED, not every spec: a held page (the template
// store, lib/templatePaths.js) is a 404 on production and is never submitted.
function indexNowAllowedPaths() {
  return [
    '/', '/pricing', '/explore', '/changelog',
    ...SEO_LANDING_LISTED.map((p) => p.path),
    ...SEO_LISTICLE_INDEX.map((p) => p.path),
    ...DOCS_PATHS,
  ];
}

// Pure: body → ordered, de-duplicated absolute URLs. Unknown paths, tokened
// URLs and non-strings are dropped rather than rejected, so one bad entry in a
// batch never blocks the rest. Exported for src/lib/workerSeo.test.mjs.
export function resolveIndexNowUrls(body) {
  const out = [];
  const seen = new Set();
  const push = (u) => { if (!seen.has(u)) { seen.add(u); out.push(u); } };
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  if (SLUG_RE.test(slug)) push(`${SITE_ORIGIN}/c/${slug}`);
  const allowed = indexNowAllowedPaths();
  const wanted = body?.all === true
    ? allowed
    : (Array.isArray(body?.paths) ? body.paths : []).filter((p) => typeof p === 'string').map((p) => p.trim());
  const allowedSet = new Set(allowed);
  for (const p of wanted) if (allowedSet.has(p)) push(`${SITE_ORIGIN}${p}`);
  return out;
}

// The database sends the POST, not the Worker: api.indexnow.org answered 429
// to every request from Cloudflare Worker egress (40 of 40 build pings, the
// first included), while the identical body from anywhere else got 200. So
// _indexnow_send (0800, service-role only, fixed host/key, our origin only)
// queues it through pg_net and returns the request id; the answer lands a few
// seconds later and _indexnow_settle copies it onto the indexnow_pings row.
// Throws when the RPC fails.
async function sendIndexNow(env, urlList) {
  return Number(await sbRpc(env, '_indexnow_send', { p_urls: urlList }));
}

async function handleIndexNow(env, body) {
  const urlList = resolveIndexNowUrls(body);
  if (!urlList.length) return json({ error: 'a valid slug, known public paths, or all:true required' }, 400);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set on the Worker' }, 500);
  try {
    const requestId = await sendIndexNow(env, urlList);
    return json({ submitted: urlList, count: urlList.length, queued: true, request_id: requestId, note: 'Bing/Yandex only — Google ignores IndexNow.' });
  } catch (e) {
    return json({ submitted: urlList, count: urlList.length, error: String(e?.message || e).slice(0, 120) });
  }
}

// ── IndexNow for a new production build (0480) ──────────────────────────────
// The admin button above is the only other way Bing hears about a change, and
// in practice nobody pressed it. The Worker's hourly cron calls this instead:
// the first tick on a build production has not pinged for submits the pages
// whose sitemap lastmod moved since the last successful ping, and records the
// attempt in indexnow_pings.
//
// "Moved" is a diff against the lastmod map the last ping stored, not a date
// cutoff, because production is promoted by cherry-pick: a page edited on main
// a week ago can reach production today carrying an `updated` older than the
// previous ping. The first ping has nothing to diff against and submits the
// whole sitemap once. Pages with no honest lastmod (/pricing, /legal/*) are
// only ever in that first submission — the sitemap policy, not a gap here.
//
// Crons run only on the deployed Worker, never on a preview version, so this
// cannot announce a build production is not serving.
//
// The ping goes out through the database (sendIndexNow above), so a row is
// written with ok = null and its pg_net request id; the next tick settles it
// first (_indexnow_settle: ok = 200/202, or false after 2h with no answer) and
// waits while one is still pending. lastmods is stored on every sent row; the
// baseline query only ever reads ok rows, so a refused ping is never a baseline.
const INDEXNOW_ATTEMPTS = 3;               // per build, an hour apart
const INDEXNOW_MAX_URLS = 10_000;          // the protocol's per-request ceiling

// Pure: the last successful ping's { loc: lastmod } map (null on the first run)
// and the sitemap's entries → this build's map and the URLs to submit.
// Exported for src/lib/indexCoverage.test.mjs.
export function indexNowDiff(prev, entries) {
  const lastmods = {};
  for (const e of entries || []) {
    if (typeof e?.loc === 'string' && e.loc) lastmods[e.loc] = e.lastmod || null;
  }
  const locs = Object.keys(lastmods);
  const changed = prev && typeof prev === 'object'
    ? locs.filter((loc) => !Object.prototype.hasOwnProperty.call(prev, loc) || prev[loc] !== lastmods[loc])
    : locs;
  return { lastmods, changed: changed.slice(0, INDEXNOW_MAX_URLS) };
}

export async function runIndexNowForBuild(env, build, getEntries) {
  if (!env?.SUPABASE_SERVICE_ROLE_KEY) return;
  const sha = String(build?.sha || '');
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return;   // an unstamped build ('dev', 'unknown')
  try {
    await sbRpc(env, '_indexnow_settle', {});
    const mine = await sbGet(env, `indexnow_pings?build_sha=eq.${sha}&select=ok`);
    if (mine.some((r) => r.ok !== false) || mine.length >= INDEXNOW_ATTEMPTS) return;   // landed, waiting, or out of tries
    const [base] = await sbGet(env, 'indexnow_pings?ok=is.true&select=lastmods&order=pinged_at.desc&limit=1');
    const { lastmods, changed } = indexNowDiff(base?.lastmods ?? null, await getEntries());
    // build_date is a date column: anything else would fail the insert, and a
    // build with no row is pinged again on the next tick.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(build?.date || '')) ? build.date : null;
    const row = { build_sha: sha, build_date: date, sent: changed.length, urls: changed.slice(0, 500) };
    if (!changed.length) {
      row.ok = true;
    } else {
      try {
        row.request_id = await sendIndexNow(env, changed);
        row.ok = null;   // sent; the next tick's settle records IndexNow's answer
      } catch (e) {
        row.ok = false;
        row.error = String(e?.message || e).slice(0, 300);
      }
    }
    // Only a ping that landed becomes the next build's baseline (that query
    // filters ok = true), so storing the map on a pending row is safe.
    if (row.ok !== false) row.lastmods = lastmods;
    await sbInsert(env, 'indexnow_pings', row);
    console.log(`[indexnow] build ${sha}: ${changed.length} URL(s), ${row.ok === null ? `sent (request ${row.request_id})` : row.ok ? 'ok' : `failed ${row.error ?? ''}`}`);
  } catch (e) {
    console.error('[indexnow] build ping failed:', e?.message || e);
    await jobFailed(env, 'indexnow', e);
  }
}

// ── /api/seo/draft ──────────────────────────────────────────────────────────
const DRAFT_SYSTEM = [
  'You write SEO copy for a single curated visual moodboard ("board") page on Soleil Clusters.',
  'Use ONLY the board content provided. Do NOT invent artists, facts, levels, or details not present in the input.',
  'The copy must be specific to THIS board — mention the concrete themes/subjects actually present, so it could not be confused with any other board.',
  'seo_title: <=60 chars, lead with the topic naturally; append " | Soleil Clusters" only if it still fits.',
  'seo_description: <=155 chars, compelling, includes the topic.',
  'seo_body: 2-4 short sentences (~80-160 words), genuinely descriptive of what is in this board; no fluff, no keyword stuffing, no calls-to-action.',
  'suggested_keyword: a specific long-tail phrase a real person would search to find this exact board (favor specificity over a broad head term).',
].join(' ');

async function handleSeoDraft(env, boardId) {
  const enc = encodeURIComponent;
  const [boards, cards, tagRows, pbRows] = await Promise.all([
    sbGet(env, `boards?id=eq.${enc(boardId)}&select=name&limit=1`),
    sbGet(env, `card_index?board_id=eq.${enc(boardId)}&kind=in.(image,note,doc,link)&select=kind,title,body&order=updated_at.desc&limit=80`),
    sbGet(env, `board_tags?board_id=eq.${enc(boardId)}&select=tags(name)`),
    sbGet(env, `public_boards?board_id=eq.${enc(boardId)}&select=slug,target_keyword,seo_title&limit=1`),
  ]);
  const name = boards?.[0]?.name || 'Untitled board';
  const tags = (tagRows || []).map((r) => r?.tags?.name).filter(Boolean).slice(0, 30);
  const titles = (cards || []).map((c) => (c.title || '').trim()).filter(Boolean).slice(0, 40);
  const notes = (cards || [])
    .filter((c) => c.kind === 'note' || c.kind === 'doc')
    .map((c) => (c.body || '').trim()).filter(Boolean).slice(0, 8);
  const imageCount = (cards || []).filter((c) => c.kind === 'image').length;
  const existingKeyword = pbRows?.[0]?.target_keyword || null;

  const payload = {
    board_name: name,
    existing_target_keyword: existingKeyword,
    tags,
    image_count: imageCount,
    sample_card_titles: titles,
    notes_from_board: notes,
  };

  let out;
  try {
    out = await env.AI.run(TEXT_MODEL, {
      messages: [
        { role: 'system', content: DRAFT_SYSTEM },
        { role: 'user', content: JSON.stringify(payload)
          + '\n\nReturn ONLY a JSON object with keys: seo_title, seo_description, seo_body, suggested_keyword. No markdown, no commentary.' },
      ],
      max_tokens: 800,
      temperature: 0.5,
    });
  } catch (e) {
    return json({ error: 'workers-ai: ' + String(e?.message || e).slice(0, 200) }, 502);
  }
  const draft = parseJsonLoose(responseText(out));
  if (!draft || !draft.seo_title) return json({ error: 'model returned no usable draft — try again' }, 502);
  return json({ draft, grounded_on: { tags: tags.length, titles: titles.length, notes: notes.length, image_count: imageCount } });
}

// ── /api/seo/alt ────────────────────────────────────────────────────────────
const ALT_SYSTEM = 'You write concise, accurate alt text for an image on a curated moodboard. Describe what is actually visible in 8-16 words, specific and concrete. No "image of"/"picture of" prefixes. Do not keyword-stuff. Output ONLY the alt text.';

async function handleSeoAlt(env, boardId) {
  const enc = encodeURIComponent;
  if (!env.IMAGES) return json({ error: 'IMAGES R2 binding missing' }, 500);

  const [cards, existing, boardRow] = await Promise.all([
    sbGet(env, `card_index?board_id=eq.${enc(boardId)}&kind=eq.image&select=card_id,title,meta,workspace_id&order=updated_at.desc&limit=200`),
    sbGet(env, `card_alts?board_id=eq.${enc(boardId)}&select=card_id`),
    sbGet(env, `boards?id=eq.${enc(boardId)}&select=workspace_id,name&limit=1`),
  ]);
  const have = new Set((existing || []).map((r) => r.card_id));
  const workspaceId = boardRow?.[0]?.workspace_id || (cards?.[0]?.workspace_id) || null;
  const topic = boardRow?.[0]?.name || '';

  // Image cards that have a real r2: src and no alt yet (neither meta.alt nor a card_alts row).
  const todo = (cards || []).filter((c) => {
    const src = c?.meta?.src;
    const metaAlt = (c?.meta?.alt || '').trim();
    return typeof src === 'string' && src.startsWith('r2:') && !metaAlt && !have.has(c.card_id);
  }).slice(0, ALT_BATCH);

  if (todo.length === 0) {
    return json({ generated: [], remaining: 0, message: 'All image cards already have alt text.' });
  }

  // Prefer preview variants (smaller payload to the vision model) when available.
  const srcKeys = todo.map((c) => c.meta.src.replace(/^r2:/, ''));
  let previewByStorage = {};
  try {
    const inList = srcKeys.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(',');
    const imgs = await sbGet(env, `images?storage_path=in.(${enc(inList)})&select=storage_path,preview_path`);
    for (const im of imgs || []) if (im.preview_path) previewByStorage[im.storage_path] = im.preview_path;
  } catch (_) { /* fall back to originals */ }

  const generated = await mapLimit(todo, ALT_CONCURRENCY, async (card) => {
    const srcKey = card.meta.src.replace(/^r2:/, '');
    const key = previewByStorage[srcKey] || srcKey;
    try {
      const obj = await env.IMAGES.get(key);
      if (!obj) return { card_id: card.card_id, error: 'image not found' };
      // Workers AI vision takes the raw image bytes as a number[] (no base64).
      const image = [...new Uint8Array(await obj.arrayBuffer())];
      const out = await env.AI.run(VISION_MODEL, {
        image,
        prompt: `${ALT_SYSTEM} The image is on a board about "${topic}".`,
        max_tokens: 64,
      });
      let alt = (out?.description || '').trim().replace(/^["']|["']$/g, '');
      if (alt.length > ALT_MAXLEN) alt = alt.slice(0, ALT_MAXLEN).replace(/\s+\S*$/, '');
      if (!alt) return { card_id: card.card_id, error: 'empty' };
      return { card_id: card.card_id, alt };
    } catch (e) {
      return { card_id: card.card_id, error: String(e?.message || e).slice(0, 80) };
    }
  });

  const ok = generated.filter((g) => g.alt);
  if (ok.length) {
    await sbUpsert(env, 'card_alts',
      ok.map((g) => ({ workspace_id: workspaceId, board_id: boardId, card_id: g.card_id, alt: g.alt, source: 'ai' })),
      'board_id,card_id');
  }
  const remaining = (cards || []).filter((c) => {
    const src = c?.meta?.src; const metaAlt = (c?.meta?.alt || '').trim();
    return typeof src === 'string' && src.startsWith('r2:') && !metaAlt && !have.has(c.card_id);
  }).length - ok.length;

  return json({ generated, written: ok.length, remaining: Math.max(0, remaining) });
}
