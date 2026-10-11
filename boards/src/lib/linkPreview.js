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
      if (j && !j.error) return normalize(j, url);
    }
  } catch (_) {}
  // 2) Public fallback.
  try {
    const r = await fetch(`${MICROLINK}?url=${encodeURIComponent(url)}`);
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status !== 'success' || !j.data) return null;
    const d = j.data;
    return {
      title: d.title || null,
      description: d.description || null,
      image: d.image?.url || null,
      favicon: d.logo?.url || null,
      url: d.url || url,
    };
  } catch (_) {
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

// The preview lands a second or three after the card (or grid cell) was made,
// by which time the user may have renamed it, resized it, edited its URL, or
// replaced the cell with something else. Applied blind, it put the page's OG
// title back over the user's and snapped the card to 280×290. Write only what
// is still the way creation left it. `created` is what the card / cell was
// made with, `current` is it now (null once it's gone); `grow` is the size a
// card takes on when an image arrives, applied only from its creation size.
export function previewPatch(p, current, created, { grow = null } = {}) {
  if (!p || !current || !created) return {};
  if ((current.source || '') !== (created.source || '')) return {};
  if (created.type && current.type !== created.type) return {};
  const patch = {};
  if (p.title && (current.title || '') === (created.title || '')) patch.title = p.title;
  if (p.image && !current.image) patch.image = p.image;
  if (p.description && !current.description) patch.description = p.description;
  if (p.favicon && !current.favicon) patch.favicon = p.favicon;
  if (grow && patch.image && current.w === created.w && current.h === created.h) {
    patch.w = grow.w; patch.h = grow.h;
  }
  return patch;
}
