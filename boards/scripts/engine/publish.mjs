#!/usr/bin/env node
// publish.mjs — puts OK'd engine boards on the public site at /c/<slug>, so a
// search page can show them (EXAMPLES_BY_PATH in seoLanding.js and
// seoListicles.js names them; that change reaches the site through a land).
//
//   node scripts/engine/publish.mjs <slug> [<slug> …] [--dry-run]
//
// Only a board the library holds as 'ok' is published. Its article is the
// recipe's seo (written with the board and checked by recipe.mjs), with the
// photographers named at the end, since the board itself carries no credits
// note (it would sit in every marketing shot). The recipe is read from the
// engine's work files, or from R2 (showcase/<board>/recipe.json) when they're
// gone. Running it again updates the article in place.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = resolve(process.env.ENGINE_HOME || join(homedir(), '.boards-engine'));

/** Names in a list, the way a sentence says them: "A", "A and B", "A, B and C". */
export function sayList(names) {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** A sound's title as its page names it: "File:Rain on tin.ogg" → "Rain on tin". */
export const soundTitle = (t) => String(t || '').replace(/^File:/i, '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_/g, ' ').trim();

/**
 * The board's credits as one line: its photographers by library ("Photos by A
 * and B on Pexels, and C on Unsplash."), then each sound by title, maker and
 * licence, as its licence asks ("Sound: "Rain on tin" by D (CC BY 4.0) on
 * Wikimedia Commons.").
 */
export function creditsLine(credits) {
  const by = new Map();
  const sounds = [];
  for (const c of credits || []) {
    const name = String(c?.name || '').trim();
    const source = String(c?.source || '').trim();
    if (!name || !source) continue;
    if (c.kind === 'sound') {
      const title = soundTitle(c.title);
      sounds.push(`${title ? `"${title}" ` : ''}by ${name}${c.licence ? ` (${c.licence})` : ''} on ${source}`);
      continue;
    }
    if (!by.has(source)) by.set(source, []);
    if (!by.get(source).includes(name)) by.get(source).push(name);
  }
  const photos = by.size ? `Photos by ${sayList([...by].map(([source, names]) => `${sayList(names)} on ${source}`))}.` : '';
  const sound = sounds.length ? `Sound${sounds.length > 1 ? 's' : ''}: ${sayList(sounds)}.` : '';
  return [photos, sound].filter(Boolean).join(' ');
}

/** The recipe's seo → the public_boards article fields. */
export function articleOf(recipe, credits) {
  const seo = recipe?.seo || {};
  if (!seo.title || !seo.description || !seo.body) throw new Error(`${recipe?.slug || 'the board'} has no article text`);
  const line = creditsLine(credits);
  return {
    seo_title: String(seo.title).trim(),
    seo_description: String(seo.description).trim(),
    seo_body: line ? `${String(seo.body).trim()}\n\n${line}` : String(seo.body).trim(),
    target_keyword: String(seo.keyword || '').trim() || null,
  };
}

/** The share picture: the board's biggest photo (never a video file). → its R2 key, or null */
export function heroOf(images) {
  const photos = (images || []).filter((i) => /\.(jpe?g|png|webp)$/i.test(i.storage_path || ''));
  photos.sort((a, b) => (b.width * b.height) - (a.width * a.height)
    || Number(b.width >= b.height) - Number(a.width >= a.height));
  return photos[0]?.storage_path || null;
}

function loadEnv() {
  const p = resolve(HERE, '../.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
function need(name) { const v = process.env[name]; if (!v) throw new Error(`Missing env ${name} (set it in scripts/.env)`); return v; }
function must({ data, error }, what) { if (error) throw new Error(`${what}: ${error.message}`); return data; }

async function recipeOf(slug, boardId, r2) {
  const local = join(HOME, 'out', slug, 'recipe.json');
  if (existsSync(local)) return JSON.parse(readFileSync(local, 'utf8'));
  const buf = await r2.get(`showcase/${boardId}/recipe.json`);
  if (!buf) throw new Error(`${slug}: no recipe on disk or in R2`);
  return JSON.parse(Buffer.from(buf).toString('utf8'));
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const slugs = argv.filter((a) => !a.startsWith('--'));
  if (!slugs.length) throw new Error('say which boards: node scripts/engine/publish.mjs <slug> …');
  loadEnv();
  const { makeSupabase } = await import('../lib/supa.mjs');
  const { makeR2 } = await import('../lib/r2.mjs');
  const supa = makeSupabase({ url: need('SUPABASE_URL'), serviceRoleKey: need('SUPABASE_SERVICE_ROLE_KEY') });
  const r2 = makeR2({ accountId: need('R2_ACCOUNT_ID'), bucket: need('R2_BUCKET'), accessKeyId: need('R2_ACCESS_KEY_ID'), secretAccessKey: need('R2_SECRET_ACCESS_KEY') });
  const userId = need('SEED_USER_ID');
  const origin = process.env.SITE_ORIGIN || 'https://clusters.soleilpictures.com';

  for (const slug of slugs) {
    const rows = must(await supa.from('showcase_boards').select('board_id, slug, status, credits').eq('slug', slug), 'library');
    const row = rows[0];
    if (!row) throw new Error(`${slug}: not in the library`);
    if (row.status !== 'ok') throw new Error(`${slug}: is "${row.status}", not OK'd`);
    const article = articleOf(await recipeOf(slug, row.board_id, r2), row.credits);
    const images = must(await supa.from('images').select('storage_path, width, height').eq('board_id', row.board_id).is('deleted_at', null), 'images');
    const nowIso = new Date().toISOString();
    const pub = {
      board_id: row.board_id, slug, ...article, og_image_key: heroOf(images), priority: 0, is_template: false,
      review_status: 'approved', published_by: 'admin', created_by: userId, updated_at: nowIso,
    };
    if (dryRun) {
      console.log(JSON.stringify({ ...pub, seo_body: `${pub.seo_body.slice(0, 120)}… (${pub.seo_body.split(/\s+/).length} words)` }, null, 2));
      continue;
    }
    const was = must(await supa.from('public_boards').select('published_at').eq('board_id', row.board_id), 'public row');
    must(await supa.from('public_boards').upsert({ ...pub, published_at: was[0]?.published_at || nowIso }, { onConflict: 'board_id' }), 'public_boards upsert');
    console.log(`live: ${origin}/c/${slug}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}
