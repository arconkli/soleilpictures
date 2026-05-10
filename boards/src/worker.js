// Cloudflare Worker entrypoint. Handles /api/* routes; everything else
// falls through to env.ASSETS which serves the Vite-built dist/.
//
// /api/og?url=… — fetches the URL server-side, parses Open Graph and
// favicon metadata, returns JSON. Used by link cards to render
// previews without hitting CORS in the browser.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/og') return handleOg(url, request);
    return env.ASSETS.fetch(request);
  },
};

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
        'User-Agent': 'Mozilla/5.0 (compatible; SoleilBoardsPreview/1.0; +https://boards.soleilpictures.com)',
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
