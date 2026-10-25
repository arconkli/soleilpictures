// The shape, line and arrow bars in the toolbar look (the owner's pick
// "A · Islands", mockup A-parts), held to a dev opt-in (lib/appHost.js
// toolbarLookAllowed; components/toolbar/CanvasBarsA.jsx): the shape as a
// menu of shapes, its stroke and fill as colour chips with their menus, the
// width between − and +, the line style as a menu; a line's colour, width,
// style and angle; the arrow tool's path and style as two pairs of words.
// Under a finger what doesn't fit is ⋯'s. Today's bars keep nothing of the
// look.
//
// On the real canvas, through ?local=1.
import { expect, test } from '@playwright/test';
import { pickArrowHead } from './helpers/arrowBar.js';

const look = (page, on) => page.addInitScript((v) => {
  try { window.localStorage.setItem('soleil.dev.toolbarLook', v); } catch (_) {}
}, on ? '1' : '0');
const bar = (page, name) => page.getByRole('toolbar', { name });
const names = (loc) => loc.locator('button, input')
  .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()));

async function board(page, on = true) {
  await look(page, on);
  await page.goto('/?local=1&reset=1&blank=1');
  await page.locator('.canvas-wrap').waitFor({ timeout: 30000 });
  await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
  await page.waitForTimeout(600);
}
// The shape tool, from the rail's + menu.
async function shapeTool(page, { touch = false } = {}) {
  const add = page.locator('.cnv-tools').getByRole('button', { name: 'Add menu' });
  if (touch) await add.tap(); else await add.click();
  const item = page.locator('.cnv-add-menu [role="menuitem"][aria-label="Shape"]');
  if (touch) await item.tap(); else await item.click();
  await expect(bar(page, 'Shape')).toBeVisible();
}
// A shape on the board, picked: its bar is up.
async function aShape(page) {
  const wrap = page.locator('.canvas-wrap');
  await wrap.evaluate((node) => {
    const r = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 520, clientY: r.top + 220 }));
  });
  await page.locator('.ctx-menu').first().locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('menuitem', { name: 'Shape', exact: true }).click();
  const card = page.locator('.card-kind-shape').first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(bar(page, 'Shape')).toBeVisible();
  return card;
}
// An arrow drawn across the middle of an empty board, then picked, and made
// a line (no arrowheads): its bar is up.
async function aLine(page) {
  await page.keyboard.press('a');
  const b = await page.locator('.canvas-wrap').boundingBox();
  const from = { x: b.x + b.width * 0.3, y: b.y + b.height * 0.4 };
  const to = { x: b.x + b.width * 0.7, y: b.y + b.height * 0.55 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('v');
  const hit = page.locator('.arrow-g > path').first();
  const box = await hit.boundingBox();
  await hit.dispatchEvent('pointerdown', {
    button: 0, pointerId: 1, isPrimary: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
  });
  await page.mouse.up();
  await pickArrowHead(page, 'No arrowheads');
  await expect(bar(page, 'Line')).toBeVisible();
}

test('the shape tool\'s bar: the shape, its stroke and fill, the width and the style, by name', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await board(page);
  await shapeTool(page);
  const shape = bar(page, 'Shape');
  await expect(shape).toHaveClass(/\btob-a\b/);
  expect(await names(shape)).toEqual(['Shape: Rect', 'Stroke color', 'Fill', 'Decrease stroke width', 'Stroke width',
    'Increase stroke width', 'Line style: Solid']);
  await shape.getByRole('button', { name: 'Shape: Rect' }).click();
  await page.getByRole('menu', { name: 'Shape' }).getByRole('menuitemradio', { name: 'Ellipse' }).click();
  await expect(shape.getByRole('button', { name: 'Shape: Ellipse' })).toBeVisible();
  const width = shape.getByRole('textbox', { name: 'Stroke width' });
  const before = Number(await width.inputValue());
  await shape.getByRole('button', { name: 'Increase stroke width' }).click();
  await expect(width).toHaveValue(String(before + 1));
  await shape.getByRole('button', { name: 'Line style: Solid' }).click();
  await page.getByRole('menu', { name: 'Line style' }).getByRole('menuitemradio', { name: 'Dashed' }).click();
  await expect(shape.getByRole('button', { name: 'Line style: Dashed' })).toBeVisible();
});

