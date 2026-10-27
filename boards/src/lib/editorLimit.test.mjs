import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EDITOR_LIMIT, EDITOR_LIMIT_HINT, EDITOR_LIMIT_ASK_HINT,
  editorLimitRefusal, normalizeEditorCapacity,
  editorLimitStage, editorLimitFull, firstName, ownerPlan, editorLimitNote, editorLimitRefusalMessage,
  noticeToastText, missedJoinedAsViewer, accountHolders, holdsPlace,
  accountEditorSub, makeViewerOps, removeOps, revokeOps,
  applyEditorLimitPreview, EDITOR_LIMIT_PREVIEW_STATES,
} from './editorLimit.js';

test('a refusal is read from its hint, the way supabase-js hands it over', () => {
  assert.deepEqual(editorLimitRefusal({ message: 'x', hint: EDITOR_LIMIT_HINT, code: '42501' }), { ask: false });
  assert.deepEqual(editorLimitRefusal({ message: 'x', hint: EDITOR_LIMIT_ASK_HINT, code: '42501' }), { ask: true });
});

test('a wrapper that kept only the message is still understood', () => {
  assert.deepEqual(editorLimitRefusal(new Error('editor limit reached: you have 10 people who can edit across your workspaces, the most a personal plan allows')), { ask: false });
  assert.deepEqual(editorLimitRefusal(new Error('editor limit reached: this account already has 10 people who can edit')), { ask: true });
});

test('anything else is not the editor limit', () => {
  assert.equal(editorLimitRefusal(new Error('invite limit reached: try tomorrow')), null);
  assert.equal(editorLimitRefusal({ message: 'this account is suspended', hint: 'sending_on_hold' }), null);
  assert.equal(editorLimitRefusal(null), null);
  assert.equal(editorLimitRefusal(undefined), null);
});

test('the numbers come back in one shape, array or row', () => {
  const row = { enforced: true, editor_limit: 10, used: 9, pending: 1, is_full: true, i_am_account_owner: false, subject: 'account' };
  const want = { enforced: true, limit: 10, used: 9, pending: 1, taken: 10, left: 0, full: true, isAccountOwner: false, subject: 'account' };
  assert.deepEqual(normalizeEditorCapacity(row), want);
  assert.deepEqual(normalizeEditorCapacity([row]), want);
  assert.equal(normalizeEditorCapacity([]), null);
  assert.equal(normalizeEditorCapacity(null), null);
});

test('a missing limit falls back to the app\'s number, and left never goes below 0', () => {
  const c = normalizeEditorCapacity({ enforced: true, used: 12, pending: 0, is_full: true });
  assert.equal(c.limit, EDITOR_LIMIT);
  assert.equal(c.left, 0);
  assert.equal(c.subject, 'account');
});

const cap = (over) => normalizeEditorCapacity({
  enforced: true, editor_limit: 10, used: 8, pending: 0, is_full: false,
  i_am_account_owner: true, subject: 'account', ...over,
});

test('the stage: room, near at two left, full, over; null while off or unknown', () => {
  assert.equal(editorLimitStage(null), null);
  assert.equal(editorLimitStage(cap({ enforced: false })), null);
  assert.equal(editorLimitStage(cap({ used: 7 })), 'room');
  assert.equal(editorLimitStage(cap({ used: 8 })), 'near');
  assert.equal(editorLimitStage(cap({ used: 9 })), 'near');
  assert.equal(editorLimitStage(cap({ used: 9, pending: 1, is_full: true })), 'full');
  assert.equal(editorLimitStage(cap({ used: 12, is_full: true })), 'over');
  assert.equal(editorLimitFull(cap({ used: 10, is_full: true })), true);
  assert.equal(editorLimitFull(cap({ used: 12, is_full: true })), true);
  assert.equal(editorLimitFull(cap({ used: 9 })), false);
  assert.equal(editorLimitFull(null), false);
});

test('a first name, never an address or a stand-in; whose plan', () => {
  assert.equal(firstName('Alex Moreau'), 'Alex');
  assert.equal(firstName('  Maya  '), 'Maya');
  assert.equal(firstName('alex@moreau.studio'), null);
  assert.equal(firstName('Member'), null);
  assert.equal(firstName('You'), null);
  assert.equal(firstName(''), null);
  assert.equal(firstName(null), null);
  assert.equal(ownerPlan('Alex'), 'Alex’s plan');
  assert.equal(ownerPlan(null), 'the owner’s plan');
  assert.equal(ownerPlan(null, { start: true }), 'The owner’s plan');
});

