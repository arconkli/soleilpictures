// canvas-comment-parts-hold.spec.js
//
// A held finger on the canvas's comment parts, on a real cluster (the
// signed-in app, tests/commentApp.js answers Supabase), not a QA harness: a
// pin, the comments island, the list behind it and the open conversation (a
// card beside its pin on a tablet, a sheet on a phone). A hold there is not a
// hold on the canvas: no canvas menu and no card menu, no hold-to-select ring
// or box, and no buzz, since nothing opened. Letting go is a press, slowly,
// and does what a press does; a tap still does too.
//
// A hold on empty canvas beside them does all of that (ring, buzz, menu), so
// the counts below mean something. Holds need CDP touch: Chromium only
// (helpers.js). The right-click half is tests/canvas-comment-parts-app.spec.js.

import { expect, test } from '@playwright/test';
import { signedIn, pointRows, BOARD, POINT, UID } from '../commentApp.js';
import { needsHold, tap, touchDown, touchUp } from './helpers.js';

const pin = (page, id) => page.locator(`[data-cmt-pin="${id}"]`);
const island = (page) => page.locator('.cnv-comments-eye');
const list = (page) => page.locator('.cmt-list');
// the open conversation: a card on a tablet, a sheet on a phone
const open = (page, id) => page.locator(`.cmt-canvas-card [data-cmt-card="${id}"], .cmt-sheet-host [data-cmt-card="${id}"]`);
const anyOpen = (page) => page.locator('.cmt-canvas-card, .cmt-sheet-host');
const menu = (page) => page.locator('.ctx-menu');
const buzzes = (page) => page.evaluate(() => window.__vib.length);
const centre = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });

// What a hold on the canvas starts: the ring, a selection box, a menu, a
// selected card, the add menu.
async function nothingOfTheCanvas(page) {
  await expect(page.locator('.cnv-hold-cue.is-on')).toHaveCount(0);
  await expect(page.locator('.canvas-wrap .marquee')).toHaveCount(0);
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator('.canvas-wrap .card.is-selected')).toHaveCount(0);
  await expect(page.locator('.cnv-quick-add')).toHaveCount(0);
  await expect(page.locator('.cnv-hint[data-hint="touch_select"]')).toHaveCount(0);
}

// A finger held on `loc` for 700 ms, then lifted: nothing of the canvas's
// while it is down or after, and not one buzz.
async function heldOn(page, loc) {
  const before = await buzzes(page);
  // (it has stopped moving, and a finger there lands on it)
  await loc.tap({ trial: true });
  const p = await centre(loc);
  await touchDown(page, [p]);
  await page.waitForTimeout(700);
  await nothingOfTheCanvas(page);
  expect(await buzzes(page)).toBe(before);
  await touchUp(page);
  await page.waitForTimeout(400);
  await nothingOfTheCanvas(page);
  expect(await buzzes(page)).toBe(before);
}

// A point on the canvas with nothing but the board under it.
async function emptyPoint(page) {
  const pt = await page.evaluate(() => {
    const b = document.querySelector('.canvas-wrap').getBoundingClientRect();
    for (let fy = 0.3; fy < 0.85; fy += 0.05) {
      for (let fx = 0.9; fx > 0.1; fx -= 0.05) {
        const x = b.left + b.width * fx; const y = b.top + b.height * fy;
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('.canvas-wrap') && ['cards-layer', 'canvas-wrap', 'grain-canvas', 'cnv-ground'].some((c) => el.classList.contains(c))) return { x, y };
      }
    }
    return null;
  });
  if (!pt) throw new Error('no empty canvas point found');
  return pt;
}

async function closeOpen(page) {
  await anyOpen(page).getByRole('button', { name: 'Close' }).first().tap();
  await expect(anyOpen(page)).toHaveCount(0);
}
async function closeList(page) {
  if (await list(page).count()) await list(page).locator('.cmt-list-head').getByRole('button', { name: 'Close' }).tap();
  await expect(list(page)).toHaveCount(0);
}

