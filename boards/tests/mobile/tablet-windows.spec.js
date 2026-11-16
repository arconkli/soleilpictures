// Settings, Share, Search and Notifications on an upright tablet (the phone
// shell at 641–1024px under a finger): centred windows of about 600px over a
// scrim, not the phone's full-screen sheets (styles.css, "An upright tablet's
// Settings, Share, Search and Notifications"). A tap on the scrim closes one,
// and so does Back, which leaves the cluster on screen. A phone keeps the
// sheets. Drives the real app, signed in through the stub.

import { expect, test } from '@playwright/test';
import { bootSignedIn } from '../helpers/signedInStub.js';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'the phone shell');
});

const tab = (page, name) => page.locator('.mb-nav-tab', { hasText: name });

// Each: how a finger opens it, its window, and the scrim around the window.
const WINDOWS = [
  { name: 'Settings', open: (page) => tab(page, 'Settings').tap(), panel: '.settings-modal', scrim: '.settings-bg' },
  { name: 'Share', open: (page) => page.locator('.tb-share').tap(), panel: '.share-modal', scrim: '.modal-shell-bg.share-backdrop' },
  { name: 'Search', open: (page) => tab(page, 'Search').tap(), panel: '.cmdk', scrim: '.cmdk-bg' },
  { name: 'Notifications', open: (page) => page.locator('.nb-bell').tap(), panel: '.ntf-panel', scrim: '.ntf-shell.is-sheet' },
];

async function boot(page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {}
    // Every click the page raises, counted before anything can stop it: a
    // tap's click comes after its press, and may land on what a scrim covered.
    window.__clicks = 0;
    window.addEventListener('click', () => { window.__clicks += 1; }, true);
  });
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.mb-nav')).toBeVisible({ timeout: 30000 });
}

const rectOf = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
});
const scrimOf = (loc) => loc.evaluate((el) => {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { background: cs.backgroundColor, width: r.width, height: r.height };
});

const centreOf = async (loc) => {
  const b = await loc.boundingBox();
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
};
const inside = (pt, r) => pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;

// A tap on the scrim where it covers a control: the window closes, and the
// tap's click does not reach the control (nothing opens in its place).
async function tapScrimOver(page, pt) {
  const before = await page.evaluate(() => window.__clicks);
  await page.touchscreen.tap(pt.x, pt.y);
  // The click follows the press: wait for it to have been raised.
  await expect.poll(() => page.evaluate(() => window.__clicks)).toBeGreaterThan(before);
  for (const w of WINDOWS) await expect(page.locator(w.panel)).toHaveCount(0);
}

async function expectOnCluster(page) {
  await expect(page.locator('.app.is-home')).toHaveCount(0);
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page).toHaveURL(/^http:\/\/[^/]+\/$/);
}

