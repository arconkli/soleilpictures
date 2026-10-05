// Naming and field-resolution for card downloads. PURE — no DOM, no network,
// no Supabase — so it can be unit-tested under `node --test`, which the rest of
// cardDownload.js cannot be (it reaches r2.js and therefore import.meta.env).
//
// assetFilename is the reason this file is worth separating. An audio card
// keeps its filename in `title`, which is user-editable: rename the card to
// "Kick 1" and every download path that derived its name from the title
// produced a file called "Kick 1" — no extension, unopenable by the OS and by
// every DAW. The fallback chain here ends at the R2 key's own suffix, which is
// what lets cards predating the `fileName` field download correctly with NO
// migration.

// Kinds that have bytes behind them. Matches the set DetailPanel has used.
export const DOWNLOADABLE = new Set(['image', 'pdf', 'video', 'audio', 'file']);

// Which field holds the bytes for this kind. Mirrors worker-api's BYTES_FIELD.
export function assetSrcFor(card, kind) {
  if (!card) return null;
  if (kind === 'file') return card.fileSrc || null;
  if (kind === 'pdf') return card.pdfSrc || card.src || null;
  return card.src || card.fileSrc || card.pdfSrc || null;
}

// Characters that cannot appear in a filename on Windows or macOS, plus the
// C0 control range (written as an escape - a literal control byte in a
// character class is invisible in a diff and impossible to review).
const ILLEGAL = /[\\/:*?"<>|\x00-\x1f]+/g;

function extFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  const map = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wave': 'wav',
    'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/flac': 'flac', 'audio/x-flac': 'flac',
    'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/aac': 'aac', 'audio/x-aac': 'aac',
    'audio/webm': 'weba',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
    'application/pdf': 'pdf', 'application/zip': 'zip',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  };
  return map[m] || null;
}

// The extension carried by the R2 key itself. `presign` derives the key's
// suffix from the upload's content type, so this is the last line of defence
// and the reason NO migration is needed for existing audio cards: they have no
// `fileName`, but their key still ends in .wav.
function extFromSrc(src) {
  const key = String(src || '').replace(/^r2:/, '').split(/[?#]/)[0];
  const m = /\.([a-z0-9]{1,5})$/i.exec(key);
  return m ? m[1].toLowerCase() : null;
}

// The name a downloaded card gets.
//
// Order matters: `fileName` is the original upload's name and always wins.
// Only if there isn't one do we fall back to a display name the user may have
// edited — and in that case we must re-attach an extension, or renaming a card
// to "Kick 1" produces a file the OS and every DAW refuse to open.
export function assetFilename(card, kind, { fallback = 'download' } = {}) {
  const c = card || {};
  const src = assetSrcFor(c, kind);
  const original = typeof c.fileName === 'string' ? c.fileName.trim() : '';
  const wanted = c.ext || extFromMime(c.mime) || extFromSrc(src)
    || (kind === 'pdf' ? 'pdf' : null);

  let base = original;
  if (!base) {
    base = String(c.name || c.title || c.label || '').trim();
  }
  // A filename is a BASENAME. Take the last segment first, so a title someone
  // pasted a path into ("../../etc/passwd") cannot survive as a relative path
  // in a zip entry or a Downloads folder.
  base = base.split(/[\\/]/).filter(Boolean).pop() || '';
  base = base.replace(ILLEGAL, '-').replace(/^\.+/, '').trim().slice(0, 80);
  if (!base) base = fallback;

  if (!wanted) return base;
  const has = new RegExp(`\\.${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(base);
  // Only strip a DIFFERENT extension when we are confident of the right one;
  // never mangle "Take 2.1" into "Take 2.wav".
  if (has) return base;
  return `${base}.${wanted}`;
}

// "Loop Pack" → "Loop Pack.zip", with the same illegal-character rule.
export function zipNameFor(label) {
  const base = String(label || 'download').replace(ILLEGAL, '-').replace(/^\.+/, '').trim().slice(0, 60);
  return `${base || 'download'}.zip`;
}
