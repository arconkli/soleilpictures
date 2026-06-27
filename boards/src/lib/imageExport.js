// One-click image download. When the card has photo adjustments, the edits are
// "baked" into the downloaded file via a canvas so the file matches what's on
// the board; with no edits it streams the untouched original bytes.
//
// The bake reproduces the live SVG-filter pipeline on the CPU, using the SAME
// curve/matrix/kernel math from lib/imageAdjust.js (single source of truth) so
// preview ≈ file. Order matches the SVG filter: tone LUT → color matrix →
// vibrance (exact) → clarity (exact, mid-tone-weighted) → sharpen.

import { resolveSrc } from './r2.js';
import { loadCorsCleanImage } from './corsImage.js';
import {
  isAdjusted, normalizeAdjust, toneActive,
  buildToneLUT, buildColorMatrix, buildSharpenKernel, clarityParams, LUMA,
} from './imageAdjust.js';

// Safe download filename. `forceExt` overrides the extension (used when the
// baked blob is a PNG regardless of the source format).
export function filenameFor(s, t, forceExt) {
  let base = (t || '').toString().trim();
  if (!base) {
    const m = String(s || '').match(/([^/?#]+)(?:[?#]|$)/);
    base = m ? decodeURIComponent(m[1]) : 'image';
  }
  base = base.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  if (forceExt) {
    base = base.replace(/\.(jpe?g|png|gif|webp|avif|heic|bmp|svg)$/i, '');
    return `${base}.${forceExt}`;
  }
  if (!/\.(jpe?g|png|gif|webp|avif|heic|bmp|svg)$/i.test(base)) base += '.jpg';
  return base;
}

function triggerDownload(blob, name) {
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(objUrl); } catch (_) {} }, 1000);
}

// 3×3 convolution with edge-clamping; alpha is copied through. Kernels sum to 1.
function convolve3x3(src, W, H, kernel) {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy < 0 ? 0 : (y + dy >= H ? H - 1 : y + dy);
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx < 0 ? 0 : (x + dx >= W ? W - 1 : x + dx);
          const idx = (yy * W + xx) * 4;
          const w = kernel[ki++];
          r += src[idx] * w;
          g += src[idx + 1] * w;
          b += src[idx + 2] * w;
        }
      }
      const o = (y * W + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = src[o + 3];
    }
  }
  return out;
}

// Clarity: large-radius unsharp restricted to mid-tones. The blur reference is a
// downscale→upscale (cheap large-radius low-pass); high-pass = src − blur is
// added back, weighted by a mid-tone curve.
function applyClarity(id, W, H, n) {
  const { c, gain } = clarityParams(n);
  const amt = c * gain;
  const data = id.data;
  const scale = Math.max(2, Math.round(Math.min(W, H) / 64)); // bigger = larger radius
  const sw = Math.max(1, Math.round(W / scale));
  const sh = Math.max(1, Math.round(H / scale));
  const srcC = document.createElement('canvas'); srcC.width = W; srcC.height = H;
  srcC.getContext('2d').putImageData(id, 0, 0);
  const smallC = document.createElement('canvas'); smallC.width = sw; smallC.height = sh;
  const sctx = smallC.getContext('2d'); sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(srcC, 0, 0, sw, sh);
  const upC = document.createElement('canvas'); upC.width = W; upC.height = H;
  const uctx = upC.getContext('2d'); uctx.imageSmoothingEnabled = true; uctx.imageSmoothingQuality = 'high';
  uctx.drawImage(smallC, 0, 0, W, H);
  const blur = uctx.getImageData(0, 0, W, H).data;
  const [lr, lg, lb] = LUMA;
  for (let i = 0; i < data.length; i += 4) {
    const Y = (lr * data[i] + lg * data[i + 1] + lb * data[i + 2]) / 255;
    const f = amt * (4 * Y * (1 - Y));   // mid-tone weight
    data[i]     = data[i]     + f * (data[i]     - blur[i]);
    data[i + 1] = data[i + 1] + f * (data[i + 1] - blur[i + 1]);
    data[i + 2] = data[i + 2] + f * (data[i + 2] - blur[i + 2]);
  }
}

// Draw `img` to a canvas applying the full adjustment pipeline, return a PNG.
async function bakeAdjustedBlob(img, adjust) {
  const n = normalizeAdjust(adjust);
  if (!n) return null;
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  if (!W || !H) return null;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.save();
  ctx.translate(n.flipH ? W : 0, n.flipV ? H : 0);
  ctx.scale(n.flipH ? -1 : 1, n.flipV ? -1 : 1);
  ctx.drawImage(img, 0, 0, W, H);
  ctx.restore();

  const id = ctx.getImageData(0, 0, W, H);
  const data = id.data;

  // Fused tone LUT + color matrix + exact vibrance (one pass).
  const lut = toneActive(n) ? buildToneLUT(n) : null;
  const cm = (n.grayscale || n.temperature || n.tint || n.saturation) ? buildColorMatrix(n, false) : null;
  const v = n.vibrance / 100;
  const [lr, lg, lb] = LUMA;
  if (lut || cm || v !== 0) {
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i + 1], b = data[i + 2];
      if (lut) { r = lut[r]; g = lut[g]; b = lut[b]; }
      if (cm) {
        const nr = cm[0] * r + cm[1] * g + cm[2] * b;
        const ng = cm[5] * r + cm[6] * g + cm[7] * b;
        const nb = cm[10] * r + cm[11] * g + cm[12] * b;
        r = nr; g = ng; b = nb;
      }
      if (v !== 0) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx <= 0 ? 0 : (mx - mn) / mx;
        const boost = 1 + v * (1 - sat);
        const Y = lr * r + lg * g + lb * b;
        r = Y + (r - Y) * boost; g = Y + (g - Y) * boost; b = Y + (b - Y) * boost;
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b;  // Uint8ClampedArray clamps
    }
  }

  if (n.clarity !== 0) applyClarity(id, W, H, n);
  if (n.sharpness !== 0) id.data.set(convolve3x3(id.data, W, H, buildSharpenKernel(n.sharpness)));

  ctx.putImageData(id, 0, 0);
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

// Public entry — download the (optionally edited) image behind a card.
export async function downloadImage({ src, title, adjust }) {
  let url = null;
  try { url = await resolveSrc(src); } catch (_) { url = null; }
  if (!url) return;

  const downloadOriginal = async () => {
    const res = await fetch(url);
    const blob = await res.blob();
    triggerDownload(blob, filenameFor(url, title));
  };

  try {
    if (!isAdjusted(adjust)) { await downloadOriginal(); return; }
    const img = await loadCorsCleanImage(url);
    if (!img) { await downloadOriginal(); return; }
    const blob = await bakeAdjustedBlob(img, adjust);
    if (!blob) { await downloadOriginal(); return; }
    triggerDownload(blob, filenameFor(url, title, 'png'));
  } catch (_) {
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (_) {}
  }
}
