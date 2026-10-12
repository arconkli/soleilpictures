// Canvas fixes from the runtime visual sweep (VS-CANVAS-*). Each test plants
// cards into the saved local session (?local=1, no backend) and measures the
// rendered geometry the sweep measured, so a regression reads as numbers.

import { expect, test } from '@playwright/test';

const KEY = 'soleil.boards.local.session.v1';

async function plant(page, cards) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate((k) => !!localStorage.getItem(k), KEY)).toBe(true);
  await page.evaluate(({ k, cards }) => {
    const s = JSON.parse(localStorage.getItem(k));
    const id = s.stack[s.stack.length - 1];
    const st = s.localState.boardState[id] || { cards: [], arrows: [], strokes: [] };
    st.cards = [...(st.cards || []), ...cards];
    s.localState.boardState[id] = st;
    localStorage.setItem(k, JSON.stringify(s));
  }, { k: KEY, cards });
  await page.goto('/?local=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
}

const rect = (page, sel) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height };
});

const SHAPES = [
  { id: 'sh1', kind: 'shape', shape: 'rect', x: 120, y: 120, w: 160, h: 90, label: 'Act one opens' },
  { id: 'sh2', kind: 'shape', shape: 'ellipse', x: 340, y: 120, w: 180, h: 110, stroke: '#3b82f6', label: 'A longer label that should wrap inside the ellipse' },
  { id: 'sh3', kind: 'shape', shape: 'diamond', x: 580, y: 120, w: 150, h: 130, stroke: '#f59e0b', label: 'Decide' },
];

test.describe('VS-CANVAS-01 shape labels', () => {
  test('a label is centred inside its shape, not shifted up and left', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await plant(page, SHAPES);
    for (const s of SHAPES) {
      const card = await rect(page, `[data-card-id="${s.id}"]`);
      const label = await rect(page, `[data-card-id="${s.id}"] .shape-label`);
      // Inside the card…
      expect(label.x).toBeGreaterThanOrEqual(card.x - 0.5);
      expect(label.y).toBeGreaterThanOrEqual(card.y - 0.5);
      expect(label.r).toBeLessThanOrEqual(card.r + 0.5);
      expect(label.b).toBeLessThanOrEqual(card.b + 0.5);
      // …and centred on it.
      expect(Math.abs((label.x + label.r) / 2 - (card.x + card.r) / 2)).toBeLessThan(2);
      expect(Math.abs((label.y + label.b) / 2 - (card.y + card.b) / 2)).toBeLessThan(2);
    }
    await page.screenshot({ path: test.info().outputPath('shapes-dark.png') });
  });
});

// The full menu, measured: its box, whether the last row is inside the window
// after scrolling it to the end, and its row texts.
const menuState = (page) => page.locator('.ctx-menu:not(.ctx-submenu)').first().evaluate(async (el) => {
  // The open animation slides the menu 4px; measure where it comes to rest.
  await Promise.all(el.getAnimations().map((a) => a.finished));
  el.scrollTop = el.scrollHeight;
  const r = el.getBoundingClientRect();
  const rows = [...el.querySelectorAll(':scope > .ctx-item, :scope > .ctx-submenu-wrap > .ctx-item')];
  const last = rows[rows.length - 1].getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, lastBottom: last.bottom, ih: window.innerHeight, text: rows.map((b) => b.textContent) };
});

