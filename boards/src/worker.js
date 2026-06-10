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

// ── Per-route SEO metadata ──────────────────────────────────────────────
// The SPA serves ONE index.html for every path (single-page-application
// asset fallback), so the static <title>/description/canonical are the
// homepage's for every URL. That makes /pricing and /legal/* look like
// duplicates of "/" to Google — which is a big reason there are no sitelinks.
// We inject each public route's own metadata here at the edge via
// HTMLRewriter, giving Google distinct, properly-labeled, indexable pages
// without adding SSR or a build step. Unknown paths keep the homepage
// defaults (harmless); non-HTML responses pass through untouched.
const SITE_ORIGIN = 'https://clusters.soleilpictures.com';
const DEFAULT_DESCRIPTION =
  'Soleil Clusters is a creative workspace and moodboard tool for film, photo, design, and brand teams — organize references, projects, and ideas in one place.';
const ROUTE_META = {
  '/': {
    title: 'Soleil Clusters — Creative Workspace & Moodboard for Production Teams',
    description: DEFAULT_DESCRIPTION,
  },
  '/pricing': {
    title: 'Pricing — Soleil Clusters',
    description:
      'Soleil Clusters pricing — start free with the Demo, or unlock unlimited boards, files, and Edit Mode with Creator. Simple monthly or annual plans.',
  },
  '/legal/privacy': {
    title: 'Privacy Policy — Soleil Clusters',
    description: 'How Soleil Clusters collects, uses, and protects your data.',
  },
  '/legal/terms': {
    title: 'Terms of Service — Soleil Clusters',
    description: 'The terms that govern your use of Soleil Clusters.',
  },
  '/legal/cookies': {
    title: 'Cookie Policy — Soleil Clusters',
    description: 'How Soleil Clusters uses cookies and similar technologies.',
  },
};

