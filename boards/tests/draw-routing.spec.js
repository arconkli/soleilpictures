import { expect, test } from '@playwright/test';

// Regression: with exactly ONE card selected, pickStrokeTarget used to route
// the whole stroke into that card regardless of kind — the stroke landed in
// the card's card-local `strokes` prop where .card{overflow:hidden} clipped
// everything outside the card's box, so drawing on bare canvas looked dead
// (and the tool auto-flipped back to select). Routing must only target ART
// canvases; any other selection draws on the board as normal.

// The reset=1 fixture seeds cards asynchronously — wait until the count is
// non-zero AND stable across two reads before interacting (same idiom as
// boards-smoke).
async function waitForSeededCards(page) {
  let prevCount = -1;
  await expect.poll(async () => {
    const n = await page.locator('.card').count();
    const settled = n > 0 && n === prevCount;
    prevCount = n;
    return settled;
  }, { timeout: 10000 }).toBe(true);
}

test('free-draw lands on the board even while a non-art card is selected', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await waitForSeededCards(page);

  // Select a (non-art) seeded card — none of the QA seeds are art canvases.
  await page.locator('.card').first().click();
  await expect(page.locator('.card.is-selected')).toHaveCount(1);

  await page.getByRole('button', { name: 'Free-draw tool', exact: true }).click();
  await expect(page.getByText('Drag to draw')).toBeVisible();

  const strokePathCount = await page.locator('.strokes-layer path').count();
  // Real mouse drag on EMPTY canvas (bottom-left quadrant is clear in the seed).
  await page.mouse.move(420, 620);
  await page.mouse.down();
  await page.mouse.move(540, 680, { steps: 8 });
  await page.mouse.up();

  // Stroke renders on the BOARD layer (a stroke is path + hit-halo = +2)…
  await expect(page.locator('.strokes-layer path')).toHaveCount(strokePathCount + 2);
  // …the selected card carried no annotation overlay…
  await expect(page.locator('.card .card-strokes-overlay')).toHaveCount(0);
  // …and the tool did NOT auto-flip back to select (board drawing is iterative).
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-draw/);
});
