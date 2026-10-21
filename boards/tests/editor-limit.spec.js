// The 10-editor limit in the app (S1b, the owner's pick B): the share panel's
// note, "Can edit" locked for anyone new, the ask, a refusal the panel didn't
// see coming, and Members' "People who can edit". Mounted through
// src/local/shareWorkspaceProbe.js with the hold on and the RPCs answered by
// fixtures.
import { expect, test } from '@playwright/test';

const ME = '00000000-0000-4000-8000-0000000000aa';
const OWNER = '00000000-0000-4000-8000-0000000000bb';
const NORA = '00000000-0000-4000-8000-0000000000cc';
const LENA = '00000000-0000-4000-8000-0000000000dd';
const SAM = '00000000-0000-4000-8000-0000000000d1';
const BEN = '00000000-0000-4000-8000-0000000000d2';
const BOARD = '00000000-0000-4000-8000-00000000b0a4';

const capRow = (o = {}) => [{
  enforced: true, editor_limit: 10, used: 8, pending: 0, is_full: false,
  i_am_account_owner: true, subject: 'account', ...o,
}];
const grant = (o) => ({
  source: 'member', role: 'editor', workspace_id: 'ws-x', workspace_name: 'Studio',
  board_id: null, board_name: null, invite_id: null, sent_at: null, ...o,
});

// rpc: { name: json | (route) => fulfill }. Anything unnamed answers [].
async function boot(page, rpc = {}) {
  await page.addInitScript(() => { try { localStorage.setItem('soleil.dev.editorLimit', '1'); } catch (_) {} });
  await page.route('https://example.supabase.co/rest/v1/rpc/**', (route) => {
    const name = route.request().url().split('/rpc/')[1].split('?')[0];
    const answer = rpc[name];
    if (typeof answer === 'function') return answer(route);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer ?? []) });
  });
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForLoadState('domcontentloaded');
}

async function mountPanel(page, { owner = true, members = [], peers = [] } = {}) {
  await page.evaluate(async ({ me, ownerId, board, members, peers }) => {
    window.__limit = { seeWho: [] };
    const { mountShareModal } = await import('/src/local/shareWorkspaceProbe.js');
    mountShareModal({
      board: { id: board, name: 'Feature film', workspace_id: 'ws-x' },
      workspace: { id: 'ws-x', name: 'Studio', created_by: ownerId },
      workspaceMembers: [{ user_id: ownerId, role: 'owner' }, ...members],
      wsPeers: [{ user: { id: ownerId, name: 'Alex Moreau', email: 'alex@moreau.studio' } }, ...peers],
      selfUserId: me, canManage: true, rewardTier: 'paid',
      onSeeEditors: (ws) => { window.__limit.seeWho.push(ws); },
    });
  }, { me: ME, ownerId: owner ? ME : OWNER, board: BOARD, members, peers });
  const panel = page.locator('.share-modal');
  await expect(panel).toBeVisible();
  return panel;
}

test('two places left: the owner is told, with See who, and Can edit stays open', async ({ page }) => {
  await boot(page, { get_editor_capacity: capRow({ used: 8 }) });
  const panel = await mountPanel(page);
  const note = panel.locator('.lim-note');
  await expect(note).toContainText('2 places left for people who can edit.');
  await expect(note).toContainText('Your plan has room for 10, across all your workspaces.');
  await expect(panel.locator('select[aria-label="Access level for invitees"]')).toHaveValue('editor');
  await note.getByRole('button', { name: 'See who' }).click();
  expect(await page.evaluate(() => window.__limit.seeWho)).toEqual(['ws-x']);
  // The note is never gold; at rest Copy link is the one gold control.
  await expect(note.locator('.share-btn-gold')).toHaveCount(0);
});

