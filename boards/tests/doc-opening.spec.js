// A doc never hangs silently while it opens: its editor's code arriving late
// (held here, the way a slow connection holds it), or, docked, its cluster
// still loading (?docqa=1&panes=1&cold=1, the pane as App draws it before the
// board's Y.Doc is in). Either way it says it is opening, to a screen reader
// too, and after a while that it is still connecting, with a reload and, where
// nothing else on screen closes it, a close (components/DocOpening.jsx).
import { expect, test } from '@playwright/test';
import { dockFromCard } from './helpers/docFrame.js';

const STALL_MS = 10000; // DocOpening's DOC_OPENING_STALL_MS

// Holds the doc editor's module (DocSurface, lazy behind DocCard) until the
// function returned is called.
async function holdEditor(page) {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route(/\/src\/components\/DocSurface\.jsx/, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  return release;
}

async function openHeld(page) {
  const release = await holdEditor(page);
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  return release;
}

test('a doc whose editor is slow to arrive says it is opening, then that it is still connecting, and opens by itself', async ({ page }) => {
  test.setTimeout(60000);
  const release = await openHeld(page);
  const body = page.locator('.doc-card-modal-body');
  await expect(body.getByRole('status')).toHaveText('Opening document…');
  await expect(body.locator('.doc-surface-skeleton')).toBeVisible();
  await expect(body.getByText('Still connecting…')).toBeVisible({ timeout: STALL_MS + 5000 });
  await expect(body.getByRole('status')).toContainText('Still connecting…');
  await expect(body.getByRole('button', { name: 'Reload page' })).toBeVisible();
  // Its header's × closes it; the wait adds no second one.
  await expect(body.getByRole('button', { name: 'Close' })).toHaveCount(0);
  release();
  await expect(page.locator('.doc-card-modal .tt-editor').first()).toBeVisible({ timeout: 15000 });
  await expect(body.getByText('Still connecting…')).toHaveCount(0);
});

test('Reload page reloads the page', async ({ page }) => {
  test.setTimeout(60000);
  await openHeld(page);
  const body = page.locator('.doc-card-modal-body');
  const reload = body.getByRole('button', { name: 'Reload page' });
  await expect(reload).toBeVisible({ timeout: STALL_MS + 5000 });
  const reloaded = page.waitForEvent('load');
  await reload.click();
  await reloaded;
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
});

test('a docked doc whose cluster is still loading says so, and its pane closes from there', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?docqa=1&panes=1&cold=1');
  await page.waitForSelector('[data-docqa-panes-ready]');
  await dockFromCard(page.locator('[data-docqa-card="doc-a"] .doc-card'));
  const dock = page.locator('[data-doc-pane="split"]');
  await expect(dock.getByRole('status')).toHaveText('Opening document…');
  await expect(dock.getByText('Still connecting…')).toBeVisible({ timeout: STALL_MS + 5000 });
  await expect(dock.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await dock.getByRole('button', { name: 'Close' }).click();
  await expect(dock).toHaveCount(0);
});
