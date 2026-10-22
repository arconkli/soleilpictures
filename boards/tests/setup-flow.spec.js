// The first-run setup (workspace_setup arm B) and the workspace invite link,
// end to end against ?setupqa=1: the real AuthGate, TierRouter, setup gate and
// screens over an in-memory fake of the backend (local/setupqa/). No request
// leaves the page and every analytics row is marked synthetic.
//
// Covers: the name's rules, the owner's three steps and what they leave
// behind, skipping, a reload resuming with Back keeping the answers, the arm
// that skips it all, the invitee's one step after signing up from a link, a
// dead link, the signed-in join card, and the link and email limits.
import { test, expect } from '@playwright/test';

const TOKEN = '6f1c2a9e-3b7d-4c55-9a1e-2d4b8c0f7a31';   // Lost Time's link in the fake

async function open(page, query) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?setupqa=1&fresh=1&${query}`);
  await expect(page.locator('html[data-setupqa-ready="1"]')).toHaveCount(1, { timeout: 20000 });
  return errors;
}

const events = (page) => page.evaluate(() => window.__setupQa.events());
const db = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__setupQa.db)));
const calls = (page, name) => page.evaluate((n) => window.__setupQa.calls.filter((c) => c.name === n), name);
const outcome = async (page) => JSON.parse(await page.getByTestId('qa-outcome').textContent());
const slot = async (page) => JSON.parse(await page.getByTestId('qa-slot').textContent());
const pick = (list, name, match = {}) => list.filter((e) => e.event === name
  && Object.entries(match).every(([k, v]) => e.props?.[k] === v));

async function signIn(page, email) {
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: /Continue with email/ }).click();
  const code = page.locator('.auth-code-input');
  await expect(code).toBeVisible({ timeout: 15000 });
  await code.fill('123456');
  await code.press('Enter');
}

test('the name is required, kept to 60 characters, and Enter moves on', async ({ page }) => {
  const errors = await open(page, 'setup=B');
  await expect(page.getByRole('heading', { name: 'Name your workspace' })).toBeVisible({ timeout: 20000 });
  const name = page.getByLabel('Workspace name');
  const go = page.getByRole('button', { name: 'Continue' });
  await expect(name).toBeFocused();
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await expect(go).toBeDisabled();
  await name.fill('    ');
  await expect(go).toBeDisabled();

  await name.fill('x'.repeat(61));
  await go.click();
  await expect(page.locator('#su-name-err')).toHaveText('Keep it to 60 characters.');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  // Typing again clears the complaint.
  await name.fill('Lost Time');
  await expect(page.locator('#su-name-err')).toHaveCount(0);
  await expect(page.locator('.su-strip-name')).toHaveText('Lost Time');

  await name.press('Enter');
  await expect(page.getByRole('heading', { name: 'Tell us about Lost Time' })).toBeVisible();
  const mine = (await db(page)).workspaces.find((w) => w.created_by === 'qa-me');
  expect(mine?.name).toBe('Lost Time');
  expect(errors).toEqual([]);
});

test('an owner says who and what, copies the link, sends an email and opens the workspace', async ({ page }) => {
  const errors = await open(page, 'setup=B');
  await page.getByLabel('Workspace name').fill('Northlight Studio');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Tell us about Northlight Studio' })).toBeVisible();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  // The team answer shows as empty seats on the workspace card.
  await page.getByRole('button', { name: 'A team' }).click();
  await expect(page.locator('.su-strip .su-face.is-seat')).toHaveCount(3);
  await page.getByRole('button', { name: 'A few people' }).click();
  await expect(page.getByRole('button', { name: 'A few people' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'A team' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.su-strip .su-face.is-seat')).toHaveCount(2);
  await page.getByRole('button', { name: 'Film & video' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Invite the people you work with' })).toBeVisible();
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  await expect(page.locator('.su-link-url')).toContainText('?wsjoin=');
  await expect(page.locator('.su-linknote')).toContainText('Northlight Studio');
  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible();

  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const clip = await page.evaluate(() => window.__setupQa.clipboard);
  expect(clip).toHaveLength(1);
  expect(clip[0]).toMatch(/\/\?wsjoin=[0-9a-f-]{36}$/);
  // Once the link is out, the way on is the workspace, not a skip.
  await expect(page.getByRole('button', { name: 'Skip for now' })).toHaveCount(0);
  await expect(page.locator('.su-strip-line')).toHaveText('Invite link ready');

  await page.getByLabel('Email address').fill('pat@studio.com');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.locator('.su-res')).toHaveText(['pat@studio.com' + 'Invite sent']);
  await expect(page.locator('.su-strip-line')).toHaveText('1 invited');
  await expect(page.getByLabel('Email address')).toHaveValue('');

  await page.getByRole('button', { name: 'Open Northlight Studio' }).click();
  await expect(page.getByTestId('qa-app')).toBeVisible({ timeout: 15000 });
  const o = await outcome(page);
  expect(o.arm).toBe('B');
  expect(o.override).toBe(true);
  expect(o.welcome).toMatchObject({ done: true, step: 'done', team: 'few', work: 'film', invite: 'sent', invitee: false });

  const d = await db(page);
  expect(d.profiles.find((p) => p.user_id === 'qa-me').settings.welcome).toMatchObject({ done: true, invite: 'sent', team: 'few', work: 'film' });
  expect(d.invites).toEqual([{ email: 'pat@studio.com', role: 'editor', workspace_id: d.workspaces.find((w) => w.created_by === 'qa-me').id }]);

  const ev = await events(page);
  for (const step of ['name', 'who', 'invite']) {
    expect(pick(ev, 'setup_step', { step, action: 'view' }), `${step} view`).toHaveLength(1);
    const done = pick(ev, 'setup_step', { step, action: 'done' });
    expect(done, `${step} done`).toHaveLength(1);
    expect(typeof done[0].props.ms).toBe('number');
  }
  expect(pick(ev, 'setup_step', { step: 'who', action: 'done' })[0].props).toMatchObject({ team: 'few', work: 'film' });
  expect(pick(ev, 'setup_done')[0].props).toMatchObject({ invitee: false, team: 'few', work: 'film', invite: 'sent', emails: 1, links: 1 });
  expect(pick(ev, 'workspace_link_created', { surface: 'setup', role: 'editor' })).toHaveLength(1);
  expect(pick(ev, 'workspace_link_shared', { surface: 'setup', method: 'copy', ok: true })).toHaveLength(1);
  expect(pick(ev, 'invite_sent', { surface: 'setup', method: 'email', result: 'pending', n: 1 })).toHaveLength(1);
  // The QA override never stamps an arm.
  expect(pick(ev, 'experiment_enrolled', { key: 'workspace_setup' })).toHaveLength(0);
  expect(await calls(page, 'set_experiment_arm')).toHaveLength(0);
  // Nothing from the harness can pass for a real person's row.
  expect(ev.length).toBeGreaterThan(5);
  expect(ev.filter((e) => e.props?.synthetic !== true).map((e) => e.event)).toEqual([]);
  expect(errors).toEqual([]);
});

test('skipping both optional steps still lands in the app, and says so', async ({ page }) => {
  await open(page, 'setup=B');
  await page.getByLabel('Workspace name').fill('Lost Time');
  await page.getByLabel('Workspace name').press('Enter');
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invite people to Lost Time' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByTestId('qa-app')).toBeVisible({ timeout: 15000 });
  expect((await outcome(page)).welcome).toMatchObject({ done: true, team: null, work: null, invite: 'skipped' });
  const ev = await events(page);
  expect(pick(ev, 'setup_step', { step: 'who', action: 'skip' })).toHaveLength(1);
  expect(pick(ev, 'setup_step', { step: 'invite', action: 'skip' })).toHaveLength(1);
  expect(pick(ev, 'setup_done')[0].props).toMatchObject({ invite: 'skipped', emails: 0, links: 0 });
  expect(pick(ev, 'invite_sent')).toHaveLength(0);
  expect(pick(ev, 'workspace_link_shared')).toHaveLength(0);
});

test('a reload resumes where they were, and Back keeps every answer', async ({ page }) => {
  await open(page, 'setup=B');
  await page.getByLabel('Workspace name').fill('Lost Time');
  await page.getByLabel('Workspace name').press('Enter');
  await page.getByRole('button', { name: 'A team' }).click();
  await page.getByRole('button', { name: 'Music' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Bring your team into Lost Time' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bring your team into Lost Time' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Tell us about Lost Time' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'A team' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Music' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Name your workspace' })).toBeVisible();
  await expect(page.getByLabel('Workspace name')).toHaveValue('Lost Time');
  await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);

  // Renaming on the way back renames the same workspace, not a second one.
  await page.getByLabel('Workspace name').fill('Lost Time Pictures');
  await page.getByLabel('Workspace name').press('Enter');
  await expect(page.getByRole('heading', { name: 'Tell us about Lost Time Pictures' })).toBeVisible();
  const mine = (await db(page)).workspaces.filter((w) => w.created_by === 'qa-me');
  expect(mine.map((w) => w.name)).toEqual(['Lost Time Pictures']);
  expect(pick(await events(page), 'setup_step', { action: 'back' }).map((e) => e.props.step)).toEqual(['invite', 'who']);
});

test('the other arm goes straight to the app', async ({ page }) => {
  await open(page, 'setup=A');
  await expect(page.getByTestId('qa-app')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Name your workspace' })).toHaveCount(0);
  expect((await outcome(page)).arm).toBe('A');
});

test('without the override an arm is drawn and stamped once', async ({ page }) => {
  await open(page, '');
  await expect(page.getByTestId('qa-app').or(page.getByRole('heading', { name: 'Name your workspace' }))).toBeVisible({ timeout: 20000 });
  const stamped = await calls(page, 'set_experiment_arm');
  expect(stamped).toHaveLength(1);
  expect(stamped[0].args.p_key).toBe('workspace_setup');
  expect(['A', 'B']).toContain(stamped[0].args.p_arm);
  expect(pick(await events(page), 'experiment_enrolled', { key: 'workspace_setup', arm: stamped[0].args.p_arm })).toHaveLength(1);
});

test('someone who signs up from a workspace link joins it and only answers what they do', async ({ page }) => {
  const errors = await open(page, `setup=B&signedout=1&wsjoin=${TOKEN}`);
  const banner = page.locator('.auth-wsjoin');
  await expect(banner).toContainText('Join Lost Time', { timeout: 20000 });
  await expect(banner).toContainText('Nora invited you. Sign in or sign up to join.');
  expect(page.url()).not.toContain('wsjoin');

  await signIn(page, 'maya.new@example.com');
  await expect(page.getByRole('heading', { name: 'You’re joining Lost Time' })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.su-sub')).toContainText('Nora invited you.');
  await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
  await expect(page.getByText(/Step \d of/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Photo' }).click();
  await page.getByRole('button', { name: 'Open Lost Time' }).click();

  await expect(page.getByTestId('qa-app')).toBeVisible({ timeout: 15000 });
  expect(await slot(page)).toEqual({ activeWorkspaceId: 'ws-lost-time' });
  expect((await outcome(page)).welcome).toMatchObject({ done: true, invitee: true, work: 'photo' });
  const d = await db(page);
  expect(d.members.some((m) => m.workspace_id === 'ws-lost-time' && m.user_id === 'qa-new')).toBe(true);
  expect(d.workspaces.filter((w) => w.created_by === 'qa-new')).toEqual([]);   // they never named one

  const ev = await events(page);
  expect(pick(ev, 'workspace_link_landed', { status: 'live', signed_in: false })).toHaveLength(1);
  expect(pick(ev, 'workspace_link_claim_result', { status: 'joined', at: 'signup' })).toHaveLength(1);
  expect(pick(ev, 'access_granted', { how: 'workspace_link', surface: 'wsjoin' })).toHaveLength(1);
  expect(pick(ev, 'setup_step', { step: 'invitee', action: 'done' })[0].props).toMatchObject({ work: 'photo', invitee: true });
  expect(pick(ev, 'setup_done')[0].props).toMatchObject({ invitee: true, work: 'photo' });
  expect(errors).toEqual([]);
});

test('a dead link says so, and signing in from it joins nothing', async ({ page }) => {
  await open(page, `setup=B&signedout=1&deadlink=1&wsjoin=${TOKEN}`);
  await expect(page.getByText('That invite link has expired or was turned off. Ask whoever sent it for a new one.')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.auth-wsjoin')).toHaveCount(0);
  await signIn(page, 'maya.new@example.com');
  await expect(page.getByRole('heading', { name: 'Name your workspace' })).toBeVisible({ timeout: 20000 });
  expect(await calls(page, 'claim_workspace_invite_link')).toHaveLength(0);
  expect(pick(await events(page), 'workspace_link_landed', { status: 'dead', signed_in: false })).toHaveLength(1);
});

test('someone already signed in is asked before joining, and Join opens the workspace', async ({ page }) => {
  await open(page, `setup=A&wsjoin=${TOKEN}`);
  const card = page.getByRole('dialog', { name: 'Join Lost Time' });
  await expect(card).toContainText('Join “Lost Time” as an editor.', { timeout: 20000 });
  await expect(card).toContainText('Nora invited you. Work on its clusters and files alongside Nora.');
  // Opening the link joined nothing.
  expect(await calls(page, 'claim_workspace_invite_link')).toHaveLength(0);

  await card.getByRole('button', { name: 'Join as editor' }).click();
  await expect(page.getByTestId('qa-app')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await slot(page)).toEqual({ activeWorkspaceId: 'ws-lost-time' });
  const d = await db(page);
  expect(d.members.some((m) => m.workspace_id === 'ws-lost-time' && m.user_id === 'qa-me')).toBe(true);
  const ev = await events(page);
  expect(pick(ev, 'workspace_link_landed', { status: 'live', signed_in: true })).toHaveLength(1);
  expect(pick(ev, 'workspace_link_claim_result', { status: 'joined', at: 'card' })).toHaveLength(1);
  expect(pick(ev, 'access_granted', { how: 'workspace_link', surface: 'wsjoin_card' })).toHaveLength(1);
});

test('Not now and Escape leave without joining; a member is offered the way in', async ({ page }) => {
  await open(page, `setup=A&wsjoin=${TOKEN}`);
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await open(page, `setup=A&wsjoin=${TOKEN}`);
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await calls(page, 'claim_workspace_invite_link')).toHaveLength(0);

  await open(page, `setup=A&invitee=1&wsjoin=${TOKEN}`);
  const card = page.getByRole('dialog', { name: 'Open Lost Time' });
  await expect(card).toContainText('You’re already in “Lost Time”.', { timeout: 20000 });
  await card.getByRole('button', { name: 'Open Lost Time' }).click();
  await expect(page.getByTestId('qa-app')).toBeVisible({ timeout: 20000 });
  expect(await slot(page)).toEqual({ activeWorkspaceId: 'ws-lost-time' });
  expect(pick(await events(page), 'workspace_link_claim_result', { status: 'member', at: 'card' })).toHaveLength(1);
});

test('a fresh account mid-setup can still take the join card, and lands on the joiner step', async ({ page }) => {
  await open(page, `setup=B&wsjoin=${TOKEN}`);
  await expect(page.getByRole('heading', { name: 'Name your workspace' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('dialog', { name: 'Join Lost Time' }).getByRole('button', { name: 'Join as editor' }).click();
  await expect(page.getByRole('heading', { name: 'You’re joining Lost Time' })).toBeVisible({ timeout: 20000 });
});

for (const [mode, says] of [
  ['limit', 'You’ve made today’s invite links. Invite by email below, or try again tomorrow.'],
  ['paused', 'Sharing is paused on this account while we review unusual activity.'],
  ['error', 'The invite link didn’t load. Invite by email below.'],
]) {
  test(`a refused link (${mode}) says why and email still works`, async ({ page }) => {
    await open(page, `setup=B&resume=invite&link=${mode}`);
    await expect(page.getByRole('heading', { name: 'Invite the people you work with' })).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.su-linknote')).toHaveText(says);
    await expect(page.locator('.su-link-url')).toHaveText('No link right now');
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeDisabled();
    await page.getByLabel('Email address').fill('ana@studio.com');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.locator('.su-res')).toHaveText(['ana@studio.com' + 'Invite sent']);
    await expect(page.getByRole('button', { name: 'Open Northlight' })).toBeVisible();
    expect(pick(await events(page), 'setup_error', { op: 'link', surface: 'setup' })).toHaveLength(1);
  });
}

test('the email limit keeps what it stopped and points at the link', async ({ page }) => {
  await open(page, 'setup=B&resume=invite&invitelimit=1');
  await expect(page.getByRole('heading', { name: 'Invite the people you work with' })).toBeVisible({ timeout: 20000 });
  await page.getByLabel('Email address').fill('ana@studio.com');
  await page.getByRole('button', { name: 'Add another' }).click();
  await page.getByLabel('Email address 2').fill('bo@studio.com');
  await page.getByRole('button', { name: 'Send 2 invites' }).click();
  await expect(page.locator('.su-res')).toHaveText(['ana@studio.com' + 'Invite sent']);
  await expect(page.locator('.su-note')).toContainText('Copy the invite link for everyone else.');
  await expect(page.getByLabel('Email address')).toHaveValue('bo@studio.com');
  await expect(page.getByRole('button', { name: 'Open Northlight' })).toBeVisible();
});

test('the email limit is logged, and a viewer row it never reached stays for tomorrow', async ({ page }) => {
  await open(page, 'setup=B&resume=invite&invitelimit=1');
  await expect(page.getByRole('heading', { name: 'Invite the people you work with' })).toBeVisible({ timeout: 20000 });
  await page.getByLabel('Email address').fill('ana@studio.com');
  await page.getByRole('button', { name: 'Add another' }).click();
  await page.getByLabel('Email address 2').fill('bo@studio.com');
  await page.getByRole('button', { name: 'Add another' }).click();
  await page.getByLabel('Email address 3').fill('cy@studio.com');
  await page.getByRole('button', { name: 'Access: Can edit' }).nth(2).click();
  await expect(page.getByRole('button', { name: 'Access: Can view' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Send 3 invites' }).click();
  await expect(page.locator('.su-res')).toHaveText(['ana@studio.com' + 'Invite sent']);
  // Editors go first; the limit stopped bo, and cy (a viewer) was never tried.
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('bo@studio.com');
  await expect(page.getByLabel('Email address 2')).toHaveValue('cy@studio.com');
  await expect(page.getByRole('button', { name: 'Access: Can view' })).toHaveCount(1);
  expect((await db(page)).invites.map((i) => i.email)).toEqual(['ana@studio.com']);
  expect(pick(await events(page), 'invite_limit_reached', { surface: 'setup', method: 'email', kind: 'first_day', unsent: 2 })).toHaveLength(1);
});

test('each address gets its own answer, and a row can invite a viewer', async ({ page }) => {
  await open(page, 'setup=B&resume=invite');
  await expect(page.getByRole('heading', { name: 'Invite the people you work with' })).toBeVisible({ timeout: 20000 });
  await page.getByLabel('Email address').fill('known@studio.com');
  await page.getByRole('button', { name: 'Add another' }).click();
  await page.getByLabel('Email address 2').fill('member@studio.com');
  await page.getByRole('button', { name: 'Add another' }).click();
  await page.getByLabel('Email address 3').fill('fail@studio.com');
  await page.getByRole('button', { name: 'Access: Can edit' }).first().click();
  await expect(page.getByRole('button', { name: 'Access: Can view' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Send 3 invites' }).click();
  await expect(page.locator('.su-res')).toHaveCount(3);
  await expect(page.locator('.su-res', { hasText: 'known@studio.com' })).toContainText('Added');
  await expect(page.locator('.su-res', { hasText: 'member@studio.com' })).toContainText('Already in it');
  await expect(page.locator('.su-res', { hasText: 'fail@studio.com' })).toContainText('Not sent');
  const sent = (await db(page)).invites;
  expect(sent.find((i) => i.email === 'known@studio.com')?.role).toBe('viewer');
  expect(sent.find((i) => i.email === 'member@studio.com')?.role).toBe('editor');
});
