// comment-notices.spec.js
//
// Comment notices, in the real signed-in app (tests/commentApp.js answers
// Supabase): the bell's rows for a comment on a canvas, on a doc's or a note's
// words and on a shared file, a burst folded into one row; a row opens its
// conversation; a live notice toasts with Open, folds into its row, and stays
// quiet while its conversation is on screen; a comment on a note's words tells
// the server (notify_doc_comment), and nothing breaks when the server has no
// such function yet.
//
// STEP6_SHOTS=<dir> also writes screenshots there (dark and light).

import { expect, test } from '@playwright/test';
import { signedIn, pointRows, POINT, BOARD, UID, OTHER, WS } from './commentApp.js';

test.use({ viewport: { width: 1000, height: 720 } });

const SHOTS = process.env.STEP6_SHOTS || '';
const LANG = (process.env.I18N_LANG || '').trim();
const TOKEN = '44444444-4444-4444-8444-444444444444';
const bell = (page) => page.locator('.chrome-right .nb-bell');
const panel = (page) => page.locator('.ntf-shell');
const row = (page, kind) => panel(page).locator(`.ntf-row[data-kind="${kind}"]`);
const canvasCard = (page) => page.locator('.cmt-canvas-card');
const float = (page) => page.locator('.cmt-float-host .cmt-card');
const toast = (page, text) => page.locator('.toast-msg').filter({ hasText: text });
const noteBody = (page) => page.locator('.canvas-wrap .card .note-body');

async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/${name}-dark.png` });
  // (the attribute, not the switch: a press outside the bell's list closes it)
  const was = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/${name}-light.png` });
  await page.evaluate((t) => (t ? document.documentElement.setAttribute('data-theme', t) : document.documentElement.removeAttribute('data-theme')), was);
}

const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const notices = () => [
  { id: 101, user_id: UID, kind: 'comment.reply', actor_id: OTHER, board_id: BOARD, workspace_id: null, read_at: null, created_at: ago(1),
    title: 'Maya Reyes replied in Test Studio', body: 'Agreed, and the practical on the left wall should stay warm through the whole scene.',
    data: { board_id: BOARD, anchor_kind: 'point', anchor_id: null, excerpt: 'Agreed', thread_id: POINT.theirs, comment_id: POINT.reply, count: 3 } },
  { id: 102, user_id: UID, kind: 'doc.mention', actor_id: OTHER, board_id: BOARD, workspace_id: null, read_at: null, created_at: ago(9),
    title: 'Maya Reyes mentioned you in Test Studio', body: '@Tess can you check the page count before Friday?',
    data: { board_id: BOARD, card_id: 'card-gone', thread_id: 'cm_gone', comment_id: 'cm_gone', count: 1 } },
  { id: 103, user_id: UID, kind: 'file.replied', actor_id: OTHER, board_id: null, workspace_id: null, read_at: ago(30), created_at: ago(40),
    title: 'Maya Reyes replied on “Cut v3.mov”', body: 'The cut at 0:42 lands better now.',
    data: { token: TOKEN, share_id: 's1', comment_id: '33333333-3333-4333-8333-333333333333', thread_id: '22222222-2222-4222-8222-222222222222', file_name: 'Cut v3.mov', count: 1 } },
  { id: 104, user_id: UID, kind: 'comment.resolved', actor_id: null, board_id: BOARD, workspace_id: null, read_at: ago(60), created_at: ago(90),
    title: 'Someone resolved your comment in Test Studio', body: 'Second pass on the light here',
    data: { board_id: BOARD, thread_id: POINT.mine, comment_id: POINT.mine, count: 1 } },
];

// The app, with the bell's rows answered and the notice call recorded.
// `rpc`: 'ok' answers notify_doc_comment; 'missing' answers as a database
// without the function does.
async function app(page, baseURL, { list = notices(), rpc = 'ok' } = {}) {
  const got = await signedIn(page, baseURL, { rows: pointRows() });
  const calls = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  await page.route(/example\.supabase\.co\/rest\/v1\/(notifications|rpc\/notify_doc_comment)/, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
    if (req.url().includes('rpc/notify_doc_comment')) {
      calls.push(req.postDataJSON());
      return rpc === 'missing'
        ? json({ code: 'PGRST202', message: 'Could not find the function public.notify_doc_comment in the schema cache' }, 404)
        : json(1);
    }
    return json(req.method() === 'GET' ? list : []);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && /Each child in a list|unique "key"|Maximum update depth|notify_doc_comment/.test(t)) errors.push(t);
    if (m.type() === 'warning' && /\[comment-notices\]/.test(t)) errors.push(t);
  });
  await page.goto(`/?board=${BOARD}${LANG ? `&lang=${LANG}` : ''}`);
  await expect(page.locator('.canvas-wrap').first()).toBeVisible({ timeout: 60000 });
  return { ...got, calls, errors };
}