test('the owner hears from two places left, in the words of the pick', () => {
  assert.equal(editorLimitNote(cap({ used: 7 })), null);
  assert.deepEqual(editorLimitNote(cap({ used: 8 })), {
    stage: 'near', lead: '2 places left for people who can edit.',
    body: 'Your plan has room for 10, across all your workspaces.', seeWho: 'link', ask: null, done: null,
  });
  assert.equal(editorLimitNote(cap({ used: 9 })).lead, '1 place left for people who can edit.');
  assert.deepEqual(editorLimitNote(cap({ used: 10, is_full: true })), {
    stage: 'full', lead: 'No places left for people who can edit.',
    body: 'Your plan has room for 10, across all your workspaces. Invite people to view, or make room.',
    seeWho: 'button', ask: null, done: null,
  });
  assert.deepEqual(editorLimitNote(cap({ used: 12, is_full: true })), {
    stage: 'over', lead: '12 people can edit, and your plan has room for 10.',
    body: 'Everyone keeps editing. Nobody new can edit until you’re under 10.',
    seeWho: 'button', ask: null, done: null,
  });
});

test('anyone else hears once it is full, and can ask the owner by name', () => {
  const ed = (over) => cap({ i_am_account_owner: false, ...over });
  assert.equal(editorLimitNote(ed({ used: 9 }), { ownerName: 'Alex' }), null, 'near is the owner’s news');
  assert.deepEqual(editorLimitNote(ed({ used: 10, is_full: true }), { ownerName: 'Alex' }), {
    stage: 'full', lead: 'No places left for people who can edit.',
    body: 'Alex’s plan has room for 10. Invite people to view, or ask Alex to make room.',
    seeWho: null, ask: 'Ask Alex for room', done: null,
  });
  const asked = editorLimitNote(ed({ used: 10, is_full: true }), { ownerName: 'Alex', asked: true });
  assert.equal(asked.ask, null);
  assert.equal(asked.done, 'We told Alex you’d like to add an editor.');
  const nameless = editorLimitNote(ed({ used: 11, is_full: true }));
  assert.equal(nameless.stage, 'over');
  assert.equal(nameless.body, 'The owner’s plan has room for 10. Invite people to view, or ask the owner to make room.');
  assert.equal(nameless.ask, 'Ask the owner for room');
});

test('a refusal, as one sentence', () => {
  assert.equal(editorLimitRefusalMessage({ ask: false }),
    'No places left for people who can edit: your plan has room for 10. Invite them to view, or make room.');
  assert.equal(editorLimitRefusalMessage({ ask: true }, { ownerName: 'Alex' }),
    'No places left for people who can edit: Alex’s plan has room for 10. Invite them to view, or ask Alex to make room.');
  assert.equal(editorLimitRefusalMessage({ ask: true }),
    'No places left for people who can edit: the owner’s plan has room for 10. Invite them to view, or ask the owner to make room.');
  assert.equal(editorLimitRefusalMessage(null), '');
});

test('a notice toasts as title — body, and the joiner’s as two sentences', () => {
  assert.equal(noticeToastText({ kind: 'editors.limit_reached', title: 'Rosa Vidal joined “Feature film” as a viewer', body: 'Your plan already has 10 people who can edit.' }),
    'Rosa Vidal joined “Feature film” as a viewer — Your plan already has 10 people who can edit.');
  assert.equal(noticeToastText({ kind: 'editors.joined_as_viewer', title: 'You joined “Feature film” as a viewer', body: 'Alex’s plan already has 10 people who can edit, so you can view for now. We told Alex.' }),
    'You joined “Feature film” as a viewer. Alex’s plan already has 10 people who can edit, so you can view for now. We told Alex.');
  assert.equal(noticeToastText({ kind: 'file.shared', title: 'Lena shared a file', body: '' }), 'Lena shared a file');
});

test('the joined-as-viewer notices a first load missed: unread, from the last day, not toasted, newest first', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const row = (id, hoursAgo, extra = {}) => ({
    id, kind: 'editors.joined_as_viewer', read_at: null,
    created_at: new Date(now - hoursAgo * 3600e3).toISOString(), ...extra,
  });
  const rows = [row('a', 1), row('b', 3), row('c', 30), row('d', 2, { read_at: '2026-10-21T11:00:00Z' }),
    row('e', 1, { kind: 'editors.limit_reached' }), row('f', 0.5)];
  assert.deepEqual(missedJoinedAsViewer(rows, { now, toasted: new Set(['f']) }).map((n) => n.id), ['a', 'b']);
  assert.deepEqual(missedJoinedAsViewer(null, { now }), []);
});

