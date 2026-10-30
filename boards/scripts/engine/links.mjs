// links.mjs — the reference links a board holds, checked live before they go on.
//
// A recipe's link names an English Wikipedia article (the one kind of address
// Claude can be trusted to name, and one a real board would save: a painter, a
// place, a technique, a film movement). Each is read from Wikipedia's own page
// summary: the title, the first lines and its picture, which become the app's
// link preview card. One that doesn't come back as a real article is dropped,
// as a missing photo is, and the board is checked without it.

export const LINK_RE = /^https:\/\/en\.wikipedia\.org\/wiki\/([^\s?#]+)$/;
export const LINKS = Object.freeze({ description: 160, timeoutMs: 15000 });

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return stop > n * 0.5 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
};

/** A summary from Wikipedia's REST API → the link card's words, or null when it isn't an article. */
export function readSummary(url, j) {
  if (!j || j.type === 'disambiguation' || j.type === 'no-extract' || !j.title) return null;
  const page = j.content_urls?.desktop?.page || url;
  return {
    url: page,
    title: String(j.title),
    description: clip(j.extract || j.description || '', LINKS.description),
    image: j.thumbnail?.source || null,
  };
}

/**
 * Every link item's card words. → Map('si.ii' → { url, title, description, image }), missing: keys
 *   fetchJson: (url) => parsed JSON, or throws (default: fetch with the engine's user agent)
 */
export async function findLinks(recipe, { fetchJson = defaultFetch, log = () => {} } = {}) {
  const found = new Map();
  const missing = [];
  for (const [si, s] of (recipe.sections || []).entries()) {
    for (const [ii, it] of (s.items || []).entries()) {
      if (it?.kind !== 'link') continue;
      const key = `${si}.${ii}`;
      const m = LINK_RE.exec(String(it.url || '').trim());
      if (!m) { missing.push(key); continue; }
      try {
        const j = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${m[1]}`);
        const l = readSummary(it.url, j);
        if (l) found.set(key, l); else missing.push(key);
      } catch (e) {
        log(`link: ${it.url}: ${String(e.message).slice(0, 80)}`);
        missing.push(key);
      }
    }
  }
  return { found, missing };
}

async function defaultFetch(url) {
  const r = await fetch(url, {
    headers: { 'user-agent': 'SoleilBoardsEngine/1.0 (https://clusters.soleilpictures.com)', accept: 'application/json' },
    signal: AbortSignal.timeout(LINKS.timeoutMs),
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
