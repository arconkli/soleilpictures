// The consent screen's banner, scopes and footer (lib/oauthTrust.js).
//
//   node --test src/lib/oauthTrust.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { consentTrust, returnLabel, consentScopes, scopeSentence, VERIFIED_HOSTS } from './oauthTrust.js';

const metadata = (host, name) => ({
  client_kind: 'metadata', client_host: host, client_name: name, client_id: `https://${host}/oauth/client.json`,
});
const registered = (name) => ({ client_kind: 'registered', client_host: null, client_name: name, client_id: 'soleil_abc' });

test('Claude and ChatGPT on the web are verified by the host that served their document', () => {
  const claude = consentTrust(metadata('claude.ai', 'Claude'), 'https://claude.ai/api/mcp/auth_callback');
  assert.deepEqual([claude.kind, claude.tone, claude.lead, claude.rest],
    ['verified', 'ok', 'Verified app', '· identified by claude.ai']);
  const gpt = consentTrust(metadata('chatgpt.com', 'ChatGPT'), 'https://chatgpt.com/connector_platform_oauth_redirect');
  assert.equal(gpt.kind, 'verified');
  assert.match(gpt.rest, /chatgpt\.com/);
});

test('a code that goes back to this computer warns, whoever vouches for the name', () => {
  // Claude Code's document is claude.ai's, but whatever listens on the port gets the code.
  for (const uri of ['http://localhost:53682/callback', 'http://127.0.0.1:33418/', 'cursor://anysphere.cursor-mcp/oauth/callback']) {
    const t = consentTrust(metadata('claude.ai', 'Claude Code'), uri);
    assert.equal(t.kind, 'local', uri);
    assert.equal(t.tone, 'warn');
    assert.equal(t.rest, 'Only continue if you just started this from Claude Code yourself.');
  }
  assert.equal(consentTrust(registered('Cursor'), 'cursor://anysphere.cursor-mcp/oauth/callback').kind, 'local');
});

test('anything else is not verified, and says whose word the name is', () => {
  const self = consentTrust(registered('Claude'), 'https://moodboard-helper.example.com/cb');
  assert.deepEqual([self.kind, self.tone, self.lead], ['unverified', 'warn', 'Not verified.']);
  assert.equal(self.rest, 'It registered itself. Only continue if you trust moodboard-helper.example.com.');
  // A registered client that calls itself Claude and sends to Claude's callback is still not verified.
  assert.equal(consentTrust(registered('Claude'), 'https://claude.ai/api/mcp/auth_callback').kind, 'unverified');
  const other = consentTrust(metadata('tools.example.com', 'Shot Planner'), 'https://tools.example.com/cb');
  assert.equal(other.kind, 'unverified');
  assert.equal(other.rest, 'Its details come from tools.example.com. Only continue if you trust it.');
  // A look-alike host is another host.
  assert.equal(consentTrust(metadata('claude.ai.example.com', 'Claude'), 'https://claude.ai.example.com/cb').kind, 'unverified');
});

test('only the hosts people know are verified, and never a private scheme', () => {
  assert.deepEqual(VERIFIED_HOSTS, ['claude.ai', 'claude.com', 'chatgpt.com', 'vscode.dev']);
  for (const host of VERIFIED_HOSTS) assert.match(host, /^[a-z0-9.-]+\.[a-z]+$/);
});

test('the footer names where the person goes back to', () => {
  assert.equal(returnLabel('https://claude.ai/api/mcp/auth_callback'), 'claude.ai');
  assert.equal(returnLabel('http://localhost:53682/callback'), 'this computer (localhost)');
  assert.equal(returnLabel('http://127.0.0.1:33418/'), 'this computer (localhost)');
  assert.equal(returnLabel('cursor://anysphere.cursor-mcp/oauth/callback'), 'the cursor app on this computer');
});

test('deleting is offered beside writing, never instead of reading alone', () => {
  assert.deepEqual(consentScopes(['read', 'write']), { shown: ['read', 'write'], offerDelete: true });
  assert.deepEqual(consentScopes([]), { shown: ['read', 'write'], offerDelete: true });
  assert.deepEqual(consentScopes(undefined), { shown: ['read', 'write'], offerDelete: true });
  assert.deepEqual(consentScopes(['read']), { shown: ['read'], offerDelete: false });
  assert.deepEqual(consentScopes(['read', 'write', 'delete']), { shown: ['read', 'write', 'delete'], offerDelete: false });
  // As the database normalises them: delete implies write, read is always there, order is fixed.
  assert.deepEqual(consentScopes(['delete']), { shown: ['read', 'write', 'delete'], offerDelete: false });
  assert.deepEqual(consentScopes(['write', 'read', 'mcp']), { shown: ['read', 'write'], offerDelete: true });
});

test('one sentence says what will be granted', () => {
  assert.equal(scopeSentence(['read']), 'It can see your clusters. It can’t change or delete anything.');
  assert.equal(scopeSentence(['read', 'write']), 'It can see and change your clusters. It can’t delete anything.');
  assert.match(scopeSentence(['read', 'write', 'delete']), /^It can see, change and delete\. .*bin.*restored/);
});
