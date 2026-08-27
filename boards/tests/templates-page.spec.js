import { expect, test } from '@playwright/test';

// /templates — the public grid-template gallery, and /t/<token> — the share
// landing. Both are signed-out routes, so these run without any auth fixture.
//
// The Playwright webServer points VITE_SUPABASE_* at fake credentials (see
// playwright.config.js), so the live gallery strip and the token lookup cannot
// return data here. That is exactly what makes these worth running: the pages
// must render their static half and degrade honestly when the backend cannot
// answer, which is also what a real outage looks like.

test.describe('/templates — the gallery landing', () => {
  test('renders the static page signed out', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.getByRole('heading', { name: 'Grid templates', level: 1 })).toBeVisible();
    // The prose is the crawlable half and the part seo-health asserts.
    await expect(page.getByText('A template is a shape, not a document')).toBeVisible();
    await expect(page).toHaveTitle(/Grid Templates/);
  });

  test('the community strip degrades to nothing rather than an empty heading', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.getByRole('heading', { name: 'Grid templates', level: 1 })).toBeVisible();
    // With no backend the list is empty, and an empty gallery must not leave a
    // "From the community" header standing over nothing.
    await expect(page.locator('.seo-templates')).toHaveCount(0);
  });

  test('carries the FAQ the JSON-LD mirrors', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.getByText('Do I lose my images if I change template?')).toBeVisible();
  });

  // /templates is a landing page, not a router special case — so the shape must
  // not swallow /t/<token>, which sits one character away.
  test('does not collide with the /t/ share route', async ({ page }) => {
    await page.goto('/t/00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('heading', { name: 'Grid templates', level: 1 })).toHaveCount(0);
  });
});

test.describe('/t/<token> — the share landing', () => {
  test('an unresolvable token gets one honest dead end', async ({ page }) => {
    await page.goto('/t/00000000-0000-0000-0000-000000000000');
    // Unknown, revoked and deleted tokens are indistinguishable by design, so
    // there is exactly one failure state and it does not speculate about which.
    await expect(page.getByRole('heading', { name: 'This link is no longer live' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Try Clusters free' })).toBeVisible();
  });

  test('a malformed token is not a share route at all', async ({ page }) => {
    // The route regex requires a uuid shape, so a junk token never reaches the
    // RPC (which takes a uuid and would 400 on anything else).
    await page.goto('/t/not-a-uuid');
    await expect(page.getByRole('heading', { name: 'This link is no longer live' })).toHaveCount(0);
  });

  test('the page ships no editor chunk', async ({ page }) => {
    // The whole point of the layout-only decision: a share page is an SVG
    // diagram, so it must never pull in yjs or CanvasSurface the way the board
    // viewer does. Asserting on the network is the only way this stays true —
    // a stray import would be invisible in the UI.
    const chunks = [];
    page.on('request', (r) => {
      const u = r.url();
      if (u.endsWith('.js')) chunks.push(u.split('/').pop());
    });
    await page.goto('/t/00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('heading', { name: 'This link is no longer live' })).toBeVisible();
    const heavy = chunks.filter((c) => /yjs|CanvasSurface|AppShell|PublicBoardView/i.test(c));
    expect(heavy, `share page pulled heavy chunks: ${heavy.join(', ')}`).toEqual([]);
  });
});
