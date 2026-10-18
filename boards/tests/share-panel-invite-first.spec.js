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

async function boot(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForLoadState('domcontentloaded');
}

// Mounts the panel as an editor of someone else's workspace (or a viewer, when
// canManage is false). The props are built inside the page: functions cannot
// cross the evaluate boundary.
async function mountPanel(page, { tier = 'demo', canManage = true, stats = null } = {}) {
  await page.evaluate(async ({ me, owner, tier, canManage, stats }) => {
    window.__sharePanel = { closed: 0, invites: 0 };
    const { mountShareModal } = await import('/src/local/shareWorkspaceProbe.js');
    mountShareModal({
      board: { id: '00000000-0000-4000-8000-00000000b0a4', name: 'Lookbook final picks', workspace_id: 'ws-x' },
      workspace: { id: 'ws-x', name: 'Team space', created_by: owner },
      workspaceMembers: [{ user_id: owner, role: 'owner' }],
      selfUserId: me,
      canManage,
      rewardTier: tier,
      loadReferralStats: stats ? async () => stats : null,
      onOpenInvites: () => { window.__sharePanel.invites += 1; },
      onClose: () => { window.__sharePanel.closed += 1; },
    });
  }, { me: ME, owner: OWNER, tier, canManage, stats });
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

  // Invite people, then who has access, then link access.
  const titles = await panel.locator('.share-body .share-section-title').allTextContents();
  expect(titles[0]).toBe('Invite people');
  expect(titles[1]).toMatch(/^People with access · \d+$/);
  expect(titles[2]).toBe('Link access');

  // The role line explains the picker, and follows it.
  const hint = panel.locator('.share-role-hint');
  await expect(hint).toContainText('Can add, move and delete cards');
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
  await expect(note.locator('.share-reward-detail')).toHaveText(copy.detail);
  await expect(note.locator('.share-reward-progress')).toHaveText('3 joined through you · 50 free cards earned · 1 on the way');
  // The cards are the headline; the storage rides in the second line.
  await expect(note.locator('.share-reward-lead')).not.toContainText('GB');

  // The fine print is one press away, and leads to the full invite page.
  await expect(note.locator('.share-reward-how li').first()).toBeHidden();
  await note.locator('.share-reward-how summary').click();
  await expect(note.locator('.share-reward-how')).toContainText(`Up to ${REFERRAL_REWARDS_PER_30_DAYS} rewards in any 30 days`);
  await note.getByRole('button', { name: /Your invites/ }).click();
  expect(await page.evaluate(() => window.__sharePanel.invites)).toBe(1);
});

test("a Creator's headline is the friend's free cards, and the storage comes second", async ({ page }) => {
  await boot(page);
  const panel = await mountPanel(page, { tier: 'paid' });
  const copy = inviteRewardCopy({ tier: 'paid' });
  await expect(panel.locator('.share-reward-lead')).toHaveText(copy.lead);
  await expect(panel.locator('.share-reward-lead')).toContainText('they get');
  await expect(panel.locator('.share-reward-lead')).not.toContainText('GB');
  await expect(panel.locator('.share-reward-detail')).toContainText('more storage');
  // No stats loader, no progress line.
  await expect(panel.locator('.share-reward-progress')).toHaveCount(0);
});

test('a viewer sees who has access and a Done button, and nothing to invite or copy', async ({ page }) => {
  await boot(page);
  const panel = await mountPanel(page, { canManage: false });
  await expect(panel.locator('.share-foot-done')).toBeFocused();
  await expect(panel.locator('.share-reward')).toHaveCount(0);
  await expect(panel.locator('input[aria-label="Email addresses to invite"]')).toHaveCount(0);
  await expect(panel.locator('.share-foot-btn')).toHaveCount(1);   // Done alone
  await expect(panel.locator('.share-btn-gold')).toHaveCount(0);
  await expect(panel.locator('.share-section-title').first()).toHaveText(/^People with access · \d+$/);
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
