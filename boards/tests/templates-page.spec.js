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
    // The catalogue is the crawlable half now — the prose that used to be
    // asserted here is gone, and the .md mirror carries the inventory instead.
    await expect(page.locator('.tplstore-card').first()).toBeVisible();
    await expect(page).toHaveTitle(/Grid Templates/);
  });

  test('the community strip degrades to nothing rather than an empty heading', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.getByRole('heading', { name: 'Grid templates', level: 1 })).toBeVisible();
    // With no backend the list is empty, and an empty gallery must not leave a
    // "From the community" header standing over nothing.
    await expect(page.locator('.seo-templates')).toHaveCount(0);
  });

  // It is a SHOP. Not a landing page with a shop in it, which is what it was:
  // measured at 1909px of prose under the last tile, 44% of the page. The
  // catalogue is the content, and the .md mirror carries it for the assistants
  // that used to be the argument for the copy.
  test('is a store, with no copy stapled under the shelf', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.locator('.tplstore-card').first()).toBeVisible();
    await expect(page.locator('details')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Frequently asked/i })).toHaveCount(0);
    // The only h2 is the catalogue's own. Any other is a prose section that has
    // crept back in above or below the goods.
    await expect(page.locator('h2')).toHaveCount(1);

    // Nothing substantial below the last tile — the footer nav and the
    // "share your own" line are links, not reading.
    const tail = await page.evaluate(() => {
      const sc = document.querySelector('.seo-scroll');
      const grid = document.querySelector('.tplstore-grid');
      return sc.scrollHeight - Math.round(grid.getBoundingClientRect().bottom + sc.scrollTop);
    });
    expect(tail).toBeLessThan(420);
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
  // landing page's clothes. First the goods moved above the copy; then the copy
  // went entirely. What is left has to STAY a shop, so this asserts the absence
  // of every piece of landing-page furniture by name.
  test('carries none of the landing-page furniture', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.locator('.seo-eyebrow')).toHaveCount(0);
    await expect(page.locator('.seo-answer')).toHaveCount(0);
    await expect(page.locator('.seo-midcta')).toHaveCount(0);
    // No "Updated <date>" under the sign, and no closing "Your next board is 30
    // seconds away" band. A shop is dated by its stock and ends by inviting you
    // to keep looking.
    await expect(page.locator('.seo-updated')).toHaveCount(0);
    await expect(page.locator('.seo-cta-band')).toHaveCount(0);

    // The products start high. 12vh of air is a pause before a pitch; here it is
    // just distance between someone and the shelf.
    const top = await page.locator('.tplstore-card').first()
      .evaluate((el) => el.getBoundingClientRect().top + el.closest('.seo-scroll, body').scrollTop);
    expect(top, 'the first product should be near the top of the page').toBeLessThan(460);
  });

  // The dense layouts get a double-width tile, because a 36-frame contact sheet
  // in a 250px tile is grey mush. The rule is not cell count alone — the
  // vertical storyboard has eight cells and the thinnest label on the shelf.
  test('a dense template gets a bigger tile, and every label stays legible', async ({ page }) => {
    await page.goto('/templates');
    await expect(page.locator('.tplstore-grid.is-featured > li.is-big').first()).toBeVisible();

    // The measurement that matters: the smallest label actually rendered on any
    // tile. It was 4.9px on the vertical storyboard before that template started
    // earning a big tile on its label size rather than its box count.
    const smallest = await page.evaluate(() => {
      let min = Infinity;
      for (const card of document.querySelectorAll('.tplstore-card')) {
        const svg = card.querySelector('.tplt-thumb');
        const hints = [...card.querySelectorAll('.tplt-cell-hint')];
        if (!svg || !hints.length) continue;
        const vbW = Number(svg.getAttribute('viewBox').split(/\s+/)[2]);
        const scale = svg.getBoundingClientRect().width / vbW;
        for (const h of hints) min = Math.min(min, parseFloat(h.getAttribute('font-size')) * scale);
      }
      return min;
    });
    expect(smallest).toBeGreaterThan(8);
  });

  // Download counts (migration 0300). Community templates always had one
  // (use_count); ours had none, so "Most downloaded" could only ever sort a
  // single item. Both count DISTINCT PEOPLE, which is what lets the two numbers
  // sit beside each other on one shelf.
  test('shows real download counts and sorts by them', async ({ page }) => {
    await page.route('**/rpc/template_download_counts', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { slug: 'contact-sheet-template', downloads: 12 },
        { slug: 'storyboard-template', downloads: 3 },
      ]),
    }));
    await page.goto('/templates');
    await expect(page.locator('.tplstore-dl').first()).toBeVisible();
    await expect(page.getByText('12 downloads')).toBeVisible();
    // Singular/plural is a real number's business.
    await expect(page.getByText('3 downloads')).toBeVisible();
    // Never printed as a zero — a template nobody has taken says nothing.
    await expect(page.getByText('0 downloads')).toHaveCount(0);

    // The sort appears only because something has a count, and it orders by it.
    await page.getByRole('button', { name: 'Most downloaded' }).click();
    const titles = await page.locator('.tplstore-title').allTextContents();
    expect(titles[0]).toBe('Contact sheet template');
    expect(titles[1]).toBe('Storyboard template');
  });

  test('hides the downloads sort while nothing has been downloaded', async ({ page }) => {
    await page.route('**/rpc/template_download_counts', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/templates');
    await expect(page.locator('.tplstore-card').first()).toBeVisible();
    // A button that sorts sixteen zeroes is not a sort, and it advertises an
    // emptiness the store has no reason to advertise.
    await expect(page.getByRole('button', { name: 'Most downloaded' })).toHaveCount(0);
    await expect(page.locator('.tplstore-dl')).toHaveCount(0);
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

  // THE BUG: this route rendered a full page for a crawler and "Page not found"
  // for a person, because the Worker matched /templates/g/<slug> and the client
  // had no matcher for it at all. Stubbed rather than hitting the real gallery so
  // the test does not depend on somebody having published something.
  test('a published community template renders, rather than 404ing', async ({ page }) => {
    await page.route('**/rpc/get_public_grid_layout', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'a-shared-layout',
        title: 'A shared layout',
        description: 'Two panels over a strip.',
        use_count: 7,
        body: {
          layout: { type: 'col', children: [
            { type: 'leaf', id: 'a', frac: 0.6 },
            { type: 'row', frac: 0.4, children: [
              { type: 'leaf', id: 'b', frac: 0.5 }, { type: 'leaf', id: 'c', frac: 0.5 }] },
          ] },
          hints: ['HERO', 'LEFT', 'RIGHT'],
        },
      }),
    }));
    await page.goto('/templates/g/a-shared-layout');
    await expect(page.getByRole('heading', { name: 'A shared layout', level: 1 })).toBeVisible();
    await expect(page.getByText('Two panels over a strip.')).toBeVisible();
    await expect(page.locator('.tplitem-shot .tplt-thumb rect')).toHaveCount(3);
    // A real download count, shown because it is non-zero.
    await expect(page.locator('.tplitem-specs')).toContainText('7 downloads');
    // The CTA rides the gallery rail (p_), not the curated one (k_) — different
    // RPCs with different authorization.
    await expect(page.locator('.tplitem-add')).toHaveAttribute('href', /remix=p_a-shared-layout/);
  });

  test('a community slug that resolves to nothing is a dead end', async ({ page }) => {
    await page.route('**/rpc/get_public_grid_layout', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: 'null',
    }));
    await page.goto('/templates/g/never-published');
    await expect(page.getByText(/Page not found|doesn.t exist/i).first()).toBeVisible();
    await expect(page.locator('.tplitem-hero')).toHaveCount(0);
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
