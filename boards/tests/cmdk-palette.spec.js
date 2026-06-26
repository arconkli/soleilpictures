import { expect, test } from '@playwright/test';

// Global search + ⌘K command palette (CommandPalette.jsx). Exercised against
// the local QA shell (no Supabase) so it covers instant board-name search,
// the command registry, recents, keyboard nav, and navigate-on-select.
//
// Content search (cards/notes/docs/tags via entity_search) needs Supabase and
// is verified manually in the real shell — not here.

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.sb-search')).toBeVisible();
});

test('opens via ⌘K and "/", closes via Esc', async ({ page }) => {
  // ⌘K / Ctrl-K opens; the input auto-focuses.
  await page.keyboard.press(`${MOD}+k`);
  await expect(page.locator('.cmdk')).toBeVisible();
  await expect(page.locator('.cmdk-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmdk')).toBeHidden();

  // "/" opens too (when not typing in a field).
  await page.keyboard.press('/');
  await expect(page.locator('.cmdk')).toBeVisible();
  // The "/" must NOT leak into the input.
  await expect(page.locator('.cmdk-input')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmdk')).toBeHidden();
});

test('the top-right topbar search icon opens the palette', async ({ page }) => {
  await page.locator('.tb-right button[aria-label="Search"]').click();
  await expect(page.locator('.cmdk')).toBeVisible();
  await expect(page.locator('.cmdk-input')).toBeFocused();
});

test('board-name search highlights the match and Enter navigates to the board', async ({ page }) => {
  await page.locator('.sb-search').click();
  await page.locator('.cmdk-input').fill('Sundown');

  const boardRow = page.locator('.cmdk-row', { hasText: 'Sundown Highway' });
  await expect(boardRow).toBeVisible();
  // The typed substring is wrapped in <mark>.
  await expect(boardRow.locator('.cmdk-mark')).toHaveText(/Sundown/i);
  // First result is auto-active for keyboard select.
  await expect(page.locator('.cmdk-row.is-active').first()).toContainText('Sundown Highway');

  await page.keyboard.press('Enter');
  await expect(page.locator('.cmdk')).toBeHidden();
  await expect(page.locator('.app')).toHaveAttribute('data-screen-label', /Sundown Highway/);
});

test('arrow keys move the active row', async ({ page }) => {
  await page.locator('.sb-search').click();
  // "s" matches several boards (Studio, Shorts & spec, Stills, Sundown Highway).
  await page.locator('.cmdk-input').fill('s');
  const rows = page.locator('.cmdk-row');
  await expect(rows.first()).toHaveClass(/is-active/);
  await page.keyboard.press('ArrowDown');
  await expect(rows.first()).not.toHaveClass(/is-active/);
  await expect(rows.nth(1)).toHaveClass(/is-active/);
  await page.keyboard.press('ArrowUp');
  await expect(rows.first()).toHaveClass(/is-active/);
});

test('command palette runs an action (toggle theme)', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.sb-search').click();
  await page.locator('.cmdk-input').fill('theme');

  const actions = page.locator('.cmdk-group', { hasText: 'Actions' });
  const themeRow = actions.locator('.cmdk-row', { hasText: 'Toggle theme' });
  await expect(themeRow).toBeVisible();
  await expect(themeRow.locator('.cmdk-row-badge')).toHaveText(/Action/i);

  await page.keyboard.press('Enter');
  await expect(page.locator('.cmdk')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('command palette toggles the sidebar', async ({ page }) => {
  await expect(page.locator('.app')).not.toHaveClass(/sb-collapsed/);
  await page.locator('.sb-search').click();
  await page.locator('.cmdk-input').fill('sidebar');
  await page.locator('.cmdk-row', { hasText: 'Toggle sidebar' }).click();
  await expect(page.locator('.app')).toHaveClass(/sb-collapsed/);
});

test('recently-opened boards appear on the empty query', async ({ page }) => {
  // Navigate to a board through search so it lands in recents.
  await page.locator('.sb-search').click();
  await page.locator('.cmdk-input').fill('Halcyon');
  await page.locator('.cmdk-row', { hasText: 'Halcyon' }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-screen-label', /Halcyon/);

  // Reopen with an empty query — the Recent section surfaces it.
  await page.locator('.sb-search').click();
  await expect(page.locator('.cmdk-input')).toHaveValue('');
  const recent = page.locator('.cmdk-group', { hasText: 'Recent' });
  await expect(recent).toBeVisible();
  await expect(recent.locator('.cmdk-row', { hasText: 'Halcyon' })).toBeVisible();
});

test('no-results shows an empty state', async ({ page }) => {
  await page.locator('.sb-search').click();
  await page.locator('.cmdk-input').fill('zzzznotaboard');
  await expect(page.locator('.cmdk-empty')).toContainText('No results');
});

test('link-a-board picker is the same palette restricted to boards (pick mode)', async ({ page }) => {
  // "All boards" opens the link picker — the palette in boards-only pick mode.
  await page.locator('.sb-row-all').click();
  await expect(page.locator('.cmdk')).toBeVisible();
  await expect(page.getByPlaceholder(/Search boards to link/)).toBeVisible();
  // Empty query lists every board for browse-and-pick; no Actions/commands.
  await expect(page.locator('.cmdk-group-label', { hasText: 'All boards' })).toBeVisible();
  await expect(page.locator('.cmdk-group', { hasText: 'Actions' })).toHaveCount(0);
  // Footer reads "link", not "open".
  await expect(page.locator('.cmdk-foot')).toContainText('link');

  // A command keyword yields NO command row here — boards only.
  await page.locator('.cmdk-input').fill('theme');
  await expect(page.locator('.cmdk-row', { hasText: 'Toggle theme' })).toHaveCount(0);
  await expect(page.locator('.cmdk-empty')).toContainText('No boards match');

  // Picking a board closes the picker (and links it onto the canvas).
  await page.locator('.cmdk-input').fill('Halcyon');
  await page.locator('.cmdk-row', { hasText: 'Halcyon' }).first().click();
  await expect(page.locator('.cmdk')).toBeHidden();
});
