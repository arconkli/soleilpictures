// shoot.mjs — photographs a board in the REAL app.
//
// A port of the graphics engine's real.mjs (~/soleil-social/lab/gfx): the
// production build, made with fake Supabase credentials (so the signed-in app
// is kept, and nothing can reach the real database), is served from disk by
// Playwright itself, every Supabase call is answered locally, the board is
// handed to the app as the Yjs state it would load, and Capture Mode frames
// the camera. Nothing leaves the machine except font requests.
//
// buildApp(): `vite build` into the engine's work folder, once per checkout
// (stamped with the commit it was built from). Not `npm run build`: its
// prebuild rewrites tracked files.
//
// shootBoard(): every shot a board ships with, each a PNG plus an 800px WebP
// thumb, then one zip of them all.

import { chromium, devices } from '@playwright/test';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { encodeBoardSnapshot } from '../lib/cardEncode.mjs';

const ORIGIN = 'http://clusters.engine.local';
const SB = 'https://example.supabase.co';
const FAKE_KEY = 'local-engine-key';
const FONT_HOSTS = /^(use\.typekit\.net|p\.typekit\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
const BASE_CSS = `.capture-hud,.capture-hud-dot,.capture-mask,.dev-banner{display:none!important}
.card-resize,.ic-act,.pc-cell-x,.pc-add,.gridc-cell-x,.lc-open,.ic-add-caption{display:none!important}
*{caret-color:transparent!important}
.ws-presence-status.off{background:#10b981!important;box-shadow:0 0 6px rgba(16,185,129,.5)!important}`;
const CAPTURE = { on: true, clean: false, silence: true, freeze: true };
const CLEAN = { ...CAPTURE, clean: true };

// What ships with every board. size: the viewport (CSS px) and its pixel ratio.
// frame: the shot shows the part of the board that best fills its shape (a
// section or two) instead of the whole board, which is wide.
export const SHOTS = [
  { kind: 'desk-light', label: 'App desktop, light', theme: 'light', size: { width: 1440, height: 900, dpr: 2 }, capture: CAPTURE },
  { kind: 'desk-dark', label: 'App desktop, dark', theme: 'dark', size: { width: 1440, height: 900, dpr: 2 }, capture: CAPTURE },
  { kind: 'wide', label: 'Wide 16:9', theme: 'light', size: { width: 1920, height: 1080, dpr: 2 }, capture: CAPTURE },
  { kind: 'board-light', label: 'Board only, light (4K)', theme: 'light', size: { width: 1920, height: 1080, dpr: 2 }, capture: CLEAN },
  { kind: 'board-dark', label: 'Board only, dark (4K)', theme: 'dark', size: { width: 1920, height: 1080, dpr: 2 }, capture: CLEAN },
  { kind: 'phone', label: 'Phone 9:16', theme: 'light', size: { width: 393, height: 699, dpr: 3, mobile: true }, capture: CAPTURE, frame: true },
  { kind: 'portrait', label: 'Portrait 4:5', theme: 'dark', size: { width: 1080, height: 1350, dpr: 2 }, capture: CLEAN, frame: true },
  { kind: 'square', label: 'Square 1:1', theme: 'light', size: { width: 1080, height: 1080, dpr: 2 }, capture: CLEAN, frame: true },
];
export const CUTOUTS = 8;
export const THUMB = 800;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts });
}

