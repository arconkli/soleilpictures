// How the Files panel looks and fits — the things that read as broken when
// they regress: rings that clip, a header that spills at the panel's minimum
// width, a View menu that can't show what's on, toasts over the panel.
// Driven through the ?local=1 harness.
import { expect, test } from '@playwright/test';

async function go(page, { width = 1440, height = 900 } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => {
    try { localStorage.removeItem('soleil.files.dock'); localStorage.setItem('soleil.files.dockHint', '1'); } catch (_) {}
    window.history.replaceState(null, '', '/?local=1');
  });
  await page.reload();
  await expect(page.locator('.rail-brand')).toBeVisible();
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  await expect(panel(page)).toBeVisible();
}

const panel = (page) => page.locator('.list-wrap.is-panel');
const tiles = (page) => panel(page).locator('.ct-jg [data-item-id]');

async function narrow(page) {
  const b = await page.locator('.fdl-divider').boundingBox();
  await page.mouse.move(b.x + b.width / 2, 450);
  await page.mouse.down();
  await page.mouse.move(1440 - 300, 450, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await page.locator('.fdl-files').boundingBox()).width).toBeLessThan(330);
}

test('grid tiles draw their whole selection ring — nothing paint-contains them', async ({ page }) => {
  await go(page);
  await tiles(page).nth(1).click();
  const t = tiles(page).nth(1);
  await expect(t).toHaveClass(/is-selected/);
  expect(await t.evaluate((el) => getComputedStyle(el).contentVisibility)).toBe('visible');
});

test('at its minimum width the panel fits: no sideways scroll, ⤢ × + and the selection bar stay inside', async ({ page }) => {
  await go(page);
  await narrow(page);
  const p = panel(page);
  expect(await p.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const box = await page.locator('.fdl-files').boundingBox();
  for (const name of ['Close Files', 'Expand Files to full screen', 'Add files']) {
    const b = await p.getByRole('button', { name }).boundingBox();
    expect(b.x + b.width, name).toBeLessThanOrEqual(box.x + box.width);
  }
  await tiles(page).nth(1).click();
  await tiles(page).nth(3).click({ modifiers: ['Shift'] });
  const clear = await p.getByRole('button', { name: 'Clear selection' }).boundingBox();
  expect(clear.x + clear.width).toBeLessThanOrEqual(box.x + box.width);
});

test('the View menu shows which layout and sort are on', async ({ page }) => {
  await go(page);
  await panel(page).getByRole('button', { name: /^View/ }).click();
  const menu = page.locator('.cbt-menu');
  await expect(menu.locator('.ctx-item.is-active', { hasText: /^Grid$/ }).locator('.cbt-check')).toHaveCount(1);
  await expect(menu.locator('.ctx-item', { hasText: /^List$/ }).locator('.cbt-check')).toHaveCount(0);
  await expect(menu.locator('.ctx-item.is-active', { hasText: 'Board order' }).locator('.cbt-check')).toHaveCount(1);
});

test('toasts move clear of the docked panel', async ({ page }) => {
  await go(page);
  await tiles(page).first().click({ button: 'right' });
  await page.locator('.ctx-menu .ctx-item', { hasText: /^Delete/ }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Delete' });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  const toast = page.locator('.toast-stack .toast').first();
  await expect(toast).toBeVisible();
  const t = await toast.boundingBox();
  const f = await page.locator('.fdl-files').boundingBox();
  expect(t.x + t.width).toBeLessThanOrEqual(f.x + 1);
});

test('the title row navigates: ▾ on the current cluster lists the clusters inside it', async ({ page }) => {
  await go(page);
  const here = panel(page).locator('.pb-step.is-here button.pb-here');
  await expect(here).toHaveAttribute('aria-haspopup', 'menu');
  await here.click();
  const menu = page.locator('.pb-menu');
  // The seed's home has sub-clusters only (no linked ones), so the menu lists
  // exactly what CLUSTERS counts.
  const n = Number(await panel(page).locator('.list-section-count').first().textContent());
  expect(n).toBeGreaterThan(0);
  await expect(menu.locator('.pb-menu-item')).toHaveCount(n);
  await menu.locator('.pb-menu-item', { hasText: 'Features' }).click();
  await expect(panel(page).locator('.pb-step.is-here')).toContainText('Features');
  await expect(panel(page).locator('.cbt-ro')).toHaveText('View only');
});

test('panel folders: two rows until Show all, remembered on this device', async ({ page }) => {
  await go(page);
  await narrow(page);   // two columns → four folders shown of the seed's five… unless only one is hidden
  const folders = panel(page).locator('.ft-grid.is-panel [data-folder-id]');
  const total = await panel(page).locator('.list-section-count').first().textContent();
  const more = panel(page).getByRole('button', { name: /^Show all/ });
  if (await more.count()) {
    expect(await folders.count()).toBeLessThan(Number(total));
    await more.click();
    await expect(folders).toHaveCount(Number(total));
    await page.reload();
    await expect(page.locator('.rail-brand')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Show fewer' })).toBeVisible();
  } else {
    await expect(folders).toHaveCount(Number(total));
  }
});

test('captions drop the file extension; the tooltip keeps the full name', async ({ page }) => {
  await go(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await panel(page).locator('input[type="file"][multiple]').setInputFiles([{ name: 'grade-ref.png', mimeType: 'image/png', buffer: png }]);
  const name = panel(page).locator('.ct-tile-name[title="grade-ref.png"]');
  await expect(name).toHaveText('grade-ref');
});

test('the round check on a tile adds it to the selection without a modifier key', async ({ page }) => {
  await go(page);
  await tiles(page).nth(1).click();
  await tiles(page).nth(3).hover();
  await tiles(page).nth(3).locator('.ct-tile-check').click();
  await expect(tiles(page).nth(1)).toHaveClass(/is-selected/);
  await expect(tiles(page).nth(3)).toHaveClass(/is-selected/);
  await expect(panel(page).locator('.list-selbar-count')).toHaveText('2 selected');
  await tiles(page).nth(3).locator('.ct-tile-check').click();
  await expect(tiles(page).nth(3)).not.toHaveClass(/is-selected/);
});

async function dragFilesOver(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.list-wrap.is-panel');
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'a.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
}

test('dragging files over the panel says where they go — and, browsing, that they can\'t', async ({ page }) => {
  await go(page);
  await dragFilesOver(page);
  await expect(panel(page).locator('.lp-drop')).toContainText('Drop to add to');
  await expect(panel(page).locator('.lp-drop')).toContainText('off the board');
  await page.evaluate(() => document.querySelector('.list-wrap.is-panel').dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: document.body })));
  await expect(panel(page).locator('.lp-drop')).toHaveCount(0);
  // Browsing another cluster: read-only here.
  await panel(page).locator('[data-folder-id]').first().dblclick();
  await expect(panel(page).locator('.cbt-ro')).toBeVisible();
  await dragFilesOver(page);
  await expect(panel(page).locator('.lp-drop.is-blocked')).toContainText('to add files');
});

test('a cluster with no files says so and offers the one thing to do', async ({ page }) => {
  await go(page);
  await panel(page).locator('[data-folder-id]').first().dblclick();
  const empty = panel(page).locator('.list-empty.is-compact');
  await expect(empty).toBeVisible();
  await expect(empty.locator('.list-empty-title')).toContainText('No files in');
});

test('Quick look gives a link its own card with an Open link that works for a bare domain', async ({ page }) => {
  await go(page);
  await panel(page).locator('[data-item-id="home-link"]').dblclick();
  const open = page.locator('.ql .ql-link a.ql-open');
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute('href', 'https://docs.soleil');
});
