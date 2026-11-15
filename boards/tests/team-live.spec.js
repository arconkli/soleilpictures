// team-live.spec.js — the Team plan's real paths (Team S4 Task 10), on the REAL
// signed-in app with every Supabase request stubbed (helpers/signedInStub.js).
// `?local=1` renders a harness that never runs App, so it can't reach these.
// Held by teamsAllowed(), which is true on the dev server. Nothing leaves the
// machine: the stub aborts every host but its own.
//
// The invite box is on the Joining tab (the "Invite people" button opens it).
// The page's tabs are People · Workspaces · Seats & billing · Joining for the
// owner and admins, People · Workspaces for a member. Removing a person waits
// UNDO_MS for an Undo (page.clock jumps it).
import { test, expect as baseExpect } from '@playwright/test';
import { bootSignedIn, USER_ID, WS_ID, ORG } from './helpers/signedInStub.js';
import { UNDO_MS } from '../src/lib/teamPendingRemovals.js';

// The stubbed app reaches the Team plan several seconds after the boot
// (list_my_teams and lib/teamBoot.js load once the workspace is up), past
// expect's default 5s, so this file waits longer.
const expect = baseExpect.configure({ timeout: 15000 });

const TOKEN = '5b1f0c3e-7a2d-4e8b-9c4a-1d2e3f4a5b6c';
const NEW_WS = '66666666-6666-4666-8666-666666666666';
const NEW_ROOT = '77777777-7777-4777-8777-777777777777';
const SHELL = '.sb-ws-trigger';

const teamRow = (role = 'owner') => ({
  org_id: ORG, name: 'Northlight Films', letter: 'N', color: '#5b8def', role, holds_seat: true,
});

// get_team / get_team_billing in the shapes lib/teamSnapshot.test.mjs uses.
const GET_TEAM = {
  id: ORG, name: 'Northlight Films', letter: 'N', color: '#5b8def', sample: false, status: 'active',
  me: { id: USER_ID, role: 'owner' },
  admins: [{ id: USER_ID, name: 'Sam Rivera' }],
  people: [
    { id: USER_ID, name: 'Sam Rivera', email: 'sam@example.com', role: 'owner', invited: null, color: '#5b8def', where: [], everywhere: true },
    { id: '88888888-8888-4888-8888-888888888888', name: 'Priya Nair', email: 'priya@example.com', role: 'member', invited: null, color: '#d9822b', where: ['Studio work'], everywhere: false },
  ],
  requests: [], plan: null, storage: null, unpaid: null,
  seats: { bought: 5, used: 2, pending: 0, ceiling: 20 },
  whenFull: { mode: 'auto', monthlyLimit: 4 },
  joining: { link: { on: false, token: null, role: null }, domains: [] },
  workspaces: [{ id: WS_ID, name: 'Studio work', letter: 'S', color: null, private: false }],
};
const GET_BILLING = {
  status: 'active', is_owner: true, seats: 5, plan: 'annual', subscription_status: 'active',
  current_period_end: '2027-01-02T00:00:00Z', trial_end: null, cancel_at_period_end: false,
  auto_added_this_month: 0, storage_used_bytes: 100, storage_quota_bytes: 1e12,
  view_only_since: null, past_due_since: null, grace_ends_at: null,
};

const JOINED_LINE = 'You’re in Northlight Films. Its workspaces are in your workspace menu.';

// The toast's own span: the app also echoes each toast into a sr-only live region.
const toast = (page, text) => page.locator('.toast-msg', { hasText: text });

const only = (calls, path) => calls.filter((c) => c.path === path);

const PRIYA = '88888888-8888-4888-8888-888888888888';

// get_team the way the server answers it after remove_from_team: whoever was
// removed is gone from the next read.
function removableTeam(base = GET_TEAM) {
  const gone = new Set();
  return {
    get_team: () => ({ ...base, people: base.people.filter((p) => !gone.has(p.id)) }),
    remove_from_team: (body) => { gone.add(body.p_user_id); return null; },
  };
}

