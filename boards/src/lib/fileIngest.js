// Single source of truth for turning a dropped/picked File into a card "route"
// (which upload path + card kind it takes) plus an intrinsic fallback size.
//
// Shared by BOTH file-ingest surfaces so their type detection and size caps can
// never drift apart:
//   • the canvas drop pipeline  — CanvasSurface.ingestFiles
//   • the list-view drop pipeline — App.ingestFilesArranged (list mode has no
//     viewport, so it packs the batch via arrangeInFreeSpace instead of a
//     cursor point, but the ROUTING must be identical to the canvas).
//
// Pure + synchronous (no React, no Yjs). Real image/video dimensions are read
// separately (they're async); the fallback dims here just seed the layout so a
// batch can be arranged before uploads resolve, then corrected on the card.

// Free-tier inline-media byte caps. Over these (and paid), video/audio still
// become inline cards but upload via multipart ('largeMedia'); anything else
// non-standard becomes a generic downloadable file card.
export const FREE_VIDEO_CAP = 30 * 1024 * 1024;
export const FREE_AUDIO_CAP = 50 * 1024 * 1024;
export const FREE_PDF_CAP   = 50 * 1024 * 1024;

// Intrinsic fallback sizes (canvas units) used before real dims are known.
// Mirror the per-type defaults in CanvasSurface's optimistic drop handlers.
export const FALLBACK_DIMS = {
  image: { w: 320, h: 240 },
  pdf:   { w: 300, h: 388 },
  video: { w: 360, h: 202 }, // 16:9
  audio: { w: 380, h: 130 },
  file:  { w: 240, h: 150 },
};

// Decide the upload route + card kind + fallback size for a File.
//   canAttemptFiles — false when the user OWNS this workspace and is NOT on a
//                     paid plan, so the "upload anything" feature is hard-blocked
//                     client-side (shared workspaces attempt optimistically and
//                     let the server's 402/403 decide).
// Returns { route, kind, w, h } where route ∈
//   'image' | 'video' | 'audio' | 'pdf' | 'largeMedia' | 'file' | 'blocked'.
export function classifyDropFile(file, { canAttemptFiles = true } = {}) {
  const type = file?.type || '';
  const name = file?.name || '';
  const size = file?.size || 0;
  // Some pickers surface iPhone HEIC/HEIF with an EMPTY mime type — match the
  // extension too, or a camera-roll photo becomes a generic file card (which is
  // paid-gated for free owners). Browsers that DO report a type say image/heic.
  const isImage = type.startsWith('image/') || (!type && /\.(heic|heif)$/i.test(name));
  const isVideo = type.startsWith('video/');
  const isAudio = type.startsWith('audio/');
  // Some browsers report an empty type for .pdf picks/drops — match the ext too.
  const isPdf = type === 'application/pdf' || /\.pdf$/i.test(name);

  if (isImage) return { route: 'image', kind: 'image', ...FALLBACK_DIMS.image };
  if (isVideo && size <= FREE_VIDEO_CAP) return { route: 'video', kind: 'video', ...FALLBACK_DIMS.video };
  if (isAudio && size <= FREE_AUDIO_CAP) return { route: 'audio', kind: 'audio', ...FALLBACK_DIMS.audio };
  if (isPdf && size <= FREE_PDF_CAP) return { route: 'pdf', kind: 'pdf', ...FALLBACK_DIMS.pdf };
  if (!canAttemptFiles) return { route: 'blocked', kind: null, w: 0, h: 0 };
  if (isVideo || isAudio) {
    return isVideo
      ? { route: 'largeMedia', kind: 'video', ...FALLBACK_DIMS.video }
      : { route: 'largeMedia', kind: 'audio', ...FALLBACK_DIMS.audio };
  }
  // PDFs over the inline cap + every other type → downloadable file card.
  return { route: 'file', kind: 'file', ...FALLBACK_DIMS.file };
}

// Coarse size bucket for upload analytics (EV.UPLOAD_BLOCKED etc.) — buckets,
// never raw bytes, so events stay low-cardinality and non-identifying.
export function sizeBucket(bytes) {
  const MB = 1024 * 1024;
  if (!bytes || bytes < 10 * MB) return 'lt_10mb';
  if (bytes < 50 * MB) return '10_50mb';
  if (bytes < 200 * MB) return '50_200mb';
  if (bytes < 1024 * MB) return '200mb_1gb';
  return 'gt_1gb';
}

// Clamp real image dimensions into the canvas' paste-size window, preserving
// aspect. Same rule as dropImageBlob / optimisticDropImage (scale DOWN above
// MAX, scale UP below MIN, never distort). Shared so list + canvas agree.
export function fitImageDims(width, height) {
  const MAX = 1200, MIN = 80;
  let w = 320, h = 240;
  if (width && height) {
    w = width; h = height;
    if (w > MAX || h > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    if (w < MIN || h < MIN) { const k = MIN / Math.min(w, h); w = Math.round(w * k); h = Math.round(h * k); }
  }
  return { w, h };
}