test('who holds a place: by account, or by address for a waiting invite', () => {
  const h = accountHolders([{ user_id: 'u1', email: 'Lena@castbox.io' }, { user_id: null, email: 'kai@northlight.tv' }]);
  assert.equal(holdsPlace(h, { userId: 'u1' }), true);
  assert.equal(holdsPlace(h, { email: 'lena@CASTBOX.io' }), true);
  assert.equal(holdsPlace(h, { email: ' kai@northlight.tv ' }), true);
  assert.equal(holdsPlace(h, { userId: 'u2', email: 'x@y.co' }), false);
  assert.equal(holdsPlace(null, { userId: 'u1' }), false);
});

const G = (o) => ({
  source: 'member', role: 'editor', workspace_id: 'w1', workspace_name: 'Studio',
  board_id: null, board_name: null, invite_id: null, sent_at: null, ...o,
});

test('a row says where its person can edit, the widest place first', () => {
  assert.equal(accountEditorSub({ source: 'owner', email: 'alex@moreau.studio', grants: [] }), 'alex@moreau.studio · every workspace');
  assert.equal(accountEditorSub({ source: 'member', email: 's@o.studio', grants: [G({ role: 'coowner' })] }), 'Co-owner of Studio');
  assert.equal(accountEditorSub({ source: 'member', email: 'm@l.co', grants: [G({})] }), 'Edits Studio');
  assert.equal(accountEditorSub({ source: 'share', email: 'l@c.io', grants: [G({ source: 'share', board_id: 'b1', board_name: 'Feature film' })] }),
    'Can edit “Feature film” in Studio');
  assert.equal(accountEditorSub({ source: 'share', email: 'n@h.co', grants: [
    G({ source: 'share', board_id: 'b2', board_name: 'Casting' }), G({ workspace_name: 'Commercials', workspace_id: 'w2' }),
  ] }), 'Edits Commercials, and 1 more');
  const sent = '2026-10-19T15:00:00Z';
  const day = new Date(sent).toLocaleDateString();
  assert.equal(accountEditorSub({ source: 'pending', email: 'kai@northlight.tv', grants: [G({ source: 'pending', role: 'workspace', invite_id: 'i1', sent_at: sent })] }),
    `Invited to edit Studio · sent ${day} · holds a place until it’s accepted`);
  assert.equal(accountEditorSub({ source: 'pending', email: 'd@l.co', grants: [G({ source: 'pending', role: 'editor', board_id: 'b1', board_name: 'Feature film', invite_id: 'i2', sent_at: sent })] }),
    `Invited to edit “Feature film” in Studio · sent ${day} · holds a place until it’s accepted`);
});

test('freeing a place: Make viewer keeps them in, Remove takes shares first, Revoke cancels the invites', () => {
  const row = { user_id: 'u1', email: 'ben@a.co', source: 'member', grants: [
    G({ role: 'coowner' }),
    G({ source: 'share', role: 'editor', workspace_id: 'w2', board_id: 'b1', board_name: 'Music video' }),
    G({ role: 'owner', workspace_id: 'w3' }),
  ] };
  assert.deepEqual(makeViewerOps(row), [
    { op: 'member_role', workspaceId: 'w1', userId: 'u1', role: 'viewer' },
    { op: 'share_role', boardId: 'b1', email: 'ben@a.co', role: 'viewer' },
  ]);
  assert.deepEqual(removeOps(row), [
    { op: 'unshare', boardId: 'b1', userId: 'u1' },
    { op: 'remove_member', workspaceId: 'w1', userId: 'u1' },
  ]);
  const inv = { user_id: null, email: 'kai@n.tv', source: 'pending', grants: [
    G({ source: 'pending', role: 'workspace', invite_id: 'i1' }),
    G({ source: 'pending', role: 'editor', board_id: 'b1', invite_id: 'i2' }),
  ] };
  assert.deepEqual(revokeOps(inv), [{ op: 'revoke', inviteId: 'i1' }, { op: 'revoke', inviteId: 'i2' }]);
  assert.deepEqual(makeViewerOps(inv), []);
  assert.deepEqual(removeOps(inv), []);
});

