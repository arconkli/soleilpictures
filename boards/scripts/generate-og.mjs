#!/usr/bin/env node
// Generate 1200×630 Open Graph cards for the SEO landing pages + the site
// default, into public/og/. Each card: dark brand background with a soft gold
// glow, the sun mark, the page H1 in large display type, the subhead, and the
// domain footer. Rendered with Playwright (HTML → screenshot), compressed with
// sharp. Re-run whenever a page's h1/subhead changes.
//
//   node scripts/generate-og.mjs                 every card
//   node scripts/generate-og.mjs home-v2.png ...  just these files
//
// NOTE: scrapers cache og:images by URL — if a card changes meaningfully,
// bump a ?v= on the injected URL (worker.js injectLanding) or rename.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

import { SEO_LANDING_PAGES, landingOgPath } from '../src/lib/seoLanding.js';
import { SEO_LISTICLE_PAGES } from '../src/lib/seoListicles.js';
import { DOCS_SECTIONS } from '../src/lib/docsiteIndex.js';
import { TEMPLATE_CATEGORIES } from '../src/lib/templateCards.js';
import { OG_STAGE, STAGE_DIR, ogStageSlug } from '../src/lib/landingStage.js';
import { STAGE_CARDS } from '../src/lib/landingStageCards.js';
import { sunMarkSvg, MARK_MID } from '../src/lib/sunMark.js';

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

// ── The sun look (2026-10-29) ────────────────────────────────────────────────
// The search pages that show a real board in the sun stage get the same look
// in their link preview: the words on the left, the Clusters mark on the right
// holding cards cut from the page's own board (public/landing/v2, made by
// scripts/shootStageCards.mjs). Which pages, and where the cards sit, come from
// lib/landingStage.js, which worker.js versions the og:image URL from too.
const DISPLAY = "brandon-grotesque, Futura, 'Avenir Next', 'Segoe UI', sans-serif";
const webp = (rel) => `data:image/webp;base64,${readFileSync(resolve(ROOT, 'public', rel.replace(/^\//, ''))).toString('base64')}`;

const jpeg = (file) => `data:image/jpeg;base64,${readFileSync(resolve(HERE, 'og-art', file)).toString('base64')}`;
const SHADOW = 'drop-shadow(0 14px 22px rgba(0,0,0,.55)) drop-shadow(0 2px 4px rgba(0,0,0,.4))';

// cards: [{ slug, role, cx, cy, rot, maxW }] in the mark's 2048-unit box, or
// { art, cx, cy, rot, maxW }: a picture of our own from scripts/og-art, drawn
// as an image card on the board (a thin white frame, rounded corners).
function stageHtml({ eyebrow, h1, subhead, cards }) {
  const [mx, my, m] = OG_STAGE.mark;
  const s = m / 2048;
  const [rx, ry] = MARK_MID;
  const glow = m * 1.9;
  const placed = cards.map(({ slug, role, art, cx, cy, rot, maxW }) => {
    if (art) {
      return `<div style="position:absolute;left:${(mx + cx * s).toFixed(1)}px;top:${(my + cy * s).toFixed(1)}px;width:${(maxW * s).toFixed(1)}px;padding:4px;box-sizing:border-box;background:#fff;border-radius:9px;transform:translate(-50%,-50%) rotate(${rot}deg);filter:${SHADOW};z-index:3"><img src="${jpeg(art)}" style="display:block;width:100%;border-radius:6px" /></div>`;
    }
    const size = STAGE_CARDS[slug]?.[role];
    if (!size) return '';
    const w = Math.min(size.w * OG_STAGE.k, maxW) * s;
    return `<img src="${webp(`${STAGE_DIR}/${slug}/${role}.webp`)}" style="position:absolute;left:${(mx + cx * s).toFixed(1)}px;top:${(my + cy * s).toFixed(1)}px;width:${w.toFixed(1)}px;transform:translate(-50%,-50%) rotate(${rot}deg);filter:${SHADOW};z-index:3" />`;
  }).join('');
  return `<!doctype html><html><head><link rel="stylesheet" href="https://use.typekit.net/qtd2rwk.css" /></head>
<body style="margin:0;width:1200px;height:630px;overflow:hidden;">
  <div style="position:relative;width:1200px;height:630px;overflow:hidden;background:radial-gradient(ellipse 62% 70% at 70% 50%,#1d130a,#0a0809 74%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f7;">
    <div style="position:absolute;left:${mx + rx * s - glow / 2}px;top:${my + ry * s - glow / 2}px;width:${glow}px;height:${glow}px;border-radius:50%;background:radial-gradient(closest-side,rgba(255,160,40,.20),rgba(255,140,20,.06) 55%,transparent);"></div>
    <svg viewBox="0 0 2048 2048" width="${m}" height="${m}" style="position:absolute;left:${mx}px;top:${my}px;z-index:2;filter:drop-shadow(0 14px 30px rgba(0,0,0,.55));">${sunMarkSvg({ id: 'og' })}</svg>
    ${placed}
    <div id="tx" style="position:absolute;left:72px;top:40px;bottom:110px;width:540px;display:flex;flex-direction:column;justify-content:center;z-index:5;">
      ${eyebrow ? `<div style="font:700 14px/1 ${DISPLAY};letter-spacing:.22em;text-transform:uppercase;color:#ffa500;margin:0 0 20px;">${esc(eyebrow)}</div>` : ''}
      <div id="h1" style="font:700 62px/1.02 ${DISPLAY};letter-spacing:.005em;text-wrap:balance;">${esc(h1)}</div>
      ${subhead ? `<div style="font-size:22px;line-height:1.4;color:#d3ccc0;margin-top:22px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">${esc(subhead)}</div>` : ''}
    </div>
    <div style="position:absolute;left:72px;bottom:48px;display:flex;align-items:center;gap:12px;z-index:5;">
      <img src="${LOGO}" width="32" height="32" style="display:block;" />
      <span style="font:700 21px/1 ${DISPLAY};letter-spacing:.18em;">CLUSTERS</span>
      <span style="font-size:16px;color:#bdb6aa;margin-left:12px;">clusters.soleilpictures.com</span>
    </div>
  </div>
</body></html>`;
}

