// Public /share viewer — marketing-surface behaviors: branding + CTAs from
// first paint, share attribution seeding, full event instrumentation,
// sub-board navigation polish, the engagement prompt, and the branded
// invalid-link dead end. Everything runs against route-intercepted fixtures
// (tests/helpers/share-fixture.js) — no PartyKit, no Supabase.

import { expect, test } from '@playwright/test';
import { TOKEN, ROOT_ID, SUB_ID, routeShareBundle, routeAnalytics } from './helpers/share-fixture.js';

// Open the sub-board tile. Board cards open on a click that lands in their
// cover area (.bc-cover) — clicks on the name row only select the card.
async function openSubBoard(page) {
  await page.locator('.bc-cover').first().click();
  await page.locator('.public-crumbs').waitFor({ timeout: 5000 });
}

test('topbar brand + CTAs render and share attribution is seeded', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page);
  await page.goto(`/share/${TOKEN}`);

  await expect(page.locator('.public-brand-name')).toHaveText('Clusters');
  // For a valid loaded board the primary CTA is "Make a copy" (remix THIS board);
  // "Try free" + "Sign in" step back to secondary (both .public-signin-quiet).
  const cta = page.locator('.public-topbar .public-cta');
  await expect(cta).toHaveText('Make a copy');
  await expect(cta).toHaveAttribute('href', /utm_medium=remix/);
  await expect(cta).toHaveAttribute('href', /[?&]remix=/);
  await expect(page.locator('.public-topbar .public-signin-quiet', { hasText: 'Try free' })).toBeVisible();
  await expect(page.locator('.public-topbar .public-signin-quiet', { hasText: 'Sign in' })).toBeVisible();
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');
  await expect(page).toHaveTitle('Marketing Root — Soleil Clusters');

  // Session first-touch source seeded for the /share → / signup funnel.
  const src = await page.evaluate(() => JSON.parse(sessionStorage.getItem('soleil_first_source') || '{}'));
  expect(src.share_token).toBe(TOKEN);
  expect(src.utm_source).toBe('share_link');
  expect(src.utm_medium).toBe('share_page');
});

test('topbar CTA logs share_cta_click and lands on / with share utm params', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page);
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');

  // The primary topbar CTA is now "Make a copy" (remix) — medium=remix; clicking
  // it still beacons share_cta_click and lands on /. (The &remix=<source> param
  // is on the CTA href — asserted in the test above — but AuthGate stashes it and
  // strips it from the URL on landing, so we don't assert it post-navigation.)
  await page.locator('.public-topbar .public-cta').click();
  await page.waitForURL(new RegExp(`/\\?utm_source=share_link&utm_medium=remix&utm_campaign=${TOKEN}`));

  // The CTA beacons the whole queue, so the earlier share_view lands too.
  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('share_cta_click');
  const cta = rows.find((r) => r.event === 'share_cta_click');
  expect(cta.props.surface).toBe('remix');
  expect(cta.props.share_token).toBe(TOKEN);

  const view = rows.find((r) => r.event === 'share_view');
  expect(view.props.valid).toBe(true);
  expect(view.props.board_id).toBe(ROOT_ID);
  expect(view.props.include_subboards).toBe(true);
  expect(view.props.utm_source).toBe('share_link'); // merged from the seeded first source
});

test('sub-board navigation: progress shimmer, breadcrumbs, title, deep-link URL, event', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page, { subDelayMs: 700 });
  // prefetch=0: the idle prefetch would otherwise warm the sub-board cache
  // and race away the shimmer + cached:false this test asserts.
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');

  await page.locator('.bc-cover').first().click();
  const progress = page.locator('.public-nav-progress');
  await expect(progress).toBeVisible(); // shimmer while the delayed bundle is in flight

  await expect(page.locator('.public-crumb.here')).toHaveText('Inside Board');
  await expect(page.locator('.public-crumbs .public-crumb').first()).toHaveText('Marketing Root');
  await expect(page).toHaveURL(new RegExp(`/share/${TOKEN}\\?b=${SUB_ID}`));
  await expect(page).toHaveTitle('Inside Board — Soleil Clusters');
  await expect(progress).toHaveCount(0); // shimmer gone once the bundle lands

  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('share_subboard_open');
  const ev = rows.find((r) => r.event === 'share_subboard_open');
  expect(ev.props.board_id).toBe(SUB_ID);
  expect(ev.props.from_board_id).toBe(ROOT_ID);
  expect(ev.props.cached).toBe(false);
});

