#!/usr/bin/env node
// Generate 1200×630 Open Graph cards for the SEO landing pages + the site
// default, into public/og/. Each card: dark brand background with a soft gold
// glow, the sun mark, the page H1 in large display type, the subhead, and the
// domain footer. Rendered with Playwright (HTML → screenshot), compressed with
// sharp. Re-run whenever a page's h1/subhead changes.
//
//   node scripts/generate-og.mjs
//
// NOTE: scrapers cache og:images by URL — if a card changes meaningfully,
// bump a ?v= on the injected URL (worker.js injectLanding) or rename.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

import { SEO_LANDING_PAGES, landingOgPath } from '../src/lib/seoLanding.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, 'public/og');
mkdirSync(OUT, { recursive: true });

// The brand mark, inlined as a data URI so the card renders with no network.
const logoB64 = readFileSync(resolve(ROOT, 'public/clusters-logo-dark.png')).toString('base64');
const LOGO = `data:image/png;base64,${logoB64}`;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cardHtml({ h1, subhead }) {
  return `<!doctype html><html><body style="margin:0;width:1200px;height:630px;overflow:hidden;">
  <div style="position:relative;width:1200px;height:630px;background:#0a0908;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <!-- soft gold glow, upper right -->
    <div style="position:absolute;right:-220px;top:-260px;width:760px;height:760px;border-radius:50%;background:radial-gradient(circle,rgba(255,165,0,.16) 0%,rgba(255,165,0,.05) 45%,transparent 70%);"></div>
    <!-- brand row -->
    <div style="position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:18px;">
      <img src="${LOGO}" width="52" height="52" style="display:block;" />
      <span style="font-size:26px;font-weight:700;color:#f5f5f7;letter-spacing:.02em;">Soleil Clusters</span>
    </div>
    <!-- headline + subhead -->
    <div style="position:absolute;left:72px;top:200px;right:88px;">
      <div style="font-size:64px;line-height:1.06;font-weight:800;color:#f5f5f7;letter-spacing:-0.015em;">${esc(h1)}</div>
      <div style="font-size:26px;line-height:1.4;color:#b7b1a6;margin-top:26px;max-width:900px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(subhead)}</div>
    </div>
    <!-- footer -->
    <div style="position:absolute;left:72px;bottom:56px;display:flex;align-items:center;gap:14px;">
      <span style="width:10px;height:10px;border-radius:50%;background:#ffa500;display:inline-block;"></span>
      <span style="font-size:22px;font-weight:600;color:#ffa500;">clusters.soleilpictures.com</span>
    </div>
    <!-- bottom hairline -->
    <div style="position:absolute;left:0;right:0;bottom:0;height:6px;background:linear-gradient(90deg,#ffa500,rgba(255,165,0,.25));"></div>
  </div>
</body></html>`;
}

const cards = [
  ...SEO_LANDING_PAGES.map((s) => ({ file: landingOgPath(s).slice(4), h1: s.h1, subhead: s.subhead })),
  {
    file: 'default.png',
    h1: 'Creative Workspace & Moodboard for Production Teams',
    subhead: 'Organize references, projects, and ideas in one place — and collaborate in real time.',
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const c of cards) {
  await page.setContent(cardHtml(c), { waitUntil: 'networkidle' });
  const shot = await page.screenshot({ type: 'png' });
  const optimized = await sharp(shot).png({ palette: true, compressionLevel: 9, quality: 90 }).toBuffer();
  writeFileSync(resolve(OUT, c.file), optimized);
  console.log(`✓ public/og/${c.file} (${Math.round(optimized.length / 1024)}KB)`);
}
await browser.close();
