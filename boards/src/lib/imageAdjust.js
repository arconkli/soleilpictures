// Non-destructive photo adjustments for image cards.
//
// The adjustments live as a small plain object on the card (`card.adjust`) and
// are rendered LIVE with CSS `filter` + `transform` — the original upload is
// never touched. The same numbers drive the download "bake" (canvas), so what
// you see equals what you download.
//
//   card.adjust = {
//     flipH, flipV,                    // booleans
//     brightness, contrast, saturation // 0..200, neutral 100
//     warmth,                          // -100..100, neutral 0
//     sharpen,                         // 0..3 level, neutral 0
//     grayscale,                       // boolean
//   }
//
// Every key is optional; absence === neutral. `reset` clears the key by writing
// `adjust: null`.
//
// brightness/contrast/saturate/grayscale map to native CSS filter functions.
// Sharpness and warmth have no CSS-function equivalent, so they reference SVG
// filters mounted once by SoleilImageFilters.jsx (ids below). The canvas bake
// can't rely on `ctx.filter: url(#…)` (unreliable, esp. Safari), so it
// reproduces warmth + sharpen with manual ImageData passes using the SAME
// constants exported here — keep them the single source of truth.

export const ADJUST_FIELDS = {
  brightness: { min: 0, max: 200, neutral: 100 },
  contrast:   { min: 0, max: 200, neutral: 100 },
  saturation: { min: 0, max: 200, neutral: 100 },
  warmth:     { min: -100, max: 100, neutral: 0 },
  sharpen:    { min: 0, max: 3, neutral: 0 },
};

export const EMPTY_ADJUST = {
  flipH: false, flipV: false,
  brightness: 100, contrast: 100, saturation: 100,
  warmth: 0, sharpen: 0, grayscale: false,
};

// ── Sharpen — 3×3 convolution kernels (sum === 1 → brightness-preserving).
// Indexed by level-1 (level 1..3). Used by both the SVG <feConvolveMatrix>
// defs and the canvas bake convolution.
export const SHARPEN_KERNELS = [
  [ 0, -1, 0, -1, 5, -1, 0, -1, 0 ],                                // 1 subtle
  [ -0.5, -1, -0.5, -1, 7, -1, -0.5, -1, -0.5 ],                    // 2 medium
  [ -1, -1, -1, -1, 9, -1, -1, -1, -1 ],                            // 3 strong
];

// ── Warmth — diagonal R/B channel scale (true warm/cool, no muddy brown).
// The slider stores a raw -100..100 value; it snaps to one of WARMTH_LEVELS
// discrete steps each side so a finite set of SVG <feColorMatrix> defs can be
// mounted while the bake reproduces the exact same gains.
export const WARMTH_LEVELS = 10;
const WARMTH_STEP = 0.025; // per-level channel gain → max ±25% at level 10

// Map a raw warmth value (-100..100) to a signed level (-10..10).
export function warmthLevel(warmth) {
  const v = Number(warmth) || 0;
  if (!v) return 0;
  const lvl = Math.round(v / (100 / WARMTH_LEVELS));
  return Math.max(-WARMTH_LEVELS, Math.min(WARMTH_LEVELS, lvl));
}

// Red/blue multipliers for a signed level (>0 warm, <0 cool).
export function warmthGains(level) {
  const g = level * WARMTH_STEP;
  return { kr: 1 + g, kb: 1 - g };
}

// The 20-number <feColorMatrix type="matrix"> values string for a signed level.
export function warmthMatrixValues(level) {
  const { kr, kb } = warmthGains(level);
  return `${kr} 0 0 0 0  0 1 0 0 0  0 0 ${kb} 0 0  0 0 0 1 0`;
}

function warmthFilterId(level) {
  if (level > 0) return `soleil-warm-${level}`;
  if (level < 0) return `soleil-cool-${-level}`;
  return null;
}

// ── Predicates / builders ───────────────────────────────────────────────────

const num = (v, d) => (v == null ? d : Number(v));
const fmt = (n) => String(+(+n).toFixed(4));

export function isAdjusted(a) {
  if (!a || typeof a !== 'object') return false;
  return !!(a.flipH || a.flipV || a.grayscale)
    || num(a.brightness, 100) !== 100
    || num(a.contrast, 100) !== 100
    || num(a.saturation, 100) !== 100
    || num(a.warmth, 0) !== 0
    || num(a.sharpen, 0) !== 0;
}

// CSS filter string for the live (DOM) preview — includes url() refs.
export function buildFilterCss(a) {
  if (!isAdjusted(a)) return '';
  const out = [];
  const b = num(a.brightness, 100), c = num(a.contrast, 100), s = num(a.saturation, 100);
  if (b !== 100) out.push(`brightness(${fmt(b / 100)})`);
  if (c !== 100) out.push(`contrast(${fmt(c / 100)})`);
  if (s !== 100) out.push(`saturate(${fmt(s / 100)})`);
  if (a.grayscale) out.push('grayscale(1)');
  const wl = warmthLevel(a.warmth);
  if (wl) out.push(`url(#${warmthFilterId(wl)})`);
  const sh = Math.round(num(a.sharpen, 0));
  if (sh > 0) out.push(`url(#soleil-sharpen-${Math.min(3, sh)})`);
  return out.join(' ');
}

// Function-only filter string for the canvas bake's ctx.filter (no url() refs —
// warmth + sharpen are applied as manual ImageData passes instead).
export function buildCanvasFilterCss(a) {
  if (!isAdjusted(a)) return '';
  const out = [];
  const b = num(a.brightness, 100), c = num(a.contrast, 100), s = num(a.saturation, 100);
  if (b !== 100) out.push(`brightness(${fmt(b / 100)})`);
  if (c !== 100) out.push(`contrast(${fmt(c / 100)})`);
  if (s !== 100) out.push(`saturate(${fmt(s / 100)})`);
  if (a.grayscale) out.push('grayscale(1)');
  return out.join(' ');
}

export function buildTransform(a) {
  if (!a) return '';
  const t = [];
  if (a.flipH) t.push('scaleX(-1)');
  if (a.flipV) t.push('scaleY(-1)');
  return t.join(' ');
}

// Combined inline style for the image element. Returns `undefined` when the
// card is neutral so unedited images stay byte-for-byte unchanged (no extra
// composited layer, zero perf cost).
export function buildImgStyle(a) {
  const filter = buildFilterCss(a);
  const transform = buildTransform(a);
  if (!filter && !transform) return undefined;
  const style = {};
  if (filter) style.filter = filter;
  if (transform) style.transform = transform;
  return style;
}
