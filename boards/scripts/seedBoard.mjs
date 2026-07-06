#!/usr/bin/env node
// Board generator — authors a real, great-looking Clusters board from a recipe
// and publishes it as an indexable /c/<slug> marketing page. Reuses the app's
// exact data model (Y.Doc snapshot + card_index mirror), sources license-safe
// images, composes them into labeled sections, and pushes to the public-board
// pipeline.
//
// Usage:
//   node scripts/seedBoard.mjs scripts/seed-recipes/world-cup-2026-moodboard.json
//   node scripts/seedBoard.mjs <recipe> --dry-run     # no network writes; validate + preview
//   node scripts/seedBoard.mjs <recipe> --no-publish   # build the board but leave it unpublished
//   node scripts/seedBoard.mjs <recipe> --replace      # delete any prior board for this recipe first
//
// Secrets/config come from scripts/.env (git-ignored). See scripts/README.md.

import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeSupabase } from './lib/supa.mjs';
import { makeR2 } from './lib/r2.mjs';
import { fetchCandidates, downloadImage, pingUnsplashDownload, relevanceScore, looksLikePhoto } from './lib/imageSources.mjs';
import { layoutRecipe } from './lib/layoutRecipe.mjs';
import { stampCard, encodeBoardSnapshot, buildCardIndexRows } from './lib/cardEncode.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

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

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Flatten a recipe's sections into a flat card list, inserting a full-width
// display-font header note before each section's cards. Back-compat: a recipe
// with a flat `cards` array is used as-is.
function flattenSections(recipe) {
  if (Array.isArray(recipe.cards)) return recipe.cards;
  const out = [];
  for (const sec of recipe.sections || []) {
    const h = sec.header;
    if (h && h.text) {
      out.push({
        id: h.id || `hdr-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'note',
        sectionHeader: true,
        sub: !!h.sub,
        fontFamily: h.font || 'display',
        fontSize: h.size || (h.hero ? 40 : 28),
        bgColor: h.bg || 'transparent',
        html: `<p><b>${esc(h.text)}</b></p>${h.sub ? `<p>${esc(h.sub)}</p>` : ''}`,
        h: h.hero ? (h.sub ? 132 : 96) : (h.sub ? 104 : 64),
      });
    }
    for (const c of (sec.cards || [])) out.push(c);
  }
  return out;
}

async function insertImageRow(supa, { workspaceId, boardId, cardId, key, w, h, userId }) {
  const { error } = await supa.from('images').insert({
    workspace_id: workspaceId, board_id: boardId, card_id: cardId,
    storage_path: key, width: w || null, height: h || null,
    uploaded_by: userId || null, referenced_in_board_ids: [boardId],
  });
  if (error) throw new Error(`images insert: ${error.message}`);
}

// Fetch + upload images for every image card that carries a `source`. count > 1
// expands into that many distinct image cards (a gallery); a single image keeps
// the recipe's title/caption. Skips tiny candidates for a premium look.
async function resolveImages(cards, ctx) {
  const { r2, supa, keys, workspaceId, boardId, userId, dryRun } = ctx;
  const resolved = [];
  const credits = [];
  const MIN_EDGE = 700;
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

    const provider = card.source.provider || 'unsplash';
    let cands = [];
    try { cands = await fetchCandidates({ ...card.source, count: Math.max(n + 6, 10) }, keys); }
    catch (e) { console.warn(`  ✗ fetch "${card.source.query}": ${e.message}`); resolved.push(card); continue; }
    // Prefer decently-sized images, then rank by query relevance so tangential
    // search hits (a fireboat for "BC Place") lose to on-topic ones. For
    // Wikimedia (specific named subjects) drop zero-relevance hits entirely —
    // better a gap than a wrong image.
    const good = cands.filter((c) => (c.srcW || 0) >= MIN_EDGE && (c.srcH || 0) >= MIN_EDGE * 0.5 && looksLikePhoto(c));
    let pool = good.length ? good : cands.filter(looksLikePhoto);
    const scored = pool.map((c) => ({ c, rel: relevanceScore(card.source.query, c), res: (c.srcW || 0) * (c.srcH || 0) }));
    if (provider === 'wikimedia') {
      // Named subjects must match ≥2 query words (e.g. "estadio"+"azteca"), so a
      // generic "stadium" hit can't masquerade as a specific venue.
      const min = card.source.minRel != null ? card.source.minRel : 2;
      const rel = scored.filter((s) => s.rel >= min);
      pool = rel.length ? rel.sort((a, b) => b.rel - a.rel || b.res - a.res).map((s) => s.c) : [];
    } else {
      pool = scored.sort((a, b) => b.rel - a.rel || b.res - a.res).map((s) => s.c);
    }

    let picked = 0;
    for (let i = 0; i < pool.length && picked < n; i++) {
      const c = pool[i];
      try {
        await new Promise((r) => setTimeout(r, 400)); // polite throttle (Wikimedia rate-limits bursts)
        const { bytes, contentType, ext } = await downloadImage(c.url);
        const key = `${workspaceId}/${randomUUID()}.${ext}`;
        await r2.put(key, bytes, contentType);
        const cardId = n > 1 ? `${card.id}-${picked}` : card.id;
        await insertImageRow(supa, { workspaceId, boardId, cardId, key, w: c.srcW, h: c.srcH, userId });
        if (card.source.provider === 'unsplash') pingUnsplashDownload(c.downloadLocation, keys.unsplash);
        resolved.push({ ...card, id: cardId, source: undefined, src: `r2:${key}`,
          srcW: c.srcW, srcH: c.srcH, alt: card.alt || card.caption || c.alt });
        credits.push(c.credit);
        picked++;
        process.stdout.write(`  ✓ ${card.source.provider}:${card.source.query.slice(0, 32)} (${picked}/${n})\r`);
      } catch (e) { console.warn(`\n  ✗ image: ${e.message}`); }
    }
    if (picked === 0) console.warn(`\n  ⚠ no images resolved for "${card.source.query}"`);
    else process.stdout.write('\n');
  }
  return { resolved, credits };
}

function attributionCard(credits) {
  if (!credits.length) return null;
  const bySource = new Map();
  for (const c of credits) {
    const list = bySource.get(c.source) || new Set();
    list.add(c.name + (c.license ? ` (${c.license})` : ''));
    bySource.set(c.source, list);
  }
  const parts = [...bySource.entries()].map(([src, names]) =>
    `<b>${esc(src)}:</b> ${[...names].slice(0, 14).map(esc).join(', ')}`);
  return {
    id: 'note-credits', kind: 'note', span: 'full', h: 56,
    html: `<p style="font-size:12px;">Image credits — ${parts.join(' · ')}</p>`,
    bgColor: 'transparent', fontSize: 12,
  };
}

// --replace: remove any prior board for this recipe (matched by name in the
// showcase workspace) plus its R2 objects, so iterating stays clean.
async function replaceExisting(supa, r2, { workspaceId, name }) {
  const { data: boards, error } = await supa.from('boards')
    .select('id').eq('workspace_id', workspaceId).eq('name', name);
  if (error) throw new Error(`replace lookup: ${error.message}`);
  if (!boards?.length) { console.log('  (nothing to replace)'); return; }
  for (const b of boards) {
    const { data: imgs } = await supa.from('images').select('storage_path').eq('board_id', b.id);
    for (const im of (imgs || [])) { try { await r2.del(im.storage_path); } catch (_) {} }
    await supa.from('images').delete().eq('board_id', b.id);
    // public_boards cascades on board delete; board delete cascades board_state + card_index.
    await supa.from('boards').delete().eq('id', b.id);
    console.log(`  replaced board ${b.id} (${(imgs || []).length} images removed)`);
  }
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const recipePath = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const noPublish = args.includes('--no-publish');
  const replace = args.includes('--replace');
  if (!recipePath) throw new Error('Usage: node scripts/seedBoard.mjs <recipe.json> [--dry-run] [--no-publish] [--replace]');

  const recipe = JSON.parse(readFileSync(resolve(process.cwd(), recipePath), 'utf8'));
  const slug = recipe.slug;
  if (!SLUG_RE.test(slug) || slug.length > 80 || RESERVED.has(slug)) throw new Error(`Invalid or reserved slug: "${slug}"`);
  const seo = recipe.seo || {};
  for (const f of ['title', 'description', 'body', 'keyword']) if (!seo[f]) throw new Error(`recipe.seo.${f} is required`);

  const cards = flattenSections(recipe);
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

  if (replace && !dryRun) await replaceExisting(supa, r2, { workspaceId, name: recipe.name });

  // 1) Create the board row (with mood) so images can reference board_id.
  const boardId = dryRun ? 'DRYRUN-BOARD' : randomUUID();
  if (!dryRun) {
    const { error } = await supa.from('boards').insert({
      id: boardId, workspace_id: workspaceId, parent_board_id: parentBoardId,
      name: recipe.name, view: 'canvas', created_by: userId,
      bg_color: recipe.bgColor || null, cover: recipe.cover || null,
    });
    if (error) throw new Error(`boards insert: ${error.message}`);
    console.log(`  board ${boardId}`);
  }

  // 2) Resolve + upload images.
  const { resolved, credits } = await resolveImages(cards, { r2, supa, keys, workspaceId, boardId, userId, dryRun });
  const credit = attributionCard(credits.length ? credits : (dryRun ? [{ source: 'Unsplash', name: 'Sample' }] : []));
  const allCards = credit ? [...resolved, credit] : resolved;

  // 3) Layout + stamp. Strip helper-only fields so the snapshot stays clean.
  const nowIso = new Date().toISOString();
  const laid = layoutRecipe(allCards).map((c, i) => {
    const { source, srcW, srcH, span, sectionHeader, sub, ...clean } = c;
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
      target_keyword: seo.keyword, og_image_key: heroKey, bg_color: recipe.bgColor || null, published: !noPublish }, null, 2));
    console.log('\n✅ recipe valid; re-run without --dry-run (with .env configured) to publish.');
    return;
  }

  // 5) Persist snapshot + mirror.
  {
    const { error } = await supa.from('board_state').upsert({ board_id: boardId, doc: b64, updated_at: nowIso }, { onConflict: 'board_id' });
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
