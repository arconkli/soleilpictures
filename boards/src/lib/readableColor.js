// Always-readable color core. Presentation-only — keeps note/doc text legible
// against whatever surface it sits on, in either theme, while preserving the
// user's color intent whenever it already reads fine. NEVER written to Yjs.
//
// Reuses the shared luminance/ink helpers from paletteLayout.js (the single
// source of contrast math, also used by renderThumbnail.js) so the live DOM and
// the canvas thumbnail can't drift.

import { hexToRgb, readableInk } from './paletteLayout.js';

// We only intervene when a color is genuinely hard to read (contrast below
// TRIGGER); when we do, we push it to a comfortable TARGET. Values are WCAG
// contrast ratios (1..21). Tunable in one place.
export const CONTRAST_TRIGGER = 3.0;   // ~"low contrast / starting to disappear"
export const CONTRAST_TARGET = 4.5;    // WCAG AA for body text

function clampByte(n) { return Math.max(0, Math.min(255, Math.round(n))); }

// Parse hex (#rgb/#rrggbb) or rgb()/rgba() into {r,g,b}. Returns null for
// transparent / unknown / fully-transparent colors (caller leaves intent / uses
// the inherited surface ink).
export function parseColor(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim().toLowerCase();
  if (!s || s === 'transparent' || s === 'currentcolor' || s === 'inherit' || s === 'initial' || s === 'unset') return null;
  if (s[0] === '#') return hexToRgb(s);
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]), g = parseFloat(parts[1]), b = parseFloat(parts[2]);
      const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;
      if ([r, g, b].every((n) => Number.isFinite(n)) && (!Number.isFinite(a) || a > 0)) {
        return { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
      }
    }
  }
  return null;
}

