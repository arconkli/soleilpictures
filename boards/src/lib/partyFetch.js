// partyFetch — the main Worker's server-side calls into the party Worker (a
// move's /reset in worker.js, the API's multipart uploads in worker-api.js).
//
// Cloudflare refuses a fetch from one workers.dev Worker to another on the same
// account (error 1042, answered as a 404). The preview runs on workers.dev
// (main-soleil-boards.arconkli.workers.dev) and so does the party, so on the
// preview every one of those calls failed — every move between clusters among
// them — from the day the party left PartyKit, whose host was another
// account's. Production's custom domain was never refused.
//
// A service binding (wrangler.toml [[services]] PARTY) reaches the party
// Worker directly, from either host. It is used only for the party Worker it
// names: a call to any other host (PartyKit's, or a VITE_PARTY_HOST pointed at
// a local party) goes out as an ordinary fetch, and so does everything when
// the binding is missing.

import { DEFAULT_PARTY_HOST } from './partyDefaults.js';

const hostOf = (url) => {
  try { return new URL(String(url)).host; } catch (_) { return ''; }
};

export function partyFetch(env, url, init, { fetchImpl = fetch } = {}) {
  const party = env?.PARTY;
  if (party && typeof party.fetch === 'function' && hostOf(url) === DEFAULT_PARTY_HOST) {
    return party.fetch(url, init);
  }
  return fetchImpl(url, init);
}
