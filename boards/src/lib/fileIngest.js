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
// non-standard becomes a generic downloadable file card — on free too, up to
// FREE_FILE_CAP below.
export const FREE_VIDEO_CAP = 30 * 1024 * 1024;
export const FREE_AUDIO_CAP = 50 * 1024 * 1024;
export const FREE_PDF_CAP   = 50 * 1024 * 1024;

// Any OTHER file type on the free plan, up to this size (0367, 2026-10-06).
// File types used to be Creator's: a free owner's .psd, .zip or .docx bounced
// off the canvas with a storage pitch. The gate had fired a handful of times
// in the product's life and it made "keep all your files here" untrue for
// everyone on free, so the owner opened the TYPE and kept the SIZE — the same
// ceiling as a PDF, and the server's authorize_upload() allows a demo owner
// exactly this many bytes (fileGateMigration.test.mjs pins the two together).
export const FREE_FILE_CAP = 50 * 1024 * 1024;
export const FREE_FILE_CAP_LABEL = `${FREE_FILE_CAP / (1024 * 1024)} MB`;

// The free tier also caps video LENGTH, not just weight, and that half of the
// gate was enforced for the product's life while being stated nowhere public —
// so a free owner's 90-second, 20 MB clip was refused by a rule no page
// mentioned, with a red "Upload failed" and no route to the offer.
//
// It lives here beside the byte caps, rather than as a bare default on
// uploads.js's uploadVideo, so the public copy can inject it the way it injects
// the others and cannot state a stale number. uploads.js imports it; this
// module imports nothing, so there is no cycle.
export const FREE_VIDEO_SECONDS = 60;

// Ceilings on WAVEFORM ANALYSIS — not on upload. Over these the file still
// uploads and still plays; it just arrives without a drawn waveform.
//
// decodeAudioData materializes the entire file as Float32 PCM, so a 50 MB WAV
// becomes ~180 MB of samples and takes mobile Safari out. Loops and one-shots
// are seconds long and nowhere near either gate; what these refuse is a DJ set
// or a stem master, where a waveform 340 pixels wide tells you nothing anyway.
//
// They live here with the other caps for the same reason FREE_VIDEO_SECONDS
// does: the public copy injects them via {{fact:}} and so cannot state a stale
// number. audioAnalysis.js imports them; this module imports nothing.
export const AUDIO_ANALYZE_MAX_BYTES = 25 * 1024 * 1024;
export const AUDIO_ANALYZE_MAX_SECONDS = 600;

// Intrinsic fallback sizes (canvas units) used before real dims are known.
// Mirror the per-type defaults in CanvasSurface's optimistic drop handlers.
export const FALLBACK_DIMS = {
  image: { w: 320, h: 240 },
  pdf:   { w: 300, h: 388 },
  video: { w: 360, h: 202 }, // 16:9
  audio: { w: 380, h: 130 },
  file:  { w: 240, h: 150 },
};

// A download that has not finished: Chrome's .crdownload, Firefox's .part,
// Safari's .download bundle, Opera's .opdownload, and the generic temp file.
// One of these rode along in the only over-cap drop where anyone pressed
// Upgrade, and it was the file that replaced the upgrade screen with a storage
// pitch — for a file nobody meant to upload.
export const PARTIAL_DOWNLOAD_RE = /\.(crdownload|part|partial|download|opdownload|tmp)$/i;
// Screenplays the doc editor already imports, free on every tier.
export const SCREENPLAY_FILE_RE = /\.(fountain|fdx)$/i;
// A PureRef scene. Our best-read comparison page is /vs/pureref, so its
// readers drop these on their first visit; uploading one only ever produced an
// opaque file card (paid) or a storage pitch (free). Neither opens the board.
export const PUREREF_FILE_RE = /\.pur$/i;

