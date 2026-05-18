// Cloudflare Worker entrypoint. Handles /api/* routes; everything else
// falls through to env.ASSETS which serves the Vite-built dist/.
//
// /api/og?url=…       — fetches the URL server-side, parses Open Graph
//                       and favicon metadata, returns JSON. Used by link
//                       cards to render previews without hitting CORS.
// /api/tags/*         — AI tagging pipeline (embed, apply verdicts, name
//                       emergent clusters). See worker-tags.js for the
//                       per-route contracts. All routes auth-checked
//                       against the user's Supabase JWT.

import { handleTagsRoute } from './worker-tags.js';
import { runCompactionJob1 } from './worker-compaction.js';

const PARTYKIT_HOST = 'soleil-boards-party.arconkli.partykit.dev';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/og') return handleOg(url, request);
    if (url.pathname.startsWith('/api/tags/')) return handleTagsRoute(url, request, env);
    const resetMatch = url.pathname.match(/^\/api\/board\/([\w-]+)\/reset$/);
    if (resetMatch) return handleBoardReset(resetMatch[1], request);
    if (url.pathname === '/api/admin/backfill-image-sizes') return handleBackfillImageSizes(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    // The worker has TWO cron schedules (see wrangler.toml):
    //   "0 4 * * *"   — daily 04:00 UTC; runs the history-aware R2 orphan sweep
    //   "15 * * * *"  — hourly at :15; runs Job 1 compaction (board_ops → R2 batches)
    //
    // Both default to dry-run mode. Flip via env vars when ready:
    //   R2_SWEEP_MODE=delete            (actually delete R2 orphans)
    //   HISTORY_COMPACTION_MODE=run     (actually merge + PUT + delete source ops)
    //
    // event.cron lets us distinguish which schedule fired this invocation.
    const which = event?.cron || '';
    if (which === '15 * * * *') {
      ctx.waitUntil(runCompactionJob1(env));
    } else {
      ctx.waitUntil(runR2Sweep(env));
    }
  },
};

// History-aware R2 orphan sweep. Replaces the previous find_orphan_images
// version (which only looked at card_index) with find_history_safe_orphan_images,
// which additionally requires that the storage_path appears in NO retained
// snapshot's r2_keys_referenced AND NO op's r2_keys array.
//
// Every candidate considered — kept or deleted — is recorded in
// r2_sweep_audit for operator review. Defaults to dry-run; actual deletes
// require R2_SWEEP_MODE=delete env var.
async function runR2Sweep(env) {
  if (!env?.IMAGES) {
    console.log('[r2-sweep] skipped: IMAGES R2 binding not configured');
    return;
  }
  if (!env?.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[r2-sweep] skipped: SUPABASE_SERVICE_ROLE_KEY not set');
    return;
  }
  const startedAt = Date.now();
  const mode = (env.R2_SWEEP_MODE || 'dryrun').toLowerCase();
  const dryRun = mode !== 'delete';
  const runId = crypto.randomUUID();

  let kept = 0;
  let toDelete = 0;
  let deleted = 0;
  const errors = [];

  try {
    // p_dryrun is passed to the RPC so its `decision` column reflects mode;
    // the worker still applies the gate itself before any R2 op below.
    const rows = await rpc(env, 'find_history_safe_orphan_images', {
      p_limit: 500,
      p_dryrun: dryRun,
    });
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`[r2-sweep] run=${runId} mode=${mode} no candidates (${Date.now() - startedAt}ms)`);
      return;
    }

    // Audit every candidate first, regardless of whether we proceed.
    try {
      await rpc(env, 'record_r2_sweep_audit', { p_run_id: runId, p_rows: rows });
    } catch (e) {
      console.warn('[r2-sweep] audit insert failed', e);
    }

    const deletedIds = [];
    for (const row of rows) {
      if (row.decision === 'keep') {
        kept++;
        continue;
      }
      if (dryRun || row.decision === 'skipped_dryrun') {
        toDelete++;
        continue;
      }
      // decision === 'delete' and not in dry-run mode → actually delete.
      try {
        if (row.storage_path) await env.IMAGES.delete(row.storage_path);
        deletedIds.push(row.id);
        deleted++;
      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes('NoSuchKey') || msg.includes('404')) {
          // R2 object already gone — still close the loop in Postgres.
          deletedIds.push(row.id);
          deleted++;
        } else {
          errors.push({ id: row.id, storage_path: row.storage_path, error: msg });
        }
      }
    }

    if (deletedIds.length > 0) {
      try { await rpc(env, 'mark_image_rows_swept', { p_ids: deletedIds }); }
      catch (e) { console.warn('[r2-sweep] mark_swept rpc failed', e); }
    }

    console.log(
      `[r2-sweep] run=${runId} mode=${mode} candidates=${rows.length} kept=${kept} would-delete=${toDelete} deleted=${deleted} errors=${errors.length} took=${Date.now() - startedAt}ms`,
      errors.length > 0 ? { firstError: errors[0] } : '',
    );
  } catch (e) {
    console.error('[r2-sweep] failed', e);
  }
}

