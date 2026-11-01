// Public /share viewer — joining from a link someone sent, and the first-visit
// tip. A joinable /share page gets a Join button in the top bar, a Join card
// (at once on a phone, after the first-visit tip and a delay on a computer) and,
// for a signed-out visitor, a one-time tip on how to get around. Sign-in then
// says what is being joined. Same route-intercepted fixtures as
// public-share.spec.js: no PartyKit, no Supabase.

import { expect, test } from '@playwright/test';
import { TOKEN, routeShareBundle, routeAnalytics } from './helpers/share-fixture.js';

const TIP_KEY = 'soleil.firstVisitTip.v1';

// get_share_meta (0830) as the page reads it. Anon-callable; supabase-js posts
// to /rest/v1/rpc/get_share_meta and takes the json back as `data`.
function shareMeta(over = {}) {
  return {
    link_kind: 'view',
    can_join: true,
    sharer_name: 'Andrew',
    name: 'Marketing Root',
    card_count: 24,
    workspace_id: '99999999-0000-0000-0000-000000000001',
    board_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    ...over,
  };
}

async function routeShareMeta(page, over) {
  await page.route('**/rest/v1/rpc/get_share_meta**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shareMeta(over)) }));
}

// Open the sub-board tile (board cards open on a click in their cover area).
async function openSubBoard(page) {
  await page.locator('.bc-cover').first().click();
  await page.locator('.public-crumbs').waitFor({ timeout: 5000 });
}

async function markTipSeen(page) {
  await page.addInitScript((key) => { try { localStorage.setItem(key, 'done'); } catch (_) {} }, TIP_KEY);
}

test('a view link can be joined from the top bar: sign-in says who invited you, and the token stays out of events', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page);
  await routeShareMeta(page, { link_kind: 'view', can_join: true });
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');

  const join = page.locator('.public-topbar .public-btn-join');
  await expect(join).toBeVisible();
  await expect(join).toHaveText('Join');
  await expect(join).toHaveAttribute('href', /[?&]jk=view(&|$)/);
  await expect(join).toHaveAttribute('href', new RegExp(`[?&]join=${TOKEN}`));

  await join.click();
  await page.waitForURL(/\/(\?|$)/);

  // AuthGate strips ?join= and ?jk= from the URL once it has stashed them, so
  // the kind is read from the stash that survives the sign-in hop.
  await expect.poll(() => page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('soleil.boards.pending.join.info') || 'null')?.kind || null; } catch (_) { return null; }
  })).toBe('view');

  // The sign-in screen names what is being joined.
  await expect(page.locator('.auth-joinc-h')).toContainText('Join Andrew on Clusters');
  await expect(page.locator('.auth-joinc-t b')).toHaveText('Marketing Root');
  await expect(page.locator('.auth-joinc-t')).toContainText('Shared by Andrew');
  await expect(page.locator('.auth-joinc-t')).toContainText('24 cards');

  // The click beacons its own event; the token rides no event.
  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('view_link_join_clicked');
  const click = rows.find((r) => r.event === 'view_link_join_clicked');
  expect(click.props.kind).toBe('view');
  expect(click.props.where).toBe('topbar');
  expect(JSON.stringify(rows)).not.toContain(TOKEN);
});

test('a link that cannot be joined has no Join button and no Join card', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page);
  await routeShareMeta(page, { can_join: false });
  await markTipSeen(page);
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');
  // Let get_share_meta land and the card's would-be show time pass.
  await page.waitForTimeout(1200);
  await expect(page.locator('.public-topbar .public-btn-join')).toHaveCount(0);
  await expect(page.locator('.jc')).toHaveCount(0);
  // The topbar falls back to its usual single action.
  await expect(page.locator('.public-topbar .public-cta')).toHaveText('Make a copy');
});

test('first-visit tip: points at a cluster to open, then at the way back, once per device', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page);
  await routeShareMeta(page);
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');

  const tip = page.locator('.fvt-tip');
  await expect(tip).toBeVisible({ timeout: 5000 });
  await expect(tip).toContainText('Click a cluster to open it');
  await expect(tip).toContainText('Clusters can hold more clusters inside.');
  await expect(page.locator('.fvt-ring')).toBeVisible();
  await expect(tip.locator('.fvt-dots i.on')).toHaveCount(1);

  // Opening the sub-cluster is what the first step asks for: on to "back".
  await openSubBoard(page);
  await expect(tip).toContainText('Click Marketing Root to go back');
  await expect(tip).toContainText('Your browser’s back button works too.');

  // Coming back up finishes it, and it is remembered for the device.
  await page.locator('.public-crumbs .public-crumb.clk').click();
  await expect(tip).toHaveCount(0);
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), TIP_KEY)).toBe('done');

  await page.reload();
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');
  await page.waitForTimeout(1200);
  await expect(page.locator('.fvt-tip')).toHaveCount(0);
});

test('first-visit tip: already seen on this device, it does not show', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page);
  await routeShareMeta(page);
  await markTipSeen(page);
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');
  await page.waitForTimeout(1500);
  await expect(page.locator('.fvt-tip')).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('the Join card is there at once, with no delay', async ({ page }) => {
    await routeAnalytics(page, []);
    await routeShareBundle(page);
    await routeShareMeta(page);
    await markTipSeen(page);   // the card waits only for the tip, never for a timer, on a phone
    await page.goto(`/share/${TOKEN}`);
    await expect(page.locator('.public-board-name')).toBeVisible();

    // A computer waits 6s for it; a phone must not.
    const card = page.locator('.jc');
    await expect(card).toBeVisible({ timeout: 3000 });
    await expect(card.locator('.jc-eb')).toContainText('From Andrew');
    await expect(card.locator('.jc-tt')).toHaveText('Join “Marketing Root”');
    await expect(card.locator('.public-btn-join')).toHaveText('Join free');
    await expect(card.locator('.public-btn-join')).toHaveAttribute('href', /[?&]jk=view(&|$)/);
  });

  test('on a first visit the tip goes first, and "Got it" brings the card straight up', async ({ page }) => {
    await routeAnalytics(page, []);
    await routeShareBundle(page);
    await routeShareMeta(page);
    await page.goto(`/share/${TOKEN}`);

    const tip = page.locator('.fvt-tip');
    await expect(tip).toBeVisible({ timeout: 5000 });
    await expect(tip).toContainText('Tap a cluster to open it');
    await expect(page.locator('.jc')).toHaveCount(0);

    await tip.locator('.fvt-ok').click();
    await expect(page.locator('.jc')).toBeVisible({ timeout: 3000 });
  });
});
