// The party's host, with no imports, so scripts/stamp-build.mjs (node, at build
// time) and lib/partyHost.js (everything else) read the same literal. See
// partyHost.js for why it is written in code.
export const DEFAULT_PARTY_HOST = 'soleil-boards-party.arconkli.workers.dev';

// Where the party was until October 2026. Still reachable until PartyKit
// deletes the project on 2026-10-23: a /reset goes there too until then, so a
// tab that has not reloaded off it cannot push a pre-restore board back.
export const OLD_PARTY_HOST = 'soleil-boards-party.arconkli.partykit.dev';
export const OLD_PARTY_GONE_AFTER = '2026-10-24T00:00:00Z';
