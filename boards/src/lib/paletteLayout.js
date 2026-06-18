// Single source of truth for palette-card layout + label contrast.
//
// Palette cards render through two independent paths: the live React card
// (components/cards.jsx) and the Canvas-2D thumbnail (lib/renderThumbnail.js).
// They MUST agree visually, so the layout decision and the contrast math live
// here and are imported by both. Never reimplement either in a render path.

export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Perceptual luminance, 0..1. Same weights renderThumbnail has always used
// for note-text contrast. Unknown/invalid colors read as dark.
export function relLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

// Black or white ink that stays readable on top of `hex`. The 0.6 cut matches
// renderThumbnail's readableNoteTextColor so the two paths can't drift.
export function readableInk(hex) {
  return relLuminance(hex) > 0.6 ? '#0a0a0c' : '#f5f5f7';
}

// New swatches default to the literal name 'Color'; only surface names the
// user actually chose.
export function hasCustomName(name) {
  if (!name || typeof name !== 'string') return false;
  const t = name.trim();
  return t.length > 0 && t.toLowerCase() !== 'color';
}

// Decide how a palette card lays out for a given box (canvas-space px) and
// swatch count.
//   mode     : 'bands' (seamless edge-to-edge fill) | 'chips' (rounded + gaps)
//   orient   : 'vert'  (columns, w >= h)            | 'horiz' (rows, h > w)
//   showHead : a slim title strip fits (and isn't suppressed for pure-color)
//   showHex  : per-swatch hex label fits as an overlay
//   showName : a custom-name line fits above the hex
// All thresholds are tuned here in one place.
export function paletteLayout(w, h, count, opts = {}) {
  const pureColor = !!opts.pureColor;
  const n = Math.max(Math.floor(count) || 0, 1);
  const orient = w >= h ? 'vert' : 'horiz';

  // Reserve a header strip when colors carry labels and there's vertical room.
  const showHead = !pureColor && h >= 64;
  const headH = showHead ? 22 : 0;
  const innerH = Math.max(0, h - headH);

  const mainLen = orient === 'vert' ? w : innerH;   // axis divided among n
  const shortAxis = orient === 'vert' ? innerH : w; // band/chip thickness
  const slice = mainLen / n;                         // per-swatch thickness

  // Seamless bands once each slice is fat enough and the short axis isn't a
  // hairline; otherwise rounded chips. Both fill — neither ever scrolls.
  const mode = slice >= 22 && shortAxis >= 56 ? 'bands' : 'chips';

  // Overlaid labels only when not pure-color and there's room to read them.
  const showHex = !pureColor && slice >= 40 && shortAxis >= 46;
  const showName = showHex && slice >= 60 && shortAxis >= 78;

  return { mode, orient, showHead, showHex, showName, slice, shortAxis };
}
