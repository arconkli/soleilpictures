#!/usr/bin/env node
// run.mjs — the boards engine. Makes boards, photographs them in the real app,
// and puts them in the Showcase library (Admin › Boards).
//
//   node scripts/engine/run.mjs --daily                 the day's marketing board (launchd, 06:00)
//   node scripts/engine/run.mjs --page /tools/storyboard-maker
//   node scripts/engine/run.mjs --subject costume       one board on a marketing subject
//   node scripts/engine/run.mjs --batch [--spares 2]    every page that has no board yet, then spares
//   node scripts/engine/run.mjs --brief "<text>" [--cluster Film]
//                                                       one board to a free-text brief, made for a TikTok post
//                                                       (cluster TikTok unless told; kept out of the library's review queue)
//   … --dry-run                                         everything but the writes; shots stay on disk
//   … --json <file>                                     the run's result, { ok, results }, written there (any mode)
//   … --style "production binder"                       one look for this run (styles.mjs), not the next by turns
//
// One board: the engine picks its look by turns (styles.mjs: its ground,
// layout, font and the tools it leads with), Claude writes a recipe to it (recipe.mjs) → real photos found and
// proven real (photos.mjs + aicheck) → laid out by the app's own maker
// (build.mjs) → the strict check (check.mjs) → shot in the real app
// (shoot.mjs) → Claude grades the shot; under the bar, one redo with its
// notes, then dropped → written to the Showcase workspace and the library
// (lib/showcaseWrite.mjs). Never published: a board reaches a public page only
// through a normal land.
//
// Needs: scripts/.env (SUPABASE_*, R2_*, PEXELS_API_KEY, UNSPLASH_ACCESS_KEY,
// SEED_WORKSPACE_ID, SEED_USER_ID), ~/soleil-social (aicheck and the claude
// runner; SOLEIL_SOCIAL to move it), and the `claude` CLI signed in.
// Work files: ENGINE_HOME (default ~/.boards-engine).

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { makeSupabase } from '../lib/supa.mjs';
import { makeR2 } from '../lib/r2.mjs';
import { rootCluster, ensureCluster, writeBoard, uploadShots, recordShowcase, libraryState, startRun, finishRun } from '../lib/showcaseWrite.mjs';
import { args } from './args.mjs';
import { PAGES, MARKETING, LATER_PAGES, pageBrief, nextMarketing } from './subjects.mjs';
import { writeRecipe, recipeContents, toolsOf } from './recipe.mjs';
import { findPhotos, pingUsed } from './photos.mjs';
import { pickPhotos } from './pick.mjs';
import { buildBoard, withSources } from './build.mjs';
import { checkBoard, missingPhotos, gradeShot, GRADE } from './check.mjs';
import { buildApp, shootBoard, zipShots } from './shoot.mjs';
import { findLinks } from './links.mjs';
import { nextStyle, styleNamed, fits } from './styles.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '../..');
const HOME = resolve(process.env.ENGINE_HOME || join(homedir(), '.boards-engine'));
const SOCIAL = resolve(process.env.SOLEIL_SOCIAL || join(homedir(), 'soleil-social'));
// Boards the owner OKs by hand before the engine OKs its own (#70 C).
export const HAND_OKS = 10;

