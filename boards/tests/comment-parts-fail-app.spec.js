// comment-parts-fail-app.spec.js
//
// A note and a doc on a real cluster (the signed-in app, tests/commentApp.js
// answers Supabase) when the comment parts cannot be fetched: the lazy chunk
// every comment surface shares (components/comments/commentParts.js, behind
// commentPartsLazy.jsx). Nothing of the note or the doc depends on it: they
// open, their words are still written, a press on a comment control says the
// comments could not load (never nothing, never a blank page), the page is
// not reloaded while the network is dead, and once the chunk can be had the
// next press gets it and the comment opens.
//
// "Gets it": a browser that fetches a failed import() again opens the comment
// on that press. Chromium keeps the failure for the address, so there the
// press takes the one reload a failed chunk is allowed once the site answers
// (lib/commentChunkReload.js), the words written so far come back with the
// cluster, and the press after it opens the comment. Either way it is never
// a second reload.
//
// The chunk that only a failure needs (commentChunkFail.js, with the reload
// rule in lib/commentChunkReload.js) may be gone too: a press still says so
// in plain words, and each press asks for that chunk again at its own address
// with ?again=n added.
//
// A reload is for a chunk a deploy replaced: only when the site answers
// (/robots.txt), and once per build per tab. The last test is that one.
//
// The harness half (?docqa, ?noteqa) is tests/comment-parts-fail.spec.js; the
// canvas's is in tests/canvas-comment-pins.spec.js.

import { expect, test } from '@playwright/test';
import { signedIn, BOARD } from './commentApp.js';

const PARTS = /\/components\/comments\/commentParts\.js/;
const FAIL = /\/components\/comments\/commentChunkFail\.js/;
const PROBE = /\/robots\.txt/;
const SAID = "Comments couldn't load. Check your connection.";
const said = (page) => page.locator('.toast-msg').filter({ hasText: SAID });
const crashed = (page) => page.getByText("Couldn't load this page");
const float = (page) => page.locator('.cmt-float-host .cmt-card');
const noteBody = (page) => page.locator('.canvas-wrap .card .note-body');

// The network, as the test sets it. Registered after signedIn, so these
// answer first.
//   failToo   the failure's own chunk cannot be fetched either
//   answers   the site answers the probe (so a reload is allowed)
async function badNetwork(page, { failToo = false, answers = false } = {}) {
  const net = { down: true, parts: 0, fail: [], probes: 0 };
  await page.route(PARTS, (route) => { net.parts += 1; return net.down ? route.abort() : route.fallback(); });
  await page.route(PROBE, (route) => {
    net.probes += 1;
    return answers || !net.down ? route.fulfill({ status: 200, contentType: 'text/plain', body: 'User-agent: *\n' }) : route.abort();
  });
  if (failToo) {
    await page.route(FAIL, (route) => { net.fail.push(route.request().url()); return net.down ? route.abort() : route.fallback(); });
  }
  return net;
}

// The cluster, open, and a count of every time the page loads after that.
async function openCluster(page) {
  await page.goto(`/?board=${BOARD}`);
  await expect(page.locator('.canvas-wrap').first()).toBeVisible({ timeout: 60000 });
  const seen = { loads: 0 };
  page.on('load', () => { seen.loads += 1; });
  await page.evaluate(() => { window.__same = true; });
  return seen;
}

// Nothing reloaded, nothing crashed, nothing half-made.
async function untouched(page, seen, scope) {
  await expect(crashed(page)).toHaveCount(0);
  await expect(float(page)).toHaveCount(0);
  await expect(scope.locator('.cmt-pending')).toHaveCount(0);
  await expect(scope.locator('.tt-comment')).toHaveCount(0);
  expect(await page.evaluate(() => window.__same === true)).toBe(true);
  expect(seen.loads).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('soleil:comment-chunk-reloaded'))).toBe(null);
}

// The message, then gone again (the toast is dismissed), so the next press's
// message is its own.
async function saidOnce(page) {
  await expect(said(page).first()).toBeVisible();
  await expect(said(page)).toHaveCount(0, { timeout: 15000 });
}