test('the hold opens on the preview host and nowhere else in a build', () => {
  const host = readFileSync(new URL('./appHost.js', import.meta.url), 'utf8');
  const body = host.match(/export function editorLimitAllowed\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(body, /if \(onPreviewHost\(\)\) return true;/);
  assert.match(body, /if \(!import\.meta\.env\.DEV\) return false;/);
  assert.doesNotMatch(body.trim(), /^return true;$/);
  assert.match(host, /^\s*editorLimit: editorLimitAllowed,$/m);
});

// Settings › Preview: an admin's pretend numbers (look only).
const previewCap = (o = {}) => normalizeEditorCapacity({
  enforced: false, editor_limit: 10, used: 4, pending: 0, is_full: false, i_am_account_owner: true, ...o,
});
const realRows = (n) => Array.from({ length: n }, (_, i) => ({
  slot_key: `u:${i}`, user_id: `u${i}`, email: `p${i}@x.io`, display_name: `P${i}`, source: 'member', grants: [],
}));

test('the preview states are near, full and full_ask', () => {
  assert.deepEqual(EDITOR_LIMIT_PREVIEW_STATES, ['near', 'full', 'full_ask']);
});

test('no preview state, or an unknown one, changes nothing', () => {
  const cap = previewCap();
  const rows = realRows(3);
  for (const state of [undefined, null, 'bogus']) {
    const out = applyEditorLimitPreview(cap, rows, state);
    assert.equal(out.cap, cap);
    assert.equal(out.editors, rows);
    assert.equal(out.previewing, false);
  }
});

test('near: the owner sees 8 taken, 2 left, the examples after the real rows', () => {
  const out = applyEditorLimitPreview(previewCap(), realRows(3), 'near');
  assert.equal(out.previewing, true);
  assert.equal(out.cap.taken, 8);
  assert.equal(out.cap.left, 2);
  assert.equal(out.cap.full, false);
  assert.equal(out.cap.enforced, true);
  assert.equal(out.editors.length, 8);
  assert.equal(out.editors.filter((r) => r.preview).length, 5);
  assert.ok(out.editors.slice(3).every((r) => r.preview));
});

test('full: the owner sees 10 of 10', () => {
  const out = applyEditorLimitPreview(previewCap(), realRows(3), 'full');
  assert.equal(out.cap.taken, 10);
  assert.equal(out.cap.left, 0);
  assert.equal(out.cap.full, true);
  assert.equal(out.editors.length, 10);
});

test('full_ask: a co-owner sees it full and no list', () => {
  const out = applyEditorLimitPreview(previewCap(), realRows(3), 'full_ask');
  assert.equal(out.cap.isAccountOwner, false);
  assert.equal(out.cap.full, true);
  assert.deepEqual(out.editors, []);
});

test('in someone else\'s workspace the preview is the non-owner\'s view', () => {
  const out = applyEditorLimitPreview(previewCap({ i_am_account_owner: false }), [], 'full');
  assert.equal(out.cap.isAccountOwner, false);
  assert.equal(out.cap.full, true);
  assert.deepEqual(out.editors, []);
});

test('real rows above the target are all kept', () => {
  const out = applyEditorLimitPreview(previewCap(), realRows(9), 'near');
  assert.equal(out.cap.taken, 9);
  assert.equal(out.editors.length, 9);
  assert.equal(out.editors.filter((r) => r.preview).length, 0);
});

// ── A team's seats ──────────────────────────────────────────────────────────
const teamCap = (o = {}) => ({ enforced: true, limit: 5, used: 2, pending: 0, taken: 2, left: 3, full: false, isAccountOwner: true, subject: 'team', ...o });

test('a team is full by the server flag only, near at one or two seats left', () => {
  assert.equal(editorLimitStage(teamCap({ full: true, used: 5, taken: 5, left: 0 })), 'full');
  // auto mode: at the seat count but not full, the next editor adds a seat
  assert.equal(editorLimitStage(teamCap({ used: 5, taken: 5, left: 0 })), 'room');
  assert.equal(editorLimitStage(teamCap({ used: 4, taken: 4, left: 1 })), 'near');
  assert.equal(editorLimitStage(teamCap({ used: 3, taken: 3, left: 2 })), 'near');
  assert.equal(editorLimitStage(teamCap()), 'room');
  assert.equal(editorLimitStage(teamCap({ used: 7, taken: 7, left: 0 })), 'room');
  assert.equal(editorLimitStage(teamCap({ enforced: false, full: true })), null);
});

test('a full team tells its owner and admins to add a seat, and everyone else to ask', () => {
  const full = { full: true, used: 5, taken: 5, left: 0 };
  assert.deepEqual(editorLimitNote(teamCap(full)), {
    stage: 'full', lead: 'All 5 of the team’s seats are in use.',
    body: 'Invite people to view, or add a seat on the team’s page.', seeWho: null, ask: null, done: null,
  });
  assert.deepEqual(editorLimitNote(teamCap({ ...full, isAccountOwner: false })), {
    stage: 'full', lead: 'All 5 of the team’s seats are in use.',
    body: 'Invite people to view. An admin of the team can add a seat.', seeWho: null, ask: null, done: null,
  });
  // The share panel, where an owner or admin can buy the seat with the invite.
  assert.equal(editorLimitNote(teamCap(full), { canBuySeat: true }).body, 'Inviting someone to edit adds a seat.');
  assert.equal(editorLimitNote(teamCap({ ...full, isAccountOwner: false }), { canBuySeat: true }).body,
    'Invite people to view. An admin of the team can add a seat.');
});

test('a team running low tells only its owner and admins', () => {
  assert.deepEqual(editorLimitNote(teamCap({ used: 4, taken: 4, left: 1 })), {
    stage: 'near', lead: '1 seat left on the team.',
    body: 'Each person who can edit uses a seat. Viewers are free.', seeWho: null, ask: null, done: null,
  });
  assert.equal(editorLimitNote(teamCap({ used: 3, taken: 3, left: 2 })).lead, '2 seats left on the team.');
  assert.equal(editorLimitNote(teamCap({ used: 4, taken: 4, left: 1, isAccountOwner: false })), null);
  assert.equal(editorLimitNote(teamCap()), null);
});

test('a team’s refusals are read from their hints and said in the team’s words', () => {
  assert.deepEqual(editorLimitRefusal({ message: 'x', hint: 'team_seats_full' }), { ask: false, team: true });
  assert.deepEqual(editorLimitRefusal({ message: 'x', hint: 'team_seats_ask_admin' }), { ask: true, team: true });
  assert.equal(editorLimitRefusalMessage({ ask: false, team: true }),
    'All of the team’s seats are in use. Invite them to view, or add a seat on the team’s page.');
  assert.equal(editorLimitRefusalMessage({ ask: true, team: true }),
    'All of the team’s seats are in use. Invite them to view, or ask an admin of the team for a seat.');
});

test('an account’s note is unchanged at every stage', () => {
  const acct = (o) => ({ enforced: true, limit: 10, pending: 0, subject: 'account', ...o });
  const owner = { isAccountOwner: true };
  const other = { isAccountOwner: false };
  assert.deepEqual(editorLimitNote(acct({ ...owner, used: 11, taken: 11, left: 0 })), {
    stage: 'over', lead: '11 people can edit, and your plan has room for 10.',
    body: 'Everyone keeps editing. Nobody new can edit until you’re under 10.', seeWho: 'button', ask: null, done: null,
  });
  assert.deepEqual(editorLimitNote(acct({ ...owner, used: 10, taken: 10, left: 0, full: true })), {
    stage: 'full', lead: 'No places left for people who can edit.',
    body: 'Your plan has room for 10, across all your workspaces. Invite people to view, or make room.', seeWho: 'button', ask: null, done: null,
  });
  assert.deepEqual(editorLimitNote(acct({ ...owner, used: 9, taken: 9, left: 1 })), {
    stage: 'near', lead: '1 place left for people who can edit.',
    body: 'Your plan has room for 10, across all your workspaces.', seeWho: 'link', ask: null, done: null,
  });
  assert.equal(editorLimitNote(acct({ ...other, used: 9, taken: 9, left: 1 })), null);
  assert.deepEqual(editorLimitNote(acct({ ...other, used: 10, taken: 10, left: 0, full: true }), { ownerName: 'Alex' }), {
    stage: 'full', lead: 'No places left for people who can edit.',
    body: 'Alex’s plan has room for 10. Invite people to view, or ask Alex to make room.', seeWho: null,
    ask: 'Ask Alex for room', done: null,
  });
  assert.equal(editorLimitNote(acct({ ...owner, used: 3, taken: 3, left: 7 })), null);
});
