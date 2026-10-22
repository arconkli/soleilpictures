// wall-trial.spec.js — every wall on the person's OWN card limit offers the
// trial, even when the server has counted nothing yet (a first big drop).
//
// Rendered through the harness seams in UpgradeChip.jsx (?capwall=, ?importask=);
// App.jsx's own mounts are pinned by the source specs beside this one.

import { test, expect } from '@playwright/test';

test.describe('the wall offers the trial before anything is counted', () => {
  test('the import question for a big drop on 0 cards offers the trial', async ({ page }) => {
    await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&importask=68,50,0,50');
    await expect(page.getByRole('button', { name: /Try Creator free.*keep all 68/ })).toBeVisible();
  });

  test('the cap wall on 0 cards shows the trial CTA', async ({ page }) => {
    await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&capwall=3');
    const wall = page.locator('.upgrade-modal');
    await expect(wall).toBeVisible();
    await expect(wall.getByRole('button', { name: /Try Creator free/ })).toBeVisible();
  });

  test('a collaborator over someone else\'s card limit is offered no upgrade', async ({ page }) => {
    await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&importask=68,50,0,50,0');
    await expect(page.getByText(/its owner’s plan, so their plan sets the limit/)).toBeVisible();
    await expect(page.getByRole('button', { name: /keep all/ })).toHaveCount(0);
  });
});
