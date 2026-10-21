// A crash inside an open doc stays inside it: the doc puts itself back on its
// own, and one that keeps failing says so where the doc was, with Reopen, while
// its header (and the way out) stay. Before, a crash went up to whatever held
// the canvas, so the doc closed and the canvas behind it was rebuilt. Through
// ?docqa=1, whose DEV-only crash(always) makes the open doc throw as a real
// render crash would: once, or on every mount while `always` holds.
import { expect, test } from '@playwright/test';

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal .ProseMirror').first()).toBeVisible({ timeout: 10000 });
  await page.locator('.doc-card-modal .ProseMirror').first().click();
  await page.keyboard.type('Before the crash.');
}
const body = (page) => page.locator('.doc-card-modal .ProseMirror').first();

test('a doc that crashes comes straight back, still open, with what was written', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.crash());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await expect(body(page)).toContainText('Before the crash.');
  await expect(page.locator('.doc-card-modal [role="alert"]')).toHaveCount(0);
});

test('a doc that keeps crashing says so in place, and Reopen brings it back', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.crash(true));
  const alert = page.locator('.doc-card-modal [role="alert"]');
  await expect(alert).toContainText('This doc hit a problem.');
  // The header stays: its title and its way out.
  await expect(page.getByRole('textbox', { name: 'Document title' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close document' })).toBeVisible();
  await page.evaluate(() => window.__soleilDocTest.crash(false, { stop: true }));
  await alert.getByRole('button', { name: 'Reopen' }).click();
  await expect(alert).toHaveCount(0);
  await expect(body(page)).toContainText('Before the crash.');
  await page.getByRole('button', { name: 'Close document' }).click();
  await expect(page.locator('.doc-card-modal')).toHaveCount(0);
});