test('full: the note says so, Can edit is off for anyone new, and only a place-holder keeps it', async ({ page }) => {
  await boot(page, {
    get_editor_capacity: capRow({ used: 9, pending: 1, is_full: true }),
    list_my_account_editors: [
      { slot_key: `u:${LENA}`, user_id: LENA, email: 'lena@castbox.io', display_name: 'Lena Fischer', source: 'share',
        grants: [grant({ source: 'share', board_id: 'b-cast', board_name: 'Casting' })] },
    ],
  });
  const panel = await mountPanel(page, {
    members: [{ user_id: NORA, role: 'viewer' }, { user_id: LENA, role: 'viewer' }],
    peers: [{ user: { id: NORA, name: 'Nora Quinn' } }, { user: { id: LENA, name: 'Lena Fischer' } }],
  });
  const note = panel.locator('.lim-note');
  await expect(note).toContainText('No places left for people who can edit.');
  await expect(note.getByRole('button', { name: 'See who can edit' })).toBeVisible();
  const access = panel.locator('select[aria-label="Access level for invitees"]');
  await expect(access).toHaveValue('viewer');
  await expect(access.locator('option[value="editor"]')).toBeDisabled();
  await expect(access.locator('option[value="editor"]')).toHaveText('Can edit — full');
  await expect(panel.locator('.share-role-hint')).toContainText('can’t change anything');
  // Nora would take a new place; Lena already holds one.
  const nora = panel.locator('.share-row', { hasText: 'Nora Quinn' }).locator('select');
  await expect(nora.locator('option[value="editor"]')).toBeDisabled();
  await expect(nora.locator('option[value="editor"]')).toHaveText('Workspace · can edit — full');
  await expect(nora.locator('option[value="coowner"]')).toHaveText('Co-owner — full');
  const lena = panel.locator('.share-row', { hasText: 'Lena Fischer' }).locator('select');
  await expect(lena.locator('option[value="editor"]')).toBeEnabled();
  // An address that already holds a place may still be asked to edit.
  await panel.locator('input[aria-label="Email addresses to invite"]').fill('lena@castbox.io');
  await expect(access).toHaveValue('editor');
  await expect(panel.locator('.share-btn-gold')).toHaveText('Invite');
});

test('someone else asks the owner by name, and is told it went', async ({ page }) => {
  const asked = [];
  await boot(page, {
    get_editor_capacity: capRow({ used: 10, is_full: true, i_am_account_owner: false }),
    ask_owner_for_editor_slot: (route) => {
      asked.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify('sent') });
    },
  });
  const panel = await mountPanel(page, { owner: false, members: [{ user_id: ME, role: 'editor' }] });
  const note = panel.locator('.lim-note');
  await expect(note).toContainText('Alex’s plan has room for 10. Invite people to view, or ask Alex to make room.');
  await note.getByRole('button', { name: 'Ask Alex for room' }).click();
  await expect(note.locator('.lim-done')).toHaveText('We told Alex you’d like to add an editor.');
  expect(asked[0]?.p_board_id).toBe(BOARD);
});

test('a refusal the panel did not see coming says so, keeps the address, and the next send goes out to view', async ({ page }) => {
  let capCalls = 0;
  const shares = [];
  await boot(page, {
    get_editor_capacity: (route) => {
      capCalls += 1;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(capCalls === 1 ? capRow({ used: 5 }) : capRow({ used: 10, is_full: true })) });
    },
    share_board: (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      shares.push(body);
      if (body.p_role === 'editor') {
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({
          code: '42501', hint: 'editor_limit', details: null,
          message: 'editor limit reached: you have 10 people who can edit across your workspaces, the most a personal plan allows',
        }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify('pending') });
    },
  });
  const panel = await mountPanel(page);
  const input = panel.locator('input[aria-label="Email addresses to invite"]');
  await input.fill('rosa@vidal.studio');
  await panel.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.locator('.toast-msg', { hasText: 'No places left for people who can edit: your plan has room for 10. Invite them to view, or make room.' })).toBeVisible();
  await expect(input).toHaveValue('rosa@vidal.studio');
  await expect(panel.locator('.lim-note')).toContainText('No places left for people who can edit.');
  await expect(panel.locator('select[aria-label="Access level for invitees"]')).toHaveValue('viewer');
  await panel.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect.poll(() => shares.map((s) => s.p_role)).toEqual(['editor', 'viewer']);
});

