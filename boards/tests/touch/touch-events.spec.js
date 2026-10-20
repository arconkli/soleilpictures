// What a finger's work on the canvas records: touch_select when a hold starts
// picking several things (the box it draws, or Select… from its menu), and,
// on the session's summary, one count per pan and per pinch as each settles.
// Holds need CDP touch: Chromium only (helpers.js).
import { expect, test } from '@playwright/test';
import { hold, holdDrag, needsHold, pinch, swipe } from './helpers.js';

async function open(page) {
  const rows = [];
  await page.route('**/rest/v1/analytics_events*', async (route) => {
    try {
      const body = route.request().postDataJSON();
      for (const r of Array.isArray(body) ? body : [body]) rows.push(r);
    } catch { /* non-JSON */ }
    await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  await page.addInitScript(() => { try { localStorage.setItem('soleil.dev.touchPass', '1'); } catch (_) {} });
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  await page.waitForTimeout(900);
  return rows;
}
const hide = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
const props = (rows, name) => rows.filter((r) => r.event === name).map((r) => r.props || {});
const FLUSH = { timeout: 15_000 };
const menu = (page) => page.locator('.ctx-menu').first();

const rectOf = (page, id) => page.locator(`.canvas-wrap .card[data-card-id="${id}"]`).evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
// The nearest point to `p` with nothing but the board under it — and, with
// `spread`, nothing but the board `spread` px either side of it too, where a
// pinch's two fingers land.
const emptyNear = (page, p, spread = 0) => page.evaluate(({ p, spread }) => {
  const bare = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return !!el && !!el.closest('.canvas-wrap') && ['cards-layer', 'canvas-wrap', 'grain-canvas', 'cnv-ground'].some((c) => el.classList.contains(c));
  };
  for (let r = 0; r <= 200; r += 8) {
    for (let a = 0; a < 360; a += 30) {
      const x = p.x + r * Math.cos((a * Math.PI) / 180);
      const y = p.y + r * Math.sin((a * Math.PI) / 180);
      if (bare(x, y) && (!spread || (bare(x - spread, y) && bare(x + spread, y)))) return { x, y };
      if (r === 0) break;
    }
  }
  return null;
}, { p, spread });
const selectedIds = (page) => page.$$eval('.canvas-wrap .card.is-selected', (els) => els.map((el) => el.getAttribute('data-card-id')));

test('a hold, then a drag, logs the box as touch_select with how many it caught', async ({ page, browserName }) => {
  needsHold(test, browserName);
  const rows = await open(page);
  const note = await rectOf(page, 'home-note');
  const image = await rectOf(page, 'home-image');
  const from = await emptyNear(page, { x: Math.max(note.right, image.right) + 24, y: note.top - 6 });
  await holdDrag(page, from, [{ x: Math.min(note.x, image.x), y: image.y }]);
  await expect.poll(async () => (await selectedIds(page)).length).toBeGreaterThanOrEqual(2);
  const cards = (await selectedIds(page)).length;
  await expect.poll(() => props(rows, 'touch_select').length, FLUSH).toBe(1);
  const [row] = props(rows, 'touch_select');
  expect(row).toMatchObject({ where: 'canvas', via: 'hold' });
  // n is everything the box caught: its cards, and any stroke or arrow too.
  expect(row.n).toBeGreaterThanOrEqual(cards);
});

test('Select… from a hold\'s menu logs touch_select from the menu', async ({ page, browserName }) => {
  needsHold(test, browserName);
  const rows = await open(page);
  const p = await emptyNear(page, { x: (await rectOf(page, 'home-note')).right + 60, y: (await rectOf(page, 'home-note')).y });
  await hold(page, p);
  await menu(page).getByRole('menuitem', { name: 'Select…' }).tap();
  await expect(page.locator('.cnv-hint[data-hint="touch_select"]')).toBeVisible();
  await expect.poll(() => props(rows, 'touch_select'), FLUSH).toEqual([
    expect.objectContaining({ where: 'canvas', via: 'menu', n: 0 }),
  ]);
});

test('a swipe and a pinch are each counted once on the session\'s summary', async ({ page, browserName }) => {
  needsHold(test, browserName);
  const rows = await open(page);
  const p = await emptyNear(page, { x: (await rectOf(page, 'home-note')).right + 60, y: (await rectOf(page, 'home-note')).y });
  await swipe(page, p, { x: p.x - 90, y: p.y + 40 });
  await page.waitForTimeout(300);
  const b = await page.locator('.canvas-wrap').boundingBox();
  // Both fingers on bare board: on a phone at a third of full size, one that
  // lands on a card's handle is a touch on the card, not half a pinch.
  const c = await emptyNear(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, 30);
  const zoomShown = () => page.locator('.cnv-zoom-val').first().textContent();
  const before = await zoomShown();
  await pinch(page, c, 60, 160);
  // A pinch is counted as it settles, which is when the zoom it left is shown:
  // wait for that rather than for a fixed time, which a loaded machine outruns.
  await expect.poll(zoomShown).not.toBe(before);
  // The local harness logs nothing on its own, and a session with no rows
  // sends no summary: one ordinary row, as any real session has.
  await page.evaluate(() => import('/src/lib/analytics.js')
    .then((m) => m.logEvent('board_open', { board_id: 'root', depth: 0, is_subboard: false })));
  await hide(page);
  await expect.poll(() => props(rows, 'session_summary').at(-1)?.counters?.['canvas.pinch'], FLUSH).toBe(1);
  const { counters } = props(rows, 'session_summary').at(-1);
  expect(counters['canvas.drag_pan.touch']).toBe(1);
  expect(counters['input.touch']).toBeGreaterThanOrEqual(2);
});
