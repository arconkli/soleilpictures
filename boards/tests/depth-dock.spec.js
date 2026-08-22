// Day-one depth: the two surfaces that carry a board past its first card.
//
// The empty-board panel is the only place the product offers a multi-select
// image import, and it renders on `boardIsEmpty || firstCardPrompt` — so it
// unmounts the moment any card exists, including a card that is an empty
// container. Two behaviours close that gap and both are easy to break silently:
//
//   1. the depth dock, which carries the same offer from card 1 up to the
//      threshold where a board is worth returning to, and
//   2. auto-opening a cluster placed as the board's FIRST card, so the user
//      lands on that panel instead of on a canvas holding one closed box.
//
// Neither has a visible failure mode — a dock that stops rendering and a
// navigation that stops firing both just look like "nothing happened".
import { expect, test } from '@playwright/test';

const RAIL = (name) => ({ name, exact: true });

test('the depth dock carries the image offer from the first card to the threshold', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  const canvas = page.locator('.canvas-wrap');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);

  // At zero cards the empty panel owns the message; two offers at once would
  // be worse than one.
  await expect(page.locator('.cnv-empty-tiles')).toHaveCount(1);
  await expect(page.locator('.cnv-depth-dock')).toHaveCount(0);

  // One note, and the panel that said "pick several at once" is gone.
  await page.getByRole('button', RAIL('Add note tool')).click();
  await canvas.click({ position: { x: 240, y: 200 } });
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.cnv-empty-tiles')).toHaveCount(0);
  await expect(page.locator('.cnv-depth-dock')).toBeVisible();

  // Still offered while the board is thin.
  for (const x of [380, 520, 660, 800]) {
    await page.getByRole('button', RAIL('Add note tool')).click();
    await canvas.click({ position: { x, y: 200 } });
  }
  await expect(page.locator('.card')).toHaveCount(5);
  await expect(page.locator('.cnv-depth-dock')).toBeVisible();

  // At the threshold the board carries itself and the dock retires.
  await page.getByRole('button', RAIL('Add note tool')).click();
  await canvas.click({ position: { x: 940, y: 200 } });
  await expect(page.locator('.card')).toHaveCount(6);
  await expect(page.locator('.cnv-depth-dock')).toHaveCount(0);
});

test('dismissing the depth dock sticks across a reload', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  const canvas = page.locator('.canvas-wrap');
  await expect(canvas).toBeVisible();

  await page.getByRole('button', RAIL('Add note tool')).click();
  await canvas.click({ position: { x: 240, y: 200 } });
  await expect(page.locator('.cnv-depth-dock')).toBeVisible();

  await page.locator('.cnv-depth-dock-x').click();
  await expect(page.locator('.cnv-depth-dock')).toHaveCount(0);

  // Waving it away has to mean it, or the dock becomes the thing people
  // complain about rather than the thing that helps.
  await page.goto('/?local=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.cnv-depth-dock')).toHaveCount(0);
});

test('a cluster placed as the first card opens into its own empty canvas', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  const canvas = page.locator('.canvas-wrap');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);

  await page.getByRole('button', RAIL('Add cluster tool')).click();
  await canvas.click({ position: { x: 300, y: 300 } });

  // We should now be INSIDE the new cluster, on a fresh canvas showing the
  // image-first panel — not looking at a parent board holding one closed box.
  await expect(page.locator('.crumb.here')).toHaveText('Untitled cluster');
  await expect(page.locator('.cnv-empty-tiles')).toHaveCount(1);
  await expect(page.locator('.card')).toHaveCount(0);

  // Moving someone without asking is a liberty, so the way back is part of it.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.crumb.here')).not.toHaveText('Untitled cluster');
  await expect(page.locator('.card')).toHaveCount(1);
});

test('only the FIRST card triggers it — no walking a user down a chain', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  const canvas = page.locator('.canvas-wrap');
  await expect(canvas).toBeVisible();

  // A note first, so the cluster is no longer the board's first genuine card.
  await page.getByRole('button', RAIL('Add note tool')).click();
  await canvas.click({ position: { x: 240, y: 200 } });
  await expect(page.locator('.card')).toHaveCount(1);
  const where = await page.locator('.crumb.here').textContent();

  await page.getByRole('button', RAIL('Add cluster tool')).click();
  await canvas.click({ position: { x: 620, y: 420 } });

  // Stayed put, with both cards on the same canvas.
  await expect(page.locator('.crumb.here')).toHaveText(where);
  await expect(page.locator('.card')).toHaveCount(2);
});
