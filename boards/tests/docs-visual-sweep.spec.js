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

// ── VS-DOCS-03 ────────────────────────────────────────────────────────────
// With the page rail open the bar is wider than a 1440 overlay, and with its
// scrollbar hidden Find, Export, Zoom, Undo and Redo sat silently off-screen.
// On a mouse it now wraps; where it still scrolls (touch) the edges fade.
async function offBarControls(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.doc-card-modal .doc-tb');
    const br = bar.getBoundingClientRect();
    return [...bar.querySelectorAll('button, select, input')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > br.right + 1 || r.left < br.left - 1 || r.bottom > br.bottom + 1);
    }).map((el) => el.getAttribute('aria-label') || el.title);
  });
}

for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
  test.describe(`mouse ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });
    test('VS-DOCS-03: every toolbar control is on screen with the page rail open', async ({ page }) => {
      await openDoc(page);
      await expect(page.locator('.doc-card-modal .doc-rail-left')).toBeVisible();
      expect(await offBarControls(page)).toEqual([]);
      for (const name of ['Find (⌘F)', 'Zoom in', 'Undo (⌘Z)', 'Redo (⌘⇧Z)']) {
        await expect(page.locator(`.doc-card-modal .doc-tb [aria-label="${name}"]`)).toBeInViewport();
      }
      // The find bar hangs below the (now taller) toolbar, not over its last row.
      await page.locator('.doc-card-modal .doc-tb button[title="Find (⌘F)"]').click();
      await expect(page.locator('.doc-find')).toBeVisible();
      const gap = await page.evaluate(() =>
        document.querySelector('.doc-find').getBoundingClientRect().top
        - document.querySelector('.doc-card-modal .doc-tb').getBoundingClientRect().bottom);
      expect(gap).toBeGreaterThanOrEqual(0);
    });
  });
}

test.describe('phone 390 toolbar', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...TOUCH });

  test('VS-DOCS-03: the swipeable bar fades the edge that has more past it', async ({ page }) => {
    await openDoc(page);
    const bar = page.locator('.doc-card-modal .doc-tb');
    await expect(bar).toHaveClass(/has-more-end/);
    await expect(bar).not.toHaveClass(/has-more-start/);
    await bar.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await expect(bar).toHaveClass(/has-more-start/);
    await expect(bar).not.toHaveClass(/has-more-end/);
  });

  // ── VS-DOCS-06 ──────────────────────────────────────────────────────────
  test('VS-DOCS-06: the find bar hides the toolbar row and its two fields line up', async ({ page }) => {
    await openDoc(page);
    const findBtn = page.locator('.doc-card-modal .doc-tb button[title="Find (⌘F)"]');
    await findBtn.evaluate((el) => el.scrollIntoView({ inline: 'center' }));
    await findBtn.tap();
    const bar = page.locator('.doc-find');
    await expect(bar).toBeVisible();
    await bar.locator('button[aria-label="Toggle replace"]').click();
    await expect(bar.locator('input[aria-label="Replace with"]')).toBeVisible();
    const m = await page.evaluate(() => {
      const f = document.querySelector('.doc-find').getBoundingClientRect();
      const [a, b] = [...document.querySelectorAll('.doc-find input')].map((i) => i.getBoundingClientRect());
      const edge = document.elementFromPoint(window.innerWidth - 4, f.top + 14);
      return {
        lefts: [a.left, b.left], rights: [a.right, b.right],
        peek: !!edge?.closest('.doc-tb'),
        tb: getComputedStyle(document.querySelector('.doc-card-modal .doc-tb')).visibility,
        closeOnFirstRow: document.querySelector('.doc-find-x').getBoundingClientRect().top < b.top,
      };
    });
    expect(Math.abs(m.lefts[0] - m.lefts[1])).toBeLessThan(1);
    expect(Math.abs(m.rights[0] - m.rights[1])).toBeLessThan(1);
    expect(m.peek).toBe(false);
    expect(m.tb).toBe('hidden');
    expect(m.closeOnFirstRow).toBe(true);
    // Closing brings the toolbar back.
    await bar.locator('.doc-find-x').click();
    await expect(page.locator('.doc-card-modal .doc-tb')).toBeVisible();
  });
});

// ── VS-DOCS-04 ────────────────────────────────────────────────────────────
// The thread popover opened on the comment's own line: beside it on desktop
// (hiding the rest of the sentence) and, clamped back from the right edge on
// a phone, right on top of the commented word.
for (const [label, vp, touch] of [['phone 390', { width: 390, height: 844 }, true], ['mouse 1440', { width: 1440, height: 900 }, false]]) {
  test.describe(`${label} comment`, () => {
    test.use({ viewport: vp, ...(touch ? TOUCH : {}) });
    test('VS-DOCS-04: the thread popover leaves the commented text visible', async ({ page }) => {
      await openDoc(page);
      const id = await page.evaluate(() => {
        const T = window.__soleilDocTest;
        const text = 'The quick brown fox jumps over the lazy dog and keeps on running.';
        T.editor.commands.setContent(`<p>${text}</p><p>A second paragraph under it.</p>`);
        const from = text.indexOf('brown') + 1;
        const id = T.addCommentThread(T.ydoc, { body: 'Is this the right animal?', author: 'QA', authorId: null, authorColor: '#4f8df8', scope: T.getScope() });
        T.editor.chain().setTextSelection({ from, to: from + 5 }).setMark('comment', { id }).run();
        return id;
      });
      const mark = page.locator(`.tt-comment[data-comment-id="${id}"]`);
      if (touch) await mark.tap(); else await mark.click();
      await expect(page.locator('.comment-inline-pop')).toBeVisible();
      const r = await page.evaluate((cid) => {
        const m = document.querySelector(`.tt-comment[data-comment-id="${cid}"]`).getBoundingClientRect();
        const p = document.querySelector('.comment-inline-pop').getBoundingClientRect();
        const hit = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2);
        return {
          markHit: !!hit?.closest('.tt-comment'), popTop: p.top, markBottom: m.bottom,
          inView: p.left >= 0 && p.right <= innerWidth && p.bottom <= innerHeight,
        };
      }, id);
      expect(r.markHit).toBe(true);
      expect(r.popTop).toBeGreaterThanOrEqual(r.markBottom);
      expect(r.inView).toBe(true);
    });
  });
}
