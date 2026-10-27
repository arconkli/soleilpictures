// Who vouches for an app on the consent screen (pages/OAuthConsentPage.jsx),
// and what the connection may do, in the words the screen uses.
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
// Pure, so node tests it.

import { redirectHostOf } from './oauthConnect.js';

// Hosts whose metadata documents name apps people already know: Claude
// (claude.com is where Anthropic has said it may move), ChatGPT, VS Code.
export const VERIFIED_HOSTS = ['claude.ai', 'claude.com', 'chatgpt.com', 'vscode.dev'];

// Where the person is sent back to, as the footer says it.
export function returnLabel(redirectUri) {
  const host = redirectHostOf(redirectUri);
  if (host === 'loopback') return 'this computer (localhost)';
  if (host.endsWith(':')) return `the ${host.slice(0, -1)} app on this computer`;
  return host;
}

// The banner: { kind: 'verified' | 'local' | 'unverified', tone: 'ok' | 'warn',
// lead, rest }. `client` is /oauth/client's answer.
export function consentTrust(client, redirectUri) {
  const name = client?.client_name || 'that app';
  const target = redirectHostOf(redirectUri);
  if (target === 'loopback' || target.endsWith(':')) {
    return {
      kind: 'local', tone: 'warn', lead: 'Runs on this computer.',
      rest: `Only continue if you just started this from ${name} yourself.`,
    };
  }
  const host = client?.client_kind === 'metadata' ? String(client.client_host || '').toLowerCase() : '';
  if (host && VERIFIED_HOSTS.includes(host)) {
    return { kind: 'verified', tone: 'ok', lead: 'Verified app', rest: `· identified by ${host}` };
  }
  return {
    kind: 'unverified', tone: 'warn', lead: 'Not verified.',
    rest: host
      ? `Its details come from ${host}. Only continue if you trust it.`
      : `It registered itself. Only continue if you trust ${target}.`,
  };
}

// The scopes a person can grant, in the order the chips show them.
export const SCOPE_CHIPS = {
  read: 'Read',
  write: 'Create and change',
  delete: 'Delete',
};

// What the screen offers: the scopes asked for, and whether "Allow deleting"
// is offered beside them. An app that asks to write but not to delete can
// still be allowed to delete; one that only reads is never offered it, since
// deleting implies writing. Unknown scopes are dropped, and an empty or
// missing list means read and write (the client's default, DEFAULT_SCOPES).
export function consentScopes(requested) {
  const asked = (requested || []).filter((s) => s in SCOPE_CHIPS);
  const shown = asked.length ? Object.keys(SCOPE_CHIPS).filter((s) => asked.includes(s)) : ['read', 'write'];
  if (!shown.includes('read')) shown.unshift('read');
  if (shown.includes('delete') && !shown.includes('write')) shown.splice(1, 0, 'write');
  return { shown, offerDelete: shown.includes('write') && !shown.includes('delete') };
}

// One sentence under the chips, for what will be granted.
export function scopeSentence(granted) {
  if (granted.includes('delete')) {
    return 'It can see, change and delete. Deleted clusters go to the bin and can be restored.';
  }
  if (granted.includes('write')) return 'It can see and change your clusters. It can’t delete anything.';
  return 'It can see your clusters. It can’t change or delete anything.';
}