test('Members: People who can edit lists the account, frees a place, and locks Editor for a viewer', async ({ page }) => {
  const shares = [];
  await page.route('https://example.supabase.co/rest/v1/workspace_members**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([
      { user_id: ME, role: 'owner', created_at: '2026-01-01T00:00:00Z' },
      { user_id: NORA, role: 'viewer', created_at: '2026-02-01T00:00:00Z' },
    ]),
  }));
  await boot(page, {
    workspace_user_directory: [
      { workspace_id: 'ws-x', user_id: ME, title: 'Alex Moreau', email: 'alex@moreau.studio' },
      { workspace_id: 'ws-x', user_id: NORA, title: 'Nora Quinn', email: 'nora@quinnpost.com' },
    ],
    get_editor_capacity: capRow({ used: 9, pending: 1, is_full: true }),
    list_my_account_editors: [
      { slot_key: `u:${ME}`, user_id: ME, email: 'alex@moreau.studio', display_name: 'Alex Moreau', source: 'owner', grants: [] },
      { slot_key: `u:${SAM}`, user_id: SAM, email: 'sam@okafor.studio', display_name: 'Sam Okafor', source: 'member',
        grants: [grant({ role: 'coowner' })] },
      { slot_key: `u:${BEN}`, user_id: BEN, email: 'ben@adler.co', display_name: 'Ben Adler', source: 'share',
        grants: [grant({ source: 'share', board_id: 'b-music', board_name: 'Music video' })] },
      { slot_key: 'e:kai@northlight.tv', user_id: null, email: 'kai@northlight.tv', display_name: null, source: 'pending',
        grants: [grant({ source: 'pending', role: 'workspace', invite_id: 'inv-1', sent_at: '2026-10-19T15:00:00Z' })] },
    ],
    share_board: (route) => {
      shares.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify('granted') });
    },
  });
  await page.evaluate(async ({ me }) => {
    const { mountMembersTab } = await import('/src/local/shareWorkspaceProbe.js');
    mountMembersTab({ workspaceId: 'ws-x', workspaceName: 'Studio', user: { id: me }, role: 'owner' });
  }, { me: ME });

  const card = page.locator('.settings-cat', { hasText: 'People who can edit' });
  await expect(card.locator('.settings-cat-aside')).toHaveText('10 of 10');
  const rows = card.locator('.settings-editor-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('alex@moreau.studio · every workspace');
  await expect(rows.nth(0).locator('.settings-editor-role')).toHaveText('Owner');
  await expect(rows.nth(1)).toContainText('Co-owner of Studio');
  await expect(rows.nth(2)).toContainText('Can edit “Music video” in Studio');
  await expect(rows.nth(3)).toContainText('Invited to edit Studio · sent');
  await expect(rows.nth(3)).toContainText('holds a place until it’s accepted');
  await expect(rows.nth(3).getByRole('button', { name: 'Revoke' })).toHaveCount(1);

  const nora = page.locator('.settings-member-row', { hasText: 'Nora Quinn' }).locator('select');
  await expect(nora.locator('option[value="editor"]')).toBeDisabled();
  await expect(nora.locator('option[value="editor"]')).toHaveText('Editor — full');

  const ben = rows.nth(2);
  await ben.hover();
  await ben.getByRole('button', { name: 'Make viewer' }).click();
  await page.locator('.feedback-actions').getByRole('button', { name: 'Make viewer' }).click();
  await expect.poll(() => shares.length).toBe(1);
  expect(shares[0]).toEqual({ p_board_id: 'b-music', p_email: 'ben@adler.co', p_role: 'viewer' });
  await expect(page.locator('.toast-msg', { hasText: 'Ben Adler can view now. Their place is free.' })).toBeVisible();
});
