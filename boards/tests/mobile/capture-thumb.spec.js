// Capture Mode on a real phone.
//
// This is the case the whole design bent around: /admin is desktop-only
// (AdminPage returns AdminPhoneGate for isPhone), and the phone footage gets
// made on a phone. So the controls have to be genuinely thumb-usable, and the
// one path back from a hidden HUD has to work with no keyboard at all.
//
// Runs on mobile-chrome / mobile-safari / tablet, which supply real touch
// emulation and a real coarse pointer — the media query the 44px targets hang
// off cannot be exercised any other way.

import { test, expect } from '@playwright/test';

const MIN_TOUCH = 44;

// WebKit forbids `new Touch()` ("Illegal constructor"), and Playwright's
// touchscreen API only does a single contact, so a genuine three-finger
// gesture cannot be synthesised portably. Dispatch a touchstart carrying a
// three-entry `touches` list instead: that is exactly what the handler reads,
// so this pins the contract even though it isn't real multitouch.
async function threeFingerTap(page) {
  await page.evaluate(() => {
    const ev = new Event('touchstart', { bubbles: true });
    Object.defineProperty(ev, 'touches', { value: [{}, {}, {}] });
    document.body.dispatchEvent(ev);
  });
}

async function bootCapture(page) {
  await page.goto('/?local=1&reset=1&capture=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('html[data-capture-ready="1"]')).toHaveCount(1);
}

test('every HUD control is a real touch target', async ({ page }) => {
  await bootCapture(page);
  const hud = page.locator('.capture-hud');
  await expect(hud).toBeVisible();

  const controls = hud.locator('button');
  const n = await controls.count();
  expect(n).toBeGreaterThan(4);

  for (let i = 0; i < n; i++) {
    const el = controls.nth(i);
    const box = await el.boundingBox();
    const label = (await el.getAttribute('aria-label')) || (await el.innerText()).replace(/\n/g, ' ') || `#${i}`;
    expect(box.height, `"${label}" is ${box.height}px tall`).toBeGreaterThanOrEqual(MIN_TOUCH);
  }
});

test('the HUD stays inside the viewport and clear of the bottom nav', async ({ page }) => {
  await bootCapture(page);
  const vp = page.viewportSize();
  const hud = await page.locator('.capture-hud').boundingBox();

  expect(hud.x).toBeGreaterThanOrEqual(0);
  expect(hud.x + hud.width).toBeLessThanOrEqual(vp.width + 1);
  expect(hud.y + hud.height).toBeLessThanOrEqual(vp.height + 1);

  // With chrome hidden the nav is gone, so the HUD may sit at the bottom edge.
  await expect(page.locator('.mb-nav:visible')).toHaveCount(0);

  // Turn chrome back on — framing a shot that deliberately includes the app's
  // own UI — and the HUD must move up rather than land on top of the nav.
  await page.locator('.capture-hud-chip', { hasText: 'Chrome' }).click();
  const nav = page.locator('.mb-nav');
  if (await nav.count()) {
    const navBox = await nav.boundingBox();
    const moved = await page.locator('.capture-hud').boundingBox();
    if (navBox) {
      expect(moved.y + moved.height, 'the HUD overlaps the bottom nav')
        .toBeLessThanOrEqual(navBox.y + 1);
    }
  }
});

test('three fingers bring the HUD back — the only way home without a keyboard', async ({ page }) => {
  await bootCapture(page);
  const hud = page.locator('.capture-hud');
  await expect(hud).toBeVisible();

  // ✕ leaves a dot; the gesture is what removes even that.
  await page.locator('.capture-hud-icon[aria-label^="Close capture controls"]').tap();
  await expect(hud).toHaveCount(0);
  await expect(page.locator('.capture-hud-dot')).toBeVisible();
  await threeFingerTap(page);
  await expect(page.locator('.capture-hud-dot')).toHaveCount(0);

  // One and two fingers are the canvas's (draw/drag, pan/pinch) and must not
  // summon it — that would make the canvas unusable mid-take.
  await page.touchscreen.tap(120, 260);
  await expect(hud).toHaveCount(0);

  await threeFingerTap(page);
  await expect(hud).toBeVisible();
});
