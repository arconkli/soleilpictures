import { expect, test } from '@playwright/test';

// A view-only member's Y.Doc writes never leave the tab: the board room marks
// their socket readOnly and drops every update. So any doc control that writes
// for a viewer is a control that looks like it saved and then vanishes on
// reload. These specs mount the real doc card with canEdit=false
// (?docqa=1&viewer=1) and assert the write controls are not offered.

async function openDoc(page, query = '') {
  await page.goto('/?docqa=1' + query);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

// Seed a commented word straight into the Y.Doc (programmatic commands still
// apply to a non-editable editor), returning the thread id.
async function seedComment(page, text, word, body) {
  return page.evaluate(({ text, word, body }) => {
    const T = window.__soleilDocTest;
    const editor = T.editor;
    editor.commands.setContent(`<p>${text}</p>`);
    const from = text.indexOf(word) + 1;
    const to = from + word.length;
    const id = T.addCommentThread(T.ydoc, {
      body, author: 'QA', authorId: null, authorColor: '#4f8df8', scope: T.getScope(),
    });
    editor.chain().setTextSelection({ from, to }).setMark('comment', { id }).run();
    return id;
  }, { text, word, body });
}

test('SHARE-3: a viewer can read a comment thread but not reply, resolve or delete it', async ({ page }) => {
  await openDoc(page, '&viewer=1');
  const id = await seedComment(page, 'The quick brown fox', 'brown', 'Right animal?');
  await page.locator(`.tt-comment[data-comment-id="${id}"]`).click();
  const pop = page.locator('.comment-inline-pop');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('Right animal?');
  await expect(pop.locator('.comment-inline-viewonly')).toHaveText('View only');
  await expect(pop.locator('.comment-inline-replyform')).toHaveCount(0);
  await expect(pop.locator('button[title="Resolve"]')).toHaveCount(0);
  await expect(pop.locator('button[title="Delete"]')).toHaveCount(0);
});

test('SHARE-3: an editor still gets the reply form, Resolve and Delete', async ({ page }) => {
  await openDoc(page);
  const id = await seedComment(page, 'The quick brown fox', 'brown', 'Right animal?');
  await page.locator(`.tt-comment[data-comment-id="${id}"]`).click();
  const pop = page.locator('.comment-inline-pop');
  await expect(pop).toBeVisible();
  await expect(pop.locator('.comment-inline-replyform')).toHaveCount(1);
  await expect(pop.locator('button[title="Resolve"]')).toHaveCount(1);
  await expect(pop.locator('button[title="Delete"]')).toHaveCount(1);
  await expect(pop.locator('.comment-inline-viewonly')).toHaveCount(0);
});

test('DOCS-09: a viewer gets no page-tree, toolbar or find writes', async ({ page }) => {
  await openDoc(page, '&viewer=1');
  const modal = page.locator('.doc-card-modal');
  // Page tree: rows are listed, but nothing that creates, renames or moves.
  await expect(modal.locator('.doc-tree-row')).toHaveCount(1);
  await expect(modal.locator('.doc-tree-add-root')).toHaveCount(0);
  await expect(modal.locator('.doc-tree-add')).toHaveCount(0);
  await expect(modal.locator('.doc-tree-row').first()).toHaveAttribute('draggable', 'false');
  await modal.locator('.doc-tree-row').first().dblclick();
  await expect(modal.locator('.doc-tree-rename')).toHaveCount(0);
  await modal.locator('.doc-tree-row').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  // Toolbar: Find, Export and zoom stay; the editing controls are gone.
  const tb = modal.locator('.doc-tb');
  await expect(tb.locator('button[title="Find (⌘F)"]')).toHaveCount(1);
  await expect(tb.locator('button[title="Export"]')).toHaveCount(1);
  await expect(tb.locator('.doc-tb-screenplay-toggle')).toHaveCount(0);
  await expect(tb.locator('.doc-tb-pages-toggle')).toHaveCount(0);
  await expect(tb.locator('button[title="Bold (⌘B)"]')).toHaveCount(0);
  await expect(tb.locator('button[title="Bookmark this spot"]')).toHaveCount(0);
  await expect(tb.locator('button[title="Undo (⌘Z)"]')).toHaveCount(0);
  // Find has no Replace.
  await tb.locator('button[title="Find (⌘F)"]').click();
  await expect(page.locator('.doc-find')).toBeVisible();
  await expect(page.locator('.doc-find button[aria-label="Toggle replace"]')).toHaveCount(0);
});

test('DOCS-09: an editor keeps the page tree and toolbar controls', async ({ page }) => {
  await openDoc(page);
  const modal = page.locator('.doc-card-modal');
  await expect(modal.locator('.doc-tree-add-root')).toHaveCount(1);
  await expect(modal.locator('.doc-tb .doc-tb-screenplay-toggle')).toHaveCount(1);
  await expect(modal.locator('.doc-tb button[title="Bold (⌘B)"]')).toHaveCount(1);
});

test('DOCS-09: clicking an image as a viewer shows no resize handle or align bar', async ({ page }) => {
  await openDoc(page, '&viewer=1');
  await page.evaluate(() => {
    // An http(s) src — the schema refuses data: URIs.
    window.__soleilDocTest.editor.commands.setContent(`<p>a</p><img src="${location.origin}/apple-touch-icon.png" style="width: 160px">`);
  });
  const img = page.locator('.doc-card-modal .tt-img').first();
  await expect(img).toBeVisible();
  await img.click();
  // ProseMirror may still node-select it (that writes nothing); what matters
  // is that the handle and align bar, which DO write, never reveal.
  await expect(page.locator('.doc-card-modal .tt-img-wrap.is-selected')).toHaveCount(0);
  await expect(page.locator('.doc-card-modal .tt-img-tb')).toHaveCSS('pointer-events', 'none');
});
