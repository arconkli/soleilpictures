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
    await expect(modal.locator('.share-eyebrow').first()).toHaveText('SHARE WORKSPACE');
    await expect(modal.locator('#share-title')).toHaveText('Team space');
    await expect(modal.locator('select[aria-label="Access level for invitees"]')).toHaveValue('workspace');

    // The editor's row: both can remove them; only the owner can hand over.
    const editorRow = modal.locator('.share-row', { hasText: 'Member — can edit every cluster' });
    await expect(editorRow.getByRole('button', { name: 'Remove' })).toBeVisible();
    await expect(editorRow.getByRole('button', { name: 'Make owner' })).toHaveCount(who === 'owner' ? 1 : 0);
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
  await expect(modal.locator('.share-eyebrow').first()).toHaveText('SHARE');
  await expect(modal.locator('#share-title')).toHaveText('Studio');
  await expect(modal.locator('select[aria-label="Access level for invitees"]')).toHaveValue('editor');
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
  const editorRow = page.locator('.share-modal .share-row', { hasText: 'Member — can edit every cluster' });
  await editorRow.getByRole('button', { name: 'Make owner' }).click();
  const dialog = page.locator('.feedback-actions').locator('..');
  await expect(dialog).toContainText("plan instead of yours");
  await expect(dialog).toContainText('make them a co-owner instead');
  await expect(page.getByRole('button', { name: 'Make co-owner instead' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transfer ownership' })).toBeVisible();
});
