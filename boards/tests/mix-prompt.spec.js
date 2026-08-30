// The ask that fires on a board of pictures with nothing written on it.
//
// Why this surface is worth a spec of its own: it is aimed at the only day-one
// behaviour that predicts a user ever coming back. Bucketing new accounts by
// what they built in their first 24 hours, a board of images only returns at
// the same rate as an account that placed NOTHING, while images plus any
// writing returns at roughly double (see lib/mixPrompt.js for the table). Every
// other activation surface counts cards, and card counts have been climbing for
// a month without return moving.
//
// It shares the depth dock's chrome, which is deliberate but means the two can
// silently swap places — and both failure modes are invisible. A prompt that
// stops rendering looks like "nothing happened"; a prompt that renders over a
// board that already HAS writing on it is nagging, which is the specific way
// this class of surface gets itself deleted.
//
// The photo-dump board is unreachable through the rail (there is no image tool
// — images need an upload backend), so these drive the DEV-only &mixqa= seam.
import { expect, test } from '@playwright/test';

const RAIL = (name) => ({ name, exact: true });
const dock = (page) => page.locator('.cnv-depth-dock');

test('a board of pictures with no words gets the ask, not "add more images"', async ({ page }) => {
  await page.goto('/?local=1&reset=1&mixqa=4');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(4);

  // Four images sits inside the depth dock's [1, 6) band too, so this is the
  // overlap where the correction actually has to bite: the offer must be the
  // one that predicts return, not the one that predicts a fuller board.
  await expect(dock(page)).toBeVisible();
  await expect(dock(page)).toHaveAttribute('aria-label', 'Add a note');
  await expect(page.locator('.cnv-depth-dock-lbl')).toHaveText('Add a note');
  await expect(dock(page)).toHaveCount(1, { message: 'one dock, never both asks at once' });
});

test('below the threshold the depth dock keeps the moment', async ({ page }) => {
  // Two pictures is someone still arriving, not a board that is about
  // something. Asking "say what this is" there interrupts rather than helps.
  await page.goto('/?local=1&reset=1&mixqa=2');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(2);

  await expect(dock(page)).toBeVisible();
  await expect(dock(page)).toHaveAttribute('aria-label', 'Add more images');
});

test('the ask outlives the depth dock band — the bulk import is the whole point', async ({ page }) => {
  // Eight cards is past DEPTH_DOCK_MAX, where the old dock retires because the
  // board "carries itself". A board of eight photos and no words does not.
  await page.goto('/?local=1&reset=1&mixqa=8');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(8);

  await expect(dock(page)).toBeVisible();
  await expect(dock(page)).toHaveAttribute('aria-label', 'Add a note');
});

test('any writing at all retires the ask', async ({ page }) => {
  await page.goto('/?local=1&reset=1&mixqa=8');
  const canvas = page.locator('.canvas-wrap');
  await expect(canvas).toBeVisible();
  await expect(dock(page)).toBeVisible();

  await page.getByRole('button', RAIL('Add note tool')).click();
  await canvas.click({ position: { x: 240, y: 200 } });
  await expect(page.locator('.card')).toHaveCount(9);

  // One note is the behaviour the prompt was asking for. Continuing to ask is
  // how a helpful surface turns into the thing people complain about. Nine
  // cards is also past the depth dock's band, so nothing should replace it.
  await expect(dock(page)).toHaveCount(0);
});

test('the ask takes the user to a note, not to more pictures', async ({ page }) => {
  await page.goto('/?local=1&reset=1&mixqa=4');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(4);

  await page.locator('.cnv-depth-dock-add').click();

  // A card appeared and it is not another image — the prompt reusing the depth
  // dock's chrome makes wiring it to the image action a one-word mistake, and
  // that mistake would look identical on screen. The ask retiring is the proof
  // the new card was writing: nothing else clears it.
  await expect(page.locator('.card')).toHaveCount(5);
  await expect(dock(page)).toHaveAttribute('aria-label', 'Add more images');
});

test('dismissing sticks across a reload, and does not silence the depth dock', async ({ page }) => {
  await page.goto('/?local=1&reset=1&mixqa=4');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(dock(page)).toHaveAttribute('aria-label', 'Add a note');

  await page.locator('.cnv-depth-dock-x').click();

  // Waving THIS ask away falls back to the other one rather than clearing the
  // corner: they are tracked under separate keys on purpose, so that dismissing
  // one never retires the other.
  await expect(dock(page)).toHaveAttribute('aria-label', 'Add more images');

  await page.goto('/?local=1&mixqa=4');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(dock(page)).not.toHaveAttribute('aria-label', 'Add a note');
});
