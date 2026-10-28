// The line under a phone's title says how the doc is saving in a word (the
// short form of lib/docSaveStatus.js's saveLine): Saving… until the cluster's
// room says it holds the change, Saved, Reconnecting… while it can't be
// reached; a reader's says View only. Driven in the ?docqa=1 harness against a
// stand-in for the room (&room=1, src/local/docQaRoom.js).

import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone-width only (≤640px)');
});

async function openDoc(page, query = '&room=1') {
  await page.goto(`/?docqa=1${query}`);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const line = (page) => page.locator('.doc-card-modal .dl-head .dl-psub');
const room = (page, fn, ...args) => page.evaluate(([f, a]) => window.__soleilDocTest.room[f](...a), [fn, args]);
const write = (page, text) => page.evaluate((t) => window.__soleilDocTest.editor.commands.insertContent(t), text);

test('the phone\'s line says how the doc is saving, in a word', async ({ page }) => {
  await openDoc(page);
  await expect(line(page)).toHaveText(/^(New doc|Saved)$/);
  await room(page, 'hold');
  await write(page, 'Take one.');
  await expect(line(page)).toHaveText('Saving…');
  await room(page, 'release');
  await expect(line(page)).toHaveText('Saved');
  await room(page, 'drop');
  await write(page, ' Take two.');
  await expect(line(page)).toHaveText('Reconnecting…', { timeout: 6000 });
  await room(page, 'live');
  await expect(line(page)).toHaveText('Saved');
});

test('a reader\'s line says View only, whatever the room', async ({ page }) => {
  await openDoc(page, '&room=1&viewer=1');
  await expect(line(page)).toHaveText('View only');
  await room(page, 'drop');
  await page.waitForTimeout(3500);
  await expect(line(page)).toHaveText('View only');
});
