// Where the party is: live board sync, workspace presence, uploads and signed
// image reads, share and public bundles, the admin universe stream. One answer
// for every client module, the Worker and Scout.
//
// It moved once. Until October 2026 it was PartyKit's hosted platform
// (OLD_PARTY_HOST in partyDefaults.js), which stopped taking deploys on the
// 16th and deleted its projects on the 23rd; since then it is our own Worker
// (boards/party/, `npm run deploy:party`).
//
// The host is written in code (partyDefaults.js), not in a Workers Builds
// variable. The old VITE_PARTYKIT_HOST lived only in the dashboard, so moving
// the party needed a dashboard edit nobody could review, and a build without
// it fell back to localhost. Now a move is a commit, and the build stamps the result into
// buildInfo.js (scripts/stamp-build.mjs) so /api/build-info reports exactly
// what this bundle uses — which is how an open tab knows to reload when the
// host changes again (lib/buildWatch.js).
//
// VITE_PARTY_HOST overrides it for local work against `npm run dev:party`
// (localhost:1999). The old VITE_PARTYKIT_HOST is deliberately not read: it
// still names PartyKit in the dashboard.

import { PARTY_HOST as STAMPED } from './buildInfo.js';
import { DEFAULT_PARTY_HOST } from './partyDefaults.js';

export { DEFAULT_PARTY_HOST };

export const PARTY_HOST = STAMPED
  || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_PARTY_HOST)
  || DEFAULT_PARTY_HOST;

// Plain HTTP and ws:// only for a party on this machine.
export const PARTY_PROTOCOL = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(PARTY_HOST) ? 'http' : 'https';
export const PARTY_ORIGIN = `${PARTY_PROTOCOL}://${PARTY_HOST}`;