test.describe('VS-CANVAS-02/03 context menus stay inside the window', () => {
  test('a touch tablet card menu opened low keeps Delete reachable', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const page = await ctx.newPage();
    await plant(page, [{ id: 'sh1', kind: 'shape', shape: 'rect', x: 140, y: 360, w: 160, h: 90, label: 'Low' }]);
    const card = await rect(page, '[data-card-id="sh1"]');
    // A right-click near the card's top, the way the sweep opened it.
    await page.mouse.click(card.x + 20, Math.min(card.y + 10, 600), { button: 'right' });
    await expect(page.locator('.ctx-menu:not(.ctx-submenu)')).toBeVisible();
    const m = await menuState(page);
    expect(m.text.at(-1)).toContain('Delete');
    expect(m.top).toBeGreaterThanOrEqual(8);
    expect(m.bottom).toBeLessThanOrEqual(m.ih - 8 + 0.5);
    expect(m.lastBottom).toBeLessThanOrEqual(m.ih);
    await page.screenshot({ path: test.info().outputPath('tablet-card-menu.png') });
    await ctx.close();
  });

  test('the canvas menu opened at the bottom-right corner is fully on screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await plant(page, []);
    await page.mouse.click(1380, 820, { button: 'right' });
    // Park the pointer off the menu so a hovered row doesn't open a submenu.
    await page.mouse.move(700, 120);
    await expect(page.locator('.ctx-menu:not(.ctx-submenu)')).toBeVisible();
    const m = await menuState(page);
    expect(m.top).toBeGreaterThanOrEqual(8);
    expect(m.bottom).toBeLessThanOrEqual(m.ih - 8 + 0.5);
    expect(m.lastBottom).toBeLessThanOrEqual(m.ih);
    await page.screenshot({ path: test.info().outputPath('bg-menu-br.png') });
  });
});

// Perceived brightness 0–255 of a computed `rgb(…)` colour.
const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).map(Number); return 0.299 * r + 0.587 * g + 0.114 * b; };
const strokeOf = (page, id) => page.locator(`[data-card-id="${id}"] .shape svg > *`).first()
  .evaluate((el) => getComputedStyle(el).stroke);

test.describe('VS-CANVAS-04 default shape ink follows the theme', () => {
  test('a default-ink shape is dark on the light canvas and light on the dark one; a chosen colour is kept', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await plant(page, [
      { id: 'sh-unset', kind: 'shape', shape: 'rect', x: 120, y: 120, w: 160, h: 90 },
      { id: 'sh-ink', kind: 'shape', shape: 'ellipse', x: 340, y: 120, w: 160, h: 90, stroke: '#f5f5f6' },
      { id: 'sh-blue', kind: 'shape', shape: 'rect', x: 560, y: 120, w: 160, h: 90, stroke: '#3b82f6' },
    ]);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    expect(lum(await strokeOf(page, 'sh-unset'))).toBeLessThan(80);
    expect(lum(await strokeOf(page, 'sh-ink'))).toBeLessThan(80);
    expect(await strokeOf(page, 'sh-blue')).toBe('rgb(59, 130, 246)');
    await page.screenshot({ path: test.info().outputPath('shapes-light.png') });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    expect(lum(await strokeOf(page, 'sh-ink'))).toBeGreaterThan(200);
  });
});

// A week schedule at its default size, anchored on a fixed week so the title
// is always 'Oct 12–18, 2026' (the sweep's worst case: a same-month week).
const WEEK_SCHED = {
  id: 'sched-wk', kind: 'schedule', schedView: 'week', anchor: '2026-10-14', anchorHour: 9,
  cells: {}, gridMeta: {}, x: 120, y: 120, w: 640, h: 260,
};

const headFit = (page) => page.locator('[data-card-id="sched-wk"] .schedc-head').evaluate((head) => {
  const card = head.closest('.schedc').getBoundingClientRect();
  const txt = head.querySelector('.schedc-title-txt');
  const kids = [...head.children].map((k) => k.getBoundingClientRect());
  return {
    headOver: head.scrollWidth - head.clientWidth,
    titleText: txt?.textContent,
    titleCut: txt ? txt.scrollWidth - txt.clientWidth : 0,
    titleW: txt ? txt.clientWidth : 0,
    pastCard: Math.max(...kids.map((r) => r.right)) - card.right,
    k: getComputedStyle(head).getPropertyValue('--chrome-k'),
  };
});

async function zoomOut(page, presses) {
  for (let i = 0; i < presses; i++) await page.keyboard.press('Control+Minus');
  await page.waitForTimeout(400);
}

