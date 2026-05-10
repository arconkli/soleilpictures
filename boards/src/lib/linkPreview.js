// Lightweight Open Graph fetcher for link cards. Uses microlink.io's
// public free tier — no key, CORS-enabled, returns a normalized
// {title, description, image, favicon, url}. Failures are silent: the
// card just stays in its plain title/source state with no preview.

const ENDPOINT = 'https://api.microlink.io/';

export async function fetchLinkPreview(rawUrl) {
  if (!rawUrl) return null;
  const url = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
    ? rawUrl
    : `https://${rawUrl}`;
  try {
    const r = await fetch(`${ENDPOINT}?url=${encodeURIComponent(url)}`);
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
