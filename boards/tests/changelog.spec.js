// The public changelog (/changelog, ChangelogPage.jsx over the generated
// registries). Content-agnostic by design: every assertion derives from the
// registry, so entries can be added and rewritten without touching this file.
// Same discipline as docsite.spec.js and seo-listicle.spec.js.
//
// NOTE ON SCOPE: the Playwright webServer is vite, not the Worker, so this
// covers the hydrated React surface only. The Worker's crawlable injection, the
// JSON-LD, the RSS feed, the real 404 on /changelog/<anything> and the sitemap
// entry are asserted by src/lib/changelog.test.mjs (against the generated
// artifacts) and by the edge checks in the release process.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';
import { CHANGELOG_ENTRIES, CHANGELOG_META } from '../src/lib/changelogIndex.js';
import { CHANGELOG_CONTENT } from '../src/lib/changelogContent.js';

const NEWEST = CHANGELOG_ENTRIES[0];
const OLDEST = CHANGELOG_ENTRIES[CHANGELOG_ENTRIES.length - 1];

test('renders every entry, newest first, with the extractable answer', async ({ page }) => {
  await routeAnalytics(page, []);
  await page.goto('/changelog');

  await expect(page.locator('.docs-article h1')).toHaveText(CHANGELOG_META.h1);
  await expect(page.locator('.docs-answer')).toHaveText(CHANGELOG_META.answer);
  await expect(page).toHaveTitle(CHANGELOG_META.title);

  // Every entry is on the ONE page — that is the whole design, so assert the
  // count rather than spot-checking the first.
  const entries = page.locator('.changelog-entry');
  await expect(entries).toHaveCount(CHANGELOG_ENTRIES.length);
  await expect(page.locator('.changelog-title')).toHaveText(CHANGELOG_ENTRIES.map((e) => e.title));

  // Reverse-chronological. A changelog that leads with an old week is a
  // changelog that reads as abandoned.
  const ids = await entries.evaluateAll((els) => els.map((el) => el.id));
  expect(ids).toEqual(CHANGELOG_ENTRIES.map((e) => e.date));
  expect(ids).toEqual([...ids].sort().reverse());

  // The machine-readable twins are advertised, not merely present.
  await expect(page.locator('.docs-footer a[href="/changelog.md"]')).toBeVisible();
  await expect(page.locator('.docs-footer a[href="/changelog.xml"]')).toBeVisible();
});

test('entry bodies render their blocks, and heading ids are scoped to the entry', async ({ page }) => {
  await routeAnalytics(page, []);
  await page.goto('/changelog');

  const entry = page.locator(`[id="${NEWEST.date}"]`);
  await expect(entry.locator('.changelog-summary')).toHaveText(NEWEST.summary);

  const blocks = CHANGELOG_CONTENT[NEWEST.date];
  const expected = (type) => blocks.filter((b) => b.type === type).length;
  if (expected('list')) await expect(entry.locator('ul, ol')).toHaveCount(expected('list'));
  if (expected('para')) await expect(entry.locator('p:not(.changelog-date):not(.changelog-summary)'))
    .toHaveCount(expected('para'));

  // Two entries with a "Canvas" section must not both claim #canvas — the
  // second deep link would land on the wrong week. gen-docs prefixes body
  // heading ids with the entry date; this is that, seen from the DOM.
  const headingIds = await page.locator('.changelog-entry :is(h2, h3, h4)[id]')
    .evaluateAll((els) => els.map((el) => el.id));
  expect(new Set(headingIds).size).toBe(headingIds.length);
});

test('a #date deep link scrolls to its entry after hydration', async ({ page }) => {
  // The anchor a reader arrives on from RSS or a shared link lives in the
  // Worker's crawlable <main>, which React replaces on mount — so the browser's
  // own fragment jump has nothing to land on and ChangelogPage re-runs it.
  // Worth a test precisely because it fails silently: the page still renders,
  // it just ignores where you asked to go.
  await routeAnalytics(page, []);
  await page.goto(`/changelog#${OLDEST.date}`);

  const target = page.locator(`[id="${OLDEST.date}"]`);
  await expect(target).toBeVisible();
  await expect.poll(async () => {
    const box = await target.boundingBox();
    return box ? Math.round(box.y) : null;
  }, { message: 'the oldest entry never scrolled into view' }).toBeLessThan(400);
});

test('the date rail lists every entry and jumps to it', async ({ page }) => {
  await routeAnalytics(page, []);
  await page.goto('/changelog');

  const rail = page.locator('.changelog-jump a');
  await expect(rail).toHaveCount(CHANGELOG_ENTRIES.length);

  await rail.last().click();
  const target = page.locator(`[id="${OLDEST.date}"]`);
  await expect.poll(async () => {
    const box = await target.boundingBox();
    return box ? Math.round(box.y) : null;
  }, { message: 'clicking the rail did not reach the oldest entry' }).toBeLessThan(400);

  // Gold marks the entry you are on — the same "active / selected / focused"
  // rule --soleil carries everywhere else in the product.
  await expect(page.locator('.changelog-jump a.is-active')).toHaveCount(1);
});