// WCAG relative luminance (sRGB gamma) for a {r,g,b}.
function wcagLum({ r, g, b }) {
  const f = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// WCAG contrast ratio between two {r,g,b}. Missing inputs read as "fine".
export function contrastRatio(a, b) {
  if (!a || !b) return 21;
  const la = wcagLum(a), lb = wcagLum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0; let s = 0; const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}
function hslToRgb({ h, s, l }) {
  let r; let g; let b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: clampByte(r * 255), g: clampByte(g * 255), b: clampByte(b * 255) };
}
function toHex({ r, g, b }) {
  const h = (n) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Return `color` if it reads acceptably on `bg`; otherwise a hue-preserving
// lighter/darker variant that clears CONTRAST_TARGET, falling back to readable
// ink if even that can't reach it. Inputs may be hex or rgb() strings; returns
// a hex string (or the original string when it can't be evaluated).
export function readableOn(color, bg, opts = {}) {
  const trigger = opts.trigger ?? CONTRAST_TRIGGER;
  const target = opts.target ?? CONTRAST_TARGET;
  const c = parseColor(color);
  const b = parseColor(bg);
  if (!c || !b) return color;                       // can't evaluate → keep intent
  if (contrastRatio(c, b) >= trigger) return color; // already readable
  const hsl = rgbToHsl(c);
  // Near-grayscale picks ("white text" / "black text" / default ink) carry no
  // meaningful hue — snap straight to crisp readable ink rather than landing on
  // a dull mid-gray that only just clears the target.
  if (hsl.s < 0.12) return readableInk(toHex(b));
  const bgLight = wcagLum(b) > 0.18;                 // dark text on light bg & vice-versa
  for (let i = 1; i <= 20; i++) {
    const t = i / 20;
    const l = bgLight ? hsl.l * (1 - t) : hsl.l + (1 - hsl.l) * t;
    const cand = hslToRgb({ h: hsl.h, s: hsl.s, l });
    if (contrastRatio(cand, b) >= target) return toHex(cand);
  }
  return readableInk(toHex(b));                      // last resort: pure readable ink
}

// Rewrite inline `color` (and ensure text over a highlight stays legible) in an
// html string so every run reads on its surface. `effectiveBg` is the surface
// the html sits on (the note's bg, or the theme bg for an unpainted note).
// Pure + memoizable; presentation-only (never persisted). Returns the html
// unchanged when nothing needs fixing.
export function remapHtmlColors(html, effectiveBg) {
  if (!html || typeof html !== 'string') return html;
  if (typeof DOMParser === 'undefined') return html;
  if (!/color\s*:/i.test(html)) return html;        // fast path: nothing colored
  const base = parseColor(effectiveBg) ? effectiveBg : null;
  let doc;
  try { doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html'); }
  catch (_) { return html; }
  let changed = false;
  doc.body.querySelectorAll('[style]').forEach((el) => {
    const hl = el.style.backgroundColor;            // a highlighted run → local surface
    const localBg = (hl && parseColor(hl)) ? hl : base;
    if (!localBg) return;
    const col = el.style.color;
    if (col) {
      const fixed = readableOn(col, localBg);
      if (fixed && fixed !== col) { el.style.color = fixed; changed = true; }
    } else if (hl && parseColor(hl)) {
      // Highlighted run with no explicit text color: pin readable ink so the
      // inherited (theme) color can't vanish on the highlight.
      el.style.color = readableInk(hl); changed = true;
    }
  });
  return changed ? doc.body.innerHTML : html;
}

// Build a scoped stylesheet that overrides low-contrast inline colors inside a
// live editor (ProseMirror manages those spans, so we can't rewrite them — but
// an author `!important` rule beats a non-important inline style on the same
// element). `scopeSel` must select the editor root. Returns a CSS string.
//
// Why a stylesheet and not a decoration: PM renders inline decorations OUTSIDE
// mark spans, so a decoration's color is only *inherited* by the mark span and
// loses to the mark's own inline color. A stylesheet rule targets the mark span
// directly. Tiptap's Color mark keeps the literal value in the style attribute
// (`style="color: #abc"`), so an attribute selector matches it exactly.
export function buildColorOverrideCss(root, surfaceBg, scopeSel) {
  if (!root || typeof root.querySelectorAll !== 'function') return '';
  const base = parseColor(surfaceBg) ? surfaceBg : null;
  if (!base) return '';
  const colorRules = new Map();  // rawColorToken -> readable hex
  const hlRules = new Map();     // rawBgToken    -> readable ink (for highlights
                                 //                  whose text has no explicit color)
  root.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style') || '';
    // Match the `color:` / `background-color:` tokens precisely (start-of-string
    // or right after a `;`, so the two never cross-match).
    const cm = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    const bm = style.match(/(?:^|;)\s*background-color\s*:\s*([^;]+)/i);
    const rawColor = cm ? cm[1].trim() : null;
    const rawBg = bm ? bm[1].trim() : null;
    const hl = (rawBg && parseColor(rawBg)) ? rawBg : null;
    const localBg = hl || base;
    if (rawColor && parseColor(rawColor)) {
      const fixed = readableOn(rawColor, localBg);
      if (fixed && fixed.toLowerCase() !== rawColor.toLowerCase()) colorRules.set(rawColor, fixed);
    } else if (hl) {
      // Highlighted run with no explicit (parseable) text color: the inherited
      // theme ink can vanish on the highlight, so pin readable ink to the bg.
      hlRules.set(rawBg, readableInk(hl));
    }
  });
  let css = '';
  for (const [raw, fixed] of colorRules) {
    // Two anchored selectors so `background-color: <raw>` is never matched.
    const a = JSON.stringify(`color: ${raw}`);      // color first in the attr
    const b = JSON.stringify(`; color: ${raw}`);    // color after another prop
    css += `${scopeSel} [style^=${a}],${scopeSel} [style*=${b}]{color:${fixed} !important}\n`;
  }
  for (const [raw, ink] of hlRules) {
    const a = JSON.stringify(`background-color: ${raw}`);
    css += `${scopeSel} [style*=${a}]{color:${ink} !important}\n`;
  }
  return css;
}