// Lowercase + strip a trailing slash (except root) so '/Pricing/' === '/pricing'.
function normalizePath(pathname) {
  let p = (pathname || '/').toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

// Tiny HTMLRewriter element handlers — each owns one mutation.
class SetText      { constructor(t) { this.t = t; } element(el) { el.setInnerContent(this.t); } }
class SetContent   { constructor(v) { this.v = v; } element(el) { el.setAttribute('content', this.v); } }
class SetHref      { constructor(h) { this.h = h; } element(el) { el.setAttribute('href', this.h); } }

// Copy a response, forcing HTML documents to revalidate on every load so new
// deploys' chunk hashes are picked up immediately. `no-cache` still lets the
// browser/CDN cache the bytes — it just requires a conditional revalidation
// first, so the common case is a cheap 304, not a full re-download.
function withRevalidate(res) {
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// Rewrite the document's title/description/canonical + the OG/Twitter mirrors
// to `meta`, and point canonical/og:url at `canonical`.
function injectRouteMeta(res, meta, canonical) {
  return new HTMLRewriter()
    .on('title',                            new SetText(meta.title))
    .on('meta[name="description"]',         new SetContent(meta.description))
    .on('meta[property="og:title"]',        new SetContent(meta.title))
    .on('meta[property="og:description"]',  new SetContent(meta.description))
    .on('meta[property="og:url"]',          new SetContent(canonical))
    .on('meta[name="twitter:title"]',       new SetContent(meta.title))
    .on('meta[name="twitter:description"]', new SetContent(meta.description))
    .on('link[rel="canonical"]',            new SetHref(canonical))
    .transform(res);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Guard every /api/* route: an uncaught throw here would otherwise surface
    // as a contentless Cloudflare 500. await so rejected promises are caught.
    try {
      if (url.pathname === '/api/og') return await handleOg(url, request);
      if (url.pathname.startsWith('/api/tags/')) return await handleTagsRoute(url, request, env);
      const resetMatch = url.pathname.match(/^\/api\/board\/([\w-]+)\/reset$/);
      if (resetMatch) return await handleBoardReset(resetMatch[1], request);
      if (url.pathname === '/api/admin/backfill-image-sizes') return await handleBackfillImageSizes(request, env);
    } catch (e) {
      return json({ error: e?.message || String(e) }, 500);
    }

    const res = await env.ASSETS.fetch(request);
    const contentType = res.headers.get('content-type') || '';

    // A request for a content-hashed build asset (/assets/<name>-<hash>.js|css)
    // that the SPA fallback answered with index.html (text/html) means that exact
    // chunk no longer exists on this deploy — i.e. a stale client running the
    // PREVIOUS build. Return a clean 404 so the browser rejects the dynamic
    // import with "Failed to fetch dynamically imported module" (which
    // lazyWithReload recognizes → one-shot reload) instead of trying to execute
    // the HTML as JavaScript and crashing with "undefined (reading 'default')".
    if (request.method === 'GET' && url.pathname.startsWith('/assets/') && contentType.includes('text/html')) {
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    // Inject per-route SEO metadata for HTML document navigations to a known
    // public route. The asset served is index.html (SPA fallback), but the
    // Worker still sees the real pathname, so we can give each URL its own meta.
    if (request.method === 'GET') {
      const meta = ROUTE_META[normalizePath(url.pathname)];
      if (meta && contentType.includes('text/html')) {
        const p = normalizePath(url.pathname);
        const canonical = p === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${p}`;
        return withRevalidate(injectRouteMeta(res, meta, canonical));
      }
    }

    // index.html (the SPA document, served for every app route) must be
    // revalidated so a returning client always picks up the newest deploy's
    // content-hashed chunk references instead of running a stale index that
    // points at chunks that have since been replaced. Hashed /assets/* keep
    // their year-long immutable cache (public/_headers) — only the HTML shell
    // is made always-fresh here.
    if (contentType.includes('text/html')) return withRevalidate(res);
    return res;
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
      // daily 04:00 UTC — fill in any missing image sizes (additive, runs live),
      // then the history-aware orphan sweep. Sequential so R2 ops don't spike.
      ctx.waitUntil(runImageSizeBackfill(env).then(() => runR2Sweep(env)));
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
    // Generous because the cron RPCs (orphan scan, compaction) do real
    // table scans — but bounded, so a hung request can't eat the whole
    // scheduled() invocation.
    signal: AbortSignal.timeout(30_000),
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
      signal: AbortSignal.timeout(10_000),
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
      signal: AbortSignal.timeout(10_000),
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
  let tierRes;
  try {
    tierRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_my_tier`, {
      method: 'POST',
      headers: {
        apikey:        env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${userToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (_) {
    return json({ error: 'tier check failed' }, 502);
  }
  if (!tierRes.ok) return json({ error: 'tier check failed' }, 401);
  const tierData = await tierRes.json();
  const tier = Array.isArray(tierData) ? tierData[0]?.tier : tierData?.tier;
  if (tier !== 'admin') return json({ error: 'admin only' }, 403);

  // Service-role key authenticates the list/patch/count REST calls below. It's
  // a Worker secret (not in wrangler.toml); without it those fetches fail. Guard
  // explicitly so the UI shows the cause instead of a generic error.
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Worker is missing the SUPABASE_SERVICE_ROLE_KEY secret — set it on the soleil-boards Worker.' }, 500);
  }

  if (!env.IMAGES) return json({ error: 'R2 binding missing' }, 500);

  const url   = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)));

  try {
    const result = await backfillImageSizesOnce(env, limit);
    return json({ ok: true, ...result });
  } catch (_) {
    return json({ error: 'list failed' }, 500);
  }
}

// Run an async fn over items with a bounded number in flight at once, so a few
// hundred R2 HEADs don't fire all at once (or run dead-sequentially).
async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

// Core of the size backfill: HEAD up to `limit` size-less R2 objects and write
// their byte size back to images.size_bytes. Shared by the admin HTTP endpoint
// and the nightly cron. Additive only (sets a metadata column; never deletes),
// idempotent, and returns how many rows still need a size so a caller can loop.
async function backfillImageSizesOnce(env, limit) {
  const listUrl =
    `${env.SUPABASE_URL}/rest/v1/images?size_bytes=is.null&deleted_at=is.null` +
    `&select=id,storage_path&limit=${limit}&order=created_at.desc`;
  const listRes = await fetch(listUrl, {
    headers: {
      apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!listRes.ok) throw new Error('list failed');
  const rows = await listRes.json();

  let processed = 0, notFound = 0, errors = 0;
  await mapLimit(rows, 8, async (row) => {
    if (!row?.storage_path) return;
    try {
      const obj = await env.IMAGES.head(row.storage_path);
      if (!obj) { notFound++; return; }
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
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (upd.ok) processed++; else errors++;
    } catch (_) { errors++; }
  });

  // Remaining count so a caller can keep looping until it hits zero.
  const remRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/images?size_bytes=is.null&deleted_at=is.null&select=id&limit=1`,
    {
      headers: {
        apikey:        env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        prefer:        'count=exact',
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const remHeader = remRes.headers.get('content-range') || '';
  const remaining = parseInt(remHeader.split('/').pop() || '0', 10) || 0;

  return { processed, not_found: notFound, errors, remaining };
}

// Nightly auto-backfill (runs from the daily cron). Drains size-less image rows
// in batches until done, until a batch makes no progress (e.g. the only rows
// left are not_found — their R2 object is gone, so they can never get a size),
// or until a per-run cap. New uploads already stamp size_bytes, so this only
// has to clear the historical backlog once and then stays at ~0. Safe to run
// live with no dry-run gate — it never deletes anything.
async function runImageSizeBackfill(env, { cap = 5000 } = {}) {
  if (!env.IMAGES || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[size-backfill] skipped — missing IMAGES binding or SUPABASE_SERVICE_ROLE_KEY');
    return;
  }
  let totalProcessed = 0, totalErrors = 0, totalNotFound = 0, remaining = null, rounds = 0;
  while (totalProcessed < cap) {
    let r;
    try {
      r = await backfillImageSizesOnce(env, 200);
    } catch (e) {
      console.log(`[size-backfill] batch failed: ${e?.message || e}`);
      break;
    }
    rounds++;
    totalProcessed += r.processed;
    totalErrors    += r.errors;
    totalNotFound  += r.not_found;
    remaining = r.remaining;
    if (r.remaining === 0) break;
    if (r.processed === 0) break;   // no recoverable rows left — avoid an infinite loop
  }
  console.log(`[size-backfill] processed=${totalProcessed} errors=${totalErrors} not_found=${totalNotFound} remaining=${remaining} rounds=${rounds}`);
}
