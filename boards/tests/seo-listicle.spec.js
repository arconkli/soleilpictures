// /best/* listicle pages (SeoListiclePage.jsx over lib/seoListicles.js).
// Content-agnostic by design: every assertion derives from the registry spec,
// so the authoring pass can rewrite prose without touching this file.
// No Supabase: boards RPC, thumbnails, and analytics are fulfilled locally.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';
import { SEO_LISTICLE_PAGES, listicleToc, listicleTrustChips, formatRating } from '../src/lib/seoListicles.js';

const SPEC = SEO_LISTICLE_PAGES[0];   // /best/pureref-alternatives

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAABAAAAAQCAYAAAAf8/9hAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function routeMedia(page) {
  await page.route('**/rest/v1/rpc/list_public_boards**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/public-thumb/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
  await page.route('**/landing/*.webp', (route) =>
    route.fulfill({ status: 200, contentType: 'image/webp', body: PNG_1PX }));
}

test('renders the full listicle: hero, answer, disclosure, TOC, table, reviews, FAQ, author', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeMedia(page);
  await page.goto(SPEC.path);

  await expect(page.locator('.seo-h1')).toHaveText(SPEC.h1);
  await expect(page.locator('.seo-li-byline')).toContainText(SPEC.author.name);
  await expect(page.locator('#answer .seo-li-answer')).toHaveText(SPEC.answer);
  await expect(page.locator('.seo-li-disclosure')).toHaveText(SPEC.disclosure);

  // Hero credibility chips are derived from the spec, never authored.
  await expect(page.locator('.seo-li-trust li')).toHaveText(listicleTrustChips(SPEC));

  // Ranked pick cards + TOC entries mirror the registry exactly: one <li> per
  // item, ranks 1-3 carded, the rest compact rows.
  await expect(page.locator('.seo-li-ranklist li')).toHaveCount(SPEC.items.length);
  await expect(page.locator('.seo-li-ranklist .is-podium')).toHaveCount(3);
  await expect(page.locator('.seo-li-ranklist .is-row')).toHaveCount(SPEC.items.length - 3);
  await expect(page.locator('[data-lp-cta="pick:clusters"]')).toHaveCount(1);
  await expect(page.locator('.seo-li-toc ol li')).toHaveCount(listicleToc(SPEC).length);

  // Comparison table: header = Tool + columns; one row per item; ours flagged.
  // SCOPED to #table: .seo-li-table is now worn by the head-to-head and platform
  // tables too, so a bare selector counts every table on the page.
  const headers = page.locator('#table .seo-li-table thead th');
  await expect(headers).toHaveCount(1 + SPEC.columns.length);
  await expect(page.locator('#table .seo-li-table tbody tr')).toHaveCount(SPEC.items.length);
  await expect(page.locator('.seo-li-usrow')).toHaveCount(1);
  // Every table row link is instrumented (they used to be dark).
  await expect(page.locator('[data-lp-cta^="table:"]')).toHaveCount(SPEC.items.length);

  // Every review card exists with its anchor id, score, pricing asOf, pros/cons.
  for (const it of SPEC.items) {
    const card = page.locator(`#${it.anchor}`);
    await expect(card).toHaveCount(1);
    await expect(card.locator('.seo-li-score-n')).toHaveText(formatRating(it.rating));
    await expect(card.locator('.seo-li-specs dd').first()).toHaveText(it.bestFor);
    await expect(card.locator('.seo-li-pros li')).toHaveCount(it.pros.length);
    await expect(card.locator('.seo-li-cons li')).toHaveCount(it.cons.length);
    await expect(card.locator('.seo-li-pricing')).toContainText(`as of ${it.pricing.asOf}`);
  }
  await expect(page.locator('.seo-li-item-us')).toHaveCount(1);
  // Our review carries the live product shot in the shared browser frame.
  await expect(page.locator('.seo-li-item-us .seo-frame .seo-frame-shot')).toHaveCount(1);

  // Interstitial after our item + our in-card CTA.
  await expect(page.locator('.seo-li-inter')).toHaveCount(SPEC.items.length >= 6 ? 2 : 1);
  await expect(page.locator('[data-lp-cta="item:clusters"]')).toHaveCount(1);

  // Head-to-head + platform matrix, both optional. These exist to give the
  // "X vs Y" and "runs on Z" queries a real section instead of a line in a
  // collapsed accordion, so the assertions are about STRUCTURE being reachable:
  // an h3 per matchup, its own anchor, and a platform row per tool aligned to
  // the columns. Every page carrying head-to-heads gets its own pass at the
  // bottom of this file; this block covers SPEC's alongside everything else.
  if (SPEC.headToHead) {
    await expect(page.locator('#head-to-head')).toHaveCount(1);
    for (const m of SPEC.headToHead.matchups) {
      const sec = page.locator(`#${m.slug}`);
      await expect(sec).toHaveCount(1);
      // The heading must BE the query — that is the whole point of the section.
      await expect(sec.locator('h3')).toHaveText(m.heading);
      await expect(sec.locator('.seo-li-h2h-verdict')).toHaveText(m.verdict);
      if (m.rows?.length) {
        await expect(sec.locator('tbody tr')).toHaveCount(m.rows.length);
      }
    }
  }
  if (SPEC.platforms) {
    const pl = page.locator('#platforms');
    await expect(pl).toHaveCount(1);
    await expect(pl.locator('thead th')).toHaveCount(1 + SPEC.platforms.columns.length);
    await expect(pl.locator('tbody tr')).toHaveCount(SPEC.platforms.rows.length);
  }

  // Tail sections + author box + related footer.
  for (const id of ['personas', 'mentions', 'honest', 'faq']) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await expect(page.locator('.seo-faq-item')).toHaveCount(SPEC.faq.length);
  await expect(page.locator('.seo-li-author-name')).toHaveText(SPEC.author.name);
  await expect(page.locator('.seo-related li a').first()).toBeVisible();
  // Footer spokes are instrumented too: spec.related, plus the three fixed
  // spokes every listicle carries — /explore, /pricing and /changelog. The
  // changelog is here because the question underneath a comparison page is
  // whether the thing is maintained, and an uninstrumented spoke is a click
  // the landing scorecard cannot see.
  await expect(page.locator('[data-lp-cta^="related:"]')).toHaveCount(SPEC.related.length + 3);

  // lp_view fired with the listicle page identity.
  await expect.poll(() =>
    rows.some((r) => r.event === 'lp_view' && r.props?.page === SPEC.path && r.props?.page_kind === 'listicle'),
  ).toBe(true);
});

