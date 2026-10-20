// What the film player records (lib/filmWatch.js): film_play at a viewing's
// first play, film_watch when the player lets go of the clip or the page goes
// away (how long it played, how far it got), and film_fail once for a clip it
// couldn't play. Driven through the ?local=1 harness, like film-player.spec.js,
// on the same fixture: tests/fixtures/media/frames-vp9.mp4, two seconds long.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = (name) => readFileSync(new URL(`./fixtures/media/${name}`, import.meta.url)).toString('base64');

async function go(page) {
  const rows = [];
  await page.route('**/rest/v1/analytics_events*', async (route) => {
    try {
      const body = route.request().postDataJSON();
      for (const r of Array.isArray(body) ? body : [body]) rows.push(r);
    } catch { /* non-JSON */ }
    await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('[data-card-id="home-note"]')).toBeVisible();
  return rows;
}
const props = (rows, name) => rows.filter((r) => r.event === name).map((r) => r.props || {});
// Every row also carries the session's context, so each is matched on the
// event's own fields.
const like = (o) => expect.objectContaining(o);
const FLUSH = { timeout: 15_000 };
const hide = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});

async function addPosteredClip(page, id) {
  await page.evaluate(({ data, id }) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const g = c.getContext('2d'); g.fillStyle = '#334'; g.fillRect(0, 0, 64, 36);
    window.__soleilVideoLive.addVideo({ id, src: url, poster: c.toDataURL('image/png'), fileName: 'frames.mp4', x: 700, y: 500, w: 480, h: 270,
      media: { fps: [24, 1], frames: 48, dur: 2, w: 64, h: 36, probed: 1 } });
  }, { data: fixture('frames-vp9.mp4'), id });
  await expect(page.locator(`[data-card-id="${id}"] .vc-poster`)).toBeVisible();
}

test('a clip played on its card to the end: one play, and a watch of all of it when the page goes', async ({ page }) => {
  const rows = await go(page);
  await addPosteredClip(page, 'e-card');
  const card = page.locator('[data-card-id="e-card"]');
  await card.hover();
  await expect(card.locator('.film--compact video')).toHaveCount(1);
  await card.click({ position: { x: 120, y: 80 } });   // selects
  await page.waitForTimeout(400);
  await card.click({ position: { x: 120, y: 80 } });   // plays
  await expect.poll(() => card.locator('video').evaluate((v) => v.ended), { timeout: 10_000 }).toBe(true);
  // Played again from the end: the same viewing, not a second play.
  await card.click({ position: { x: 120, y: 80 } });
  await page.waitForTimeout(300);
  await card.click({ position: { x: 120, y: 80 } });
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

  await expect.poll(() => props(rows, 'film_watch').length, FLUSH).toBe(1);
  expect(props(rows, 'film_play')).toEqual([like({ surface: 'card', auto: false, compare: false, muted: true })]);
  const [watch] = props(rows, 'film_watch');
  expect(watch).toMatchObject({ surface: 'card', pct: 100, dur_s: 2 });
  expect(watch.played_s).toBeGreaterThanOrEqual(2);
});

test('a clip this browser can\'t decode is one film_fail, with its codec', async ({ page }) => {
  const rows = await go(page);
  await page.evaluate(() => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(4096).fill(7)], { type: 'video/mp4' }));
    window.__soleilVideoLive.addVideo({ id: 'e-bad', src: url, fileName: 'broken.mov', x: 700, y: 500, w: 480, h: 270, media: { codec: 'apch', probed: 1 } });
  });
  await expect(page.locator('[data-card-id="e-bad"] .film-error')).toBeVisible({ timeout: 20_000 });
  await hide(page);
  await expect.poll(() => props(rows, 'film_fail'), FLUSH).toEqual([like({ surface: 'card', reason: 'decode', codec: 'apch' })]);
  expect(props(rows, 'film_play')).toEqual([]);
});
