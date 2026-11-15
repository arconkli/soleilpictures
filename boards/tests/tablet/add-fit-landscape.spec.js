// A landscape iPad adds from the rail's Add menu, with a finger and no pointer
// to add at. The card goes in the free space nearest the middle of the board
// that can be seen, and a card bigger than that (a 920px Schedule beside
// Files, where the board is about 720px wide) has the view zoom out and pan
// until all of it shows (CanvasSurface revealAdded). It used to start under
// the rail and run off the right edge.
import { expect, test } from '@playwright/test';
import { bootSignedIn } from '../helpers/signedInStub.js';

const scene = (page) => page.evaluate(() => {
  const wrap = document.querySelector('.canvas-wrap');
  const r = wrap.getBoundingClientRect();
  const m = new DOMMatrixReadOnly(getComputedStyle(wrap.querySelector('.canvas')).transform);
  const rail = wrap.querySelector('.cnv-tools').getBoundingClientRect();
  const cards = [...wrap.querySelectorAll('.cards-layer .card[data-card-id]')].map((el) => {
    const b = el.getBoundingClientRect();
    return { id: el.getAttribute('data-card-id'), x: b.left, y: b.top, w: b.width, h: b.height };
  });
  return { zoom: m.a, left: rail.right, right: r.right, top: r.top, bottom: r.bottom, cards };
});
const overlap = (a, b) => a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;

async function addSchedule(page) {
  await page.locator('.cnv-tools').getByRole('button', { name: 'Add menu', exact: true }).tap();
  await expect(page.locator('.cnv-add-menu')).toBeVisible();
  await page.locator('.cnv-add-menu').getByText('Schedule', { exact: true }).tap();
  await expect(page.locator('.cards-layer .card[data-card-id^="sched"]')).toHaveCount(1);
  await page.waitForTimeout(900);
}
const allInView = (s, card) => {
  expect(card.x).toBeGreaterThanOrEqual(s.left);
  expect(card.x + card.w).toBeLessThanOrEqual(s.right);
  expect(card.y).toBeGreaterThanOrEqual(s.top);
  expect(card.y + card.h).toBeLessThanOrEqual(s.bottom);
};

test('a Schedule from the Add menu shows whole, right of the rail, beside Files', async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await addSchedule(page);
  const s = await scene(page);
  const sched = s.cards.find((c) => c.id.startsWith('sched'));
  // 920 board units across, in a board narrower than that: zoomed out to fit.
  expect(s.right - s.left).toBeLessThan(920);
  expect(s.zoom).toBeLessThan(1);
  allInView(s, sched);
});

test('on a board with cards the Schedule lands clear of them and shows whole', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  await page.waitForTimeout(600);
  const before = await scene(page);
  await addSchedule(page);
  const s = await scene(page);
  const sched = s.cards.find((c) => c.id.startsWith('sched'));
  for (const c of s.cards) if (c.id !== sched.id) expect(overlap(sched, c), `on top of ${c.id}`).toBe(false);
  allInView(s, sched);
  // Out, never in.
  expect(s.zoom).toBeLessThanOrEqual(before.zoom + 0.001);
  // One undo takes the Schedule and nothing else.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.cards-layer .card[data-card-id]')).toHaveCount(before.cards.length);
});

// The Add note tool's tap puts the note where the finger was, with no zoom in.
test("the Add note tool's tap puts the note where the finger was, with no zoom in", async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  await page.waitForTimeout(600);
  const before = await scene(page);
  await page.locator('.cnv-tools').getByRole('button', { name: 'Add note tool', exact: true }).tap();
  const bw = before.right - before.left;
  const bh = before.bottom - before.top;
  let pt = null;
  for (const [fx, fy] of [[0.6, 0.4], [0.62, 0.45], [0.58, 0.35], [0.66, 0.5], [0.55, 0.55], [0.7, 0.3]]) {
    const x = before.left + bw * fx;
    const y = before.top + bh * fy;
    const free = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return !!el && !el.closest('.card, button, .cnv-tools, .cnv-add-menu, [role="toolbar"]');
    }, [x, y]);
    if (free) { pt = { x, y }; break; }
  }
  expect(pt, 'no empty spot found on the board').not.toBeNull();
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(900);
  const s = await scene(page);
  const oldIds = new Set(before.cards.map((c) => c.id));
  const fresh = s.cards.filter((c) => !oldIds.has(c.id));
  expect(fresh.length).toBe(1);
  const note = fresh[0];
  expect(Math.abs(s.zoom - before.zoom)).toBeLessThanOrEqual(0.005);
  // A new note anchors the middle of its top edge on the tap.
  expect(Math.abs(note.x + note.w / 2 - pt.x)).toBeLessThanOrEqual(6);
  expect(Math.abs(note.y - pt.y)).toBeLessThanOrEqual(6);
});
