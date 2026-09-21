// Real waveform peaks, decoded from the local File at upload time.
//
// The card used to draw a waveform synthesized from a hash of the filename —
// deterministic, musical-looking, and completely unrelated to the audio. It was
// justified by a comment claiming R2 signed URLs aren't CORS-readable, which is
// stale (r2-cors.json allows GET from the app origins), and in any case the
// File is already in hand at upload time so CORS never entered into it. The
// public docs meanwhile promised "a real waveform, drawn from the file".
//
// This is the same shape as captureAndUploadPoster (uploads.js): derive the
// artifact EAGERLY from the local File, degrade to nothing on failure, and let
// a bounded backfill hook catch the cards that predate the pipeline.
//
// Split deliberately: everything above the DOM marker is pure and runs under
// `node --test`. Nothing at module scope touches AudioContext — scripts/
// gen-docs.mjs and the node test runner both load this file's sibling
// constants, and a top-level `new AudioContext()` would throw in both.

import {
  AUDIO_ANALYZE_MAX_BYTES,
  AUDIO_ANALYZE_MAX_SECONDS,
} from './fileIngest.js';

// How many buckets a stored waveform has. The card is 380px wide and its bar
// strip ~340px, so 96 bars at 3px + 1px gap fills it exactly, and it still
// reads at the 64px list-row mini-wave (which samples every other bucket).
//
// NOT written into the stored value and NOT versioned: the renderer draws
// however many buckets it decodes, so changing this number later costs nothing
// and old cards keep working.
export const PEAK_COUNT = 96;

// Below this the file is silence or near-silence. Normalizing it would
// amplify dither into a confident-looking waveform, which is the exact failure
// the fake peaks were.
const SILENCE_FLOOR = 0.02;

// ── Pure ────────────────────────────────────────────────────────────────────

// Downsample interleaved channel data into `count` bytes of 0-255.
//
// `getChannel(i) -> Float32Array` rather than an AudioBuffer so this is
// testable in node with fabricated data.
//
// Peak = MAX |sample| per bucket, not RMS. RMS flattens percussive material,
// and percussive material is the entire content here — a drum loop has to LOOK
// like a drum loop or the waveform has failed at its one job.
export function computePeaks(getChannel, length, channelCount, count = PEAK_COUNT) {
  const n = Math.max(1, Math.floor(count));
  const out = new Uint8Array(n);
  if (!length || !channelCount) return out;

  const channels = [];
  for (let c = 0; c < channelCount; c++) {
    const data = getChannel(c);
    if (data && data.length) channels.push(data);
  }
  if (!channels.length) return out;

  const raw = new Float32Array(n);
  const per = length / n;
  let globalMax = 0;

  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(length, Math.floor((b + 1) * per));
    let max = 0;
    for (const data of channels) {
      const stop = Math.min(end, data.length);
      for (let i = start; i < stop; i++) {
        const v = data[i] < 0 ? -data[i] : data[i];
        if (v > max) max = v;
      }
    }
    raw[b] = max;
    if (max > globalMax) globalMax = max;
  }

  // Normalize to the file's own peak so a quiet one-shot still draws full
  // height — but never amplify silence.
  const scale = globalMax > SILENCE_FLOOR ? 1 / globalMax : 1;
  for (let b = 0; b < n; b++) {
    const v = raw[b] * scale;
    out[b] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return out;
}

// Uint8Array → base64. Stored inline on the Y.Doc card: 96 bytes → 128 chars,
// so a 500-loop pack costs ~64KB of document. The alternative (one small R2
// object per track) would need an `images` row, a presign and a fetch PER CARD
// — 500 extra round trips on open, and 500 extra keys for the public share
// bundle to presign serially.
export function peaksToBase64(u8) {
  if (!u8 || !u8.length) return null;
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  try {
    if (typeof btoa === 'function') return btoa(s);
    return Buffer.from(u8).toString('base64');
  } catch (_) { return null; }
}

// base64 → Uint8Array. Returns null on anything malformed so a corrupt field
// renders the flat strip rather than throwing inside a card render.
export function peaksFromBase64(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    if (typeof atob === 'function') {
      const bin = atob(str);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.length ? out : null;
    }
    const buf = Buffer.from(str, 'base64');
    return buf.length ? new Uint8Array(buf) : null;
  } catch (_) { return null; }
}

