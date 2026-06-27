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

// Tolerant JSON extraction for text-model output (strips ``` fences / prose).
function parseJsonLoose(text) {
  if (!text) return null;
  let s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch { return null; }
}

// REST helpers (service-role) — used after the admin gate passes.
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

export async function getTier(env, userToken) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_my_tier`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
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
  if (!env.AI) return json({ error: 'Workers AI (env.AI) binding not configured on the Worker' }, 500);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set on the Worker' }, 500);

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const boardId = (body.board_id || '').trim();
  if (!UUID_RE.test(boardId)) return json({ error: 'valid board_id required' }, 400);

  try {
    if (url.pathname === '/api/seo/draft') return await handleSeoDraft(env, boardId);
    if (url.pathname === '/api/seo/alt') return await handleSeoAlt(env, boardId);
    if (url.pathname === '/api/seo/indexnow') return await handleIndexNow(env, body);
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
  return json({ error: 'not found' }, 404);
}

// ── /api/seo/indexnow ───────────────────────────────────────────────────────
// Submit a published board URL to IndexNow (Bing/Yandex). Called by the admin
// client after publishing. Body: { slug }. Best-effort — never throws upward.
async function handleIndexNow(env, body) {
  const slug = (body?.slug || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return json({ error: 'valid slug required' }, 400);
  const target = `${SITE_ORIGIN}/c/${slug}`;
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: 'clusters.soleilpictures.com',
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_ORIGIN}/${INDEXNOW_KEY}.txt`,
        urlList: [target],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return json({ submitted: target, status: res.status, note: 'Bing/Yandex only — Google ignores IndexNow.' });
  } catch (e) {
    return json({ submitted: target, error: String(e?.message || e).slice(0, 120) });
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
  const draft = parseJsonLoose(out?.response || '');
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
