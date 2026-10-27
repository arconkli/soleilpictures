import { expect, test } from '@playwright/test';

// A view-only member's Y.Doc writes never leave the tab: the board room marks
// their socket readOnly and drops every update. So any doc control that writes
// for a viewer is a control that looks like it saved and then vanishes on
// reload. These specs mount the real doc card with canEdit=false
// (?docqa=1&viewer=1) and assert the write controls are not offered. The
// look's reader's bar is doc-bar-a.spec.js's, its Find with no Replace
// doc-panel-find.spec.js's, and its comment cards with no reply, resolve or
// delete doc-panel-comments.spec.js's.

async function openDoc(page, query = '') {
  await page.goto('/?docqa=1' + query);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

test('DOCS-09: a viewer gets no page-tree writes', async ({ page }) => {
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
});

test('DOCS-09: an editor keeps the page tree', async ({ page }) => {
  await openDoc(page);
  await expect(page.locator('.doc-card-modal .doc-tree-add-root')).toHaveCount(1);
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
