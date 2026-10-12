// Layout and colour regressions from the visual sweep of the public pages: the
// front door's sign-in scene, /templates, the docs code blocks, /best and
// /pricing. Content-agnostic like public-pages.spec.js — selectors and computed
// styles, never prose, so copy can be rewritten without touching this file.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';

// .public-dark pins --bg-0 to this; the light theme's is #f5f5f7.
const DARK_BG = 'rgb(10, 10, 12)';

test.describe('the signed-out front door on a light theme', () => {
  test.use({ colorScheme: 'light' });

  test('stays in the dark brand world: dark scene, dark ink on the gold button', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.goto('/');
    await expect(page.locator('.sb-frost .auth-btn')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    await expect(page.locator('.sb-scene')).toHaveCSS('background-color', DARK_BG);
    // White on gold was about 1.8:1; the scene's own --bg-0 ink is the dark one.
    await expect(page.locator('.sb-frost .auth-btn').first()).toHaveCSS('color', DARK_BG);
    // The light-ground mark (dark orbit) would vanish into the dark scene.
    await expect(page.locator('.sb-box .clusters-mark-dark')).toBeVisible();
    await expect(page.locator('.sb-box .clusters-mark-light')).toBeHidden();
  });

  test('never paints a light splash between the dark boot splash and the scene', async ({ page }) => {
    await routeAnalytics(page, []);
    // Record the background of every loading splash React mounts, before any
    // of it can be missed between two polls.
    await page.addInitScript(() => {
      window.__splashBgs = [];
      new MutationObserver(() => {
        document.querySelectorAll('.auth-screen').forEach((el) => {
          if (el.__seen) return;
          el.__seen = true;
          window.__splashBgs.push(getComputedStyle(el).backgroundColor);
        });
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto('/');
    await expect(page.locator('.sb-frost .auth-btn')).toBeVisible();
    const bgs = await page.evaluate(() => window.__splashBgs);
    for (const bg of bgs) expect(bg).toBe(DARK_BG);
  });
});

test('the gold sign-in button shows a visible keyboard focus ring', async ({ page }) => {
  await routeAnalytics(page, []);
  await page.goto('/');
  const input = page.getByLabel('Email address');
  await input.fill('focus-ring@example.com');
  await input.focus();
  await page.keyboard.press('Tab');
  const btn = page.locator('.sb-frost .auth-btn').first();
  await expect(btn).toBeFocused();
  // A 1px glow at 32% gold on a gold fill was the old "ring": invisible.
  await expect(btn).toHaveCSS('outline-style', 'solid');
  await expect(btn).toHaveCSS('outline-width', '2px');
  expect(await btn.evaluate((el) => getComputedStyle(el).outlineColor)).not.toBe(
    await btn.evaluate((el) => getComputedStyle(el).backgroundColor));
});

// Rects of the footer and of what must never be drawn over it. A footer that
// has stepped aside (visibility:hidden) cannot be overlapped.
function footerClashes(page, selectors) {
  return page.evaluate((sels) => {
    const foot = document.querySelector('.sb-foot');
    if (!foot || getComputedStyle(foot).visibility === 'hidden') return [];
    const fr = foot.getBoundingClientRect();
    const out = [];
    for (const sel of sels) {
      document.querySelectorAll(sel).forEach((el) => {
        if (Number(getComputedStyle(el).opacity) < 0.5) return;
        const r = el.getBoundingClientRect();
        if (!r.height) return;
        const overlaps = r.bottom > fr.top + 1 && r.top < fr.bottom && r.right > fr.left && r.left < fr.right;
        if (overlaps) out.push(`${sel} ${Math.round(r.top)}-${Math.round(r.bottom)} vs footer ${Math.round(fr.top)}-${Math.round(fr.bottom)}`);
      });
    }
    return out;
  }, selectors);
}

test.describe('a phone with the keyboard up (a short visible viewport)', () => {
  test.use({ viewport: { width: 390, height: 480 }, hasTouch: true, isMobile: true });

  test('the code step tagline is never drawn over the footer links', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('soleil.auth.pendingCode', JSON.stringify({
          email: 'someone.with.a.longish.address@studio.film', sentAt: Date.now(),
        }));
      } catch { /* ignore */ }
    });
    await page.goto('/');
    await expect(page.locator('.auth-code-input')).toBeVisible({ timeout: 15000 });
    await expect.poll(() => footerClashes(page, ['.sb-trust', '.sb-frost'])).toEqual([]);
  });

  test('the explore pill under the email step is never drawn over the footer links', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.goto('/');
    await expect(page.locator('.sb-explore')).toBeVisible();
    await expect.poll(() => footerClashes(page, ['.sb-explore', '.sb-trust'])).toEqual([]);
  });
});

