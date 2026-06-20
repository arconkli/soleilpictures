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
// /api/share-thumb/*  — serves a shared board's stored R2 thumbnail as the
//                       og:image behind /share link previews. Gated by the
//                       share token (get_share_meta RPC), no user auth.

import { handleTagsRoute } from './worker-tags.js';
import { handleSeoRoute, INDEXNOW_KEY } from './worker-seo.js';
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
      'Soleil Clusters pricing — start free with the Demo, or go Creator ($25/mo) for unlimited boards, 100GB storage, any file type, and Edit Mode. Simple monthly or annual plans.',
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
// html:true appends are NOT escaped — the string must stay fully static
// (never interpolate board names or other user data into it).
class AppendHead   { constructor(h) { this.h = h; } element(el) { el.append(this.h, { html: true }); } }
// Replace an element's inner HTML with a (pre-escaped) string. Used to drop
// server-rendered crawlable content into <main id="seo-fallback">.
class SetInnerHtml { constructor(h) { this.h = h; } element(el) { el.setInnerContent(this.h, { html: true }); } }

// Escape for HTML text/attribute contexts. EVERY interpolation of board/card/
// admin-authored text into injected HTML MUST pass through this — the public
// board pages render USER-authored card titles/alt + admin SEO copy, all
// untrusted. (AppendHead / setInnerContent with html:true do NOT escape.)
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
// Serialize an object to embed inside <script type="application/ld+json">.
// JSON.stringify escapes quotes; we additionally neutralize </script> breakout
// and HTML-active chars so card/admin text can't break out of the script tag.
function jsonLdSafe(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

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

// ── Shared-board link previews ──────────────────────────────────────────
// /share/<token> is served by the same SPA fallback as everything else, so
// without intervention every shared board unfurls as the homepage card. Here
// we resolve the token to its board (get_share_meta RPC, migration 0132 —
// same validation semantics as get_share_bundle) and rewrite the OG/Twitter
// meta to the board's name plus its stored R2 thumbnail, served token-gated
// via /api/share-thumb/<token>. RPC failure/timeout → default meta; the
// share page itself must never break on a metadata miss.
const SHARE_PATH_RE = /^\/share\/([0-9a-f-]{36})\/?$/i;
const UUID_RE = /^[0-9a-f-]{36}$/i;

// Admin-curated public marketing boards (migration 0136): clean keyword slugs at
// /c/<slug>, plus the /explore index. The slug charset is a deliberate superset
// of the DB CHECK (which forbids consecutive/edge hyphens) — the DB is the real
// gate; the route only needs to catch every valid slug. A non-matching-but-
// routed slug just resolves to no published board → default meta, no noindex.
const PUBLIC_BOARD_PATH_RE = /^\/c\/([a-z0-9][a-z0-9-]{0,79})\/?$/;
const EXPLORE_PATH_RE = /^\/explore\/?$/;

// Early share-bundle fetch, injected into /share HTML so the POST overlaps
// the entire JS download/parse instead of waiting for PublicBoardView to
// mount (saves the serialized bundle RTT — hundreds of ms on mobile).
// PublicBoardView consumes window.__shareBundle one-shot when token/boardId
// match; any mismatch or rejection falls back to its normal fetch.
// SAFETY: the string is fully static — token/?b are read from `location`
// in-browser, never interpolated here (AppendHead html:true does not escape).
// Only PARTYKIT_HOST (a build-time constant) is templated in.
const SHARE_EARLY_FETCH = `<script>(function(){try{
var m=location.pathname.match(/^\\/share\\/([0-9a-f-]{36})\\/?$/i);if(!m)return;
var b=new URLSearchParams(location.search).get('b');
var boardId=(b&&/^[0-9a-f-]{36}$/i.test(b))?b:null;
var body={token:m[1]};if(boardId)body.boardId=boardId;
window.__shareBundle={token:m[1],boardId:boardId,promise:fetch(
'https://${PARTYKIT_HOST}/parties/upload/share/share-bundle',
{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})};
}catch(_){}})()<\/script>`;

// Early public-bundle fetch for /c/<slug> marketing pages — the slug-keyed
// analog of SHARE_EARLY_FETCH. Overlaps the bundle POST with JS download so
// PublicBoardView can consume window.__publicBundle instead of re-fetching.
// SAFETY: fully static — slug/?b are read from `location` in-browser, never
// interpolated here. Only PARTYKIT_HOST (build constant) is templated.
const PUBLIC_EARLY_FETCH = `<script>(function(){try{
var m=location.pathname.match(/^\\/c\\/([a-z0-9][a-z0-9-]{0,79})\\/?$/);if(!m)return;
var b=new URLSearchParams(location.search).get('b');
var boardId=(b&&/^[0-9a-f-]{36}$/i.test(b))?b:null;
var body={slug:m[1]};if(boardId)body.boardId=boardId;
window.__publicBundle={slug:m[1],boardId:boardId,promise:fetch(
'https://${PARTYKIT_HOST}/parties/upload/share/public-bundle',
{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})};
}catch(_){}})()<\/script>`;

function injectShareMeta(res, meta, token) {
  const rw = new HTMLRewriter();
  // Tokened URLs are noindexed unless the link owner opted in (allow_indexing,
  // 0134) OR the board is a published public board (public_slug, 0136). In the
  // public_slug case we DROP the noindex and canonicalize this /share/<token>
  // onto /c/<slug> below, so the legacy link consolidates its ranking instead of
  // being deindexed (Google ignores rel=canonical when combined with noindex).
  // A failed/missing meta fetch keeps the noindex: fail closed.
  // NOTE: the appended string must stay fully static (AppendHead does not
  // escape) — never interpolate board data here.
  if (!meta?.public_slug && !meta?.allow_indexing) {
    rw.on('head', new AppendHead('<meta name="robots" content="noindex">'));
  }
  // Resolved meta = the token is valid → start the bundle fetch during HTML
  // parse. Invalid/expired tokens (meta null) skip it: no doomed POST, the
  // client renders its dead-end normally.
  if (meta?.board_id) {
    rw.on('head', new AppendHead(SHARE_EARLY_FETCH));
  }

  const name = (meta?.name || '').trim();
  if (!name) return rw.transform(res); // no meta → keep homepage defaults

  // Mirror the client's shareUrl() convention (PublicBoardView): the root
  // board is the clean /share/<token> URL; sub-boards carry ?b=<id>.
  const isSub = meta.board_id && meta.root_id && meta.board_id !== meta.root_id;
  const shareUrl = `${SITE_ORIGIN}/share/${token}${isSub ? `?b=${meta.board_id}` : ''}`;
  // Consolidate ranking: when this board is a published public board, point both
  // og:url and rel=canonical at its /c/<slug> instead of the tokened URL.
  const canonicalUrl = meta.public_slug ? `${SITE_ORIGIN}/c/${meta.public_slug}` : shareUrl;
  const title = `${name} — Soleil Clusters`;
  // Board-specific description for unfurls + (when indexable) SERP snippets.
  // The name only ever flows through SetContent/SetText, which escape it.
  const description = `“${name}” — a board shared from Soleil Clusters. References, images, and ideas in one place. Explore it, then make your own free.`;
  rw.on('title',                            new SetText(title))
    .on('meta[name="description"]',         new SetContent(description))
    .on('meta[property="og:title"]',        new SetContent(title))
    .on('meta[property="og:description"]',  new SetContent(description))
    .on('meta[property="og:url"]',          new SetContent(canonicalUrl))
    .on('meta[name="twitter:title"]',       new SetContent(title))
    .on('meta[name="twitter:description"]', new SetContent(description))
    .on('link[rel="canonical"]',            new SetHref(canonicalUrl));

  // Only point og:image at the thumb route when the board HAS a stored
  // thumbnail — otherwise leave the logo defaults untouched (some scrapers
  // reject og:image URLs that redirect, so "don't rewrite" beats "fallback").
  if (meta.thumb_key) {
    const v = encodeURIComponent(meta.thumb_updated_at || '');
    const img = `${SITE_ORIGIN}/api/share-thumb/${token}?b=${meta.board_id}&v=${v}`;
    // v2+ thumbnails (mini-screenshot rework) are 16:9 1200×675 logical;
    // legacy v1 renders still serving are 800×600. Dims are advisory hints
    // for scrapers, so the stale-bytes window during self-heal is harmless.
    const isV2 = (meta.thumb_version || 0) >= 2;
    rw.on('meta[property="og:image"]',        new SetContent(img))
      .on('meta[property="og:image:width"]',  new SetContent(isV2 ? '1200' : '800'))
      .on('meta[property="og:image:height"]', new SetContent(isV2 ? '675' : '600'))
      .on('meta[property="og:image:type"]',   new SetContent('image/webp'))
      .on('meta[property="og:image:alt"]',    new SetContent(name))
      .on('meta[name="twitter:image"]',       new SetContent(img))
      .on('meta[name="twitter:image:alt"]',   new SetContent(name));
  }
  return rw.transform(res);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Guard every /api/* route: an uncaught throw here would otherwise surface
    // as a contentless Cloudflare 500. await so rejected promises are caught.
    try {
      if (url.pathname === '/api/og') return await handleOg(url, request);
      if (url.pathname.startsWith('/api/tags/')) return await handleTagsRoute(url, request, env);
      if (url.pathname.startsWith('/api/seo/')) return await handleSeoRoute(url, request, env);
      const resetMatch = url.pathname.match(/^\/api\/board\/([\w-]+)\/reset$/);
      if (resetMatch) return await handleBoardReset(resetMatch[1], request);
      const thumbMatch = url.pathname.match(/^\/api\/share-thumb\/([0-9a-f-]{36})$/i);
      if (thumbMatch) return await handleShareThumb(env, thumbMatch[1], url.searchParams, request);
      if (url.pathname === '/api/admin/backfill-image-sizes') return await handleBackfillImageSizes(request, env);
      // Public marketing boards (migration 0136). Dynamic sitemap + indexable
      // og:image + crawlable per-card images, all keyed by slug. Intercepted
      // here (before env.ASSETS) so /sitemap.xml wins over any static asset.
      if (url.pathname === '/sitemap.xml') return await handleSitemap(env);
      if (url.pathname === '/sitemap-images.xml') return await handleImageSitemap(env);
      // IndexNow ownership key file (Bing/Yandex verify our submissions here).
      if (url.pathname === `/${INDEXNOW_KEY}.txt`) {
        return new Response(INDEXNOW_KEY, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
      }
      const pubThumbMatch = url.pathname.match(/^\/api\/public-thumb\/([a-z0-9][a-z0-9-]{0,79})$/);
      if (pubThumbMatch) return await handlePublicThumb(env, pubThumbMatch[1], url.searchParams, request);
      const pubImgMatch = url.pathname.match(/^\/api\/public-img\/([a-z0-9][a-z0-9-]{0,79})$/);
      if (pubImgMatch) return await handlePublicImg(env, pubImgMatch[1], url.searchParams, request);
    } catch (e) {
      return json({ error: e?.message || String(e) }, 500);
    }

    // Kick the share-meta RPC off BEFORE the assets fetch so the Supabase
    // round-trip overlaps it instead of adding to TTFB. Failures (revoked
    // token, timeout, network) resolve to null → default homepage meta.
    const shareMatch = request.method === 'GET' ? url.pathname.match(SHARE_PATH_RE) : null;
    const shareMetaPromise = shareMatch
      ? fetchShareMeta(env, shareMatch[1], url.searchParams.get('b')).catch(() => null)
      : null;

    // Same overlap trick for /c/<slug> marketing pages + the /explore index:
    // kick the Supabase RPCs off before the asset fetch. All fail to null →
    // /c falls back to default homepage meta (never noindex), /explore to empty.
    const pubMatch = request.method === 'GET' ? url.pathname.match(PUBLIC_BOARD_PATH_RE) : null;
    const pubMetaPromise = pubMatch ? fetchPublicBoardMeta(env, pubMatch[1]).catch(() => null) : null;
    const pubContentPromise = pubMatch ? fetchPublicBoardContent(env, pubMatch[1]).catch(() => null) : null;
    const pubRelatedPromise = pubMatch ? fetchRelatedPublicBoards(env, pubMatch[1]).catch(() => null) : null;
    const exploreMatch = request.method === 'GET' ? url.pathname.match(EXPLORE_PATH_RE) : null;
    const exploreListPromise = exploreMatch ? fetchPublicBoards(env).catch(() => null) : null;

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

    // Public marketing board (/c/<slug>): keyword-rich meta + crawlable
    // server-rendered content + JSON-LD. Never noindex — these are meant to
    // rank. RPC miss → SPA shell with default meta (still no noindex).
    if (pubMatch && contentType.includes('text/html')) {
      const [meta, content, related] = await Promise.all([pubMetaPromise, pubContentPromise, pubRelatedPromise]);
      return withRevalidate(injectPublicBoard(res, meta, content, pubMatch[1], related));
    }

    // Public board index (/explore): crawlable list of /c/<slug> links + JSON-LD.
    if (exploreMatch && contentType.includes('text/html')) {
      const boards = await exploreListPromise;
      return withRevalidate(injectExplore(res, boards));
    }

    // Shared-board link previews: rewrite OG/Twitter meta on /share/<token>
    // HTML to the board's name + stored thumbnail so pasted links unfurl as
    // the board itself (and noindex the tokened URL either way).
    if (shareMatch && contentType.includes('text/html')) {
      const meta = await shareMetaPromise;
      return withRevalidate(injectShareMeta(res, meta, shareMatch[1]));
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
    } else if (which === '0 4 * * *') {
      // daily 04:00 UTC — fill in any missing image sizes (additive, runs live),
      // then the history-aware orphan sweep. Sequential so R2 ops don't spike.
      ctx.waitUntil(runImageSizeBackfill(env).then(() => runR2Sweep(env)));
    } else {
      // An edited wrangler.toml schedule must never silently reroute into the
      // destructive sweep — unknown crons are a loud no-op.
      console.error('[cron] unrecognized schedule; nothing run:', which);
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

    // Audit every candidate BEFORE any destructive op — the audit trail is
    // the safety contract for the sweep. If we can't record what we're about
    // to do, we don't do it; the next daily run picks the candidates up again.
    try {
      await rpc(env, 'record_r2_sweep_audit', { p_run_id: runId, p_rows: rows });
    } catch (e) {
      console.error(`[r2-sweep] run=${runId} audit insert failed; aborting sweep`, e);
      return;
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
      // Only an explicit 'delete' decision is destructive — a decision value
      // we don't recognize is treated as keep, never as delete.
      if (row.decision !== 'delete') {
        kept++;
        continue;
      }
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

// Anon-key variant of rpc() for token-gated public functions. Short timeout:
// this runs inline with HTML serving, not in a cron — a slow Supabase must
// degrade to default meta, not stall the share page.
async function anonRpc(env, fn, params, timeoutMs = 1500) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify(params || {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`rpc ${fn} ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json();
}

// Resolve a share token (+ optional sub-board) to {board_id, root_id, name,
// thumb_key, thumb_updated_at}. All validation lives in the SECURITY DEFINER
// RPC (migration 0132, lockstep with get_share_bundle): revoked/expired
// tokens and unauthorized sub-boards throw — callers treat that as null.
function fetchShareMeta(env, token, boardId) {
  const params = { p_token: token };
  if (boardId && UUID_RE.test(boardId)) params.p_board_id = boardId;
  return anonRpc(env, 'get_share_meta', params);
}

// ── Public marketing boards (migration 0136) ────────────────────────────────
// Anon RPC helpers. All SECURITY DEFINER + gated on published_at + not-deleted.
function fetchPublicBoardMeta(env, slug)    { return anonRpc(env, 'get_public_board_meta', { p_slug: slug }); }
function fetchPublicBoardContent(env, slug) { return anonRpc(env, 'get_public_board_content', { p_slug: slug }); }
function fetchRelatedPublicBoards(env, slug) { return anonRpc(env, 'get_related_public_boards', { p_slug: slug }); }
function fetchPublicBoards(env, timeoutMs = 4000) { return anonRpc(env, 'list_public_boards', {}, timeoutMs); }

function imgContentType(key) {
  const ext = (String(key).split('.').pop() || '').toLowerCase();
  return ext === 'png' ? 'image/png'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif'
    : ext === 'svg' ? 'image/svg+xml'
    : 'image/jpeg';
}

// Inject /c/<slug> meta + crawlable content + JSON-LD. NEVER noindex: a public
// board is meant to rank, and a transient RPC miss must not deindex it — on miss
// we serve the SPA shell untouched (default homepage meta, no noindex).
function injectPublicBoard(res, meta, content, slug, related) {
  const rw = new HTMLRewriter();
  if (!meta?.board_id) return rw.transform(res);

  // Early bundle fetch (overlaps JS download). Fully static; slug read in-browser.
  rw.on('head', new AppendHead(PUBLIC_EARLY_FETCH));

  const name = (meta.name || '').trim();
  const title = (meta.seo_title || `${name} — Soleil Clusters`).trim();
  const description = (meta.seo_description
    || `${name} — a curated board on Soleil Clusters. References, images, and ideas in one place.`).trim();
  const canonical = `${SITE_ORIGIN}/c/${slug}`;

  // name/title/description flow through SetContent/SetText, which escape.
  rw.on('title',                            new SetText(title))
    .on('meta[name="description"]',         new SetContent(description))
    .on('meta[property="og:title"]',        new SetContent(title))
    .on('meta[property="og:description"]',  new SetContent(description))
    .on('meta[property="og:url"]',          new SetContent(canonical))
    .on('meta[name="twitter:title"]',       new SetContent(title))
    .on('meta[name="twitter:description"]', new SetContent(description))
    .on('link[rel="canonical"]',            new SetHref(canonical));

  // og:image — served INDEXABLE from /api/public-thumb/<slug>.
  if (meta.thumb_key || meta.og_image_key) {
    const v = encodeURIComponent(meta.thumb_updated_at || '');
    const img = `${SITE_ORIGIN}/api/public-thumb/${slug}?v=${v}`;
    const isV2 = (meta.thumb_version || 0) >= 2;
    rw.on('meta[property="og:image"]',        new SetContent(img))
      .on('meta[property="og:image:width"]',  new SetContent(isV2 ? '1200' : '800'))
      .on('meta[property="og:image:height"]', new SetContent(isV2 ? '675' : '600'))
      .on('meta[property="og:image:type"]',   new SetContent('image/webp'))
      .on('meta[property="og:image:alt"]',    new SetContent(name))
      .on('meta[name="twitter:image"]',       new SetContent(img))
      .on('meta[name="twitter:image:alt"]',   new SetContent(name));
  }

  // Crawlable server-rendered content (replaces the homepage SEO fallback) +
  // JSON-LD. All interpolation escaped (escapeHtml / jsonLdSafe).
  const cards = Array.isArray(content?.cards) ? content.cards : [];
  rw.on('main#seo-fallback', new SetInnerHtml(buildCrawlableHtml(meta, content, slug, related)));
  rw.on('head', new AppendHead(
    '<script type="application/ld+json">' + jsonLdSafe(buildPublicJsonLd(meta, cards, slug)) + '</script>'
  ));
  return rw.transform(res);
}

// Build the crawlable inner HTML for <main id="seo-fallback">. Server text MUST
// match what PublicBoardView renders from the same card_index (anti-cloaking).
// Every value is escapeHtml'd; image src is an index into /api/public-img, never
// a reflected key; link URLs render as escaped text, never as an href (avoids
// javascript:-scheme reflection).
function buildCrawlableHtml(meta, content, slug, related) {
  const h1 = escapeHtml(meta.seo_title || meta.name || '');
  const desc = meta.seo_description ? `<p>${escapeHtml(meta.seo_description)}</p>` : '';
  const body = meta.seo_body ? `<section>${escapeHtml(meta.seo_body)}</section>` : '';
  const cards = Array.isArray(content?.cards) ? content.cards : [];
  const items = cards.map((c, i) => {
    const parts = [];
    if (c.media) {
      const alt = escapeHtml(c.media.alt || c.title || meta.name || '');
      parts.push(`<img src="${SITE_ORIGIN}/api/public-img/${escapeHtml(slug)}?i=${i}" alt="${alt}" loading="lazy" width="320" height="240">`);
    }
    if (c.title) parts.push(`<h3>${escapeHtml(c.title)}</h3>`);
    if (c.body) parts.push(`<p>${escapeHtml(c.body)}</p>`);
    else if (c.kind === 'link' && c.href) parts.push(`<p>${escapeHtml(c.href)}</p>`);
    return parts.length ? `<li>${parts.join('')}</li>` : '';
  }).join('');
  const subs = Array.isArray(content?.subboards) ? content.subboards : [];
  const subList = subs.length
    ? `<p>Sections: ${subs.map((s) => escapeHtml(s.name)).join(', ')}</p>`
    : '';
  // Related boards (shared tags) — internal-linking spokes with keyword anchors.
  const rel = Array.isArray(related) ? related : [];
  const relNav = rel.length
    ? `<nav aria-label="Related boards" style="margin-top:1.6em;"><h2 style="font-size:1.1rem;">Related boards</h2><ul>${
        rel.map((r) => `<li><a href="/c/${escapeHtml(r.slug)}" style="color:#FFA500;">${escapeHtml(r.seo_title || r.slug)}</a></li>`).join('')
      }</ul></nav>`
    : '';
  return `<div style="max-width:880px;margin:0 auto;padding:14vh 24px 24px;">
  <article>
    <h1 style="font-size:1.9rem;font-weight:600;margin:0 0 .5em;">${h1}</h1>
    ${desc}
    ${body}
    ${subList}
    <ul style="list-style:none;padding:0;">${items}</ul>
    ${relNav}
    <nav style="margin-top:1.6em;"><a href="/explore" style="color:#FFA500;">Explore more boards</a></nav>
  </article>
</div>`;
}

// CollectionPage → ImageGallery (ImageObject per image, capped) → BreadcrumbList.
function buildPublicJsonLd(meta, cards, slug) {
  const url = `${SITE_ORIGIN}/c/${slug}`;
  const name = meta.seo_title || meta.name || '';
  const images = cards
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.media)
    .slice(0, 25)
    .map(({ c, i }) => ({
      '@type': 'ImageObject',
      contentUrl: `${SITE_ORIGIN}/api/public-img/${slug}?i=${i}`,
      name: c.media.alt || c.title || name,
      caption: c.media.alt || c.title || undefined,
    }));
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#page`,
        url,
        name,
        description: meta.seo_description || undefined,
        isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
        mainEntity: {
          '@type': 'ImageGallery',
          name,
          ...(images.length ? { associatedMedia: images } : {}),
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: 'Explore', item: `${SITE_ORIGIN}/explore` },
          { '@type': 'ListItem', position: 3, name, item: url },
        ],
      },
    ],
  };
}

// Inject the /explore index: crawlable list of /c/<slug> links + JSON-LD ItemList.
function injectExplore(res, boards) {
  const rw = new HTMLRewriter();
  const list = Array.isArray(boards) ? boards : [];
  const title = 'Explore Boards — Soleil Clusters';
  const description = 'Browse curated public moodboards and reference collections made with Soleil Clusters.';
  const canonical = `${SITE_ORIGIN}/explore`;
  rw.on('title',                            new SetText(title))
    .on('meta[name="description"]',         new SetContent(description))
    .on('meta[property="og:title"]',        new SetContent(title))
    .on('meta[property="og:description"]',  new SetContent(description))
    .on('meta[property="og:url"]',          new SetContent(canonical))
    .on('meta[name="twitter:title"]',       new SetContent(title))
    .on('meta[name="twitter:description"]', new SetContent(description))
    .on('link[rel="canonical"]',            new SetHref(canonical));

  const items = list.map((b) => {
    const t = escapeHtml(b.seo_title || b.slug);
    const d = b.seo_description ? `<p style="color:#b7b1a6;margin:.2em 0 0;">${escapeHtml(b.seo_description)}</p>` : '';
    return `<li style="margin:0 0 1.1em;"><a href="/c/${escapeHtml(b.slug)}" style="color:#FFA500;font-size:1.15rem;font-weight:600;text-decoration:none;">${t}</a>${d}</li>`;
  }).join('');
  const html = `<div style="max-width:760px;margin:0 auto;padding:14vh 24px 24px;">
  <article>
    <h1 style="font-size:1.9rem;font-weight:600;margin:0 0 .5em;">Explore Boards</h1>
    <p style="color:#b7b1a6;margin:0 0 1.5em;">${escapeHtml(description)}</p>
    <ul style="list-style:none;padding:0;">${items}</ul>
  </article>
</div>`;
  rw.on('main#seo-fallback', new SetInnerHtml(html));

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    url: canonical,
    name: title,
    description,
    isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: list.slice(0, 50).map((b, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: b.seo_title || b.slug,
        url: `${SITE_ORIGIN}/c/${b.slug}`,
      })),
    },
  };
  rw.on('head', new AppendHead('<script type="application/ld+json">' + jsonLdSafe(jsonld) + '</script>'));
  return rw.transform(res);
}

// Dynamic /sitemap.xml: static pages + /explore + every published /c/<slug>.
// MUST never 500 or shrink to empty (Google reads a sudden empty sitemap as a
// deindex signal): on RPC failure we still emit the static set. Short-cached.
async function handleSitemap(env) {
  const staticUrls = [
    { loc: `${SITE_ORIGIN}/`,               changefreq: 'weekly',  priority: '1.0' },
    { loc: `${SITE_ORIGIN}/pricing`,        changefreq: 'monthly', priority: '0.9' },
    { loc: `${SITE_ORIGIN}/explore`,        changefreq: 'daily',   priority: '0.8' },
    { loc: `${SITE_ORIGIN}/legal/privacy`,  changefreq: 'yearly',  priority: '0.3' },
    { loc: `${SITE_ORIGIN}/legal/terms`,    changefreq: 'yearly',  priority: '0.3' },
    { loc: `${SITE_ORIGIN}/legal/cookies`,  changefreq: 'yearly',  priority: '0.3' },
  ];
  let boards = null;
  try { boards = await fetchPublicBoards(env, 4000); } catch (_) { boards = null; }
  const urls = [...staticUrls];
  if (Array.isArray(boards)) {
    for (const b of boards) {
      if (!b?.slug) continue;
      urls.push({
        loc: `${SITE_ORIGIN}/c/${b.slug}`,
        lastmod: b.updated_at ? String(b.updated_at).slice(0, 10) : null,
        changefreq: 'weekly',
        priority: '0.7',
      });
    }
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map((u) => `  <url><loc>${escapeHtml(u.loc)}</loc>`
        + (u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '')
        + (u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : '')
        + (u.priority ? `<priority>${u.priority}</priority>` : '')
        + `</url>`).join('\n')
    + `\n</urlset>\n`;
  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=3600',
    },
  });
}

// Dedicated image sitemap (/sitemap-images.xml) — surfaces each board's images
// (which only load via JS on the live canvas) to Google Images, our highest-ROI
// surface. Per board, emits its crawlable /api/public-img/<slug>?i=N entries;
// the ?i index matches get_public_board_content's default ordering 1:1 (both use
// the default limit). Bounded + cached so the per-board content fetches are cheap.
async function handleImageSitemap(env) {
  let boards = null;
  try { boards = await fetchPublicBoards(env, 4000); } catch (_) { boards = null; }
  const list = (Array.isArray(boards) ? boards : []).slice(0, 40);
  const blocks = await Promise.all(list.map(async (b) => {
    if (!b?.slug) return '';
    let content = null;
    try { content = await fetchPublicBoardContent(env, b.slug); } catch (_) { return ''; }
    const cards = Array.isArray(content?.cards) ? content.cards : [];
    const imgs = [];
    cards.forEach((c, i) => {
      if (c.media && imgs.length < 30) {
        const title = escapeHtml((c.media.alt || c.title || b.seo_title || b.slug || '').slice(0, 200));
        imgs.push(`    <image:image><image:loc>${SITE_ORIGIN}/api/public-img/${escapeHtml(b.slug)}?i=${i}</image:loc>`
          + (title ? `<image:title>${title}</image:title>` : '') + `</image:image>`);
      }
    });
    if (!imgs.length) return '';
    return `  <url><loc>${SITE_ORIGIN}/c/${escapeHtml(b.slug)}</loc>\n${imgs.join('\n')}\n  </url>`;
  }));
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`
    + blocks.filter(Boolean).join('\n')
    + `\n</urlset>\n`;
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=3600' },
  });
}

// og:image for /c/<slug> — clone of handleShareThumb but slug-keyed and
// INDEXABLE (no x-robots-tag: noindex). Prefers an admin og_image_key override.
async function handlePublicThumb(env, slug, searchParams, request) {
  const fallback = () =>
    new Response(null, {
      status: 302,
      headers: { location: `${SITE_ORIGIN}/clusters-logo-dark.png`, 'cache-control': 'no-store' },
    });
  let meta = null;
  try { meta = await fetchPublicBoardMeta(env, slug); } catch { return fallback(); }
  const key = (meta?.og_image_key || meta?.thumb_key || '').replace(/^r2:/, '');
  if (!key || !env.IMAGES) return fallback();
  const obj = await env.IMAGES.get(key);
  if (!obj) return fallback();
  const headers = {
    'content-type': obj.httpMetadata?.contentType || imgContentType(key),
    'cache-control': 'public, max-age=3600',
    'etag': obj.httpEtag,
  };
  if (request.headers.get('if-none-match') === obj.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}

// Crawlable per-card image for /c/<slug> (?i=<index>). Re-authorizes on EVERY
// request: re-resolves the slug through the published+not-deleted gate, bounds
// the index, and only serves a key that actually belongs to that board's image
// card (no enumeration oracle). INDEXABLE (no noindex).
async function handlePublicImg(env, slug, searchParams, request) {
  const i = parseInt(searchParams.get('i') || '', 10);
  if (!Number.isInteger(i) || i < 0) return new Response('Not found', { status: 404 });
  let content = null;
  try { content = await fetchPublicBoardContent(env, slug); } catch { return new Response('Not found', { status: 404 }); }
  const cards = Array.isArray(content?.cards) ? content.cards : [];
  const card = cards[i];
  if (!card || card.kind !== 'image' || !card.media) return new Response('Not found', { status: 404 });
  const key = String(card.media.preview_key || card.media.src_key || '').replace(/^r2:/, '');
  if (!key || !env.IMAGES) return new Response('Not found', { status: 404 });
  const obj = await env.IMAGES.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = {
    'content-type': obj.httpMetadata?.contentType || imgContentType(key),
    'cache-control': 'public, max-age=86400',
    'etag': obj.httpEtag,
  };
  if (request.headers.get('if-none-match') === obj.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}

// Serves a shared board's stored thumbnail (<ws>/thumbs/<board>.webp in R2)
// as the og:image behind /share link previews. Same token gate as the share
// bundle. injectShareMeta only points og:image here when the board HAS a
// thumb, so the 302→logo below is a defensive fallback for stale unfurls
// (revoked links, thumb rows that never resolved), not a normal path.
async function handleShareThumb(env, token, searchParams, request) {
  const fallback = () =>
    new Response(null, {
      status: 302,
      headers: { location: `${SITE_ORIGIN}/clusters-logo-dark.png`, 'cache-control': 'no-store' },
    });

  let meta = null;
  try {
    meta = await fetchShareMeta(env, token, searchParams.get('b'));
  } catch {
    return fallback();
  }
  const key = (meta?.thumb_key || '').replace(/^r2:/, '');
  if (!key || !env.IMAGES) return fallback();

  const obj = await env.IMAGES.get(key);
  if (!obj) return fallback();

  const headers = {
    'content-type': 'image/webp',
    // 1h browser cache: the URL carries a v= cache-buster for freshness, and
    // a short TTL bounds how long a just-revoked link keeps serving bytes.
    'cache-control': 'public, max-age=3600',
    'etag': obj.httpEtag,
    'x-robots-tag': 'noindex',
  };
  if (request.headers.get('if-none-match') === obj.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(obj.body, { status: 200, headers });
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
