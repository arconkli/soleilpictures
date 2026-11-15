// "Share workspace…" from a workspace's right-click / ⋯ menu, and the co-owner
// role (0391) as the menu and the Share panel present it.
//
// Local QA mode has no workspace switcher, so the real components are mounted
// with fixtures through src/local/shareWorkspaceProbe.js.
import { expect, test } from '@playwright/test';

const ME = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const WORKSPACES = [
  { id: 'ws-mine', name: 'Mine', created_by: ME, created_at: '2026-01-01' },
  { id: 'ws-co', name: 'Co-owned', created_by: OTHER, _myRole: 'coowner', _joinedAt: '2026-01-02' },
  { id: 'ws-ed', name: 'Edited', created_by: OTHER, _myRole: 'editor', _joinedAt: '2026-01-03' },
];

async function boot(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForLoadState('domcontentloaded');
}

const rowFor = (page, name) => page.locator('.ws-menu-row-wrap', { has: page.locator('.ws-menu-name', { hasText: name }) });

test('right-click a workspace → its menu, with Share workspace… for the owner and a co-owner only', async ({ page }) => {
  await boot(page);
  await page.evaluate(async ({ workspaces, me }) => {
    const { mountWorkspaceMenu } = await import('/src/local/shareWorkspaceProbe.js');
    mountWorkspaceMenu({ workspaces, activeWorkspaceId: 'ws-mine', personalWorkspaceId: null, selfUserId: me });
  }, { workspaces: WORKSPACES, me: ME });

  // Owner: right-click opens the row's menu (not the browser's), Share first.
  await rowFor(page, 'Mine').click({ button: 'right' });
  const share = page.locator('.ws-menu-row-pop-item', { hasText: 'Share workspace' });
  await expect(share).toBeVisible();
  await share.click();
  expect(await page.evaluate(() => window.__shareProbe.share)).toEqual(['ws-mine']);
  expect(await page.evaluate(() => window.__shareProbe.close)).toBeGreaterThan(0);

  // Co-owner: can share and rename, and leaves rather than deletes.
  await expect(rowFor(page, 'Co-owned').locator('.ws-menu-sub')).toHaveText('You co-own this');
  await rowFor(page, 'Co-owned').click({ button: 'right' });
  const pop = page.locator('.ws-menu-row-pop');
  await expect(pop.locator('.ws-menu-row-pop-item', { hasText: 'Share workspace' })).toBeVisible();
  await expect(pop.locator('.ws-menu-row-pop-item', { hasText: 'Rename' })).toBeVisible();
  await expect(pop.locator('.ws-menu-row-pop-item', { hasText: 'Leave workspace' })).toBeVisible();
  await expect(pop.locator('.ws-menu-row-pop-item', { hasText: 'Delete workspace' })).toHaveCount(0);

  // Editor: no Share, no Rename — only Leave.
  await rowFor(page, 'Edited').click({ button: 'right' });
  await expect(pop.locator('.ws-menu-row-pop-item', { hasText: 'Share workspace' })).toHaveCount(0);
  await expect(pop.locator('.ws-menu-row-pop-item', { hasText: 'Rename' })).toHaveCount(0);
  await expect(pop.locator('.ws-menu-row-pop-item', { hasText: 'Leave workspace' })).toBeVisible();
});

test('the ⋯ on a workspace row offers Share workspace… too', async ({ page }) => {
  await boot(page);
  await page.evaluate(async ({ workspaces, me }) => {
    const { mountWorkspaceMenu } = await import('/src/local/shareWorkspaceProbe.js');
    mountWorkspaceMenu({ workspaces, activeWorkspaceId: 'ws-mine', personalWorkspaceId: null, selfUserId: me });
  }, { workspaces: WORKSPACES, me: ME });
  await rowFor(page, 'Mine').hover();
  await rowFor(page, 'Mine').locator('.ws-menu-row-more').click();
  await expect(page.locator('.ws-menu-row-pop-item', { hasText: 'Share workspace' })).toBeVisible();
});