test.describe('the landing finale on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the resting board cards stay above the footer', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.goto('/');
    await expect(page.locator('.sb-frost .auth-btn')).toBeVisible();
    // The scene's own hook for pinning its scroll progress: 1 = the finale.
    await page.evaluate(() => { window.__sbForceP = 1; });
    await page.waitForTimeout(1200);
    await expect(page.locator('.sb-foot')).toBeVisible();
    await expect.poll(() => footerClashes(page, ['.sb-card'])).toEqual([]);
  });
});

test.describe('docs code blocks on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the always-shown Copy button does not sit on the first line of code', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.goto('/docs/api/cards');
    await expect(page.locator('.docs-code').first()).toBeVisible();
    const clashes = await page.evaluate(() => [...document.querySelectorAll('.docs-code')].flatMap((block) => {
      const btn = block.querySelector('.docs-copy');
      const code = block.querySelector('pre code');
      if (!btn || !code || Number(getComputedStyle(btn).opacity) < 0.5) return [];
      const b = btn.getBoundingClientRect();
      const r = document.createRange();
      r.selectNodeContents(code);
      const firstLine = r.getClientRects()[0];
      return firstLine && firstLine.top < b.bottom ? [`${Math.round(firstLine.top)} < ${Math.round(b.bottom)}`] : [];
    }));
    expect(clashes).toEqual([]);
  });
});

test('a /best page sets its answer card on the same left edge as its heading', async ({ page }) => {
  await routeAnalytics(page, []);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/best/pureref-alternatives');
  const card = page.locator('.seo-li-answer');
  await expect(card).toBeVisible();
  const lefts = await card.evaluate((el) => ({
    card: Math.round(el.getBoundingClientRect().left),
    heading: Math.round(el.closest('section').querySelector('h2').getBoundingClientRect().left),
  }));
  expect(Math.abs(lefts.card - lefts.heading)).toBeLessThanOrEqual(1);
});

test.describe('/pricing layout', () => {
  test('the Free and Creator names and prices sit level, side by side', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/pricing');
    await expect(page.locator('.pp-plan-creator .pricing-card-price')).toBeVisible();
    const m = await page.evaluate(() => {
      const top = (s) => Math.round(document.querySelector(s).getBoundingClientRect().top);
      const base = (s) => Math.round(document.querySelector(s).getBoundingClientRect().bottom);
      return {
        names: [top('.pp-plan-free .pp-plan-name'), top('.pp-plan-creator .pp-plan-name')],
        prices: [base('.pp-plan-free .pp-plan-price'), base('.pp-plan-creator .pricing-card-price')],
      };
    });
    expect(Math.abs(m.names[0] - m.names[1])).toBeLessThanOrEqual(1);
    expect(Math.abs(m.prices[0] - m.prices[1])).toBeLessThanOrEqual(1);
  });

  test('the footer brand line is centred like the rows above it', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/pricing');
    const brand = page.locator('.seo-footer-brand');
    await brand.scrollIntoViewIfNeeded();
    const off = await brand.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const kids = [...el.children].map((c) => c.getBoundingClientRect());
      const left = Math.min(...kids.map((r) => r.left));
      const right = Math.max(...kids.map((r) => r.right));
      return Math.abs((left + right) / 2 - (box.left + box.right) / 2);
    });
    expect(off).toBeLessThanOrEqual(2);
  });

  test('on a phone the Monthly/Annual pills fill their track', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/pricing');
    const toggle = page.locator('.pp-plan-creator .pricing-card-toggle');
    await expect(toggle).toBeVisible();
    const gaps = await toggle.evaluate((el) => {
      const t = el.getBoundingClientRect();
      const pills = [...el.querySelectorAll('.pricing-toggle-pill')].map((p) => p.getBoundingClientRect());
      return [pills[0].left - t.left, t.right - pills[pills.length - 1].right];
    });
    for (const g of gaps) expect(g).toBeLessThanOrEqual(6);
  });
});

test.describe('/templates on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('every sort label sits on one line and the toolbar does not pan sideways', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.goto('/templates');
    const sorts = page.locator('.exp-sorts .exp-sort-btn');
    await expect(sorts.first()).toBeVisible();
    expect(await sorts.count()).toBeGreaterThanOrEqual(4);
    const m = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.exp-sorts .exp-sort-btn')];
      const line = (el) => parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize);
      const tb = document.querySelector('.exp-toolbar');
      return {
        wrapped: btns.filter((b) => b.clientHeight - 16 > line(b) * 1.5).map((b) => b.textContent),
        toolbarOverflow: tb.scrollWidth - tb.clientWidth,
      };
    });
    expect(m.wrapped).toEqual([]);
    expect(m.toolbarOverflow).toBeLessThanOrEqual(0);
  });
});
