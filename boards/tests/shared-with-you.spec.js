// The sidebar's "Shared with you": newest five, a new dot, a VIEW chip, a ⋯ menu,
// sub-clusters under a caret, a magnifier past five and an All shared row. The
// real SidebarSharedBoards is mounted with list_shared_boards-shaped rows through
// src/local/shareWorkspaceProbe.js (mountSharedWithMe).
//
//   PW_PORT=5263 npx playwright test tests/shared-with-you.spec.js --project=desktop-chrome
import { expect, test } from '@playwright/test';

const MAYA = { name: 'Maya Ortiz', color: '#8e5cf7' };
const row = (id, name, day, extra = {}) => ({
  board_id: id, board_name: name, role: 'editor', source_workspace_id: 'src-1',
  source_workspace_name: 'Personal Workspace', created_at: `2026-04-${String(day).padStart(2, '0')}T12:00:00Z`,
  is_shared_root: true, shared_by_name: MAYA.name, shared_by_color: MAYA.color, ...extra,
});
// Seven shares, newest on the 20th ("Reel one"), oldest on the 11th ("Reel seven").
const ROWS = [
  row('m1', 'Reel one', 20), row('m2', 'Reel two', 19), row('m3', 'Reel three', 18, { role: 'viewer' }),
  row('m4', 'Reel four', 15), row('m5', 'Reel five', 14), row('m6', 'Reel six', 12), row('m7', 'Reel seven', 11),
].reverse();

async function mount(page, props = {}) {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async (p) => {
    const { mountSharedWithMe } = await import('/src/local/shareWorkspaceProbe.js');
    mountSharedWithMe(p);
  }, { shared: ROWS, ...props });
  // The probe's host sits above the app's menus (z 9999 vs the portaled menu's 1300).
  await page.evaluate(() => { document.querySelector('.share-probe-host').style.zIndex = '1'; });
}
const rows = (page) => page.locator('.swy-row');
const calls = (page) => page.evaluate(() => window.__sharedProbe);

test('lists the newest five first; the open one is appended when it is older', async ({ page }) => {
  await mount(page);
  await expect(rows(page).locator('.sb-row-label')).toHaveText(['Reel one', 'Reel two', 'Reel three', 'Reel four', 'Reel five']);
  await mount(page, { activeBoardId: 'm7', activeRootId: 'm7' });
  await expect(rows(page).locator('.sb-row-label')).toHaveText(['Reel one', 'Reel two', 'Reel three', 'Reel four', 'Reel five', 'Reel seven']);
  await expect(page.locator('.swy-row.active')).toHaveCount(1);
});

test('a never-opened share has a new dot until meta says it was opened', async ({ page }) => {
  const meta = [['m1', { openedAt: null, hiddenAt: null }], ['m2', { openedAt: '2026-04-21T09:00:00Z', hiddenAt: null }]];
  await mount(page, { meta });
  await expect(rows(page).filter({ hasText: 'Reel one' }).locator('.swy-new')).toHaveCount(1);
  await expect(rows(page).filter({ hasText: 'Reel two' }).locator('.swy-new')).toHaveCount(0);
  await expect(page.locator('.swy-new')).toHaveCount(1);
});

test('a viewer gets a View chip, an editor does not', async ({ page }) => {
  await mount(page);
  await expect(rows(page).filter({ hasText: 'Reel three' }).locator('.sb-shared-ro')).toHaveText('View');
  await expect(rows(page).filter({ hasText: 'Reel one' }).locator('.sb-shared-ro')).toHaveCount(0);
});

test('the ⋯ menu opens, copies the link and removes from my list', async ({ page }) => {
  await mount(page);
  const more = (name) => rows(page).filter({ hasText: name }).getByRole('button', { name: `More for ${name}` });
  await rows(page).filter({ hasText: 'Reel two' }).hover();
  await more('Reel two').click();
  await page.getByRole('menuitem', { name: 'Open' }).click();
  await more('Reel two').click();
  await page.getByRole('menuitem', { name: 'Copy link' }).click();
  await more('Reel one').click();
  await page.getByRole('menuitem', { name: 'Remove from my list' }).click();
  expect(await calls(page)).toEqual({ opened: ['m2'], copied: ['m2'], removed: ['m1'] });
});

