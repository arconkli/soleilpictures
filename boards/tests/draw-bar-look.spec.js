// The draw bar in the toolbar look (the owner's pick "A · Islands", mockup
// A-draw), held to a dev opt-in (lib/appHost.js toolbarLookAllowed;
// components/toolbar/CanvasBarsA.jsx): undo, the three modes, the four
// brushes, the colours, the widths and Canvas, each by name, in the room the
// rail and the zoom leave it; the eraser keeps only its sizes and the lasso
// only what it does; a window too narrow for the row folds it a step at a
// time, never cutting its end off; under a finger the brush, the colour and
// the width are one chip's menu. Today's bar keeps nothing of the look.
//
// On the real canvas, through ?local=1.
import { expect, test } from '@playwright/test';

const look = (page, on) => page.addInitScript((v) => {
  try { window.localStorage.setItem('soleil.dev.toolbarLook', v); } catch (_) {}
}, on ? '1' : '0');
const bar = (page) => page.getByRole('toolbar', { name: 'Drawing' });
const button = (page, name) => bar(page).getByRole('button', { name, exact: true });
const names = (page) => bar(page).locator('button, input')
  .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()));
const meets = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// The draw tool armed on the local board: its bar is up.
async function drawing(page, { on = true, touch = false } = {}) {
  await look(page, on);
  await page.goto('/?local=1&reset=1&blank=1');
  await page.locator('.canvas-wrap').waitFor({ timeout: 30000 });
  // What only the dev harness draws: the tweaks gear in the corner.
  await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
  await page.waitForTimeout(600);
  const tool = page.locator('.cnv-tools').getByRole('button', { name: 'Free-draw tool' });
  if (touch) await tool.tap(); else await page.keyboard.press('d');
  await expect(bar(page)).toBeVisible();
}

// A stroke across the middle of the canvas, as real pointer events.
async function stroke(page) {
  await page.evaluate(async () => {
    const el = document.querySelector('.canvas-wrap');
    const r = el.getBoundingClientRect();
    const ev = (t, x, extra = {}) => new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true, pointerId: 7,
      pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
      clientX: r.left + x, clientY: r.top + r.height / 2, ...extra,
    });
    el.dispatchEvent(ev('pointerdown', r.width * 0.35));
    for (let i = 1; i <= 12; i++) {
      window.dispatchEvent(ev('pointermove', r.width * (0.35 + 0.2 * i / 12)));
      await new Promise(requestAnimationFrame);
    }
    window.dispatchEvent(ev('pointerup', r.width * 0.55, { buttons: 0 }));
    await new Promise(requestAnimationFrame);
  });
  await page.waitForTimeout(150);
}
const lastStroke = (page) => page.locator('[data-stroke-line]').last().evaluate((p) => p.outerHTML.toLowerCase());

test('on a desktop the A-draw row: undo, the modes, the brushes, the colours, the widths and Canvas, by name', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await drawing(page);
  await expect(page.locator('html')).toHaveAttribute('data-tb', 'a');
  await expect(bar(page)).toHaveClass(/\btob-a\b/);
  const got = await names(page);
  expect(got.slice(0, 8)).toEqual(['Undo', 'Pen', 'Eraser', 'Lasso', 'Pen brush', 'Marker brush', 'Highlighter brush', 'Pencil brush']);
  const colours = got.filter((n) => /^Color #/.test(n));
  expect(colours).toHaveLength(9);
  expect(got.slice(8 + 9)).toEqual(['Custom color', 'Stroke width 2', 'Stroke width 4', 'Stroke width 8', 'Stroke width 16',
    'Open a fullscreen drawing canvas']);
  await expect(button(page, 'Pen')).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, 'Undo')).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+Z$/);
  await expect(button(page, 'Lasso')).toHaveAttribute('data-tl-tip', 'Lasso: circle strokes to select them');
  await expect(button(page, 'Open a fullscreen drawing canvas')).toHaveText('Canvas');
  // One brush, one colour and one width are on.
  await expect(bar(page).getByRole('button', { name: / brush$/, pressed: true })).toHaveCount(1);
  await expect(bar(page).getByRole('button', { name: /^Color #/, pressed: true })).toHaveCount(1);
  await expect(bar(page).getByRole('button', { name: /^Stroke width /, pressed: true })).toHaveCount(1);
});

test('a colour, a brush and a width picked are what the next stroke draws with', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await drawing(page);
  const red = button(page, 'Color #ef4444');
  await red.click();
  await expect(red).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'Marker brush').click();
  await expect(button(page, 'Marker brush')).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'Stroke width 8').click();
  await expect(button(page, 'Stroke width 8')).toHaveAttribute('aria-pressed', 'true');
  await stroke(page);
  expect(await lastStroke(page)).toContain('#ef4444');
});

