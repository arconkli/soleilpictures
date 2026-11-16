// canvas-comment-parts-app.spec.js
//
// A right-click on the canvas's comment parts, on a real cluster (the
// signed-in app, tests/commentApp.js answers Supabase), not a QA harness: a
// pin, the comments island, the list behind it and the open conversation.
// None of them is the canvas or a card, so none opens the canvas's menu or a
// card's, even where a card lies under the pin; and the part that was
// right-clicked is left as it was. A right-click beside them still opens the
// canvas's menu, and one on the card its own.
//
// The held finger's half is tests/touch/canvas-comment-parts-hold.spec.js.

import { expect, test } from '@playwright/test';
import { signedIn, pointRows, BOARD, POINT } from './commentApp.js';

const pin = (page, id) => page.locator(`[data-cmt-pin="${id}"]`);
const island = (page) => page.locator('.cnv-comments-eye');
const list = (page) => page.locator('.cmt-list');
const card = (page) => page.locator('.cmt-canvas-card');
const menu = (page) => page.locator('.ctx-menu');
const centre = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });

async function openCluster(page, baseURL) {
  await signedIn(page, baseURL, { rows: pointRows() });
  await page.goto(`/?board=${BOARD}`);
  await expect(page.locator('.canvas-wrap').first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.cmt-pin[data-cmt-pin]')).toHaveCount(2, { timeout: 30000 });
}

// No menu of the canvas's or a card's came of it, now or a moment later.
async function noMenu(page) {
  await page.waitForTimeout(350);
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator('.canvas-wrap .card.is-selected')).toHaveCount(0);
}

test('a right-click on a pin, the island, the list or the open conversation opens no canvas menu and no card menu', async ({ page, baseURL }) => {
  await openCluster(page, baseURL);

  // a note on the cluster, lying under the first pin: a right-click on that
  // pin is over a card, and is still the pin's
  const at = await centre(pin(page, POINT.theirs));
  await page.keyboard.press('n');
  await page.mouse.click(at.x, at.y - 60);
  await page.keyboard.type('The corner, the title, the last light of the day');
  const note = page.locator('.canvas-wrap .card').first();
  await expect(note).toBeVisible();
  const empty = { x: 1100, y: 640 };
  await page.mouse.click(empty.x, empty.y);
  await expect(page.locator('.canvas-wrap .card .note-body[contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator('.canvas-wrap .card.is-selected')).toHaveCount(0);
  const p = await centre(pin(page, POINT.theirs));
  const under = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).map((el) => (el.closest('.cmt-pin') ? 'pin' : el.closest('.card') ? 'card' : '')).filter(Boolean), p);
  expect(under[0]).toBe('pin');
  expect(under).toContain('card');

  // the check means something: beside them, the canvas's menu and the card's
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await expect(menu(page).getByRole('menuitem', { name: 'Select all' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  const nb = await note.boundingBox();
  await page.mouse.click(nb.x + 12, nb.y + nb.height - 8, { button: 'right' });
  await expect(menu(page).getByRole('menuitem', { name: /^Delete$/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await page.mouse.click(empty.x, empty.y);
  await expect(page.locator('.canvas-wrap .card.is-selected')).toHaveCount(0);

  // a pin (over the card): nothing opens, not even the conversation
  await pin(page, POINT.theirs).click({ button: 'right' });
  await noMenu(page);
  await expect(card(page)).toHaveCount(0);
  await expect(pin(page, POINT.theirs)).not.toHaveClass(/is-open/);
  await pin(page, POINT.mine).click({ button: 'right' });
  await noMenu(page);

  // the island: no menu, and the list is not opened by it
  await island(page).click({ button: 'right' });
  await noMenu(page);
  await expect(list(page)).toHaveCount(0);

  // the list: no menu, and it stays open
  await island(page).click();
  await expect(list(page)).toBeVisible();
  const row = list(page).locator('.cmt-list-row').filter({ hasText: 'Leave this corner open' });
  await row.click({ button: 'right' });
  await noMenu(page);
  await expect(list(page)).toBeVisible();
  await list(page).locator('.cmt-list-head').click({ button: 'right', position: { x: 20, y: 10 } });
  await noMenu(page);
  await expect(list(page)).toBeVisible();

  // the open conversation: no menu, and it stays open on the same comment
  await row.click();
  const open = card(page).locator(`[data-cmt-card="${POINT.theirs}"]`);
  await expect(open).toBeVisible();
  await open.locator('[data-cmt-row]').first().click({ button: 'right' });
  await noMenu(page);
  await expect(open).toBeVisible();
  await open.locator('.cmt-head').click({ button: 'right', position: { x: 12, y: 8 } });
  await noMenu(page);
  await expect(open).toBeVisible();
  // its pin, while open
  await pin(page, POINT.theirs).click({ button: 'right' });
  await noMenu(page);
  await expect(open).toBeVisible();
  await expect(pin(page, POINT.theirs)).toHaveClass(/is-open/);

  // and a press is still a press
  await open.getByRole('button', { name: 'Close' }).click();
  await expect(card(page)).toHaveCount(0);
  await pin(page, POINT.mine).click();
  await expect(card(page).locator(`[data-cmt-card="${POINT.mine}"]`)).toBeVisible();
});
