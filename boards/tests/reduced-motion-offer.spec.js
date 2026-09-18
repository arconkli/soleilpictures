// reduced-motion-offer.spec.js — the upgrade surfaces under
// prefers-reduced-motion: reduce.
//
// This repo has been burned twice by that media query and both scars are in
// styles.css. The global rule is
//
//   *, *::before, *::after {
//     transition-duration: var(--dur-fast) !important;
//     animation-duration:  var(--dur-fast) !important;
//     transform: none !important;
//   }
//
// so it hits EVERY element, and it CLAMPS animation duration rather than
// stopping it. Two consequences the offer surfaces are exposed to:
//
//   1. Anything centred with translate(-50%) is flung off-position. The
//      .capture-hud comment at styles.css:16251 records this happening; the
//      sanctioned fix is margin-inline auto, never an !important exemption.
//      .upgrade-backdrop dodges it with `display: grid; place-items: center`.
//
//   2. An entrance written as `opacity: 0` + `animation: … forwards` is
//      INVISIBLE if the animation does not run. The own-work strip is exactly
//      that shape, so its scoped opt-out has to restore opacity as well as
//      cancel the animation — cancelling alone would leave the reader's own
//      work permanently at opacity 0 on the screen asking them to pay.
//
// test.use({ reducedMotion }) has silently failed to apply in this repo
// before, which is why every test here calls emulateMedia AND asserts
// matchMedia().matches before trusting a single measurement.

import { expect, test } from '@playwright/test';

async function reduceMotion(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Belt and braces: prove the page agrees before measuring anything.
  const applied = await page.evaluate(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  expect(applied, 'emulateMedia did not take — every assertion below would be vacuous').toBe(true);
}

test('the upgrade modal stays centred and readable with motion off', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await reduceMotion(page);
  await page.goto('/?local=1&reset=1&tier=demo&cards=42&limit=50');
  await page.locator('.upgrade-chip').click();

  const modal = page.locator('.upgrade-modal');
  await expect(modal).toBeVisible();

  // Centred, not flung. The backdrop is a grid with place-items:center, so the
  // flattened transform cannot move it — a translate-centred panel would sit
  // with its left edge at the middle of the screen, which is the exact failure
  // the capture HUD hit.
  const box = await modal.boundingBox();
  const mid = box.x + box.width / 2;
  expect(Math.abs(mid - 1280 / 2), 'the modal must stay horizontally centred').toBeLessThan(4);
  expect(box.x).toBeGreaterThan(0);

  // Fully opaque: an entrance that does not run must not leave it faded.
  const opacity = await modal.evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBe(1);

  // And the offer is actually legible — the CTA is on screen, not clipped.
  const cta = page.locator('.pricing-cta-primary');
  await expect(cta).toBeVisible();
  const ctaBox = await cta.boundingBox();
  expect(ctaBox.width).toBeGreaterThan(80);
});

test('the own-work strip is visible with motion off, not stuck at opacity 0', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 950 });
  await reduceMotion(page);
  await page.goto('/?local=1&reset=1&tier=demo&cards=42&limit=50');
  await page.locator('.upgrade-chip').click();
  await expect(page.locator('.upgrade-modal')).toBeVisible();

  // The harness has no published boards, so the strip is empty by design —
  // inject the real markup to exercise the CSS, which is what is under test.
  await page.evaluate(() => {
    const line = document.querySelector('.own-work-line');
    const strip = document.createElement('div');
    strip.className = 'own-work-strip';
    strip.innerHTML = ['film-noir-look-book', 'neon-noir-look-book', 'short-film-shot-list']
      .map((s) => `<div class="own-work-thumb"><img src="/landing/${s}.webp" alt=""></div>`)
      .join('');
    line.parentNode.insertBefore(strip, line);
  });

  const thumbs = page.locator('.own-work-thumb');
  await expect(thumbs).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const el = thumbs.nth(i);
    await expect(el).toBeVisible();
    const o = await el.evaluate((n) => getComputedStyle(n).opacity);
    expect(Number(o), `thumb ${i} is invisible under reduced motion`).toBe(1);
    // Real size, not a collapsed box — aspect-ratio must still resolve.
    const b = await el.boundingBox();
    expect(b.width).toBeGreaterThan(20);
    expect(b.height).toBeGreaterThan(10);
  }
});

test('the pricing page still scrolls with motion off', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await reduceMotion(page);
  await page.addInitScript(() => {
    try { localStorage.removeItem('sb-local-auth-token'); } catch (_) {}
  });
  await page.goto('/pricing');

  const hero = page.locator('.seo-hero');
  await expect(hero).toBeVisible();
  // .seo-hero > * animates in with `backwards` fill; if the opt-out were
  // missing the whole hero would start — and under a cancelled animation stay
  // — invisible.
  const h1Opacity = await page.locator('.seo-h1').evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(h1Opacity)).toBe(1);

  // The scroller is .seo-scroll, not the document; a page that cannot scroll
  // hides everything below the hero, which is the whole offer.
  const scroller = page.locator('.seo-scroll');
  const moved = await scroller.evaluate((el) => {
    const before = el.scrollTop;
    el.scrollTop = 600;
    return el.scrollTop - before;
  });
  expect(moved, 'the page must still scroll').toBeGreaterThan(100);

  // And the buy block is reachable and laid out.
  const buy = page.locator('.pp-buy');
  await buy.scrollIntoViewIfNeeded();
  await expect(buy).toBeVisible();
  const box = await buy.boundingBox();
  expect(box.width).toBeGreaterThan(200);
});