function loadEnv() {
  const p = resolve(HERE, '../.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
function need(name) { const v = process.env[name]; if (!v) throw new Error(`Missing env ${name} (set it in scripts/.env)`); return v; }

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (m) => console.log(`${stamp()} ${m}`);

// One run at a time: launchd and a hand run must never write the same day twice.
function lock() {
  const f = join(HOME, 'run.lock');
  if (existsSync(f)) {
    const pid = Number(readFileSync(f, 'utf8'));
    try { process.kill(pid, 0); throw new Error(`another run is going (pid ${pid})`); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  }
  writeFileSync(f, String(process.pid));
  return () => rmSync(f, { force: true });
}

// The signed-in world the shots show: a studio's workspace, a few clusters,
// and the board open inside its subject's cluster.
function worldFor(brief, board) {
  const others = [...new Set(MARKETING.map((m) => m.cluster))].filter((c) => c !== brief.cluster).slice(0, 4);
  return {
    user: 'Maya Ortiz', email: 'maya@soleilpictures.example', workspace: 'Soleil Pictures',
    tree: [{ id: randomUUID(), name: 'Studio', cards: 6, children: [
      { id: randomUUID(), name: brief.cluster, cards: 4, children: [{ id: board.id, name: board.name }] },
      ...others.map((name, i) => ({ id: randomUUID(), name, cards: 5 + i * 3 })),
    ] }],
  };
}

/**
 * One board, start to finish.
 * → { ok, slug, title, outDir, shots: [{ kind, file }], contents, boardId? } or { ok: false, slug?, why }
 */
async function makeOne(brief, ctx) {
  const { claude, check, keys, lib, dryRun } = ctx;
  let notes = null;
  let last = null;
  const asked = ctx.style ? styleNamed(ctx.style) : null;
  const style = asked && fits(asked, brief) ? asked : nextStyle(brief, lib.styles);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    log(`board: ${brief.page || brief.subject} as a ${style.name} (try ${attempt})`);
    const { recipe, problems } = await writeRecipe(brief, { claude, taken: lib.taken, log, notes, last, style });
    if (problems.length) return { ok: false, why: `recipe: ${problems.slice(0, 3).join('; ')}` };
    const pick = (slots) => pickPhotos({ recipe, slots, dir: join(HOME, 'picks', `${recipe.slug}-${attempt}`), claude,
      notes: attempt > 1 ? notes || [] : [], log });
    const photos = await findPhotos(recipe, { dir: join(HOME, 'photos'), keys, check, used: lib.used, pick, log });
    log(`photos: ${photos.found.size} real, ${photos.missing.length} missing, ${photos.rejected} rejected`);
    const links = await findLinks(recipe, { log });
    if (links.missing.length) log(`links: ${links.missing.length} not found`);
    const board = buildBoard(recipe, photos.found, { newId: randomUUID, links: links.found, style });
    if (board.dropped.length) log(`build: dropped ${board.dropped.join('; ')}`);
    const checked = [...photos.found].map(([key, ph]) => ({ key, sha: ph.sha, verdict: 'real', licence: ph.credit?.source }));
    // Too many empty rows sends the first try back to rethink its searches; the last try builds with what
    // fits, and the check and the grader judge what's left.
    const broken = [...(attempt < 2 ? missingPhotos(recipe, photos.missing) : []), ...checkBoard(board, checked)];
    if (broken.length) {
      log(`check: ${broken.join('; ')}`);
      if (attempt === 2) return { ok: false, slug: recipe.slug, why: `check: ${broken.slice(0, 3).join('; ')}` };
      notes = broken; last = recipe; continue;
    }

    const id = randomUUID();
    const out = join(HOME, 'out', recipe.slug);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'recipe.json'), JSON.stringify(recipe, null, 2));
    const files = new Map();
    const staged = withSources(board.cards, photos.found, (ph, what) => {
      const name = `${ph.sha.slice(0, 20)}.${what === 'video' ? 'mp4' : 'jpg'}`;
      files.set(name, what === 'video' ? ph.video : ph.file);
      return `/engine-photos/${name}`;
    });
    const shot = await shootBoard({ appDir: ctx.appDir, board: { id, name: board.name, cards: staged, groups: board.groups, arrows: board.arrows, bg: board.bg },
      world: worldFor(brief, { id, name: board.name }), files, outDir: out, only: ctx.only, log });
    if (shot.errors.length) log(`shoot: ${shot.errors.join('; ')}`);
    const judged = shot.shots.find((s) => s.kind === 'board-light' || s.kind === 'board-dark') || shot.shots[0];
    if (!judged) return { ok: false, slug: recipe.slug, why: `shoot: ${shot.errors.slice(0, 2).join('; ') || 'no shots'}` };
    await sharp(join(out, judged.file)).resize({ width: 1600 }).jpeg({ quality: 86 }).toFile(join(out, 'grade.jpg'));
    const grade = await gradeShot(join(out, 'grade.jpg'), recipe, { claude, cwd: out, log });
    log(`grade: ${grade.score}/5: ${grade.summary}`);
    if (grade.score < GRADE.pass) {
      if (attempt === 2) return { ok: false, slug: recipe.slug, why: `grade ${grade.score}/5: ${grade.summary}` };
      notes = grade.fixes.length ? grade.fixes : [grade.summary]; last = recipe; continue;
    }

    const used = [...photos.found.values()];
    const credits = used.map((ph) => ({ ...ph.credit, id: ph.id }));
    const zip = zipShots(out, shot.shots, credits);
    const made = { slug: recipe.slug, title: recipe.title, outDir: out,
      shots: shot.shots.map((s) => ({ kind: s.kind, file: join(out, s.dir || '', s.file) })), contents: recipeContents(recipe) };
    if (dryRun) {
      log(`dry run: ${recipe.slug} passed; shots in ${out}`);
      lib.styles.push(style.name);
      return { ok: true, ...made };
    }

    const { supa, r2, workspaceId, userId } = ctx;
    const root = await rootCluster(supa, workspaceId);
    const parentId = await ensureCluster(supa, { workspaceId, userId, rootId: root.id, name: brief.cluster });
    const written = await writeBoard({ supa, r2, workspaceId, userId, parentId, board, found: photos.found, log });
    const shots = await uploadShots({ r2, boardId: written.boardId, outDir: out, shots: shot.shots, zip });
    await r2.put(`showcase/${written.boardId}/recipe.json`, Buffer.from(JSON.stringify(recipe)), 'application/json');
    await recordShowcase(supa, {
      board_id: written.boardId, slug: recipe.slug, title: recipe.title, story: recipe.story, subject: brief.subject,
      page_path: brief.page || null,
      // A board made for a post is not up for the public library's review.
      status: brief.subject === 'tiktok' ? 'skipped' : lib.okByPerson >= HAND_OKS ? 'ok' : 'new',
      score: { grade: grade.score, summary: grade.summary, fixes: grade.fixes, tries: attempt, rejected: photos.rejected,
        cards: written.cards.length, photos: used.length, style: style.name, tools: toolsOf(recipe) },
      shots, credits, phash: used.map((ph) => ph.hash), run_id: ctx.runId,
    });
    await pingUsed(used, keys);
    lib.taken.push(recipe.slug);
    lib.styles.push(style.name);
    for (const ph of used) { lib.used.ids.add(ph.id); lib.used.hashes.push(ph.hash); }
    log(`made: ${recipe.slug} (${written.boardId})`);
    return { ok: true, boardId: written.boardId, ...made };
  }
  return { ok: false, why: 'no try passed' };
}

