// Who vouches for an app on the consent screen (pages/OAuthConsentPage.jsx),
// and what the connection may do.
//
// The banner across the top of the card says one of three things:
//
//   - "Verified app · identified by claude.ai": a metadata document served
//     from one of VERIFIED_HOSTS. The name on the screen came from that host,
//     and only its owner can serve a document there.
//   - "Runs on this computer": the code goes back to a loopback address or an
//     app's own scheme. Any program on the computer could have started the
//     sign-in, so the person should continue only if they just did. This wins
//     over "verified": Claude Code's document is claude.ai's, but the program
//     that receives the code is whatever is listening on that port.
//   - "Not verified": anything else. A registered client's name is whatever it
//     typed into /oauth/register; a document from another host is that host's
//     word alone.
//
// Pure, so node tests it. gen-docs reads VERIFIED_HOSTS, so this module takes
// no Lingui macros: the banner, the footer and the sentence under the chips
// are in oauthTrustWords.js (app-only), which calls consentKind() below.

import { redirectHostOf } from './oauthConnect.js';

// Hosts whose metadata documents name apps people already know: Claude
// (claude.com is where Anthropic has said it may move), ChatGPT, VS Code.
export const VERIFIED_HOSTS = ['claude.ai', 'claude.com', 'chatgpt.com', 'vscode.dev'];

// Which of the three banners applies: { kind: 'verified' | 'local' |
// 'unverified', host, target }. `client` is /oauth/client's answer.
export function consentKind(client, redirectUri) {
  const target = redirectHostOf(redirectUri);
  if (target === 'loopback' || target.endsWith(':')) return { kind: 'local', host: '', target };
  const host = client?.client_kind === 'metadata' ? String(client.client_host || '').toLowerCase() : '';
  if (host && VERIFIED_HOSTS.includes(host)) return { kind: 'verified', host, target };
  return { kind: 'unverified', host, target };
}

// The scopes a person can grant, in the order the chips show them.
export const SCOPE_KEYS = ['read', 'write', 'delete'];

// What the screen offers: the scopes asked for, and whether "Allow deleting"
// is offered beside them. An app that asks to write but not to delete can
// still be allowed to delete; one that only reads is never offered it, since
// deleting implies writing. Unknown scopes are dropped, and an empty or
// missing list means read and write (the client's default, DEFAULT_SCOPES).
export function consentScopes(requested) {
  const asked = (requested || []).filter((s) => SCOPE_KEYS.includes(s));
  const shown = asked.length ? SCOPE_KEYS.filter((s) => asked.includes(s)) : ['read', 'write'];
  if (!shown.includes('read')) shown.unshift('read');
  if (shown.includes('delete') && !shown.includes('write')) shown.splice(1, 0, 'write');
  return { shown, offerDelete: shown.includes('write') && !shown.includes('delete') };
}
