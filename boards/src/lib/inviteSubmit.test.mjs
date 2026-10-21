// inviteSubmit.test.mjs — the one way invitations go out.
//
//   node --test src/lib/inviteSubmit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmails, runInvites, runInvitesByRole, inviteLimitReason, inviteLimitKind } from './inviteSubmit.js';

test('addresses come out of a free-form field, typos named, repeats once', () => {
  assert.deepEqual(parseEmails('ana@studio.com, Bo@x.io;\n cy@y.co  ana@STUDIO.com'),
    { valid: ['ana@studio.com', 'Bo@x.io', 'cy@y.co'], invalid: [] });
  assert.deepEqual(parseEmails('ana@studio, nope, @x.io, ok@ok.com'),
    { valid: ['ok@ok.com'], invalid: ['ana@studio', 'nope', '@x.io'] });
  assert.deepEqual(parseEmails(''), { valid: [], invalid: [] });
  assert.deepEqual(parseEmails(null), { valid: [], invalid: [] });
});

test('each address is sorted by what the server answered', async () => {
  const answers = { 'a@x.co': 'granted', 'b@x.co': 'pending', 'c@x.co': 'already_member', 'd@x.co': undefined };
  const r = await runInvites(['a@x.co', 'b@x.co', 'c@x.co', 'd@x.co'], async (e) => answers[e]);
  assert.deepEqual(r.granted, ['a@x.co', 'd@x.co'], 'no answer reads as granted, as the wrappers default');
  assert.deepEqual(r.pending, ['b@x.co']);
  assert.deepEqual(r.fail, [{ email: 'c@x.co', reason: 'already a member' }]);
  assert.equal(r.limit, null);
});

test('a failure is kept with its reason and the run goes on', async () => {
  const r = await runInvites(['a@x.co', 'b@x.co'], async (e) => {
    if (e === 'a@x.co') throw new Error('sharing is paused on this account');
    return 'pending';
  });
  assert.deepEqual(r.fail, [{ email: 'a@x.co', reason: 'sharing is paused on this account' }]);
  assert.deepEqual(r.pending, ['b@x.co']);
});

test('the invite limit stops the run and hands back what it never reached', async () => {
  const sent = [];
  const r = await runInvites(['a@x.co', 'b@x.co', 'c@x.co'], async (e) => {
    if (e === 'b@x.co') throw new Error('invite limit reached: a new account can send 5 a day');
    sent.push(e);
    return 'pending';
  });
  assert.deepEqual(sent, ['a@x.co'], 'nothing is tried after the limit');
  assert.deepEqual(r.pending, ['a@x.co']);
  assert.deepEqual(r.limit, { reason: 'a new account can send 5 a day', unsent: ['b@x.co', 'c@x.co'] });
  assert.equal(inviteLimitReason('Invite limit reached: try tomorrow'), 'try tomorrow');
});

test('the abuse read is told which budget stopped a send', () => {
  // 0375's three refusals, with and without the prefix runInvites strips.
  assert.equal(inviteLimitKind('invite limit reached: sharing is paused on this account while we review unusual activity.'), 'paused');
  assert.equal(inviteLimitKind('a new account can send 5 invitations on its first day. You can send more tomorrow.'), 'first_day');
  assert.equal(inviteLimitKind('invite limit reached: you can send 40 invitations a day. You can send more tomorrow.'), 'daily');
  assert.equal(inviteLimitKind(null), 'daily');
});

test('the editor limit stops the run, says whether to ask the owner, and hands back what it never reached', async () => {
  const sent = [];
  const r = await runInvites(['a@x.co', 'b@x.co', 'c@x.co'], async (e) => {
    sent.push(e);
    if (e === 'b@x.co') {
      const err = new Error('editor limit reached: this account already has 10 people who can edit');
      err.hint = 'editor_limit_ask_owner';
      throw err;
    }
    return 'granted';
  });
  assert.deepEqual(sent, ['a@x.co', 'b@x.co'], 'nothing is tried after the limit');
  assert.deepEqual(r.granted, ['a@x.co']);
  assert.deepEqual(r.fail, []);
  assert.deepEqual(r.limit, {
    kind: 'editors', ask: true,
    reason: 'editor limit reached: this account already has 10 people who can edit',
    unsent: ['b@x.co', 'c@x.co'],
  });
});

test('by role: the editor limit stops the editors, and the viewers still go out', async () => {
  const sent = [];
  const why = 'editor limit reached: you have 10 people who can edit across your workspaces, the most a personal plan allows';
  const sendFor = (role) => async (email) => {
    sent.push(`${role}:${email}`);
    if (role === 'editor' && email === 'b@x.io') throw Object.assign(new Error(why), { hint: 'editor_limit' });
    return 'pending';
  };
  const r = await runInvitesByRole({ editor: ['a@x.io', 'b@x.io', 'c@x.io'], viewer: ['v@x.io'] }, sendFor);
  assert.deepEqual(sent, ['editor:a@x.io', 'editor:b@x.io', 'viewer:v@x.io']);
  assert.deepEqual(r.runs.map((x) => [x.role, x.pending]), [['editor', ['a@x.io']], ['viewer', ['v@x.io']]]);
  assert.equal(r.budget, null);
  assert.deepEqual(r.editors, { ask: false, reason: why, unsent: ['b@x.io', 'c@x.io'] });
});

test('by role: the invite budget stops everything after it, viewers included', async () => {
  const sendFor = () => async (email) => {
    if (email === 'b@x.io') throw new Error('invite limit reached: try tomorrow');
    return 'granted';
  };
  const r = await runInvitesByRole({ editor: ['a@x.io', 'b@x.io'], viewer: ['v@x.io', 'w@x.io'] }, sendFor);
  assert.deepEqual(r.runs.map((x) => x.role), ['editor']);
  assert.deepEqual(r.budget, { reason: 'try tomorrow', unsent: ['b@x.io', 'v@x.io', 'w@x.io'] });
  assert.equal(r.editors, null);
});

test('by role: an empty role is skipped, and what it was given is left as it was', async () => {
  const byRole = { editor: [], viewer: ['v@x.io'] };
  const r = await runInvitesByRole(byRole, () => async () => 'granted');
  assert.deepEqual(r.runs, [{ role: 'viewer', granted: ['v@x.io'], pending: [], fail: [] }]);
  assert.deepEqual(byRole, { editor: [], viewer: ['v@x.io'] });
});
