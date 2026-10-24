import { expect, test } from '@playwright/test';
import { todaysLook } from '../helpers/docFrame.js';

// Touch: the format toolbar scrolls off-screen on a phone and tapping it can
// drop the selection, so a selection shows an in-place bubble with the core
// inline formats. (Coarse-pointer only — desktop keeps the toolbar.)

async function openDoc(page) {
  // The doc look has no bubble on a phone: the row on the keyboard has its
  // formats (doc-look-phone.spec.js). A tablet's does the same in both, in the
  // look's icons there (touch/doc-bubble-look.spec.js).
  if (page.viewportSize().width <= 640) await todaysLook(page);
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

// A screen reader hears which of them are on, not just their names.
test('touch: the bubble says which formats are on', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().insertContent('bubble target').selectAll().run());
  const bubble = page.locator('.doc-bubble');
  await expect(bubble).toBeVisible({ timeout: 5000 });
  for (const name of ['Bold', 'Italic', 'Underline', 'Highlight']) {
    await expect(bubble.getByRole('button', { name, exact: true }), name).toHaveAttribute('aria-pressed', 'false');
  }
  await bubble.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(bubble.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
