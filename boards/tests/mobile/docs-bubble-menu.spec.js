import { expect, test } from '@playwright/test';

// Touch: the format toolbar scrolls off-screen on a phone and tapping it can
// drop the selection, so a selection shows an in-place bubble with the core
// inline formats. (Coarse-pointer only — desktop keeps the toolbar.)

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

test('touch: selection bubble appears and formats', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().insertContent('bubble target').selectAll().run());
  const bubble = page.locator('.doc-bubble');
  await expect(bubble).toBeVisible({ timeout: 5000 });
  // Activate via click, not tap: a real tap resolves to a click, but
  // Playwright-WebKit doesn't synthesize the click after the button's
  // onPointerDown preventDefault (mobile-chrome, with faithful touch emulation,
  // fires it — so the button itself works on touch). click() exercises the same
  // pointerdown→preventDefault→click path cross-engine.
  await bubble.getByRole('button', { name: 'Bold' }).click();
  const html = await page.evaluate(() => window.__soleilDocTest.editor.getHTML());
  expect(html).toContain('<strong>');
});
