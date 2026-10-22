// On a phone the doc look's side panel (held to a dev opt-in, lib/appHost.js
// docLookAllowed) is a sheet from the bottom (mockup C-phone2): over the
// whole doc, header too, which dims; a tap on the dimmed doc, its grab, a
// drag down or Escape puts it away; a doc opens with it put away, whatever
// was left open on a computer; and a card's words, or a hit Find lists, are
// shown with the sheet out of their way. Driven in the ?docqa=1 harness.

import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone-width only (≤640px)');
});

async function openDoc(page, { panelOpen = false } = {}) {
  await page.addInitScript((open) => {
    try {
      window.localStorage.setItem('soleil.dev.docLook', '1');
      if (open) window.localStorage.setItem('soleil.boards.docPanel', JSON.stringify({ open: true, tab: 'comments' }));
    } catch (_) {}
  }, panelOpen);
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(modal(page)).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const modal = (page) => page.locator('.doc-card-modal');
const sheet = (page) => page.getByRole('complementary', { name: 'Comments and find' });
const toggle = (page) => modal(page).locator('.dl-head').getByRole('button', { name: /^Comments/ });
// Once it has come up, or gone back up after a short drag.
const settled = (page) => sheet(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

async function comment(page, text, word, body) {
  return page.evaluate(({ text, word, body }) => {
    const T = window.__soleilDocTest;
    const ed = T.editor;
    ed.commands.setContent(`<p>${text}</p>`);
    const from = text.indexOf(word) + 1;
    const id = T.addCommentThread(T.ydoc, { body, author: 'Maya Chen', authorId: 'u-maya', scope: T.getScope() });
    ed.chain().setTextSelection({ from, to: from + word.length }).setMark('comment', { id }).run();
    return id;
  }, { text, word, body });
}

test('a doc opens with the sheet put away, even left open on a computer', async ({ page }) => {
  await openDoc(page, { panelOpen: true });
  await expect(sheet(page)).toHaveCount(0);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
});

test('the sheet comes up from the bottom over the whole doc, and a tap on the doc puts it away', async ({ page }) => {
  await openDoc(page);
  await toggle(page).tap();
  await expect(sheet(page)).toBeVisible();
  await settled(page);
  const vp = page.viewportSize();
  const box = await sheet(page).boundingBox();
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(vp.width);
  expect(Math.abs(box.y + box.height - vp.height)).toBeLessThan(2);
  expect(box.height).toBeGreaterThan(vp.height * 0.5);
  // It takes the focus, on its tab.
  await expect(sheet(page).getByRole('tab', { name: /^Comments/ })).toBeFocused();
  // The header is under the dimming too.
  const tb = await toggle(page).boundingBox();
  const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [tb.x + tb.width / 2, tb.y + tb.height / 2]);
  expect(top).toContain('dl-sheet-scrim');
  await page.touchscreen.tap(vp.width / 2, 60);
  await expect(sheet(page)).toHaveCount(0);
});

test('the grab puts the sheet away, by a tap or a drag down', async ({ page }) => {
  await openDoc(page);
  await toggle(page).tap();
  const grab = sheet(page).getByRole('button', { name: 'Close panel' });
  await grab.tap();
  await expect(sheet(page)).toHaveCount(0);

  await toggle(page).tap();
  await expect(sheet(page)).toBeVisible();
  await settled(page);
  const g = await sheet(page).getByRole('button', { name: 'Close panel' }).boundingBox();
  const x = g.x + g.width / 2;
  const y = g.y + g.height / 2;
  // A short drag lets it back up.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 30, { steps: 4 });
  await page.mouse.up();
  await expect(sheet(page)).toBeVisible();
  await settled(page);
  // A longer one puts it away.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 140, { steps: 6 });
  await page.mouse.up();
  await expect(sheet(page)).toHaveCount(0);
});

test('Escape puts the sheet away', async ({ page }) => {
  await openDoc(page);
  await toggle(page).tap();
  await expect(sheet(page).getByRole('tab', { name: /^Comments/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(modal(page)).toBeVisible();
});

test('a tap on commented words brings the sheet up on their card, and its quote shows them with the sheet away', async ({ page }) => {
  await openDoc(page);
  const id = await comment(page, 'Keep the motel sign lit all night', 'sign', 'Which sign?');
  await modal(page).locator(`.tt-comment[data-comment-id="${id}"]`).tap();
  await expect(sheet(page)).toBeVisible();
  const card = sheet(page).locator(`.dl-th[data-thread="${id}"]`);
  await expect(card).toHaveClass(/is-on/);
  await card.locator('.dl-th-q').tap();
  await expect(sheet(page)).toHaveCount(0);
  await expect(modal(page).locator(`.tt-comment[data-comment-id="${id}"]`)).toBeInViewport();
});

test('Find in the sheet: a tapped hit puts the sheet away with its words selected', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setContent('<p>A night drive.</p>'));
  await toggle(page).tap();
  await sheet(page).getByRole('tab', { name: 'Find' }).tap();
  await sheet(page).getByRole('textbox', { name: 'Find', exact: true }).fill('night');
  await expect(sheet(page).locator('.dl-find-n')).toHaveText('1 of 1');
  await sheet(page).locator('.dl-fr').tap();
  await expect(sheet(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    const { from, to } = ed.state.selection;
    return ed.state.doc.textBetween(from, to);
  })).toBe('night');
});
