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

// The curated template pages: real, indexable, hand-written pages for templates
// WE ship, as opposed to the noindex treatment user-published templates get.
// Everything here is static and in the bundle, so unlike the gallery strip above
// these must render fully with no backend at all.
test.describe('/templates/<slug> — the curated template pages', () => {
  const PAGES = [
    { path: '/templates/storyboard-template', h1: 'Storyboard template', boxes: 3, first: 'ESTABLISHING' },
    { path: '/templates/contact-sheet-template', h1: 'Contact sheet template', boxes: 9, first: null },
    { path: '/templates/shot-list-template', h1: 'Shot list template', boxes: 4, first: 'SHOT + LENS' },
  ];

  for (const p of PAGES) {
    test(`${p.path} renders its layout and its labels`, async ({ page }) => {
      await page.goto(p.path);
      await expect(page.getByRole('heading', { name: p.h1, level: 1 })).toBeVisible();

      // The diagram is drawn from the SAME preset the CTA places, so the box
      // count on screen is the box count you get. A page describing one shape
      // and handing over another is the failure this guards.
      const layout = page.locator('.seo-tpl-layout');
      await expect(layout).toBeVisible();
      await expect(layout.locator('.tplt-thumb rect')).toHaveCount(p.boxes);

      if (p.first) {
        // Labels are listed in READING ORDER, which is not always left to right
        // — readingOrder bands cells by their centre. The first item here is the
        // one the numbered diagram marks "1".
        await expect(layout.locator('.seo-tpl-hints li').first()).toHaveText(p.first);
      } else {
        // A uniform grid labels nothing: nine identical "FRAME" labels would be
        // noise, so the legend is absent rather than empty.
        await expect(layout.locator('.seo-tpl-hints')).toHaveCount(0);
      }
    });
  }

  // The whole point of a curated page over a generic landing page: the button
  // has to place THAT template. Before this the gallery's CTA went to the bare
  // homepage and there was no way to obtain a template at all.
  test('every CTA carries the template, and the wordmark does not', async ({ page }) => {
    await page.goto('/templates/storyboard-template');
    // Only the SIGNUP ctas. .seo-cta-primary is also worn by the sibling-listicle
    // "Read the roundup" button, which is navigation to /best/* and rightly
    // carries no template.
    const hrefs = (await page.locator('a.seo-cta-primary')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href') || '')))
      .filter((h) => h.startsWith('/?'));
    expect(hrefs.length, 'hero + mid-read + closing').toBeGreaterThanOrEqual(3);
    for (const href of hrefs) {
      expect(href, 'a conversion CTA must carry the template').toContain('remix=k_storyboard-template');
    }
    // Clicking a logo to go home must not also claim a template.
    await expect(page.locator('a.public-brand')).not.toHaveAttribute('href', /remix=/);
  });

  // The docs link is deliberately NOT in `related`: that array resolves anchor
  // text through the landing registries and falls back to the raw path in the
  // Worker, while React filters it through TITLE_BY_PATH and would silently drop
  // a /docs/* entry — one renderer emitting a link the other does not.
  test('the docs backlink renders, so the link is two-way', async ({ page }) => {
    await page.goto('/templates/storyboard-template');
    const nav = page.locator('nav.seo-related');
    await expect(nav.getByRole('link', { name: 'Grids documentation' }))
      .toHaveAttribute('href', '/docs/canvas/grids');
    await expect(nav.getByRole('link', { name: 'Grid templates' })).toHaveAttribute('href', '/templates');
  });

  // A landing-SHAPED path that is not in the registry must be a real 404, not
  // page content at a URL whose status says gone. The Worker returns the status;
  // React must not paper over it with a rendered page.
  test('an unknown /templates/<slug> is a dead end, not a soft 404', async ({ page }) => {
    await page.goto('/templates/not-a-real-template');
    await expect(page.getByRole('heading', { name: /Storyboard template/i })).toHaveCount(0);
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
