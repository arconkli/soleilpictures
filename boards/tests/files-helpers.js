// Shared helpers for specs that drive the Files view.
//
// Files is one view in two sizes (src/lib/filesDock.js): the topbar's Files
// button opens it BESIDE the board when there is room, and its ⤢ expands it to
// fill the pane. Specs written against the full-screen browser (its toolbar,
// table and detail panel) go through openFullFiles so they keep testing that.
import { expect } from '@playwright/test';

export async function openFullFiles(page) {
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  const expand = page.getByRole('button', { name: 'Expand Files to full screen' });
  try {
    await expand.waitFor({ state: 'visible', timeout: 2500 });
    await expand.click();
  } catch (_) { /* no room for a panel — Files opened full already */ }
  await expect(page.locator('.list-wrap:not(.is-panel)')).toBeVisible();
}
