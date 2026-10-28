// The sharing insight (0745–0747) in the admin preview harness, against the
// invented fixtures: the Users list's Sharing filter, sort and marks, a
// profile's Sharing, Analytics › Sharing and its handoff to Users, and Funnel's
// line pointing at the panels that moved.
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

test.describe('admin sharing insight', () => {
  test('the Users list filters and sorts by sharing, and a profile shows it by cluster', async ({ page }) => {
    await openAdmin(page, { tab: 'users' });
    const rows = page.locator('.admin-user-row');
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.admin-sh-mark').first()).toBeVisible();

    const all = await rows.count();
    await page.getByLabel('Filter by sharing').selectOption('brought');
    await expect.poll(() => rows.count()).toBeLessThan(all);

    await page.getByLabel('Sort users').selectOption('reach');
    await rows.first().click();
    const section = page.locator('.admin-sh');
    await expect(section).toBeVisible();
    await expect(section.getByRole('tablist', { name: 'Sharing' })).toBeVisible();
    await expect(section.locator('.admin-sh-card').first()).toBeVisible();
    await expect(section.locator('.admin-sh-ladder').first()).toContainText('Seen');
  });

  test('Analytics › Sharing lays out the week, the routes, who shares and the feed in words', async ({ page }) => {
    await openAdmin(page, { view: 'sharing' });
    await expect(page.getByRole('tab', { name: /^sharing$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.adm-sh-measure')).toHaveCount(7, { timeout: 15000 });

    const routes = page.getByRole('table', { name: 'Routes' });
    await expect(routes).toContainText('View link');
    await expect(routes).toContainText('Emailed invitation');
    // An invitation can't be "seen": its Seen cell is a dash.
    const invite = routes.locator('.adm-sh-rt-row', { hasText: 'Emailed invitation' });
    await expect(invite.locator('.adm-sh-rt-cell.is-none')).toHaveText('—');

    const feed = page.locator('.adm-sh-feed-s');
    await expect(feed.first()).toContainText(/copied the view link to “Pitch deck”/);
    const before = await feed.count();
    await page.getByRole('button', { name: 'Show older' }).click();
    await expect.poll(() => feed.count()).toBeGreaterThan(before);

    // A sharer's row opens their profile in Users.
    const first = page.locator('button.adm-sh-tt-row').first();
    // The name is the row's last line (an avatar's initial comes first).
    const who = (await first.locator('.adm-sh-tt-who').innerText()).trim().split('\n').pop().trim();
    await first.click();
    await expect(page.locator('.admin-user-row.is-selected')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.admin-detail-email')).toContainText(who);
  });

  test('Funnel points at Sharing, where Multiplayer and Referrals moved', async ({ page }) => {
    await openAdmin(page, { view: 'funnel' });
    await expect(page.locator('.admin-hero-funnel').first()).toBeVisible({ timeout: 15000 });
    const detail = page.getByText('Other paths into the product');
    await detail.click();
    await page.getByRole('link', { name: 'Sharing →' }).click();
    await expect(page.getByRole('tab', { name: /^sharing$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.adm-sh-measure').first()).toBeVisible({ timeout: 15000 });
  });

  test('the live console words a sharing event', async ({ page }) => {
    await openAdmin(page, { view: 'overview' });
    await expect(page.locator('.adm-console-ev', { hasText: 'copied the view link to “Pitch deck”' }).first())
      .toBeVisible({ timeout: 15000 });
  });
});
