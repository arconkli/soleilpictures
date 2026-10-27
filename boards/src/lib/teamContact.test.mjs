import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';
import {
  TEAM_CONTACT_NEEDS, TEAM_CONTACT_LIMITS, checkTeamContact, sendTeamContact, teamContactLine,
} from './teamContact.js';

const FORM = {
  name: '  Sam Rivera ', email: ' Sam@Northlight.Studio', company: 'Northlight Films',
  editors: '140', needs: ['sso', 'seats', 'sso', 'nonsense'], message: ' SSO through Okta. ',
};

test('a good form becomes the RPC arguments, tidied', () => {
  assert.deepEqual(checkTeamContact(FORM), {
    ok: true,
    request: {
      p_name: 'Sam Rivera', p_email: 'sam@northlight.studio', p_company: 'Northlight Films',
      p_editors: 140, p_needs: ['sso', 'seats'], p_message: 'SSO through Okta.',
    },
  });
  const bare = checkTeamContact({ name: 'Sam', email: 'sam@example.com', company: 'N', editors: '', message: '  ' });
  assert.equal(bare.request.p_editors, null);
  assert.equal(bare.request.p_message, null);
  assert.deepEqual(bare.request.p_needs, []);
});

test('the first field that needs another look is named', () => {
  const field = (patch) => checkTeamContact({ ...FORM, ...patch }).field;
  assert.equal(field({ name: ' ' }), 'name');
  assert.equal(field({ name: 'x'.repeat(121) }), 'name');
  assert.equal(field({ email: 'sam@northlight' }), 'email');
  assert.equal(field({ email: 'sam @x.io' }), 'email');
  assert.equal(field({ company: '' }), 'company');
  assert.equal(field({ editors: '2.5' }), 'editors');
  assert.equal(field({ editors: '0' }), 'editors');
  assert.equal(field({ editors: 'lots' }), 'editors');
  assert.equal(field({ message: 'x'.repeat(2001) }), 'message');
});

test('the limits and the needs are the ones 0542 enforces', () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, '0542_team_contact.sql'), 'utf8');
  const L = TEAM_CONTACT_LIMITS;
  assert.ok(sql.includes(`char_length(name) between 1 and ${L.name}`));
  assert.ok(sql.includes(`char_length(company) between 1 and ${L.company}`));
  assert.ok(sql.includes(`char_length(email) between 3 and ${L.email}`));
  assert.ok(sql.includes(`char_length(message) <= ${L.message}`));
  assert.ok(sql.includes(`editors between 1 and ${L.editors}`));
  const keys = TEAM_CONTACT_NEEDS.map((n) => `'${n.key}'`).join(', ');
  assert.ok(sql.includes(`array[${keys}]`), keys);
  assert.equal(TEAM_CONTACT_NEEDS[2].label, 'More than 100 seats');
});

test('sending: the answer, the refusals by hint, and a throw, never thrown on', async () => {
  const client = (answer) => ({ rpc: async (name, args) => { client.last = { name, args }; return answer; } });
  const ok = client({ data: 'sent', error: null });
  assert.deepEqual(await sendTeamContact(ok, { p_name: 'Sam' }), { ok: true, status: 'sent' });
  assert.deepEqual(client.last, { name: 'request_team_contact', args: { p_name: 'Sam' } });
  assert.deepEqual(await sendTeamContact(client({ data: 'already', error: null }), {}), { ok: true, status: 'already' });
  assert.deepEqual(await sendTeamContact(client({ data: null, error: { hint: 'team_contact_busy' } }), {}), { ok: false, error: 'busy' });
  assert.deepEqual(await sendTeamContact(client({ data: null, error: { hint: 'team_contact_invalid' } }), {}), { ok: false, error: 'invalid' });
  assert.deepEqual(await sendTeamContact(client({ data: null, error: { message: 'Failed to fetch' } }), {}), { ok: false, error: 'network' });
  assert.deepEqual(await sendTeamContact({ rpc: async () => { throw new Error('offline'); } }, {}), { ok: false, error: 'network' });
});

test('the words after Send', () => {
  const who = { name: 'Sam Rivera', email: 'sam@northlight.studio' };
  assert.deepEqual(teamContactLine({ ok: true, status: 'sent' }, who), {
    title: 'Thanks, Sam. It’s with us.',
    body: 'We’ll write to sam@northlight.studio. Meanwhile a Team trial works for up to 100 seats, if you’d like to start now.',
  });
  assert.equal(teamContactLine({ ok: true, status: 'already' }, who).title, 'We already have your request, Sam.');
  assert.match(teamContactLine({ ok: false, error: 'busy' }, who).body, /hello@soleilpictures\.com/);
  assert.equal(teamContactLine({ ok: false, error: 'network' }, who).body, 'Check your connection and try again.');
});
