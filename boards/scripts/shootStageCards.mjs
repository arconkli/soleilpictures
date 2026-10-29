#!/usr/bin/env node
// Draws the cards of each showcase board for the search pages' sun stage
// (components/public/SunStage.jsx), from the board's own published data: its
// real photos, palettes and notes, as the app draws them on a dark board.
//
//   node scripts/shootStageCards.mjs --sheet <dir> [slug ...]
//       every photo, palette and note card of each board onto <dir>/<slug>.jpg,
//       to choose from
//   node scripts/shootStageCards.mjs [slug ...]
//       the cards in PICKS → public/landing/v2/<slug>/<role>.webp, and
//       src/lib/landingStageCards.js (their sizes)
//
// Reads PRODUCTION (/c/<slug> and its photos). Each card is drawn at about the
// size it shows at on a desktop stage and shot at 2×, corners cut, no shadow
// (the page adds it). Photos come only from the published board, never made up.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import * as Y from 'yjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ORIGIN = 'https://clusters.soleilpictures.com';

// { '<slug>': { '<role>': '<card id>' } }. Roles and where they sit:
// lib/landingStage.js. p1/c1/c2 want a tall photo, l1/l2 a wide one; c1 is the
// picture that carries the board's name for image search.
const PICKS = {
  'japandi-living-room': {
    p1: 'img-window', note: 'note-nowhite', c1: 'hero-room', c2: 'img-ceramic',
    pal: 'pal-neutrals', l1: 'img-sofa', l2: 'img-bench',
  },
  'sage-terracotta-wedding': {
    p1: 'img-paper', note: 'note-ratio', c1: 'img-eucalyptus', c2: 'img-rust',
    pal: 'pal-core', l1: 'hero-table', l2: 'img-dresses',
  },
  'world-cup-2026-moodboard': {
    p1: 'kit-pal-mexico', note: 'kit-note-clash', c1: 'kit-img-fans', c2: 'kit-pal-argentina',
    pal: 'kit-pal-brazil', l1: 'kit-img-shirts', l2: 'kit-pal-japan',
  },
  'neon-noir-look-book': {
    p1: 'img-umbrella', note: 'note-twohues', c1: 'hero-neon', c2: 'img-portrait',
    pal: 'pal-cyanmag', l1: 'img-wetstreet', l2: 'img-doorway',
  },
  'film-noir-look-book': {
    p1: 'img-window', note: 'note-mood', c1: 'img-alley', c2: 'img-portrait',
    pal: 'pal-sodium', l1: 'hero-shadow', l2: 'img-reflect',
  },
  'screenplay-beat-sheet': {
    p1: 'img-script', note: 'note-opening', c1: 'hero-typewriter', c2: 'note-midpoint',
    pal: 'pal-temp', l1: 'img-writer', l2: 'img-cinema',
  },
  'short-film-shot-list': {
    p1: 'img-ecu', note: 'note-coverage', c1: 'img-ms', c2: 'img-ws',
    pal: 'pal-exposure', l1: 'img-master', l2: 'hero-camera',
  },
};

// CSS width each role is drawn at: about its width on a 1120 px stage.
const ROLE_W = { p1: 150, note: 190, c1: 180, c2: 150, pal: 290, l1: 230, l2: 240 };
const SCALE = 2;

const args = process.argv.slice(2);
const sheetAt = args.indexOf('--sheet');
const sheetDir = sheetAt >= 0 ? args[sheetAt + 1] : null;
const named = args.filter((a, i) => !a.startsWith('--') && i !== sheetAt + 1);
const slugs = named.length ? named : Object.keys(PICKS);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function ink(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#1a1612' : '#f4efe6';
}

