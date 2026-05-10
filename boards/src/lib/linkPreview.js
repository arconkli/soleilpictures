// Link preview fetcher used by link cards. Primary source is our own
// Cloudflare Worker route (/api/og) which fetches the page server-side
// and parses Open Graph + favicon metadata — no CORS, no rate limits,
// caches at the CDN. Falls back to microlink.io's free tier when the
// Worker route isn't reachable (e.g. running `vite` locally without
// `wrangler dev`).

const SAME_ORIGIN = '/api/og';
const MICROLINK = 'https://api.microlink.io/';

export async function fetchLinkPreview(rawUrl) {
  if (!rawUrl) return null;
  const url = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
    ? rawUrl
    : `https://${rawUrl}`;
  // 1) Same-origin worker.
  try {
    const r = await fetch(`${SAME_ORIGIN}?url=${encodeURIComponent(url)}`);
    if (r.ok) {
      const j = await r.json();
      if (j && !j.error) {
        console.log('[linkPreview] /api/og →', j);
        return normalize(j, url);
      }
      console.warn('[linkPreview] /api/og returned error', j);
    } else {
      console.warn('[linkPreview] /api/og status', r.status);
    }
  } catch (e) {
    console.warn('[linkPreview] /api/og threw', e);
  }
  // 2) Public fallback.
  try {
    const r = await fetch(`${MICROLINK}?url=${encodeURIComponent(url)}`);
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status !== 'success' || !j.data) return null;
    const d = j.data;
    const out = {
      title: d.title || null,
      description: d.description || null,
      image: d.image?.url || null,
      favicon: d.logo?.url || null,
      url: d.url || url,
    };
    console.log('[linkPreview] microlink fallback →', out);
    return out;
  } catch (e) {
    console.warn('[linkPreview] microlink threw', e);
    return null;
  }
}

function normalize(j, fallbackUrl) {
  return {
    title: j.title || null,
    description: j.description || null,
    image: j.image || null,
    favicon: j.favicon || null,
    url: j.url || fallbackUrl,
  };
}
