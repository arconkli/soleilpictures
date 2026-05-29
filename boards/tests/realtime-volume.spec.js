// Regression guards for the Supabase Realtime message-volume reduction pass
// (presence ping-pong fix, broadcast-only-when-peers-present gating in
// ySupabase.js / workspaceRealtime.js, card_index change-detection, and the
// per-event `rt.send.*` perf counters).
//
// Realtime itself can't connect under the test harness (the Playwright
// webServer is pointed at a dummy Supabase URL), so these are deliberately
// boot-/wiring-level: they prove the edited modules load and the app boots
// with no errors, and that the diagnostic counters are reachable. The
// actual broadcast-suppression behaviour is verified live in two browser
// tabs (see the plan's verification section) before merging to main.
import { expect, test } from '@playwright/test';

test('app boots with the realtime-gating changes and no page errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  // perf=1 exercises the perf module + the rt.send.* bump call-sites' module load.
  await page.goto('/?local=1&perf=1');
  await expect(page.getByRole('main').getByText('Studio', { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  // Ignore noise from the harness's fake Supabase endpoint — we only care
  // that none of the realtime modules we touched threw at load/boot.
  const real = errors.filter(e =>
    !/supabase|realtime|websocket|network|fetch|Failed to load|ERR_|401|403|ws:\/\//i.test(e));
  expect(real).toEqual([]);
});

test('perf instrumentation is wired (enabled via ?perf=1, window.perf exposed)', async ({ page }) => {
  await page.goto('/?local=1&perf=1');
  await expect(page.getByRole('main').getByText('Studio', { exact: true })).toBeVisible();
  const state = await page.evaluate(() => ({
    hasPerf: typeof window.perf === 'object' && window.perf !== null,
    enabled: !!window.perf?.isEnabled?.(),
    hasBump: typeof window.perf?.bump === 'function',
  }));
  expect(state.hasPerf).toBe(true);
  expect(state.enabled).toBe(true);   // ?perf=1 → counters (incl. rt.send.*) are live
  expect(state.hasBump).toBe(true);
});
