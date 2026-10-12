// Doc fixes from the platform audit (group G5), driven through the ?docqa=1
// harness (window.__soleilDocTest).
import { expect, test } from '@playwright/test';

async function openDoc(page, query = '') {
  await page.goto('/?docqa=1' + query);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

async function pagedMode(page) {
  await page.evaluate(() => { const T = window.__soleilDocTest; T.setPageless(T.ydoc, T.getScope(), false); });
  await page.locator('.doc-card-modal .doc-pages-bg').waitFor({ timeout: 8000 });
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

// ── DOCS-07 ───────────────────────────────────────────────────────────────
// y-prosemirror applies every remote change as ONE whole-document replace.
// Mapping the page-gap widgets through it deletes them all, and the re-measure
// found the same breaks, so the paginator treated it as converged and never put
// them back: text ran across the gutters until a local edit moved a break.
test('DOCS-07: page gaps come back after a whole-document (remote-style) replace', async ({ page }) => {
  await openDoc(page);
  await pagedMode(page);
  await page.evaluate(() => {
    const para = '<p>' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(12) + '</p>';
    window.__soleilDocTest.editor.commands.setContent(para.repeat(14));
  });
  const gaps = page.locator('.doc-card-modal .doc-page-gap');
  await expect.poll(() => gaps.count(), { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  const before = await gaps.count();
  // What a collaborator's keystroke looks like to this tab.
  const right = await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.view.dispatch(ed.state.tr.replaceWith(0, ed.state.doc.content.size, ed.state.doc.content));
    return document.querySelectorAll('.doc-card-modal .doc-page-gap').length;
  });
  expect(right).toBe(0);   // the replace really did drop them
  await expect.poll(() => gaps.count(), { timeout: 5000 }).toBe(before);
});

// ── DOCS-08 ───────────────────────────────────────────────────────────────
test('DOCS-08: Undo on deleting the only page brings it back with its text', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const scope = T.getScope();
    const [p] = T.readPages(T.ydoc, scope);
    T.renamePage(T.ydoc, p.id, 'Chapter One', scope);
    T.editor.commands.setContent('<p>Every word of the only page.</p>');
  });
  const modal = page.locator('.doc-card-modal');
  await expect(modal.locator('.doc-tree-row')).toHaveCount(1);
  await expect(modal.locator('.doc-tree-name')).toHaveText('Chapter One');
  await modal.locator('.doc-tree-row').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  // A blank replacement takes its place…
  await expect(modal.locator('.doc-tree-row')).toHaveCount(1);
  await expect(modal.locator('.doc-tree-name')).toHaveText('Untitled');
  // …and one Undo restores the page and its text, not "the board changed".
  await expect(page.locator('.toast-msg').filter({ hasText: 'Page deleted' })).toBeVisible();
  await page.locator('.toast').filter({ has: page.locator('.toast-msg', { hasText: 'Page deleted' }) })
    .locator('.toast-action').click();
  await expect(page.locator('.toast-msg').filter({ hasText: 'changed since' })).toHaveCount(0);
  await expect(modal.locator('.doc-tree-row')).toHaveCount(1);
  await expect(modal.locator('.doc-tree-name')).toHaveText('Chapter One');
  await expect(modal.locator('.ProseMirror')).toContainText('Every word of the only page.');
});

// ── DOCS-15 ───────────────────────────────────────────────────────────────
// A print whose afterprint never fires (the app's WebView has no print at all)
// used to hold the export menu open and busy for the 60 s safety net.
test('DOCS-15: Print / Save as PDF closes the menu at once and leaves the other exports usable', async ({ page }) => {
  // Every frame, the print iframe included: print() does nothing, no afterprint.
  await page.addInitScript(() => { window.print = () => {}; });
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setContent('<p>Printable words.</p>'));
  const trigger = page.locator('.doc-card-modal button[aria-label="Export"]');
  await trigger.click();
  const menu = page.locator('.doc-export-menu');
  await menu.getByRole('menuitem', { name: 'Print / Save as PDF' }).click();
  await expect(menu).toHaveCount(0, { timeout: 3000 });
  await trigger.click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    menu.getByRole('menuitem', { name: 'Export Markdown' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
});

// ── DOCS-16 ───────────────────────────────────────────────────────────────
test('DOCS-16: a bookmark shows under the page tree, jumps there, and removes with Undo', async ({ page }) => {
  await openDoc(page);
  const modal = page.locator('.doc-card-modal');
  await expect(modal.locator('.doc-bookmarks')).toHaveCount(0);   // nothing to list yet
  const pos = await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.commands.setContent('<p>Opening.</p>' + '<p>Filler line.</p>'.repeat(60) + '<p>The end of act two.</p>');
    let pos = null;
    ed.state.doc.descendants((n, p) => { if (pos == null && n.isText && n.text.startsWith('The end')) pos = p; });
    ed.commands.setTextSelection(pos);
    return pos;
  });
  await modal.locator('.doc-tb button[title="Bookmark this spot"]').click();
  const dialog = page.locator('.feedback-bg');
  await dialog.locator('input').fill('Act two out');
  await dialog.getByRole('button', { name: 'Add' }).click();
  const item = modal.locator('.doc-bookmarks-item');
  await expect(item).toHaveText('Act two out');
  // Move away, then jump back through the list.
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setTextSelection(2));
  await item.click();
  await expect.poll(() => page.evaluate(() => window.__soleilDocTest.editor.state.selection.from)).toBe(pos);
  // Remove → Undo toast brings it back.
  await modal.locator('.doc-bookmarks-row').hover();
  await modal.locator('.doc-bookmarks-x').click();
  await expect(modal.locator('.doc-bookmarks')).toHaveCount(0);
  await page.locator('.toast').filter({ has: page.locator('.toast-msg', { hasText: 'Bookmark removed' }) })
    .locator('.toast-action').click();
  await expect(item).toHaveText('Act two out');
});