test('engagement prompt: dwell trigger (QA override) and 14-day dismissal memory', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page);
  await page.goto(`/share/${TOKEN}?shareqa=1&promptms=300`);

  const prompt = page.locator('.share-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Like this board? Make your own.');
  await expect(prompt.locator('.share-prompt-cta')).toHaveText('Try Clusters free');
  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('share_prompt_view');
  expect(rows.find((r) => r.event === 'share_prompt_view').props.trigger).toBe('dwell');

  await prompt.locator('.share-prompt-x').click();
  await expect(prompt).toBeHidden();
  const dismissedAt = await page.evaluate(() => localStorage.getItem('soleil.share.prompt.dismissedAt'));
  expect(Date.parse(dismissedAt)).toBeGreaterThan(0);

  // Reload — recent dismissal suppresses the prompt entirely.
  await page.goto(`/share/${TOKEN}?shareqa=1&promptms=300`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');
  await page.waitForTimeout(900);
  await expect(page.locator('.share-prompt')).toHaveCount(0);
});

test('engagement prompt: sub-board navigation trigger', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page);
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');
  await expect(page.locator('.share-prompt')).toHaveCount(0);

  await openSubBoard(page);
  await expect(page.locator('.share-prompt')).toBeVisible();
  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('share_prompt_view');
  expect(rows.find((r) => r.event === 'share_prompt_view').props.trigger).toBe('subboard');
});

test('unreachable board tiles are hidden on public — no broken/locked tiles, no warn', async ({ page }) => {
  const warns = [];
  page.on('console', (msg) => { if (/canvas missing board card/.test(msg.text())) warns.push(msg.text()); });
  await routeAnalytics(page, []);
  await routeShareBundle(page);
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');

  // The reachable sub-board tile still renders (filter doesn't over-filter)…
  await expect(page.getByText('Inside Board', { exact: true })).toBeVisible();
  // …while the unreachable board card + boardlink card are gone entirely.
  await expect(page.locator('.bc-missing')).toHaveCount(0);
  await expect(page.locator('.bc-locked')).toHaveCount(0);
  await expect(page.locator('.blc')).toHaveCount(0); // only boardlink in fixture is unreachable
  expect(warns).toEqual([]);
});

test('view-only canvas pans by dragging anywhere — pan is the default tool', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page);
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');

  // Pan is the default tool in the public viewer (grab cursor via is-pan).
  await expect(page.locator('.canvas-wrap')).toHaveClass(/is-pan/);

  const canvas = page.locator('.canvas');
  const before = await canvas.evaluate((el) => el.style.transform);

  // Drag starting ON a card (the note): view-only never moves cards, so
  // the gesture must pan the canvas instead of being swallowed.
  const note = page.getByText('Welcome to the shared board');
  const box = await note.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 90, { steps: 6 });
  await page.mouse.up();

  const after = await canvas.evaluate((el) => el.style.transform);
  expect(after).not.toBe(before);

  // A clean click (no drag) on a board cover still opens the sub-board.
  await openSubBoard(page);
});

// NOTE on both early-fetch tests: dev builds run React StrictMode, whose
// double-mount makes raw request COUNTS noisy (the remount falls back to a
// normal POST after the one-shot was consumed). The precise, environment-
// independent assertion is the consumption semantic: fetchBundle nulls
// window.__shareBundle when it consumes it, and leaves it untouched when the
// token/boardId don't match.
test('worker-injected early bundle fetch is consumed (one-shot nulled)', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page);
  // Mirror the inline script the production worker injects into /share HTML.
  await page.addInitScript(({ token }) => {
    window.__shareBundle = {
      token,
      boardId: null,
      promise: fetch('http://localhost:1999/parties/upload/share/share-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
    };
  }, { token: TOKEN });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');
  const leftover = await page.evaluate(() => window.__shareBundle);
  expect(leftover).toBeNull(); // consumed — prod makes zero duplicate POSTs
});

