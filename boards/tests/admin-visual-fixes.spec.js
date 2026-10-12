// Admin visual sweep fixes (2026-10-11 platform audit, VS-ADMIN-*).
//
// Each guard pins one layout or contrast rule on the DEV-only fixture harness
// (?adminpreview=1): no auth, no network, nothing written anywhere. The harness
// numbers are synthetic, so what is asserted is geometry and colour, never a
// figure.

import { test, expect } from '@playwright/test';

async function openAdmin(page, { tab = 'overview', view, theme = 'dark' } = {}) {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('soleil.ui', JSON.stringify({ theme: t }));
      document.documentElement.setAttribute('data-theme', t);
    } catch { /* ignore */ }
  }, theme);
  await page.goto(`/?adminpreview=1&tab=${tab}${view ? `&view=${view}` : ''}`);
}

/** WCAG relative-luminance contrast of two computed rgb()/rgba() strings. */
function contrast(fg, bg) {
  const parse = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(parse(fg));
  const b = lum(parse(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test.describe('Command Center at tablet width (VS-ADMIN-01)', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('rail panels keep a chart-sized height and nothing spills out of them', async ({ page }) => {
    await openAdmin(page, { tab: 'command' });
    const panels = page.locator('.cc-rail .cc-panel');
    await expect(panels).toHaveCount(8, { timeout: 20000 });
    const boxes = await panels.evaluateAll((els) => els.map((e) => ({
      h: e.getBoundingClientRect().height, sh: e.scrollHeight, ch: e.clientHeight,
    })));
    for (const b of boxes) {
      expect(b.h).toBeGreaterThan(120);
      expect(b.sh).toBeLessThanOrEqual(b.ch + 1);
    }
  });
});

test.describe('admin header (VS-ADMIN-02)', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('a tab row too long for the header never runs under the right-hand controls', async ({ page }) => {
    await openAdmin(page);
    await expect(page.getByRole('tab', { name: /^overview$/i })).toBeVisible({ timeout: 15000 });
    const overlap = await page.evaluate(() => {
      const right = document.querySelector('.admin-header-right').getBoundingClientRect();
      return [...document.querySelectorAll('.admin-header .admin-tab')].some((t) => {
        const r = t.getBoundingClientRect();
        return r.right > right.left && r.left < right.right && r.bottom > right.top && r.top < right.bottom;
      });
    });
    expect(overlap).toBe(false);
    // The control a tab used to cover takes its own click.
    await page.locator('.admin-header-right .auth-link').click();
  });
});

test.describe('stat strips that wrap (VS-ADMIN-03)', () => {
  /** Per row of a stat grid: its top, bottom, and the left of its first label. */
  async function rows(grid) {
    return grid.evaluate((g) => {
      const byTop = new Map();
      for (const c of g.children) {
        const r = c.getBoundingClientRect();
        const l = (c.querySelector('.admin-stat-label') || c).getBoundingClientRect().left;
        const key = Math.round(r.top);
        const row = byTop.get(key) || { top: r.top, bottom: r.bottom, left: Infinity };
        row.bottom = Math.max(row.bottom, r.bottom);
        row.left = Math.min(row.left, l);
        byTop.set(key, row);
      }
      return [...byTop.values()].sort((a, b) => a.top - b.top);
    });
  }

  for (const [tab, width] of [['api', 1440], ['overview', 1024]]) {
    test(`${tab} at ${width}: every row starts flush, and rows do not touch`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openAdmin(page, { tab });
      const grid = page.locator('.admin-stat-grid').first();
      await expect(grid.locator('.admin-stat-card').nth(5)).toBeVisible({ timeout: 15000 });
      const r = await rows(grid);
      expect(r.length).toBeGreaterThan(1);
      for (let i = 1; i < r.length; i++) {
        expect(Math.abs(r[i].left - r[0].left)).toBeLessThan(1);
        expect(r[i].top - r[i - 1].bottom).toBeGreaterThanOrEqual(12);
      }
    });
  }
});

test.describe('the 8/4 deck between 1001 and 1400px (VS-ADMIN-04)', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  for (const view of ['today', 'funnel']) {
    test(`${view}: a third paired with a full-width chart is not left alone at half width`, async ({ page }) => {
      await openAdmin(page, { view });
      const thirds = page.locator('.adm-deck > .adm-c4');
      await expect(thirds.first()).toBeVisible({ timeout: 15000 });
      const widths = await thirds.evaluateAll((els) => els.map((e) => [
        e.getBoundingClientRect().width, e.parentElement.getBoundingClientRect().width,
      ]));
      for (const [w, deck] of widths) expect(Math.abs(w - deck)).toBeLessThan(1);
    });
  }
});

/** Each element's text colour and its own (possibly translucent) ground laid over the page. */
async function pillColours(locator) {
  return locator.evaluateAll((els) => {
    const rgba = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const page = rgba(getComputedStyle(document.body).backgroundColor);
    return els.map((e) => {
      const [r, g, b, a = 1] = rgba(getComputedStyle(e).backgroundColor);
      const bg = [r, g, b].map((v, i) => Math.round(v * a + page[i] * (1 - a)));
      return { cls: e.className, fg: getComputedStyle(e).color, bg: `rgb(${bg.join(',')})` };
    });
  });
}