// A note's markup → its bold first line and a short body.
function noteText(html) {
  const s = String(html || '');
  const bold = s.match(/<(?:b|strong|h\d)[^>]*>(.*?)<\/(?:b|strong|h\d)>/i);
  const title = bold ? bold[1].replace(/<[^>]+>/g, '').trim() : '';
  let body = s.replace(bold ? bold[0] : '', ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  if (body.length > 150) body = `${body.slice(0, 150).replace(/\s+\S*$/, '')}…`;
  return { title, body };
}

const CSS = `
html,body{margin:0;background:transparent}
.k{border-radius:9px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}
.k-img{background:#fff}
.k-ph{position:relative;background:#111}
.k-ph img{display:block;width:100%;height:100%;object-fit:cover}
.k-chip{position:absolute;left:7px;top:7px;max-width:calc(100% - 26px);font:500 9px/1.3 ui-monospace,Menlo,monospace;color:#ece8e0;background:rgba(10,10,12,.62);padding:3px 5px;border-radius:3px;letter-spacing:.01em}
.k-t{font-weight:600;font-size:11.5px;line-height:1.15;color:#16130f;padding:8px 9px 9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-pal{background:#fff}
.k-pal .k-sw{display:flex;height:84px}
.k-pal i{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;font:500 8px/1.35 ui-monospace,Menlo,monospace;font-style:normal;padding:0 2px}
.k-pal i b{font:600 9px/1.25 -apple-system,BlinkMacSystemFont,sans-serif;margin-bottom:1px}
.k-note{color:#cdc8bd;padding:12px 13px 13px;border:1px solid rgba(255,255,255,.09);border-radius:9px}
.k-note b{display:block;font-size:12px;line-height:1.2;font-weight:600;color:#f3efe6;margin-bottom:6px}
.k-note p{margin:0;font-size:10.5px;line-height:1.5}
`;

function cardHtml(c, w, photo) {
  if (c.kind === 'image') {
    const ratio = Math.max(0.62, Math.min(1.8, (c.w || 4) / (c.h || 3)));
    return `<div class="k k-img" style="width:${w}px"><div class="k-ph" style="aspect-ratio:${ratio.toFixed(3)}"><img src="${photo}" alt="">${c.caption ? `<span class="k-chip">${esc(c.caption)}</span>` : ''}</div>${c.title ? `<div class="k-t">${esc(c.title)}</div>` : ''}</div>`;
  }
  if (c.kind === 'palette') {
    const sw = (c.swatches || []).slice(0, 5);
    return `<div class="k k-pal" style="width:${w}px">${c.title ? `<div class="k-t">${esc(c.title)}</div>` : ''}<div class="k-sw">${sw.map((s) => `<i style="background:${esc(s.hex)};color:${ink(s.hex)}"><b>${esc(s.name)}</b>${esc(String(s.hex).toUpperCase())}</i>`).join('')}</div></div>`;
  }
  if (c.kind === 'note') {
    const { title, body } = noteText(c.html);
    const bg = c.bgColor || '#18181c';
    const light = ink(bg) !== '#f4efe6';      // a pale note gets dark words
    const tone = light ? 'color:rgba(26,22,18,.8);border-color:rgba(0,0,0,.08)' : '';
    const head = light ? ' style="color:#1a1612"' : '';
    return `<div class="k k-note" style="width:${w}px;background:${esc(bg)};${tone}">${title ? `<b${head}>${esc(title)}</b>` : ''}<p>${esc(body)}</p></div>`;
  }
  return null;
}

const browser = await chromium.launch();

async function loadBoard(slug) {
  const page = await browser.newPage();
  let text = null;
  page.on('response', async (r) => {
    if (/public-bundle/.test(r.url()) && r.request().method() !== 'OPTIONS' && r.ok()) {
      try { text = await r.text(); } catch { /* keep looking */ }
    }
  });
  await page.goto(`${ORIGIN}/c/${slug}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 20 && !text; i++) await page.waitForTimeout(500);
  await page.close();
  if (!text) throw new Error(`${slug}: no public bundle came back`);
  const bundle = JSON.parse(text);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(bundle.snapshot, 'base64'));
  const cards = Object.entries(doc.getMap('cards').toJSON()).map(([id, v]) => ({ ...v, id }));
  return { cards, urls: bundle.image_urls || {} };
}

async function photoData(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const jpg = await sharp(buf).rotate().resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

const shotPage = await browser.newPage({ viewport: { width: 800, height: 900 }, deviceScaleFactor: SCALE });

async function draw(c, w, urls) {
  const photo = c.kind === 'image' ? await photoData(urls[String(c.src).replace(/^r2:/, '')] || urls[c.src]) : '';
  const html = cardHtml(c, w, photo);
  if (!html) return null;
  await shotPage.setContent(`<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>${html}</body>`);
  await shotPage.waitForFunction(() => [...document.images].every((i) => i.complete));
  return shotPage.locator('.k').screenshot({ omitBackground: true });
}

async function contactSheet(slug, shots) {
  const T = 260, L = 34, COLS = 5;
  const rows = Math.ceil(shots.length / COLS) || 1;
  const comps = [];
  for (let i = 0; i < shots.length; i++) {
    const x = (i % COLS) * T, y = Math.floor(i / COLS) * (T + L);
    const tile = await sharp(shots[i].png).resize(T - 12, T - 12, { fit: 'inside' }).png().toBuffer();
    const m = await sharp(tile).metadata();
    comps.push({ input: tile, left: x + Math.round((T - m.width) / 2), top: y + Math.round((T - m.height) / 2) });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${T}" height="${L}"><text x="${T / 2}" y="22" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#fff" text-anchor="middle">${esc(shots[i].id.slice(0, 30))}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y + T });
  }
  const out = resolve(sheetDir, `${slug}.jpg`);
  await sharp({ create: { width: T * COLS, height: rows * (T + L), channels: 3, background: '#16130f' } })
    .composite(comps).jpeg({ quality: 80 }).toFile(out);
  return out;
}

const generated = {};
for (const slug of slugs) {
  const { cards, urls } = await loadBoard(slug);
  const byId = new Map(cards.map((c) => [c.id, c]));
  if (sheetDir) {
    mkdirSync(sheetDir, { recursive: true });
    const shots = [];
    for (const c of cards) {
      if (!['image', 'palette', 'note'].includes(c.kind) || c.sectionHeader || (c.w || 0) > 1000) continue;
      const png = await draw(c, c.kind === 'palette' ? 290 : 200, urls).catch(() => null);
      if (png) shots.push({ id: c.id, png });
    }
    console.log(`${slug}: ${shots.length} cards → ${await contactSheet(slug, shots)}`);
    continue;
  }
  const outDir = resolve(ROOT, 'public/landing/v2', slug);
  mkdirSync(outDir, { recursive: true });
  generated[slug] = {};
  for (const [role, id] of Object.entries(PICKS[slug] || {})) {
    const c = byId.get(id);
    if (!c) { console.log(`${slug}: no card ${id}`); continue; }
    const png = await draw(c, ROLE_W[role], urls);
    if (!png) { console.log(`${slug}: can't draw ${id} (${c.kind})`); continue; }
    const { data, info } = await sharp(png).webp({ quality: 74, alphaQuality: 90 }).toBuffer({ resolveWithObject: true });
    writeFileSync(resolve(outDir, `${role}.webp`), data);
    generated[slug][role] = { w: Math.round(info.width / SCALE), h: Math.round(info.height / SCALE) };
    console.log(`${slug}/${role}.webp  ${id}  ${info.width}x${info.height}  ${(data.length / 1024).toFixed(1)} KB`);
  }
}

if (!sheetDir) {
  const lines = Object.entries(generated).map(([slug, roles]) =>
    `  '${slug}': {\n${Object.entries(roles).map(([r, s]) => `    ${r}: { w: ${s.w}, h: ${s.h} },`).join('\n')}\n  },`);
  writeFileSync(resolve(ROOT, 'src/lib/landingStageCards.js'),
    `// Generated by scripts/shootStageCards.mjs — do not edit. Each board's cut-out\n// cards for the search pages' sun stage, in CSS px (files are 2×).\nexport const STAGE_CARDS = {\n${lines.join('\n')}\n};\n`);
}

await browser.close();
