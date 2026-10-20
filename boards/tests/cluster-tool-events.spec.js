// What the Cluster tool's hover card records (cluster_tool_hint): a sighting,
// once per page load, when a pause on the tool lasted long enough for the card
// to show; and each pick of the tool, with whether the card was up when it was
// pressed. Only where the card teaches: behind clusterNudgesAllowed(), opt-in on
// dev (cluster-nudges.spec.js pins the hold itself).
import { expect, test } from '@playwright/test';

async function open(page, { nudges = true } = {}) {
  const rows = [];
  await page.route('**/rest/v1/analytics_events*', async (route) => {
    try {
      const body = route.request().postDataJSON();
      for (const r of Array.isArray(body) ? body : [body]) rows.push(r);
    } catch { /* non-JSON */ }
    await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  if (nudges) {
    await page.addInitScript(() => {
      try { window.localStorage.setItem('soleil.dev.clusterNudges', '1'); } catch (_) {}
    });
  }
  await page.goto('/?local=1&reset=1&blank=1&mixqa=3');
  await expect(page.locator('.card[data-card-id="mixqa-0"]')).toBeVisible({ timeout: 15_000 });
  return rows;
}
// Every row also carries the session's context (browser, build, env…), so
// each is matched on the event's own fields.
const hints = (rows) => rows.filter((r) => r.event === 'cluster_tool_hint').map((r) => r.props || {});
const like = (o) => expect.objectContaining(o);
// Flush the queue now rather than wait for its timer.
const hide = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
const FLUSH = { timeout: 15_000 };
const tool = (page) => page.locator('.cnv-tool[data-tour="cluster-tool"]');

test('a pause long enough to show the card is one sighting a page load, and a pick says the card was up', async ({ page }) => {
  const rows = await open(page);
  await tool(page).hover();
  await expect(tool(page).locator('.cnv-tool-card')).toBeVisible();
  await page.waitForTimeout(600);
  // Away and back: the card shows again, but the page load has its sighting.
  await page.mouse.move(900, 600);
  await tool(page).hover();
  await page.waitForTimeout(600);
  await page.mouse.down();
  await page.mouse.up();
  await expect(tool(page)).toHaveAttribute('aria-pressed', 'true');
  // Pressed again while on: not a pick.
  await page.mouse.down();
  await page.mouse.up();
  await hide(page);
  await expect.poll(() => hints(rows), FLUSH).toEqual([
    like({ action: 'seen' }),
    like({ action: 'picked', after_card: true }),
  ]);
  expect(hints(rows)[0]).not.toHaveProperty('after_card');
});

test('a pick before the card shows says so, and a passing pointer is no sighting', async ({ page }) => {
  const rows = await open(page);
  // Across the tool and off it, faster than the card.
  await tool(page).hover();
  await page.mouse.move(900, 600);
  await page.waitForTimeout(600);
  await tool(page).click();
  await expect(tool(page)).toHaveAttribute('aria-pressed', 'true');
  await hide(page);
  await expect.poll(() => hints(rows), FLUSH).toEqual([like({ action: 'picked', after_card: false })]);
});

test('while the nudges are held, the tool records nothing', async ({ page }) => {
  const rows = await open(page, { nudges: false });
  await tool(page).hover();
  await page.waitForTimeout(600);
  await tool(page).click();
  await expect(tool(page)).toHaveAttribute('aria-pressed', 'true');
  // Something the queue does send, so an empty answer is not an unflushed one.
  await page.evaluate(() => import('/src/lib/analytics.js')
    .then((m) => m.logEvent('board_open', { board_id: 'root', depth: 0, is_subboard: false })));
  await hide(page);
  await expect.poll(() => rows.some((r) => r.event === 'board_open'), FLUSH).toBe(true);
  expect(hints(rows)).toEqual([]);
});
