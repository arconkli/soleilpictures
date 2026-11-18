// A small content hash, used to skip work when text has not changed.

// 32-bit FNV-1a; same hash you'd get from a small JS-only crypto. Used to
// detect "did the card text actually change" before re-embedding. Returns
// a hex string. We don't care about cryptographic strength here, just
// stable bucketing.
export function contentHash(text) {
  let h = 0x811c9dc5;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
