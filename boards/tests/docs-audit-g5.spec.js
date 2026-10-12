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
