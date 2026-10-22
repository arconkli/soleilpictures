// The parts of the toolbar look under a finger (?toolbarqa=1): every button
// and menu row is 44px, and a tap is an action, never a tooltip.
import { expect, test } from '@playwright/test';

const dark = '[data-qa-half="dark"]';

test('under a finger: 44px buttons and menu rows, and no tooltip on a tap', async ({ page }) => {
  await page.goto('/?toolbarqa=1');
  const btns = page.locator(`${dark} [data-qa="format-bar"] .tl-btn`);
  await btns.first().waitFor();
  const n = await btns.count();
  expect(n).toBeGreaterThan(10);
  for (let i = 0; i < n; i++) {
    const b = await btns.nth(i).boundingBox();
    expect(Math.round(b.height), `button ${i}`).toBeGreaterThanOrEqual(44);
    expect(Math.round(b.width), `button ${i}`).toBeGreaterThanOrEqual(44);
  }
  await btns.nth(1).tap();
  await page.waitForTimeout(900);
  await expect(page.locator('body > .tl-tip.is-shown')).toHaveCount(0);

  await page.locator(`${dark} [data-qa="overflow-bar"] button[aria-label="More"]`).tap();
  const row = page.getByRole('menuitem', { name: 'Strikethrough' });
  await expect(row).toBeVisible();
  expect(Math.round((await row.boundingBox()).height)).toBeGreaterThanOrEqual(44);
  // A finger has no keys: the menu doesn't list them.
  await expect(row.locator('.tl-keys')).toBeHidden();
});
