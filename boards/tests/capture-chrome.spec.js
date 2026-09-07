// Capture Mode — the staging half.
//
// The list of chrome surfaces below IS the assertion. Clean mode has shipped
// for months with remote cursors, peer-selection pills, the toast stack, the
// staging pill and the empty-state furniture still drawing over it — every one
// of those was a gap nobody noticed, because nothing checked. So this spec
// asserts the whole list rather than a sample: adding a new chrome surface
// without adding its selector to the rule set in styles.css fails HERE, which
// is cheap, rather than in a finished video, which is not.
//
// Runs against ?local=1, which mounts the REAL CanvasSurface, the real toast
// provider and the real shell with no auth, no Supabase and no PartyKit — so
// what is being asserted is the shipped code path, not a stand-in for it.

import { test, expect } from '@playwright/test';

// Everything Capture Mode's "hide chrome" is responsible for removing.
// Split only to say WHY each group is here.
const SHARED_WITH_CLEAN_MODE = [
  '.sidebar', '.topbar', '.crumbs', '.tob',
  '.cnv-tools', '.cnv-zoom', '.cnv-hint', '.cnv-selcount', '.cnv-comments-eye',
  '.ws-presence', '.canvas-comment-layer', '.msg-panel',
  '.mb-nav', '.board-tags-strip', '.presence-stack-wrap',
  '.upgrade-chip', '.feedback-trigger', '.fv-banner', '.onboarding-coachmark',
];

// Capture-only. These MUST stay visible in ordinary clean mode — hiding live
// cursors or peer selections from a real person working in clean mode would
// silently break collaboration for them — so they get their own rule set and
// their own reason to exist.
const CAPTURE_ONLY = [
  '.cursors-layer', '.peer-sel-layer', '.peer-marquees-layer', '.peer-sel-pill',
  '.canvas-presence-roster',
  '.toast-stack', '.staging-banner', '.alt-session-banner', '.twk-gear',
  '.board-loading-overlay',
  '.cnv-empty-tiles', '.cnv-depth-dock', '.cnv-quick-add',
];

const ALL = [...SHARED_WITH_CLEAN_MODE, ...CAPTURE_ONLY];

async function bootCapture(page) {
  await page.goto('/?local=1&reset=1&capture=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  // The app's own "flags applied" signal — the same one the shot CLI waits on.
  await expect(page.locator('html[data-capture-ready="1"]')).toHaveCount(1);
}

test('?capture=1 stages the app: every chrome surface is gone', async ({ page }) => {
  await bootCapture(page);
  await expect(page.locator('body[data-capture-clean="1"]')).toHaveCount(1);

  for (const sel of ALL) {
    const shown = page.locator(`${sel}:visible`);
    await expect(shown, `${sel} is still visible in capture mode`).toHaveCount(0);
  }

  // The canvas itself must survive the cull — a "clean" shot of nothing is a
  // passing test and a useless feature.
  await expect(page.locator('.canvas-wrap')).toBeVisible();
});

// The regression that started this file. Hiding .sidebar with `display: none`
// stops it being a grid item, so .main auto-placed itself into the 0px column
// reserved for the sidebar and the canvas computed to ZERO WIDTH. Both
// pre-existing doors into the immersive view — ⌘. clean mode and the touch
// Focus view — shipped with it, because a grid whose only visible child is a
// full-bleed canvas looks the same as a blank one until you measure it.
//
// So measure it, and measure all three doors: the two that were broken and the
// one that would have inherited it.
for (const attr of ['data-clean-mode', 'data-focus-mode', 'data-capture-clean']) {
  test(`${attr}: the canvas fills the viewport instead of collapsing`, async ({ page }) => {
    await page.goto('/?local=1');
    await expect(page.locator('.canvas-wrap')).toBeVisible();
    const viewport = page.viewportSize().width;
    const before = (await page.locator('.main').boundingBox()).width;
    expect(before).toBeLessThan(viewport);   // the sidebar gutter is there to start

    await page.evaluate((a) => document.body.setAttribute(a, '1'), attr);
    // Poll rather than read once: the grid column is transitioned, so an
    // immediate measurement catches it mid-animation at the old width.
    await expect
      .poll(async () => (await page.locator('.main').boundingBox()).width,
            { message: `${attr} collapsed the canvas` })
      .toBe(viewport);
    await expect(page.locator('.canvas-wrap')).toBeVisible();
  });
}

test('the grain token drops, so a capture is deterministic', async ({ page }) => {
  await bootCapture(page);
  await expect(page.locator('body[data-capture-freeze="1"]')).toHaveCount(1);
  // Read it off an element that actually paints the grain, so this fails if
  // the token stops being what those surfaces reference.
  const url = await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue('--grain-url').trim());
  expect(url).toBe('none');
});

test('toasts are muted at the provider, not merely hidden', async ({ page }) => {
  await bootCapture(page);
  // Turning chrome-hiding off proves the toast is genuinely not being created,
  // rather than being created and CSS-hidden — a muted toast must not steal
  // focus, run its TTL timer, or fire onDismiss.
  await page.evaluate(() => document.body.removeAttribute('data-capture-clean'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(page.locator('.toast-stack')).toHaveCount(0);
});

test('capture leaves no trace once it is turned off', async ({ page }) => {
  await bootCapture(page);
  // ONE press. The handler accepts meta OR ctrl so the shortcut works on every
  // platform, which means sending both toggles off and straight back on.
  await page.keyboard.press('Control+Shift+Period');
  await expect(page.locator('body[data-capture-clean="1"]')).toHaveCount(0);
  await expect(page.locator('html[data-capture-ready="1"]')).toHaveCount(0);
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
});

test('the HUD can leave the frame and be summoned back with no keyboard', async ({ page }) => {
  await bootCapture(page);
  const hud = page.locator('.capture-hud');
  await expect(hud).toBeVisible();

  await page.locator('.capture-hud-icon[aria-label="Hide capture controls"]').click();
  await expect(hud).toHaveCount(0);
  await expect(page.locator('.capture-hud-dot')).toHaveCount(0);

  // Three fingers, because the canvas already owns one (draw/drag) and two
  // (pan/pinch). This is the only way back on a phone. `new Touch()` is an
  // illegal constructor in WebKit, so dispatch what the handler actually reads.
  await page.evaluate(() => {
    const ev = new Event('touchstart', { bubbles: true });
    Object.defineProperty(ev, 'touches', { value: [{}, {}, {}] });
    document.body.dispatchEvent(ev);
  });
  await expect(hud).toBeVisible();
});

test('the aspect guide frames the shape without resizing the app', async ({ page }) => {
  await bootCapture(page);
  const before = await page.locator('.canvas-wrap').boundingBox();

  // Target the aria-label, not the text: hasText is a SUBSTRING match, so
  // 'Frame' also matches the 'Reframe' chip sitting next to it.
  await page.locator('[aria-label^="Framing guide"]').click();
  const frame = page.locator('.capture-mask-frame');
  await expect(frame).toBeVisible();

  const box = await frame.boundingBox();
  expect(box.width / box.height).toBeCloseTo(9 / 16, 2);

  // The mask must be a guide, not a layout change: masking rather than
  // resizing is what makes what you see inside the frame exactly what the app
  // does at that size.
  const after = await page.locator('.canvas-wrap').boundingBox();
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.height).toBeCloseTo(before.height, 0);
});
