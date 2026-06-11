// CORS-clean image loading for canvas readers (thumbnail renderer, eyedropper,
// variant backfill). NEVER load an R2 URL into an Image with crossOrigin set:
// the same URL has usually been fetched before by a plain <img> (which sends
// no Origin), so the browser holds a 7-day-immutable cached response WITHOUT
// CORS headers — any CORS-mode load of that URL then fails "No ACAO header
// present" even though the bucket policy is fine, and the URL can't be
// cache-busted because the query string is signed. The reliable pattern is a
// cache-bypassing fetch (fresh response carries the CORS headers) decoded via
// an object URL, which is same-origin — no crossOrigin needed, no taint.

export async function loadCorsCleanImage(url) {
  if (!url || typeof url !== 'string') return null;
  // blob:/data: sources are already same-origin/taint-free — plain load.
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  let blobUrl = null;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    blobUrl = URL.createObjectURL(blob);
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(blobUrl); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(null); };
      img.src = blobUrl;
    });
  } catch (_) {
    if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (_) {} }
    return null;
  }
}
