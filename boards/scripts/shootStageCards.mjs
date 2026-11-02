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
import { STAGE_CARDS } from '../src/lib/landingStageCards.js';

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
  // The boards engine's page boards (scripts/engine/): their cards' ids.
  'hartley-kitchen-mediterranean-limewash-mood-board': {
    p1: '82adc453-ff34-4594-a69c-b883eb1faad1', note: '42e1a82b-4640-4839-b132-8e0ebfb1e56f', c1: '80f39e3b-921e-4b9d-a20a-1654e6a50315', c2: '8b7d5c6b-6a05-49a2-958a-4e6cc694e9dc',
    pal: '89550da3-2c3e-4109-a236-989903fdbea2', l1: '2ca4f674-b314-47b5-ba11-7cd8c1f3dfed', l2: 'd6836059-1e17-4f1c-b04a-c0b41456a8ce',
  },
  'spindrift-coastal-knitwear-campaign-styling-board': {
    p1: 'c7915812-07da-4262-ac86-dd6c896c00c7', note: '65673d43-5067-4c49-ac9b-092604621a4e', c1: 'd5bdab59-c83b-435c-8d2c-29f0bf9818fd', c2: '38510136-9137-4edf-9131-ca51380f16f1',
    pal: '18a79a5e-ee2b-481c-825b-60651b02adf1', l1: '4d7ad981-bed2-4d3f-b5cf-35123118cfdc', l2: 'd6bb0281-58a3-43f2-a97e-5bbb284d7ea4',
  },
  'alkali-flats-desert-road-movie-directors-look-book': {
    note: '94884da7-5469-45d6-980a-deefcf903e1f', c1: 'bbb50e7e-7f02-493f-b4b9-7e48ea7abbc2', pal: 'cea26234-3114-4a53-935a-f8b4c1e789ed', l1: '465001c5-a6b5-4689-b948-7e85b8e8faa7',
    l2: '996f9df2-a0b3-4ec1-8449-1240c866f9c2',
  },
  'calder-reach-flooded-coastal-city-game-environment-board': {
    p1: 'c9c43f5d-c7d3-4a8f-8c92-990463bf53cf', note: '5a84e1f4-6271-4ae8-bd72-15cc0ec228f7', c1: '26517248-1a05-4f91-8fee-efb2c513593b', c2: 'ebb9d1a8-f441-4c0c-91ef-7c88b974f4dc',
    pal: '698d4d53-683a-4ad9-941f-249b773580c3', l1: '19fef030-a7c8-4396-a425-7c57f34dc776', l2: 'd0ce75f9-71fb-4d9c-ab8e-93bfb318d3f3',
  },
  'hard-standing-harbour-town-winter-drama-costume-board': {
    p1: '767af4d2-6222-4455-ac0a-3bc5f213e673', note: '2d75e906-fbad-4184-bcef-df1e68dfa81e', c1: '17bfef2f-3962-4641-9fde-7aa0ccdda0a2', pal: 'dba4a9ed-9baf-4523-a213-052c864d0c48',
    l1: '30ab495b-0c9f-4846-b46a-fb1e9298c668', l2: '784a6213-97e9-42df-bd47-629da0d93dc6',
  },
  'hoarfrost-winter-thriller-cinematography-lookbook': {
    p1: '48005d72-6a84-41e3-8cdb-d0d9ac9b9277', note: '244f87b0-92eb-4caa-b0cb-e78e7cdabdbd', c1: 'ebc3ff7f-d8f9-4abf-a559-d239fcb2615a', c2: '49dd61b0-8f2a-451b-9373-d28ce69cdaa1',
    pal: '1ef2905d-0787-413a-9177-2958d59a22d3', l1: '403a28e6-25d9-43bf-b713-42b4a68ae90c', l2: '05439a96-bb0e-4028-b3b8-c2e60ce792c0',
  },
  'last-length-lido-short-film-pre-production-board': {
    p1: '64147883-587a-4c98-aa9b-ebd7039cf256', note: '6b6c8983-9c3d-4950-a2b5-aca3cfed0bbe', c1: 'd9a1fe48-cc65-4d8b-b4f5-bdf43b831fef', c2: '059f3e37-6623-49bb-bb47-a780394fff4a',
    l1: '201f8c84-cc34-4394-aa43-d1a35994f6db', l2: 'e0df342e-e29f-4876-8610-b2a614e6d357',
  },
  'chalk-line-gravel-bike-commercial-downland-shoot-day-board': {
    p1: 'eaab4ce8-ab4f-444a-a674-948a1e76e535', note: '61057c0f-e654-46d6-8f72-bbd1ae06ff92', c1: '5ca503c0-f48d-48ca-bd21-729dbd201c49', c2: '6d2601e5-63eb-4342-b289-a7973fe25602',
    pal: '4dfcd26c-8999-4461-874f-30ecf9ede6e5', l1: 'efd8efec-ec8e-4fff-ab3e-59ae5be82c51', l2: 'ba7212a3-c6cb-4c37-a924-6d6f94337a7c',
  },
  'hollowmill-coffee-roaster-brand-photography-library': {
    p1: 'cace1dfb-b713-46eb-8788-85510660fee5', note: '048b549e-96fc-4e4d-ab50-3d51489c9341', c1: '9515ce56-ec01-4299-bdd6-0847ae85fb6e', c2: '8148567c-bd5c-4990-8e89-4aa4fba21d45',
    pal: '622027f4-8bd6-46db-ab1e-4c370330ef3b',
  },
  'kelsay-northern-island-novel-world-building-bible': {
    p1: 'd78451da-4f7a-4fc2-b97e-217b06ca3d21', note: '9429e207-1087-4da2-b2ef-1a7c6d7a3192', c1: '230fc31e-96f4-45bc-8b1a-587e4e728537', pal: '81196309-be40-4d21-b61b-12208c0df365',
    l1: 'd0eeb392-eb1b-4d34-8295-51d589d4cb4c', l2: '3fe5ded1-8781-4930-a8cf-d206a9cf7f79',
  },
  'hollow-acre-farmhouse-horror-short-pre-production': {
    p1: '7a380c44-7bff-4ef1-83c2-4da7b2c46d42', note: 'cc11597f-c9fe-486a-b19c-b06210bf01e2', c1: '8ffb632e-4060-4501-b2f7-f6457cfc1078', pal: '36278381-eb41-4d92-b79f-7d7471877020',
    l1: '2ceb9ee8-4d25-4012-a911-8df7ce98cecf', l2: 'a589fbbd-d09b-4bd7-b7d4-5f4438b2ffbc',
  },
  'momiji-hours-kyoto-autumn-travel-photo-series': {
    p1: 'f38c97ae-9ece-4eb6-abd9-77d6ebda1155', note: '5b5cf998-b2e0-41f1-90ae-575f959be81f', c1: '7fcfa011-54d5-409c-a06c-53a9a80a3325', c2: '0659752c-e438-42cd-946e-14684a0ac76c',
    pal: 'ba84bba5-a9d6-48d9-a143-ce9b33199834', l1: '9c732d37-5eea-4996-af09-542f17ba0d4c', l2: 'e8092118-9d71-4a51-8281-51a7f72eb02a',
  },
  'casa-dos-arcos-lisbon-boutique-hotel-mood-board': {
    p1: '56937d59-ead3-4d53-8a49-f7871b590f33', note: '5a13340d-4216-4ca6-ab04-bf3016468cf9', c1: '92121d69-7cdb-49b7-8557-842d7cb0244b', c2: '793a0386-e56a-4add-9399-46a2c254ca43',
    pal: 'a1c84d7c-c06a-4e31-a2fe-c92f6c1bb8fa', l1: 'b9ef0cf7-2b7b-42f4-9da6-2edd632764b6', l2: 'ae6e086a-7f17-46dc-9b6a-87a4a9da51c7',
  },
  'closing-bell-night-market-chase-storyboard': {
    p1: 'c7ac086f-60d5-4fa6-958d-1207e52a3bbe', note: 'e41b1f1d-7a1d-4394-aec8-eb1add49cade', c1: '1f580913-847d-430e-81ef-3ec91b0b283a', l1: '9a02ddb3-389b-4986-a159-2cecfd91dac3',
    l2: '463eeb63-1434-4a00-8f32-7265611e0fda',
  },
  'ardvane-light-lighthouse-keeper-short-drama-treatment': {
    p1: '799dfabe-c2ee-40a1-bf56-0dae83eeff4e', note: 'f4abf91c-f9e7-4c81-b253-419b98c9f443', c1: 'e5a481d0-c3eb-47cd-8eb5-030380835c20', c2: '4ee75f4d-19b0-45b9-be38-75e4d50758c8',
    pal: 'c0e84304-95cd-45b8-bc19-f73690db0b9d', l1: '904ae1c9-10a5-45b5-845e-c311d4360ec7',
  },
};

// CSS width each role is drawn at: about its width on a 1120 px stage.
const ROLE_W = { p1: 150, note: 190, c1: 180, c2: 150, pal: 290, l1: 230, l2: 240 };
const SCALE = 2;

const args = process.argv.slice(2);
const sheetAt = args.indexOf('--sheet');
const sheetDir = sheetAt >= 0 ? args[sheetAt + 1] : null;
const named = args.filter((a, i) => !a.startsWith('--') && (sheetAt < 0 || i !== sheetAt + 1));
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
    // The board's own bundle; a sub-cluster on it is fetched too, with ?b=<its id>.
    if (/public-bundle/.test(r.url()) && !/[?&]b=/.test(r.url()) && r.request().method() !== 'OPTIONS' && r.ok()) {
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

// Boards named on the command line are drawn again; the rest keep their sizes.
const generated = named.length ? { ...STAGE_CARDS } : {};
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
