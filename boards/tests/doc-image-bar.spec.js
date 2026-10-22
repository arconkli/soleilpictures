// The bar that aligns or deletes a doc image hangs above the image while the
// page's view has room for it there. Without room (the image opens the doc,
// or its top has scrolled out of view, which is where a click on a half-seen
// image scrolls it) it hung there anyway, clipped by the page: the image was
// selected and showed no bar at all. It goes below the image instead, and when
// neither edge is in view it rides at the top of the part that is.
// ?docqa=1 harness (window.__soleilDocTest).
import { expect, test } from '@playwright/test';
import { zoomIn } from './helpers/docFrame.js';

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

// A square image, `w` px wide (the page's width caps it).
const image = (w) => `<img src="/apple-touch-icon.png" style="width: ${w}px">`;

async function setDocAndSelect(page, html) {
  await page.evaluate((h) => window.__soleilDocTest.editor.commands.setContent(h), html);
  const img = page.locator('.doc-card-modal .tt-img').first();
  await expect.poll(() => img.evaluate((el) => el.naturalHeight)).toBeGreaterThan(0);
  await img.click();
  await expect(page.locator('.doc-card-modal .tt-img-wrap.is-selected')).toHaveCount(1);
}

// Scroll the page so the image's top edge sits `dy` screen px below the top of
// its view (negative: above it, out of view).
const scrollImageTo = (page, dy) => page.evaluate((d) => {
  const paper = document.querySelector('.doc-card-modal .doc-paper');
  const img = document.querySelector('.doc-card-modal .tt-img');
  paper.scrollTop += img.getBoundingClientRect().top - paper.getBoundingClientRect().top - d;
}, dy);

const geo = (page) => page.evaluate(() => {
  const box = (sel) => {
    const b = document.querySelector(`.doc-card-modal ${sel}`).getBoundingClientRect();
    return { top: b.top, bottom: b.bottom };
  };
  return { view: box('.doc-paper'), img: box('.tt-img'), bar: box('.tt-img-tb') };
});
const where = (g) => {
  const inView = g.bar.top >= g.view.top - 0.5 && g.bar.bottom <= g.view.bottom + 0.5;
  if (!inView) return 'out of view';
  if (g.bar.bottom <= g.img.top + 1) return 'above';
  if (g.bar.top >= g.img.bottom - 1) return 'below';
  return g.bar.top - Math.max(g.img.top, g.view.top) < 16 ? 'inside, at the top of what shows' : 'inside';
};

test('with room above the image, the bar is above it', async ({ page }) => {
  await openDoc(page);
  await setDocAndSelect(page, `${'<p>Before.</p>'.repeat(10)}${image(240)}${'<p>After.</p>'.repeat(10)}`);
  await scrollImageTo(page, 200);
  await expect.poll(async () => where(await geo(page))).toBe('above');
});

test('an image that opens the doc, or whose top is at the top of the view, has its bar below it', async ({ page }) => {
  await openDoc(page);
  await setDocAndSelect(page, `${image(240)}${'<p>After the image.</p>'.repeat(10)}`);
  await scrollImageTo(page, 0);
  await expect.poll(async () => where(await geo(page))).toBe('below');
  // Scrolled down to where there is room above again, it goes back up.
  await page.evaluate(() => { document.querySelector('.doc-card-modal .doc-paper').scrollTop = 0; });
  await scrollImageTo(page, 120);
  await expect.poll(async () => where(await geo(page))).toBe('above');
});

// The image stays selected after either, and so do its bar and handle: an
// update to the image redrew its frame without them, so the bar was good for
// one press and the handle for one drag.
test('the bar and the handle stay after an align or a resize', async ({ page }) => {
  await openDoc(page);
  await setDocAndSelect(page, `<p>Before.</p>${image(240)}<p>After.</p>`);
  const wrap = page.locator('.doc-card-modal .tt-img-wrap');
  const bar = page.locator('.doc-card-modal .tt-img-tb');
  await bar.getByRole('button', { name: 'Align left' }).click();
  await expect(wrap).toHaveClass(/\btt-img-align-left\b/);
  await expect(wrap).toHaveClass(/\bis-selected\b/);
  await bar.getByRole('button', { name: 'Align right' }).click();
  await expect(wrap).toHaveClass(/\btt-img-align-right\b/);
  const h = await page.locator('.doc-card-modal .tt-img-resize').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 60, h.y + h.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__soleilDocTest.editor.getJSON().content
    .find((n) => n.type === 'image')?.attrs.width)).not.toBe('240px');
  await expect(wrap).toHaveClass(/\bis-selected\b/);
  await expect(page.locator('.doc-card-modal .tt-img-resize')).toHaveCSS('opacity', '1');
});

test('with neither edge of a tall image in view, the bar rides at the top of what shows, at any zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await openDoc(page);
  await zoomIn(page.locator('.doc-card-modal'), 2);
  await setDocAndSelect(page, `${'<p>Before.</p>'.repeat(10)}${image(700)}${'<p>After.</p>'.repeat(10)}`);
  await scrollImageTo(page, -120);
  const g = await geo(page);
  expect(g.img.bottom, 'the image runs past the bottom of the view').toBeGreaterThan(g.view.bottom + 40);
  await expect.poll(async () => where(await geo(page))).toBe('inside, at the top of what shows');
  // Further down the image, it keeps up.
  await scrollImageTo(page, -260);
  await expect.poll(async () => where(await geo(page))).toBe('inside, at the top of what shows');
});