test('the eraser keeps only its sizes; the lasso only what it does', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await drawing(page);
  await button(page, 'Eraser').click();
  await expect(button(page, 'Eraser')).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, 'Pen')).toHaveAttribute('aria-pressed', 'false');
  await expect(bar(page).getByRole('button', { name: / brush$/ })).toHaveCount(0);
  await expect(bar(page).getByRole('button', { name: /^Color #/ })).toHaveCount(0);
  await expect(bar(page).getByRole('button', { name: /^Eraser size / })).toHaveCount(4);

  await button(page, 'Lasso').click();
  await expect(button(page, 'Lasso')).toHaveAttribute('aria-pressed', 'true');
  await expect(bar(page).getByRole('button', { name: /^(Eraser size|Stroke width) / })).toHaveCount(0);
  await expect(bar(page)).toContainText('Circle strokes to select');

  await button(page, 'Pen').click();
  await expect(bar(page).getByRole('button', { name: / brush$/ })).toHaveCount(4);
});

test('Canvas opens the sketch pad, and Undo takes the last stroke back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await drawing(page);
  await stroke(page);
  await expect(page.locator('[data-stroke-line]')).toHaveCount(1);
  await button(page, 'Undo').click();
  await expect(page.locator('[data-stroke-line]')).toHaveCount(0);
  await button(page, 'Open a fullscreen drawing canvas').click();
  await expect(page.locator('.sketchpad-frame')).toBeVisible();
});

test('on a desktop it sits between the rail and the zoom, and a narrower window folds it a step at a time, never cutting its end off', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await drawing(page);
  const at = async (width) => {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(400);
    const [b, rail, zoom] = await Promise.all([
      bar(page).boundingBox(), page.locator('.cnv-tools').boundingBox(), page.locator('.cnv-zoom').boundingBox(),
    ]);
    expect(await bar(page).evaluate((el) => el.scrollWidth - el.clientWidth), `${width}: the row's end is cut off`)
      .toBeLessThanOrEqual(1);
    expect(meets(b, rail), `${width}: over the rail`).toBe(false);
    expect(meets(b, zoom), `${width}: over the zoom`).toBe(false);
    await expect(bar(page)).toHaveCSS('transform', 'none');
    // How far it has folded, by what's on it: the brushes go first, then
    // the colours, then the widths with them into one chip.
    return bar(page).evaluate((el) => {
      const named = (re) => [...el.querySelectorAll('button')].some((x) => re.test(x.getAttribute('aria-label') || ''));
      if (named(/ brush$/)) return 0;
      if (named(/^Color #/)) return 1;
      if (named(/^Stroke width /)) return 2;
      return 3;
    });
  };
  const down = [];
  for (const w of [1440, 1280, 1100, 1000, 900, 760, 660]) down.push(await at(w));
  expect(down[0]).toBe(0);
  for (let i = 1; i < down.length; i++) expect(down[i], `${down}`).toBeGreaterThanOrEqual(down[i - 1]);
  expect(down.at(-1), `${down}`).toBeGreaterThan(0);
  const up = [];
  for (const w of [900, 1440]) up.push(await at(w));
  expect(up.at(-1)).toBe(0);
});

test('folded, the brush and the colour are menus of their own, and work there', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await drawing(page);
  const brush = bar(page).getByRole('button', { name: /^Brush: / });
  await expect(brush).toBeVisible();
  await brush.click();
  await page.getByRole('menu', { name: /^Brush/ }).getByRole('menuitemradio', { name: 'Pencil' }).click();
  await expect(brush).toHaveAttribute('aria-label', 'Brush: Pencil');
  const colour = bar(page).getByRole('button', { name: /^Color: / });
  if (await colour.count()) {
    await colour.click();
    await page.locator('.db-colour-menu').getByLabel('Color #3b82f6', { exact: true }).click();
    await expect(colour).toHaveAttribute('aria-label', 'Color: #3b82f6');
  }
});

test('today\'s draw bar keeps nothing of the look', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await drawing(page, { on: false });
  await expect(bar(page)).not.toHaveClass(/\btob-a\b/);
  await expect(bar(page).locator('[data-tl-tip]')).toHaveCount(0);
  await expect(bar(page).locator('.tob-segmented')).toBeVisible();
  await expect(bar(page).locator('.tob-canvas-btn')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('undo, the modes, one chip for the brush, the colour and the width, and Canvas', async ({ page }) => {
    await drawing(page, { touch: true });
    expect(await names(page)).toEqual(['Undo', 'Pen', 'Eraser', 'Lasso', 'Brush, color and width',
      'Open a fullscreen drawing canvas']);
    expect(await bar(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await button(page, 'Brush, color and width').tap();
    const menu = page.getByRole('menu', { name: 'Brush, color and width' });
    await expect(menu.getByRole('group', { name: 'Brush' }).getByRole('menuitemradio')).toHaveCount(4);
    await expect(menu.getByRole('group', { name: 'Width' }).getByRole('menuitemradio')).toHaveCount(4);
    await menu.getByLabel('Color #ef4444', { exact: true }).tap();
    await expect(menu).toBeHidden();
    await button(page, 'Brush, color and width').tap();
    await expect(menu.getByLabel('Color #ef4444', { exact: true })).toHaveAttribute('aria-checked', 'true');
  });
});