test('a click on the menu itself does not open the cluster', async ({ page }) => {
  await mount(page);
  await rows(page).first().hover();
  await rows(page).first().getByRole('button', { name: /^More for/ }).click();
  const menu = page.getByRole('menu');
  await menu.click({ position: { x: 2, y: 2 } });
  expect((await calls(page)).opened).toEqual([]);
});

test('the caret shows sub-clusters', async ({ page }) => {
  const kid = { board_id: 'k1', board_name: 'Cut notes', role: 'editor' };
  await mount(page, { childrenOf: [['m1', [kid]]] });
  await expect(page.getByText('Cut notes')).toHaveCount(0);
  await rows(page).first().locator('.sb-tree-chev').click();
  await expect(rows(page).filter({ hasText: 'Cut notes' })).toHaveCount(1);
  await rows(page).filter({ hasText: 'Cut notes' }).click();
  expect((await calls(page)).opened).toEqual(['k1']);
});

// Functions can't cross page.evaluate as props, so the entry is built in the page.
async function mountWithAll(page, shared) {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async (rows) => {
    const { mountSharedWithMe } = await import('/src/local/shareWorkspaceProbe.js');
    window.__asked = { search: 0, open: 0 };
    mountSharedWithMe({
      shared: rows,
      allShared: { count: 12, onSearch: () => { window.__asked.search += 1; }, onOpen: () => { window.__asked.open += 1; } },
    });
  }, shared);
}

test('the magnifier shows only with more than five and calls onSearch', async ({ page }) => {
  await mountWithAll(page, ROWS.slice(0, 5));
  await expect(page.getByRole('button', { name: 'Search shared', exact: true })).toHaveCount(0);
  await mountWithAll(page, ROWS);
  await page.getByRole('button', { name: 'Search shared', exact: true }).click();
  expect(await page.evaluate(() => window.__asked)).toEqual({ search: 1, open: 0 });
});

test('All shared shows its count and calls onOpen', async ({ page }) => {
  await mountWithAll(page, ROWS);
  const all = page.getByRole('button', { name: /All shared/ });
  await expect(all).toContainText('12');
  await all.click();
  expect(await page.evaluate(() => window.__asked)).toEqual({ search: 0, open: 1 });
});

test('the header is not a button holding a button: the magnifier sits beside the toggle', async ({ page }) => {
  await mountWithAll(page, ROWS);
  await expect(page.getByRole('button', { name: 'Search shared', exact: true })).toHaveCount(1);
  await expect(page.locator('[role="button"] .swy-find')).toHaveCount(0);
  await expect(page.locator('.swy-head-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.swy-head-toggle').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.swy-head-toggle')).toHaveAttribute('aria-expanded', 'false');
});

test('Copy link by keyboard puts focus back on the row\'s ⋯ button', async ({ page }) => {
  await mount(page);
  const more = rows(page).filter({ hasText: 'Reel two' }).getByRole('button', { name: 'More for Reel two' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect((await calls(page)).copied).toEqual(['m2']);
  await expect(more).toBeFocused();
});

test('Remove from my list by keyboard leaves focus on the section, not the page', async ({ page }) => {
  await mount(page);
  const more = rows(page).filter({ hasText: 'Reel one' }).getByRole('button', { name: 'More for Reel one' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Remove from my list' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect((await calls(page)).removed).toEqual(['m1']);
  // The row and its ⋯ are gone, so focus goes to the section, never the page.
  await expect.poll(() => page.evaluate(() => document.activeElement?.className || '')).toMatch(/swy-head-toggle|swy-all/);
});

test('the All shared count is not read as a bare number', async ({ page }) => {
  await mountWithAll(page, ROWS);
  const all = page.locator('.swy-all');
  await expect(all).toHaveAttribute('aria-label', /All shared, \d+ new/);
  await expect(all.locator('.swy-all-count')).toHaveAttribute('aria-hidden', 'true');
});