async function rpc(env, fn, params) {
  const url = `${env.SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify(params || {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`rpc ${fn} ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json();
}

// Same-origin proxy for PartyKit's /reset endpoint. The browser would
// otherwise CORS-block the cross-origin POST (PartyKit's CORS headers
// work via curl but get flaky from real browsers — different deploy
// edges, cached preflight failures, etc.). Going through the worker
// avoids CORS entirely since the call is same-origin from the client's
// perspective and worker-to-PartyKit is server-to-server.
async function handleBoardReset(boardId, request) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return new Response('Missing token', { status: 401 });

  const target = `https://${PARTYKIT_HOST}/parties/main/${encodeURIComponent(boardId)}/reset`;
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json',
      },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') || 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 502,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
}

async function handleOg(url, request) {
  const target = url.searchParams.get('url');
  if (!target) {
    return json({ error: 'missing url' }, 400);
  }
  let absolute;
  try {
    absolute = target.startsWith('http://') || target.startsWith('https://')
      ? target
      : `https://${target}`;
    new URL(absolute);
  } catch (_) {
    return json({ error: 'invalid url' }, 400);
  }
  try {
    const upstream = await fetch(absolute, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SoleilClustersPreview/1.0; +https://clusters.soleilpictures.com)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!upstream.ok) return json({ error: `upstream ${upstream.status}` }, 502);
    const ct = upstream.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
      return json({ error: 'not html' }, 415);
    }
    // Cap body size — only need the <head>. 256 KB is plenty.
    const text = await readCapped(upstream, 256 * 1024);
    const data = parseOg(text, absolute);
    return json(data, 200, true);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}

async function readCapped(response, maxBytes) {
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= maxBytes) {
      try { reader.cancel(); } catch (_) {}
      break;
    }
  }
  return new TextDecoder('utf-8').decode(concat(chunks));
}

function concat(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .trim();
}