// Build the SVG path for a centered bar waveform. Pure so it is testable and so
// both the card and the list-row mini-wave draw from one implementation.
//
// ONE <path> rather than N <rect>s: a 500-row list at 96 rects a row is 48,000
// DOM nodes, and the fill animation would be 96 class toggles per frame instead
// of one clip rect.
export function peaksToPath(peaks, { height = 40, barWidth = 3, gap = 1, minHeight = 2 } = {}) {
  if (!peaks || !peaks.length) return '';
  const step = barWidth + gap;
  const parts = [];
  for (let i = 0; i < peaks.length; i++) {
    const h = Math.max(minHeight, (peaks[i] / 255) * (height - minHeight) + minHeight);
    const x = i * step;
    const y = (height - h) / 2;
    const r = Math.min(barWidth / 2, 1.2);
    // Rounded bar as a single subpath.
    parts.push(`M${x} ${(y + r).toFixed(2)}a${r} ${r} 0 0 1 ${barWidth} 0v${(h - r * 2).toFixed(2)}a${r} ${r} 0 0 1 ${-barWidth} 0Z`);
  }
  return parts.join('');
}

// Total width the path above occupies, for the SVG viewBox.
export function peaksPathWidth(count, { barWidth = 3, gap = 1 } = {}) {
  return Math.max(1, count * (barWidth + gap) - gap);
}

// Should we even try to decode this? Pure, so the backfill hook can ask the
// same question from a size in the images table without touching a File.
export function analyzable({ sizeBytes = 0, durationSec = null, lowMemory = false } = {}) {
  const maxBytes = lowMemory ? Math.floor(AUDIO_ANALYZE_MAX_BYTES / 2) : AUDIO_ANALYZE_MAX_BYTES;
  if (sizeBytes && sizeBytes > maxBytes) return false;
  if (durationSec != null && Number.isFinite(durationSec) && durationSec > AUDIO_ANALYZE_MAX_SECONDS) return false;
  return true;
}

// ── DOM ─────────────────────────────────────────────────────────────────────

// Lazily-created, never-resumed AudioContext.
//
// decodeAudioData works on a SUSPENDED context in every current browser, so
// there is no user-gesture requirement on iOS. Never calling resume() also
// means this never contends with audioBus's <audio> elements for the output
// device. Closed after an idle beat because Safari caps live contexts around 4.
let ctx = null;
let idleTimer = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try { ctx = new Ctor(); } catch (_) { return null; }
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    try { ctx?.close?.(); } catch (_) {}
    ctx = null; idleTimer = null;
  }, 20000);
  return ctx;
}

// Decode an ArrayBuffer and reduce it to peaks + exact metadata.
// Resolves null on ANY failure — an unsupported codec, a truncated file, no
// Web Audio at all. The caller degrades to the flat strip.
export async function analyzeArrayBuffer(buf, { count = PEAK_COUNT } = {}) {
  const c = getCtx();
  if (!c || !buf || !buf.byteLength) return null;
  let audio = null;
  try {
    // Safari still wants the callback form; the promise form is standard.
    audio = await new Promise((resolve, reject) => {
      try {
        const p = c.decodeAudioData(buf, resolve, reject);
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      } catch (err) { reject(err); }
    });
  } catch (_) { return null; }
  if (!audio) return null;
  try {
    const peaks = computePeaks((i) => audio.getChannelData(i), audio.length, audio.numberOfChannels, count);
    return {
      peaks: peaksToBase64(peaks),
      duration: Number.isFinite(audio.duration) ? audio.duration : null,
      sampleRate: audio.sampleRate || null,
      channels: audio.numberOfChannels || null,
    };
  } catch (_) { return null; }
}

// Analyze a local File. Returns null when refused by a cap (so the caller can
// leave `analyzed` unset and let a desktop session try later) and
// `{ analyzed: true, ... }` shaped results otherwise.
//
// `durationHint` lets the caller pass the cheap <audio> metadata duration it
// already read, so a ten-minute file is refused BEFORE it is decoded.
export async function analyzeAudioFile(file, { count = PEAK_COUNT, durationHint = null, lowMemory = false } = {}) {
  if (!file) return null;
  if (!analyzable({ sizeBytes: file.size || 0, durationSec: durationHint, lowMemory })) return null;
  let buf = null;
  try { buf = await file.arrayBuffer(); } catch (_) { return null; }
  return analyzeArrayBuffer(buf, { count });
}