// A notice arriving live, as the user's socket republishes it.
const arrive = (page, n) => page.evaluate(async ({ uid, n }) => {
  const m = await import('/src/lib/notificationBus.js');
  m.publishNotification(uid, n);
}, { uid: UID, n });

// A note with a comment on its words, made as a person makes them
// (tests/note-doc-comments-app.spec.js). Returns the thread's id.
async function noteWithComment(page) {
  await expect(async () => {
    await page.keyboard.press('n');
    await page.mouse.click(640, 300);
    await expect(page.locator('.canvas-wrap .card')).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.keyboard.type('Rewrite the ending');
  await expect(noteBody(page)).toHaveText('Rewrite the ending');
  await expect(async () => {
    await page.keyboard.press('Shift+Home');
    await page.waitForTimeout(250);
    await page.keyboard.press('ControlOrMeta+Alt+m');
    await expect(float(page)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20000 });
  await float(page).locator('textarea').fill('Too abrupt?');
  await float(page).locator('textarea').press('Enter');
  await expect(float(page).locator('.cmt-row')).toHaveCount(1);
  const id = await float(page).getAttribute('data-cmt-card');
  await float(page).locator('.cmt-head .cmt-ib').last().click();     // Close, in any language
  await expect(float(page)).toHaveCount(0);
  await page.mouse.click(900, 300);
  await expect(page.locator('.canvas-wrap .card .note-body[contenteditable="true"]')).toHaveCount(0);
  return id;
}

test('the bell lists comment notices, and a canvas row opens its conversation', async ({ page, baseURL }) => {
  test.setTimeout(180000);
  const a = await app(page, baseURL);
  await expect(bell(page).locator('.nb-count')).toHaveText('2');
  await bell(page).click();
  await expect(panel(page).locator('.ntf-row')).toHaveCount(4);

  // a comment on the canvas: who, the words on one line, and the fold
  const reply = row(page, 'comment.reply');
  await expect(reply).toHaveClass(/is-unread/);
  await expect(reply.locator('.ntf-av')).toHaveText('M');
  if (!LANG) await expect(reply.locator('.ntf-row-title')).toHaveText('Maya Reyes replied in Test Studio');
  await expect(reply.locator('.ntf-row-body')).toContainText('Agreed, and the practical');
  const body = await reply.locator('.ntf-row-body').evaluate((el) => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(body.h).toBeLessThanOrEqual(body.lh + 1);            // one line
  if (!LANG) await expect(reply.locator('.ntf-row-more')).toHaveText('+2 more');
  else await expect(reply.locator('.ntf-row-more')).toContainText('2');
  // the rest: a mention on a doc, a reply on a file (read), a resolve by
  // someone whose name is not known (the comment mark, in ink)
  await expect(row(page, 'doc.mention').locator('.ntf-row-more')).toHaveCount(0);
  await expect(row(page, 'file.replied')).not.toHaveClass(/is-unread/);
  await expect(row(page, 'comment.resolved').locator('.ntf-av svg')).toBeVisible();
  // ink, never gold
  const colours = await panel(page).evaluate((el) => [...el.querySelectorAll('.ntf-av, .ntf-row-more, .ntf-dot')].map((x) => getComputedStyle(x).color + getComputedStyle(x).backgroundColor).join(' '));
  expect(colours).not.toMatch(/255, 165, 0/);
  // nothing in a row is wider than the panel
  const wide = await panel(page).evaluate((el) => [...el.querySelectorAll('.ntf-row *')].filter((x) => x.getBoundingClientRect().right > el.getBoundingClientRect().right + 0.5).length);
  expect(wide).toBe(0);
  await shot(page, `01-bell${LANG ? `-${LANG}` : ''}`);

  // the row opens its conversation, the reply it names lit; it is read
  await reply.click();
  await expect(panel(page)).toHaveCount(0);
  await expect(canvasCard(page).locator(`[data-cmt-card="${POINT.theirs}"]`)).toBeVisible({ timeout: 20000 });
  await expect(canvasCard(page).locator('[data-cmt-row].is-flash')).toHaveAttribute('data-cmt-row', POINT.reply);
  await expect(bell(page).locator('.nb-count')).toHaveText('1');
  await shot(page, `03-landed-canvas${LANG ? `-${LANG}` : ''}`);

  // that conversation is on screen: a live notice about it folds into its row
  // without a toast. The row was read here a moment ago and stays read (the
  // database folds only into a row it holds as unread: mergeNotice), so the
  // bell's number does not go back up.
  await arrive(page, { ...notices()[0], data: { ...notices()[0].data, count: 4 }, body: 'One more thing about the lamp' });
  await page.waitForTimeout(600);
  await expect(page.locator('.toast-msg')).toHaveCount(0);
  await expect(bell(page).locator('.nb-count')).toHaveText('1');

  // a doc notice whose thread is gone says so
  await canvasCard(page).locator('.cmt-head .cmt-ib').last().click();
  await page.keyboard.press('Escape');
  await bell(page).click();
  await expect(panel(page).locator('.ntf-row').first()).toHaveAttribute('data-kind', 'comment.reply');   // the fold went to the top
  await expect(row(page, 'comment.reply').locator('.ntf-row-more')).toContainText('3');
  await row(page, 'doc.mention').click();
  if (!LANG) await expect(toast(page, "That comment isn't here any more")).toBeVisible({ timeout: 20000 });
  expect(a.errors).toEqual([]);
});

test('a comment on a note tells the server; a live notice toasts with Open, which opens the thread', async ({ page, baseURL }) => {
  test.setTimeout(180000);
  const a = await app(page, baseURL, { list: [] });
  const thread = await noteWithComment(page);
  const cardId = await page.locator('.canvas-wrap [data-card-id]').first().getAttribute('data-card-id');
  // the new thread was told to the server, with the cluster, the card and the thread
  await expect.poll(() => a.calls.length, { timeout: 10000 }).toBeGreaterThan(0);
  expect(a.calls[0]).toMatchObject({ p_board: BOARD, p_card: cardId, p_thread: thread, p_kind: 'doc.new', p_excerpt: 'Too abrupt?' });

  const notice = (over = {}) => ({
    id: 201, user_id: UID, kind: 'doc.reply', actor_id: OTHER, board_id: BOARD, read_at: null, created_at: new Date().toISOString(),
    title: 'Maya Reyes replied in Test Studio', body: 'It lands better if she never looks back.',
    data: { board_id: BOARD, card_id: cardId, thread_id: thread, comment_id: thread, count: 1 }, ...over,
  });
  await arrive(page, notice());
  const t = toast(page, 'It lands better if she never looks back.');
  await expect(t).toBeVisible();
  if (!LANG) await expect(t).toHaveText('Maya Reyes replied in Test Studio — It lands better if she never looks back.');
  await expect(bell(page).locator('.nb-count')).toHaveText('1');
  await shot(page, `02-toast${LANG ? `-${LANG}` : ''}`);
  // a fold inside two minutes: the row moves, no second toast
  await arrive(page, notice({ body: 'And cut before the door.', data: { board_id: BOARD, card_id: cardId, thread_id: thread, comment_id: thread, count: 2 } }));
  await page.waitForTimeout(500);
  await expect(toast(page, 'And cut before the door.')).toHaveCount(0);
  await expect(bell(page).locator('.nb-count')).toHaveText('1');
  // a mention's notice never toasts from the bell (the mention has its own)
  await arrive(page, notice({ id: 202, kind: 'doc.mention', body: 'A mention', data: { board_id: BOARD, card_id: cardId, thread_id: 'cm_other', comment_id: 'cm_other', count: 1 } }));
  await page.waitForTimeout(500);
  await expect(toast(page, 'A mention')).toHaveCount(0);
  await expect(bell(page).locator('.nb-count')).toHaveText('2');

  // Open goes to the thread on the note
  await page.locator('.toast-action').first().click();
  await expect(float(page)).toHaveAttribute('data-cmt-card', thread, { timeout: 20000 });
  await expect(float(page).locator('.cmt-row .cmt-text')).toHaveText('Too abrupt?');
  await shot(page, `04-landed-note${LANG ? `-${LANG}` : ''}`);
  expect(a.errors).toEqual([]);
});

test('a database without the notice function: the comment is written and nothing is said', async ({ page, baseURL }) => {
  test.setTimeout(180000);
  test.skip(!!LANG, 'reads the menu by its English name');
  const a = await app(page, baseURL, { list: [], rpc: 'missing' });
  await noteWithComment(page);
  await expect.poll(() => a.calls.length, { timeout: 10000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await expect(page.locator('.toast-msg')).toHaveCount(0);
  await noteBody(page).click({ button: 'right' });
  await expect(page.locator('.ctx-menu').getByRole('menuitem', { name: '1 comment', exact: true })).toBeVisible();
  expect(a.errors).toEqual([]);
});

// A mention in a comment on a doc's or a note's words, from while you were
// away: its own toast, with Open. `columns: false` is a database from before
// the comment notices migration: the read falls back, and nothing breaks.
for (const columns of [true, false]) {
  test(`a mention in a comment says so, with Open${columns ? '' : ' (and a database without the new columns still reads mentions)'}`, async ({ page, baseURL }) => {
    test.setTimeout(180000);
    test.skip(!!LANG, 'reads the toast by its English words');
    const asked = [];
    await signedIn(page, baseURL, { rows: pointRows() });
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await page.route(/example\.supabase\.co\/rest\/v1\/mention_notifications/, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
      if (req.method() !== 'GET') return json([]);
      const wide = /source_kind/.test(decodeURIComponent(req.url()));
      asked.push(wide ? 'wide' : 'base');
      if (wide && !columns) return json({ code: '42703', message: 'column mention_notifications.source_kind does not exist' }, 400);
      const base = { id: 'aaaaaaaa-0000-4000-8000-00000000000a', user_id: UID, mentioned_by: OTHER, thread_id: null, message_id: null, created_at: ago(3), dismissed_at: null };
      return json([wide ? { ...base, board_id: BOARD, source_kind: 'comment', source_card_id: 'card-gone', source_thread_id: 'cm_gone', preview: 'Tess, look at this' } : base]);
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    await page.goto(`/?board=${BOARD}`);
    await expect(page.locator('.canvas-wrap').first()).toBeVisible({ timeout: 60000 });
    if (columns) {
      const t = page.locator('.toast').filter({ hasText: /(Maya Reyes|Someone) mentioned you in a comment/ });   // the name, once the profiles are in
      await expect(t).toBeVisible({ timeout: 20000 });
      await t.locator('.toast-action').click();
      await expect(toast(page, "That comment isn't here any more")).toBeVisible({ timeout: 20000 });
    } else {
      await expect.poll(() => asked.includes('base'), { timeout: 20000 }).toBe(true);
      await page.waitForTimeout(800);
      await expect(page.locator('.toast-msg').filter({ hasText: 'in a comment' })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

// A notice for a comment on a doc whose card is off screen. A card outside
// the view is not drawn, so it cannot hear "open": the card is brought into
// view first (comments/NoteCommentsLayer.jsx), from a toast's Open and from
// the bell's row alike (the mention toast's Open is the same call).
test('a notice for a comment on a doc that is off screen brings the doc into view and opens its thread', async ({ page, baseURL }) => {
  test.setTimeout(240000);
  test.skip(!!LANG, 'reads the doc\'s buttons by their English names');
  const a = await app(page, baseURL, { list: [] });
  const modal = page.locator('.doc-card-modal');
  const thread = (id) => modal.locator(`.cmt-thread.is-open[data-thread="${id}"]`);
  const docCard = page.locator('.canvas-wrap [data-card-id]');

  // a doc with a comment on its words, as note-doc-comments-app.spec.js makes one
  await page.locator('.cnv-empty-tiles').getByRole('button', { name: 'Doc' }).click();
  await expect(modal).toBeVisible({ timeout: 20000 });
  const editor = modal.locator('.tt-editor').first();
  await editor.click();
  await page.keyboard.type('We open on the blue hour alley');
  await expect(editor).toContainText('We open on the blue hour alley');
  await expect(async () => {
    await page.keyboard.press('Shift+Home');
    await page.waitForTimeout(250);
    await page.keyboard.press('Control+Alt+m');
    await expect(float(page)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20000 });
  await float(page).locator('textarea').fill('Earlier than this?');
  await float(page).locator('textarea').press('Enter');
  await expect(float(page)).toHaveCount(0);
  const id = await modal.locator('.tt-comment').first().getAttribute('data-comment-id');
  await expect(thread(id)).toBeVisible();
  const closeDoc = async () => {
    await modal.getByRole('button', { name: 'Close document' }).click();
    await expect(modal).toHaveCount(0);
    await page.keyboard.press('Escape');
  };
  await closeDoc();
  const cardId = await docCard.first().getAttribute('data-card-id');

  // pan until the doc's card is no longer drawn
  const away = async () => {
    await expect(async () => {
      await page.mouse.move(900, 200);   // empty canvas: a wheel there pans
      await page.mouse.wheel(2600, 2000);
      await expect(docCard).toHaveCount(0, { timeout: 1500 });
    }).toPass({ timeout: 30000 });
  };
  await away();

  const notice = {
    id: 301, user_id: UID, kind: 'doc.reply', actor_id: OTHER, board_id: BOARD, read_at: null, created_at: new Date().toISOString(),
    title: 'Maya Reyes replied in Test Studio', body: 'Start on the neon instead.',
    data: { board_id: BOARD, card_id: cardId, thread_id: id, comment_id: id, count: 1 },
  };
  // the toast's Open
  await arrive(page, notice);
  await expect(toast(page, 'Start on the neon instead.')).toBeVisible();
  await page.locator('.toast-action').first().click();
  await expect(modal).toBeVisible({ timeout: 20000 });
  await expect(thread(id)).toBeVisible({ timeout: 20000 });
  await expect(toast(page, "That comment isn't here any more")).toHaveCount(0);

  // the bell's row, with the card off screen again
  await closeDoc();
  await away();
  await bell(page).click();
  await row(page, 'doc.reply').click();
  await expect(modal).toBeVisible({ timeout: 20000 });
  await expect(thread(id)).toBeVisible({ timeout: 20000 });
  expect(a.errors).toEqual([]);
});

// A copied comment link names the cluster and the comment, not the workspace.
// When the cluster is in another of the person's own workspaces, the app
// switches to it and opens the conversation there.
test('a comment link to a cluster in another of your workspaces switches workspace and opens the conversation', async ({ page, baseURL }) => {
  test.setTimeout(180000);
  const WS2 = '77777777-7777-4777-8777-777777777778';
  const BOARD2 = '55555555-5555-4555-8555-555555555556';
  await signedIn(page, baseURL, { rows: pointRows().map((r) => ({ ...r, workspace_id: WS2, board_id: BOARD2 })) });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const old = new Date(Date.now() - 9e8).toISOString();
  const ws = (id, name) => ({ id, name, owner: UID, created_at: old, ...(id === WS ? { kind: 'personal' } : {}) });
  const board = (id, w, name) => ({
    id, workspace_id: w, parent_board_id: null, name, title: name, deleted_at: null,
    created_at: old, updated_at: old, created_by: UID, view: 'canvas', position: 0,
  });
  const all = [board(BOARD, WS, 'Test Studio'), board(BOARD2, WS2, 'Second Studio')];
  await page.route(/example\.supabase\.co\/rest\/v1\/(workspace_members|boards)\b/, async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') return route.fallback();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
    const u = new URL(req.url());
    if (u.pathname.endsWith('/workspace_members')) {
      return json([WS, WS2].map((id) => ({ workspace_id: id, role: 'owner', created_at: old, user_id: UID, workspaces: ws(id, id === WS ? 'Test Studio' : 'Second Studio') })));
    }
    const eq = (k) => (u.searchParams.get(k) || '').replace(/^eq\./, '');
    const list = all.filter((b) => (!eq('workspace_id') || b.workspace_id === eq('workspace_id')) && (!eq('id') || b.id === eq('id')));
    if ((req.headers().accept || '').includes('vnd.pgrst.object')) {
      return list.length ? json(list[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406);
    }
    return json(list);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.goto(`/?board=${BOARD2}&comment=${POINT.reply}${LANG ? `&lang=${LANG}` : ''}`);
  await expect(canvasCard(page).locator(`[data-cmt-card="${POINT.theirs}"]`)).toBeVisible({ timeout: 60000 });
  await expect(canvasCard(page).locator('[data-cmt-row].is-flash')).toHaveAttribute('data-cmt-row', POINT.reply);
  await expect(page.locator('.toast-msg')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('comment')).toBe(null);
  expect(errors).toEqual([]);
});
