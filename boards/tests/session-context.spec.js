// session_context — the once-a-session row describing the setup has to leave
// the browser, once per app session, beside a real row of that session.
//
// The unit tests (src/lib/sessionContext.test.mjs) pin what it may hold. This
// pins the wiring: a reader that is perfect and never sent is no feature, and
// one that fires on every row would multiply the table.

import { test, expect } from '@playwright/test';

async function captureAnalytics(page) {
  const rows = [];
  await page.route('**/rest/v1/analytics_events*', async (route) => {
    try {
      const body = route.request().postDataJSON();
      for (const r of Array.isArray(body) ? body : [body]) rows.push(r);
    } catch { /* non-JSON */ }
    await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  return rows;
}

// Hiding the tab beacons the queue at once, rather than on the 5s timer.
const hide = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});

const contexts = (rows) => rows.filter((r) => r.event === 'session_context');

test('a session sends its context once, beside a real row of that session', async ({ page }) => {
  const rows = await captureAnalytics(page);
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForTimeout(2500);
  await hide(page);
  await expect.poll(() => contexts(rows).length, { timeout: 15000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);

  const ctx = contexts(rows);
  expect(ctx, 'one context row per session').toHaveLength(1);
  const [row] = ctx;
  expect(row.app_session_id).toBeTruthy();
  expect(rows.some((r) => r.event !== 'session_context' && r.app_session_id === row.app_session_id),
    'the row that called for it is from the same session').toBe(true);

  const p = row.props || {};
  expect(p.tz).toMatch(/^[A-Za-z]/);
  expect(Number.isInteger(p.tz_offset_min)).toBe(true);
  expect(p.lang).toBeTruthy();
  expect(p.vw).toBeGreaterThan(0);
  expect(p.vw % 10).toBe(0);
  expect(p.sw % 10).toBe(0);
  expect(['fine', 'coarse', 'none', null]).toContain(p.pointer);
  expect(['dark', 'light']).toContain(p.scheme);
  expect(typeof p.any_fine).toBe('boolean');
  expect(typeof p.ff).toBe('object');
  expect(Object.values(p.ff).every((v) => typeof v === 'boolean')).toBe(true);
  expect(p.ff).toHaveProperty('sidebarFiles');
  // The dev server is not the Worker, so there is no soleil-ctx tag to read.
  expect(p.region).toBeNull();
  expect(p.net_kind).toBeNull();
  // A QA-harness session stays labelled like every other row it sends.
  expect(p.synthetic).toBe(true);
  for (const banned of ['ua', 'user_agent', 'city', 'org', 'asn']) expect(p).not.toHaveProperty(banned);
});

test('a reload inside the same session does not send it again', async ({ page }) => {
  const rows = await captureAnalytics(page);
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForTimeout(2500);
  await hide(page);
  await expect.poll(() => contexts(rows).length, { timeout: 15000 }).toBe(1);
  const session = contexts(rows)[0].app_session_id;

  // ?reset=1 clears only the local board, so the app session carries over.
  const before = rows.length;
  await page.reload();
  await page.waitForTimeout(2500);
  await hide(page);
  await expect.poll(() => rows.length - before, { timeout: 15000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);

  const after = rows.slice(before);
  expect(after.every((r) => r.app_session_id === session), 'the reload stayed in the session').toBe(true);
  expect(contexts(rows), 'so it sent no second context').toHaveLength(1);
});
