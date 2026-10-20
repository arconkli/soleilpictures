// How the canvas is moved around, and how smoothly it ran, as a session's
// summary carries them: one count per gesture as it settles (canvas.*), and
// the frames perfReport's sampler timed while someone was using it (perf).
// Never a row per wheel tick. (app_open's boot_ms is App.jsx's, which the local
// harness doesn't mount: lib/frameStats.test.mjs pins it.)
import { expect, test } from '@playwright/test';

async function open(page) {
  const rows = [];
  await page.route('**/rest/v1/analytics_events*', async (route) => {
    try {
      const body = route.request().postDataJSON();
      for (const r of Array.isArray(body) ? body : [body]) rows.push(r);
    } catch { /* non-JSON */ }
    await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  await page.waitForTimeout(900);
  return rows;
}
const hide = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
// The local harness logs nothing on its own, and a session with no rows sends
// no summary: one ordinary row, as any real session has.
const logRow = (page) => page.evaluate(() => import('/src/lib/analytics.js')
  .then((m) => m.logEvent('board_open', { board_id: 'root', depth: 0, is_subboard: false })));
const lastSummary = (rows) => rows.filter((r) => r.event === 'session_summary').map((r) => r.props || {}).at(-1);
const FLUSH = { timeout: 15_000 };

// Empty board near the middle, away from the cards and the chrome.
async function emptySpot(page) {
  const b = await page.locator('.canvas-wrap').boundingBox();
  return page.evaluate(({ b }) => {
    for (let r = 0; r <= 300; r += 12) {
      for (let a = 0; a < 360; a += 30) {
        const x = b.x + b.width / 2 + r * Math.cos((a * Math.PI) / 180);
        const y = b.y + b.height / 2 + r * Math.sin((a * Math.PI) / 180);
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('.canvas-wrap') && ['cards-layer', 'canvas-wrap', 'grain-canvas', 'cnv-ground'].some((c) => el.classList.contains(c))) return { x, y };
        if (r === 0) break;
      }
    }
    return null;
  }, { b });
}

test('wheel bursts, a zoom and a drag pan are each counted once, and the frames they ran at come with them', async ({ page }) => {
  const rows = await open(page);
  const p = await emptySpot(page);
  expect(p).toBeTruthy();
  await page.mouse.move(p.x, p.y);
  // One burst of mouse-wheel notches: pans, by default.
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(30); }
  await page.waitForTimeout(400);
  // A trackpad's stream.
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(3.5, 7.25); await page.waitForTimeout(16); }
  await page.waitForTimeout(400);
  // ⌃-wheel zooms in both wheel modes.
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(700);
  // Space held, and a drag: the hand.
  const q = await emptySpot(page);
  await page.keyboard.down('Space');
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(q.x + i * 12, q.y + i * 6);
  await page.mouse.up();
  await page.keyboard.up('Space');
  await page.waitForTimeout(300);

  await logRow(page);
  await hide(page);
  await expect.poll(() => lastSummary(rows)?.counters?.['canvas.drag_pan.mouse'], FLUSH).toBe(1);
  const { counters, perf } = lastSummary(rows);
  expect(counters['canvas.wheel.pan.mouse']).toBe(1);
  expect(counters['canvas.wheel.pan.trackpad']).toBe(1);
  expect(counters['canvas.wheel.zoom.mouse']).toBe(1);
  expect(counters['input.mouse']).toBeGreaterThanOrEqual(1);
  expect(rows.some((r) => /wheel/.test(r.event))).toBe(false);
  // The sampler ran while the canvas moved: frames, by bound, and their time.
  const frames = Object.values(perf.frames).reduce((a, n) => a + n, 0);
  expect(frames).toBeGreaterThan(0);
  expect(Object.keys(perf.frames)).toEqual(['le20', 'le34', 'le50', 'le100', 'le350', 'gt350']);
  expect(perf.frame_ms).toBeGreaterThan(0);
  expect(Number.isInteger(perf.lt_n)).toBe(true);
});
