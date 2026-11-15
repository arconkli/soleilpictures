import { expect, test } from '@playwright/test';
import { bootSignedIn, USER_ID, ORG } from './helpers/signedInStub.js';

// The notifications bell (placement C, owner's pick, 2026-10-21) on the sidebar
// QA harness: the real NotificationsBell in the board's right island after the
// theme switch, with the mockup's five rows (three unread), and the real
// NotificationsPanel under the island. The phone sheet is
// tests/mobile/notifications-bell.spec.js. The last block is the real signed-in
// app with Supabase stubbed (helpers/signedInStub.js): the harness has no team
// rows and no Team page behind them.

async function open(page, query = '') {
  await page.goto(`/?sidebarqa=1${query}`);
  await page.waitForSelector('[data-sidebarqa-ready]');
}
const rect = (loc) => loc.evaluate((el) => el.getBoundingClientRect().toJSON());
const bell = (page) => page.locator('.chrome-right .nb-bell');
const panel = (page) => page.locator('.ntf-shell');

test.describe('the notifications bell', () => {
  test('sits right after Toggle theme and shows the unread count in ink', async ({ page }) => {
    await open(page);
    const b = bell(page);
    await expect(b).toBeVisible();
    await expect(b).toHaveAttribute('aria-label', 'Notifications, 3 unread');
    // Its tooltip is the glass one (lib/looks.js tlTip).
    await expect(b).toHaveAttribute('data-tl-tip', 'Notifications');
    await expect(b).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(b).toHaveAttribute('aria-expanded', 'false');
    await expect(b).toHaveClass(/has-unread/);
    await expect(b.locator('.nb-count')).toHaveText('3');
    // Its neighbour on the left is the theme switch.
    const prev = await b.evaluate((el) => el.previousElementSibling?.getAttribute('aria-label'));
    expect(prev).toBe('Toggle theme');
    // As tall as its neighbours.
    const theme = page.locator('.chrome-right [aria-label="Toggle theme"]');
    expect(Math.round((await rect(b)).height)).toBe(Math.round((await rect(theme)).height));
    // Ink, not gold: the count is the bell's own ink colour.
    const [count, ink] = await b.evaluate((el) => [getComputedStyle(el.querySelector('.nb-count')).color, getComputedStyle(el).color]);
    expect(count).toBe(ink);
  });

  test('a click opens the list under the island, right edges aligned, and pressed', async ({ page }) => {
    await open(page);
    await bell(page).click();
    const p = panel(page);
    await expect(p).toBeVisible();
    await expect(p).toHaveAttribute('role', 'dialog');
    await expect(bell(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(bell(page)).toHaveClass(/is-pressed/);
    await page.waitForTimeout(300);     // the entrance animation scales the box
    const island = await rect(page.locator('.chrome-right'));
    const box = await rect(p);
    expect(Math.abs(box.right - island.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.top - (island.bottom + 8))).toBeLessThanOrEqual(1);
    expect(Math.round(box.width)).toBe(340);
    await expect(p.locator('.ntf-title')).toHaveText('Notifications');
    await expect(p.locator('.ntf-markall')).toHaveText('Mark all read');
    await expect(p.locator('.ntf-x')).toHaveCount(0);          // no × on a desktop
    await expect(p.locator('.ntf-row')).toHaveCount(5);
    await expect(p.locator('.ntf-row.is-unread')).toHaveCount(3);
    // The panel takes focus.
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ntf-panel'))).toBe(true);
  });

  test('Escape closes it and focus goes back to the bell', async ({ page }) => {
    await open(page);
    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.classList.contains('nb-bell'))).toBe(true);
    await expect(bell(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('a click outside closes it; the bell toggles it', async ({ page }) => {
    await open(page);
    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    await page.mouse.click(700, 600);
    await expect(panel(page)).toHaveCount(0);
    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    await bell(page).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test('Mark all read clears the count and goes', async ({ page }) => {
    await open(page);
    await bell(page).click();
    await panel(page).locator('.ntf-markall').click();
    await expect(bell(page).locator('.nb-count')).toHaveCount(0);
    await expect(bell(page)).not.toHaveClass(/has-unread/);
    await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications');
    await expect(panel(page).locator('.ntf-markall')).toHaveCount(0);
    await expect(panel(page).locator('.ntf-row.is-unread')).toHaveCount(0);
  });

  test('with the sidebar folded it still opens under the island', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await page.waitForTimeout(500);
    await bell(page).click();
    await page.waitForTimeout(300);
    const island = await rect(page.locator('.chrome-right'));
    const box = await rect(panel(page));
    expect(Math.abs(box.right - island.right)).toBeLessThanOrEqual(1);
    expect(box.left).toBeGreaterThanOrEqual(16);
  });
  test('with &ntf=reward the invite reward row leads with a quiet +25 mark', async ({ page }) => {
    await open(page, '&ntf=reward');
    await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications, 4 unread');
    await expect(bell(page).locator('.nb-count')).toHaveText('4');
    await bell(page).click();
    const p = panel(page);
    await expect(p).toBeVisible();
    await page.waitForTimeout(300);
    const row = p.locator('.ntf-row').first();
    await expect(row).toHaveAttribute('data-kind', 'invite.reward');
    const earn = row.locator('.ntf-earn');
    await expect(earn).toHaveText('+25');
    // Ink like the title, not the gold of --soleil.
    const [mark, title, gold] = await row.evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--soleil)';
      document.body.appendChild(probe);
      const g = getComputedStyle(probe).color;
      probe.remove();
      return [getComputedStyle(el.querySelector('.ntf-earn')).color, getComputedStyle(el.querySelector('.ntf-row-title')).color, g];
    });
    expect(mark).toBe(title);
    expect(mark).not.toBe(gold);
    // Between the dot and the text.
    const dot = await rect(row.locator('.ntf-dot'));
    const m = await rect(earn);
    const main = await rect(row.locator('.ntf-row-main'));
    expect(m.left).toBeGreaterThanOrEqual(dot.right);
    expect(m.left).toBeLessThan(main.left);
    // Opens Settings on Invite and marks it read.
    await row.click();
    await expect(bell(page).locator('.nb-count')).toHaveText('3');
    expect(await page.evaluate(() => window.__sidebarqaSettings)).toEqual(['invite', undefined]);
  });
});

// The real app, Supabase stubbed: a team.* notice opens the Team page on the tab
// it is about (lib/notificationsBell.js notificationTarget). The harness above
// has no Team page behind its rows.
test.describe('team notices in the bell, on the real app', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  // The signed-in app boots slower than the harness, and more so with workers in parallel.
  const slow = { timeout: 15000 };

  const stamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const notice = (id, kind, title, body) => ({
    id, user_id: USER_ID, kind, title, body, created_at: stamp, read_at: null,
    board_id: null, workspace_id: null, data: { org_id: ORG },
  });
  const TEAM_ROW = { org_id: ORG, name: 'Northlight Films', letter: 'N', color: '#5b8def', role: 'owner', holds_seat: true };
  const GET_TEAM = {
    id: ORG, name: 'Northlight Films', letter: 'N', color: '#5b8def', sample: false, status: 'active',
    me: { id: USER_ID, role: 'owner' },
    admins: [{ id: USER_ID, name: 'Sam Rivera' }],
    people: [{ id: USER_ID, name: 'Sam Rivera', email: 'sam@example.com', role: 'owner', invited: null, color: '#5b8def', where: [], everywhere: true }],
    requests: [], plan: null, storage: null, unpaid: null,
    seats: { bought: 5, used: 1, pending: 0, ceiling: 20 },
    whenFull: { mode: 'auto', monthlyLimit: 4 },
    joining: { link: { on: false, token: null, role: null }, domains: [] },
    workspaces: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Studio work', letter: 'S', color: null, private: false }],
  };
  const GET_BILLING = {
    status: 'active', is_owner: true, seats: 5, plan: 'annual', subscription_status: 'active',
    current_period_end: '2027-01-02T00:00:00Z', trial_end: null, cancel_at_period_end: false,
    auto_added_this_month: 0, storage_used_bytes: 100, storage_quota_bytes: 1e12,
    view_only_since: null, past_due_since: null, grace_ends_at: null,
  };

  async function bootWithNotices(page, rows) {
    await bootSignedIn(page, {
      rpc: { list_my_teams: [TEAM_ROW], get_team: GET_TEAM, get_team_billing: GET_BILLING },
      rest: { notifications: rows },
      functions: { 'team-billing': { ok: false } },
    });
    await expect(page.locator('.nb-bell')).toBeVisible(slow);
  }

  test('a join request opens the Team page on People', async ({ page }) => {
    await bootWithNotices(page, [
      notice('n-team-1', 'team.join_request', 'Lena Fischer asked to edit Studio work', 'Approve or keep her as a viewer.'),
    ]);
    await page.locator('.nb-bell').click();
    await page.locator('.ntf-row[data-kind="team.join_request"]').click();
    const sheet = page.locator('[data-team-page]');
    await expect(sheet.getByRole('heading', { name: 'Northlight Films' })).toBeVisible(slow);
    await expect(sheet.getByRole('tab', { name: /People/ })).toHaveAttribute('aria-selected', 'true');
    // The list closes behind it.
    await expect(page.locator('.ntf-shell')).toHaveCount(0);
  });

  test('a payment problem opens the Team page on Seats & billing', async ({ page }) => {
    await bootWithNotices(page, [
      notice('n-team-2', 'team.payment_failed', 'Northlight Films’ payment didn’t go through', 'Update the card to keep editing.'),
    ]);
    await page.locator('.nb-bell').click();
    await page.locator('.ntf-row[data-kind="team.payment_failed"]').click();
    const sheet = page.locator('[data-team-page]');
    await expect(sheet.getByRole('heading', { name: 'Northlight Films' })).toBeVisible(slow);
    await expect(sheet.getByRole('tab', { name: /Seats & billing/ })).toHaveAttribute('aria-selected', 'true');
  });
});