// ── DOCS-17 ───────────────────────────────────────────────────────────────
test('DOCS-17: the resize handle and align bar sit on the image, and a drag tracks the pointer under zoom', async ({ page }) => {
  await openDoc(page);
  // Zoom the doc first: 3 × +10%.
  const zoomIn = page.locator('.doc-card-modal .doc-tb button[aria-label="Zoom in"]');
  for (let i = 0; i < 3; i++) await zoomIn.click();
  await page.evaluate(() => {
    window.__soleilDocTest.editor.commands.setContent(`<p>a</p><img src="${location.origin}/apple-touch-icon.png" style="width: 160px">`);
  });
  const img = page.locator('.doc-card-modal .tt-img').first();
  await expect(img).toBeVisible();
  await img.click();
  await expect(page.locator('.doc-card-modal .tt-img-wrap.is-selected')).toHaveCount(1);
  const geo = async () => page.evaluate(() => {
    const im = document.querySelector('.doc-card-modal .tt-img').getBoundingClientRect();
    const h = document.querySelector('.doc-card-modal .tt-img-resize').getBoundingClientRect();
    const tb = document.querySelector('.doc-card-modal .tt-img-tb').getBoundingClientRect();
    return { im: { l: im.left, r: im.right, b: im.bottom, w: im.width }, h: { cx: h.left + h.width / 2, cy: h.top + h.height / 2 }, tbc: tb.left + tb.width / 2 };
  });
  const g = await geo();
  // Handle on the image's bottom-right corner, bar centred over the image.
  expect(Math.abs(g.h.cx - g.im.r)).toBeLessThan(20);
  expect(Math.abs(g.h.cy - g.im.b)).toBeLessThan(20);
  expect(Math.abs(g.tbc - (g.im.l + g.im.w / 2))).toBeLessThan(4);
  expect(await page.locator('.doc-card-modal .tt-img-resize').evaluate(el => getComputedStyle(el).touchAction)).toBe('none');
  // Drag the handle 60 screen px right: the image's right edge follows it.
  await page.mouse.move(g.h.cx, g.h.cy);
  await page.mouse.down();
  await page.mouse.move(g.h.cx + 30, g.h.cy, { steps: 3 });
  await page.mouse.move(g.h.cx + 60, g.h.cy, { steps: 3 });
  const mid = await geo();
  await page.mouse.up();
  expect(Math.abs((mid.im.w - g.im.w) - 60)).toBeLessThan(4);
});

// ── DOCS-14 ───────────────────────────────────────────────────────────────
// A collaborator's edit arrives while the comment composer is open. It lands
// as a whole-document replace, so raw offsets captured at "Add comment" no
// longer point at the selected word.
test('DOCS-14: a comment posted after a collaborator edit still highlights the selected word', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.commands.setContent('<p>The quick brown fox jumps.</p>');
    const text = 'The quick brown fox jumps.';
    const from = text.indexOf('brown') + 1;
    ed.chain().focus().setTextSelection({ from, to: from + 'brown'.length }).run();
  });
  await page.locator('.doc-card-modal .doc-tb button[title^="Add comment"]').click();
  const input = page.locator('.inline-composer-input');
  await expect(input).toBeVisible();
  await input.fill('Right animal?');
  // The collaborator: a paragraph typed above, written straight into the Y
  // fragment the way a remote update arrives.
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const scope = T.getScope();
    const [p] = T.readPages(T.ydoc, scope);
    const frag = T.getOrCreatePageContent(T.ydoc, p.id, scope);
    const para = new T.Y.XmlElement('paragraph');
    const t = new T.Y.XmlText();
    t.insert(0, 'A whole new opening line from someone else.');
    para.insert(0, [t]);
    T.ydoc.transact(() => { frag.insert(0, [para]); }, 'remote-peer');
  });
  await expect(page.locator('.doc-card-modal .ProseMirror')).toContainText('A whole new opening line');
  await input.press('Enter');
  const mark = page.locator('.doc-card-modal .tt-comment');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveText('brown');
});
