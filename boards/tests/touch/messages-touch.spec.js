import { expect, test } from '@playwright/test';
import { hold, needsHold } from './helpers.js';

// Messages under a finger (the Messages QA harness, ?msgqa=1): a message's
// actions and a conversation's menu are a press and hold away, the hover chip
// stays out of the way, the panel ends above the on-screen keyboard, and the
// fields are 16px so iOS doesn't zoom in on them. Holds need CDP touch, so
// those run on the Chromium projects and skip WebKit (helpers.js).

async function open(page, query = '') {
  const phone = (page.viewportSize()?.width || 1000) < 700;
  await page.goto(`/?msgqa=1${phone ? '&phone=1' : ''}${query ? `&${query}` : ''}`);
  await page.waitForSelector('html[data-msgqa-ready="1"]');
}
const qa = (page, fn, arg) => page.evaluate(fn, arg);
const bubble = (page, text) => page.locator('.msg-bubble', { has: page.locator('.msg-bubble-body', { hasText: text }) }).last();
const centre = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function holdBubble(page, loc) {
  await loc.scrollIntoViewIfNeeded();
  await hold(page, await centre(loc.locator('.msg-bubble-body')));
  await expect(page.locator('.msg-sheet')).toBeVisible();
}

test('no hover chip or ⋯ under a finger, and the fields are 16px', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const theirs = bubble(page, 'Thanks! Talk tomorrow.');
  await expect(theirs).toBeVisible();
  await expect(theirs.locator('.msg-bubble-actions')).toBeHidden();
  await expect(theirs.locator('.msg-bubble-more')).toBeHidden();
  await expect(page.locator('.msg-composer-input')).toHaveCSS('font-size', '16px');
  await page.locator('.msg-pane-thread .msg-panel-icon[aria-label="Search messages"]').tap();
  await expect(page.locator('.msg-search-input')).toHaveCSS('font-size', '16px');
  await page.locator('.msg-search-done').tap();
  await page.locator('.msg-pane-thread .msg-panel-icon[aria-label="Back"]').tap();
  await expect(page.locator('.msg-find input')).toHaveCSS('font-size', '16px');
});

test('hold a message: its actions open in a sheet, and a reaction from it lands', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page, 'conv=c-maya');
  const theirs = bubble(page, 'Thanks! Talk tomorrow.');
  await holdBubble(page, theirs);
  const sheet = page.locator('.msg-sheet');
  await expect(sheet.locator('.msg-sheet-quote')).toHaveText('Thanks! Talk tomorrow.');
  for (const label of ['Reply', 'Copy text', 'Copy link']) await expect(sheet.getByRole('button', { name: label })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Delete' })).toHaveCount(0); // not yours
  await sheet.locator('.msg-sheet-emoji', { hasText: '🎉' }).tap();
  await expect(sheet).toHaveCount(0);
  await expect(theirs.locator('.msg-reaction', { hasText: '🎉' })).toBeVisible();
});

test('hold a message, Reply: the composer says what it answers', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page, 'conv=c-maya');
  await holdBubble(page, bubble(page, 'Thanks! Talk tomorrow.'));
  await page.locator('.msg-sheet').getByRole('button', { name: 'Reply' }).tap();
  await expect(page.locator('.msg-reply-bar-body')).toContainText('Thanks! Talk tomorrow.');
});

test('hold your own message: Edit puts it in the box you type in, and Delete goes with Undo', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page, 'conv=c-maya');
  const input = page.locator('.msg-composer-input');
  await input.tap();
  await page.keyboard.type('held and edited');
  await page.locator('.msg-composer-send').tap();
  const mine = bubble(page, 'held and edited');
  await expect(mine).not.toHaveClass(/msg-bubble--pending/);
  const id = await mine.getAttribute('data-msg-id');
  await holdBubble(page, mine);
  await page.locator('.msg-sheet').getByRole('button', { name: 'Edit' }).tap();
  await expect(page.locator('.msg-reply-bar.is-edit')).toBeVisible();
  await expect(input).toHaveValue('held and edited');
  await expect(page.locator(`.msg-bubble[data-msg-id="${id}"]`)).toHaveClass(/is-editing/);
  await page.getByRole('button', { name: 'Cancel the edit' }).tap();
  await expect(page.locator('.msg-reply-bar.is-edit')).toHaveCount(0);
  await holdBubble(page, page.locator(`.msg-bubble[data-msg-id="${id}"]`));
  await page.locator('.msg-sheet').getByRole('button', { name: 'Delete' }).tap();
  await expect(page.locator(`.msg-bubble[data-msg-id="${id}"]`)).toHaveCount(0);
  await expect(page.locator('.toast-action', { hasText: 'Undo' })).toBeVisible();
});

test('hold a conversation: its menu opens, and the conversation doesn’t', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page);
  const row = page.locator('.msg-row', { hasText: 'Jon Park' }).first();
  await expect(row).toBeVisible();
  await hold(page, await centre(row));
  await expect(page.locator('.msg-group-menu')).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator('.msg-pane-thread')).toHaveCount(0);
});

test('the panel ends above the on-screen keyboard', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const composer = page.locator('.msg-composer');
  await expect(composer).toBeVisible();
  // Playwright can't raise a keyboard: shrink the visual viewport as one would.
  const covered = await page.evaluate(() => {
    const vv = window.visualViewport;
    const h = Math.round(window.innerHeight * 0.55);
    Object.defineProperty(vv, 'height', { configurable: true, get: () => h });
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
    vv.dispatchEvent(new Event('resize'));
    return h;
  });
  await page.locator('.msg-composer-input').tap();
  await page.evaluate(() => window.visualViewport.dispatchEvent(new Event('resize')));
  await expect.poll(async () => (await composer.boundingBox()).y + (await composer.boundingBox()).height).toBeLessThanOrEqual(covered);
});
