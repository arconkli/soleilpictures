// A doc's save line claims only what is proven (lib/docSaveStatus.js): Saved
// once the cluster's room says it holds every change made here, Saving… while
// one is on its way, and, when the room can't be reached, that the changes
// are kept on this device, or to keep the tab open when this device couldn't
// keep them. Driven in the ?docqa=1 harness against a stand-in for the room
// (&room=1, src/local/docQaRoom.js) that answers as the board room does.

import { expect, test } from '@playwright/test';

async function openDoc(page, { query = '&room=1' } = {}) {
  await page.goto(`/?docqa=1${query}`);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const status = (page) => page.locator('.doc-card-modal .dl-foot-status');
const room = (page, fn, ...args) => page.evaluate(([f, a]) => window.__soleilDocTest.room[f](...a), [fn, args]);
const type = async (page, text) => {
  await page.locator('.doc-card-modal .ProseMirror').first().click();
  await page.keyboard.type(text);
};
// The page's network, as the line hears it.
const network = (page, on) => page.evaluate((up) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => up });
  window.dispatchEvent(new Event(up ? 'online' : 'offline'));
}, on);
const TONE = /\bis-(saving|offline|error)\b/;

test('typing is Saving… until the room says it holds it, then Saved, with one question per pause', async ({ page }) => {
  await openDoc(page);
  await expect(status(page)).toHaveText(/^(All changes saved|Saved just now)$/);
  await room(page, 'hold');
  const before = await room(page, 'asked');
  await type(page, 'A night drive across the desert');
  await expect(status(page)).toHaveText('Saving…');
  await expect(status(page)).toHaveClass(/\bis-saving\b/);
  await page.waitForTimeout(1500);
  await expect(status(page)).toHaveText('Saving…');   // the room hasn't answered
  await room(page, 'release');
  await expect(status(page)).toHaveText('Saved just now');
  await expect(status(page)).not.toHaveClass(TONE);
  expect(await room(page, 'asked') - before).toBeLessThanOrEqual(2);
});

test('the room gone for a moment says nothing new; gone for longer, that the changes are kept here; back, it saves them', async ({ page }) => {
  await openDoc(page);
  await type(page, 'Take one.');
  await expect(status(page)).toHaveText('Saved just now');
  await room(page, 'drop');
  await type(page, ' Take two.');
  await expect(status(page)).toHaveText('Saving…');
  await expect(status(page)).toHaveText('Reconnecting — changes kept on this device', { timeout: 6000 });
  await expect(status(page)).toHaveClass(/\bis-offline\b/);
  await room(page, 'live');
  await expect(status(page)).toHaveText('Saved just now');
});

test('let go of on purpose (a parked tab), the line stays quiet', async ({ page }) => {
  await openDoc(page);
  await type(page, 'Take one.');
  await expect(status(page)).toHaveText('Saved just now');
  await room(page, 'drop', { park: true });
  await page.waitForTimeout(3500);
  await expect(status(page)).toHaveText(/^Saved/);
});

test('when this device couldn\'t keep a draft, it says to keep the tab open instead', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.draftTook(false));
  await room(page, 'drop');
  await type(page, 'Take one.');
  await expect(status(page)).toHaveText('Reconnecting — keep this tab open', { timeout: 6000 });
});

test('offline, it says so, and whether anything is unsaved', async ({ page }) => {
  await openDoc(page);
  await network(page, false);
  await expect(status(page)).toHaveText('Offline');
  await room(page, 'drop');
  await type(page, 'Take one.');
  await expect(status(page)).toHaveText('Offline — changes kept on this device');
  await expect(status(page)).toHaveClass(/\bis-offline\b/);
  await network(page, true);
  await room(page, 'live');
  await expect(status(page)).toHaveText('Saved just now');
});

test('a room that keeps this connection read-only: the changes aren\'t saved, and the footer says so', async ({ page }) => {
  await openDoc(page);
  await room(page, 'readOnly', true);
  await type(page, 'Take one.');
  await expect(status(page)).toHaveText("View only — changes aren't saved");
  await expect(status(page)).toHaveClass(/\bis-error\b/);
});

test('shut out of the cluster, it says it can\'t save', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.endAccess());
  await expect(status(page)).toHaveText("Can't save — access ended");
  await expect(status(page)).toHaveClass(/\bis-error\b/);
});

test('a reader\'s footer says nothing of saving (the header says View only)', async ({ page }) => {
  await openDoc(page, { query: '&room=1&viewer=1' });
  await expect(page.locator('.doc-card-modal .dl-foot')).toBeVisible();
  await expect(status(page)).toHaveCount(0);
  await expect(page.locator('.doc-card-modal .dl-head .dl-chip')).toHaveText('View only');
});

test('another cluster\'s saves never move this doc\'s line', async ({ page }) => {
  for (const query of ['', '&room=1']) {
    await openDoc(page, { query });
    const was = await status(page).textContent();
    await page.evaluate(() => {
      for (const state of ['saving', 'error']) {
        window.dispatchEvent(new CustomEvent('soleil-board-save-state', { detail: { boardId: 'another-cluster', state } }));
      }
    });
    await page.waitForTimeout(200);
    await expect(status(page)).toHaveText(was);
  }
});
