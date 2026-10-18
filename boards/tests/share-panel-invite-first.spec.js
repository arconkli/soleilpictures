// The invite-first Share panel, mounted for real through
// src/local/shareWorkspaceProbe.js (local QA mode never mounts ShareModal).
//
// What this pins at runtime, where share-panel-simplicity.spec.js pins source:
//   - focus lands on Copy link (Share → Enter copies), or on Done for a viewer
//   - one gold control at rest, and it moves to Invite once there are addresses
//   - the invitation reward is said under the invite box, in the wording for
//     the tier, with progress once anyone has joined — and never to a viewer
//   - Escape closes; on a phone the footer is on screen with thumb-sized buttons
import { expect, test } from '@playwright/test';
import { inviteRewardCopy, REFERRAL_REWARDS_PER_30_DAYS } from '../src/lib/inviteReward.js';

const ME = '00000000-0000-4000-8000-0000000000aa';
const OWNER = '00000000-0000-4000-8000-0000000000bb';
const OTHER_EDITOR = '00000000-0000-4000-8000-0000000000cc';

async function boot(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForLoadState('domcontentloaded');
}

// Mounts the panel as an editor of someone else's workspace (or a viewer, when
// canManage is false). The props are built inside the page: functions cannot
// cross the evaluate boundary.
async function mountPanel(page, { tier = 'demo', canManage = true, stats = null, members = [] } = {}) {
  await page.evaluate(async ({ me, owner, tier, canManage, stats, members }) => {
    window.__sharePanel = { closed: 0, invites: 0 };
    const { mountShareModal } = await import('/src/local/shareWorkspaceProbe.js');
    mountShareModal({
      board: { id: '00000000-0000-4000-8000-00000000b0a4', name: 'Lookbook final picks', workspace_id: 'ws-x' },
      workspace: { id: 'ws-x', name: 'Team space', created_by: owner },
      workspaceMembers: [{ user_id: owner, role: 'owner' }, ...members],
      selfUserId: me,
      canManage,
      rewardTier: tier,
      loadReferralStats: stats ? async () => stats : null,
      onOpenInvites: () => { window.__sharePanel.invites += 1; },
      onClose: () => { window.__sharePanel.closed += 1; },
    });
  }, { me: ME, owner: OWNER, tier, canManage, stats, members });
  const panel = page.locator('.share-modal');
  await expect(panel).toBeVisible();
  return panel;
}

test('an editor lands on Copy link, the one gold control, under a panel that leads with inviting', async ({ page }) => {
  await boot(page);
  const panel = await mountPanel(page);
  const copy = panel.locator('.share-foot-btn', { hasText: /Copy link|Create link & copy/ });
  await expect(copy).toBeFocused();
  await expect(panel.locator('.share-btn-gold')).toHaveCount(1);
  await expect(copy).toHaveClass(/share-btn-gold/);

  // The invite row, then everyone with access in one list, the link last.
  const invite = await panel.locator('.share-invite').boundingBox();
  const list = await panel.locator('.share-section-title', { hasText: 'Who has access' }).boundingBox();
  expect(invite.y).toBeLessThan(list.y);
  const lastRow = panel.locator('.share-list > .share-row').last();
  await expect(lastRow).toContainText('Anyone with the link');
  await expect(lastRow.locator('select')).toHaveValue('view');

  // The role line explains the picker by name, and follows it. An editor of
  // someone else's workspace can only invite to this cluster, and is told so.
  const hint = panel.locator('.share-role-hint');
  await expect(hint).toContainText('They can add, move and delete cards in “Lookbook final picks”');
  await expect(panel.locator('.share-invite-scope')).toHaveText('this cluster');
  await expect(panel.getByRole('button', { name: 'Whole workspace' })).toHaveCount(0);
  await panel.locator('select[aria-label="Access level for invitees"]').selectOption('viewer');
  await expect(hint).toContainText('can’t change anything');

  // Typing addresses moves the gold to Invite; there is still only one.
  await panel.locator('input[aria-label="Email addresses to invite"]').fill('someone@example.com');
  await expect(panel.locator('.share-btn-gold')).toHaveCount(1);
  await expect(panel.locator('.share-btn-gold')).toHaveText('Invite');
});

