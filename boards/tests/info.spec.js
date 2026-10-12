// Info on everything: every right-click offers it, ⌘I opens it, and the one
// drawer (components/info/InfoHost.jsx) describes a card, several cards, a
// group, a folder or the cluster itself — following the selection while it's
// open. Driven through the ?local=1 harness.
import { expect, test } from '@playwright/test';
import { openFullFiles } from './files-helpers.js';

async function go(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => {
    try {
      localStorage.removeItem('soleil.files.dock');
      localStorage.removeItem('soleil.files.info');
      localStorage.setItem('soleil.files.dockHint', '1');
    } catch (_) {}
    window.history.replaceState(null, '', '/?local=1');
  });
  await page.reload();
  await expect(page.locator('.rail-brand')).toBeVisible();
  await expect(page.locator('[data-card-id="home-note"]')).toBeVisible();
}

const drawer = (page) => page.locator('.cb-detail.is-drawer');

// A point on the bare canvas — no card, no rail, no control.
async function emptySpot(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
    for (let y = wrap.top + 120; y < wrap.bottom - 40; y += 40) {
      for (let x = wrap.left + 120; x < wrap.right - 40; x += 40) {
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('.canvas-wrap') && !el.closest('[data-card-id], button, [role="toolbar"], .rail, .canvas-comment-bubble, svg path')) {
          return { x: x - wrap.left, y: y - wrap.top };
        }
      }
    }
    return null;
  });
}
const card = (page, id) => page.locator(`[data-card-id="${id}"]`);
const menuItem = (page, name) => page.locator('.ctx-menu .ctx-item', { hasText: name });

test('right-click a card → Info opens the drawer with what it is and who added it', async ({ page }) => {
  await go(page);
  await card(page, 'home-image').click({ button: 'right' });
  await menuItem(page, /^Info/).click();
  const d = drawer(page);
  await expect(d).toBeVisible();
  await expect(d.locator('.cbd-section-label', { hasText: 'Details' })).toBeVisible();
  await expect(d.locator('.cbd-meta-row', { hasText: 'Kind' })).toContainText('Image');
  // Close with ×.
  await d.getByRole('button', { name: 'Close info' }).click();
  await expect(d).toHaveCount(0);
});

test('Info follows the selection, ⌘I toggles it, and an empty selection describes the cluster', async ({ page }) => {
  await go(page);
  await card(page, 'home-note').click();
  await page.keyboard.press('ControlOrMeta+i');
  const d = drawer(page);
  await expect(d.locator('.cbd-meta-row', { hasText: 'Kind' })).toContainText('Note');
  await expect(d.locator('.cbd-meta-row', { hasText: 'Words' })).toBeVisible();
  // Clicking another card walks Info to it.
  await card(page, 'home-link').click();
  await expect(d.locator('.cbd-meta-row', { hasText: 'Kind' })).toContainText('Link');
  // Several at once: a summary.
  await card(page, 'home-note').click({ modifiers: ['Shift'] });
  await expect(d.locator('.cbd-title')).toHaveText('2 items');
  await expect(d.locator('.cbd-meta-row', { hasText: 'Kinds' })).toContainText('1 link, 1 note');
  // Nothing selected: the cluster.
  await page.keyboard.press('Escape');
  await expect(d.locator('.cbd-sub')).toHaveText('Cluster');
  // ⌘I again closes it.
  await page.keyboard.press('ControlOrMeta+i');
  await expect(d).toHaveCount(0);
});

test('the empty board offers Cluster info; a cluster card says what it holds', async ({ page }) => {
  await go(page);
  const spot = await emptySpot(page);
  expect(spot).not.toBeNull();
  await page.locator('.canvas-wrap').click({ button: 'right', position: spot });
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Cluster info' }).click();
  const d = drawer(page);
  await expect(d.locator('.cbd-sub')).toHaveText('Cluster');
  await expect(d.locator('.cbd-meta-row', { hasText: 'Clusters inside' })).toBeVisible();
  await card(page, 'b-halcyon').click({ button: 'right' });
  await menuItem(page, /^Info/).click();
  await expect(d.locator('.cbd-meta-row', { hasText: 'Kind' })).toContainText('Cluster');
});

test('Files beside the board: Get info on a file and on a folder', async ({ page }) => {
  await go(page);
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  const panel = page.locator('.list-wrap.is-panel');
  await expect(panel).toBeVisible();
  const tile = panel.locator('.ct-jg [data-item-id]').first();
  await tile.click({ button: 'right' });
  await menuItem(page, 'Get info').click();
  const d = drawer(page);
  await expect(d).toBeVisible();
  await expect(d.locator('.cbd-section-label', { hasText: 'Details' })).toBeVisible();
  const folder = panel.locator('[data-folder-id]').first();
  await folder.click({ button: 'right' });
  await menuItem(page, 'Get info').click();
  await expect(d.locator('.cbd-sub')).toHaveText('Cluster');
});

test('full-screen Files: Info beside the list describes a folder, then the cluster', async ({ page }) => {
  await go(page);
  await openFullFiles(page);
  await page.keyboard.press('ControlOrMeta+i');
  const info = page.locator('.cb-detail:not(.is-drawer)');
  await expect(info.locator('.cbd-sub')).toHaveText('Cluster');
  await page.locator('[data-folder-id]').first().click();
  await expect(info.locator('.cbd-meta-row', { hasText: 'Kind' })).toContainText('Cluster');
  await expect(info.getByRole('button', { name: /Open cluster/ })).toBeVisible();
});

// A 1×1 PNG, enough for the harness (it never uploads).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('a file you just added says it was added by you, with the date and time', async ({ page }) => {
  await go(page);
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  const panel = page.locator('.list-wrap.is-panel');
  await expect(panel).toBeVisible();
  await panel.locator('input[type="file"][multiple]').setInputFiles([{ name: 'still-07.png', mimeType: 'image/png', buffer: PNG }]);
  const tile = panel.locator('.ct-jg [data-item-id]', { hasText: 'still-07' });
  await expect(tile).toBeVisible();
  await tile.click({ button: 'right' });
  await menuItem(page, 'Get info').click();
  const d = drawer(page);
  await expect(d.locator('.cbd-meta-row', { hasText: 'File name' })).toContainText('still-07.png');
  const added = d.locator('.cbd-person', { hasText: 'Added' });
  await expect(added.locator('.cbd-person-name')).toHaveText('You');
  await expect(added.locator('.cbd-person-when')).toContainText(String(new Date().getFullYear()));
  await expect(d.locator('.cbd-meta-row', { hasText: 'Location' })).toContainText('not on the board');
});