async function windowsAt(page, size) {
  if (size) await page.setViewportSize(size);
  await boot(page);
  const { width: vw, height: vh } = page.viewportSize();
  // Two controls the scrim covers, found before anything is open.
  const searchTab = await centreOf(tab(page, 'Search'));
  const bell = await centreOf(page.locator('.nb-bell'));
  for (const w of WINDOWS) {
    await test.step(`${w.name} at ${vw}x${vh}`, async () => {
      const panel = page.locator(w.panel);
      await w.open(page);
      await expect(panel).toBeVisible();
      // Its entrance scales it: measured once it has settled.
      await expect.poll(async () => Math.round((await rectOf(panel)).width)).toBeGreaterThanOrEqual(560);
      const r = await rectOf(panel);
      expect(r.width).toBeLessThanOrEqual(640);
      expect(r.width).toBeLessThanOrEqual(vw - 32);
      expect(Math.abs(r.left - (vw - r.right))).toBeLessThanOrEqual(2);
      expect(r.height).toBeLessThanOrEqual(vh * 0.86);
      expect(r.top).toBeGreaterThanOrEqual(16);
      expect(r.bottom).toBeLessThanOrEqual(vh - 16);
      expect(parseFloat(await panel.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(10);
      // A scrim over the whole window, behind it.
      const s = await scrimOf(page.locator(w.scrim));
      expect(Math.round(s.width)).toBe(vw);
      expect(Math.round(s.height)).toBe(vh);
      expect(s.background).toMatch(/rgba\(\d+, \d+, \d+, 0\.\d+\)/);

      if (w.name === 'Search') {
        // The field takes the focus and stays on screen, in the window.
        const field = page.locator('.cmdk-input');
        await field.tap();
        await expect(field).toBeFocused();
        const f = await rectOf(field);
        const after = await rectOf(panel);
        expect(f.top).toBeGreaterThanOrEqual(after.top);
        expect(f.bottom).toBeLessThanOrEqual(Math.min(after.bottom, vh));
        expect(after.top).toBeGreaterThanOrEqual(16);
        expect(Math.abs(after.left - (vw - after.right))).toBeLessThanOrEqual(2);
      }

      // A tap on the scrim, beside the window, closes it.
      await page.touchscreen.tap(Math.round(r.left / 2), Math.round(vh / 2));
      await expect(panel).toHaveCount(0);
      await expectOnCluster(page);

      // A tap on the scrim over the Search tab closes it and opens nothing;
      // over the bell, Notifications stays closed.
      if (w.name !== 'Search') {
        expect(inside(searchTab, r)).toBe(false);
        await w.open(page);
        await expect(panel).toBeVisible();
        await tapScrimOver(page, searchTab);
        await expectOnCluster(page);
      }
      if (w.name === 'Notifications') {
        expect(inside(bell, r)).toBe(false);
        await w.open(page);
        await expect(panel).toBeVisible();
        await tapScrimOver(page, bell);
      }

      // And so does Back, once, with the cluster still on screen.
      await w.open(page);
      await expect(panel).toBeVisible();
      await page.goBack();
      await expect(panel).toHaveCount(0);
      await expectOnCluster(page);
    });
  }
}

test('an upright iPad: each opens as a centred window that the scrim and Back close', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tablet', 'an upright tablet');
  await windowsAt(page, null);
});

for (const size of [{ width: 744, height: 1133 }, { width: 1024, height: 1366 }]) {
  test(`${size.width}x${size.height}: the same windows`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet', 'an upright tablet');
    await windowsAt(page, size);
  });
}

test('Escape closes each window', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tablet', 'an upright tablet');
  await boot(page);
  for (const w of WINDOWS) {
    await w.open(page);
    await expect(page.locator(w.panel)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(w.panel)).toHaveCount(0);
  }
});

test('a phone keeps each as a full-screen sheet', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'a phone');
  await boot(page);
  const { width: vw, height: vh } = page.viewportSize();
  for (const w of WINDOWS) {
    await test.step(w.name, async () => {
      const panel = page.locator(w.panel);
      await w.open(page);
      await expect(panel).toBeVisible();
      await expect.poll(async () => Math.round((await rectOf(panel)).width)).toBe(vw);
      const r = await rectOf(panel);
      expect(Math.round(r.left)).toBe(0);
      expect(r.height).toBeGreaterThanOrEqual(vh * 0.9);
      expect(parseFloat(await panel.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBe(0);
      await page.goBack();
      await expect(panel).toHaveCount(0);
      await expectOnCluster(page);
    });
  }
});

// A phone held sideways is 641px wide and more (an iPhone 13 is 844x390): the
// windows are for a tablet's height, so it keeps the sheets.
test('a phone held sideways keeps each as a full-width sheet', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'a phone');
  await page.setViewportSize({ width: 844, height: 390 });
  await boot(page);
  const vw = page.viewportSize().width;
  for (const w of WINDOWS) {
    await test.step(w.name, async () => {
      const panel = page.locator(w.panel);
      await w.open(page);
      await expect(panel).toBeVisible();
      await expect.poll(async () => Math.round((await rectOf(panel)).width)).toBe(vw);
      expect(Math.round((await rectOf(panel)).left)).toBe(0);
      // Search's corners are rounded from 641px up in the sidebar's look
      // (commandPaletteLook.css), as they were before the windows.
      if (w.name !== 'Search') {
        expect(parseFloat(await panel.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBe(0);
      }
      await page.goBack();
      await expect(panel).toHaveCount(0);
    });
  }
});
