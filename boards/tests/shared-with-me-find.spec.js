// The sidebar's "Shared with me": grouped by who shared, and a find field once
// there are more than 6 shared clusters. The real SidebarSharedBoards is
// mounted with list_shared_boards-shaped rows through
// src/local/shareWorkspaceProbe.js (mountSharedWithMe).
//
//   PW_PORT=5263 npx playwright test tests/shared-with-me-find.spec.js --project=desktop-chrome
import { expect, test } from '@playwright/test';

const PEOPLE = {
  sam: { id: '00000000-0000-4000-8000-0000000000c1', name: 'Sam Lee', color: '#4f8df8' },
  maya: { id: '00000000-0000-4000-8000-0000000000c2', name: 'Maya Ortiz', color: '#8e5cf7' },
  jun: { id: '00000000-0000-4000-8000-0000000000c3', name: 'Jun Park', color: '#2fa36b' },
  rae: { id: '00000000-0000-4000-8000-0000000000c4', name: 'Rae Okafor', color: '#d9602e' },
  tess: { id: '00000000-0000-4000-8000-0000000000c5', name: 'Tess Alder', color: '#c2447a' },
};
const row = (id, name, who, day, ws = 'Personal Workspace') => ({
  board_id: id, board_name: name, role: 'editor', source_workspace_id: `src-${who ? who.id : 'diner'}`,
  source_workspace_name: ws, created_at: `2026-04-${String(day).padStart(2, '0')}T12:00:00Z`, is_shared_root: true,
  shared_by: who ? who.id : null, shared_by_name: who ? who.name : null, shared_by_color: who ? who.color : null,
});
// Maya shares 7 (newest on the 20th, oldest on the 11th), then Jun, Sam, Rae, Tess,
// and one cluster whose sharer is unknown (a group named for its workspace).
const MAYA_ROWS = [
  row('m1', 'Reel one', PEOPLE.maya, 20), row('m2', 'Reel two', PEOPLE.maya, 19), row('m3', 'Reel three', PEOPLE.maya, 18),
  row('m4', 'Reel four', PEOPLE.maya, 15), row('m5', 'Reel five', PEOPLE.maya, 14), row('m6', 'Reel six', PEOPLE.maya, 12),
  row('m7', 'Reel seven', PEOPLE.maya, 11),
];
const ROWS = [
  ...MAYA_ROWS,
  row('s1', 'Title cards', PEOPLE.sam, 16), row('s2', 'Poster ideas', PEOPLE.sam, 13), row('s3', 'Sound notes', PEOPLE.sam, 10),
  row('j1', 'Location scout', PEOPLE.jun, 17), row('j2', 'Wardrobe', PEOPLE.jun, 9),
  row('r1', 'Grade tests', PEOPLE.rae, 8),
  row('t1', 'Storyboard', PEOPLE.tess, 7),
  row('d1', 'Menu shots', null, 1, 'Midnight Diner'),
];

async function mount(page, props = {}) {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async (p) => {
    const { mountSharedWithMe } = await import('/src/local/shareWorkspaceProbe.js');
    mountSharedWithMe(p);
  }, { shared: ROWS, ...props });
}
const heads = (page) => page.locator('.sb-shared-group-head .sb-shared-group-name');
const mayaGroup = (page) => page.locator('.sb-shared-group', { has: page.getByText('From Maya Ortiz') });

test('groups by who shared, newest share first; an unknown sharer falls back to the workspace', async ({ page }) => {
  await mount(page);
  await expect(heads(page)).toHaveText(['From Maya Ortiz', 'From Jun Park', 'From Sam Lee', 'From Rae Okafor', 'From Tess Alder', 'From Midnight Diner']);
});

test('a group over 5 shows 5 and "Show 2 more", which reveals all 7', async ({ page }) => {
  await mount(page);
  await expect(mayaGroup(page).locator('.sb-shared-row')).toHaveCount(5);
  await mayaGroup(page).getByRole('button', { name: 'Show 2 more' }).click();
  await expect(mayaGroup(page).locator('.sb-shared-row')).toHaveCount(7);
  await expect(mayaGroup(page).locator('.sb-shared-more')).toHaveCount(0);
});

test('an open cluster among the hidden ones is shown without clicking', async ({ page }) => {
  await mount(page, { activeBoardId: 'm7' });
  await expect(mayaGroup(page).locator('.sb-shared-row')).toHaveCount(7);
  await expect(mayaGroup(page).locator('.sb-shared-row.active')).toHaveCount(1);
  await expect(mayaGroup(page).locator('.sb-shared-more')).toHaveCount(0);
});

test("find: a person's first name leaves their rows; Enter opens the first; Escape clears", async ({ page }) => {
  await mount(page);
  const find = page.getByPlaceholder('Find a cluster or person…');
  await expect(find).toBeVisible();
  await find.fill('sam');
  await expect(page.locator('.sb-shared-row')).toHaveCount(3);
  await expect(heads(page)).toHaveText(['From Sam Lee']);
  await find.press('Enter');
  expect(await page.evaluate(() => window.__sharedProbe.opened)).toEqual(['s1']);

  await find.press('Escape');
  await expect(find).toHaveValue('');
  await expect(heads(page)).toHaveCount(6);

  await find.fill('zzz');
  await expect(page.locator('.sb-shared-empty')).toHaveText('Nothing shared with you matches “zzz”.');
  await expect(page.locator('.sb-shared-row')).toHaveCount(0);
});
