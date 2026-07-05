// License-safe image sourcing for the board generator.
//
// Three providers, each returning a normalized candidate:
//   { url, srcW, srcH, alt, credit:{name,link,license?}, downloadLocation? }
// The caller downloads `url`, uploads the bytes to R2, and records `credit` for
// the on-board attribution note (Unsplash/Pexels license terms + Wikimedia
// per-file attribution). Uses global fetch (Node 18+).

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// ── Unsplash ──────────────────────────────────────────────────────────────
// https://unsplash.com/documentation#search-photos
export async function fetchUnsplash(query, { count = 6, key, orientation } = {}) {
  if (!key) throw new Error('fetchUnsplash: missing UNSPLASH_ACCESS_KEY');
  const u = new URL('https://api.unsplash.com/search/photos');
  u.searchParams.set('query', query);
  u.searchParams.set('per_page', String(Math.min(30, count)));
  u.searchParams.set('content_filter', 'high');
  if (orientation) u.searchParams.set('orientation', orientation);
  const res = await fetch(u, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } });
  if (!res.ok) throw new Error(`Unsplash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.results || []).slice(0, count).map((p) => ({
    url: `${p.urls.raw}&w=1600&q=80&fm=jpg&fit=max`,
    srcW: p.width, srcH: p.height,
    alt: stripHtml(p.alt_description || p.description || query),
    credit: { name: p.user?.name || 'Unsplash', link: `${p.user?.links?.html || 'https://unsplash.com'}?utm_source=soleil_clusters&utm_medium=referral`, source: 'Unsplash' },
    downloadLocation: p.links?.download_location || null,
  }));
}

// Unsplash asks apps to fire the download endpoint when a photo is used.
export async function pingUnsplashDownload(downloadLocation, key) {
  if (!downloadLocation || !key) return;
  try { await fetch(downloadLocation, { headers: { Authorization: `Client-ID ${key}` } }); } catch (_) {}
}

// ── Pexels ──────────────────────────────────────────────────────────────
// https://www.pexels.com/api/documentation/#photos-search
export async function fetchPexels(query, { count = 6, key, orientation } = {}) {
  if (!key) throw new Error('fetchPexels: missing PEXELS_API_KEY');
  const u = new URL('https://api.pexels.com/v1/search');
  u.searchParams.set('query', query);
  u.searchParams.set('per_page', String(Math.min(80, count)));
  if (orientation) u.searchParams.set('orientation', orientation);
  const res = await fetch(u, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.photos || []).slice(0, count).map((p) => ({
    url: p.src?.large2x || p.src?.large || p.src?.original,
    srcW: p.width, srcH: p.height,
    alt: stripHtml(p.alt || query),
    credit: { name: p.photographer || 'Pexels', link: p.photographer_url || 'https://pexels.com', source: 'Pexels' },
  }));
}

// ── Wikimedia Commons ─────────────────────────────────────────────────────
// Free/CC/PD imagery — good for factual/topical boards. Per-file attribution
// (Artist + License) is required, so we surface it in `credit`.
export async function fetchWikimedia(query, { count = 6 } = {}) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.searchParams.set('action', 'query');
  u.searchParams.set('format', 'json');
  u.searchParams.set('generator', 'search');
  u.searchParams.set('gsrsearch', `filetype:bitmap ${query}`);
  u.searchParams.set('gsrnamespace', '6');       // File: namespace
  u.searchParams.set('gsrlimit', String(Math.min(40, count * 2)));
  u.searchParams.set('prop', 'imageinfo');
  u.searchParams.set('iiprop', 'url|size|extmetadata');
  u.searchParams.set('iiurlwidth', '1600');
  const res = await fetch(u, { headers: { 'User-Agent': 'SoleilClusters-SeedBot/1.0 (clusters.soleilpictures.com)' } });
  if (!res.ok) throw new Error(`Wikimedia ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const pages = Object.values(data.query?.pages || {});
  const out = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii || !ii.thumburl) continue;
    const em = ii.extmetadata || {};
    const license = stripHtml(em.LicenseShortName?.value || '');
    // Only accept clearly-free licenses (CC / public domain).
    if (!/^(cc|public domain|pd|no restrictions)/i.test(license)) continue;
    out.push({
      url: ii.thumburl,
      srcW: ii.thumbwidth || ii.width, srcH: ii.thumbheight || ii.height,
      alt: stripHtml(em.ImageDescription?.value || p.title?.replace(/^File:/, '') || query),
      credit: {
        name: stripHtml(em.Artist?.value || 'Wikimedia Commons'),
        link: ii.descriptionurl || ii.url,
        license,
        source: 'Wikimedia Commons',
      },
    });
    if (out.length >= count) break;
  }
  return out;
}

// Dispatch on provider. `spec` = { provider, query, count, orientation }.
export async function fetchCandidates(spec, keys = {}) {
  const { provider = 'unsplash', query, count = 6, orientation } = spec;
  if (!query) throw new Error('fetchCandidates: image spec needs a query');
  switch (provider) {
    case 'unsplash':  return fetchUnsplash(query, { count, orientation, key: keys.unsplash });
    case 'pexels':    return fetchPexels(query, { count, orientation, key: keys.pexels });
    case 'wikimedia': return fetchWikimedia(query, { count });
    default: throw new Error(`Unknown image provider: ${provider}`);
  }
}

// Download an image URL to bytes. Returns { bytes, contentType, ext }.
export async function downloadImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SoleilClusters-SeedBot/1.0' } });
  if (!res.ok) throw new Error(`download ${res.status} for ${url.slice(0, 80)}`);
  const contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ext = contentType.includes('png') ? 'png'
    : contentType.includes('webp') ? 'webp'
    : contentType.includes('gif') ? 'gif' : 'jpg';
  return { bytes, contentType, ext };
}
