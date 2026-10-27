// team-live.spec.js — the Team plan's real paths (Team S4 Task 10), on the REAL
// signed-in app with every Supabase request stubbed (helpers/signedInStub.js).
// `?local=1` renders a harness that never runs App, so it can't reach these.
// Held by teamsAllowed(), which is true on the dev server. Nothing leaves the
// machine: the stub aborts every host but its own.
//
// The invite box is on the Joining tab (the "Invite people" button opens it).
import { test, expect as baseExpect } from '@playwright/test';
import { bootSignedIn, USER_ID, WS_ID, ORG } from './helpers/signedInStub.js';

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
});
