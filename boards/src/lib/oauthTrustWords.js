// The consent screen's words (pages/OAuthConsentPage.jsx), read through Lingui.
// App-only: the logic they hang on (which banner, which scopes) is in
// oauthTrust.js, which gen-docs and node tests read and which takes no macros.
import { t } from '@lingui/core/macro';
import { redirectHostOf } from './oauthConnect.js';
import { consentKind } from './oauthTrust.js';

// Where the person is sent back to, as the footer says it.
export function returnLabel(redirectUri) {
  const host = redirectHostOf(redirectUri);
  if (host === 'loopback') return t`this computer (localhost)`;
  if (host.endsWith(':')) {
    const app = host.slice(0, -1);
    return t`the ${app} app on this computer`;
  }
  return host;
}

// The banner: { kind: 'verified' | 'local' | 'unverified', tone: 'ok' | 'warn',
// lead, rest }. `client` is /oauth/client's answer.
export function consentTrust(client, redirectUri) {
  const name = client?.client_name || t`that app`;
  const { kind, host, target } = consentKind(client, redirectUri);
  if (kind === 'local') {
    return {
      kind, tone: 'warn', lead: t`Runs on this computer.`,
      rest: t`Only continue if you just started this from ${name} yourself.`,
    };
  }
  if (kind === 'verified') {
    return { kind, tone: 'ok', lead: t`Verified app`, rest: t`· identified by ${host}` };
  }
  return {
    kind, tone: 'warn', lead: t`Not verified.`,
    rest: host
      ? t`Its details come from ${host}. Only continue if you trust it.`
      : t`It registered itself. Only continue if you trust ${target}.`,
  };
}

// The scope chips' labels, by scope key (SCOPE_KEYS in oauthTrust.js).
export const SCOPE_CHIPS = {
  get read() { return t`Read`; },
  get write() { return t`Create and change`; },
  get delete() { return t`Delete`; },
};

// One sentence under the chips, for what will be granted.
export function scopeSentence(granted) {
  if (granted.includes('delete')) {
    return t`It can see, change and delete. Deleted clusters go to the bin and can be restored.`;
  }
  if (granted.includes('write')) return t`It can see and change your clusters. It can’t delete anything.`;
  return t`It can see your clusters. It can’t change or delete anything.`;
}
