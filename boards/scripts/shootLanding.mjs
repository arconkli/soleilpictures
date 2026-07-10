#!/usr/bin/env node
// Generate the landing pages' hero "product shots": each published showcase
// board's live canvas hero (/c/<slug>) captured at 2× and compressed to
// public/landing/<slug>.webp. The SEO landing pages render these in a minimal
// browser frame (SeoLandingPage.jsx .seo-frame) — a real board, shipped as a
// static asset so it paints instantly and works on localhost (unlike R2).
//
//   node scripts/shootLanding.mjs [slug ...]     (default: all showcase slugs)
//
// Shoots PRODUCTION (the R2 images only exist there). Re-run whenever a
// showcase board is rebuilt and the landing visual should follow.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, 'public/landing');
mkdirSync(OUT, { recursive: true });

const ORIGIN = 'https://clusters.soleilpictures.com';
const ALL = [
  'japandi-living-room',
  'sage-terracotta-wedding',
  'world-cup-2026-moodboard',
  'neon-noir-look-book',
  'film-noir-look-book',
  'screenplay-beat-sheet',
  'short-film-shot-list',
];
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

const W = 2048, H = 1000; // output size; CSS aspect-ratio in seoLanding.css matches
// Effective in-page sensitivity measured at ~0.017/unit (not the source
// constant): factor ≈ exp(-delta·0.017). 13 → ~0.80×.
const ZOOM_DELTA = Number(process.env.ZOOM_DELTA || 13);
const PAN_Y = Number(process.env.PAN_Y || 420); // px to drag the board up (reveal below the mosaic)

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});

for (const slug of slugs) {
  const url = `${ORIGIN}/c/${slug}`;
  process.stdout.write(`shooting ${slug} … `);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  // Progressive images (blur → preview → full) need a beat past networkidle.
  await page.waitForTimeout(5000);
  // Hide the interaction hints — the frame chrome provides the affordance.
  await page.addStyleTag({ content: '.pa-hero-hint,.pa-scroll-hint,.public-nav-progress{display:none !important}' });
  const hero = page.locator('.public-canvas-host');
  // The default public framing is fit-to-width on the FIRST row, which reads
  // as a photo collage. Zoom out (ctrl+wheel is the public zoom gesture) so
  // the shot shows the canvas as a canvas: distinct cards, notes, arrows,
  // space. Synthetic WheelEvents give exact deltas (CanvasSurface pixel-mode
  // sensitivity is 0.0025 → factor = exp(-deltaY·0.0025) per event).
  await page.evaluate((deltaY) => {
    const host = document.querySelector('.public-canvas-host');
    const r = host.getBoundingClientRect();
    const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.42) || host;
    target.dispatchEvent(new WheelEvent('wheel', {
      clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.42,
      deltaY, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true,
    }));
  }, ZOOM_DELTA);
  // Drag-pan down into the board's mixed-content middle (notes, arrows,
  // palettes) — the top row is always a full-bleed image mosaic that reads as
  // a photo collage rather than an app canvas.
  if (PAN_Y) {
    const b = await hero.boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height * 0.6;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - PAN_Y, { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForTimeout(2500); // let tiles finish decoding
  const png = await hero.screenshot({ type: 'png' });
  const webp = await sharp(png)
    .resize(W, H, { fit: 'cover', position: 'top' })
    .webp({ quality: 82 })
    .toBuffer();
  const out = resolve(OUT, `${slug}.webp`);
  writeFileSync(out, webp);
  console.log(`${Math.round(webp.length / 1024)}KB → public/landing/${slug}.webp`);
}

await browser.close();
