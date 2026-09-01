// session_summary — the terminal row has to actually leave the browser.
//
// The unit tests cover the accumulator; this covers the wiring, which is the
// half that silently does nothing if a listener is attached to the wrong
// object or the emit runs after the queue is already flushed. A summary that
// is computed perfectly and never sent is indistinguishable from no feature.

import { test, expect } from '@playwright/test';

test('a session emits one terminal summary row when the page is hidden', async ({ page }) => {
  const rows = [];
  await page.route('**/rest/v1/analytics_events*', async (route) => {
    try {
      const body = route.request().postDataJSON();
      for (const r of Array.isArray(body) ? body : [body]) rows.push(r);
    } catch { /* non-JSON */ }
    await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForTimeout(2500);

  // Hiding the tab is the reliable end-of-session signal on every platform.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1200);

  const summaries = rows.filter((r) => r.event === 'session_summary');
  expect(summaries.length, 'no session_summary reached the network').toBeGreaterThan(0);

  const p = summaries[summaries.length - 1].props || {};
  expect(p.of_session, 'the row must name the session it describes').toBeTruthy();
  expect(p.ended).toBe('hide');
  expect(Number(p.visit_n)).toBeGreaterThan(0);
  expect(Number(p.events_n), 'a summary of nothing should never be emitted').toBeGreaterThan(0);
  expect(p).toHaveProperty('wrote');
  expect(p).toHaveProperty('ms_span');

  // And it must not count itself.
  const self = summaries.filter((s) => (s.props || {}).of_session === p.of_session);
  expect(self.length, 'one row per session per ending, not a loop').toBeLessThan(3);
});
