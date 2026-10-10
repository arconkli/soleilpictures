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
