// Pure decisions behind lib/cardDownload.js, split out so node tests can pin
// them (cardDownload itself reaches Supabase through r2.js).

// Files at least this big (or of unknown size) are handed to the browser's
// own download manager on the web instead of being read into a Blob first
// (MEDIA-09). The Blob path showed nothing at all for the minutes a 1-2 GB
// file took, invited a second click that started a second full download, and
// could run a phone out of memory before the save dialog ever appeared.
export const DIRECT_DOWNLOAD_MIN_BYTES = 20 * 1024 * 1024;

// Should this card skip the Blob and go straight to the browser? Images never
// do (they may need their adjustments baked in); on native there is no
// download manager to hand to (deliverFile's share sheet needs the bytes).
// iOS WebKit stays on the Blob path too: whether it saves an attachment that
// arrives in a hidden frame is unverified, and if it ignores one the user gets
// no file, no error and no fallback, where the Blob path is known to work.
export function wantsDirectDownload(card, kind, { native = false, ios = false } = {}) {
  if (native || ios || kind === 'image') return false;
  const size = Number(card?.sizeBytes);
  return !(Number.isFinite(size) && size > 0 && size < DIRECT_DOWNLOAD_MIN_BYTES);
}

// The bytes a zip selection ([{ card, kind }]) is already known to weigh,
// from the sizes cards record (file and audio cards carry sizeBytes). Cards
// without one count zero; the fetch-time running total covers them (MEDIA-08).
export function knownBytes(items) {
  let n = 0;
  for (const it of items || []) {
    const b = Number(it?.card?.sizeBytes);
    if (Number.isFinite(b) && b > 0) n += b;
  }
  return n;
}
