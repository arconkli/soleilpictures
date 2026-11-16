// A link card (and a link cell in a grid) draws the site's picture from our own
// copy of it when one was kept (imageKey / imageKeyOf, lib/linkPictureKeep.js),
// through the same progressive path as an image card — and from the site, as it
// always did, when there is no copy, the copy is stale, or the copy will not
// draw.
//
// Runs on the public /share viewer fixture (no PartyKit, no Supabase): the
// bundle's image_urls is what signs the copy's key, and the site's own picture
// is a host the spec controls, blocked outright in the first test. The viewer
// never runs the keeping pass (it is signed-out); that is covered by
// linkPictureKeep.test.mjs and workerMedia.test.mjs.

import * as Y from 'yjs';
import { expect, test } from '@playwright/test';
import { TOKEN, ROOT_ID, makeBundles, routeAnalytics } from './helpers/share-fixture.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const REMOTE = 'https://og.remote.test/hero.png';
const COPY_KEY = 'ws1/previews/link/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png';
const COPY_URL = 'https://imgcdn.test/link-copy.png';

// The share-bundle snapshot, built from the cards given. Nested Y types are
// assembled detached, as the fixture's own doc card is.
function snapshotOf(cards) {
  const doc = new Y.Doc();
  const map = doc.getMap('cards');
  for (const [id, card] of Object.entries(cards)) {
    const m = new Y.Map();
    for (const [k, v] of Object.entries(card)) m.set(k, v);
    map.set(id, m);
  }
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
}

const ready = { 'card-ready': { kind: 'note', body: 'Link pictures ready', x: 120, y: 600, w: 240, h: 100 } };
const linkCard = (extra = {}) => ({
  'card-link': {
    kind: 'link', title: 'A saved article', source: 'https://site.test/article', image: REMOTE,
    x: 120, y: 120, w: 320, h: 400, ...extra,
  },
});
const withCopy = { imageKey: `r2:${COPY_KEY}`, imageKeyOf: REMOTE };

// A grid of one cell holding a link: the layout is a single leaf, the cell a
// nested Y.Map in the card's gridCells, as the app writes it.
function linkGrid(cell) {
  const cells = new Y.Map();
  const c = new Y.Map();
  for (const [k, v] of Object.entries(cell)) c.set(k, v);
  cells.set('c1', c);
  return {
    'card-grid': {
      kind: 'grid', layout: { id: 'c1', type: 'leaf', frac: 1 }, gridCells: cells,
      x: 120, y: 120, w: 320, h: 400,
    },
  };
}

async function open(page, cards, { copy = true } = {}) {
  await routeAnalytics(page, []);
  const bundles = makeBundles();
  bundles[ROOT_ID] = {
    ...bundles[ROOT_ID],
    snapshot: snapshotOf({ ...cards, ...ready }),
    image_urls: copy ? { [COPY_KEY]: COPY_URL } : {},
    image_meta: copy ? { [COPY_KEY]: { blur: null, w: 1200, h: 630 } } : {},
  };
  await page.route('**/parties/upload/share/share-bundle', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(bundles[ROOT_ID]),
  }));
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Link pictures ready', { exact: true })).toBeVisible();
}

// Count what each host is asked for; `copy` and `remote` say how they answer.
async function routeHosts(page, { copy = 'png', remote = 'png' } = {}) {
  const hits = { copy: 0, remote: 0 };
  await page.route('https://imgcdn.test/**', (route) => {
    hits.copy += 1;
    if (copy === 'garbage') return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('not-a-picture') });
    return route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
  });
  await page.route('https://og.remote.test/**', (route) => {
    hits.remote += 1;
    if (remote === 'blocked') return route.abort();
    return route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
  });
  return hits;
}

test('a link card draws its kept copy from our storage while the site\'s picture is blocked', async ({ page }) => {
  const hits = await routeHosts(page, { remote: 'blocked' });
  await open(page, linkCard(withCopy));

  const picture = page.locator('.lc-preview .r2p-img');
  await expect(picture).toHaveCount(1);
  await expect.poll(() => picture.evaluate((el) => el.classList.contains('is-loaded')), { timeout: 8000 }).toBe(true);
  expect(await picture.evaluate((el) => el.currentSrc)).toBe(COPY_URL);
  await expect(page.locator('img.lc-preview-img')).toHaveCount(0);
  expect(hits.remote, 'the site is never asked for it').toBe(0);
});

test('a link cell in a grid draws its kept copy from our storage too', async ({ page }) => {
  const hits = await routeHosts(page, { remote: 'blocked' });
  await open(page, linkGrid({
    type: 'link', title: 'A saved article', source: 'https://site.test/article', image: REMOTE, ...withCopy,
  }));

  const picture = page.locator('.gc-link .r2p-img');
  await expect(picture).toHaveCount(1);
  await expect.poll(() => picture.evaluate((el) => el.classList.contains('is-loaded')), { timeout: 8000 }).toBe(true);
  expect(await picture.evaluate((el) => el.currentSrc)).toBe(COPY_URL);
  await expect(page.locator('img.gc-link-img')).toHaveCount(0);
  expect(hits.remote).toBe(0);
});

test('a card with no copy draws the site\'s picture, as it always did', async ({ page }) => {
  const hits = await routeHosts(page);
  await open(page, linkCard());

  const picture = page.locator('img.lc-preview-img');
  await expect(picture).toHaveCount(1);
  await expect(picture).toHaveAttribute('src', REMOTE);
  await expect.poll(() => picture.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.lc-preview .r2p')).toHaveCount(0);
  expect(hits.copy).toBe(0);
});

test('a copy of a picture the card no longer shows is not drawn', async ({ page }) => {
  const hits = await routeHosts(page);
  await open(page, linkCard({ imageKey: `r2:${COPY_KEY}`, imageKeyOf: 'https://og.remote.test/older.png' }));

  await expect(page.locator('img.lc-preview-img')).toHaveAttribute('src', REMOTE);
  await expect(page.locator('.lc-preview .r2p')).toHaveCount(0);
  expect(hits.copy, 'the stale copy is never fetched').toBe(0);
});

test('a copy that will not draw hands the card back to the site\'s picture', async ({ page }) => {
  const hits = await routeHosts(page, { copy: 'garbage' });
  await open(page, linkCard(withCopy));
  // The viewer answers an image error by re-fetching its bundle and remounting
  // the canvas; keep it mounted so the card's own fallback is what is watched.
  await page.route('**/parties/upload/share/share-bundle', (route) => route.abort());

  const fallback = page.locator('img.lc-preview-img');
  await expect(fallback).toHaveAttribute('src', REMOTE, { timeout: 15000 });
  await expect.poll(() => fallback.evaluate((el) => el.naturalWidth), { timeout: 8000 }).toBeGreaterThan(0);
  await expect(page.locator('.lc-preview .r2p')).toHaveCount(0);
  expect(hits.copy, 'the copy was tried, a bounded number of times').toBeGreaterThan(0);
  expect(hits.copy).toBeLessThanOrEqual(6);
});

test('a copy the viewer has no signed address for hands the card back to the site too', async ({ page }) => {
  // A bundle made without the copy's key (nothing to sign): R2Image gives up
  // without an <img> error, which is the case a bare onError would miss.
  const hits = await routeHosts(page);
  await open(page, linkCard(withCopy), { copy: false });

  await expect(page.locator('img.lc-preview-img')).toHaveAttribute('src', REMOTE, { timeout: 15000 });
  await expect(page.locator('.lc-preview .r2p')).toHaveCount(0);
  expect(hits.copy).toBe(0);
});
