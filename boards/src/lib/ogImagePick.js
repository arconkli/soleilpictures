// Which picture a link card shows for a page. `meta` maps a tag name to the
// content the parser found ('og:image' -> '...'), null or missing when absent.
//
// og:image:secure_url comes first: a page that gives both it and an http://
// og:image means the https one, and an http picture on our https page is
// blocked as mixed content, leaving the card with no picture. What is left is
// the order the parser used before. Whatever is picked is made absolute against
// the page (`base`) and an http:// address becomes https://, since a picture
// that has only an http address almost always answers on https too.
const FALLBACK_ORDER = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'];

export function pickOgImage(meta, base) {
  const m = meta || {};
  const raw = FALLBACK_ORDER.map((k) => m[k]).find((v) => typeof v === 'string' && v.trim());
  if (!raw) return null;
  let abs;
  try { abs = new URL(raw.trim(), base).href; } catch (_) { return null; }
  return abs.replace(/^http:\/\//i, 'https://');
}