test.describe('light-theme pills (VS-ADMIN-05)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('tier, source and contacted pills on the Users list read at 4.5:1', async ({ page }) => {
    await openAdmin(page, { tab: 'users', theme: 'light' });
    const pills = page.locator('.admin-user-tierdot:not(.tier-waitlist), .admin-src-badge:not(.src-direct), .admin-badge-contacted');
    await expect(pills.first()).toBeVisible({ timeout: 15000 });
    const all = await pillColours(pills);
    expect(all.length).toBeGreaterThan(4);
    for (const p of all) expect(contrast(p.fg, p.bg), p.cls).toBeGreaterThanOrEqual(4.5);
  });

  test('status pills on the Waitlist read at 4.5:1', async ({ page }) => {
    await openAdmin(page, { tab: 'waitlist', theme: 'light' });
    const pills = page.locator('.admin-status:not(.admin-status-waitlist):not(.admin-status-canceled)');
    await expect(pills.first()).toBeVisible({ timeout: 15000 });
    for (const p of await pillColours(pills)) expect(contrast(p.fg, p.bg), p.cls).toBeGreaterThanOrEqual(4.5);
  });
});

test('the Waitlist gate switch draws a track when off in the light theme (VS-ADMIN-06)', async ({ page }) => {
  await openAdmin(page, { tab: 'waitlist', theme: 'light' });
  const sw = page.getByRole('switch').first();
  await expect(sw).toHaveAttribute('aria-checked', 'false', { timeout: 15000 });
  const [track] = await pillColours(sw);
  // The knob is white, so the track has to stand off the page on its own.
  expect(contrast(track.bg, await page.evaluate(() => getComputedStyle(document.body).backgroundColor)))
    .toBeGreaterThanOrEqual(1.6);
  expect(contrast(track.bg, 'rgb(255,255,255)')).toBeGreaterThanOrEqual(1.6);
});

test.describe('the heading after a stat strip (VS-ADMIN-07)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const tab of ['grants', 'waitlist', 'errors', 'tagging', 'api']) {
    test(`${tab}: what follows the strip does not sit on its last line`, async ({ page }) => {
      await openAdmin(page, { tab });
      const grid = page.locator('.admin-stat-grid').first();
      await expect(grid.locator('.admin-stat-card').first()).toBeVisible({ timeout: 15000 });
      const gap = await grid.evaluate((g) => {
        const n = g.nextElementSibling;
        return n.getBoundingClientRect().top - g.getBoundingClientRect().bottom;
      });
      expect(gap).toBeGreaterThanOrEqual(20);
    });
  }
});

test('bare <code> in the admin uses the app mono, not the browser default (VS-ADMIN-08)', async ({ page }) => {
  await openAdmin(page, { tab: 'discover' });
  const paths = page.locator('.admin-table td > code');
  await expect(paths.first()).toBeVisible({ timeout: 15000 });
  const families = await paths.evaluateAll((els) => els.map((e) => getComputedStyle(e).fontFamily));
  for (const f of families) expect(f).not.toBe('monospace');
});

test('the selected range segment shows the focus glow when tabbed to (VS-ADMIN-09)', async ({ page }) => {
  await openAdmin(page, { tab: 'api' });
  const active = page.locator('.admin-range button.is-active').first();
  await expect(active).toBeVisible({ timeout: 15000 });
  // Reach it the way a keyboard user does, so :focus-visible really matches.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (await active.evaluate((el) => el === document.activeElement)) break;
  }
  const [visible, shadow] = await active.evaluate((el) => [el.matches(':focus-visible'), getComputedStyle(el).boxShadow]);
  expect(visible).toBe(true);
  // The glow is the gold ring; the resting is-active shadow is a black hairline.
  expect(shadow).toMatch(/rgba\(255, 165, 0/);
});

test('the Feedback question picker is wide enough for the question it shows (VS-ADMIN-10)', async ({ page }) => {
  await openAdmin(page, { tab: 'feedback' });
  const select = page.getByRole('combobox', { name: 'Which question' });
  await expect(select).toBeVisible({ timeout: 15000 });
  const [client, scroll] = await select.evaluate((e) => [e.clientWidth, e.scrollWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
});

test.describe('the What changed date field on a touch tablet (VS-ADMIN-11)', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

  test('is at least as wide as the date it holds at the 16px touch size', async ({ page }) => {
    await openAdmin(page);
    const date = page.locator('.adm-markers-date');
    await expect(date).toBeVisible({ timeout: 15000 });
    const [w, intrinsic, size] = await date.evaluate((el) => {
      // The field's natural width at its own font, measured on a detached copy.
      const probe = el.cloneNode();
      probe.style.cssText = 'position:absolute;visibility:hidden;width:auto;min-width:0';
      el.parentElement.appendChild(probe);
      const natural = probe.getBoundingClientRect().width;
      probe.remove();
      return [el.getBoundingClientRect().width, natural, getComputedStyle(el).fontSize];
    });
    expect(size).toBe('16px');
    expect(w).toBeGreaterThanOrEqual(intrinsic - 0.5);
  });
});
