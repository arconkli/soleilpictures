import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentPages, readSnapshot, diffPages } from '../../scripts/seo-freshness.mjs';

// A page's `updated` date (sitemap lastmod, JSON-LD dateModified) must move
// with its words. scripts/seo-freshness.mjs hashes the words a reader sees on
// each search page into seoFreshness.json. When a hash differs from the
// snapshot while `updated` still equals the snapshot's date, the words changed
// and the date did not: bump `updated` in the spec (to the day of the change).
// If the change really was a typo, say so instead of faking freshness:
//   npm run seo:fresh:accept -- --reason "typo in /tools/x"
// After bumping a date, run the same command (reason: "bumped /tools/x") so
// the snapshot follows. `npm run seo:fresh` prints what moved.

const snap = readSnapshot().pages;
const cur = await currentPages();
const moved = diffPages(snap, cur);

test('every page whose words changed carries a later updated date', () => {
  const stale = moved.filter((m) => m.kind === 'words' && m.snap.updated === m.cur.updated);
  assert.deepEqual(
    stale.map((m) => m.path), [],
    `words changed, so bump updated, or re-snapshot with a reason if the change was a typo (npm run seo:fresh:accept -- --reason "..."): ${stale.map((m) => m.path).join(', ')}`,
  );
});

test('every spec is in the snapshot', () => {
  const missing = moved.filter((m) => m.kind === 'new').map((m) => m.path);
  assert.deepEqual(missing, [], `not in seoFreshness.json, run npm run seo:fresh:accept -- --reason "...": ${missing.join(', ')}`);
});

test('every snapshot path has a spec', () => {
  const gone = moved.filter((m) => m.kind === 'gone').map((m) => m.path);
  assert.deepEqual(gone, [], `in seoFreshness.json but no spec, re-snapshot with a reason: ${gone.join(', ')}`);
});
