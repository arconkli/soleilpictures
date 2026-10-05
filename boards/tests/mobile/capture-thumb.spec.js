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

// A browser with no screen capture at all — which is every browser on iOS,
// since they are all WebKit. Playwright's WebKit does expose getDisplayMedia,
// so a real iPhone cannot be reproduced by picking a project; it has to be
// taken away. The property lives on the prototype, so `delete` on the instance
// is a no-op and would make this whole test vacuous.
//
// In an init script, because it has to be gone before the app's first render:
// recordingSupport() is read into a useMemo on mount.
async function bootWithoutScreenCapture(page) {
  await page.addInitScript(() => {
    try { delete MediaDevices.prototype.getDisplayMedia; } catch (_) {}
    try { Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia',
      { value: undefined, configurable: true }); } catch (_) {}
  });
  await bootCapture(page);
  // Prove the simulation took, or everything below passes for the wrong reason.
  expect(await page.evaluate(() => !!navigator.mediaDevices?.getDisplayMedia)).toBe(false);
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

test('the controls you actually reach for are on the first screen', async ({ page }) => {
  await bootCapture(page);

  // The strip scrolls, so "it fits" is not the assertion — a max-width-capped
  // container always fits. What matters is what is reachable WITHOUT scrolling,
  // because on a phone this is the entire control surface and the order it
  // shipped with was a desk's: the camera and the take sat past the halfway
  // mark of something nearly three screen-widths long.
  const reachable = await page.evaluate(() => {
    const hud = document.querySelector('.capture-hud');
    hud.scrollLeft = 0;
    return [...hud.querySelectorAll('[data-cap]')]
      .filter(el => el.offsetLeft + el.offsetWidth <= hud.clientWidth + 1)
      .map(el => el.getAttribute('data-cap'));
  });

  // Reframe is the one you touch between every take; Take and Play are the
  // shot itself. Fit and Push in are the two single moves.
  for (const key of ['reframe', 'take', 'play']) {
    expect(reachable, `"${key}" needs a scroll to reach`).toContain(key);
  }
});

test('nothing in the strip is a control this device cannot honour', async ({ page }) => {
  // iOS has no getDisplayMedia at all, so Rec and Shot can never do anything
  // there. They used to render disabled, at the far END of the scroller — the
  // reward for swiping two screen-widths was two dead buttons.
  await bootWithoutScreenCapture(page);

  await expect(page.locator('.capture-hud')).toBeVisible();
  await expect(page.locator('.capture-hud [data-cap="rec"]')).toHaveCount(0);
  await expect(page.locator('.capture-hud [data-cap="shot"]')).toHaveCount(0);
  // And nothing that IS rendered is dead.
  await expect(page.locator('.capture-hud button:disabled')).toHaveCount(0);
});

test('a take can be played on a device that cannot record — the whole phone case', async ({ page }) => {
  await bootWithoutScreenCapture(page);

  // playTake() used to have exactly one caller, inside onRecord, behind a button
  // that is permanently disabled on iOS. So the five written-down takes — the
  // whole reason a clip reads as a product video — could be cycled through and
  // never played, on the device they were designed for.
  const chip = page.locator('[aria-label^="Take:"]');
  for (let i = 0; i < 8 && !(await chip.innerText()).includes('Punch in'); i++) await chip.tap();
  await expect(chip).toContainText('Punch in');

  const before = await page.evaluate(() => document.querySelector('.canvas')?.style.transform || '');
  await page.locator('[data-cap="play"]').tap();

  // The tool takes itself out of the picture for the length of the take — that
  // is what makes the OS recorder's output usable — and comes back on its own.
  await expect(page.locator('.capture-hud')).toHaveCount(0);
  await expect(page.locator('.capture-hud-dot')).toHaveCount(0);
  await expect(page.locator('.capture-hud')).toBeVisible({ timeout: 15000 });

  expect(await page.evaluate(() => document.querySelector('.canvas')?.style.transform || ''))
    .not.toBe(before);
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

test('the framing guide goes with the controls, not just the controls', async ({ page }) => {
  await bootCapture(page);

  // Compose against a guide first — that is what it is for.
  const frame = page.locator('[data-cap="frame"]');
  for (let i = 0; i < 6 && !(await frame.innerText()).includes('9:16'); i++) await frame.tap();
  await expect(page.locator('.capture-mask')).toBeVisible();

  // Then get everything out of the way to shoot. The mask is an independent
  // sibling of the HUD, so hiding the panel used to leave the letterbox, the
  // dashed safe rect and a literal "9:16" label over the canvas — and on a
  // phone the OS recorder films exactly that.
  // The HUD unmounts; the mask is hidden by a rule on body[data-capture-hidden]
  // so AspectMask stays independent of the panel's local state. Either way it
  // is not in the frame, which is the thing being asserted.
  await threeFingerTap(page);
  await expect(page.locator('.capture-hud')).toHaveCount(0);
  await expect(page.locator('.capture-mask')).toBeHidden();

  await threeFingerTap(page);
  await expect(page.locator('.capture-hud')).toBeVisible();
  await expect(page.locator('.capture-mask')).toBeVisible();
});

test('the drawn cursor does not stay where your finger left it', async ({ page }) => {
  await bootCapture(page);
  const cursorChip = page.locator('[data-cap="spotlight"]');
  await cursorChip.tap();
  const dot = page.locator('.capture-spot-dot');
  await expect(dot).toBeVisible();

  const transform = () => dot.evaluate(el => el.style.transform);

  // On touch, pointermove only fires while contact is down. Without a lift
  // handler the dot parked at the last tap for the rest of the shoot — a gold
  // ring sitting in the middle of every OS screenshot and every recorded frame,
  // pointing at nothing.
  await page.touchscreen.tap(180, 320);
  await expect.poll(transform).toContain('-9999px');
});

test('three fingers bring the HUD back — the only way home without a keyboard', async ({ page }) => {
  await bootCapture(page);
  const hud = page.locator('.capture-hud');
  await expect(hud).toBeVisible();

  // ✕ leaves a dot; the gesture is what removes even that — and the same
  // gesture brings back the CONTROLS, not the dot. It used to toggle `gone`
  // alone, so coming back from a panel you had closed first landed you on the
  // pip again, and the one keyboard-free path home was two steps.
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
