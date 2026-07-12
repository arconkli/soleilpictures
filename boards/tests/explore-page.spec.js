// /explore public board index — the interactive browse layer (search, sort,
// topic filters, URL state, analytics) over route-intercepted fixtures.
// No Supabase: the RPC + thumbnails + analytics are all fulfilled locally.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';

// Shape mirrors list_public_boards (0136): priority desc, published_at desc.
const BOARDS = [
  { slug: 'world-cup-2026-moodboard', seo_title: 'World Cup 2026 Mood Board',
    seo_description: 'Kits, crowds and color for the summer tournament.',
    target_keyword: 'world cup 2026 mood board', priority: 5,
    published_at: '2026-07-09T00:00:00Z', thumb_updated_at: '2026-07-09T00:00:00Z', card_count: 24 },
  { slug: 'film-noir-look-book', seo_title: 'Film Noir Look Book',
    seo_description: 'Hard shadows, wet streets, venetian blinds.',
    target_keyword: 'film noir look book', priority: 4,
    published_at: '2026-07-08T00:00:00Z', thumb_updated_at: '2026-07-08T00:00:00Z', card_count: 18 },
  { slug: 'short-film-shot-list', seo_title: 'Short Film Shot List',
    seo_description: 'A complete two-day indie shoot, shot by shot.',
    target_keyword: 'short film shot list', priority: 4,
    published_at: '2026-07-07T00:00:00Z', thumb_updated_at: '2026-07-07T00:00:00Z', card_count: null },
  { slug: 'backrooms-fanart', seo_title: 'Backrooms Movie Fan Art',
    seo_description: 'Liminal yellow hallways from the fandom.',
    target_keyword: 'backrooms fan art', priority: 0,
    published_at: '2026-06-16T00:00:00Z', thumb_updated_at: '2026-06-16T00:00:00Z', card_count: 82 },
];

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function routeExplore(page, boards = BOARDS) {
  await page.route('**/rest/v1/rpc/list_public_boards**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(boards) }));
  await page.route('**/api/public-thumb/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
}

function titles(page) {
  return page.locator('.exp-grid .pubcard-title');
}

test('renders every published board with meta, hub links and CTA band', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeExplore(page);
  await page.goto('/explore');

  await expect(page.locator('.exp-grid .pubcard')).toHaveCount(4);
  await expect(page).toHaveTitle('Explore Boards — Soleil Clusters');
  await expect(page.locator('.exp-count')).toHaveText('4 boards');

  // Featured (priority 5) board leads and spans as the hero card.
  await expect(titles(page)).toHaveText([
    'World Cup 2026 Mood Board', 'Film Noir Look Book',
    'Short Film Shot List', 'Backrooms Movie Fan Art',
  ]);
  await expect(page.locator('.exp-feat .pubcard-title')).toHaveText('World Cup 2026 Mood Board');

  // Card meta: topic tag from the keyword matcher + card count when present.
  const first = page.locator('.exp-grid li').first();
  await expect(first.locator('.exp-tag')).toHaveText('Mood boards');
  await expect(first.locator('.exp-cards')).toHaveText('24 cards');
  // card_count null → no count badge.
  await expect(page.locator('.exp-grid li', { hasText: 'Shot List' }).locator('.exp-cards')).toHaveCount(0);

  // Cards link into /c/<slug>; hub-and-spoke landing links stay on the page.
  await expect(first.locator('.pubcard')).toHaveAttribute('href', '/c/world-cup-2026-moodboard');
  await expect(page.locator('.exp-tools-band .exp-chip', { hasText: 'Pricing' })).toBeVisible();
  await expect(page.locator('.seo-cta-primary')).toBeVisible();
});

test('search filters, highlights and clears; no-results has an escape hatch', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeExplore(page);
  await page.goto('/explore');
  await expect(page.locator('.exp-grid .pubcard')).toHaveCount(4);

  await page.locator('#exp-search-input').fill('noir');
  await expect(page.locator('.exp-grid .pubcard')).toHaveCount(1);
  await expect(page.locator('.exp-mark')).toHaveText('Noir');
  await expect(page.locator('.exp-count')).toHaveText('1 of 4');
  await expect(page).toHaveURL(/\/explore\?q=noir/);
  // Filtered views drop the featured hero treatment.
  await expect(page.locator('.exp-feat')).toHaveCount(0);

  // Multi-token AND across title + description.
  await page.locator('#exp-search-input').fill('indie shoot');
  await expect(titles(page)).toHaveText(['Short Film Shot List']);

  await page.locator('#exp-search-input').fill('zebra');
  await expect(page.locator('.exp-noresults')).toContainText('No boards match “zebra”');
  await page.locator('.exp-noresults .exp-chip').click();
  await expect(page.locator('.exp-grid .pubcard')).toHaveCount(4);
  await expect(page).toHaveURL(/\/explore$/);
});

test('sort control and topic chips reorder and filter the grid', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeExplore(page);
  await page.goto('/explore');
  await expect(page.locator('.exp-grid .pubcard')).toHaveCount(4);

  await page.locator('.exp-sort-btn', { hasText: 'A–Z' }).click();
  await expect(titles(page)).toHaveText([
    'Backrooms Movie Fan Art', 'Film Noir Look Book',
    'Short Film Shot List', 'World Cup 2026 Mood Board',
  ]);
  await expect(page).toHaveURL(/sort=az/);

  await page.locator('.exp-sort-btn', { hasText: 'Newest' }).click();
  await expect(titles(page)).toHaveText([
    'World Cup 2026 Mood Board', 'Film Noir Look Book',
    'Short Film Shot List', 'Backrooms Movie Fan Art',
  ]);

  // Topic chips derive from target keywords; clicking filters, re-click resets.
  const lookBooks = page.locator('.exp-topic', { hasText: 'Look books' });
  await lookBooks.click();
  await expect(titles(page)).toHaveText(['Film Noir Look Book']);
  await expect(page).toHaveURL(/topic=look-books/);
  await lookBooks.click();
  await expect(page.locator('.exp-grid .pubcard')).toHaveCount(4);
});

test('browse state hydrates from the URL and card clicks are instrumented', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeExplore(page);
  await page.goto('/explore?q=film&sort=az');

  await expect(page.locator('#exp-search-input')).toHaveValue('film');
  await expect(page.locator('.exp-sort-btn', { hasText: 'A–Z' })).toHaveAttribute('aria-pressed', 'true');
  await expect(titles(page)).toHaveText(['Film Noir Look Book', 'Short Film Shot List']);

  // The settled search query is logged once per session. Await it before the
  // card click navigates away (800ms debounce + 5s batch flush).
  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('explore_search');
  expect(rows.find((r) => r.event === 'explore_search').props.q).toBe('film');

  // Route /c/ so the click has somewhere to land, then assert the beacon.
  await page.route('**/c/film-noir-look-book', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>board</body></html>' }));
  await page.locator('.pubcard').first().click();
  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('explore_card_click');
  const click = rows.find((r) => r.event === 'explore_card_click');
  expect(click.props.slug).toBe('film-noir-look-book');
  expect(click.props.sort).toBe('az');
  expect(click.props.has_query).toBe(true);
});
