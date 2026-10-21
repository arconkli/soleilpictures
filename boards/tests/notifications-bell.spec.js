import { expect, test } from '@playwright/test';

// The notifications bell (placement C, owner's pick, 2026-10-21) on the sidebar
// QA harness: the real NotificationsBell in the board's right island after the
// theme switch, with the mockup's five rows (three unread), and the real
// NotificationsPanel under the island. The phone sheet is
// tests/mobile/notifications-bell.spec.js.

async function open(page, query = '') {
  await page.goto(`/?sidebarqa=1${query}`);
  await page.waitForSelector('[data-sidebarqa-ready]');
}
const rect = (loc) => loc.evaluate((el) => el.getBoundingClientRect().toJSON());
const bell = (page) => page.locator('.chrome-right .nb-bell');
const panel = (page) => page.locator('.ntf-shell');

test.describe('the notifications bell', () => {
  test('sits right after Toggle theme and shows the unread count in ink', async ({ page }) => {
    await open(page);
    const b = bell(page);
    await expect(b).toBeVisible();
    await expect(b).toHaveAttribute('aria-label', 'Notifications, 3 unread');
    await expect(b).toHaveAttribute('title', 'Notifications');
    await expect(b).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(b).toHaveAttribute('aria-expanded', 'false');
    await expect(b).toHaveClass(/has-unread/);
    await expect(b.locator('.nb-count')).toHaveText('3');
    // Its neighbour on the left is the theme switch.
    const prev = await b.evaluate((el) => el.previousElementSibling?.getAttribute('aria-label'));
    expect(prev).toBe('Toggle theme');
    // As tall as its neighbours.
    const theme = page.locator('.chrome-right [aria-label="Toggle theme"]');
    expect(Math.round((await rect(b)).height)).toBe(Math.round((await rect(theme)).height));
    // Ink, not gold: the count is the bell's own ink colour.
    const [count, ink] = await b.evaluate((el) => [getComputedStyle(el.querySelector('.nb-count')).color, getComputedStyle(el).color]);
    expect(count).toBe(ink);
  });

  test('a click opens the list under the island, right edges aligned, and pressed', async ({ page }) => {
    await open(page);
    await bell(page).click();
    const p = panel(page);
    await expect(p).toBeVisible();
    await expect(p).toHaveAttribute('role', 'dialog');
    await expect(bell(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(bell(page)).toHaveClass(/is-pressed/);
    await page.waitForTimeout(300);     // the entrance animation scales the box
    const island = await rect(page.locator('.chrome-right'));
    const box = await rect(p);
    expect(Math.abs(box.right - island.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.top - (island.bottom + 8))).toBeLessThanOrEqual(1);
    expect(Math.round(box.width)).toBe(340);
    await expect(p.locator('.ntf-title')).toHaveText('Notifications');
    await expect(p.locator('.ntf-markall')).toHaveText('Mark all read');
    await expect(p.locator('.ntf-x')).toHaveCount(0);          // no × on a desktop
    await expect(p.locator('.ntf-row')).toHaveCount(5);
    await expect(p.locator('.ntf-row.is-unread')).toHaveCount(3);
    // The panel takes focus.
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ntf-panel'))).toBe(true);
  });

  test('Escape closes it and focus goes back to the bell', async ({ page }) => {
    await open(page);
    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.classList.contains('nb-bell'))).toBe(true);
    await expect(bell(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('a click outside closes it; the bell toggles it', async ({ page }) => {
    await open(page);
    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    await page.mouse.click(700, 600);
    await expect(panel(page)).toHaveCount(0);
    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    await bell(page).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test('Mark all read clears the count and goes', async ({ page }) => {
    await open(page);
    await bell(page).click();
    await panel(page).locator('.ntf-markall').click();
    await expect(bell(page).locator('.nb-count')).toHaveCount(0);
    await expect(bell(page)).not.toHaveClass(/has-unread/);
    await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications');
    await expect(panel(page).locator('.ntf-markall')).toHaveCount(0);
    await expect(panel(page).locator('.ntf-row.is-unread')).toHaveCount(0);
  });

  test('with the sidebar folded it still opens under the island', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await page.waitForTimeout(500);
    await bell(page).click();
    await page.waitForTimeout(300);
    const island = await rect(page.locator('.chrome-right'));
    const box = await rect(panel(page));
    expect(Math.abs(box.right - island.right)).toBeLessThanOrEqual(1);
    expect(box.left).toBeGreaterThanOrEqual(16);
  });
});