// --json <file>: the run's result, written on every way out (read off argv so a bad command line lands there too).
const jsonPath = (() => { const i = process.argv.indexOf('--json'); return i > -1 ? process.argv[i + 1] || null : null; })();
let jsonDone = false;
function writeJson(out) {
  if (!jsonPath || jsonDone) return;
  jsonDone = true;
  try { mkdirSync(dirname(resolve(jsonPath)), { recursive: true }); writeFileSync(jsonPath, JSON.stringify(out, null, 2)); }
  catch (e) { console.error(`${stamp()} ✗ could not write ${jsonPath}: ${e.message}`); }
}

async function main() {
  const a = args(process.argv.slice(2));
  loadEnv();
  mkdirSync(HOME, { recursive: true });
  const unlock = lock();
  const { claudeJson } = await import(pathToFileURL(join(SOCIAL, 'lib/claude.mjs')).href);
  const { checkPhotos } = await import(pathToFileURL(join(SOCIAL, 'lib/aicheck/index.mjs')).href);
  const supa = makeSupabase({ url: need('SUPABASE_URL'), serviceRoleKey: need('SUPABASE_SERVICE_ROLE_KEY') });
  const ctx = {
    claude: claudeJson,
    check: (items, o) => checkPhotos(items, { ...o, look: true }),
    keys: { pexels: need('PEXELS_API_KEY'), unsplash: process.env.UNSPLASH_ACCESS_KEY || null },
    supa, dryRun: a.dryRun, only: a.only || null, style: a.style || null,
    r2: a.dryRun ? null : makeR2({ accountId: need('R2_ACCOUNT_ID'), bucket: need('R2_BUCKET'), accessKeyId: need('R2_ACCESS_KEY_ID'), secretAccessKey: need('R2_SECRET_ACCESS_KEY') }),
    workspaceId: need('SEED_WORKSPACE_ID'), userId: need('SEED_USER_ID'),
    lib: await libraryState(supa),
  };

  let briefs;
  if (a.mode === 'page') {
    if (LATER_PAGES.includes(a.page)) throw new Error(`${a.page} keeps its board until its read (after 2026-11-19)`);
    const b = pageBrief(a.page);
    if (!b) throw new Error(`no brief for ${a.page}`);
    briefs = [b];
  } else if (a.mode === 'subject') {
    const b = MARKETING.find((m) => m.subject === a.subject);
    if (!b) throw new Error(`no marketing subject "${a.subject}" (${MARKETING.map((m) => m.subject).join(', ')})`);
    briefs = [b];
  } else if (a.mode === 'brief') {
    briefs = [{ cluster: a.cluster || 'TikTok', subject: 'tiktok', brief: a.brief }];
  } else if (a.mode === 'daily') {
    const lastMade = Math.max(0, ...ctx.lib.made.map((m) => Date.parse(m.made_at) || 0));
    if (!a.dryRun && Date.now() - lastMade < 20 * 3600e3) { log('daily: a board was made in the last 20 hours; nothing to do'); writeJson({ ok: true, results: [], why: 'a board was made in the last 20 hours' }); unlock(); return; }
    briefs = [nextMarketing(ctx.lib.made)];
  } else {
    briefs = PAGES.filter((p) => !ctx.lib.pages.has(p.page));
    const made = [...ctx.lib.made];
    for (let i = 0; i < a.spares; i += 1) {
      const m = nextMarketing(made);
      briefs.push(m);
      made.push({ subject: m.subject, made_at: new Date(Date.now() + i).toISOString() });
    }
  }

  ctx.appDir = buildApp({ boardsDir: BOARDS, outDir: join(HOME, 'app'), log });
  ctx.runId = a.dryRun ? null : await startRun(supa, a.mode === 'brief' ? 'subject' : a.mode);
  const results = [];
  try {
    for (const brief of briefs) {
      let r;
      try { r = await makeOne(brief, ctx); } catch (e) { r = { ok: false, why: e.message }; }
      results.push({ at: new Date().toISOString(), brief: brief.page || brief.subject, ...r });
      appendFileSync(join(HOME, 'runs.jsonl'), `${JSON.stringify(results.at(-1))}\n`);
      if (!r.ok) log(`dropped: ${brief.page || brief.subject}: ${r.why}`);
    }
  } finally {
    const made = results.filter((r) => r.ok).length;
    const dropped = results.length - made;
    writeJson({ ok: made > 0, results });
    if (ctx.runId) {
      await finishRun(supa, ctx.runId, { ok: made > 0 || !results.length, made, dropped,
        note: results.filter((r) => !r.ok).map((r) => `${r.brief}: ${r.why}`).join('\n') || null });
    }
    unlock();
    log(`run: ${made} made, ${dropped} dropped`);
  }
}

main().catch((e) => { console.error(`${stamp()} ✗ ${e.message}`); writeJson({ ok: false, results: [], why: e.message }); process.exit(1); });
