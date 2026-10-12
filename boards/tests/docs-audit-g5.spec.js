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