test.describe('VS-CANVAS-05 the week schedule header fits its card when zoomed out', () => {
  for (const dev of [
    { name: 'desktop', viewport: { width: 1440, height: 900 }, hasTouch: false },
    { name: 'touch tablet', viewport: { width: 1024, height: 768 }, hasTouch: true },
  ]) {
    test(`${dev.name}: the date stays readable and no control paints past the card`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: dev.viewport, hasTouch: dev.hasTouch });
      const page = await ctx.newPage();
      await plant(page, [WEEK_SCHED]);
      await expect(page.locator('[data-card-id="sched-wk"] .schedc-head')).toBeVisible();
      for (const presses of [0, 1, 2]) {
        if (presses) await zoomOut(page, 1);
        const lodFull = await page.locator('[data-card-id="sched-wk"] .schedc-head:not(.is-lod)').count();
        if (!lodFull) break;
        const f = await headFit(page);
        expect(f.headOver, `header overflow at ${presses} zoom-outs (k=${f.k})`).toBeLessThanOrEqual(1);
        expect(f.pastCard, `controls past the card at ${presses} zoom-outs`).toBeLessThanOrEqual(1);
        expect(f.titleCut, `title '${f.titleText}' truncated at ${presses} zoom-outs`).toBeLessThanOrEqual(1);
        expect(f.titleText).toMatch(/^Oct 12–18/);
      }
      await page.screenshot({ path: test.info().outputPath(`sched-${dev.name.replace(' ', '-')}.png`) });
      await ctx.close();
    });
  }
});

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

test.describe('VS-CANVAS-06 the phone tool rail does not cover the board', () => {
  test('cards framed on open start right of the rail', async ({ browser }) => {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await plant(page, [
      { id: 'n1', kind: 'note', x: 0, y: 0, w: 240, h: 180, text: 'Bold and underline' },
      { id: 'sh1', kind: 'shape', shape: 'rect', x: 0, y: 420, w: 200, h: 120, label: 'Act one opens' },
      { id: 'sh2', kind: 'shape', shape: 'ellipse', x: 300, y: 0, w: 260, h: 180 },
    ]);
    const rail = await rect(page, '.cnv-tools');
    for (const id of ['n1', 'sh1', 'sh2']) {
      const c = await rect(page, `[data-card-id="${id}"]`);
      expect(c.x, `${id} starts under the rail`).toBeGreaterThanOrEqual(rail.r);
      expect(c.r, `${id} runs off the right edge`).toBeLessThanOrEqual(390);
    }
    await page.screenshot({ path: test.info().outputPath('phone-framed.png') });
    await ctx.close();
  });

  test('the empty-cluster panel sits clear of the rail', async ({ browser }) => {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await plant(page, []);
    const panel = page.locator('.cnv-empty-tiles');
    await expect(panel).toBeVisible();
    await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const rail = await rect(page, '.cnv-tools');
    const p = await rect(page, '.cnv-empty-tiles');
    expect(p.x).toBeGreaterThanOrEqual(rail.r + 4);
    expect(p.r).toBeLessThanOrEqual(390 - 8);
    await page.screenshot({ path: test.info().outputPath('phone-empty.png') });
    await ctx.close();
  });
});

const MEDIA = [
  { id: 'img1', kind: 'image', src: '/clusters-logo-light.png', x: 0, y: 0, w: 240, h: 180, name: 'logo.png' },
  { id: 'pdf1', kind: 'pdf', pdfSrc: '/sample.pdf', src: null, name: 'sample.pdf', x: 0, y: 260, w: 240, h: 300 },
];
// Every visible button inside `sel`, with its label and size.
const buttonSizes = (page, sel) => page.locator(sel).first().evaluate((root) =>
  [...root.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => {
    const r = b.getBoundingClientRect();
    return { label: b.getAttribute('aria-label') || b.title || b.textContent.trim(), w: r.width, h: r.height };
  }));
const expectTappable = (sizes, which) => {
  for (const s of sizes.filter((b) => which.includes(b.label))) {
    expect(s.w, `${s.label} width`).toBeGreaterThanOrEqual(40);
    expect(s.h, `${s.label} height`).toBeGreaterThanOrEqual(40);
  }
  expect(sizes.filter((b) => which.includes(b.label)).length).toBe(which.length);
};
// Tap a card to select it, then press one of its revealed action buttons.
async function cardAction(page, id, sel) {
  const card = page.locator(`[data-card-id="${id}"]`);
  await card.tap();
  await card.locator(sel).first().dispatchEvent('click');
}

