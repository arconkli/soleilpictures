// Scout — composing the pictures the bot texts back.
//
// Two things get rendered here, both with sharp and neither with a browser:
//
//   confirmationSheet() — a grouped contact sheet sent BEFORE a move. This is
//       the guard against the worst failure this feature has: someone with 14
//       forgotten photos in their Bin saying "put these in Diner Recce" and
//       silently moving 20. A count can't convey that. A picture with the new
//       photos bright and the old ones dimmed underneath conveys it instantly.
//
//   moodboardSheet()   — the arrangement we just wrote, scaled down. We already
//       computed every rect, so this is a true miniature rather than a guess.
//
// Why not reuse renderThumbnail.js: it's Canvas2D and browser-only (DOM canvas,
// loadCorsCleanImage, webfont stacks). Porting it means shipping @napi-rs/canvas
// plus the brand fonts and then maintaining two renderers that will drift. For
// an all-photos moodboard the sharp composite is visually equivalent anyway.

import sharp from 'sharp';
import { sheetLayout, previewLayout } from '../../boards/src/lib/contactSheet.js';
import { scoutSelect } from '../../boards/src/lib/scoutDb.js';

// Matches the canvas background (styles.css --bg-0, mirrored in
// renderThumbnail.js) so a preview looks like the board it represents.
const BG = '#0a0a0c';
const INK = '#f5f5f7';
const INK_DIM = '#888890';
const JPEG_QUALITY = 82;
// Historical groups render knocked back. Enough to read as "not these".
const DIM_BRIGHTNESS = 0.5;

const keyOf = (card) => String(card?.src || '').replace(/^r2:/, '') || null;

// Resolve the bytes to draw for a set of image cards.
//
// Reads the 640px preview tier when one exists rather than the original: a
// 20-photo sheet off originals is 60MB of downloads to produce a 300KB image.
// Falls back to the original for anything that predates variant generation.
export async function loadCardBitmaps(cfg, r2, cards) {
  const keys = cards.map(keyOf).filter(Boolean);
  if (!keys.length) return new Map();

  let rows = [];
  try {
    const list = `(${keys.map((k) => `"${k.replace(/"/g, '')}"`).join(',')})`;
    rows = await scoutSelect(
      cfg, 'images',
      `storage_path=in.${encodeURIComponent(list)}&select=storage_path,preview_path,width,height`,
    );
  } catch (e) {
    console.error('[scout] bitmap lookup failed', e?.message);
  }
  const meta = new Map(rows.map((r) => [r.storage_path, r]));

  const out = new Map();
  await Promise.all(keys.map(async (k) => {
    const m = meta.get(k);
    // -sm is the 640px tier written alongside the 1280px one (media.js).
    const candidates = [
      m?.preview_path ? m.preview_path.replace(/\.webp$/, '-sm.webp') : null,
      m?.preview_path || null,
      k,
    ].filter(Boolean);
    for (const c of candidates) {
      try {
        const bytes = await r2.get(c);
        if (bytes) { out.set(k, { bytes, width: m?.width || null, height: m?.height || null }); return; }
      } catch (_) { /* try the next tier */ }
    }
  }));
  return out;
}

// SVG text overlay. Rendered through librsvg (bundled with sharp), which needs
// a real font installed in the image — see the Dockerfile's fonts-dejavu-core.
// Without it every label silently renders blank, which is why the Dockerfile
// comment says not to drop it.
function labelOverlay(width, height, labels) {
  if (!labels.length) return null;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const text = labels.map((l) => (
    `<text x="${l.x}" y="${l.y}" fill="${l.dim ? INK_DIM : INK}" `
    + `font-family="DejaVu Sans, sans-serif" font-size="26" font-weight="600" `
    + `letter-spacing="1.5">${esc(l.text)}</text>`
  )).join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${text}</svg>`,
  );
}

async function renderComposite({ width, height, items, labels = [] }) {
  const layers = [];
  for (const it of items) {
    if (!it.bytes) continue;
    try {
      let pipe = sharp(it.bytes, { failOn: 'none' })
        .rotate()
        .resize(it.w, it.h, { fit: 'cover', position: 'attention' });
      if (it.dim) pipe = pipe.modulate({ brightness: DIM_BRIGHTNESS });
      layers.push({ input: await pipe.toBuffer(), left: it.x, top: it.y });
    } catch (e) {
      console.error('[scout] tile render failed', e?.message);
    }
  }

  const overlay = labelOverlay(width, height, labels);
  if (overlay) layers.push({ input: overlay, left: 0, top: 0 });

  return sharp({ create: { width, height, channels: 3, background: BG } })
    .composite(layers)
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

// groups: [{ label, dim, cards: [...] }] — oldest last so the photos the user
// just sent sit at the top where they'll actually be looked at.
export async function confirmationSheet(cfg, r2, groups) {
  const all = groups.flatMap((g) => g.cards || []);
  if (!all.length) return null;
  const bitmaps = await loadCardBitmaps(cfg, r2, all);

  const laid = sheetLayout(groups.map((g) => ({
    label: g.label,
    dim: g.dim,
    items: (g.cards || []).map((c) => ({
      key: keyOf(c),
      width: c.w || bitmaps.get(keyOf(c))?.width || 4,
      height: c.h || bitmaps.get(keyOf(c))?.height || 3,
    })),
  })));

  const items = [];
  const labels = [];
  for (const g of laid.groups) {
    if (g.label) {
      labels.push({
        text: `${g.label.toUpperCase()}  ·  ${g.count}`,
        x: 32, y: g.labelY + 28, dim: g.dim,
      });
    }
    for (const it of g.items) {
      const bm = bitmaps.get(it.key);
      if (bm) items.push({ ...it, bytes: bm.bytes, dim: g.dim });
    }
  }
  if (!items.length) return null;

  return renderComposite({ width: laid.width, height: laid.height, items, labels });
}

// A miniature of the arrangement just written to the destination board.
export async function moodboardSheet(cfg, r2, cards) {
  const images = (cards || []).filter((c) => c?.kind === 'image' && keyOf(c));
  if (!images.length) return null;

  const laid = previewLayout(images);
  if (!laid) return null;

  const bitmaps = await loadCardBitmaps(cfg, r2, images);
  const items = laid.items
    .map((it) => ({ ...it, bytes: bitmaps.get(keyOf(it))?.bytes || null }))
    .filter((it) => it.bytes);
  if (!items.length) return null;

  return renderComposite({ width: laid.width, height: laid.height, items });
}
