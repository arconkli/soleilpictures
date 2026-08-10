// Public documentation (/docs/*, DocsPage.jsx over the generated registries).
// Content-agnostic by design: every assertion derives from the registry, so the
// prose can be rewritten without touching this file. Same discipline as
// seo-listicle.spec.js.
//
// NOTE ON SCOPE: the Playwright webServer is vite, not the Worker, so this
// covers the hydrated React surface only. The Worker's crawlable injection,
// the real 404 and the sitemap entries are asserted by src/lib/docsite.test.mjs
// (against the generated HTML) and by the edge checks in the release process.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';
import { DOCS_PAGES, DOCS_SECTIONS, getDocsPage } from '../src/lib/docsiteIndex.js';
import { DOCS_CONTENT } from '../src/lib/docsiteContent.js';

const HUB = getDocsPage('/docs');
const API = getDocsPage('/docs/api');
// A page with a table, code and a callout, so the block renderer is covered on
// something real rather than a page chosen for being simple.
const RICH = getDocsPage('/docs/api/cards');

test('hub renders: h1, extractable answer, nav sections, machine-readable footer', async ({ page }) => {
  await routeAnalytics(page, []);
  await page.goto(HUB.path);

  await expect(page.locator('.docs-article h1')).toHaveText(HUB.h1);
  await expect(page.locator('.docs-answer')).toHaveText(HUB.answer);
  await expect(page).toHaveTitle(HUB.title);

  // Every section with pages appears in the nav as a (collapsible) heading.
  const labels = DOCS_SECTIONS
    .filter((s) => DOCS_PAGES.some((p) => p.section === s.id))
    .map((s) => s.label);
  await expect(page.locator('.docs-nav-head')).toHaveText(labels);

  // Sections are collapsed except the one you are in, so the nav reads as a
  // map rather than a 55-item wall.
  const openLinks = await page.locator('.docs-nav-section.is-open a').count();
  expect(openLinks).toBeGreaterThan(0);
  expect(openLinks).toBeLessThan(DOCS_PAGES.length);

  // The AI-facing artifacts are advertised, not just present.
  await expect(page.locator('.docs-footer a[href="/llms.txt"]')).toBeVisible();
  await expect(page.locator('.docs-footer a[href="/api/v1/openapi.json"]')).toBeVisible();
});

test('a deep page renders every block type and links to its markdown twin', async ({ page }) => {
  await routeAnalytics(page, []);
  await page.goto(RICH.path);

  await expect(page.locator('.docs-article h1')).toHaveText(RICH.h1);

  const blocks = DOCS_CONTENT[RICH.path];
  const expected = (type) => blocks.filter((b) => b.type === type).length;

  await expect(page.locator('.docs-table-wrap table')).toHaveCount(expected('table'));
  await expect(page.locator('.docs-code pre')).toHaveCount(expected('code'));
  await expect(page.locator('.docs-callout')).toHaveCount(expected('callout'));

  // Every H2 in the content is an anchor target, which is what the TOC and
  // every deep link into these docs depend on.
  // Ids are generated as [a-z0-9-] by slugify(), so they need no escaping.
  const h2s = blocks.filter((b) => b.type === 'heading' && b.depth === 2);
  for (const h of h2s) {
    expect(h.id, 'heading ids must stay selector-safe').toMatch(/^[a-z0-9-]+$/);
    await expect(page.locator(`#${h.id}`)).toBeVisible();
  }
  await expect(page.locator('.docs-toc a')).toHaveCount(h2s.length);

  await expect(page.locator(`.docs-meta a[href="${RICH.path}.md"]`)).toBeVisible();
});

test('the content actually scrolls', async ({ page }) => {
  // Regression guard. html/body/#root are position:fixed + overflow:hidden
  // app-wide, so a docs layout built on page scroll renders a page that cannot
  // be scrolled at all — which is exactly what shipped the first time. The
  // content must scroll inside .docs-scroll, and the nav must not move with it.
  await routeAnalytics(page, []);
  await page.goto(RICH.path);

  const scroller = page.locator('.docs-scroll');
  const overflows = await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 50);
  expect(overflows, 'the docs content must overflow its scroll container').toBe(true);

  // behavior:'instant' because the container sets scroll-behavior:smooth —
  // a plain scrollTop assignment animates, and reads back mid-flight.
  await scroller.evaluate((el) => el.scrollTo({ top: 400, behavior: 'instant' }));
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);

  // The window itself must NOT scroll — if it does, the app shell is unlocked
  // and the canvas becomes pannable as a unit on iOS.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // The sidebar stays put while the article moves.
  const navTop = await page.locator('.docs-nav').evaluate((el) => el.getBoundingClientRect().top);
  expect(navTop).toBeLessThan(200);
});

test('nav marks the current page and moves between pages', async ({ page }) => {
  await routeAnalytics(page, []);
  await page.goto(API.path);

  const current = page.locator('.docs-nav a[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText(API.navLabel);

  // Prev/next follow the generator's reading order.
  const i = DOCS_PAGES.findIndex((p) => p.path === API.path);
  if (i > 0) await expect(page.locator('.docs-prev')).toContainText(DOCS_PAGES[i - 1].navLabel);
  if (i < DOCS_PAGES.length - 1) {
    await expect(page.locator('.docs-next')).toContainText(DOCS_PAGES[i + 1].navLabel);
  }
});

test('search filters the nav and reports an honest empty state', async ({ page }) => {
  await routeAnalytics(page, []);
  await page.goto(HUB.path);

  // A search must expand every section it matched — a hit hidden inside a
  // collapsed section is a search that looks broken. Assert the obviously
  // correct page surfaced, and that results stay a subset of the corpus; not an
  // exact count, which would just encode today's prose.
  await page.locator('.docs-search').fill('screenplay');
  const hits = page.locator('.docs-nav-section a');
  await expect(hits.filter({ hasText: getDocsPage('/docs/documents/screenplay').navLabel })).toHaveCount(1);
  expect(await hits.count()).toBeLessThan(DOCS_PAGES.length);

  await page.locator('.docs-search').fill('zzzznothing');
  await expect(page.locator('.docs-nav-empty')).toBeVisible();
});

test('an unknown docs path renders not-found, never page content', async ({ page }) => {
  // The Worker serves this document with a real HTTP 404. Rendering docs
  // content here would be a soft-404 — content at a URL that says it is gone.
  await routeAnalytics(page, []);
  await page.goto('/docs/definitely-not-a-real-page');

  await expect(page.locator('.docs-article')).toHaveCount(0);
  await expect(page.locator('.public-empty-title')).toHaveText('Page not found');
});

test('every page in the registry loads without a console error', async ({ page }) => {
  // Cheap insurance across the whole corpus: a block shape the renderer does
  // not handle would throw here rather than in front of a reader.
  // 55 real navigations against the dev server does not fit the default 30s.
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await routeAnalytics(page, []);

  for (const p of DOCS_PAGES) {
    await page.goto(p.path);
    await expect(page.locator('.docs-article h1')).toHaveText(p.h1);
  }
  expect(errors, `console errors across ${DOCS_PAGES.length} docs pages`).toEqual([]);
});
