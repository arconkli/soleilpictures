#!/usr/bin/env node
// Board generator — authors a real, great-looking Clusters board from a recipe
// and publishes it as an indexable /c/<slug> marketing page. Reuses the app's
// exact data model (Y.Doc snapshot + card_index mirror), sources license-safe
// images, and pushes straight to the public-board pipeline.
//
// Usage:
//   node scripts/seedBoard.mjs scripts/seed-recipes/world-cup-2026-moodboard.json
//   node scripts/seedBoard.mjs <recipe> --dry-run     # no network writes; validate + preview
//   node scripts/seedBoard.mjs <recipe> --no-publish   # build the board but leave it unpublished
//
// Secrets/config come from scripts/.env (git-ignored). See scripts/README.md.

import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeSupabase } from './lib/supa.mjs';
import { makeR2 } from './lib/r2.mjs';
import { fetchCandidates, downloadImage, pingUnsplashDownload } from './lib/imageSources.mjs';
import { layoutRecipe } from './lib/layoutRecipe.mjs';
import { stampCard, encodeBoardSnapshot, buildCardIndexRows } from './lib/cardEncode.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Tiny .env loader (no dotenv dep) ────────────────────────────────────────
function loadEnv() {
  const p = resolve(HERE, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED = new Set(['c', 'explore', 'share', 'pricing', 'legal', 'api', 'assets', 'admin',
  'robots', 'sitemap', 'app', 'auth', 'login', 'signup', 'board', 'boards', 'favicon', '_headers',
  'tools', 'vs', 'use-cases']);

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (set it in scripts/.env)`);
  return v;
}

async function insertImageRow(supa, { workspaceId, boardId, cardId, key, w, h, userId }) {
  const { error } = await supa.from('images').insert({
    workspace_id: workspaceId, board_id: boardId, card_id: cardId,
    storage_path: key, width: w || null, height: h || null,
    uploaded_by: userId || null, referenced_in_board_ids: [boardId],
  });
  if (error) throw new Error(`images insert: ${error.message}`);
}

// Fetch + upload images for every image card that carries a `source`. An image
// card with source.count > 1 expands into that many distinct image cards.
async function resolveImages(cards, ctx) {
  const { r2, supa, keys, workspaceId, boardId, userId, dryRun } = ctx;
  const resolved = [];
  const credits = [];
  for (const card of cards) {
    if (card.kind !== 'image' || !card.source) { resolved.push(card); continue; }
    const n = Math.max(1, card.source.count || 1);

    if (dryRun) {
      for (let i = 0; i < n; i++) {
        resolved.push({ ...card, id: n > 1 ? `${card.id}-${i}` : card.id, source: undefined,
          src: 'r2:DRYRUN/placeholder.jpg', srcW: 1600, srcH: 1067, alt: card.alt || card.source.query });
      }
      continue;
    }

    let cands = [];
    try { cands = await fetchCandidates(card.source, keys); }
    catch (e) { console.warn(`  ✗ fetch "${card.source.query}": ${e.message}`); resolved.push(card); continue; }

    let picked = 0;
    for (let i = 0; i < cands.length && picked < n; i++) {
      const c = cands[i];
      try {
        const { bytes, contentType, ext } = await downloadImage(c.url);
        const key = `${workspaceId}/${randomUUID()}.${ext}`;
        await r2.put(key, bytes, contentType);
        const cardId = n > 1 ? `${card.id}-${picked}` : card.id;
        await insertImageRow(supa, { workspaceId, boardId, cardId, key, w: c.srcW, h: c.srcH, userId });
        if (card.source.provider === 'unsplash') pingUnsplashDownload(c.downloadLocation, keys.unsplash);
        resolved.push({ ...card, id: cardId, source: undefined, src: `r2:${key}`,
          srcW: c.srcW, srcH: c.srcH, alt: card.alt || c.alt });
        credits.push(c.credit);
        picked++;
        process.stdout.write(`  ✓ ${card.source.provider}:${card.source.query} (${picked}/${n})\r`);
      } catch (e) { console.warn(`\n  ✗ image: ${e.message}`); }
    }
    if (picked === 0) console.warn(`\n  ⚠ no images resolved for "${card.source.query}"`);
    else process.stdout.write('\n');
  }
  return { resolved, credits };
}

// Aggregate, dedupe, and format image credits into an attribution note card.
function attributionCard(credits) {
  if (!credits.length) return null;
  const bySource = new Map();
  for (const c of credits) {
    const list = bySource.get(c.source) || new Set();
    list.add(c.name + (c.license ? ` (${c.license})` : ''));
    bySource.set(c.source, list);
  }
  const parts = [...bySource.entries()].map(([src, names]) =>
    `<b>${src}:</b> ${[...names].slice(0, 12).join(', ')}`);
  return {
    id: 'note-credits', kind: 'note', span: 'full',
    html: `<p style="font-size:12px;">Image credits — ${parts.join(' · ')}</p>`,
    bgColor: 'transparent',
  };
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const recipePath = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const noPublish = args.includes('--no-publish');
  if (!recipePath) throw new Error('Usage: node scripts/seedBoard.mjs <recipe.json> [--dry-run] [--no-publish]');

  const recipe = JSON.parse(readFileSync(resolve(process.cwd(), recipePath), 'utf8'));
  const slug = recipe.slug;
  if (!SLUG_RE.test(slug) || slug.length > 80 || RESERVED.has(slug)) {
    throw new Error(`Invalid or reserved slug: "${slug}"`);
  }
  const seo = recipe.seo || {};
  for (const f of ['title', 'description', 'body', 'keyword']) {
    if (!seo[f]) throw new Error(`recipe.seo.${f} is required`);
  }

  console.log(`\n▶ ${dryRun ? '[DRY RUN] ' : ''}Seeding "${recipe.name}" → /c/${slug}`);

  const supa = dryRun ? null : makeSupabase({ url: need('SUPABASE_URL'), serviceRoleKey: need('SUPABASE_SERVICE_ROLE_KEY') });
  const r2 = dryRun ? null : makeR2({
    accountId: need('R2_ACCOUNT_ID'), bucket: need('R2_BUCKET'),
    accessKeyId: need('R2_ACCESS_KEY_ID'), secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
  });
  const keys = { unsplash: process.env.UNSPLASH_ACCESS_KEY, pexels: process.env.PEXELS_API_KEY };
  const workspaceId = dryRun ? 'DRYRUN-WS' : need('SEED_WORKSPACE_ID');
  const userId = dryRun ? null : (process.env.SEED_USER_ID || null);
  const parentBoardId = process.env.SEED_PARENT_BOARD_ID || null;

  // 1) Create the board row (so images can reference board_id).
  const boardId = dryRun ? 'DRYRUN-BOARD' : randomUUID();
  if (!dryRun) {
    const { error } = await supa.from('boards').insert({
      id: boardId, workspace_id: workspaceId, parent_board_id: parentBoardId,
      name: recipe.name, view: 'canvas', created_by: userId,
    });
    if (error) throw new Error(`boards insert: ${error.message}`);
    console.log(`  board ${boardId}`);
  }

  // 2) Resolve + upload images.
  const { resolved, credits } = await resolveImages(recipe.cards, { r2, supa, keys, workspaceId, boardId, userId, dryRun });
  const credit = attributionCard(credits.length ? credits : (dryRun ? [{ source: 'Unsplash', name: 'Sample' }] : []));
  const allCards = credit ? [...resolved, credit] : resolved;

  // 3) Layout + stamp. Strip helper-only fields so the snapshot stays clean.
  const nowIso = new Date().toISOString();
  const laid = layoutRecipe(allCards).map((c, i) => {
    const { source, srcW, srcH, span, ...clean } = c;
    return stampCard(clean, i, nowIso);
  });
  const imageCount = laid.filter((c) => c.kind === 'image').length;
  console.log(`  ${laid.length} cards (${imageCount} images)`);
  if (imageCount < 3 && !noPublish) console.warn('  ⚠ fewer than 3 images — public boards should have ≥3');

  // 4) Encode snapshot + card_index rows.
  const b64 = encodeBoardSnapshot(laid);
  const rows = buildCardIndexRows({ workspaceId, boardId, cards: laid });
  const heroKey = (laid.find((c) => c.kind === 'image')?.src || '').replace(/^r2:/, '') || null;
  console.log(`  snapshot ${Math.round(Buffer.from(b64, 'base64').length / 1024)}KB · card_index ${rows.length} rows`);

  if (dryRun) {
    console.log('\n[DRY RUN] would publish public_boards row:');
    console.log(JSON.stringify({ board_id: boardId, slug, seo_title: seo.title, seo_description: seo.description,
      target_keyword: seo.keyword, og_image_key: heroKey, published: !noPublish }, null, 2));
    console.log('\n✅ recipe valid; re-run without --dry-run (with .env configured) to publish.');
    return;
  }

  // 5) Persist snapshot + mirror.
  {
    const { error } = await supa.from('board_state').upsert(
      { board_id: boardId, doc: b64, updated_at: nowIso }, { onConflict: 'board_id' });
    if (error) throw new Error(`board_state upsert: ${error.message}`);
  }
  {
    const { error } = await supa.from('card_index').upsert(rows, { onConflict: 'board_id,card_id' });
    if (error) throw new Error(`card_index upsert: ${error.message}`);
  }

  // 6) Publish to /c/<slug>.
  if (!noPublish) {
    const { error } = await supa.from('public_boards').upsert({
      board_id: boardId, slug,
      seo_title: seo.title, seo_description: seo.description, seo_body: seo.body,
      target_keyword: seo.keyword, og_image_key: heroKey,
      priority: recipe.priority || 0, published_at: nowIso,
      review_status: 'approved', published_by: 'admin', created_by: userId, updated_at: nowIso,
    }, { onConflict: 'board_id' });
    if (error) throw new Error(`public_boards upsert: ${error.message}`);
    await pingIndexNow(slug);
    console.log(`\n✅ LIVE: ${originOf()}/c/${slug}`);
  } else {
    console.log(`\n✅ Board built (unpublished): ${boardId}`);
  }
}

function originOf() { return process.env.SITE_ORIGIN || 'https://clusters.soleilpictures.com'; }

async function pingIndexNow(slug) {
  const key = process.env.INDEXNOW_KEY;
  if (!key) return;
  const host = new URL(originOf()).host;
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host, key, keyLocation: `${originOf()}/${key}.txt`, urlList: [`${originOf()}/c/${slug}`] }),
    });
  } catch (_) {}
}

main().catch((e) => { console.error('\n✗', e.message); process.exit(1); });
