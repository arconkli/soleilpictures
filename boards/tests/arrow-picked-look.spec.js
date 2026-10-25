// A picked arrow's bar in the toolbar look (the owner's pick "A · Islands";
// components/toolbar/CanvasBarsA.jsx PickedArrowBarA), held to a dev opt-in
// (lib/appHost.js toolbarLookAllowed): over the arrow's middle, as today's
// popover sits, in the look's glass: its colour as a chip with its menu, its
// width, its heads, its path and its dashes, what's on in the look's tint and
// ring, the heads drawn as icons rather than — → ↔; its label; Delete, with
// Undo. A phone's row keeps the colour, the label and Delete, and ⋯ holds the
// rest, a row each, picked in place. Today's popover keeps nothing of the
// look.
//
// On the real canvas, through ?local=1.
import { expect, test } from '@playwright/test';

const look = (page, on) => page.addInitScript((v) => {
  try { window.localStorage.setItem('soleil.dev.toolbarLook', v); } catch (_) {}
}, on ? '1' : '0');
const bar = (page) => page.getByRole('toolbar', { name: 'Selected arrow' });
const line = (page) => page.locator('.arrow-g path[data-arrow-line]').first();

async function board(page, on = true) {
  await look(page, on);
  await page.goto('/?local=1&reset=1&blank=1');
  await page.locator('.canvas-wrap').waitFor({ timeout: 30000 });
  await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
  await page.waitForTimeout(600);
}
// An arrow drawn across the middle of an empty board, then picked.
async function anArrow(page) {
  await page.keyboard.press('a');
  const b = await page.locator('.canvas-wrap').boundingBox();
  const from = { x: b.x + b.width * 0.3, y: b.y + b.height * 0.45 };
  const to = { x: b.x + b.width * 0.7, y: b.y + b.height * 0.6 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('v');
  const hit = page.locator('.arrow-g > path').first();
  const box = await hit.boundingBox();
  await hit.dispatchEvent('pointerdown', {
    button: 0, pointerId: 1, isPrimary: true,
    clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
  });
  await page.mouse.up();
}

test('a picked arrow\'s bar is the look\'s island over the arrow, the heads as icons', async ({ page }) => {
  await board(page);
  await anArrow(page);
  const b = bar(page);
  await expect(b).toBeVisible();
  await expect(page.locator('.arrow-popover')).toHaveCount(0);
  await expect(b).toHaveClass(/tl-bar/);
  // Over the arrow's middle, clear of it.
  const r = await b.boundingBox();
  const a = await line(page).boundingBox();
  expect(r.y + r.height).toBeLessThanOrEqual(a.y + a.height / 2);
  expect(Math.abs(r.x + r.width / 2 - (a.x + a.width / 2))).toBeLessThan(r.width / 2);

  const heads = b.getByRole('group', { name: 'Arrow heads' });
  for (const name of ['No arrowheads', 'Single arrowhead', 'Double arrowhead']) {
    const h = heads.getByRole('button', { name });
    await expect(h).toBeVisible();
    await expect(h.locator('svg')).toHaveCount(1);
    await expect(h).toHaveText('');
  }
  // What's on: the arrow's own head, in the look's tint and ring.
  const single = heads.getByRole('button', { name: 'Single arrowhead' });
  await expect(single).toHaveAttribute('aria-pressed', 'true');
  await expect(single).toHaveClass(/is-on/);
  await expect(heads.getByRole('button', { name: 'Double arrowhead' })).toHaveAttribute('aria-pressed', 'false');
  for (const name of ['Thin', 'Medium', 'Thick', 'Curved', 'Straight']) await expect(b.getByRole('button', { name })).toBeVisible();
  await expect(b.getByRole('button', { name: 'Dashed' })).toHaveAttribute('aria-pressed', 'false');
  await expect(b.getByRole('button', { name: 'Arrow color' })).toBeVisible();
  await expect(b.getByRole('textbox', { name: 'Arrow label' })).toBeVisible();
  await expect(b.getByRole('button', { name: 'Delete arrow' })).toBeVisible();
});

test('every control of the bar sets what it says', async ({ page }) => {
  await board(page);
  await anArrow(page);
  const b = bar(page);
  await expect(b).toBeVisible();

  // Colour, from the chip's menu.
  await b.getByRole('button', { name: 'Arrow color' }).click();
  const menu = page.getByRole('menu', { name: 'Arrow color' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: 'Color red' }).click();
  await expect(menu).toBeHidden();
  await expect(line(page)).toHaveAttribute('stroke', /arrow-red/);
  await expect(b).toBeVisible();

  // Width.
  const thin = Number(await line(page).getAttribute('stroke-width'));
  await b.getByRole('button', { name: 'Thick' }).click();
  await expect.poll(async () => Number(await line(page).getAttribute('stroke-width'))).toBeGreaterThan(thin);
  await expect(b.getByRole('button', { name: 'Thick' })).toHaveAttribute('aria-pressed', 'true');

  // Heads.
  await b.getByRole('button', { name: 'Double arrowhead' }).click();
  await expect(page.locator('.arrow-g polygon')).toHaveCount(2);
  await b.getByRole('button', { name: 'Single arrowhead' }).click();
  await expect(page.locator('.arrow-g polygon')).toHaveCount(1);

  // Path.
  await b.getByRole('button', { name: 'Straight' }).click();
  await expect(line(page)).not.toHaveAttribute('d', /[CQ]/);
  await expect(b.getByRole('button', { name: 'Straight' })).toHaveAttribute('aria-pressed', 'true');
  await b.getByRole('button', { name: 'Curved' }).click();
  await expect(b.getByRole('button', { name: 'Curved' })).toHaveAttribute('aria-pressed', 'true');

  // Dashes.
  await b.getByRole('button', { name: 'Dashed' }).click();
  await expect(line(page)).toHaveAttribute('stroke-dasharray', /\d/);
  await expect(b.getByRole('button', { name: 'Dashed' })).toHaveAttribute('aria-pressed', 'true');

  // Label: Enter sets it.
  const label = b.getByRole('textbox', { name: 'Arrow label' });
  await label.click();
  await label.fill('Act two');
  await page.keyboard.press('Enter');
  await expect(page.locator('.arrow-g .arrow-label-text')).toHaveText('Act two');

  // Delete, with Undo.
  await b.getByRole('button', { name: 'Delete arrow' }).click();
  await expect(page.locator('.arrow-g')).toHaveCount(0);
  await expect(b).toBeHidden();
  const toast = page.locator('.toast').filter({ hasText: 'Arrow deleted' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.arrow-g')).toHaveCount(1);
});

test('the bar is one Tab stop, the arrows walk it, and Escape puts it away', async ({ page }) => {
  await board(page);
  await anArrow(page);
  const b = bar(page);
  await expect(b).toBeVisible();
  const chip = b.getByRole('button', { name: 'Arrow color' });
  await chip.focus();
  await page.keyboard.press('ArrowRight');
  await expect(b.getByRole('button', { name: 'Thin' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(chip).toBeFocused();
  // Escape in the colour menu closes the menu, not the bar.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'Arrow color' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Arrow color' })).toBeHidden();
  await expect(b).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(b).toBeHidden();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the row keeps the colour, the label and Delete, and ⋯ holds the rest, a row each', async ({ page }) => {
    await board(page);
    await anArrow(page);
    const b = bar(page);
    await expect(b).toBeVisible();
    const r = await b.boundingBox();
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(390);
    for (const name of ['Thick', 'Double arrowhead', 'Straight', 'Dashed']) await expect(b.getByRole('button', { name })).toHaveCount(0);
    await b.getByRole('button', { name: 'More arrow options' }).tap();
    const more = page.getByRole('menu', { name: 'More arrow options' });
    await expect(more).toBeVisible();
    // Fits on the screen, above the bar.
    const m = await more.boundingBox();
    expect(m.y).toBeGreaterThanOrEqual(0);
    expect(m.y + m.height).toBeLessThanOrEqual(r.y + 1);
    for (const name of ['Arrow heads', 'Width', 'Path', 'Style']) await expect(more.getByRole('group', { name })).toBeVisible();
    await expect(more.getByRole('menuitemradio', { name: 'Single arrowhead' })).toHaveAttribute('aria-checked', 'true');
    // Each picked in place: the menu stays to see it change.
    const thick = more.getByRole('menuitemradio', { name: 'Thick' });
    await thick.tap();
    await expect(more).toBeVisible();
    await expect(thick).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => Number(await line(page).getAttribute('stroke-width'))).toBeGreaterThan(2);
    await more.getByRole('menuitemradio', { name: 'Double arrowhead' }).tap();
    await expect(page.locator('.arrow-g polygon')).toHaveCount(2);
    await more.getByRole('menuitemradio', { name: 'Straight' }).tap();
    await expect(line(page)).not.toHaveAttribute('d', /[CQ]/);
    const dashed = more.getByRole('menuitemradio', { name: 'Dashed' });
    await expect(dashed).toHaveAttribute('aria-checked', 'false');
    await dashed.tap();
    await expect(line(page)).toHaveAttribute('stroke-dasharray', /\d/);
    await expect(dashed).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(more).toBeHidden();
    await expect(b).toBeVisible();
    // The label, at 16px so the phone doesn't zoom into it.
    const label = b.getByRole('textbox', { name: 'Arrow label' });
    expect(await label.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await label.tap();
    await label.fill('Cut');
    await page.keyboard.press('Enter');
    await expect(page.locator('.arrow-g .arrow-label-text')).toHaveText('Cut');
  });
});

test.describe('on an iPad', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });

  test('the row keeps the heads as well, every control a finger\'s, and ⋯ the width, the path and the style', async ({ page }) => {
    await board(page);
    await anArrow(page);
    const b = bar(page);
    await expect(b).toBeVisible();
    const heads = b.getByRole('group', { name: 'Arrow heads' });
    for (const name of ['No arrowheads', 'Single arrowhead', 'Double arrowhead']) await expect(heads.getByRole('button', { name })).toBeVisible();
    for (const name of ['Thick', 'Straight', 'Dashed']) await expect(b.getByRole('button', { name })).toHaveCount(0);
    for (const c of await b.locator('button, input').all()) {
      const box = await c.boundingBox();
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(40);
    }
    await heads.getByRole('button', { name: 'Double arrowhead' }).tap();
    await expect(page.locator('.arrow-g polygon')).toHaveCount(2);
    await b.getByRole('button', { name: 'More arrow options' }).tap();
    const more = page.getByRole('menu', { name: 'More arrow options' });
    await expect(more).toBeVisible();
    await expect(more.getByRole('group', { name: 'Arrow heads' })).toHaveCount(0);
    for (const name of ['Width', 'Path', 'Style']) await expect(more.getByRole('group', { name })).toBeVisible();
    await more.getByRole('menuitemradio', { name: 'Straight' }).tap();
    await expect(line(page)).not.toHaveAttribute('d', /[CQ]/);
    await expect(more).toBeVisible();
  });
});

test('today\'s look keeps today\'s popover', async ({ page }) => {
  await board(page, false);
  await anArrow(page);
  await expect(page.locator('.arrow-popover')).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});