test.describe('Team plan on the real app, Supabase stubbed', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the team page shows the real team and invites by email', async ({ page }) => {
    const { calls } = await bootSignedIn(page, {
      path: '/team',
      rpc: {
        list_my_teams: [teamRow('owner')],
        get_team: GET_TEAM,
        get_team_billing: GET_BILLING,
        invite_to_team: { invited: ['lena@example.com'], already: [], skipped: [] },
      },
    });
    const sheet = page.locator('[data-team-page]');
    await expect(sheet.getByRole('heading', { name: 'Northlight Films' })).toBeVisible();
    await expect(sheet.getByText('Priya Nair')).toBeVisible();
    await expect(page.getByText('Preview:')).toHaveCount(0);

    await sheet.getByRole('button', { name: 'Invite people' }).click();
    await sheet.getByLabel('Email addresses').fill('lena@example.com');
    await sheet.getByRole('button', { name: 'Send invites' }).click();

    await expect.poll(() => only(calls, 'rpc/invite_to_team').length).toBe(1);
    const body = only(calls, 'rpc/invite_to_team')[0].body;
    expect(body.p_org_id).toBe(ORG);
    expect(body.p_emails).toContain('lena@example.com');
    await expect(toast(page, '1 invite sent.')).toBeVisible();
    await expect(page.getByText('Preview:')).toHaveCount(0);
  });

  test('setup asks the server for seats and goes to Stripe', async ({ page }) => {
    const { calls } = await bootSignedIn(page, {
      path: '/team/new',
      rpc: { list_my_teams: [], preview_team_seats: 5 },
      rest: { workspaces: [{ id: WS_ID, name: 'Studio work', created_at: '2026-10-01T00:00:00Z' }] },
      functions: { 'team-billing': { ok: true, url: '/?stripe-stub=1' } },
    });
    await page.getByLabel('Team name').fill('Northlight Films');
    await expect(page.getByRole('checkbox', { name: /Studio work/ })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => only(calls, 'rpc/preview_team_seats').length).toBeGreaterThan(0);
    const cont = page.getByRole('button', { name: 'Continue', exact: true });
    await expect(cont).toBeEnabled();
    // The seat answer lands after a 300 ms settle; the seats step reads it.
    await page.waitForTimeout(600);
    await cont.click();

    await expect(page.getByText('5 people edit these workspaces today', { exact: false })).toBeVisible();
    await expect(page.locator('[data-seats]')).toHaveText('5');
    await expect(page.getByRole('button', { name: 'One fewer seat' })).toBeDisabled();

    await page.getByRole('button', { name: /Continue to payment/ }).click();
    await page.waitForURL(/stripe-stub=1/);

    const checkout = only(calls, 'functions/team-billing').find((c) => c.body?.action === 'checkout');
    expect(checkout).toBeTruthy();
    expect(checkout.body.name).toBe('Northlight Films');
    expect(checkout.body.workspace_ids).toEqual([WS_ID]);
    expect(checkout.body.seats).toBe(5);
    expect(checkout.body.plan).toBe('annual');
  });

  // Settings › Preview walks an admin through buying Team on the sample team.
  // The press leaves for /pricing with Settings still open: closing it first
  // rewound the history entry Settings keeps for Back (lib/modalGuard.js), and
  // that rewind cancelled the trip, so the press did nothing (the owner,
  // 2026-10-27).
  test('Settings › Preview › Walk through buying it: pricing, the sample setup, then the team page', async ({ page }) => {
    const { calls } = await bootSignedIn(page);
    await page.waitForSelector(SHELL);
    await page.locator('button[aria-label="Settings"]').first().click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('tab', { name: 'Preview' }).click();
    await settings.getByRole('button', { name: 'Walk through buying it' }).click();

    await page.waitForURL((u) => u.pathname === '/pricing');
    await page.locator('.pp-plan-team').getByRole('button', { name: 'Start a Team trial' }).click();

    await page.waitForURL((u) => u.pathname === '/team/new');
    await expect(page.getByLabel('Team name')).toHaveValue('Northlight Films');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: /Continue to payment/ }).click();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.getByRole('button', { name: 'Open the team page' }).click();

    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.getByRole('heading', { name: 'Northlight Films' })).toBeVisible();
    // The sample is look only: nothing was billed or sent.
    expect(only(calls, 'functions/team-billing')).toEqual([]);
  });

  test('a team link, already signed in: the card asks, Join joins', async ({ page }) => {
    const { calls } = await bootSignedIn(page, {
      path: `/?teamjoin=${TOKEN}`,
      rpc: {
        peek_team_link: [{ status: 'ok', team_name: 'Northlight Films', role: 'member' }],
        claim_team_link: [{ org_id: ORG, role: 'member', status: 'joined' }],
        list_my_teams: [teamRow('member')],
      },
    });
    await expect(page.getByText('Join “Northlight Films”.')).toBeVisible();
    expect(new URL(page.url()).searchParams.has('teamjoin')).toBe(false);
    expect(only(calls, 'rpc/claim_team_link')).toHaveLength(0);

    await page.getByRole('button', { name: 'Join Northlight Films' }).click();
    await expect.poll(() => only(calls, 'rpc/claim_team_link').length).toBe(1);
    expect(only(calls, 'rpc/claim_team_link')[0].body.p_token).toBe(TOKEN);

    // Joining reloads; App toasts the note the card left behind.
    await expect(toast(page, JOINED_LINE)).toBeVisible();
    expect(only(calls, 'rpc/claim_team_link')).toHaveLength(1);
  });

  test('an email invite is accepted when the app opens', async ({ page }) => {
    const { calls } = await bootSignedIn(page, {
      path: `/?teaminvite=${TOKEN}`,
      rpc: {
        accept_team_invite: [{ org_id: ORG, role: 'member', status: 'joined' }],
        list_my_teams: [teamRow('member')],
      },
    });
    await expect(toast(page, JOINED_LINE)).toBeVisible();
    const accepts = only(calls, 'rpc/accept_team_invite');
    expect(accepts).toHaveLength(1);
    expect(accepts[0].body.p_token).toBe(TOKEN);
  });

  test('an invite for another email says so', async ({ page }) => {
    await bootSignedIn(page, {
      path: `/?teaminvite=${TOKEN}`,
      rpc: {
        accept_team_invite: { status: 403, body: { code: '42501', message: 'this invite is for a different email' } },
      },
    });
    await expect(toast(page, 'That team invite went to a different email address. Sign out, then sign in with that address to join.')).toBeVisible();
  });

  test('a verified company domain joins without asking, once', async ({ page }) => {
    const offer = { org_id: ORG, name: 'Northlight Films', letter: 'N', color: '#5b8def', mode: 'auto' };
    const { calls } = await bootSignedIn(page, {
      rpc: {
        my_team_offers: [offer],
        answer_team_offer: [{ org_id: ORG, role: 'member', status: 'joined' }],
        list_my_teams: [teamRow('member')],
      },
    });
    await expect(toast(page, 'your company’s team')).toBeVisible();
    const answers = only(calls, 'rpc/answer_team_offer');
    expect(answers).toHaveLength(1);
    expect(answers[0].body).toMatchObject({ p_org_id: ORG, p_join: true });
  });

  const askOffer = { org_id: ORG, name: 'Northlight Films', letter: 'N', color: '#5b8def', mode: 'ask' };

  test('an offer that asks shows the corner note, and Join answers yes', async ({ page }) => {
    const { calls } = await bootSignedIn(page, {
      rpc: {
        my_team_offers: [askOffer],
        answer_team_offer: [{ org_id: ORG, role: 'member', status: 'joined' }],
        list_my_teams: [teamRow('member')],
      },
    });
    const note = page.getByRole('dialog', { name: 'Join Northlight Films?' });
    await expect(note).toContainText('Northlight Films uses your company’s email');
    expect(only(calls, 'rpc/answer_team_offer')).toHaveLength(0);
    await note.getByRole('button', { name: 'Join Northlight Films' }).click();
    await expect(note).toHaveCount(0);
    await expect(toast(page, 'your company’s team')).toBeVisible();
    const answers = only(calls, 'rpc/answer_team_offer');
    expect(answers).toHaveLength(1);
    expect(answers[0].body).toMatchObject({ p_org_id: ORG, p_join: true });
  });

  test('No thanks answers no, quietly', async ({ page }) => {
    const { calls } = await bootSignedIn(page, {
      rpc: { my_team_offers: [askOffer], answer_team_offer: [{ org_id: ORG, role: null, status: 'declined' }] },
    });
    const note = page.getByRole('dialog', { name: 'Join Northlight Films?' });
    await note.getByRole('button', { name: 'No thanks' }).click();
    await expect(note).toHaveCount(0);
    await expect.poll(() => only(calls, 'rpc/answer_team_offer').length).toBe(1);
    expect(only(calls, 'rpc/answer_team_offer')[0].body).toMatchObject({ p_org_id: ORG, p_join: false });
  });

  const openNewWorkspace = async (page) => {
    await page.locator(SHELL).click();
    await page.getByRole('button', { name: /New workspace/ }).first().click();
  };

  test('new workspace asks who it is for', async ({ page }) => {
    const { calls } = await bootSignedIn(page, {
      rpc: {
        list_my_teams: [teamRow('member')],
        create_team_workspace: { workspace_id: NEW_WS, root_board_id: NEW_ROOT },
      },
    });
    await page.waitForSelector(SHELL);
    await openNewWorkspace(page);

    const dialog = page.getByRole('dialog', { name: 'New workspace' });
    await expect(dialog.getByText('Who is it for?')).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Northlight Films/ })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Just me/ })).toBeVisible();
    await expect(dialog.getByRole('switch', { name: 'Private' })).toHaveCount(0);

    await dialog.getByRole('radio', { name: /Northlight Films/ }).click();
    await dialog.getByLabel('Name').fill('Trailers');
    await dialog.getByRole('button', { name: 'Create workspace' }).click();

    await expect.poll(() => only(calls, 'rpc/create_team_workspace').length).toBe(1);
    expect(only(calls, 'rpc/create_team_workspace')[0].body)
      .toEqual({ p_org_id: ORG, p_name: 'Trailers', p_root_name: 'Studio', p_private: false });
  });

  test('an admin sees the Private switch on a new team workspace', async ({ page }) => {
    await bootSignedIn(page, { rpc: { list_my_teams: [teamRow('admin')] } });
    await page.waitForSelector(SHELL);
    await openNewWorkspace(page);
    const dialog = page.getByRole('dialog', { name: 'New workspace' });
    await dialog.getByRole('radio', { name: /Northlight Films/ }).click();
    await expect(dialog.getByRole('switch', { name: 'Private' })).toBeVisible();
  });

  // ── The page's tabs, and the Workspaces tab ──────────────────────────────

  test('the owner has four tabs on a real team', async ({ page }) => {
    await bootSignedIn(page, {
      path: '/team',
      rpc: { list_my_teams: [teamRow('owner')], get_team: GET_TEAM, get_team_billing: GET_BILLING },
    });
    const sheet = page.locator('[data-team-page]');
    await expect(sheet.getByRole('heading', { name: 'Northlight Films' })).toBeVisible();
    await expect(sheet.getByRole('tab')).toHaveText([/^People/, /^Workspaces/, /^Seats & billing/, /^Joining/]);
  });

  test('a member has People and Workspaces, and no Private switch', async ({ page }) => {
    await bootSignedIn(page, {
      path: '/team',
      rpc: {
        list_my_teams: [teamRow('member')],
        get_team: { ...GET_TEAM, me: { id: USER_ID, role: 'member' } },
      },
    });
    const sheet = page.locator('[data-team-page]');
    await expect(sheet.getByRole('heading', { name: 'Northlight Films' })).toBeVisible();
    await expect(sheet.getByRole('tab')).toHaveText([/^People/, /^Workspaces/]);
    await sheet.getByRole('tab', { name: /Workspaces/ }).click();
    await expect(sheet.getByText('Studio work')).toBeVisible();
    await expect(sheet.getByRole('switch')).toHaveCount(0);
  });

  test('Make private asks first: Cancel sends nothing, Make it private sends it once', async ({ page }) => {
    const { calls } = await bootSignedIn(page, {
      path: '/team',
      rpc: { list_my_teams: [teamRow('owner')], get_team: GET_TEAM, get_team_billing: GET_BILLING },
    });
    const sheet = page.locator('[data-team-page]');
    await sheet.getByRole('tab', { name: /Workspaces/ }).click();
    const sw = sheet.getByRole('switch', { name: 'Studio work is private' });
    await expect(sw).toHaveAttribute('aria-checked', 'false');

    await sw.click();
    const confirm = sheet.getByRole('alertdialog');
    await expect(confirm).toContainText('Make Studio work private?');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(only(calls, 'rpc/set_team_workspace_private')).toHaveLength(0);
    await expect(sw).toHaveAttribute('aria-checked', 'false');

    await sw.click();
    await sheet.getByRole('alertdialog').getByRole('button', { name: 'Make it private' }).click();
    await expect.poll(() => only(calls, 'rpc/set_team_workspace_private').length).toBe(1);
    expect(only(calls, 'rpc/set_team_workspace_private')[0].body).toEqual({ p_workspace_id: WS_ID, p_private: true });
  });

  // ── Removing a person waits for an Undo ──────────────────────────────────

  const removePriya = async (sheet) => {
    await sheet.getByRole('button', { name: 'More for Priya Nair' }).click();
    await sheet.getByRole('menuitem', { name: 'Remove from the team' }).click();
  };
  const removedToast = (page) => page.locator('.toast', { hasText: 'Priya Nair removed from the team.' });

  test('removing a person: the row goes at once with an Undo, and Undo sends nothing', async ({ page }) => {
    // Before the page mounts, so the wait's timer is the faked one.
    await page.clock.install();
    const { calls } = await bootSignedIn(page, {
      path: '/team',
      rpc: { list_my_teams: [teamRow('owner')], get_team_billing: GET_BILLING, ...removableTeam() },
    });
    const sheet = page.locator('[data-team-page]');
    await expect(sheet.getByText('Priya Nair')).toBeVisible();

    await removePriya(sheet);
    await expect(sheet.getByText('Priya Nair')).toHaveCount(0);
    await expect(removedToast(page)).toBeVisible();
    expect(only(calls, 'rpc/remove_from_team')).toHaveLength(0);

    await removedToast(page).getByRole('button', { name: 'Undo' }).click();
    await expect(sheet.getByText('Priya Nair')).toBeVisible();
    // Past the wait: nothing was sent, and she is still there.
    await page.clock.fastForward(UNDO_MS + 1000);
    await page.waitForTimeout(500);
    expect(only(calls, 'rpc/remove_from_team')).toHaveLength(0);
    await expect(sheet.getByText('Priya Nair')).toBeVisible();
  });

  test('removing a person without Undo: the call is made once, after the wait', async ({ page }) => {
    await page.clock.install();
    const { calls } = await bootSignedIn(page, {
      path: '/team',
      rpc: { list_my_teams: [teamRow('owner')], get_team_billing: GET_BILLING, ...removableTeam() },
    });
    const sheet = page.locator('[data-team-page]');
    await expect(sheet.getByText('Priya Nair')).toBeVisible();

    await removePriya(sheet);
    await expect(removedToast(page)).toBeVisible();
    await page.waitForTimeout(500);
    expect(only(calls, 'rpc/remove_from_team')).toHaveLength(0);

    await page.clock.fastForward(UNDO_MS + 1000);
    await expect.poll(() => only(calls, 'rpc/remove_from_team').length).toBe(1);
    expect(only(calls, 'rpc/remove_from_team')[0].body).toEqual({ p_org_id: ORG, p_user_id: PRIYA });
    // The reload after the call keeps her out, and nothing sends it again.
    await page.waitForTimeout(500);
    await expect(sheet.getByText('Priya Nair')).toHaveCount(0);
    expect(only(calls, 'rpc/remove_from_team')).toHaveLength(1);
  });

  // ── Seats & billing ──────────────────────────────────────────────────────

  test('Remove a seat asks first: Cancel sends nothing, the button sends it once', async ({ page }) => {
    const { calls } = await bootSignedIn(page, {
      path: '/team',
      rpc: { list_my_teams: [teamRow('owner')], get_team: GET_TEAM, get_team_billing: GET_BILLING },
    });
    const sheet = page.locator('[data-team-page]');
    await sheet.getByRole('tab', { name: /Seats & billing/ }).click();
    await sheet.getByRole('button', { name: 'Remove a seat' }).click();

    const confirm = sheet.getByRole('alertdialog');
    await expect(confirm).toContainText('Remove a seat?');
    await expect(confirm).toContainText('The team goes from 5 seats to 4');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(only(calls, 'rpc/remove_team_seat')).toHaveLength(0);

    await sheet.getByRole('button', { name: 'Remove a seat' }).click();
    await sheet.getByRole('alertdialog').getByRole('button', { name: 'Remove a seat' }).click();
    await expect.poll(() => only(calls, 'rpc/remove_team_seat').length).toBe(1);
    expect(only(calls, 'rpc/remove_team_seat')[0].body).toEqual({ p_org_id: ORG });
  });

  // team-billing "summary": the card, the next charge and the receipts, as
  // _shared/teamBillingCore.mjs teamBillingSummary sends them (amounts in the
  // currency's minor unit, dates in ms, the card's expiry as expMonth/expYear).
  const noon = (monthIndex, day, yearAhead = 0) => new Date(new Date().getFullYear() + yearAhead, monthIndex, day, 12).getTime();
  const SUMMARY = {
    ok: true,
    card: { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 },
    next: { amount: 37500, currency: 'usd', date: noon(0, 2, 1) },
    receipts: [
      { id: 'in_paid_https', date: noon(0, 5), amount: 37500, currency: 'usd', status: 'paid', url: 'https://invoice.stripe.com/i/acct_test/in_paid_https' },
      { id: 'in_paid_http', date: noon(0, 4), amount: 4167, currency: 'usd', status: 'paid', url: 'http://invoice.stripe.com/i/acct_test/in_paid_http' },
      { id: 'in_open_none', date: noon(0, 3), amount: 2500, currency: 'usd', status: 'open', url: null },
    ],
  };

  test('Seats & billing shows the card, the next charge and the receipts; only an https receipt links', async ({ page }) => {
    const { calls } = await bootSignedIn(page, {
      path: '/team',
      rpc: { list_my_teams: [teamRow('owner')], get_team: GET_TEAM, get_team_billing: GET_BILLING },
      functions: { 'team-billing': (body) => (body.action === 'summary' ? SUMMARY : {}) },
    });
    const sheet = page.locator('[data-team-page]');
    await sheet.getByRole('tab', { name: /Seats & billing/ }).click();

    await expect(sheet.locator('.tp-pay-t')).toContainText('Visa ending 4242');
    await expect(sheet.locator('.tp-pay-t')).toContainText('Expires 08/28');
    await expect(sheet).toContainText('The next charge is $375 on January 2.');
    await expect(sheet.locator('.tpb-rc')).toHaveCount(3);

    const rowFor = (amount) => sheet.locator('.tpb-rc', { hasText: amount });
    await expect(rowFor('$375.00')).toContainText('Paid');
    await expect(rowFor('$375.00').getByRole('link')).toHaveAttribute('href', 'https://invoice.stripe.com/i/acct_test/in_paid_https');
    await expect(rowFor('$41.67')).toContainText('Paid');
    await expect(rowFor('$41.67').getByRole('link')).toHaveCount(0);
    await expect(rowFor('$25.00')).toContainText('Open');
    await expect(rowFor('$25.00').getByRole('link')).toHaveCount(0);
    await expect(sheet.locator('.tpb-rc a')).toHaveCount(1);

    // The dev server mounts under StrictMode, which runs the page's effect twice:
    // count that it asked, and for which team, not how many times.
    const asked = only(calls, 'functions/team-billing').filter((c) => c.body?.action === 'summary');
    expect(asked.length).toBeGreaterThanOrEqual(1);
    for (const c of asked) expect(c.body.org_id).toBe(ORG);
  });

  test('Seats & billing without a summary keeps the Stripe line', async ({ page }) => {
    await bootSignedIn(page, {
      path: '/team',
      rpc: { list_my_teams: [teamRow('owner')], get_team: GET_TEAM, get_team_billing: GET_BILLING },
      functions: { 'team-billing': { status: 500, body: { error: 'server_error' } } },
    });
    const sheet = page.locator('[data-team-page]');
    await sheet.getByRole('tab', { name: /Seats & billing/ }).click();
    await expect(sheet.getByText('Card, invoices and receipts are in Stripe.')).toBeVisible();
    await expect(sheet.locator('.tpb-rc')).toHaveCount(0);
  });

  // ── The page that did not load ───────────────────────────────────────────

  test('a team that did not load says so, and Try again loads it', async ({ page }) => {
    // Down until the test says otherwise, not "the first read": the dev server's
    // StrictMode reads the team twice on open.
    let down = true;
    const { calls } = await bootSignedIn(page, {
      path: '/team',
      rpc: {
        list_my_teams: [teamRow('owner')],
        get_team: () => (down ? { status: 500, body: { code: 'XX000', message: 'boom', details: null, hint: null } } : GET_TEAM),
        get_team_billing: GET_BILLING,
      },
    });
    const sheet = page.locator('[data-team-page]');
    await expect(sheet.getByText('The team page didn’t load.')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeVisible();
    down = false;
    await sheet.getByRole('button', { name: 'Try again' }).click();
    await expect(sheet.getByRole('heading', { name: 'Northlight Films' })).toBeVisible();
    expect(only(calls, 'rpc/get_team').length).toBeGreaterThanOrEqual(2);
  });
});