test('a shape picked: a fill and a stroke picked in its bar are the card\'s', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await board(page);
  const card = await aShape(page);
  const shape = bar(page, 'Shape');
  await shape.getByRole('button', { name: 'Fill', exact: true }).click();
  await page.locator('.sb-colour-menu').getByLabel('Color #fef3c7', { exact: true }).click();
  await expect.poll(() => card.evaluate((el) => el.outerHTML.toLowerCase())).toContain('#fef3c7');
  await shape.getByRole('button', { name: 'Stroke color', exact: true }).click();
  await page.locator('.sb-colour-menu').getByLabel('Color #ef4444', { exact: true }).click();
  await expect.poll(() => card.evaluate((el) => el.outerHTML.toLowerCase())).toContain('#ef4444');
  // The fill's menu offers no fill at all.
  await shape.getByRole('button', { name: 'Fill', exact: true }).click();
  await expect(page.locator('.sb-colour-menu').getByLabel('No fill', { exact: true })).toBeVisible();
});

test('the arrow tool\'s bar: Curved | Straight, Solid | Dashed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await board(page);
  await page.locator('.cnv-tools').getByRole('button', { name: 'Arrow tool' }).click();
  const arrow = bar(page, 'Arrow');
  await expect(arrow).toHaveClass(/\btob-a\b/);
  expect(await names(arrow)).toEqual(['Curved', 'Straight', 'Solid', 'Dashed']);
  await expect(arrow.getByRole('button', { name: 'Curved' })).toHaveAttribute('aria-pressed', 'true');
  await arrow.getByRole('button', { name: 'Straight' }).click();
  await expect(arrow.getByRole('button', { name: 'Straight' })).toHaveAttribute('aria-pressed', 'true');
  await expect(arrow.getByRole('button', { name: 'Curved' })).toHaveAttribute('aria-pressed', 'false');
  await arrow.getByRole('button', { name: 'Dashed' }).click();
  await expect(arrow.getByRole('button', { name: 'Dashed' })).toHaveAttribute('aria-pressed', 'true');
});

test('a line picked: its colour, width, style and angle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await board(page);
  await aLine(page);
  const line = bar(page, 'Line');
  await expect(line).toHaveClass(/\btob-a\b/);
  expect(await names(line)).toEqual(['Line color', 'Decrease line width', 'Line width', 'Increase line width',
    'Line style: Solid', 'Angle']);
  const angle = line.getByRole('textbox', { name: 'Angle' });
  await angle.fill('45');
  await angle.press('Enter');
  await expect(angle).toHaveValue('45');
  await line.getByRole('button', { name: 'Increase line width' }).click();
  await expect(line.getByRole('textbox', { name: 'Line width' })).toHaveValue('3');
});

test('today\'s shape and arrow bars keep nothing of the look', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await board(page, false);
  await shapeTool(page);
  await expect(bar(page, 'Shape')).not.toHaveClass(/\btob-a\b/);
  await expect(bar(page, 'Shape').locator('select.tob-select').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.cnv-tools').getByRole('button', { name: 'Arrow tool' }).click();
  await expect(bar(page, 'Arrow').locator('.tob-segmented').first()).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the shape bar keeps the shape and its colours, and ⋯ holds the width and the style', async ({ page }) => {
    await board(page);
    await shapeTool(page, { touch: true });
    const shape = bar(page, 'Shape');
    expect(await names(shape)).toEqual(['Shape: Rect', 'Stroke color', 'Fill', 'More shape options']);
    expect(await shape.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await shape.getByRole('button', { name: 'More shape options' }).tap();
    const more = page.locator('.sb-more');
    await expect(more.getByRole('group', { name: 'Stroke width' })).toBeVisible();
    await more.getByRole('menuitemradio', { name: 'Dotted' }).tap();
    await shape.getByRole('button', { name: 'More shape options' }).tap();
    await expect(more.getByRole('menuitemradio', { name: 'Dotted' })).toHaveAttribute('aria-checked', 'true');
  });
});
