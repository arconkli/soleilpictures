import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentPages, readSnapshot, diffPages } from '../../scripts/seo-freshness.mjs';

// A page's `updated` date (sitemap lastmod, JSON-LD dateModified) must move
// with its words. scripts/seo-freshness.mjs hashes the words a reader sees on
// each search page into seoFreshness.json, and the snapshot must always match
// the specs: a page whose words or date moved since the last snapshot fails
// here until it is re-snapshotted, so a bumped date can never leave the
// baseline behind and the next edit to the same page is caught too.
//   Words changed: set `updated` to the day of the change, then
//     npm run seo:fresh:accept -- --reason "bumped /tools/x: <what changed>"
//   A typo, where a new date would fake freshness: keep the date, and
//     npm run seo:fresh:accept -- --reason "typo in /tools/x"
//   `npm run seo:fresh` prints what moved.

const snap = readSnapshot().pages;
const cur = await currentPages();
const moved = diffPages(snap, cur);

test('the snapshot matches every page, words and date', () => {
  const drift = moved.filter((m) => m.kind === 'words' || m.kind === 'date').map((m) => {
    if (m.kind === 'date') return `${m.path}: updated moved ${m.snap.updated} -> ${m.cur.updated} with no change to its words`;
    if (m.cur.updated > m.snap.updated) return `${m.path}: words changed and updated moved ${m.snap.updated} -> ${m.cur.updated}`;
    return `${m.path}: words changed, updated still ${m.cur.updated}; if the change was not made that day, set updated to the day it was (a typo keeps its date)`;
  });
  assert.deepEqual(drift, [], `${drift.join('\n')}\nThen re-snapshot: npm run seo:fresh:accept -- --reason "..."`);
});

test('every spec is in the snapshot', () => {
  const missing = moved.filter((m) => m.kind === 'new').map((m) => m.path);
  assert.deepEqual(missing, [], `not in seoFreshness.json, run npm run seo:fresh:accept -- --reason "...": ${missing.join(', ')}`);
});

test('every snapshot path has a spec', () => {
  const gone = moved.filter((m) => m.kind === 'gone').map((m) => m.path);
  assert.deepEqual(gone, [], `in seoFreshness.json but no spec, re-snapshot with a reason: ${gone.join(', ')}`);
});