test('TOC jump scrolls the .seo-scroll container to the target section', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeMedia(page);
  await page.goto(SPEC.path);

  const lastItem = SPEC.items[SPEC.items.length - 1];
  await page.locator(`.seo-li-ranklist a[href="#${lastItem.anchor}"]`).click();
  await expect.poll(async () => {
    const top = await page.locator(`#${lastItem.anchor}`).evaluate((el) => el.getBoundingClientRect().top);
    return top >= 0 && top < 300;
  }, { timeout: 5000 }).toBe(true);
  // Container scrolled (not the window — the page body is the fixed shell).
  expect(await page.locator('.seo-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test('FAQ opens and reports lp_faq; deep-linked hash lands on its section', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeMedia(page);
  await page.goto(SPEC.path);

  await page.locator('.seo-faq-item summary').first().click();
  // Leave the tab — the dwell beacon flushes the whole batched queue.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => rows.some((r) => r.event === 'lp_faq'), { timeout: 8000 }).toBe(true);

  const target = SPEC.items[SPEC.items.length - 1].anchor;
  await page.goto(`${SPEC.path}#${target}`);
  await expect.poll(async () => {
    const top = await page.locator(`#${target}`).evaluate((el) => el.getBoundingClientRect().top);
    return top >= 0 && top < 300;
  }, { timeout: 5000 }).toBe(true);
});

test('unknown /best/ path renders the branded NotFound client-side', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeMedia(page);
  await page.goto('/best/zzz-not-a-real-page');
  await expect(page.locator('.public-empty-title')).toHaveText('Page not found');
});

// Every page that carries the optional head-to-head shape, not just SPEC.
// SPEC is SEO_LISTICLE_PAGES[0] and the heavy test above would quadruple in
// runtime if it were parameterised, but these sections are the reason the
// queries they target have a home at all — shipping a second page's worth of
// them with no e2e coverage is how the third one arrives broken.
for (const spec of SEO_LISTICLE_PAGES.filter((p) => p.headToHead)) {
  test(`${spec.path}: head-to-head sections are reachable and deep-linkable`, async ({ page }) => {
    await routeAnalytics(page, []);
    await routeMedia(page);
    await page.goto(spec.path);

    await expect(page.locator('#head-to-head')).toHaveCount(1);
    await expect(page.locator('#head-to-head .seo-li-h2h')).toHaveCount(spec.headToHead.matchups.length);

    for (const m of spec.headToHead.matchups) {
      const sec = page.locator(`#${m.slug}`);
      await expect(sec).toHaveCount(1);
      // The heading has to BE the query, or the section is just more prose.
      await expect(sec.locator('h3')).toHaveText(m.heading);
      await expect(sec.locator('.seo-li-h2h-verdict')).toHaveText(m.verdict);
      if (m.rows?.length) await expect(sec.locator('tbody tr')).toHaveCount(m.rows.length);
    }

    // A matchup arrived at from a search result must actually land on it. This
    // is the assertion that would have caught the 63px undershoot from the
    // async board fetch — measured against the top of the scroll container.
    const last = spec.headToHead.matchups[spec.headToHead.matchups.length - 1];
    await page.goto(`${spec.path}#${last.slug}`);
    await expect(page.locator(`#${last.slug}`)).toBeVisible();
    await expect.poll(async () => {
      const box = await page.locator(`#${last.slug}`).boundingBox();
      return box ? Math.round(box.y) : null;
    }, { message: `${last.slug} did not land in view` }).toBeLessThan(200);
  });
}