function parseOg(html, sourceUrl) {
  // Limit search to <head> to avoid being fooled by stray meta in body.
  const headEnd = html.toLowerCase().indexOf('</head>');
  const head = headEnd >= 0 ? html.slice(0, headEnd) : html;

  const meta = (prop) => {
    const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // property="..." content="..."
    const a = head.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'));
    if (a) return decodeEntities(a[1]);
    // content="..." property="..."
    const b = head.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${escaped}["']`, 'i'));
    if (b) return decodeEntities(b[1]);
    return null;
  };

  const linkHref = (rel) => {
    const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const a = head.match(new RegExp(`<link[^>]+rel=["'][^"']*${escaped}[^"']*["'][^>]*href=["']([^"']*)["']`, 'i'));
    if (a) return decodeEntities(a[1]);
    const b = head.match(new RegExp(`<link[^>]+href=["']([^"']*)["'][^>]*rel=["'][^"']*${escaped}[^"']*["']`, 'i'));
    if (b) return decodeEntities(b[1]);
    return null;
  };

  const titleTag = head.match(/<title[^>]*>([^<]*)<\/title>/i);
  const titleText = titleTag ? decodeEntities(titleTag[1]) : null;

  const abs = (rel) => {
    if (!rel) return null;
    try { return new URL(rel, sourceUrl).href; } catch (_) { return null; }
  };

  const ogImage = meta('og:image') || meta('og:image:url') || meta('og:image:secure_url') || meta('twitter:image') || meta('twitter:image:src');
  const fav = linkHref('icon') || linkHref('shortcut icon') || linkHref('apple-touch-icon') || '/favicon.ico';

  return {
    title: meta('og:title') || meta('twitter:title') || titleText,
    description: meta('og:description') || meta('twitter:description') || meta('description'),
    image: abs(ogImage),
    favicon: abs(fav),
    url: meta('og:url') || sourceUrl,
  };
}

function json(data, status = 200, cacheable = false) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  };
  if (cacheable) {
    // 1 hour browser cache, 1 day CDN cache.
    headers['cache-control'] = 'public, max-age=3600, s-maxage=86400';
  } else {
    headers['cache-control'] = 'no-store';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

// Admin-only: backfill public.images.size_bytes by HEAD-ing every R2
// object whose row has size_bytes IS NULL. Called manually from
// /admin Analytics → Storage section. Idempotent; batches of up to 500.
// Returns counts + how many rows still need backfill so the UI can loop.
async function handleBackfillImageSizes(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'access-control-allow-origin':  '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
    } });
  }
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const userToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!userToken) return json({ error: 'auth required' }, 401);

  // Validate caller is admin via the existing get_my_tier RPC. We use
  // the user's JWT so RLS / function gate runs as them.
  const tierRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_my_tier`, {
    method: 'POST',
    headers: {
      apikey:        env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${userToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (!tierRes.ok) return json({ error: 'tier check failed' }, 401);
  const tierData = await tierRes.json();
  const tier = Array.isArray(tierData) ? tierData[0]?.tier : tierData?.tier;
  if (tier !== 'admin') return json({ error: 'admin only' }, 403);

  if (!env.IMAGES) return json({ error: 'R2 binding missing' }, 500);

  const url   = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)));

  const listUrl =
    `${env.SUPABASE_URL}/rest/v1/images?size_bytes=is.null&deleted_at=is.null` +
    `&select=id,storage_path&limit=${limit}&order=created_at.desc`;
  const listRes = await fetch(listUrl, {
    headers: {
      apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!listRes.ok) return json({ error: 'list failed' }, 500);
  const rows = await listRes.json();

  let processed = 0, notFound = 0, errors = 0;
  for (const row of rows) {
    if (!row?.storage_path) continue;
    try {
      const obj = await env.IMAGES.head(row.storage_path);
      if (!obj) { notFound++; continue; }
      const upd = await fetch(
        `${env.SUPABASE_URL}/rest/v1/images?id=eq.${row.id}`,
        {
          method: 'PATCH',
          headers: {
            apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
            authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'content-type': 'application/json',
            prefer:        'return=minimal',
          },
          body: JSON.stringify({ size_bytes: obj.size }),
        },
      );
      if (upd.ok) processed++; else errors++;
    } catch (_) { errors++; }
  }

  // Remaining count so the UI can keep looping.
  const remRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/images?size_bytes=is.null&deleted_at=is.null&select=id&limit=1`,
    {
      headers: {
        apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        prefer:        'count=exact',
      },
    },
  );
  const remHeader = remRes.headers.get('content-range') || '';
  const remaining = parseInt(remHeader.split('/').pop() || '0', 10) || 0;

  return json({ ok: true, processed, not_found: notFound, errors, remaining });
}
