// What the connect funnel may record about a connection (lib/oauthConnect.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redirectHostOf, clientKindOf, connectEventProps, NEW_ACCOUNT_MS } from './oauthConnect.js';

test('a redirect is recorded as a host, never a path or a query', () => {
  assert.equal(redirectHostOf('https://claude.ai/api/mcp/auth_callback'), 'claude.ai');
  assert.equal(redirectHostOf('https://ChatGPT.com/connector_platform_oauth_redirect?x=1'), 'chatgpt.com');
  assert.equal(redirectHostOf('https://example.com:8443/cb/secret-install-id'), 'example.com');
});

test('a callback on the person\'s own computer is one bucket, whatever its port', () => {
  assert.equal(redirectHostOf('http://localhost:53121/callback'), 'loopback');
  assert.equal(redirectHostOf('http://127.0.0.1:8080/oauth'), 'loopback');
  assert.equal(redirectHostOf('http://[::1]:3000/cb'), 'loopback');
});

test('a private scheme is recorded as the scheme alone', () => {
  assert.equal(redirectHostOf('cursor://anysphere.cursor-retrieval/oauth/callback'), 'cursor:');
  assert.equal(redirectHostOf('vscode://vscode.github-authentication/did-authenticate'), 'vscode:');
  assert.equal(redirectHostOf(''), 'invalid');
  assert.equal(redirectHostOf('not a url'), 'invalid');
});

test('a client named by an https URL is a metadata document; anything else was registered', () => {
  assert.equal(clientKindOf('https://claude.ai/oauth/mcp-oauth-client-metadata'), 'cimd');
  assert.equal(clientKindOf('5d6f0c1e-1111-4a2b-9c3d-000000000000'), 'dcr');
  assert.equal(clientKindOf(''), 'dcr');
});

test('the props carry nothing a link could smuggle in, and say whether the account is new', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const props = connectEventProps({
    clientId: 'c-1',
    redirectUri: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz',
    scopes: ['read', 'write'],
    userCreatedAt: new Date(now - 5 * 60 * 1000).toISOString(),
    now,
  });
  assert.deepEqual(props, {
    client_id: 'c-1', client_kind: 'dcr', redirect_host: 'claude.ai', scopes: 'read write', new_account: true,
  });
  assert.ok(!JSON.stringify(props).includes('abc') && !JSON.stringify(props).includes('xyz'));

  const old = connectEventProps({ clientId: 'c', redirectUri: 'https://e/cb', scopes: [],
    userCreatedAt: new Date(now - NEW_ACCOUNT_MS - 1).toISOString(), now });
  assert.equal(old.new_account, false);
  assert.equal(connectEventProps({ clientId: 'c', redirectUri: 'https://e/cb' }).new_account, false);
  assert.equal(connectEventProps({ clientId: 'x'.repeat(5000), redirectUri: '' }).client_id.length, 200);
});