test.describe('VS-CANVAS-07 overlay controls are at least 40px on a phone', () => {
  test('PDF viewer: every bar button is 40px and the filename keeps room', async ({ browser }) => {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await plant(page, MEDIA);
    await cardAction(page, 'pdf1', '.ic-expand');
    const viewer = page.locator('.pdfv[role="dialog"]');
    await expect(viewer.locator('.pdfv-page canvas').first()).toBeVisible({ timeout: 15000 });
    expectTappable(await buttonSizes(page, '.pdfv-bar'), ['Previous page', 'Next page', 'Zoom out', 'Zoom in', 'Download', 'Close']);
    const t = await viewer.locator('.pdfv-title').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(t.sw).toBeLessThanOrEqual(t.cw);
    // Nothing in the bar runs off the screen.
    const barR = await viewer.locator('.pdfv-bar').evaluate((el) => Math.max(...[...el.querySelectorAll('button')].map((b) => b.getBoundingClientRect().right)));
    expect(barR).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('phone-pdf.png') });
    await ctx.close();
  });

  test('lightbox, photo popover and full-screen editor buttons are 40px', async ({ browser }) => {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await plant(page, MEDIA);
    await expect(page.locator('[data-card-id="img1"] .ic-img')).toBeVisible();

    await cardAction(page, 'img1', '.ic-expand');
    await expect(page.locator('.lightbox')).toBeVisible();
    expectTappable(await buttonSizes(page, '.lightbox'), ['Close', 'Download']);
    await page.locator('.lightbox-x').dispatchEvent('click');
    await expect(page.locator('.lightbox')).toHaveCount(0);

    await cardAction(page, 'img1', '.ic-edit');
    await expect(page.locator('.iep-pop')).toBeVisible();
    expectTappable(await buttonSizes(page, '.iep-pop'), ['Full screen', 'Flip horizontal', 'Flip vertical', 'Black & white', 'Reset']);
    await page.screenshot({ path: test.info().outputPath('phone-popover.png') });

    await page.locator('.iep-pop').getByTitle('Full screen').dispatchEvent('click');
    await expect(page.locator('.iem')).toBeVisible();
    expectTappable(await buttonSizes(page, '.iem'), ['Close', 'Download', 'Done']);
    await page.screenshot({ path: test.info().outputPath('phone-editor.png') });
    await ctx.close();
  });
});

test.describe('VS-CANVAS-08 the phone photo popover stays above the bottom nav', () => {
  test('its bottom clears the nav and the raised + button, and Reset is reachable', async ({ browser }) => {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await page.emulateMedia({ colorScheme: 'light' });
    // The image sits LOW on the screen (a shape above it takes the top of the
    // fit), so the panel can't go beside, below or above it and falls back to
    // clamping against the bottom — where it used to run under the nav.
    await plant(page, [
      { id: 'top', kind: 'shape', shape: 'rect', x: 0, y: 0, w: 240, h: 160 },
      { ...MEDIA[0], y: 200 },
    ]);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await expect(page.locator('[data-card-id="img1"] .ic-img')).toBeVisible();
    await cardAction(page, 'img1', '.ic-edit');
    const pop = page.locator('.iep-pop');
    await expect(pop).toBeVisible();
    // Let the open animation and the rAF re-place settle.
    await pop.evaluate(async (el) => { await Promise.all(el.getAnimations().map((a) => a.finished)); });
    await page.waitForTimeout(100);
    const navTop = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.mb-nav, .mb-nav-create, .mb-nav-create-fab')]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.top)));
    expect(Number.isFinite(navTop)).toBe(true);
    const p = await rect(page, '.iep-pop');
    expect(p.b).toBeLessThanOrEqual(navTop);
    expect(p.y).toBeGreaterThanOrEqual(0);
    const reset = pop.getByRole('button', { name: 'Reset' });
    await reset.scrollIntoViewIfNeeded();
    const rb = await reset.boundingBox();
    expect(rb.y + rb.height).toBeLessThanOrEqual(navTop);
    await page.screenshot({ path: test.info().outputPath('phone-popover-light.png') });
    await ctx.close();
  });
});
