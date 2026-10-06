// The mix prompt — "say what this is" on a board of pictures with no words —
// is RETIRED (2026-10-05, MIX_PROMPT_RETIRED in lib/mixPrompt.js).
//
// It was aimed at the day-one images-plus-writing return gap, but that gap does
// not survive stratifying by depth, and the ask itself was rarely taken and
// shown several times per person. These specs now guard the retirement: the
// photo-dump boards the &mixqa= seam builds get the ordinary depth dock back
// inside its band, and nothing at all past it. If the flag is ever flipped back,
// restore the previous version of this file from git history with it.
import { expect, test } from '@playwright/test';

const dock = (page) => page.locator('.cnv-depth-dock');

test('a board of pictures with no words gets the depth dock, not the retired ask', async ({ page }) => {
  await page.goto('/?local=1&reset=1&mixqa=4');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(4);
  await expect(dock(page)).toBeVisible();
  await expect(dock(page)).toHaveAttribute('aria-label', 'Add more images');
  await expect(page.locator('.cnv-depth-dock-lbl')).not.toHaveText('Add a note');
});

test('below the threshold the depth dock keeps the moment', async ({ page }) => {
  await page.goto('/?local=1&reset=1&mixqa=2');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(dock(page)).toBeVisible();
  await expect(dock(page)).toHaveAttribute('aria-label', 'Add more images');
});

test('past the depth dock band a photo-only board gets no dock at all', async ({ page }) => {
  // This is where the mix ask used to outlive the depth dock. Retired, the
  // corner stays clear: the board carries itself.
  await page.goto('/?local=1&reset=1&mixqa=8');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(8);
  await expect(dock(page)).toHaveCount(0);
});