// Shrink the headline until the words fit their column (long ranked-list
// titles run to three lines at full size).
async function fitHeadline(page) {
  await page.evaluate(() => {
    const tx = document.getElementById('tx');
    const h1 = document.getElementById('h1');
    if (!tx || !h1) return;
    let px = 62;
    while (px > 40 && (tx.scrollHeight > tx.clientHeight || h1.getBoundingClientRect().height > px * 1.02 * 3 + 2)) {
      px -= 2;
      h1.style.fontSize = `${px}px`;
    }
  });
}

const stageCardsFor = (slug) => OG_STAGE.cards.map(([role, cx, cy, rot, maxW]) => ({ slug, role, cx, cy, rot, maxW }));
const searchCard = (s) => {
  const file = landingOgPath(s).slice(4);
  const slug = ogStageSlug(s);
  return slug
    ? { file, html: stageHtml({ eyebrow: s.eyebrow, h1: s.h1, subhead: s.subhead, cards: stageCardsFor(slug) }) }
    : { file, h1: s.h1, subhead: s.subhead };
};

// The homepage's card (index.html's og:image, so also every page the Worker
// doesn't give its own): Soleil Pictures' own work, the posters for YAHWEH,
// Lost Time and Deep Dive (soleilpictures.com/projects) and a costume sketch
// from our own Yahweh board, pinned to the board (owner 10-29: "images from
// OUR boards and pictures from soleil pictures"). Only work Soleil made: the
// boards' other pictures are other films' stills and real people.
const HOME_CARDS = [
  { art: 'yahweh-costume.jpg', cx: 1250, cy: 1500, rot: -3, maxW: 600 },
  { art: 'deep-dive.jpg', cx: 1690, cy: 1180, rot: 7, maxW: 430 },
  { art: 'yahweh.jpg', cx: 1370, cy: 770, rot: 4, maxW: 470 },
  { art: 'lost-time.jpg', cx: 880, cy: 960, rot: -6, maxW: 520 },
];

const cards = [
  ...SEO_LANDING_PAGES.map(searchCard),
  ...SEO_LISTICLE_PAGES.map(searchCard),
  {
    file: 'home-v2.png',
    html: stageHtml({
      h1: 'Your references, clustered.',
      subhead: 'Pictures, video, script pages and any file, on one canvas you can share.',
      cards: HOME_CARDS,
    }),
  },
  // Documentation: ONE card per section, not per page. Fifty near-identical
  // cards would be churn in public/og/ for a difference nobody can see in a
  // link preview, and the section is the useful unit of "what is this about".
  // worker.js injectDocs derives the filename from page.section — keep in step.
  ...DOCS_SECTIONS.map((s) => ({
    file: `docs-${s.id}.png`,
    h1: `${s.label} — documentation`,
    subhead: s.blurb,
  })),
  // The template store: ONE card per CATEGORY, not per template. Same call
  // injectDocs makes for docs sections, and for the same reason — fifteen
  // near-identical cards would be churn in public/og/ for a difference nobody
  // can see in a link preview. worker.js injectTemplate derives the filename
  // from item.category; keep the two in step.
  ...TEMPLATE_CATEGORIES.map((c) => ({
    file: `template-${c.id}.png`,
    h1: `${c.label} templates`,
    subhead: c.blurb,
  })),
  // The changelog gets ONE card, not one per entry. worker.js injectChangelog
  // busts it with ?v=<newest entry date>, so the preview refreshes on a reshare
  // without the file itself having to change.
  {
    file: 'changelog.png',
    h1: 'Changelog',
    subhead: 'Every user-visible change to Soleil Clusters, newest first, with dates. Updated weekly.',
  },
  {
    file: 'default.png',
    h1: 'Creative Workspace & Moodboard for Production Teams',
    subhead: 'Organize references, projects, and ideas in one place — and collaborate in real time.',
  },
];

const only = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
// The display face's kit only serves our own site.
await page.setExtraHTTPHeaders({ Referer: 'https://clusters.soleilpictures.com/' });
for (const c of cards) {
  if (only.length && !only.includes(c.file)) continue;
  await page.setContent(c.html || cardHtml(c), { waitUntil: 'networkidle' });
  if (c.html) {
    await page.evaluate(() => document.fonts.ready);
    await fitHeadline(page);
  }
  const shot = await page.screenshot({ type: 'png' });
  const optimized = await sharp(shot).png({ palette: true, compressionLevel: 9, quality: 90 }).toBuffer();
  writeFileSync(resolve(OUT, c.file), optimized);
  console.log(`✓ public/og/${c.file} (${Math.round(optimized.length / 1024)}KB)`);
}
await browser.close();
