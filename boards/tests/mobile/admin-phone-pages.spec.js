// The Growth and Search pages of the phone admin panel, in the dev-only fixture
// harness: /admin?adminpreview=1&phone=1&page=<id>. No auth, no network.

import { test, expect } from '@playwright/test';

const T = { timeout: 20000 };
let errors;

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const open = (page, id) => page.goto(`/admin?adminpreview=1&phone=1&page=${id}`);

const PAGES = [
  { id: 'growth', title: 'Growth', figures: 8, chips: ['12 weeks', '6 months'] },
  { id: 'search', title: 'Search', figures: 6, chips: ['28 days', /^Since /] },
];

for (const p of PAGES) {
  test.describe(p.id, () => {
    test(`shows its title and ${p.figures} figures`, async ({ page }) => {
      await open(page, p.id);
      await expect(page.getByTestId(`ap-page-${p.id}`)).toBeVisible(T);
      await expect(page.getByRole('heading', { level: 1, name: p.title })).toBeVisible();
      await expect(page.getByTestId(`ap-page-${p.id}`).locator('figure.ap-f')).toHaveCount(p.figures, T);
      await expect(page.getByRole('link', { name: 'Open full admin' })).toBeVisible();
    });

    test('the range chips switch and the chart changes', async ({ page }) => {
      await open(page, p.id);
      await expect(page.getByTestId(`ap-page-${p.id}`).locator('figure.ap-f')).toHaveCount(p.figures, T);
      const first = page.getByTestId(`ap-page-${p.id}`).locator('figure.ap-f').first().locator('svg.ap-ch');
      await expect(first).toBeVisible();
      const a = page.getByRole('button', { name: p.chips[0] });
      const b = page.getByRole('button', { name: p.chips[1] });
      await expect(a).toHaveAttribute('aria-pressed', 'true');
      await expect(b).toHaveAttribute('aria-pressed', 'false');
      const before = await first.innerHTML();
      await b.click();
      await expect(b).toHaveAttribute('aria-pressed', 'true');
      await expect(a).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => first.innerHTML()).not.toBe(before);
      await a.click();
      await expect(a).toHaveAttribute('aria-pressed', 'true');
    });

    test('no horizontal overflow and no NaN, undefined or Infinity', async ({ page }) => {
      await open(page, p.id);
      await expect(page.getByTestId(`ap-page-${p.id}`).locator('figure.ap-f')).toHaveCount(p.figures, T);
      const wide = await page.evaluate(() => { const s = document.querySelector('.ap-scroll'); return s.scrollWidth - s.clientWidth; });
      expect(wide).toBeLessThanOrEqual(0);
      const text = await page.getByTestId(`ap-page-${p.id}`).innerText();
      expect(text).not.toMatch(/NaN|undefined|Infinity/);
    });

    test('‹ Today returns to the home', async ({ page }) => {
      await open(page, p.id);
      await expect(page.getByTestId(`ap-page-${p.id}`)).toBeVisible(T);
      await page.locator('.ap-bk').click();
      await expect(page.getByTestId(`ap-page-${p.id}`)).toHaveCount(0);
      await expect(page.getByTestId('ap-lead')).toBeVisible(T);
      expect(new URL(page.url()).searchParams.get('page')).toBeNull();
    });
  });
}

test('Search says where it stops and counts the home page on its own', async ({ page }) => {
  await open(page, 'search');
  await expect(page.locator('.ap-pk')).toContainText(/Google Search · to /, T);
  await expect(page.getByRole('heading', { name: 'The home page' })).toBeVisible();
  await expect(page.locator('.ap-tp').first()).toBeVisible();
});
