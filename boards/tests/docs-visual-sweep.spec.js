// Doc-editor layout fixes from the runtime visual sweep (VS-DOCS-*), driven
// through the ?docqa=1 harness. These run in the desktop-chrome project, so
// each describe block sets its own viewport and, where the defect is
// touch-only, a touch device (isMobile + hasTouch → hover:none and
// pointer:coarse, the query the mobile shell switches on).
import { expect, test } from '@playwright/test';
import { pageListButton, setScreenplay } from './helpers/docFrame.js';

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
      const btn = pageListButton(page.locator('.doc-card-modal'));
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
    // A text selection gets its formats back: on a phone they ride on the
    // keyboard, in its row (mobile/doc-look-phone.spec.js).
    await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().setTextSelection({ from: 1, to: 7 }).run());
    await expect(page.getByRole('toolbar', { name: 'Formatting', exact: true })).toBeVisible();
  });

  // ── VS-DOCS-07 ──────────────────────────────────────────────────────────
  test('VS-DOCS-07: the drawer\'s "+" buttons share a column', async ({ page }) => {
    await openDoc(page);
    await addPages(page, ['Chapter Two', 'Chapter Three']);
    await pageListButton(page.locator('.doc-card-modal')).tap();
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

// ── VS-DOCS-05 ────────────────────────────────────────────────────────────
// Fitting the whole 8.5in sheet to a phone rendered 12pt text at ~6px. Paged
// prose now shows continuous on a phone; screenplay fits its text column.
test.describe('phone 390 layouts', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...TOUCH });

  test('VS-DOCS-05: paged prose reads at full size, continuous, without changing the setting', async ({ page }) => {
    await openDoc(page);
    await page.evaluate(() => { const T = window.__soleilDocTest; T.setPageless(T.ydoc, T.getScope(), false); });
    await expect(page.locator('.doc-card-modal .doc-paper.is-pageless')).toBeVisible();
    await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
    await page.evaluate(() => window.__soleilDocTest.editor.commands.setContent('<p>The quick brown fox jumps over the lazy dog, twice over.</p>'));
    const r = await page.evaluate(() => {
      const T = window.__soleilDocTest;
      const paper = document.querySelector('.doc-card-modal .doc-paper');
      const p = paper.querySelector('.ProseMirror p');
      const zoom = parseFloat(getComputedStyle(paper).getPropertyValue('--doc-zoom')) || 1;
      return {
        px: parseFloat(getComputedStyle(p).fontSize) * zoom,
        fit: paper.classList.contains('is-fit-width'),
        // Same measure as the pageless case in mobile/docs-fit-width.spec.js.
        sideways: paper.querySelector('.doc-editor-wrap').getBoundingClientRect().width - paper.clientWidth,
        stillPaged: T.getPageless(T.ydoc, T.getScope()) === false,
      };
    });
    expect(r.px).toBeGreaterThanOrEqual(15);
    expect(r.fit).toBe(false);
    expect(r.sideways).toBeLessThanOrEqual(1);
    expect(r.stillPaged).toBe(true);
    // And says so, in ⋯'s Layout.
    await page.locator('.doc-card-modal .dl-head').getByRole('button', { name: /^More/ }).tap();
    await expect(page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: /^Layout/ })).toContainText('Pages');
  });

  test('VS-DOCS-05: screenplay fits its text column, keeping the true sheet', async ({ page }) => {
    await openDoc(page);
    await setScreenplay(page.locator('.doc-card-modal'), true);
    await page.waitForFunction(() =>
      window.__soleilDocTest.editor?.state?.doc?.firstChild?.type?.name === 'screenplayBlock', null, { timeout: 10000 });
    await page.evaluate(() => {
      const S = window.__soleilDocTest.screenplay;
      window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
        { element: 'scene', text: 'INT. KITCHEN - NIGHT' },
        { element: 'action', text: 'The fridge hums. A long action line that runs the full sixty characters of the column and wraps.' },
        { element: 'character', text: 'JON' },
        { element: 'dialogue', text: 'Is anyone there? I heard the door, and then nothing at all.' },
      ]));
    });
    await expect(page.locator('.doc-card-modal .doc-paper.is-fit-width')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.querySelector('.doc-card-modal .doc-paper').scrollLeft)).toBeGreaterThan(0);
    const r = await page.evaluate(() => {
      const paper = document.querySelector('.doc-card-modal .doc-paper');
      const wrap = paper.querySelector('.doc-editor-wrap:not(.sp-title-page)');
      const zoom = parseFloat(getComputedStyle(paper).getPropertyValue('--doc-zoom')) || 1;
      const pr = paper.getBoundingClientRect();
      const el = paper.querySelector('[data-screenplay-element]');
      const lines = [...paper.querySelectorAll('[data-screenplay-element]')].map((n) => n.getBoundingClientRect());
      return {
        px: parseFloat(getComputedStyle(el).fontSize) * zoom,
        offsetWidth: wrap.offsetWidth,
        padLeft: parseFloat(getComputedStyle(wrap).paddingLeft),
        allInView: lines.every((b) => b.left >= pr.left - 1 && b.right <= pr.right + 1),
      };
    });
    // 12pt Courier at the fitted zoom: was ~6.4px for the whole sheet.
    expect(r.px).toBeGreaterThanOrEqual(9.6);
    // The sheet's geometry is untouched (paginator / PDF agreement).
    expect(Math.abs(r.offsetWidth - 816)).toBeLessThanOrEqual(1);
    expect(r.padLeft).toBeCloseTo(144, 0);
    // Every line of the column is on screen.
    expect(r.allInView).toBe(true);
  });

  // The first open of a script on a device: no remembered page, so the sheet
  // mounts a beat after fit mode measures. The scroll to the column has to
  // wait for it, or every line opens cut off on the right.
  test('VS-DOCS-05: a screenplay opened cold starts scrolled to its column', async ({ page }) => {
    await page.goto('/?docqa=1');
    await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
    await page.evaluate(() => {
      const T = window.__soleilDocTest;
      T.setDocMode(T.ydoc, T.getScope(), 'screenplay');
      T.openCard();
    });
    await expect(page.locator('.doc-card-modal .doc-paper.is-fit-width')).toBeVisible();
    await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
    await page.evaluate(() => {
      const S = window.__soleilDocTest.screenplay;
      window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
        { element: 'scene', text: 'INT. KITCHEN - NIGHT' },
        { element: 'action', text: 'The fridge hums. A long action line that runs the full sixty characters of the column and wraps.' },
      ]));
    });
    await expect.poll(() => page.evaluate(() => document.querySelector('.doc-card-modal .doc-paper').scrollLeft)).toBeGreaterThan(0);
    const allInView = await page.evaluate(() => {
      const paper = document.querySelector('.doc-card-modal .doc-paper');
      const pr = paper.getBoundingClientRect();
      return [...paper.querySelectorAll('[data-screenplay-element]')]
        .every((n) => { const b = n.getBoundingClientRect(); return b.left >= pr.left - 1 && b.right <= pr.right + 1; });
    });
    expect(allInView).toBe(true);
  });
});