// Decide the upload route + card kind + fallback size for a File.
//   canAttemptFiles — false when the user OWNS this workspace and is NOT on a
//                     paid plan, so the "upload anything" feature is hard-blocked
//                     client-side (shared workspaces attempt optimistically and
//                     let the server's 402/403 decide).
// Returns { route, kind, w, h } where route ∈
//   'image' | 'video' | 'audio' | 'pdf' | 'largeMedia' | 'file' | 'blocked'
//   | 'partial'    — an unfinished download: skipped, never pitched
//   | 'screenplay' — becomes a script document (scriptImport.js), every tier
//   | 'pureref'    — a free owner's .pur: an honest note, never pitched.
export function classifyDropFile(file, { canAttemptFiles = true } = {}) {
  const type = file?.type || '';
  const name = file?.name || '';
  const size = file?.size || 0;
  // Checked before any mime test: a half-downloaded "photo.jpg.crdownload"
  // can carry no type at all, and must never reach an upload or a pitch.
  if (PARTIAL_DOWNLOAD_RE.test(name)) return { route: 'partial', kind: null, w: 0, h: 0 };
  if (SCREENPLAY_FILE_RE.test(name)) return { route: 'screenplay', kind: 'doc', w: 0, h: 0 };
  // A paying owner keeps "any file type" exactly as sold (a downloadable file
  // card); a free owner is told the truth instead of being sold storage.
  if (!canAttemptFiles && PUREREF_FILE_RE.test(name)) return { route: 'pureref', kind: null, w: 0, h: 0 };
  // Some pickers surface iPhone HEIC/HEIF with an EMPTY mime type — match the
  // extension too, or a camera-roll photo becomes a generic file card (which is
  // paid-gated for free owners). Browsers that DO report a type say image/heic.
  const isImage = type.startsWith('image/') || (!type && /\.(heic|heif)$/i.test(name));
  const isVideo = type.startsWith('video/');
  // Same empty-mime problem as HEIC, and it bites hardest on the formats
  // producers actually ship: Safari reports NO type for .flac and .aiff, and
  // some pickers do the same for .wav. Without an extension fallback those
  // become generic file cards — which are PAID-GATED for a free owner, so a
  // dropped sample pack half-uploads and half-refuses for no visible reason.
  const isAudio = type.startsWith('audio/')
    || (!type && /\.(wav|aiff?|flac|m4a|aac|ogg|opus|mp3|caf)$/i.test(name));
  // Some browsers report an empty type for .pdf picks/drops — match the ext too.
  const isPdf = type === 'application/pdf' || /\.pdf$/i.test(name);

  if (isImage) return { route: 'image', kind: 'image', ...FALLBACK_DIMS.image };
  if (isVideo && size <= FREE_VIDEO_CAP) return { route: 'video', kind: 'video', ...FALLBACK_DIMS.video };
  if (isAudio && size <= FREE_AUDIO_CAP) return { route: 'audio', kind: 'audio', ...FALLBACK_DIMS.audio };
  if (isPdf && size <= FREE_PDF_CAP) return { route: 'pdf', kind: 'pdf', ...FALLBACK_DIMS.pdf };
  if (!canAttemptFiles) {
    // A free owner. Media past its own cap is refused — that is the size
    // gate, Creator's. Any other type is a file card up to FREE_FILE_CAP
    // (0367 opened file TYPES on free); past it, the same size gate. `why`
    // tells the refusal copy what to say: it is never the type any more.
    if (isVideo || isAudio || isPdf) return { route: 'blocked', why: 'size', kind: null, w: 0, h: 0 };
    if (size <= FREE_FILE_CAP) return { route: 'file', kind: 'file', ...FALLBACK_DIMS.file };
    return { route: 'blocked', why: 'size', kind: null, w: 0, h: 0 };
  }
  if (isVideo || isAudio) {
    return isVideo
      ? { route: 'largeMedia', kind: 'video', ...FALLBACK_DIMS.video }
      : { route: 'largeMedia', kind: 'audio', ...FALLBACK_DIMS.audio };
  }
  // PDFs over the inline cap + every other type → downloadable file card.
  return { route: 'file', kind: 'file', ...FALLBACK_DIMS.file };
}

// The one sentence for files a drop skipped on purpose, shared by the canvas
// drop, the canvas paste and the list drop so the three cannot say different
// things. Null when nothing was skipped.
export function skippedFilesNotice({ partial = 0, pureref = 0 } = {}) {
  const parts = [];
  if (partial > 0) {
    parts.push(partial === 1
      ? 'Skipped an unfinished download — let it finish, then drop it again.'
      : `Skipped ${partial} unfinished downloads — let them finish, then drop them again.`);
  }
  if (pureref > 0) {
    parts.push("PureRef boards can't be opened here yet — export the images from PureRef, then drop those in.");
  }
  return parts.length ? parts.join(' ') : null;
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

// ── The name a file had on someone's computer ──────────────────────────────
//
// Until 2026-10 an image or video card kept nothing of the file it came from:
// a folder of `diner_ext_dusk_04.jpg` came back from Download as `download.jpg`
// and `file-1…file-40`, and no search could find a frame by the name the
// photographer gave it. Audio, PDFs and attachments always kept theirs. This is
// the one place that decides what counts as a name worth keeping, so every
// drop path keeps the same thing.
//
// Not worth keeping: what a browser invents for a paste. Chrome and Firefox
// call every clipboard image "image.png", Safari "Pasted Graphic 3.png", and a
// Blob passed as a File is "blob". Keeping those would title a hundred cards
// "image.png" and make the name column noise. A camera's own name
// (IMG_2034.HEIC, DSC00412.ARW) IS kept — it is how a photographer finds the
// frame again — and so is a macOS "Screenshot 2026-10-02 at 10.11.12.png".
const CLIPBOARD_NAME_RE = /^(image|blob|untitled|pasted graphic|pasted image|clipboard)(\s*[-_ ]?\d+)?(\.[a-z0-9]{2,5})?$/i;
const FILE_NAME_MAX = 200;

export function meaningfulFileName(file) {
  const raw = typeof file?.name === 'string' ? file.name : '';
  // NFC: macOS hands over decomposed accents (e + U+0301), which then neither
  // match a typed search nor compare equal to the same name from Windows.
  let name = raw.normalize('NFC');
  // A basename only — a dropped path must not survive into a download name.
  name = name.split(/[\\/]/).pop() || '';
  // C0 controls and DEL, written as escapes so the class is reviewable.
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name || CLIPBOARD_NAME_RE.test(name)) return null;
  return name.slice(0, FILE_NAME_MAX);
}

// Spread into a new image or video card: `{ fileName }`, or nothing at all, so
// a card from a paste stays byte-identical to what it always was.
export function fileMetaFor(file) {
  const fileName = meaningfulFileName(file);
  return fileName ? { fileName } : {};
}