test('a free account is told what inviting someone new earns, with progress once anyone joined', async ({ page }) => {
  await boot(page);
  const panel = await mountPanel(page, {
    tier: 'demo',
    stats: { friendsJoined: 3, friendsActivated: 2, pending: 1, cardsEarned: 50, rewardsWaiting: 1 },
  });
  const copy = inviteRewardCopy({ tier: 'demo' });
  const note = panel.locator('.share-reward');
  await expect(note.locator('.share-reward-lead')).toHaveText(copy.lead);
  // The cards are the headline, and at rest the headline is all there is.
  await expect(note.locator('.share-reward-lead')).not.toContainText('GB');
  await expect(note.locator('.share-reward-more')).toHaveCount(0);

  // The rest is one press away: the storage, progress, the fine print, and
  // the way to the full invite page.
  await note.locator('.share-reward-toggle').click();
  await expect(note.locator('.share-reward-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(note.locator('.share-reward-detail')).toHaveText(copy.detail);
  await expect(note.locator('.share-reward-progress')).toHaveText('3 joined through you · 50 free cards earned · 1 on the way');
  await expect(note.locator('.share-reward-more')).toContainText(`Up to ${REFERRAL_REWARDS_PER_30_DAYS} rewards in any 30 days`);
  await note.getByRole('button', { name: /Your invites/ }).click();
  expect(await page.evaluate(() => window.__sharePanel.invites)).toBe(1);
});

test("a Creator's headline is the same: you both get the free cards, storage second", async ({ page }) => {
  await boot(page);
  const panel = await mountPanel(page, { tier: 'paid' });
  const copy = inviteRewardCopy({ tier: 'paid' });
  await expect(panel.locator('.share-reward-lead')).toHaveText(copy.lead);
  await expect(panel.locator('.share-reward-lead')).toContainText('you both get');
  await expect(panel.locator('.share-reward-lead')).not.toContainText('GB');
  await panel.locator('.share-reward-toggle').click();
  await expect(panel.locator('.share-reward-detail')).toContainText('more storage');
  // No stats loader, no progress line.
  await expect(panel.locator('.share-reward-progress')).toHaveCount(0);
});

test('a viewer sees who has access and a Done button, and nothing to invite or copy', async ({ page }) => {
  await boot(page);
  const panel = await mountPanel(page, { canManage: false, members: [{ user_id: OTHER_EDITOR, role: 'editor' }] });
  // A member a manager could change shows a viewer only what they can do.
  const editorRow = panel.locator('.share-row', { hasText: 'Workspace · can edit' });
  await expect(editorRow).toHaveCount(1);
  await expect(editorRow.locator('select')).toHaveCount(0);
  await expect(panel.locator('.share-foot-done')).toBeFocused();
  await expect(panel.locator('.share-reward')).toHaveCount(0);
  await expect(panel.locator('input[aria-label="Email addresses to invite"]')).toHaveCount(0);
  await expect(panel.locator('.share-foot-btn')).toHaveCount(1);   // Done alone
  await expect(panel.locator('.share-btn-gold')).toHaveCount(0);
  await expect(panel.locator('.share-section-title').first()).toHaveText(/^Who has access · \d+$/);
  // Read-only rows: labels, never dropdowns, and no link row.
  await expect(panel.locator('.share-list select')).toHaveCount(0);
  await expect(panel.locator('.share-row-link')).toHaveCount(0);
});

test('the reach of an invitation is one click, and the line under it says what it means', async ({ page }) => {
  await boot(page);
  // As the owner, who may hand out the whole workspace.
  await page.evaluate(async ({ me }) => {
    window.__sharePanel = { closed: 0, invites: 0 };
    const { mountShareModal } = await import('/src/local/shareWorkspaceProbe.js');
    mountShareModal({
      board: { id: '00000000-0000-4000-8000-00000000b0a4', name: 'Lookbook final picks', workspace_id: 'ws-x' },
      workspace: { id: 'ws-x', name: 'Team space', created_by: me },
      workspaceMembers: [{ user_id: me, role: 'owner' }],
      selfUserId: me, canManage: true, rewardTier: 'demo',
    });
  }, { me: ME });
  const panel = page.locator('.share-modal');
  const thisCluster = panel.getByRole('button', { name: 'This cluster' });
  const whole = panel.getByRole('button', { name: 'Whole workspace' });
  const hint = panel.locator('.share-role-hint');
  await expect(thisCluster).toHaveAttribute('aria-pressed', 'true');
  await expect(hint).toContainText('in “Lookbook final picks” and its sub-clusters');
  await whole.click();
  await expect(whole).toHaveAttribute('aria-pressed', 'true');
  await expect(thisCluster).toHaveAttribute('aria-pressed', 'false');
  await expect(hint).toContainText('every cluster in “Team space”');
  await panel.locator('select[aria-label="Access level for invitees"]').selectOption('viewer');
  await expect(hint).toContainText('can open every cluster in “Team space”');
});

test('Escape closes the panel', async ({ page }) => {
  await boot(page);
  await mountPanel(page);
  await expect(page.locator('.share-foot-btn').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__sharePanel.closed)).toBe(1);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the footer stays on screen with thumb-sized buttons', async ({ page }) => {
    await boot(page);
    const panel = await mountPanel(page);
    const foot = panel.locator('.share-foot');
    await expect(foot).toBeVisible();
    // The panel rises in with a transform; measure once it has landed.
    await expect.poll(() => panel.evaluate((el) => el.getAnimations().length)).toBe(0);
    const box = await foot.boundingBox();
    const vh = await page.evaluate(() => window.innerHeight);
    expect(box.y + box.height).toBeLessThanOrEqual(vh + 0.5);
    for (const b of await panel.locator('.share-foot-btn').all()) {
      expect(await b.evaluate((el) => el.offsetHeight)).toBeGreaterThanOrEqual(44);
    }
    // The body above it is the one scroller; the footer is not inside it.
    expect(await panel.locator('.share-body .share-foot').count()).toBe(0);
  });
});

