// The sketch pad's bar on a desktop is one row: tools, brushes, colours,
// widths, frame shapes, Layers, Undo, Redo, Clear, Cancel, Add and Close. It
// is wider than the pad at common window sizes and could neither wrap nor
// scroll, so its controls squeezed (a colour swatch drew 4px wide) and what
// still didn't fit was cut off at the pad's edge. It wraps onto a second row
// instead, as the doc toolbar does under a mouse, and every control keeps its
// size.
import { expect, test } from '@playwright/test';

async function openPad(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.waitForTimeout(1000);
  await page.keyboard.press('d');
  await page.waitForTimeout(300);
  await page.locator('.tob-canvas-btn').first().click();
  await expect(page.locator('.sketchpad-surface')).toBeVisible();
  await page.waitForTimeout(200);
}

// Every control on the bar that is cut off by the pad's edge or squeezed
// narrower than its own size.
const faults = (page) => page.evaluate(() => {
  const pad = document.querySelector('.sketchpad-frame').getBoundingClientRect();
  const out = [];
  for (const el of document.querySelectorAll('.sketchpad-toolbar button')) {
    const r = el.getBoundingClientRect();
    const name = el.getAttribute('aria-label') || el.title || el.textContent.trim();
    if (r.left < pad.left - 0.5 || r.right > pad.right + 0.5) out.push(`${name}: past the pad's edge`);
    else if (el.scrollWidth > el.clientWidth + 1 || r.width < 20) out.push(`${name}: squeezed to ${Math.round(r.width)}px`);
  }
  return out;
});

for (const [w, h] of [[1280, 800], [1024, 768]]) {
  test(`at ${w}×${h} every control on the pad's bar is whole, inside the pad`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openPad(page);
    expect(await faults(page)).toEqual([]);
    // The drawing surface still has the room under the bar.
    const surface = await page.locator('.sketchpad-surface').boundingBox();
    expect(surface.height).toBeGreaterThan(h / 3);
  });
}
