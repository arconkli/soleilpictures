// The parts of the OAuth server that are decidable without a database.
//
// The stateful half — single-use codes, PKCE comparison, refresh rotation —
// lives in SQL (migration 0224) precisely so it is enforced inside the
// statement that claims the row rather than by a branch that could be skipped.
// What is left here is URL judgement, scope parsing and the two discovery
// documents, and all three are things a client fails on silently: a redirect
// URI accepted too loosely is an open redirect, and a metadata document with a
// wrong field is a connection that never starts and never says why.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  redirectUriProblem, parseScopes,
  authorizationServerMetadata, protectedResourceMetadata,
} from '../worker-oauth.js';
import { mcpTraceName } from './mcpServer.js';
import { consentError, consentRequestProblem } from './oauthConsentCopy.js';

const ORIGIN = 'https://clusters.soleilpictures.com';

test('redirect URIs: https anywhere', () => {
  assert.equal(redirectUriProblem('https://claude.ai/api/mcp/auth_callback'), null);
  assert.equal(redirectUriProblem('https://example.com/cb?keep=1'), null);
  assert.equal(redirectUriProblem('https://example.com:8443/cb'), null);
});

test('redirect URIs: http only on loopback', () => {
  // RFC 8252 §7.3 — a command-line client has no domain and must be able to
  // receive a callback on a local port.
  assert.equal(redirectUriProblem('http://127.0.0.1:8976/callback'), null);
  assert.equal(redirectUriProblem('http://localhost:1455/cb'), null);
  assert.equal(redirectUriProblem('http://[::1]:9000/cb'), null);

  // Anything else over plain http would put an authorization code on the wire.
  assert.match(redirectUriProblem('http://example.com/cb'), /loopback/);
  assert.match(redirectUriProblem('http://127.0.0.1.evil.com/cb'), /loopback/);
});

test('redirect URIs: private schemes are how desktop and mobile clients receive one', () => {
  assert.equal(redirectUriProblem('cursor://anysphere.soleil/callback'), null);
  assert.equal(redirectUriProblem('com.example.app:/oauth'), null);
});

test('redirect URIs: browser-interpretable pseudo-schemes are refused', () => {
  for (const uri of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'blob:x']) {
    assert.ok(redirectUriProblem(uri), `${uri} must be refused`);
  }
});

test('redirect URIs: a fragment is refused', () => {
  // The authorization response is appended to the query; a URI that already
  // carries a fragment cannot be extended without ambiguity.
  assert.match(redirectUriProblem('https://example.com/cb#state'), /fragment/);
});

test('redirect URIs: garbage is refused, not accepted by default', () => {
  assert.ok(redirectUriProblem('not a url'));
  assert.ok(redirectUriProblem('/relative/path'));
  assert.ok(redirectUriProblem(''));
});

test('scopes: unknown scopes are dropped rather than refused', () => {
  // A client asking for `offline_access` or `profile` out of habit should get a
  // working connection with the scopes we DO have, not an error it cannot act on.
  assert.deepEqual(parseScopes('read write offline_access'), ['read', 'write']);
  assert.deepEqual(parseScopes('profile email'), ['read', 'write']); // nothing known → default
});

test('scopes: delete is never granted by asking for nothing', () => {
  // The product's rule is that an assistant may be allowed to build without
  // being allowed to destroy. A default that quietly included delete would
  // undo that for every connection made through this flow.
  for (const input of [undefined, '', null, [], 'garbage']) {
    assert.ok(!parseScopes(input).includes('delete'), `${JSON.stringify(input)} must not grant delete`);
  }
  assert.deepEqual(parseScopes('read write delete'), ['read', 'write', 'delete']);
});

test('scopes: order is canonical regardless of how they were asked for', () => {
  assert.deepEqual(parseScopes('delete write read'), ['read', 'write', 'delete']);
  assert.deepEqual(parseScopes(['WRITE', ' read ']), ['read', 'write']);
});

test('authorization server metadata carries what a client cannot proceed without', () => {
  const m = authorizationServerMetadata(ORIGIN);
  assert.equal(m.issuer, ORIGIN);
  assert.equal(m.authorization_endpoint, `${ORIGIN}/oauth/authorize`);
  assert.equal(m.token_endpoint, `${ORIGIN}/oauth/token`);
  assert.equal(m.registration_endpoint, `${ORIGIN}/oauth/register`);
  assert.deepEqual(m.response_types_supported, ['code']);
  assert.ok(m.grant_types_supported.includes('authorization_code'));
  assert.ok(m.grant_types_supported.includes('refresh_token'));
});

test('metadata advertises S256 and ONLY S256', () => {
  // OAuth 2.1 removes `plain`. Advertising it would invite a client to use it,
  // and a PKCE challenge that is the verifier protects against nothing.
  assert.deepEqual(authorizationServerMetadata(ORIGIN).code_challenge_methods_supported, ['S256']);
});