// The network is back (the chunk and the probe both answer). `press` asks
// for a comment and resolves when `opened()` shows; where the browser kept
// the failed fetch, the first press reloads the page instead, `reenter` puts
// the caret back in the words, and the press after that opens it.
async function backAndOpens(page, app, net, seen, { press, reenter, opened }) {
  // what was written is saved before anything can reload
  await expect.poll(() => app.state.saves, { timeout: 20000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  net.down = false;
  let direct = true;
  try { await press(3000); } catch (_) { direct = false; }
  if (!direct) {
    await expect.poll(() => seen.loads, { timeout: 20000 }).toBe(1);
    await expect(page.locator('.canvas-wrap').first()).toBeVisible({ timeout: 60000 });
    await page.evaluate(() => { window.__same = true; });
    await reenter();
    await press(20000);
  }
  await expect(opened()).toBeVisible();
  await expect(crashed(page)).toHaveCount(0);
  expect(seen.loads).toBe(direct ? 0 : 1);
  expect(await page.evaluate(() => window.__same === true)).toBe(true);
}

// The again-numbers the failure's chunk was asked for at, in order.
const againNumbers = (net) => net.fail.map((u) => new URL(u).searchParams.get('again')).filter(Boolean).map(Number);

// ── a note ───────────────────────────────────────────────────────────────
// N, a click, the words: the note is left being written.
async function noteWithWords(page) {
  // (on a busy machine the canvas can be on screen a moment before it hears
  // keys: N again until the click makes the note)
  await expect(async () => {
    await page.keyboard.press('n');
    await page.mouse.click(640, 400);
    await expect(page.locator('.canvas-wrap .card')).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.keyboard.type('Rewrite the ending');
  await expect(noteBody(page)).toHaveText('Rewrite the ending');
}
// ⌘⌥M on the note's words. ProseMirror picks a keyboard selection up a tick
// after the keypress, and the shortcut does nothing on an empty one.
async function pressNoteComment(page, landed, timeout = 20000) {
  await expect(async () => {
    await page.keyboard.press('Shift+Home');
    await page.waitForTimeout(250);
    await page.keyboard.press('ControlOrMeta+Alt+m');
    await expect(landed()).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout });
}
// Back into the note's words after a reload, the caret at their end.
async function reenterNote(page, words) {
  await expect(noteBody(page)).toHaveText(words, { timeout: 20000 });
  await noteBody(page).dblclick();
  await page.locator('.canvas-wrap .card .note-body[contenteditable="true"]').waitFor();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ArrowRight');
}
async function typeMoreInNote(page, more, whole) {
  await page.locator('.canvas-wrap .card .note-body[contenteditable="true"]').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(more);
  await expect(noteBody(page)).toHaveText(whole);
}

test.describe('a note on a real cluster, the comment parts not to be had', () => {
  test('⌘⌥M says so and reloads nothing; the note is still written; once the chunk can be had the comment opens', async ({ page, baseURL }) => {
    const app = await signedIn(page, baseURL);
    const net = await badNetwork(page);
    const seen = await openCluster(page);
    await noteWithWords(page);
    const wrap = page.locator('.canvas-wrap');

    await pressNoteComment(page, () => said(page).first());
    expect(net.parts).toBeGreaterThan(0);
    await untouched(page, seen, wrap);
    await typeMoreInNote(page, ', gently', 'Rewrite the ending, gently');

    // again: the same plain message, still no reload
    await saidOnce(page);
    await pressNoteComment(page, () => said(page).first());
    await untouched(page, seen, wrap);
    await expect(noteBody(page)).toHaveText('Rewrite the ending, gently');

    // the chunk can be had: the comment opens, and is written
    await backAndOpens(page, app, net, seen, {
      press: (ms) => pressNoteComment(page, () => float(page), ms),
      reenter: () => reenterNote(page, 'Rewrite the ending, gently'),
      opened: () => float(page),
    });
    await float(page).locator('textarea').fill('Too abrupt?');
    await float(page).locator('textarea').press('Enter');
    await expect(float(page).locator('.cmt-row .cmt-text')).toHaveText('Too abrupt?');
    await expect(wrap.locator('.tt-comment')).toHaveCount(1);
    await expect(noteBody(page)).toHaveText('Rewrite the ending, gently');
  });

  test('with the failure\'s own chunk gone too, each press still says so and asks for it again at ?again=n', async ({ page, baseURL }) => {
    const app = await signedIn(page, baseURL);
    const net = await badNetwork(page, { failToo: true });
    const seen = await openCluster(page);
    // it was asked for as the canvas mounted, and did not come
    await expect.poll(() => net.fail.length, { timeout: 20000 }).toBeGreaterThan(0);
    expect(againNumbers(net)).toEqual([]);
    await noteWithWords(page);
    const wrap = page.locator('.canvas-wrap');

    await pressNoteComment(page, () => said(page).first());
    await expect.poll(() => againNumbers(net).length).toBeGreaterThan(0);
    const first = againNumbers(net);
    expect(first[0]).toBe(1);
    await untouched(page, seen, wrap);
    await typeMoreInNote(page, ', gently', 'Rewrite the ending, gently');

    // the next press asks again, at a new address each time
    await saidOnce(page);
    await pressNoteComment(page, () => said(page).first());
    await expect.poll(() => againNumbers(net).length).toBeGreaterThan(first.length);
    const all = againNumbers(net);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual([...all].sort((a, b) => a - b));
    await untouched(page, seen, wrap);

    // both can be had: the comment opens
    await backAndOpens(page, app, net, seen, {
      press: (ms) => pressNoteComment(page, () => float(page), ms),
      reenter: () => reenterNote(page, 'Rewrite the ending, gently'),
      opened: () => float(page),
    });
    await float(page).locator('textarea').fill('Too abrupt?');
    await float(page).locator('textarea').press('Enter');
    await expect(float(page).locator('.cmt-row .cmt-text')).toHaveText('Too abrupt?');
  });

  test('a site that answers: the one reload a replaced chunk needs, then a press only says so', async ({ page, baseURL }) => {
    const app = await signedIn(page, baseURL);
    const net = await badNetwork(page, { answers: true });
    const seen = await openCluster(page);
    await noteWithWords(page);
    // the note is saved before the press that reloads
    await page.mouse.click(200, 650);
    await expect.poll(() => app.state.saves, { timeout: 20000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);

    const again = async () => {
      await noteBody(page).dblclick();
      await page.locator('.canvas-wrap .card .note-body[contenteditable="true"]').waitFor();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('ArrowRight');
    };
    await again();
    const reloaded = page.waitForEvent('load');
    await expect(async () => {
      await page.keyboard.press('Shift+Home');
      await page.waitForTimeout(250);
      await page.keyboard.press('ControlOrMeta+Alt+m');
      await expect.poll(() => seen.loads, { timeout: 3000 }).toBe(1);
    }).toPass({ timeout: 20000 });
    await reloaded;
    expect(net.probes).toBeGreaterThan(0);
    await expect(page.locator('.canvas-wrap').first()).toBeVisible({ timeout: 60000 });
    await expect(noteBody(page)).toHaveText('Rewrite the ending', { timeout: 20000 });
    expect(await page.evaluate(() => sessionStorage.getItem('soleil:comment-chunk-reloaded'))).toBeTruthy();

    // that reload was this tab's, on this build: long after it (the ten
    // seconds the app's reloads share are over) a press only says so
    await page.evaluate(() => { sessionStorage.removeItem('soleil:chunk-reload-at'); window.__same = true; });
    await again();
    await pressNoteComment(page, () => said(page).first());
    await page.waitForTimeout(1500);
    expect(seen.loads).toBe(1);
    expect(await page.evaluate(() => window.__same === true)).toBe(true);
    await expect(crashed(page)).toHaveCount(0);
    await expect(float(page)).toHaveCount(0);
    await typeMoreInNote(page, ', gently', 'Rewrite the ending, gently');
  });
});

// ── a doc ────────────────────────────────────────────────────────────────
test.describe('a doc on a real cluster, the comment parts not to be had', () => {
  const modal = (page) => page.locator('.doc-card-modal');
  const editor = (page) => modal(page).locator('.tt-editor').first();
  const panel = (page) => modal(page).getByRole('complementary', { name: 'Comments and find' });
  // The doc's shortcut is the editor's own Mod-Alt-M, and Mod follows the
  // platform the page reports: this project reports Windows, whatever it runs on.
  const COMMENT_KEY = 'Control+Alt+m';

  async function docWithWords(page) {
    await page.locator('.cnv-empty-tiles').getByRole('button', { name: 'Doc' }).click();
    await expect(modal(page)).toBeVisible({ timeout: 20000 });
    await editor(page).click();
    await page.keyboard.type('We open on the blue hour alley');
    await expect(editor(page)).toContainText('We open on the blue hour alley');
  }
  async function pressDocComment(page, landed, timeout = 20000) {
    await expect(async () => {
      await page.keyboard.press('Shift+Home');
      await page.waitForTimeout(250);
      await page.keyboard.press(COMMENT_KEY);
      await expect(landed()).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout });
  }
  // Back into the doc's words after a reload (a doc left open comes back
  // open; one that did not is opened from its card), the caret at their end.
  async function reenterDoc(page, words) {
    try { await expect(modal(page)).toBeVisible({ timeout: 8000 }); } catch (_) {
      await page.locator('.canvas-wrap [data-card-id]').first().dblclick();
      await expect(modal(page)).toBeVisible({ timeout: 20000 });
    }
    await expect(editor(page)).toContainText(words, { timeout: 20000 });
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ArrowRight');
  }
  async function typeMoreInDoc(page, more, whole) {
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type(more);
    await expect(editor(page)).toContainText(whole);
  }
  const commentsButton = (page) => modal(page).locator('.dl-head').getByRole('button', { name: /^Comments/ });

  test('⌘⌥M and the Comments button say so and reload nothing; the doc is still written; once the chunk can be had the comment opens', async ({ page, baseURL }) => {
    const app = await signedIn(page, baseURL);
    const net = await badNetwork(page);
    const seen = await openCluster(page);
    await docWithWords(page);

    await pressDocComment(page, () => said(page).first());
    expect(net.parts).toBeGreaterThan(0);
    await untouched(page, seen, modal(page));
    await expect(modal(page)).toBeVisible();
    await typeMoreInDoc(page, '. Rain starts', 'blue hour alley. Rain starts');

    // the Comments button: the same plain message, no panel half-made
    await saidOnce(page);
    await commentsButton(page).click();
    await expect(said(page).first()).toBeVisible();
    await expect(modal(page).locator('.cmt-thread, .cmt-list-row')).toHaveCount(0);
    await untouched(page, seen, modal(page));
    await typeMoreInDoc(page, ', hard', 'Rain starts, hard');

    // the chunk can be had: the comment opens, and is written
    await backAndOpens(page, app, net, seen, {
      press: (ms) => pressDocComment(page, () => float(page), ms),
      reenter: () => reenterDoc(page, 'Rain starts, hard'),
      opened: () => float(page),
    });
    await expect(modal(page).locator('.cmt-pending').first()).toBeVisible();
    await float(page).locator('textarea').fill('Earlier than this?');
    await float(page).locator('textarea').press('Enter');
    await expect(float(page)).toHaveCount(0);
    const id = await modal(page).locator('.tt-comment').first().getAttribute('data-comment-id');
    const thread = panel(page).locator(`.cmt-thread.is-open[data-thread="${id}"]`);
    await expect(thread.locator('.cmt-text')).toHaveText('Earlier than this?');
    await expect(editor(page)).toContainText('Rain starts, hard');
  });

  test('with the failure\'s own chunk gone too, each press still says so and asks for it again at ?again=n', async ({ page, baseURL }) => {
    const app = await signedIn(page, baseURL);
    const net = await badNetwork(page, { failToo: true });
    const seen = await openCluster(page);
    await expect.poll(() => net.fail.length, { timeout: 20000 }).toBeGreaterThan(0);
    await docWithWords(page);

    await pressDocComment(page, () => said(page).first());
    await expect.poll(() => againNumbers(net).length).toBeGreaterThan(0);
    const first = againNumbers(net);
    expect(first[0]).toBe(1);
    await untouched(page, seen, modal(page));
    await typeMoreInDoc(page, '. Rain starts', 'blue hour alley. Rain starts');

    await saidOnce(page);
    await commentsButton(page).click();
    await expect(said(page).first()).toBeVisible();
    await expect.poll(() => againNumbers(net).length).toBeGreaterThan(first.length);
    const all = againNumbers(net);
    expect(new Set(all).size).toBe(all.length);
    await untouched(page, seen, modal(page));

    // both can be had: the comment opens
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ArrowRight');
    await backAndOpens(page, app, net, seen, {
      press: (ms) => pressDocComment(page, () => float(page), ms),
      reenter: () => reenterDoc(page, 'blue hour alley. Rain starts'),
      opened: () => float(page),
    });
    await expect(modal(page).locator('.cmt-pending').first()).toBeVisible();
  });
});
