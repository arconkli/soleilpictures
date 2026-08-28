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

// The template STORE. /templates is a browsable catalogue; each item is its own
// page. All of it is in the bundle rather than behind an RPC, so unlike the
// community strip above these must render completely with no backend at all.
test.describe('/templates — the store', () => {
  test('lists the catalogue and filters by category, in the URL', async ({ page }) => {
    await page.goto('/templates');
    const cards = page.locator('.tplstore-card');
    const total = await cards.count();
    expect(total, 'the store should be stocked').toBeGreaterThanOrEqual(10);

    // The chips are the "departments". Picking one narrows the grid AND becomes
    // a shareable URL — but the default is omitted so /templates stays canonical.
    await page.getByRole('button', { name: /^Film and video/ }).click();
    await expect.poll(() => cards.count()).toBeLessThan(total);
    await expect.poll(() => new URL(page.url()).search).toBe('?category=film');

    // And it hydrates back out of the URL on a cold load.
    await page.goto('/templates?category=film');
    await expect(page.getByRole('button', { name: /^Film and video/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('search narrows the grid and reports how many of how many', async ({ page }) => {
    await page.goto('/templates');
    const total = await page.locator('.tplstore-card').count();
    await page.getByRole('searchbox', { name: 'Search templates' }).fill('storyboard');
    await expect.poll(() => page.locator('.tplstore-card').count()).toBeLessThan(total);
    await expect(page.locator('.exp-count')).toHaveText(new RegExp(`of ${total}`));

    // A query with no matches offers a way back rather than an empty page.
    await page.getByRole('searchbox', { name: 'Search templates' }).fill('zzzznope');
    await expect(page.locator('.exp-noresults')).toBeVisible();
    await page.getByRole('button', { name: /^Show all/ }).click();
    await expect.poll(() => page.locator('.tplstore-card').count()).toBe(total);
  });

  // THE fix. The store shipped leading with an eyebrow, an answer card, a CTA
  // band and five prose sections before a single template — a shop wearing a
  // landing page's clothes. The goods come first now; the prose stays, below,
  // because it is what an answer engine quotes and what the .md mirror needs.
  test('the goods come before the copy', async ({ page }) => {
    await page.goto('/templates');
    const gridY = await page.locator('.tplstore-grid').evaluate((el) => el.getBoundingClientRect().top);
    const proseY = await page.locator('.seo-section .seo-h2')
      .filter({ hasText: 'A template is a shape' })
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(gridY, 'the grid must sit above the prose').toBeLessThan(proseY);

    // And none of the selling furniture a shop does not need.
    await expect(page.locator('.seo-eyebrow')).toHaveCount(0);
    await expect(page.locator('.seo-answer')).toHaveCount(0);
    await expect(page.locator('.seo-midcta')).toHaveCount(0);
  });

  test('offers a way to stock the shelf', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.getByRole('link', { name: 'Share it in the store' })).toBeVisible();
  });
});

test.describe('/templates/<slug> — an item page', () => {
  test('shows the shape, its labels, and a button that carries the template', async ({ page }) => {
    await page.goto('/templates/shot-list-template');
    await expect(page.getByRole('heading', { name: 'Shot list template', level: 1 })).toBeVisible();

    // The diagram is drawn from the same layout the button places, so the box
    // count on screen is the box count you get. A shot list is a TABLE: four
    // setups down, five columns across.
    await expect(page.locator('.tplitem-shot .tplt-thumb rect')).toHaveCount(20);
    // The labels are drawn INSIDE the boxes, the way the card draws them — no
    // legend beside the diagram, because that would be the same information
    // twice. Every box on this layout is labelled, one per column per row.
    const labels = page.locator('.tplitem-shot .tplt-cell-hint');
    await expect(labels).toHaveCount(20);
    // Asserted as a SET, not a sequence: cells are drawn in tree order while
    // labels are indexed by reading order, so DOM order is neither and does not
    // need to be. What matters is that every column landed in a box.
    expect([...new Set(await labels.allTextContents())].sort())
      .toEqual(['ANGLE', 'FRAME', 'MOVE', 'NOTES', 'SIZE']);
    // role="img" hides SVG contents from assistive tech, so the labels have to
    // survive in the accessible name or a screen reader gets a bare shape.
    await expect(page.locator('.tplitem-shot .tplt-thumb'))
      .toHaveAttribute('aria-label', /FRAME, SIZE, ANGLE, MOVE, NOTES/);

    for (const href of await page.locator('a.public-cta, a.tplitem-add')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
      expect(href).toContain('remix=k_shot-list-template');
    }
    await expect(page.locator('.tplitem-crumbs a')).toHaveAttribute('href', '/templates');
  });

  // A product page, not a landing page. No body prose and no FAQ — not trimmed
  // away, never authored: gen-docs errors on a body in a template file rather
  // than dropping it silently.
  test('is a product page, with no invented copy on it', async ({ page }) => {
    await page.goto('/templates/casting-board-template');
    await expect(page.locator('details')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Frequently asked/i })).toHaveCount(0);
    // Exactly one h2 — "More in film and video". Anything else is prose.
    await expect(page.locator('h2')).toHaveCount(1);
  });

  test('an unlabelled template shows no empty legend', async ({ page }) => {
    await page.goto('/templates/contact-sheet-template');
    // A roll of 35mm: six strips of six.
    await expect(page.locator('.tplitem-shot .tplt-thumb rect')).toHaveCount(36);
    // Thirty-six identical labels would be noise, so this template carries none
    // — a proof sheet is the one sheet with nothing written on it.
    await expect(page.locator('.tplitem-shot .tplt-cell-hint')).toHaveCount(0);
  });

  // The point of the whole catalogue: a template is a set of PROPORTIONS, and
  // the preview has to draw them. Two layouts rendered into the same box are the
  // same picture, which is what a fixed landscape viewBox used to make them.
  test('a preview is drawn at the layout\'s real aspect ratio', async ({ page }) => {
    const ratioOf = async (slug) => {
      await page.goto(`/templates/${slug}`);
      const vb = await page.locator('.tplitem-shot .tplt-thumb').getAttribute('viewBox');
      const [, , w, h] = vb.split(/\s+/).map(Number);
      return w / h;
    };
    // 540 × 360 — a 3:2 negative, six across.
    expect(await ratioOf('contact-sheet-template')).toBeCloseTo(1.5, 1);
    // 360 × 480 — 3:4, which is what a profile grid crops to.
    expect(await ratioOf('social-media-grid-template')).toBeCloseTo(0.75, 1);
  });

  test('an unknown item is a dead end, not a soft 404', async ({ page }) => {
    await page.goto('/templates/not-a-real-template');
    await expect(page.locator('.tplitem-layout')).toHaveCount(0);
    await expect(page.locator('.tplstore-grid')).toHaveCount(0);
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
