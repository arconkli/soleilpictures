#!/usr/bin/env node
// Board generator — authors a real, great-looking Clusters board from a recipe
// and publishes it as an indexable /c/<slug> marketing page. Composes images
// into labeled sections, showcases arrows (connectors) + grid mosaics, and
// reuses the app's exact data model (Y.Doc snapshot + card_index mirror).
//
// Usage:
//   node scripts/seedBoard.mjs <recipe.json> [--dry-run] [--no-publish] [--replace]
//
// Secrets/config come from scripts/.env (git-ignored). See scripts/README.md.

import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeSupabase } from './lib/supa.mjs';
import { makeR2 } from './lib/r2.mjs';
import { fetchCandidates, downloadImage, pingUnsplashDownload, relevanceScore, looksLikePhoto, fetchPexelsVideo, downloadVideo } from './lib/imageSources.mjs';
import { layoutRecipe } from './lib/layoutRecipe.mjs';
import { stampCard, encodeBoardSnapshot, buildCardIndexRows, buildGridStructure } from './lib/cardEncode.mjs';

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
const MIN_EDGE = 700;

function need(name) { const v = process.env[name]; if (!v) throw new Error(`Missing env ${name} (set it in scripts/.env)`); return v; }
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Flatten a recipe's sections into a flat card list, inserting a full-width
// display-font header before each section's cards. (Flat `cards` used as-is.)
function flattenSections(recipe) {
  if (Array.isArray(recipe.cards)) return recipe.cards;
  const out = [];
  for (const sec of recipe.sections || []) {
    const h = sec.header;
    if (h && h.text) {
      out.push({
        id: h.id || `hdr-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'note', sectionHeader: true, sub: h.sub || null,
        fontFamily: h.font || 'display', fontSize: h.size || (h.hero ? 40 : 28),
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

// Fetch → curate → download → upload up to `count` images for one query.
// Returns [{ key, srcW, srcH, alt, credit }] (does NOT write the images row —
// the caller does, with the right card_id). Handles --dry-run with placeholders.
async function resolveImageQuery(source, ctx, count) {
  const { r2, keys, workspaceId, dryRun } = ctx;
  if (dryRun) {
    return Array.from({ length: count }, () => ({ key: 'DRYRUN/ph.jpg', srcW: 1600, srcH: 1067, alt: source.query, credit: { source: 'Unsplash', name: 'Sample' } }));
  }
  const provider = source.provider || 'unsplash';
  let cands = [];
  try { cands = await fetchCandidates({ ...source, count: Math.max(count + 6, 10) }, keys); }
  catch (e) { console.warn(`  ✗ fetch "${source.query}": ${e.message}`); return []; }
  const good = cands.filter((c) => (c.srcW || 0) >= MIN_EDGE && (c.srcH || 0) >= MIN_EDGE * 0.5 && looksLikePhoto(c));
  let pool = good.length ? good : cands.filter(looksLikePhoto);
  const scored = pool.map((c) => ({ c, rel: relevanceScore(source.query, c), res: (c.srcW || 0) * (c.srcH || 0) }));
  if (provider === 'wikimedia') {
    const min = source.minRel != null ? source.minRel : 2;
    const rel = scored.filter((s) => s.rel >= min);
    pool = rel.length ? rel.sort((a, b) => b.rel - a.rel || b.res - a.res).map((s) => s.c) : [];
  } else {
    pool = scored.sort((a, b) => b.rel - a.rel || b.res - a.res).map((s) => s.c);
  }
  const out = [];
  for (let i = 0; i < pool.length && out.length < count; i++) {
    const c = pool[i];
    try {
      await new Promise((r) => setTimeout(r, 400)); // polite throttle
      const { bytes, contentType, ext } = await downloadImage(c.url);
      const key = `${workspaceId}/${randomUUID()}.${ext}`;
      await r2.put(key, bytes, contentType);
      if (provider === 'unsplash') pingUnsplashDownload(c.downloadLocation, keys.unsplash);
      out.push({ key, srcW: c.srcW, srcH: c.srcH, alt: c.alt, credit: c.credit });
      process.stdout.write(`  ✓ ${provider}:${source.query.slice(0, 30)} (${out.length}/${count})\r`);
    } catch (e) { console.warn(`\n  ✗ image: ${e.message}`); }
  }
  if (out.length) process.stdout.write('\n');
  else console.warn(`\n  ⚠ no images for "${source.query}"`);
  return out;
}

// Turn recipe cards into final cards: image cards (single or gallery) get real
// R2 srcs; grid cards fetch a cell image each and build a nested grid; other
// cards pass through. Collects image credits.
async function resolveCards(cards, ctx) {
  const { supa, workspaceId, boardId, userId, dryRun } = ctx;
  const resolved = [];
  const credits = [];
  const addRow = async (cardId, im) => { if (!dryRun) await insertImageRow(supa, { workspaceId, boardId, cardId, key: im.key, w: im.srcW, h: im.srcH, userId }); };

  for (const card of cards) {
    // Grid (showcase): image mosaics via `images`, or mixed image/text cells via
    // `cellSpecs` (row-major: {image:{provider,query,alt?}} | {text:'<html>'}).
    // Optional `seq:{pattern,format}` registers a gridSequences entry so text
    // cells can carry [#]/[A] auto-number tags.
    if (card.kind === 'grid' && (Array.isArray(card.images) || Array.isArray(card.cellSpecs))) {
      const specs = Array.isArray(card.cellSpecs)
        ? card.cellSpecs
        : card.images.map((s) => ({ image: s.source || s }));
      const contents = [];
      for (const spec of specs) {
        if (spec.text != null) {
          contents.push({ type: 'text', html: spec.text });
          continue;
        }
        if (!spec.image) { contents.push({ type: 'empty' }); continue; }
        const [im] = await resolveImageQuery(spec.image, ctx, 1);
        if (!im) { contents.push({ type: 'empty' }); continue; }
        await addRow(card.id, im);
        contents.push({ type: 'image', src: `r2:${im.key}`, fit: 'cover', alt: spec.image.alt || im.alt });
        credits.push(im.credit);
      }
      const filled = contents.filter((c) => c.type !== 'empty').length;
      if (filled < 2) { console.warn(`  ⚠ grid ${card.id}: too few cells resolved, skipping`); continue; }
      const cols = card.cols || Math.ceil(Math.sqrt(contents.length));
      const rows = card.rows || Math.ceil(contents.length / cols);
      const { layout, cells } = buildGridStructure(contents, rows, cols);
      const next = { ...card, images: undefined, cellSpecs: undefined, kind: 'grid', layout, cells,
                     rows, cols, gridRows: rows, gridCols: cols,
                     span: card.span || 'full', title: card.title || '' };
      if (card.seq) {
        const seqId = `seq-${card.id}`;
        ctx.gridSequences.push({ id: seqId, name: card.seq.name || card.title || 'Sequence',
                                 pattern: card.seq.pattern || 'z', format: card.seq.format || { style: 'num' } });
        next.seqId = seqId;
        next.seqFormat = card.seq.format || { style: 'num' }; // meta/article tag resolution
        next.seq = undefined;
      }
      resolved.push(next);
      continue;
    }
    // Ambient video loop (Pexels Videos): mp4 + poster both land in R2 with
    // images rows so get_public_board_bundle presigns them for the public page.
    if (card.kind === 'video' && card.source) {
      if (dryRun) { resolved.push({ ...card, source: undefined, src: 'r2:DRYRUN/v.mp4', poster: 'r2:DRYRUN/p.jpg', srcW: 1280, srcH: 720 }); continue; }
      try {
        const v = await fetchPexelsVideo(card.source.query, { key: ctx.keys.pexels });
        if (!v) { console.warn(`  ⚠ video ${card.id}: no candidate for "${card.source.query}", skipping`); continue; }
        const vid = await downloadVideo(v.url);
        const vKey = `${workspaceId}/${randomUUID()}.mp4`;
        await ctx.r2.put(vKey, vid.bytes, vid.contentType);
        let pKey = null;
        if (v.posterUrl) {
          const p = await downloadImage(v.posterUrl);
          pKey = `${workspaceId}/${randomUUID()}.${p.ext}`;
          await ctx.r2.put(pKey, p.bytes, p.contentType);
        }
        await addRow(card.id, { key: vKey, srcW: v.w, srcH: v.h });
        if (pKey) await addRow(card.id, { key: pKey, srcW: v.w, srcH: v.h });
        credits.push(v.credit);
        console.log(`  ✓ video:${card.source.query.slice(0, 30)} (${v.duration}s, ${v.h}p)`);
        resolved.push({ ...card, source: undefined, src: `r2:${vKey}`, poster: pKey ? `r2:${pKey}` : null, srcW: v.w, srcH: v.h });
      } catch (e) { console.warn(`  ✗ video ${card.id}: ${e.message}`); }
      continue;
    }
    // Regular image card(s).
    if (card.kind === 'image' && card.source) {
      const n = Math.max(1, card.source.count || 1);
      const imgs = await resolveImageQuery(card.source, ctx, n);
      for (let i = 0; i < imgs.length; i++) {
        const im = imgs[i];
        const cardId = imgs.length > 1 || n > 1 ? `${card.id}-${i}` : card.id;
        await addRow(cardId, im);
        resolved.push({ ...card, id: cardId, source: undefined, src: `r2:${im.key}`, srcW: im.srcW, srcH: im.srcH, alt: card.alt || card.caption || im.alt });
        credits.push(im.credit);
      }
      continue;
    }
    resolved.push(card);
  }
  return { resolved, credits };
}

function attributionCard(credits) {
  const real = credits.filter(Boolean);
  if (!real.length) return null;
  const bySource = new Map();
  for (const c of real) {
    const list = bySource.get(c.source) || new Set();
    list.add(c.name + (c.license ? ` (${c.license})` : ''));
    bySource.set(c.source, list);
  }
  const parts = [...bySource.entries()].map(([src, names]) => `<b>${esc(src)}:</b> ${[...names].slice(0, 14).map(esc).join(', ')}`);
  return { id: 'note-credits', kind: 'note', span: 'full', h: 56, html: `<p style="font-size:12px;">Image credits — ${parts.join(' · ')}</p>`, bgColor: 'transparent', fontSize: 12 };
}

// Resolve → layout → strip → stamp → encode one board's content. Shared by the
// parent board and recipe.children. The strip is kind-aware: `rows`/`cols` are
// grid TEMPLATE inputs but real data on schedule cards (stripping them there was
// the blank-schedule bug); sectionHeader/sub stay on the card — buildCardIndexRows
// mirrors them into card_index.meta for the page RPC's section grouping.
async function composeBoard(cardList, recipeLike, ctx) {
  ctx.gridSequences = [];
  const { resolved, credits } = await resolveCards(cardList, ctx);
  const credit = attributionCard(credits);
  const allCards = credit ? [...resolved, credit] : resolved;

  const nowIso = new Date().toISOString();
  const laid = layoutRecipe(allCards).map((c, i) => {
    const { source, srcW, srcH, span, images, cellSpecs, feature, child, ...rest } = c;
    let clean = rest;
    if (c.kind === 'grid') { const { rows: _r, cols: _c, ...noRC } = rest; clean = noRC; }
    return stampCard(clean, i, nowIso);
  });
  const idSet = new Set(laid.map((c) => c.id));
  // Arrows may anchor to cards (string id), points, or groups (objects pass).
  const okRef = (ref) => (ref && typeof ref === 'object') ? true : idSet.has(ref);
  const arrows = (recipeLike.arrows || []).filter((a) => okRef(a.from) && okRef(a.to));
  // Hand-drawn stroke annotations: points relative to a named card (or absolute).
  const byId = Object.fromEntries(laid.map((c) => [c.id, c]));
  const strokes = (recipeLike.strokes || []).map((s) => {
    const base = s.relTo ? byId[s.relTo] : null;
    if (s.relTo && !base) return null;
    const ox = base ? base.x : 0, oy = base ? base.y : 0;
    return { color: s.color || '#f5c518', width: s.width || 3,
             points: (s.points || []).map(([dx, dy]) => [ox + dx, oy + dy]) };
  }).filter((s) => s && s.points.length > 1);
  const groups = (recipeLike.groups || []).filter((g) => g && g.id);

  const b64 = encodeBoardSnapshot(laid, arrows, { strokes, groups, gridSequences: ctx.gridSequences });
  const rows = buildCardIndexRows({ workspaceId: ctx.workspaceId, boardId: ctx.boardId, cards: laid });
  const heroKey = (laid.find((c) => c.kind === 'image')?.src || '').replace(/^r2:/, '') || null;
  const imageCount = laid.filter((c) => c.kind === 'image').length;
  const gridCount = laid.filter((c) => c.kind === 'grid').length;
  return { laid, arrows, strokes, groups, b64, rows, heroKey, imageCount, gridCount, nowIso };
}

// --replace: remove any prior board for this recipe (by name) + its R2 objects.
async function replaceExisting(supa, r2, { workspaceId, name }) {
  const { data: boards, error } = await supa.from('boards').select('id').eq('workspace_id', workspaceId).eq('name', name);
  if (error) throw new Error(`replace lookup: ${error.message}`);
  if (!boards?.length) { console.log('  (nothing to replace)'); return; }
  for (const b of boards) {
    // Include child boards (recipe.children) in the teardown.
    const { data: kids } = await supa.from('boards').select('id').eq('parent_board_id', b.id);
    const ids = [b.id, ...(kids || []).map((k) => k.id)];
    for (const id of ids) {
      const { data: imgs } = await supa.from('images').select('storage_path').eq('board_id', id);
      for (const im of (imgs || [])) { try { await r2.del(im.storage_path); } catch (_) {} }
      await supa.from('images').delete().eq('board_id', id);
    }
    for (const id of ids.reverse()) await supa.from('boards').delete().eq('id', id);
    console.log(`  replaced board ${b.id} (+${ids.length - 1} children)`);
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
  const r2 = dryRun ? null : makeR2({ accountId: need('R2_ACCOUNT_ID'), bucket: need('R2_BUCKET'), accessKeyId: need('R2_ACCESS_KEY_ID'), secretAccessKey: need('R2_SECRET_ACCESS_KEY') });
  const keys = { unsplash: process.env.UNSPLASH_ACCESS_KEY, pexels: process.env.PEXELS_API_KEY };
  const workspaceId = dryRun ? 'DRYRUN-WS' : need('SEED_WORKSPACE_ID');
  const userId = dryRun ? null : (process.env.SEED_USER_ID || null);
  const parentBoardId = process.env.SEED_PARENT_BOARD_ID || null;

  if (replace && !dryRun) await replaceExisting(supa, r2, { workspaceId, name: recipe.name });

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

  // Child boards first (recipe.children): each is a real board row under the
  // parent; the parent references them via {kind:'board', child:'<name>'} cards.
  // BoardCard's contract: the parent card's id IS the child board's id.
  const childIds = {};
  for (const child of (recipe.children || [])) {
    const childId = dryRun ? `DRYRUN-CHILD` : randomUUID();
    childIds[child.name] = childId;
    if (!dryRun) {
      const { error } = await supa.from('boards').insert({
        id: childId, workspace_id: workspaceId, parent_board_id: boardId,
        name: child.name, view: 'canvas', created_by: userId,
        bg_color: child.bgColor || recipe.bgColor || null, cover: child.cover || recipe.cover || null,
      });
      if (error) throw new Error(`child board insert: ${error.message}`);
    }
    const cb = await composeBoard(flattenSections(child), child,
      { r2, supa, keys, workspaceId, boardId: childId, userId, dryRun });
    console.log(`  child "${child.name}": ${cb.laid.length} cards (${cb.imageCount} images)`);
    if (!dryRun) {
      let { error } = await supa.from('board_state').upsert(
        { board_id: childId, doc: cb.b64, updated_at: cb.nowIso }, { onConflict: 'board_id' });
      if (error) throw new Error(`child board_state: ${error.message}`);
      ({ error } = await supa.from('card_index').upsert(cb.rows, { onConflict: 'board_id,card_id' }));
      if (error) throw new Error(`child card_index: ${error.message}`);
    }
  }
  const idRemap = {};
  const mapped = cards.map((c) => {
    if (c.kind !== 'board' || !c.child) return c;
    const nid = childIds[c.child] || c.id;
    if (nid !== c.id) idRemap[c.id] = nid;
    return { ...c, id: nid, child: undefined, title: c.title || c.child };
  });
  // Board-card ids become the child board's UUID — follow the rename in arrow/
  // stroke references so recipes can anchor arrows to {kind:'board'} cards.
  const remapRef = (r) => (typeof r === 'string' && idRemap[r]) || r;
  const recipeRemapped = {
    ...recipe,
    arrows: (recipe.arrows || []).map((a) => ({ ...a, from: remapRef(a.from), to: remapRef(a.to) })),
    strokes: (recipe.strokes || []).map((s) => (s && s.relTo ? { ...s, relTo: remapRef(s.relTo) } : s)),
  };

  const built = await composeBoard(mapped, recipeRemapped, { r2, supa, keys, workspaceId, boardId, userId, dryRun });
  const { laid, arrows, strokes, b64, rows, heroKey, imageCount, gridCount, nowIso } = built;
  console.log(`  ${laid.length} cards (${imageCount} images, ${gridCount} grids, ${arrows.length} arrows, ${strokes.length} strokes)`);
  if (imageCount < 3 && !noPublish) console.warn('  ⚠ fewer than 3 standalone images — public boards should have ≥3');
  console.log(`  snapshot ${Math.round(Buffer.from(b64, 'base64').length / 1024)}KB · card_index ${rows.length} rows`);

  if (dryRun) {
    console.log('\n[DRY RUN] would publish public_boards row:');
    console.log(JSON.stringify({ board_id: boardId, slug, seo_title: seo.title, og_image_key: heroKey, bg_color: recipe.bgColor || null, arrows: arrows.length, grids: gridCount, published: !noPublish }, null, 2));
    console.log('\n✅ recipe valid; re-run without --dry-run to publish.');
    return;
  }

  {
    const { error } = await supa.from('board_state').upsert({ board_id: boardId, doc: b64, updated_at: nowIso }, { onConflict: 'board_id' });
    if (error) throw new Error(`board_state upsert: ${error.message}`);
  }
  {
    const { error } = await supa.from('card_index').upsert(rows, { onConflict: 'board_id,card_id' });
    if (error) throw new Error(`card_index upsert: ${error.message}`);
  }

  if (!noPublish) {
    const { error } = await supa.from('public_boards').upsert({
      board_id: boardId, slug, seo_title: seo.title, seo_description: seo.description, seo_body: seo.body,
      answer: seo.answer || null, faq: Array.isArray(seo.faq) && seo.faq.length ? seo.faq : null,
      target_keyword: seo.keyword, og_image_key: heroKey, priority: recipe.priority || 0, published_at: nowIso,
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
