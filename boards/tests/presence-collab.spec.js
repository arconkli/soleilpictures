// Presence-at-scale DOM tests. Drives the real <CanvasPresence> via the
// ?presenceqa=1 harness (window.__soleilPresenceTest) with hundreds of
// synthetic peers, asserting the graceful-degradation guarantees from the
// collaboration-hardening pass:
//   1. cursor render is viewport-CULLED
//   2. cursor render is hard-CAPPED
//   3. peer-selection rule injection is CAPPED
//   4. a cursor-only flood causes NO `peers` re-render storm (the headline fix)
//
// Mirrors the harness-driven style of tests/share-zoom-cull.spec.js.

import { expect, test } from '@playwright/test';

async function openHarness(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?presenceqa=1');
  await page.waitForSelector('#root[data-presenceqa-ready="1"]');
  await page.waitForFunction(() => !!window.__soleilPresenceTest);
}

test('off-screen peer cursors are culled from the render', async ({ page }) => {
  await openHarness(page);
  // 40 peers; the first 35 parked far off-screen, leaving 5 visible.
  await page.evaluate(() => window.__soleilPresenceTest.seedPeers(40, { offscreen: 35 }));
  await page.waitForTimeout(150);
  const rendered = await page.evaluate(() => window.__soleilPresenceTest.renderedCursorCount());
  expect(rendered).toBe(5);
});

test('rendered cursors are hard-capped in a crowded room', async ({ page }) => {
  await openHarness(page);
  const cap = await page.evaluate(() => window.__soleilPresenceTest.tuning.CURSOR_RENDER_CAP);
  await page.evaluate(() => window.__soleilPresenceTest.seedPeers(120)); // all on-screen
  await page.waitForTimeout(150);
  const rendered = await page.evaluate(() => window.__soleilPresenceTest.renderedCursorCount());
  expect(rendered).toBe(cap);
});

test('peer-selection rules are capped under a flood of selections', async ({ page }) => {
  await openHarness(page);
  const ruleCap = await page.evaluate(() => window.__soleilPresenceTest.tuning.SELECTION_RULE_CAP);
  await page.evaluate(() => window.__soleilPresenceTest.seedPeers(30, { selectionsPerPeer: 50 }));
  await page.waitForTimeout(150);
  const rules = await page.evaluate(() => window.__soleilPresenceTest.injectedRuleCount());
  expect(rules).toBeGreaterThan(0);          // rings ARE drawn
  expect(rules).toBeLessThanOrEqual(ruleCap); // ...but bounded
});

test('a cursor-only flood causes zero peers re-render storm', async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => window.__soleilPresenceTest.seedPeers(15));
  await page.waitForTimeout(150);  // let the seed's single rAF commit settle
  // Start counting AFTER the seed commit.
  await page.evaluate(() => { window.__soleilPresenceTest.perfEnable(); window.__soleilPresenceTest.perfReset(); });
  // 90 frames of every-peer cursor motion — the exact storm scenario.
  await page.evaluate(() => window.__soleilPresenceTest.floodCursors(90));
  await page.waitForTimeout(150);
  const commits = await page.evaluate(() => window.__soleilPresenceTest.setPeersCount());
  expect(commits).toBe(0);
});

test('presence facepile caps avatars; hover roster names everyone', async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => window.__soleilPresenceTest.seedPeers(100));
  await page.waitForTimeout(150);
  // Facepile: 4 avatars + 1 overflow pill = 5 dots; overflow reads "+96".
  await expect(page.locator('.presence-stack .presence-dot')).toHaveCount(5);
  await expect(page.locator('.presence-overflow')).toHaveText('+96');
  // Hover → the roster lists ALL 100 (deduped by user id), so the overflow
  // is explorable rather than a dead "+N".
  await page.locator('.presence-stack-wrap').hover();
  await expect(page.locator('.presence-roster-row')).toHaveCount(100);
});

test('a genuine selection change DOES commit peers (gate is not stuck)', async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => window.__soleilPresenceTest.seedPeers(5));
  await page.waitForTimeout(150);
  await page.evaluate(() => { window.__soleilPresenceTest.perfEnable(); window.__soleilPresenceTest.perfReset(); });
  // Re-seed WITH selections — the identity fingerprint changes → must commit.
  await page.evaluate(() => window.__soleilPresenceTest.seedPeers(5, { selectionsPerPeer: 2 }));
  await page.waitForTimeout(150);
  const commits = await page.evaluate(() => window.__soleilPresenceTest.setPeersCount());
  expect(commits).toBeGreaterThan(0);
});