test('a held finger on a pin, the island, the list or the open conversation opens no other menu, selects nothing and does not buzz; a tap still works', async ({ page, baseURL, browserName }) => {
  needsHold(test, browserName);
  await page.addInitScript((uid) => {
    window.__vib = [];
    Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: function (p) { window.__vib.push(p); return true; } });
    // the one-time "New" hint on the Files card (lib/whatsNew.js) would land
    // over the comments list on a tablet, mid-hold: seen already
    try { localStorage.setItem(`soleil.whatsnew.files_card.${uid}`, '1'); } catch (_) { /* then it shows */ }
  }, UID);
  await signedIn(page, baseURL, { rows: pointRows() });
  await page.goto(`/?board=${BOARD}`);
  await expect(page.locator('.canvas-wrap').first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.cmt-pin[data-cmt-pin], .cmt-pin--count').first()).toBeAttached({ timeout: 30000 });
  // a card on the cluster, as a cluster with comments has: an empty one
  // shows its first-card tiles over the middle of the canvas
  await page.locator('.cnv-empty-tiles').getByRole('button', { name: 'Note' }).tap();
  await expect(page.locator('.canvas-wrap .card')).toHaveCount(1);
  await page.keyboard.type('Dusk set');
  await expect(page.locator('.cnv-empty-tiles')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.canvas-wrap .card .note-body[contenteditable="true"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.canvas-wrap .card.is-selected')).toHaveCount(0);
  await nothingOfTheCanvas(page);
  await page.waitForTimeout(900);

  // the check means something: a hold on empty canvas fills the ring, buzzes
  // and opens the canvas's menu
  const empty = await emptyPoint(page);
  const b0 = await buzzes(page);
  await touchDown(page, [empty]);
  await page.waitForTimeout(700);
  await expect(page.locator('.cnv-hold-cue.is-on')).toBeVisible();
  await touchUp(page);
  await expect(menu(page).first()).toBeVisible();
  expect(await buzzes(page)).toBeGreaterThan(b0);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await page.waitForTimeout(400);

  // the island: a hold is a slow press, and opens the list
  await heldOn(page, island(page));
  await expect(list(page)).toBeVisible();
  await expect(island(page)).toHaveAttribute('aria-expanded', 'true');

  // the list: a hold on a row is a slow press on it, and opens its
  // conversation (which also brings its pin into view)
  const row = list(page).locator('.cmt-list-row').filter({ hasText: 'Leave this corner open' });
  await heldOn(page, list(page).locator('.cmt-list-title'));
  await expect(list(page)).toBeVisible();
  await heldOn(page, row);
  await expect(open(page, POINT.theirs)).toBeVisible();

  // the open conversation: a hold on a comment in it leaves it as it is
  await heldOn(page, open(page, POINT.theirs).locator('[data-cmt-row] .cmt-text').first());
  await expect(open(page, POINT.theirs)).toBeVisible();
  await expect(open(page, POINT.theirs).locator('[data-cmt-row]')).toHaveCount(2);
  await closeOpen(page);
  await closeList(page);

  // a pin: a hold is a slow press, and opens its conversation where it is
  const p = pin(page, POINT.theirs);
  await expect(p).toBeInViewport();
  const was = await centre(p);
  await heldOn(page, p);
  await expect(open(page, POINT.theirs)).toBeVisible();
  await closeOpen(page);
  await closeList(page);
  const now = await centre(p);
  expect(Math.abs(now.x - was.x) + Math.abs(now.y - was.y)).toBeLessThan(2);

  // and taps are still taps
  await tap(page, await centre(p));
  await expect(open(page, POINT.theirs)).toBeVisible();
  await closeOpen(page);
  await closeList(page);
  await tap(page, await centre(island(page)));
  await expect(list(page)).toBeVisible();
  await row.tap();
  await expect(open(page, POINT.theirs)).toBeVisible();
  await nothingOfTheCanvas(page);
});