test("each row's one dropdown reaches that row's actions", async ({ page }) => {
  // Shares and invitations come from RPCs; answer them with fixtures.
  const U2 = '00000000-0000-4000-8000-0000000000b2';
  await page.route('https://example.supabase.co/rest/v1/rpc/**', (route) => {
    const name = route.request().url().split('/rpc/')[1].split('?')[0];
    const rows = {
      list_board_shares: [{ user_id: U2, email: 'maria@studio.com', role: 'editor', invited_by: ME }],
      list_pending_invites_for_board: [
        { id: 'p1', email: 'dana@freelance.net', role: 'viewer', invited_by: ME, created_at: '2026-10-15T00:00:00Z' },
      ],
    }[name] ?? [];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await boot(page);
  await page.evaluate(async ({ me }) => {
    const { mountShareModal } = await import('/src/local/shareWorkspaceProbe.js');
    mountShareModal({
      board: { id: '00000000-0000-4000-8000-00000000b0a4', name: 'Lookbook final picks', workspace_id: 'ws-x' },
      workspace: { id: 'ws-x', name: 'Team space', created_by: me },
      workspaceMembers: [{ user_id: me, role: 'owner' }],
      selfUserId: me, canManage: true, rewardTier: 'demo',
    });
  }, { me: ME });
  const panel = page.locator('.share-modal');
  const maria = panel.locator('.share-row', { hasText: 'maria@studio.com' });
  await expect(maria.locator('.share-row-sub')).toContainText('this cluster');
  const pick = maria.locator('select');
  await expect(pick).toHaveValue('editor');

  // Widening to the whole workspace asks first, in plain words.
  await pick.selectOption('workspace');
  await expect(page.locator('.feedback-actions').locator('..')).toContainText('every cluster in "Team space"');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(pick).toHaveValue('editor');   // a cancelled choice leaves the row as it was

  // Removing asks first, and says it can be undone.
  await pick.selectOption('__remove');
  await expect(page.locator('.feedback-actions').locator('..')).toContainText("Remove maria@studio.com's access?");
  await page.getByRole('button', { name: 'Cancel' }).click();

  // A pending invitation's row revokes from the same place.
  const dana = panel.locator('.share-row', { hasText: 'dana@freelance.net' });
  await expect(dana.locator('select')).toHaveValue('invited');
  await expect(dana.locator('option[value="invited"]')).toHaveText('Invited · can view');
  await dana.locator('select').selectOption('__revoke');
  await expect(page.locator('.feedback-actions').locator('..')).toContainText('Revoke invite to dana@freelance.net?');
});