test('metadata promises the iss parameter, which obliges us to send it', () => {
  // RFC 9207: a client that reads this as true and then receives a response
  // WITHOUT `iss` is required to reject it. Advertising it and not sending it
  // would break every conforming client.
  assert.equal(authorizationServerMetadata(ORIGIN).authorization_response_iss_parameter_supported, true);
});

test('protected resource metadata names this server and its authorization server', () => {
  const m = protectedResourceMetadata(ORIGIN);
  assert.equal(m.resource, `${ORIGIN}/api/v1/mcp`);
  assert.deepEqual(m.authorization_servers, [ORIGIN]);
  assert.ok(m.scopes_supported.includes('read'));
  // Never advertise delete as part of basic functionality — a client following
  // the spec's guidance requests everything in scopes_supported up front.
  assert.ok(!m.scopes_supported.includes('delete'));
  assert.deepEqual(m.bearer_methods_supported, ['header']);
});

test('protected resource metadata describes whatever path was asked for', () => {
  // RFC 9728 §3.1: the metadata URL is the well-known prefix followed by the
  // resource's own path, and the document must describe THAT resource.
  assert.equal(protectedResourceMetadata(ORIGIN, { resource: `${ORIGIN}/api/v1` }).resource,
    `${ORIGIN}/api/v1`);
});

// ── The request log's MCP half ──────────────────────────────────────────────

test('an MCP call is logged by its TOOL, not by the route it shares with 32 others', () => {
  assert.equal(mcpTraceName({ method: 'tools/call', params: { name: 'add_cards' } }), 'add_cards');
  assert.equal(mcpTraceName({ method: 'tools/call', params: { name: 'arrange_board' } }), 'arrange_board');
});

test('a non-tool call is logged by its method, so tools/list stays distinguishable', () => {
  assert.equal(mcpTraceName({ method: 'tools/list' }), 'tools/list');
  assert.equal(mcpTraceName({ method: 'server/discover' }), 'server/discover');
});

test('a notification is not a call and gets no name', () => {
  assert.equal(mcpTraceName({ method: 'notifications/initialized' }), null);
  assert.equal(mcpTraceName({}), null);
  assert.equal(mcpTraceName(null), null);
});

test('a tools/call with no name still records that it was one', () => {
  assert.equal(mcpTraceName({ method: 'tools/call', params: {} }), 'tools/call');
});

test('a legacy batch is one HTTP request and gets one name', () => {
  // One log row per request keeps the counts agreeing with the rate limiter,
  // which also charges per request.
  assert.equal(mcpTraceName([{ method: 'tools/call', params: { name: 'get_board' } },
    { method: 'tools/list' }]), 'get_board');
});

test('a hostile tool name cannot blow up the log column', () => {
  const long = 'x'.repeat(500);
  assert.ok(mcpTraceName({ method: 'tools/call', params: { name: long } }).length <= 80);
  assert.equal(mcpTraceName({ method: 'tools/call', params: { name: 12345 } }), 'tools/call');
});

// ── The consent screen's words ──────────────────────────────────────────────
//
// Added after landing on the real thing: a stale authorize link rendered
// "THIS REQUEST CANNOT BE APPROVED / unknown client". Accurate, and useless to
// the person reading it — they did not choose the client and cannot register it.

test('a machine-facing error_description never reaches the person', () => {
  const { title, body } = consentError('invalid_client', 'unknown client');
  assert.ok(!/unknown client/i.test(body), 'the API string must not be echoed');
  assert.ok(!/unknown client/i.test(title));
  assert.match(body, /no longer registered/i);
});

test('every recognised failure says whether anything was shared', () => {
  // It is the actual question someone has on that screen, and the answer is
  // always no — each of these fires before a code is ever issued.
  for (const code of ['invalid_client', 'invalid_request', 'invalid_redirect_uri',
    'invalid_target', 'access_denied', 'server_error']) {
    assert.match(consentError(code).body, /nothing has been shared/i, `${code} must say it`);
    assert.ok(consentError(code).title.length > 0, `${code} needs a title`);
  }
});

test('an unrecognised code still produces something sayable', () => {
  assert.equal(consentError('some_new_code_we_have_not_seen').title, 'This request cannot be approved');
  // A short description from the server beats nothing when there is no code to
  // key on — but a giant one is not something to paste onto a page.
  assert.match(consentError(null, 'the sky fell').body, /the sky fell/);
  assert.ok(!/x{200}/.test(consentError(null, 'x'.repeat(400)).body));
});

test('a malformed authorize link is caught before any network call', () => {
  const ok = { clientId: 'c', redirectUri: 'https://e/cb', responseType: 'code',
    codeChallenge: 'x'.repeat(43), challengeMethod: 'S256' };
  assert.equal(consentRequestProblem(ok), null);
  for (const bad of [
    { ...ok, clientId: '' }, { ...ok, redirectUri: '' }, { ...ok, responseType: 'token' },
    { ...ok, codeChallenge: '' }, { ...ok, challengeMethod: 'plain' },
  ]) {
    assert.ok(consentRequestProblem(bad), 'must be refused');
    assert.match(consentRequestProblem(bad).body, /nothing has been shared/i);
  }
});