test('early bundle fetch with a mismatched token is ignored — normal fetch renders', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page);
  await page.addInitScript(() => {
    window.__shareBundle = {
      token: '99999999-9999-9999-9999-999999999999',
      boardId: null,
      promise: fetch('http://localhost:1999/parties/upload/share/share-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '99999999-9999-9999-9999-999999999999' }),
      }),
    };
  });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');
  const leftoverToken = await page.evaluate(() => window.__shareBundle && window.__shareBundle.token);
  expect(leftoverToken).toBe('99999999-9999-9999-9999-999999999999'); // untouched
});

test('doc card opens read-only on public — editor chunk loads only on open', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page, { withDoc: true });
  const docChunkReqs = [];
  page.on('request', (r) => { if (/DocSurface/.test(r.url())) docChunkReqs.push(r.url()); });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);

  // Closed preview renders TipTap-free, chunk untouched.
  await expect(page.locator('.doc-card')).toBeVisible();
  await expect(page.locator('.doc-card-text')).toContainText('Hello from the public doc');
  expect(docChunkReqs.length).toBe(0);

  // Clean click opens the read-only fullscreen modal.
  await page.locator('.doc-card').click();
  await expect(page.locator('.doc-card-modal-body')).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
  await expect(page.locator('.ProseMirror')).toContainText('Hello from the public doc');
  await expect(page.locator('.doc-tb')).toHaveCount(0);              // no toolbar
  await expect(page.locator('.comment-gutter-dot')).toHaveCount(0);  // seeded thread stays hidden
  expect(docChunkReqs.length).toBeGreaterThan(0);                     // chunk fetched on open

  await page.keyboard.press('Escape');
  await expect(page.locator('.doc-card-modal')).toHaveCount(0);
});

test('pan-drag across a doc card pans without opening it', async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page, { withDoc: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  const doc = page.locator('.doc-card');
  await expect(doc).toBeVisible();

  const canvas = page.locator('.canvas');
  const before = await canvas.evaluate((el) => el.style.transform);
  const box = await doc.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 80, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator('.doc-card-modal')).toHaveCount(0);
  const after = await canvas.evaluate((el) => el.style.transform);
  expect(after).not.toBe(before);
});

test('board with no saved state shows the calm empty state, not a blank canvas', async ({ page }) => {
  // The party returns snapshot: null when a board has no board_state row (a
  // data anomaly — a legitimately empty board still ships an empty-doc
  // snapshot). The viewer must surface it, keeping the branded chrome, rather
  // than rendering an indistinguishable blank canvas.
  await routeAnalytics(page, []);
  await routeShareBundle(page, { nullSnapshot: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);

  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root'); // topbar chrome stays
  await expect(page.locator('.public-empty-title')).toHaveText('This board doesn’t have any content yet');
  await expect(page.locator('.public-canvas-host')).toHaveCount(0);              // no blank canvas
  await expect(page.locator('.public-empty-actions .public-cta')).toHaveText('Try Clusters free');
});

test('invalid/expired link renders a branded dead end with CTA', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page, { fail404: true });
  await page.goto(`/share/${TOKEN}`);

  await expect(page.locator('.public-empty-title')).toHaveText('This link is no longer live');
  await expect(page.locator('.public-topbar .public-cta')).toBeVisible(); // branded chrome, not a bare panel
  const bodyCta = page.locator('.public-empty-actions .public-cta');
  await expect(bodyCta).toHaveText('Try Clusters free');

  await bodyCta.click();
  await page.waitForURL(/utm_medium=invalid_page/);
  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('share_view');
  const view = rows.find((r) => r.event === 'share_view');
  expect(view.props.valid).toBe(false);
  const cta = rows.find((r) => r.event === 'share_cta_click');
  expect(cta.props.surface).toBe('invalid_page');
});
