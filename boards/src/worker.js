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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/og') return handleOg(url, request);
    if (url.pathname.startsWith('/api/tags/')) return handleTagsRoute(url, request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    // Daily R2 orphan sweep. Finds images rows whose card no longer
    // exists in card_index AND which are older than 30 days, then
    // deletes both the R2 object and the images row.
    //
    // Required env:
    //   SUPABASE_URL                 — already configured
    //   SUPABASE_SERVICE_ROLE_KEY    — wrangler secret put
    //   IMAGES                       — [[r2_buckets]] binding
    ctx.waitUntil(runR2Sweep(env));
  },
};

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
  let totalSwept = 0;
  let totalAttempted = 0;
  const errors = [];
  try {
    const rows = await rpc(env, 'find_orphan_images', { p_limit: 500 });
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`[r2-sweep] no orphans (${Date.now() - startedAt}ms)`);
      return;
    }
    totalAttempted = rows.length;
    const successfullyDeletedIds = [];
    for (const row of rows) {
      try {
        if (row.storage_path) await env.IMAGES.delete(row.storage_path);
        successfullyDeletedIds.push(row.id);
      } catch (e) {
        // If the R2 object is already gone, keep going and still
        // clean up the images row.
        const msg = String(e?.message || e);
        if (msg.includes('NoSuchKey') || msg.includes('404')) {
          successfullyDeletedIds.push(row.id);
        } else {
          errors.push({ id: row.id, storage_path: row.storage_path, error: msg });
        }
      }
    }
    if (successfullyDeletedIds.length > 0) {
      const deleted = await rpc(env, 'delete_image_rows', { p_ids: successfullyDeletedIds });
      totalSwept = Number(deleted) || successfullyDeletedIds.length;
    }
    console.log(`[r2-sweep] ${totalSwept}/${totalAttempted} cleaned in ${Date.now() - startedAt}ms`,
      errors.length > 0 ? { errorCount: errors.length, firstError: errors[0] } : '');
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
