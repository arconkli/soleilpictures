// Non-destructive photo adjustments for image cards — Lightroom-style engine.
//
// Edits live as a plain `card.adjust` object on the card. They render LIVE via a
// per-card SVG filter (#soleil-adj-<cardId>, built by ImageAdjustFilters.jsx)
// referenced from the image's CSS `filter`; the SAME math drives the canvas
// download bake (imageExport.js), so what you see ≈ what you download. This
// module is the single source of truth for all curve / matrix / kernel math.
//
//   card.adjust (schema v2; every key optional, absence === neutral):
//     flipH, flipV, grayscale                                  // booleans
//     exposure, contrast, highlights, shadows, whites, blacks  // -100..100, 0
//     temperature, tint, vibrance, saturation, clarity         // -100..100, 0
//     sharpness                                                // 0..100, 0
//     v: 2                                                     // schema marker
//
// Legacy v1 cards used {brightness,contrast,saturation (0..200), warmth, sharpen
// (0..3)}; `normalizeAdjust` migrates them at READ time (nothing migrates the
// stored Yjs/Postgres value), keyed off the absence of the `v` marker.

// ── Tuning constants ────────────────────────────────────────────────────────
const EV_STOPS = 1.5;       // exposure: ±100 → ±1.5 stops
const CONTRAST_K = 0.6;     // max S-curve strength
const HL_AMT = 0.32, SH_AMT = 0.32;     // highlight / shadow zone push
const WHITES_AMT = 0.18, BLACKS_AMT = 0.18;
const HL_CENTER = 0.72, SH_CENTER = 0.28, ZONE_SIGMA = 0.20;
const TEMP_MAX = 0.22;      // temperature: ±22% R/B at ±100
const TINT_MAX = 0.18;      // tint: green↔magenta
const VIBRANCE_LIVE_FACTOR = 0.5; // live (SVG) vibrance ≈ gentle global sat nudge
export const CLARITY_GAIN = 0.8;
const SHARP_MAX = 1.2;
export const LUMA = [0.2126, 0.7152, 0.0722]; // Rec.709
export const TONE_TABLE_N = 33;
export const ADJUST_VERSION = 2;

export const ADJUST_FIELDS = {
  exposure:    { min: -100, max: 100, neutral: 0 },
  contrast:    { min: -100, max: 100, neutral: 0 },
  highlights:  { min: -100, max: 100, neutral: 0 },
  shadows:     { min: -100, max: 100, neutral: 0 },
  whites:      { min: -100, max: 100, neutral: 0 },
  blacks:      { min: -100, max: 100, neutral: 0 },
  temperature: { min: -100, max: 100, neutral: 0 },
  tint:        { min: -100, max: 100, neutral: 0 },
  vibrance:    { min: -100, max: 100, neutral: 0 },
  saturation:  { min: -100, max: 100, neutral: 0 },
  clarity:     { min: -100, max: 100, neutral: 0 },
  sharpness:   { min: 0,    max: 100, neutral: 0 },
};

export const EMPTY_ADJUST = {
  flipH: false, flipV: false, grayscale: false,
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temperature: 0, tint: 0, vibrance: 0, saturation: 0, clarity: 0, sharpness: 0,
};

const SIGNED_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
  'temperature', 'tint', 'vibrance', 'saturation', 'clarity'];

// ── Legacy migration (read-time) ────────────────────────────────────────────
const numOr = (v, d) => (v == null ? d : (Number(v) || 0));
const clampi = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

// old brightness 0..200 (×, neutral 100) → exposure stops scale -100..100
function mapBrightnessToExposure(b) {
  if (b == null) return 0;
  const x = Number(b) || 100;
  if (x <= 0) return -100;
  return clampi(100 * Math.log2(x / 100) / EV_STOPS, -100, 100);
}
// old contrast/saturation 0..200 (neutral 100) → signed -100..100
function mapPctToSigned(x) {
  if (x == null) return 0;
  return clampi(((Number(x) || 100) / 100 - 1) * 100, -100, 100);
}
function mapSharpenToSharpness(sh) {
  if (sh == null) return 0;
  return clampi((Number(sh) || 0) / 3 * 100, 0, 100);
}

