import { expect, test } from '@playwright/test';
import { colourButton, shownColour, swatch } from './helpers/noteBar.js';

// Transparent note background — exposed as a swatch in the note's
// "Card background" strip (the CSS .note.is-transparent plumbing already
// existed; this covers the UI path end-to-end and that the option is
// reversible). The bar's controls through helpers/noteBar.js.

test('note background can be set to transparent and back', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x: 620, y: 300 } });
  const body = page.locator('.note-body[contenteditable="true"]');
  await body.waitFor();
  await body.click();
  await page.keyboard.type('see-through note');

  const note = page.locator('.card .note').last();

  // Pick the transparent swatch.
  await colourButton(page, 'Card background').click();
  await swatch(page, 'transparent').click();
  await expect(note).toHaveClass(/is-transparent/);
  // .note transitions background-color — poll past the interpolation frames.
  await expect.poll(() => note.evaluate(el => getComputedStyle(el).backgroundColor))
    .toBe('rgba(0, 0, 0, 0)');
  // The trigger dot reflects the transparent state via the checkerboard.
  await expect.poll(async () => (await shownColour(page, 'Card background')).image).toContain('repeating-linear-gradient');

  // Commit (blur) — display mode keeps the transparent treatment and text.
  await page.locator('.canvas-wrap').click({ position: { x: 150, y: 650 } });
  await expect(page.locator('.note-body[contenteditable="true"]')).toHaveCount(0);
  await expect(note).toHaveClass(/is-transparent/);
  await expect(note).toContainText('see-through note');

  // Reversible: re-enter edit and pick a solid swatch.
  await note.dblclick();
  await body.waitFor();
  await colourButton(page, 'Card background').click();
  await swatch(page, '#fef3c7').click();
  await expect(note).not.toHaveClass(/is-transparent/);
  await expect(note).toHaveClass(/has-bg/);

  // 'transparent' must not have leaked into the recent-colors strip.
  const recents = await page.evaluate(() => {
    try { return localStorage.getItem('soleil-recent-colors') || ''; } catch { return ''; }
  });
  expect(recents).not.toContain('transparent');
});