/** The app, built once per commit into `outDir`. → outDir */
export function buildApp({ boardsDir, outDir, log = () => {} }) {
  const head = sh('git', ['rev-parse', 'HEAD'], { cwd: boardsDir }).trim();
  const stamp = join(outDir, '.engine-build');
  if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === head && existsSync(join(outDir, 'index.html'))) return outDir;
  log(`shoot: building the app at ${head.slice(0, 8)}`);
  rmSync(outDir, { recursive: true, force: true });
  sh('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: boardsDir,
    env: { ...process.env, VITE_SUPABASE_URL: SB, VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY, VITE_SUPABASE_ANON_KEY: FAKE_KEY, VITE_USE_PARTYKIT: '', VITE_PARTYKIT_HOST: '' },
  });
  // The signed-in app is dropped from a build that has no Supabase settings;
  // a build without the canvas would shoot the sign-in page.
  const js = sh('grep', ['-rl', 'canvas-wrap', join(outDir, 'assets')]).trim();
  if (!js) throw new Error('shoot: the build has no canvas (signed-in app missing)');
  writeFileSync(stamp, head);
  return outDir;
}

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// The signed-in world the app boots into: one workspace, the board's cluster
// tree, and the board itself as Yjs state.
function stage({ world, board }) {
  const now = Math.floor(Date.now() / 1000);
  const uid = '7d1f0e7a-1111-4c2b-9a51-5f0c2b8e9a01';
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: world.email, app_metadata: { provider: 'email' },
    user_metadata: { full_name: world.user, name: world.user }, created_at: '2026-03-02T17:00:00Z', email_confirmed_at: '2026-03-02T17:01:00Z' };
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: uid, exp: now + 3600, role: 'authenticated', aud: 'authenticated', email: user.email })}.c2lnbmF0dXJl`;
  const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'refresh-local', user };
  const ws = { id: 'a6c1b0de-2222-4c2b-9a51-5f0c2b8e9a02', name: world.workspace, created_by: uid, owner_id: uid, created_at: '2026-03-02T17:00:00Z', settings: {} };
  const boards = [];
  const states = new Map();
  let t = Date.parse('2026-10-20T19:00:00Z');
  const add = (node, parent) => {
    // The app opens a fresh device on the most recently updated cluster with cards: the board.
    const updated = node.id === board.id ? new Date().toISOString() : new Date(t -= 3600e3).toISOString();
    boards.push({ id: node.id, workspace_id: ws.id, name: node.name, parent_board_id: parent, deleted_at: null, view: 'canvas',
      created_by: uid, created_at: '2026-09-14T17:00:00Z', updated_at: updated, position: boards.length, bg_color: null,
      card_count: node.id === board.id ? board.cards.length : (node.cards || 0) });
    for (const c of node.children || []) add(c, node.id);
  };
  for (const n of world.tree) add(n, null);
  states.set(board.id, encodeBoardSnapshot(board.cards, [], { groups: board.groups }));
  return { uid, user, session, ws, boards, states };
}

function stub(route, S) {
  const req = route.request();
  const url = new URL(req.url());
  const path = url.pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const single = /vnd\.pgrst\.object/.test(req.headers().accept || '');
  if (path === '/auth/v1/user') return json(S.user);
  if (path.startsWith('/auth/v1/token')) return json(S.session);
  if (path.startsWith('/auth/v1/')) return json({});
  if (path === '/rest/v1/rpc/get_my_tier') return json([{ tier: 'admin', demo_card_count: 0, onboarding: { done: true }, card_cap: 100000 }]);
  if (path === '/rest/v1/rpc/get_or_create_personal_workspace') return json(S.ws);
  if (path === '/rest/v1/workspace_members' && req.method() === 'GET') {
    return json([{ workspace_id: S.ws.id, role: 'owner', created_at: S.ws.created_at, user_id: S.uid, workspaces: S.ws }]);
  }
  if (path === '/rest/v1/workspaces' && req.method() === 'GET') return single ? json(S.ws) : json([S.ws]);
  if (path === '/rest/v1/boards' && req.method() === 'GET') {
    let rows = S.boards;
    const parent = url.searchParams.get('parent_board_id');
    const id = url.searchParams.get('id');
    if (parent === 'is.null') rows = rows.filter((b) => !b.parent_board_id);
    if (id?.startsWith('eq.')) rows = rows.filter((b) => b.id === id.slice(3));
    if (single) return rows[0] ? json(rows[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406);
    return json(rows);
  }
  if (path === '/rest/v1/board_state' && req.method() === 'GET') {
    const id = (url.searchParams.get('board_id') || '').replace(/^eq\./, '');
    const doc = S.states.get(id);
    if (single) return doc ? json({ doc }) : json({ code: 'PGRST116', message: 'no rows' }, 406);
    return json(doc ? [{ doc }] : []);
  }
  if (single) return json({ code: 'PGRST116', message: 'no rows' }, 406);
  if (path.startsWith('/rest/v1/')) return json([]);
  if (path.startsWith('/storage/v1/')) return json([]);
  return json({});
}

// The built app and the board's photos, from disk. Photos are asked for at
// /engine-photos/<name>; `files` maps each name to its file.
function serveLocal(route, appDir, files) {
  const url = new URL(route.request().url());
  const path = decodeURIComponent(url.pathname);
  if (path.startsWith('/engine-photos/')) {
    const f = files.get(path.slice('/engine-photos/'.length));
    if (!f) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: TYPES[extname(f).toLowerCase()] || 'application/octet-stream', body: readFileSync(f) });
  }
  if (path.startsWith('/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  const file = resolve(appDir, `.${path}`);
  if (file.startsWith(appDir) && existsSync(file) && statSync(file).isFile()) {
    return route.fulfill({ status: 200, contentType: TYPES[extname(file).toLowerCase()] || 'application/octet-stream', body: readFileSync(file) });
  }
  return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(appDir, 'index.html')) });
}

async function camera(page, moves) {
  await page.evaluate((m) => new Promise((res) => {
    document.addEventListener('soleil-capture-camera-done', res, { once: true });
    document.dispatchEvent(new CustomEvent('soleil-capture-camera', { detail: { moves: m } }));
    setTimeout(res, 5000);
  }), moves.map((m) => ({ ms: 0, ...m })));
}

async function openContext(browser, shot, S, appDir, files) {
  const sz = shot.size;
  const prof = sz.mobile
    ? { ...devices['iPhone 15 Pro'], viewport: { width: sz.width, height: sz.height }, deviceScaleFactor: sz.dpr }
    : { viewport: { width: sz.width, height: sz.height }, deviceScaleFactor: sz.dpr };
  const ctx = await browser.newContext({ ...prof, colorScheme: shot.theme, locale: 'en-US', timezoneId: 'America/Los_Angeles' });
  await ctx.route(/.*/, (route) => {
    const u = new URL(route.request().url());
    if (u.origin === ORIGIN) return serveLocal(route, appDir, files);
    if (u.origin === SB) return stub(route, S);
    if (FONT_HOSTS.test(u.hostname)) return route.continue({ headers: { ...route.request().headers(), referer: 'https://clusters.soleilpictures.com/' } });
    return route.abort();
  });
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  await ctx.addInitScript(([session, cap, css]) => {
    try {
      localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      sessionStorage.setItem('soleil.capture', JSON.stringify(cap));
    } catch (_) { /* a page with no storage still shoots */ }
    const add = () => { const el = document.createElement('style'); el.textContent = css; document.head.appendChild(el); };
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add, { once: true });
  }, [S.session, shot.capture, BASE_CSS]);
  return { ctx, prof };
}

const bounds = (cards) => {
  const x = Math.min(...cards.map((c) => c.x));
  const y = Math.min(...cards.map((c) => c.y));
  return { x, y, w: Math.max(...cards.map((c) => c.x + c.w)) - x, h: Math.max(...cards.map((c) => c.y + c.h)) - y };
};

// The part of the board a framed shot shows: of each section alone, each two
// sections side by side, and the whole board, the one whose shape is nearest
// the frame's, a little in favour of showing more. → { x, y, w, h } in board units
export function pickFrame(cards, groups, aspect) {
  const sections = groups.map((g) => cards.filter((c) => c.groupId === g.id)).filter((cs) => cs.length);
  const cands = [cards, ...sections];
  for (let i = 0; i + 1 < sections.length; i += 1) cands.push([...sections[i], ...sections[i + 1]]);
  const pad = 40; // the section's outline and its label
  let best = null;
  for (const cs of cands) {
    const b = bounds(cs);
    const r = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
    const score = Math.abs(Math.log(r.w / r.h / aspect)) - 0.25 * (cs.length / cards.length);
    if (!best || score < best.score) best = { score, r };
  }
  return best.r;
}

// The app's camera takes fit, zoom and pan; a frame is the fit, a zoom about
// the centre and a pan (the graphics engine's real.mjs `frame`). inset: screen
// px on the left the app's tool rail covers.
async function frameMoves(page, cards, groups, { inset = 0, margin = 24 } = {}) {
  const r = await page.evaluate(() => { const b = document.querySelector('.canvas-wrap').getBoundingClientRect(); return { w: b.width, h: b.height }; });
  const B = bounds(cards);
  const fm = r.w > 640 ? 80 : Math.max(16, Math.round(r.w * 0.05));
  const z0 = Math.min((r.w - 2 * fm) / B.w, (r.h - 2 * fm) / B.h);
  const F = pickFrame(cards, groups, (r.w - 2 * margin - inset) / (r.h - 2 * margin));
  const zt = Math.min((r.w - 2 * margin - inset) / F.w, (r.h - 2 * margin) / F.h);
  const dx = (F.x + F.w / 2) - (B.x + B.w / 2) - inset / 2 / zt;
  const dy = (F.y + F.h / 2) - (B.y + B.h / 2);
  return [{ type: 'fit' }, { type: 'zoom', by: zt / z0 }, { type: 'pan', dx, dy }];
}

// How far the app's tool rail reaches into the canvas from the left.
async function railInset(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
    let el = document.elementFromPoint(wrap.left + 12, wrap.top + wrap.height / 2);
    while (el && el !== document.body) {
      const b = el.getBoundingClientRect();
      if (b.width < wrap.width / 2 && b.height > wrap.height / 3 && b.left <= wrap.left + 24) return Math.round(b.right - wrap.left + 8);
      el = el.parentElement;
    }
    return 0;
  });
}

async function settle(page, errors) {
  // Only the pictures in view: the app leaves the ones off-screen unloaded.
  await page.waitForFunction(() => [...document.images].filter((i) => {
    const b = i.getBoundingClientRect();
    return b.width > 0 && b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth;
  }).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 45000 }).catch(() => errors.push('pictures in view not all loaded'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1800);
}

async function thumb(png, out) {
  await sharp(png).resize({ width: THUMB, withoutEnlargement: true }).webp({ quality: 82 }).toFile(out);
}

/**
 * Shoots one board. → { shots: [{ kind, label, file, thumb, w, h, bytes, theme? }], errors }
 *   board: { id, name, cards, groups } with srcs at /engine-photos/<name>
 *   world: { user, email, workspace, tree: [{ id, name, children, cards }] } holding the board's id
 *   files: Map(name → file on disk) for /engine-photos/
 */
export async function shootBoard({ appDir, board, world, files, outDir, cutouts = CUTOUTS, only = null, log = () => {} }) {
  mkdirSync(join(outDir, 'cards'), { recursive: true });
  const S = stage({ world, board });
  const browser = await chromium.launch({ headless: true });
  const shots = [];
  const errors = [];
  try {
    for (const shot of SHOTS.filter((s) => !only || only.includes(s.kind))) {
      const { ctx, prof } = await openContext(browser, shot, S, appDir, files);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${shot.kind}: ${String(e.message).slice(0, 140)}`));
      await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      const ok = await page.locator('.canvas-wrap').first().waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
      if (!ok) { errors.push(`${shot.kind}: no canvas`); await ctx.close(); continue; }
      await page.evaluate((cap) => window.__soleilCapture?.set(cap), shot.capture);
      await page.mouse.move(prof.viewport.width - 3, prof.viewport.height - 3);
      await page.waitForTimeout(1200);
      const inset = shot.frame && !shot.capture.clean ? await railInset(page) : 0;
      await camera(page, shot.frame ? await frameMoves(page, board.cards, board.groups || [], { inset }) : [{ type: 'fit' }]);
      await settle(page, errors);
      const file = join(outDir, `${shot.kind}.png`);
      await page.screenshot({ path: file });
      const meta = await sharp(file).metadata();
      const tfile = join(outDir, `${shot.kind}.webp`);
      await thumb(file, tfile);
      shots.push({ kind: shot.kind, label: shot.label, theme: shot.theme, file: `${shot.kind}.png`, thumb: `${shot.kind}.webp`,
        w: meta.width, h: meta.height, bytes: statSync(file).size });
      log(`shoot: ${shot.kind} ${meta.width}×${meta.height}`);

      // The close-ups ride on the last clean light shot's page: each card alone,
      // on transparency, framed big by the app's own camera.
      if (shot.kind === 'square' && cutouts > 0) {
        await page.addStyleTag({ content: `.canvas-wrap,.canvas-wrap *{background-image:none!important}
          .canvas-wrap,.canvas-bg,.canvas-inner,html,body,#root,.app,.main,.canvas-area{background:transparent!important}
          [data-card-id]{box-shadow:none!important}` });
        for (const c of pickCutouts(board.cards, cutouts)) {
          await camera(page, [{ type: 'card', id: c.id }]);
          await page.waitForTimeout(700);
          const el = page.locator(`[data-card-id="${c.id}"]`).first();
          if (!(await el.count())) { errors.push(`no element for card ${c.id}`); continue; }
          const name = `card-${c.kind}-${shots.filter((s) => s.kind === 'card').length + 1}`;
          const cf = join(outDir, 'cards', `${name}.png`);
          try {
            await el.screenshot({ path: cf, omitBackground: true });
            const cm = await sharp(cf).metadata();
            await thumb(cf, join(outDir, 'cards', `${name}.webp`));
            shots.push({ kind: 'card', label: `Close-up: ${c.kind}`, file: `${name}.png`, thumb: `${name}.webp`, dir: 'cards',
              w: cm.width, h: cm.height, bytes: statSync(cf).size });
          } catch (e) { errors.push(`card ${c.id}: ${String(e.message).slice(0, 80)}`); }
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return { shots, errors };
}

// The cards worth a close-up: the biggest pictures first, then a palette and
// the longest notes, in board order.
export function pickCutouts(cards, n = CUTOUTS) {
  const area = (c) => c.w * c.h;
  const pics = cards.filter((c) => c.kind === 'image' || c.kind === 'video').sort((a, b) => area(b) - area(a)).slice(0, Math.max(1, n - 3));
  const pal = cards.filter((c) => c.kind === 'palette').slice(0, 1);
  const notes = cards.filter((c) => c.kind === 'note').sort((a, b) => area(b) - area(a)).slice(0, Math.max(0, n - pics.length - pal.length));
  const keep = new Set([...pics, ...pal, ...notes].map((c) => c.id));
  return cards.filter((c) => keep.has(c.id));
}

/** One zip of every shot and close-up, plus the credits. → the zip's name */
export function zipShots(outDir, shots, credits) {
  writeFileSync(join(outDir, 'credits.txt'), credits.map((c) => `${c.source}: ${c.name}${c.page ? ` — ${c.page}` : ''}`).join('\n') + '\n');
  const files = [...shots.map((s) => (s.dir ? `${s.dir}/${s.file}` : s.file)), 'credits.txt'];
  rmSync(join(outDir, 'all.zip'), { force: true });
  sh('zip', ['-q', '-X', 'all.zip', ...files], { cwd: outDir });
  return 'all.zip';
}
