// The sketch pad's bar in the toolbar look (the owner's pick "A · Islands"),
// shipped 2026-10-25: the tools are the look's icons, the canvas draw bar's,
// at 32px, with the look's glass tooltip; what's on (the tool, the brush, the
// layer you draw on) is the look's gold tint and ring rather than a gold
// border, and a screen reader hears which tool is on; the bar still wraps
// whole inside the pad.
import { expect, test } from '@playwright/test';


async function openPad(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.waitForTimeout(1000);
  await page.keyboard.press('d');
  await page.locator('.tob-canvas-btn').first().click();
  await expect(page.locator('.sketchpad-surface')).toBeVisible();
}

const bar = (page) => page.locator('.sketchpad-toolbar').first();
const ON_TINT = 'rgba(255, 165, 0, 0.14)';
const ON_RING = 'rgba(255, 165, 0, 0.34)';
const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);

test('the pad\'s tools are the look\'s icons, the one that\'s on in its tint and ring', async ({ page }) => {
  await openPad(page);
  const pen = bar(page).getByRole('button', { name: 'Pen', exact: true });
  const eraser = bar(page).getByRole('button', { name: 'Eraser', exact: true });
  for (const name of ['Pen', 'Eraser', 'Paint bucket']) {
    const b = bar(page).getByRole('button', { name, exact: true });
    await expect(b.locator('svg'), name).toHaveAttribute('viewBox', '0 0 256 256');
    await expect(b, name).toHaveText('');
    await expect(b, name).not.toHaveAttribute('title', /.*/);
  }
  expect(await pen.evaluate((el) => [el.offsetWidth, el.offsetHeight])).toEqual([32, 32]);
  await expect(pen).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => bg(pen)).toBe(ON_TINT);
  expect(await pen.evaluate((el) => getComputedStyle(el).boxShadow)).toContain(ON_RING);
  await eraser.click();
  await expect(eraser).toHaveAttribute('aria-pressed', 'true');
  await expect(pen).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => bg(eraser)).toBe(ON_TINT);
  await expect.poll(() => bg(pen)).toBe('rgba(0, 0, 0, 0)');
  // The look's tooltip (the pointer is on another tool than the one it
  // pressed), and Undo's carries its keys.
  await bar(page).getByRole('button', { name: 'Paint bucket', exact: true }).hover();
  await expect(page.locator('.tl-tip')).toContainText('Paint bucket: a click fills the background');
  const undo = bar(page).getByRole('button', { name: 'Undo sketch change' });
  await expect(undo).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+Z$/);
  await expect(undo).toHaveAttribute('data-tl-keys', 'Mod+Z');
  // The brush that's on wears it too.
  const brush = bar(page).locator('.sp-brush.is-active');
  await expect.poll(() => bg(brush)).toBe(ON_TINT);
});

test('the layer you draw on wears the on, and its row\'s controls are the look\'s icons', async ({ page }) => {
  await openPad(page);
  await bar(page).getByRole('button', { name: /^Layers/ }).click();
  const layer = page.locator('.sp-layer.is-active');
  await expect(layer).toBeVisible();
  await expect.poll(() => bg(layer)).toBe(ON_TINT);
  await expect(layer.locator('.sp-layer-eye svg')).toHaveCount(1);
  await expect(layer.locator('.sp-layer-btn svg')).toHaveCount(3);
});

test('at 1024×768 every control on the bar is whole, inside the pad, in the look', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.waitForTimeout(1000);
  await page.keyboard.press('d');
  await page.locator('.tob-canvas-btn').first().click();
  await expect(page.locator('.sketchpad-surface')).toBeVisible();
  const faults = await page.evaluate(() => {
    const pad = document.querySelector('.sketchpad-frame').getBoundingClientRect();
    const out = [];
    for (const el of document.querySelectorAll('.sketchpad-toolbar button')) {
      const r = el.getBoundingClientRect();
      const name = el.getAttribute('aria-label') || el.textContent.trim();
      if (r.left < pad.left - 0.5 || r.right > pad.right + 0.5) out.push(`${name}: past the pad's edge`);
      else if (el.scrollWidth > el.clientWidth + 1 || r.width < 20) out.push(`${name}: squeezed to ${Math.round(r.width)}px`);
    }
    return out;
  });
  expect(faults).toEqual([]);
  // A hairline the wrap leaves at a row's end hides; the rest show.
  const seps = await page.evaluate(() => [...document.querySelectorAll('.sketchpad-toolbar > .sp-sep')].map((sep) => {
    const r = sep.getBoundingClientRect();
    const prev = sep.previousElementSibling.getBoundingClientRect();
    const next = sep.nextElementSibling.getBoundingClientRect();
    return { rowEnd: prev.bottom <= r.top || next.top >= r.bottom, visibility: getComputedStyle(sep).visibility };
  }));
  expect(seps.some((s) => s.rowEnd)).toBe(true);
  for (const s of seps) expect(s.visibility).toBe(s.rowEnd ? 'hidden' : 'visible');
});
