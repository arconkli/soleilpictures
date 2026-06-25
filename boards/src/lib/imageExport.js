// One-click image download. When the card has photo adjustments, the edits are
// "baked" into the downloaded file via a canvas so the file matches what's on
// the board; with no edits it streams the untouched original bytes.
//
// The bake reproduces warmth + sharpen with manual ImageData passes (NOT
// ctx.filter url(), which is unreliable in canvas — esp. Safari), using the
// SAME constants the live SVG filters use (lib/imageAdjust.js) so preview and
// file stay identical.

import { resolveSrc } from './r2.js';
import { loadCorsCleanImage } from './corsImage.js';
import { isAdjusted, buildCanvasFilterCss, warmthLevel, warmthGains, SHARPEN_KERNELS } from './imageAdjust.js';

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

// Multiply the red/blue channels in place (Uint8ClampedArray auto-clamps).
function applyWarmth(data, kr, kb) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i] * kr;
    data[i + 2] = data[i + 2] * kb;
  }
}

// 3×3 convolution with edge-clamping; alpha is copied through. Kernels sum to 1
// (divisor === 1). Returns a fresh Uint8ClampedArray.
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

// Draw `img` to a canvas applying flip + filters, return a PNG Blob.
async function bakeAdjustedBlob(img, adjust) {
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  if (!W || !H) return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.save();
  ctx.translate(adjust.flipH ? W : 0, adjust.flipV ? H : 0);
  ctx.scale(adjust.flipH ? -1 : 1, adjust.flipV ? -1 : 1);
  const fc = buildCanvasFilterCss(adjust);
  if (fc) ctx.filter = fc;
  ctx.drawImage(img, 0, 0, W, H);
  ctx.restore();
  ctx.filter = 'none';

  const wl = warmthLevel(adjust.warmth);
  const sh = Math.round(Number(adjust.sharpen) || 0);
  if (wl !== 0 || sh > 0) {
    const id = ctx.getImageData(0, 0, W, H);
    if (wl !== 0) { const { kr, kb } = warmthGains(wl); applyWarmth(id.data, kr, kb); }
    if (sh > 0) {
      const kernel = SHARPEN_KERNELS[Math.min(3, sh) - 1];
      id.data.set(convolve3x3(id.data, W, H, kernel));
    }
    ctx.putImageData(id, 0, 0);
  }

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
    // Last-ditch: open in a new tab so the user can save manually.
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (_) {}
  }
}
