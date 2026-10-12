// Doc-editor layout fixes from the runtime visual sweep (VS-DOCS-*), driven
// through the ?docqa=1 harness. These run in the desktop-chrome project, so
// each describe block sets its own viewport and, where the defect is
// touch-only, a touch device (isMobile + hasTouch → hover:none and
// pointer:coarse, the query the mobile shell switches on).
import { expect, test } from '@playwright/test';

async function openDoc(page, query = '') {
  await page.goto('/?docqa=1' + query);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

async function addPages(page, names) {
  await page.evaluate((list) => {
    const T = window.__soleilDocTest;
    for (const name of list) T.addPage(T.ydoc, { name, scope: T.getScope() });
  }, names);
}

const TOUCH = { hasTouch: true, isMobile: true };

// ── VS-DOCS-01 ────────────────────────────────────────────────────────────
// The mobile shell hides the desktop page rail on a touch tablet too, but the
// drawer button only switched on at <=640px: an iPad had no way to reach a
// second page.
for (const vp of [{ width: 1024, height: 768 }, { width: 820, height: 1180 }]) {
  test.describe(`touch tablet ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, ...TOUCH });
    test('VS-DOCS-01: the page list opens from a button and switches pages', async ({ page }) => {
      await openDoc(page);
      await addPages(page, ['Chapter Two', 'Chapter Three']);
      const btn = page.locator('.doc-card-modal .doc-mobile-pages-btn');
      await expect(btn).toBeVisible();
      await btn.tap();
      const surface = page.locator('.doc-card-modal .doc-surface');
      await expect(surface).toHaveClass(/mobile-rail-open/);
      await expect(page.locator('.doc-card-modal .doc-rail-left')).toBeVisible();
      await page.locator('.doc-card-modal .doc-tree-name', { hasText: 'Chapter Three' }).first().tap();
      await expect(surface).not.toHaveClass(/mobile-rail-open/);
    });
  });
}

test.describe('mouse 1024', () => {
  test.use({ viewport: { width: 1024, height: 768 } });
  test('VS-DOCS-01: a desktop browser keeps the rail and no drawer button', async ({ page }) => {
    await openDoc(page);
    await expect(page.locator('.doc-card-modal .doc-rail-left')).toBeVisible();
    await expect(page.locator('.doc-card-modal .doc-mobile-pages-btn')).toBeHidden();
  });
});

test.describe('phone 390', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...TOUCH });

  // ── VS-DOCS-02 ──────────────────────────────────────────────────────────
  // A tapped image is a NodeSelection — not empty — so the text bubble rendered
  // on top of the image's own align toolbar and swallowed its buttons.
  test('VS-DOCS-02: tapping an image shows its toolbar, not the text bubble', async ({ page }) => {
    await openDoc(page);
    await page.evaluate(() => {
      window.__soleilDocTest.editor.commands.setContent(
        // A few lines above it so the image's toolbar sits mid-page, clear of
        // the doc toolbar row (as in the sweep's screenshot).
        `${'<p>before the picture</p>'.repeat(4)}<img src="${location.origin}/apple-touch-icon.png" style="width: 160px"><p>after</p>`);
    });
    const img = page.locator('.doc-card-modal .tt-img').first();
    await expect(img).toBeVisible();
    // Let it load and lay out first: a tap mid-load lands while the content
    // is still moving under it.
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
    await page.waitForTimeout(300);
    await img.tap();
    await expect(page.locator('.doc-card-modal .tt-img-wrap.is-selected')).toHaveCount(1);
    expect(await page.evaluate(() => !!window.__soleilDocTest.editor.state.selection.node)).toBe(true);
    await expect(page.locator('.doc-bubble')).toHaveCount(0);
    // Every align button is the top element at its own centre.
    const hits = await page.evaluate(() => [...document.querySelectorAll('.doc-card-modal .tt-img-tb button')].map((b) => {
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return b.contains(top) || `${b.getAttribute('aria-label')} is under ${top?.className}`;
    }));
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.filter((h) => h !== true)).toEqual([]);
    // A text selection still gets the bubble.
    await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().setTextSelection({ from: 1, to: 7 }).run());
    await expect(page.locator('.doc-bubble')).toBeVisible();
  });

  // ── VS-DOCS-07 / VS-DOCS-09 ─────────────────────────────────────────────
  test('VS-DOCS-07/09: drawer "+" buttons share a column; the drawer button matches the toolbar', async ({ page }) => {
    await openDoc(page);
    await addPages(page, ['Chapter Two', 'Chapter Three']);
    const btn = page.locator('.doc-card-modal .doc-mobile-pages-btn');
    await expect(btn).toHaveText('Page list');
    const fonts = await page.evaluate(() => ({
      drawer: getComputedStyle(document.querySelector('.doc-card-modal .doc-mobile-pages-btn')).fontFamily,
      toolbar: getComputedStyle(document.querySelector('.doc-card-modal .doc-tb .doc-tb-pill')).fontFamily,
    }));
    expect(fonts.drawer).toBe(fonts.toolbar);
    await btn.tap();
    await expect(page.locator('.doc-card-modal .doc-surface')).toHaveClass(/mobile-rail-open/);
    const cx = await page.evaluate(() => {
      const c = (el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
      return {
        root: c(document.querySelector('.doc-card-modal .doc-tree-add-root')),
        rows: [...document.querySelectorAll('.doc-card-modal .doc-tree-add')].map(c),
      };
    });
    expect(cx.rows.length).toBe(3);
    for (const x of cx.rows) expect(Math.abs(x - cx.root)).toBeLessThan(2);
  });
});