for (const who of ['owner', 'coowner']) {
  test(`workspace-scoped Share panel (${who}) opens on "Whole workspace"`, async ({ page }) => {
    await boot(page);
    await page.evaluate(async ({ me, other, who }) => {
      const { mountShareModal } = await import('/src/local/shareWorkspaceProbe.js');
      const owner = who === 'owner' ? me : other;
      mountShareModal({
        board: { id: '00000000-0000-4000-8000-00000000b0a4', name: 'Studio', workspace_id: 'ws-x' },
        workspace: { id: 'ws-x', name: 'Team space', created_by: owner },
        workspaceMembers: [
          { user_id: owner, role: 'owner' },
          ...(who === 'coowner' ? [{ user_id: me, role: 'coowner' }] : []),
          { user_id: '00000000-0000-4000-8000-0000000000cc', role: 'editor' },
        ],
        selfUserId: me,
        myWorkspaceRole: who === 'owner' ? 'owner' : 'coowner',
        canManage: true,
        scope: 'workspace',
      });
    }, { me: ME, other: OTHER, who });

    const modal = page.locator('.share-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#share-title .share-title-verb')).toHaveText('Share workspace');
    await expect(modal.locator('#share-title .share-title-name')).toHaveText('“Team space”');
    // The invitation's reach is its own choice, and a workspace panel starts on it.
    await expect(modal.getByRole('button', { name: 'Whole workspace' })).toHaveAttribute('aria-pressed', 'true');
    await expect(modal.locator('select[aria-label="Access level for invitees"]')).toHaveValue('editor');

    // The editor's row: one dropdown. Both can remove them; only the owner
    // can hand over.
    const editorRow = modal.locator('.share-row', { has: page.locator('select', { has: page.locator('option[value="__remove"]') }) });
    const access = editorRow.locator('select');
    await expect(access).toHaveValue('editor');
    await expect(access.locator('option[value="__remove"]')).toHaveText('Remove from workspace…');
    await expect(access.locator('option[value="__owner"]')).toHaveCount(who === 'owner' ? 1 : 0);
  });
}

test('a cluster-scoped Share panel still starts on this cluster', async ({ page }) => {
  await boot(page);
  await page.evaluate(async ({ me }) => {
    const { mountShareModal } = await import('/src/local/shareWorkspaceProbe.js');
    mountShareModal({
      board: { id: '00000000-0000-4000-8000-00000000b0a4', name: 'Studio', workspace_id: 'ws-x' },
      workspace: { id: 'ws-x', name: 'Team space', created_by: me },
      workspaceMembers: [{ user_id: me, role: 'owner' }],
      selfUserId: me,
      canManage: true,
    });
  }, { me: ME });
  const modal = page.locator('.share-modal');
  await expect(modal.locator('#share-title .share-title-verb')).toHaveText('Share');
  await expect(modal.locator('#share-title .share-title-name')).toHaveText('“Studio”');
  await expect(modal.locator('select[aria-label="Access level for invitees"]')).toHaveValue('editor');
  await expect(modal.getByRole('button', { name: 'This cluster' })).toHaveAttribute('aria-pressed', 'true');
});

