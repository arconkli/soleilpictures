// Prose reflow pagination + the sheets→single-fragment migration + WYSIWYG
// typography parity. Driven through the ?docqa=1 harness (window.__soleilDocTest).
import { expect, test } from '@playwright/test';

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

// ── Migration (pure logic) ────────────────────────────────────────────────
test('migration: stacked sheets collapse into the single fragment, in order, idempotently', async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  const r = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const Y = T.Y;
    const ydoc = new Y.Doc();
    const card = ydoc.getMap('cards').set('c1', new Y.Map());
    T.initCardDocStore(ydoc, card);              // migrates the (empty) doc → flag set
    const scope = T.cardScope(card);
    const pid = T.addPage(ydoc, { name: 'P1', scope });
    const mkPara = (txt) => { const el = new Y.XmlElement('paragraph'); const t = new Y.XmlText(); t.insert(0, txt); el.insert(0, [t]); return el; };
    const primary = T.getOrCreatePageContent(ydoc, pid, scope);
    ydoc.transact(() => { primary.insert(0, [mkPara('PRIMARY')]); });
    const s1 = T.addPageSheet(ydoc, pid, scope);
    const s2 = T.addPageSheet(ydoc, pid, scope);
    ydoc.transact(() => {
      T.getOrCreateSheetContent(ydoc, pid, s1, scope).insert(0, [mkPara('SHEET1')]);
      T.getOrCreateSheetContent(ydoc, pid, s2, scope).insert(0, [mkPara('SHEET2')]);
    });
    const before = T.getPageSheetIds(ydoc, pid, scope).length;
    // Re-arm the migration (the harness already ran it once on the empty doc).
    ydoc.transact(() => { T.metaMap(ydoc, scope).delete('contentModel'); });
    const changed = T.migrateSheetsToSingleFragment(ydoc, scope);
    const changedAgain = T.migrateSheetsToSingleFragment(ydoc, scope); // idempotent
    return {
      before,
      after: T.getPageSheetIds(ydoc, pid, scope).length,
      text: T.pageFragmentToText(T.getOrCreatePageContent(ydoc, pid, scope), 200),
      changed, changedAgain,
      flag: T.metaMap(ydoc, scope).get('contentModel'),
    };
  });
  expect(r.before).toBe(3);            // primary + 2 extras
  expect(r.after).toBe(1);             // collapsed to the single fragment
  expect(r.text).toBe('PRIMARY SHEET1 SHEET2'); // in order
  expect(r.changed).toBe(true);
  expect(r.changedAgain).toBe(false);  // second run is a no-op
  expect(r.flag).toBe('flow');
});

// ── Line-level reflow ─────────────────────────────────────────────────────
test('a paragraph taller than a page splits MID-paragraph across the boundary', async ({ page }) => {
  await openDoc(page);
  // One giant paragraph (no block breaks) that wraps well past a single page.
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    const big = 'The quick brown fox jumps over the lazy dog. '.repeat(220);
    ed.chain().focus().setContent(`<p>${big}</p>`).run();
  });
  await expect.poll(() => page.locator('.doc-card-modal .doc-page-sheet').count(), { timeout: 5000 })
    .toBeGreaterThanOrEqual(2);
  // The break gap lives INSIDE the paragraph (mid-block split), not between blocks.
  const insideParagraph = await page.evaluate(() => {
    const g = document.querySelector('.doc-card-modal .doc-page-gap');
    if (!g) return false;
    const p = g.parentElement;
    return !!p && p.tagName === 'P' && (p.textContent || '').length > 0;
  });
  expect(insideParagraph).toBe(true);
});

// ── Convergence (no runaway recompute) ────────────────────────────────────
test('pagination converges — editing does not cause a runaway page cascade', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.chain().focus().insertContent('<p>The quick brown fox jumps over the lazy dog.</p>'.repeat(50)).run();
  });
  await expect.poll(() => page.locator('.doc-card-modal .doc-page-sheet').count(), { timeout: 5000 })
    .toBeGreaterThanOrEqual(2);
  const n1 = await page.locator('.doc-card-modal .doc-page-sheet').count();
  // Type a little more; the count grows sanely and then holds (no oscillation).
  await page.locator('.doc-card-modal .tt-editor').click();
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus('end').insertContent('<p>tail</p>').run());
  await page.waitForTimeout(800);
  const n2 = await page.locator('.doc-card-modal .doc-page-sheet').count();
  const n3 = await page.locator('.doc-card-modal .doc-page-sheet').count();
  expect(n2).toBe(n3);             // stable (converged)
  expect(n2).toBeGreaterThanOrEqual(n1);
});

// ── WYSIWYG: the export uses the same typography as the screen ─────────────
test('WYSIWYG: exported HTML matches the on-screen doc typography', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus()
    .setContent('<h1>Title</h1><p>Body text for measuring.</p>').run());
  const screen = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.tt-editor'));
    return { font: cs.fontFamily, size: cs.fontSize, lh: cs.lineHeight };
  });
  // Render the exact exported HTML (shared print CSS) and read the same metrics.
  const exp = await page.evaluate(async () => {
    const T = window.__soleilDocTest;
    const body = await T.docExport.collectFullDocHtml(T.ydoc, T.getScope());
    const mod = await import('/src/lib/docTypography.js');
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-9999px;width:900px;height:600px';
    document.body.appendChild(f);
    const d = f.contentDocument;
    d.open(); d.write(`<!doctype html><html><head><style>${mod.docPrintCSS}</style></head><body>${body}</body></html>`); d.close();
    await new Promise(r => setTimeout(r, 50));
    const cs = f.contentWindow.getComputedStyle(d.body);
    const out = { font: cs.fontFamily, size: cs.fontSize, lh: cs.lineHeight };
    f.remove();
    return out;
  });
  // Same serif body family + same 16px size (12pt) on both surfaces.
  expect(exp.size).toBe(screen.size);
  expect(exp.size).toBe('16px');
  expect(exp.font.toLowerCase()).toContain('georgia');
  expect(screen.font.toLowerCase()).toContain('georgia');
});
