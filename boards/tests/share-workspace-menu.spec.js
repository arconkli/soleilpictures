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
