import { expect, test } from '@playwright/test';

// Exercises the P1.3 phone shell wiring on touch projects:
// hamburger opens the sidebar drawer, backdrop closes it, the bottom
// nav switches surfaces and shows the right active indicator.

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1');
  await expect(page.locator('#root')).toBeVisible();
});

test('hamburger opens sidebar drawer, backdrop closes it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome' || testInfo.project.name === 'tablet',
    'phone-width only (≤640px)');
  // Drawer starts closed (sidebar exists but lacks is-mobile-open).
  const sidebar = page.locator('.sidebar').first();
  await expect(sidebar).not.toHaveClass(/is-mobile-open/);
  // Tap the hamburger
  await page.getByLabel('Open menu').first().tap();
  await expect(sidebar).toHaveClass(/is-mobile-open/);
  // Backdrop should be present
  await expect(page.locator('.sidebar-mobile-backdrop')).toBeVisible();
  // Tap the backdrop on the right edge of the viewport (the drawer
  // covers the left ~320px, so the backdrop's center is hidden under
  // the drawer — tap the uncovered right strip the user would touch).
  const vw = page.viewportSize().width;
  await page.locator('.sidebar-mobile-backdrop').tap({
    position: { x: vw - 20, y: 200 },
  });
  await expect(sidebar).not.toHaveClass(/is-mobile-open/);
});

test('bottom nav has four tabs; no tab is lit while viewing a board', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome' || testInfo.project.name === 'tablet',
    'phone-width only (≤640px)');
  const tabs = page.locator('.mb-nav-tab');
  await expect(tabs).toHaveCount(4);
  await expect(tabs.nth(0)).toContainText('Home');
  await expect(tabs.nth(1)).toContainText('Search');
  await expect(tabs.nth(2)).toContainText('Messages');
  await expect(tabs.nth(3)).toContainText('Settings');
  // The default surface is a BOARD, not the Home graph. None of the four tabs
  // is the current destination, so none is selected (the old code wrongly lit
  // Home via a fall-through). The centre "+" is the active affordance instead.
  await expect(page.locator('.mb-nav-tab.is-active')).toHaveCount(0);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('.mb-nav-create')).toBeVisible();
});

test('Search tab opens the command palette', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome' || testInfo.project.name === 'tablet',
    'phone-width only (≤640px)');
  await page.locator('.mb-nav-tab').nth(1).tap();
  await expect(page.locator('.cmdk')).toBeVisible();
  // Full-screen on phone: the mobile close button is shown (no Esc key on touch).
  await expect(page.locator('.cmdk-close')).toBeVisible();
});

test('Messages tab opens the MessagesPanel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome' || testInfo.project.name === 'tablet',
    'phone-width only (≤640px)');
  await page.locator('.mb-nav-tab').nth(2).tap();
  await expect(page.locator('.msg-panel')).toBeVisible();
});

test('bottom nav is not rendered on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'desktop only');
  await expect(page.locator('.mb-nav')).toHaveCount(0);
});

test('touch tablet engages the mobile shell (bottom nav + drawer sidebar)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tablet', 'tablet only');
  // iPad portrait (≤1024px, touch) now gets the SAME decluttered mobile shell
  // as a phone — a bottom nav + a slide-out drawer sidebar — instead of the
  // pinned desktop layout. Mirrors `mobileShell` in App.jsx / LocalBoardsApp and
  // the shell media query in styles.css.
  await expect(page.locator('.mb-nav')).toBeVisible();
  const sidebar = page.locator('.sidebar').first();
  // Sidebar starts as a closed drawer (present, not slid in)...
  await expect(sidebar).not.toHaveClass(/is-mobile-open/);
  // ...and the hamburger opens it.
  await page.getByLabel('Open menu').first().tap();
  await expect(sidebar).toHaveClass(/is-mobile-open/);
});
