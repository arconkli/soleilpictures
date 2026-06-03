import { expect, test } from '@playwright/test';

// WS-2 quick wins — spot-checks for the user-visible behaviors.

test('canvas context menu closes on Escape (capture-phase listener)', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  const card = page.locator('.card').first();
  await expect(card).toBeVisible();
  await card.click({ button: 'right' });
  await expect(page.locator('.ctx-menu').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
  // And again on a fresh open — the old {once:true}-style bug broke the 2nd time.
  await card.click({ button: 'right' });
  await expect(page.locator('.ctx-menu').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
});

test('docs toolbar Highlight button applies the highlight mark', async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });

  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.chain().focus().insertContent('<p>highlight me</p>').selectAll().run();
  });
  const btn = page.getByTitle('Highlight (⌘⇧H)');
  await expect(btn).toBeVisible();
  await btn.click();
  expect(await page.evaluate(() => window.__soleilDocTest.editor.isActive('highlight'))).toBe(true);
});
