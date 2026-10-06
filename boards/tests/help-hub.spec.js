import { expect, test } from '@playwright/test';

// The Help hub (components/HelpHub.jsx): the one screen that says what a
// cluster can hold and where the rest is written down. Exercised against the
// local QA shell, which mounts the same HelpHost and HelpButton as the real
// App. Analytics never leaves the local shell, so the events are not asserted
// here; analyticsEvents.test.mjs proves the catalog entries have emitters.

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.sb-search')).toBeVisible();
});

test('the topbar ? opens the hub, which lists every kind with a docs link, and Esc closes it', async ({ page }) => {
  await page.locator('.tb-right button[aria-label="Help"]').click();
  const hub = page.locator('.help-hub');
  await expect(hub).toBeVisible();
  await expect(hub.locator('.shortcuts-hd')).toHaveText('What can I add here?');
  const kinds = hub.locator('.help-kind');
  expect(await kinds.count()).toBeGreaterThanOrEqual(10);
  // Every kind carries a title, a line and a Learn more door.
  const n = await kinds.count();
  for (let i = 0; i < n; i++) {
    await expect(kinds.nth(i).locator('.help-kind-title')).not.toBeEmpty();
    await expect(kinds.nth(i).locator('.help-kind-line')).not.toBeEmpty();
    await expect(kinds.nth(i).locator('.help-kind-more')).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(hub).toBeHidden();
});

test('Learn more opens the docs page in a new tab, never the canvas tab', async ({ page, context }) => {
  await page.locator('.tb-right button[aria-label="Help"]').click();
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('.help-kind-more').first().click(),
  ]);
  expect(new URL(popup.url()).pathname.startsWith('/docs')).toBe(true);
  await popup.close();
  // The canvas tab is still on the app.
  expect(new URL(page.url()).pathname).toBe('/');
});

test('Keyboard shortcuts hands over to the shortcuts overlay', async ({ page }) => {
  await page.locator('.tb-right button[aria-label="Help"]').click();
  await page.locator('.help-action', { hasText: 'Keyboard shortcuts' }).click();
  await expect(page.locator('.help-hub')).toBeHidden();
  await expect(page.locator('.shortcuts-modal')).toBeVisible();
});

test('Guides expands to one door per docs section, each a /docs path', async ({ page, context }) => {
  await page.locator('.tb-right button[aria-label="Help"]').click();
  await page.locator('.help-action', { hasText: 'Guides' }).click();
  const guides = page.locator('.help-guide');
  await expect(guides.first()).toBeVisible();
  expect(await guides.count()).toBeGreaterThanOrEqual(5);
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    guides.first().click(),
  ]);
  expect(new URL(popup.url()).pathname.startsWith('/docs')).toBe(true);
  await popup.close();
});

// The sidebar foot exists only in the real App (the local shell has no foot),
// so its door is proven at the source level, the way the other wiring specs do.
test('the real App mounts the host with feedback and wires the sidebar foot', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  expect(src).toContain('<HelpHost feedback={<FeedbackButton as="icon" />} />');
  expect(src).toContain('<HelpButton as="foot" via="sidebar" />');
  expect(src).toContain('<HelpButton as="tb" via="topbar" />');
  expect(src).toMatch(/id: 'help', label: 'Help'/);
  expect(src).toMatch(/id: 'add-anything', label: 'What can I add here\?'/);
});

test('the ⌘K commands open the same hub', async ({ page }) => {
  const actions = page.locator('.cmdk-group', { hasText: 'Actions' });

  await page.keyboard.press(`${MOD}+k`);
  await expect(page.locator('.cmdk')).toBeVisible();
  await page.locator('.cmdk-input').fill('what can i add');
  // Wait for the row: the active index resets a render after the query changes.
  await expect(actions.locator('.cmdk-row', { hasText: 'What can I add here?' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.help-hub')).toBeVisible();
  // Modal moves focus into the panel on the next animation frame and only
  // handles Escape while focus is inside it — wait for that before pressing.
  await expect(page.locator('.help-hub button[aria-label="Close"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.help-hub')).toBeHidden();

  await page.keyboard.press(`${MOD}+k`);
  await expect(page.locator('.cmdk')).toBeVisible();
  await page.locator('.cmdk-input').fill('help');
  await expect(actions.locator('.cmdk-row', { hasText: 'Help' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.help-hub')).toBeVisible();
  await expect(page.locator('.help-hub button[aria-label="Close"]')).toBeFocused();
});
