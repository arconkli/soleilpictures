// shareAccess.test.mjs
//
// Unit test for the share panel's link derivation. Run with:
//   cd boards && node src/lib/shareAccess.test.mjs
//
// Plain Node ESM, no framework — exit 0 on pass (matches shareAsk/depthDock).
// Everything here is pure, so no Supabase and no rendered dialog.

import {
  ACCESS_MODES, activeLinks, deriveAccessMode, linkForMode, linkKind, otherModeLinks,
} from './shareAccess.js';

let failed = 0;
let passed = 0;
function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); failed++; } else { passed++; }
}

const NOW = 1_700_000_000_000;
const inDays = (n) => new Date(NOW + n * 86400000).toISOString();
const ME = 'user-me';
const THEM = 'user-them';

const view = (over) => ({ token: 't-view', kind: 'view', include_subboards: true, created_by: ME, ...over });
const invite = (over) => ({ token: 't-inv', kind: 'invite', role: 'editor', created_by: ME, ...over });

// --- activeLinks ------------------------------------------------------------
assert(activeLinks([view()], NOW).length === 1, 'a live, never-expiring link is active');
assert(activeLinks([view({ revoked_at: inDays(-1) })], NOW).length === 0, 'a revoked link is not');
assert(activeLinks([view({ expires_at: inDays(-1) })], NOW).length === 0, 'an expired link is not');
assert(activeLinks([view({ expires_at: inDays(1) })], NOW).length === 1, 'a future expiry is still active');
// A row with no token cannot be copied or revoked, so it is not a link.
assert(activeLinks([{ kind: 'view' }], NOW).length === 0, 'a tokenless row is not a link');
// NaN comparisons are all false, so an unparseable expiry must be read as dead
// rather than eternal — the safe direction for an access control.
assert(activeLinks([view({ expires_at: 'not a date' })], NOW).length === 0,
  'an unparseable expiry is treated as expired, never as never-expires');

// --- deriveAccessMode -------------------------------------------------------
assert(deriveAccessMode([], { selfUserId: ME, now: NOW }) === 'view',
  'nothing live opens on view — the mode whose button produces a link');
assert(deriveAccessMode([view()], { selfUserId: ME, now: NOW }) === 'view', 'a live view link → view');
assert(deriveAccessMode([invite()], { selfUserId: ME, now: NOW }) === 'edit', 'my live invite link → edit');
assert(deriveAccessMode([view(), invite()], { selfUserId: ME, now: NOW }) === 'edit',
  'both live → edit, the stronger grant, with the view link named as also live');
assert(deriveAccessMode([view({ revoked_at: inDays(-1) }), invite({ expires_at: inDays(-2) })],
  { selfUserId: ME, now: NOW }) === 'view',
  'dead rows of both kinds fall back to view, not to a mode nothing backs');

// Somebody else's invite link on a board shared with me must not decide my mode.
assert(deriveAccessMode([invite({ created_by: THEM })], { selfUserId: ME, now: NOW }) === 'view',
  "another user's invite link never selects edit for me");

// --- linkForMode ------------------------------------------------------------
const scoped = [view({ token: 'wide', include_subboards: true }),
                view({ token: 'narrow', include_subboards: false })];
assert(linkForMode(scoped, 'view', { includeSubboards: true, now: NOW })?.token === 'wide',
  'scope is part of a view link\'s identity — with sub-clusters picks the wide one');
assert(linkForMode(scoped, 'view', { includeSubboards: false, now: NOW })?.token === 'narrow',
  'without sub-clusters picks the narrow one');
assert(linkForMode([invite({ created_by: THEM })], 'edit', { selfUserId: ME, now: NOW }) === null,
  "edit never hands out a link someone else can revoke out from under you");
assert(linkForMode([invite({ role: 'viewer' })], 'edit', { selfUserId: ME, now: NOW }) === null,
  'a viewer-role invite link is not what the edit mode promises');
assert(linkForMode([view(), invite()], 'off', { selfUserId: ME, now: NOW }) === null,
  'off hands out nothing, whatever is live');

// --- otherModeLinks ---------------------------------------------------------
const both = [view(), invite()];
assert(otherModeLinks(both, 'edit', { selfUserId: ME, now: NOW }).length === 1,
  'switching to edit leaves the view link live and counted, never silently revoked');
assert(otherModeLinks(both, 'edit', { selfUserId: ME, now: NOW })[0].kind === 'view',
  'and it is the view link that is named');
assert(otherModeLinks([view()], 'view', { includeSubboards: true, now: NOW }).length === 0,
  'the link the button hands out is not also reported as "other"');
assert(otherModeLinks(both, 'off', { selfUserId: ME, now: NOW }).length === 2,
  'off reports every live link, because turning access off must revoke all of them');

// --- kind default -----------------------------------------------------------
// Rows written before 0189 have no kind column at all.
assert(linkKind({ token: 'x' }) === 'view', 'a kind-less legacy row reads as a view link');
assert(deriveAccessMode([{ token: 'x', created_by: ME }], { selfUserId: ME, now: NOW }) === 'view',
  'and derives the view mode, not edit');

// --- junk never throws into a render path ----------------------------------
for (const bad of [null, undefined, 'rows', 42, {}]) {
  assert(activeLinks(bad).length === 0, `junk rows are empty: ${JSON.stringify(bad)}`);
  assert(deriveAccessMode(bad, null) === 'view', `junk rows still derive a usable mode: ${JSON.stringify(bad)}`);
  assert(linkForMode(bad, 'view', null) === null, `junk rows hand out nothing: ${JSON.stringify(bad)}`);
  assert(otherModeLinks(bad, 'view', null).length === 0, `junk rows report no others: ${JSON.stringify(bad)}`);
}
assert(activeLinks([null, undefined, view()], NOW).length === 1, 'holes in the array are skipped');

// --- the picker's contract --------------------------------------------------
assert(ACCESS_MODES.length === 3, 'the picker offers exactly three states');
assert(ACCESS_MODES[0] === 'view', 'view leads — 29 of the first 32 links ever made were view links');
assert(ACCESS_MODES.includes('edit') && ACCESS_MODES.includes('off'), 'edit and off are the other two');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