// Normalize any stored adjust (v1 or v2) to the canonical v2 numeric shape, or
// null when there's nothing. The `v: 2` marker disambiguates the shapes (the
// `contrast`/`saturation` keys exist in both with different scales).
export function normalizeAdjust(a) {
  if (!a || typeof a !== 'object') return null;
  const legacy = !(a.v >= ADJUST_VERSION);
  if (legacy) {
    return {
      flipH: !!a.flipH, flipV: !!a.flipV, grayscale: !!a.grayscale,
      exposure: mapBrightnessToExposure(a.brightness),
      contrast: mapPctToSigned(a.contrast),
      highlights: 0, shadows: 0, whites: 0, blacks: 0,
      temperature: numOr(a.warmth, 0),
      tint: 0, vibrance: 0,
      saturation: mapPctToSigned(a.saturation),
      clarity: 0,
      sharpness: mapSharpenToSharpness(a.sharpen),
    };
  }
  const n = {
    flipH: !!a.flipH, flipV: !!a.flipV, grayscale: !!a.grayscale,
    sharpness: Math.max(0, Math.min(100, numOr(a.sharpness, 0))),
  };
  for (const k of SIGNED_KEYS) n[k] = Math.max(-100, Math.min(100, numOr(a[k], 0)));
  return n;
}

// ── Tone curve ──────────────────────────────────────────────────────────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep01 = (x) => x * x * (3 - 2 * x);
const gauss = (x, c, s) => { const d = x - c; return Math.exp(-(d * d) / (2 * s * s)); };

// Single monotonic-by-construction tone function, x∈[0,1], applied to R/G/B.
function toneAt(x, n) {
  let y = clamp01(x * Math.pow(2, (n.exposure / 100) * EV_STOPS));   // exposure
  const lo = (n.blacks / 100) * BLACKS_AMT;                          // blacks/whites
  const hi = 1 + (n.whites / 100) * WHITES_AMT;
  y = clamp01(lo + y * (hi - lo));
  const k = CONTRAST_K * (n.contrast / 100);                         // contrast S-curve
  y = clamp01(y + k * (smoothstep01(y) - y));
  const guard = 4 * y * (1 - y);                                     // highlights/shadows
  y = clamp01(y
    + SH_AMT * (n.shadows / 100) * gauss(y, SH_CENTER, ZONE_SIGMA) * guard
    + HL_AMT * (n.highlights / 100) * gauss(y, HL_CENTER, ZONE_SIGMA) * guard);
  return y;
}

export function toneActive(n) {
  return !!(n.exposure || n.contrast || n.highlights || n.shadows || n.whites || n.blacks);
}

// N-point tableValues for feComponentTransfer (running-max → guaranteed monotone).
export function buildToneTable(n, N = TONE_TABLE_N) {
  const arr = new Array(N);
  for (let i = 0; i < N; i++) arr[i] = toneAt(i / (N - 1), n);
  for (let i = 1; i < N; i++) if (arr[i] < arr[i - 1]) arr[i] = arr[i - 1];
  return arr.map((v) => +v.toFixed(4)).join(' ');
}

// 256-entry LUT for the canvas bake (same curve + running-max as the table).
export function buildToneLUT(n) {
  const lut = new Uint8ClampedArray(256);
  let prev = -1;
  for (let i = 0; i < 256; i++) {
    let y = Math.round(255 * toneAt(i / 255, n));
    if (y < prev) y = prev;
    lut[i] = y; prev = y;
  }
  return lut;
}

// ── Color matrix (temperature / tint / saturation / B&W) ────────────────────
export function colorActive(n) {
  return !!(n.grayscale || n.temperature || n.tint || n.saturation || n.vibrance);
}

