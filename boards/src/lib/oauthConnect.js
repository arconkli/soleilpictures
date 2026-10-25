// Who is connecting, in the shape the connect funnel records it.
//
// The consent page (pages/OAuthConsentPage.jsx) logs the steps a person takes
// there, and admin_mcp_funnel joins them per client to the server's own rows:
// registered (oauth_clients) → shown (oauth_authorize_view) → allowed
// (oauth_consent_allowed, and the server's oauth_consent_granted) → token →
// first call. Before these events, where a connection stopped was invisible.
//
// What may go into those events is decided here, once: the client's id (public,
// and already in the URL), what kind of registration it is, where it sends
// people back to as a HOST only (a callback's path or query can carry
// per-install values), the scopes asked for, and whether the account is new —
// a connection that is also a sign-up is the one this flow exists for. Never
// the code, the state, the challenge or the redirect URI itself.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// Where the client sends people back: an https host as it is ('claude.ai'),
// 'loopback' for a callback on the person's own computer (its port changes at
// every sign-in and says nothing), a private scheme as itself ('cursor:'), or
// 'invalid' when it is not a URL at all.
export function redirectHostOf(uri) {
  let u;
  try { u = new URL(String(uri || '')); } catch { return 'invalid'; }
  if (u.protocol === 'https:' || u.protocol === 'http:') {
    const host = u.hostname.toLowerCase();
    return LOOPBACK.has(host) ? 'loopback' : host;
  }
  return u.protocol.toLowerCase();
}

// A client that names itself by an https URL is a metadata document it hosts
// (CIMD); any other id was handed out by our registration endpoint (DCR).
export function clientKindOf(clientId) {
  return /^https:\/\//i.test(String(clientId || '')) ? 'cimd' : 'dcr';
}

// An account made within the hour: the person signed up on the way through.
export const NEW_ACCOUNT_MS = 60 * 60 * 1000;

export function connectEventProps({ clientId, redirectUri, scopes, userCreatedAt, now = Date.now() }) {
  const created = Date.parse(userCreatedAt || '');
  return {
    // Capped: the id comes from a link anyone can write.
    client_id: String(clientId || '').slice(0, 200),
    client_kind: clientKindOf(clientId),
    redirect_host: redirectHostOf(redirectUri),
    scopes: (scopes || []).join(' '),
    new_account: Number.isFinite(created) && now - created < NEW_ACCOUNT_MS,
  };
}