test('handing a workspace over warns that limits follow the new owner, and offers co-owner instead', async ({ page }) => {
  await boot(page);
  await page.evaluate(async ({ me }) => {
    const { mountShareModal } = await import('/src/local/shareWorkspaceProbe.js');
    mountShareModal({
      board: { id: '00000000-0000-4000-8000-00000000b0a4', name: 'Studio', workspace_id: 'ws-x' },
      workspace: { id: 'ws-x', name: 'Team space', created_by: me },
      workspaceMembers: [
        { user_id: me, role: 'owner' },
        { user_id: '00000000-0000-4000-8000-0000000000cc', role: 'editor' },
      ],
      selfUserId: me,
      myWorkspaceRole: 'owner',
      canManage: true,
    });
  }, { me: ME });
  const editorRow = page.locator('.share-modal .share-row', { has: page.locator('option[value="__owner"]') });
  await editorRow.locator('select').selectOption('__owner');
  const dialog = page.locator('.feedback-actions').locator('..');
  await expect(dialog).toContainText("plan instead of yours");
  await expect(dialog).toContainText('make them a co-owner instead');
  await expect(page.getByRole('button', { name: 'Make co-owner instead' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transfer ownership' })).toBeVisible();
});

// ---- finding a workspace by person ------------------------------------------

const SAM = '00000000-0000-4000-8000-0000000000c1';
const MAYA = '00000000-0000-4000-8000-0000000000c2';
const JUN = '00000000-0000-4000-8000-0000000000c3';
const RAE = '00000000-0000-4000-8000-0000000000c4';
const PROFILES = [
  { user_id: SAM, display_name: 'Sam Lee', color: '#4f8df8', avatar_url: null },
  { user_id: MAYA, display_name: 'Maya Ortiz', color: '#8e5cf7', avatar_url: null },
  { user_id: JUN, display_name: 'Jun Park', color: '#2fa36b', avatar_url: null },
  { user_id: RAE, display_name: 'Rae Okafor', color: '#d9602e', avatar_url: null },
];
const sh = (id, name, by, day) => ({ id, name, created_by: by, _myRole: 'editor', _joinedAt: `2026-03-${day}` });
// Yours (one default-named, two named) and nine shared from four people.
const MANY = [
  { id: 'ws-mine', name: 'Personal Workspace', created_by: ME, created_at: '2026-01-01' },
  { id: 'ws-m2', name: 'Studio', created_by: ME, created_at: '2026-01-02' },
  { id: 'ws-m3', name: 'Archive', created_by: ME, created_at: '2026-01-03' },
  sh('ws-s1', 'Personal Workspace', MAYA, '10'),
  sh('ws-s2', 'Midnight Diner', MAYA, '09'),
  sh('ws-s3', 'Personal Workspace', MAYA, '08'),
  sh('ws-s4', 'Personal Workspace', SAM, '07'),
  sh('ws-s5', 'Reels', SAM, '06'),
  sh('ws-s6', 'Personal Workspace', JUN, '05'),
  sh('ws-s7', 'Dailies', JUN, '04'),
  sh('ws-s8', 'Personal Workspace', RAE, '03'),
  sh('ws-s9', 'Personal Workspace', RAE, '02'),
];

async function bootMany(page) {
  await page.route('**/rest/v1/member_profiles**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(PROFILES),
  }));
  await boot(page);
  await page.evaluate(async ({ workspaces, me }) => {
    const { mountWorkspaceMenu } = await import('/src/local/shareWorkspaceProbe.js');
    mountWorkspaceMenu({ workspaces, activeWorkspaceId: 'ws-mine', personalWorkspaceId: 'ws-mine', selfUserId: me });
  }, { workspaces: MANY, me: ME });
}
const idOf = async (wrap) => (await wrap.locator('.ws-menu-row').getAttribute('id')).replace(/^.*?-ws-/, '');

test('12 workspaces: titled and searched by person', async ({ page }) => {
  await bootMany(page);
  const find = page.getByPlaceholder('Find a workspace or person…');
  await expect(find).toBeVisible();

  // An unnamed shared workspace is its owner's; a renamed one says who owns it.
  const sam = page.locator('.ws-menu-row-wrap', { has: page.locator('.ws-menu-name', { hasText: "Sam Lee's workspace" }) });
  await expect(sam.locator('.ws-menu-sub')).toHaveText('Shared with you');
  await expect(rowFor(page, 'Midnight Diner').locator('.ws-menu-sub')).toHaveText('Owned by Maya Ortiz');

  await find.fill('maya');
  const rows = page.locator('.ws-menu-row-wrap');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('.ws-menu-row')).toHaveClass(/is-kb/);
  await expect(rows.nth(1).locator('.ws-menu-row')).not.toHaveClass(/is-kb/);

  await find.press('ArrowDown');
  await expect(rows.nth(1).locator('.ws-menu-row')).toHaveClass(/is-kb/);
  await expect(rows.nth(0).locator('.ws-menu-row')).not.toHaveClass(/is-kb/);

  const second = await idOf(rows.nth(1));
  await find.press('Enter');
  expect(await page.evaluate(() => window.__shareProbe.select)).toEqual([second]);
});

test('workspace find: Escape clears the text first, then closes; no match says so', async ({ page }) => {
  await bootMany(page);
  const find = page.getByPlaceholder('Find a workspace or person…');
  await find.fill('maya');
  const before = await page.evaluate(() => window.__shareProbe.close);
  await find.press('Escape');
  await expect(find).toHaveValue('');
  await expect(page.locator('.ws-menu')).toBeVisible();
  expect(await page.evaluate(() => window.__shareProbe.close)).toBe(before);
  await find.press('Escape');
  expect(await page.evaluate(() => window.__shareProbe.close)).toBeGreaterThan(before);

  await find.fill('zzz');
  await expect(page.locator('.ws-menu-empty')).toHaveText('No workspace or person matches “zzz”.');
  await expect(page.locator('.ws-menu-row-wrap')).toHaveCount(0);
});