// 20-value feColorMatrix. `includeVibrance` folds the LIVE vibrance approximation
// into saturation (true for the SVG preview); the bake passes false and applies
// exact per-pixel vibrance separately.
export function buildColorMatrix(n, includeVibrance = true) {
  let cr = 1, cg = 1, cb = 1, s;
  if (n.grayscale) {
    s = 0; // clean neutral B&W: skip WB/tint
  } else {
    const t = n.temperature / 100;
    const tn = n.tint / 100;
    const kc = 1 + 0.5 * TINT_MAX * tn;
    cr = (1 + TEMP_MAX * t) * kc;
    cb = (1 - TEMP_MAX * t) * kc;
    cg = 1 - TINT_MAX * tn;
    const vib = includeVibrance ? (1 + VIBRANCE_LIVE_FACTOR * (n.vibrance / 100)) : 1;
    s = Math.max(0, (1 + n.saturation / 100) * vib);
  }
  const [lr, lg, lb] = LUMA;
  const S = [
    lr + (1 - lr) * s, lg - lg * s,        lb - lb * s,
    lr - lr * s,       lg + (1 - lg) * s,  lb - lb * s,
    lr - lr * s,       lg - lg * s,        lb + (1 - lb) * s,
  ];
  return [
    S[0] * cr, S[1] * cg, S[2] * cb, 0, 0,
    S[3] * cr, S[4] * cg, S[5] * cb, 0, 0,
    S[6] * cr, S[7] * cg, S[8] * cb, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

// ── Sharpen / clarity ───────────────────────────────────────────────────────
// Parametric 3×3 unsharp kernel (sum === 1 → brightness-preserving). Same in the
// SVG feConvolveMatrix and the canvas convolution.
export function buildSharpenKernel(sharpness) {
  const g = (Math.max(0, Math.min(100, sharpness)) / 100) * SHARP_MAX;
  return [0, -g, 0, -g, 1 + 4 * g, -g, 0, -g, 0];
}

export function clarityParams(n) {
  return { c: n.clarity / 100, stdDev: 12, gain: CLARITY_GAIN };
}

// ── Predicates / refs / style ───────────────────────────────────────────────
export function isAdjusted(a) {
  const n = normalizeAdjust(a);
  if (!n) return false;
  if (n.flipH || n.flipV || n.grayscale) return true;
  for (const k of SIGNED_KEYS) if (n[k] !== 0) return true;
  return n.sharpness !== 0;
}

export function adjustFilterId(cardId) {
  return 'soleil-adj-' + String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// True when the adjust produces at least one SVG filter STAGE (tone/color/
// clarity/sharpen). Flip is a CSS transform, not a filter stage — so a flip-only
// card is "adjusted" but must NOT reference an (empty) filter.
export function hasFilterStages(a) {
  const n = normalizeAdjust(a);
  if (!n) return false;
  return toneActive(n) || colorActive(n) || n.clarity !== 0 || n.sharpness !== 0;
}

// CSS `filter` reference to the per-card SVG filter, or '' when no filter stages.
export function buildFilterRef(a, cardId) {
  return (cardId != null && hasFilterStages(a)) ? `url(#${adjustFilterId(cardId)})` : '';
}

export function buildTransform(a) {
  if (!a) return '';
  const t = [];
  if (a.flipH) t.push('scaleX(-1)');
  if (a.flipV) t.push('scaleY(-1)');
  return t.join(' ');
}

// Combined inline style for the image element. Returns `undefined` when neutral
// so unedited images stay byte-for-byte unchanged (no filter layer, zero cost).
export function buildImgStyle(a, cardId) {
  const filter = buildFilterRef(a, cardId);
  const transform = buildTransform(a);
  if (!filter && !transform) return undefined;
  const style = {};
  if (filter) style.filter = filter;
  if (transform) style.transform = transform;
  return style;
}
