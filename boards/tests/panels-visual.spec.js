// Layout and focus checks for the panel findings of the visual sweep
// (VS-PANELS-*). Most panels are mounted on their own by
// tests/helpers/panelsProbe.js (served by the dev server), on top of the
// ?local=1&blank=1 shell so the page has the app's styles and a real app
// behind the dialog for focus to escape into. Supabase reads go to the fake
// project the config forces; the ones a panel needs are answered here.
import { expect, test } from '@playwright/test';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function probe(page, fn, ...args) {
  await page.evaluate(async ({ fn, args }) => {
    const m = await import('/tests/helpers/panelsProbe.js');
    m[fn](...args);
  }, { fn, args });
}

async function setTheme(page, theme) {
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
}

const rect = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
});

// PostgREST-shaped answers for the tables the panels read.
async function answerRest(page, table, rows) {
  await page.route(`**/rest/v1/${table}*`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(rows),
  }));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForLoadState('domcontentloaded');
});

test('VS-PANELS-01: the tag page header keeps the name, Manage and close on screen on a phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await probe(page, 'mountTagDetail');
  const head = page.locator('.panels-probe-host .tag-detail-head');
  await expect(head).toBeVisible();
  const name = await rect(head.locator('.tag-detail-name'));
  expect(name.w, 'the tag name must not collapse').toBeGreaterThan(60);
  for (const sel of ['.tag-detail-count', '.tag-detail-manage-btn', '.tag-detail-close']) {
    const r = await rect(head.locator(sel));
    expect(r.r, `${sel} must end inside the viewport`).toBeLessThanOrEqual(PHONE.width);
    expect(r.l).toBeGreaterThanOrEqual(0);
  }
  // Name, count, Manage and close share the first row; the chips go below.
  const close = await rect(head.locator('.tag-detail-close'));
  expect(Math.abs(close.t - name.t), 'close sits on the name row').toBeLessThan(name.h);
  // The header itself no longer overflows; the chip strip scrolls instead.
  const sw = await head.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sw).toBeLessThanOrEqual(0);
  const chips = head.locator('.tag-profile-typeswitch');
  expect(await chips.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
  await setTheme(page, 'light');
  await page.screenshot({ path: test.info().outputPath('tag-390-light.png') });
  await setTheme(page, 'dark');
  await page.screenshot({ path: test.info().outputPath('tag-390-dark.png') });
});
