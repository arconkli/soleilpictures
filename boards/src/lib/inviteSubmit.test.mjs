// inviteSubmit.test.mjs — the one way invitations go out.
//
//   node --test src/lib/inviteSubmit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmails, runInvites, inviteLimitReason, inviteLimitKind } from './inviteSubmit.js';

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
