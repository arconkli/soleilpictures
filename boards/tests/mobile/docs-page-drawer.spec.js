import { expect, test } from '@playwright/test';

// Phone: the desktop page rail is display:none at <=640px, which used to strand
// multi-page doc navigation (the only rail toggle lived inside the hidden rail).
// A "Pages" button now opens the rail as a slide-over drawer.

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

test('phone: Pages drawer opens and switches pages', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone-width only (≤640px)');
  await openDoc(page);
  // Add a second page via the bridge.
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.addPage(T.ydoc, { name: 'Chapter Two', scope: T.getScope() });
  });

  const pagesBtn = page.locator('.doc-mobile-pages-btn');
  await expect(pagesBtn).toBeVisible();
  await pagesBtn.tap();
  await expect(page.locator('.doc-surface.mobile-rail-open .doc-rail-left')).toBeVisible();

  // Tap the second page → switches + closes the drawer.
  await page.locator('.doc-tree-name', { hasText: 'Chapter Two' }).first().tap();
  await expect(page.locator('.doc-surface.mobile-rail-open')).toHaveCount(0);
});
