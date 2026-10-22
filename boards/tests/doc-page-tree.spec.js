// The page list is yours to fold: collapsing a page is kept on this device and
// writes nothing to the doc everyone shares, so it never folds the list for
// anyone else, and ⌘Z never "undoes" a fold. Through the ?docqa=1 harness.
import { expect, test } from '@playwright/test';

async function openDocWithChild(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const [first] = T.readPages(T.ydoc, T.getScope());
    T.addPage(T.ydoc, { name: 'Scene two', parent_id: first.id, scope: T.getScope() });
  });
  await expect(child(page)).toBeVisible();
}
const child = (page) => page.locator('.doc-card-modal .doc-tree-name', { hasText: 'Scene two' });
const chevron = (page, name) => page.locator('.doc-card-modal').getByRole('button', { name, exact: true });

test('collapsing a page writes nothing to the shared doc and is no undo step', async ({ page }) => {
  await openDocWithChild(page);
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    window.__treeWrites = 0;
    T.ydoc.on('update', () => { window.__treeWrites += 1; });
    window.__undoDepth = T.getDocUndoManager(T.ydoc, T.getScope()).undoStack.length;
  });
  await chevron(page, 'Collapse').click();
  await expect(child(page)).toHaveCount(0);
  await chevron(page, 'Expand').click();
  await expect(child(page)).toBeVisible();
  const after = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    return {
      writes: window.__treeWrites,
      undoSteps: T.getDocUndoManager(T.ydoc, T.getScope()).undoStack.length - window.__undoDepth,
    };
  });
  expect(after).toEqual({ writes: 0, undoSteps: 0 });
});

test('a collapsed page is still collapsed when the doc opens again', async ({ page }) => {
  await openDocWithChild(page);
  await chevron(page, 'Collapse').click();
  await expect(child(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close document' }).click();
  await expect(page.locator('.doc-card-modal')).toHaveCount(0);
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal .doc-tree-name').first()).toBeVisible();
  await expect(child(page)).toHaveCount(0);
  await chevron(page, 'Expand').click();
  await expect(child(page)).toBeVisible();
});

// Two edits to one page that meet leave it an entry each (docPages holds one
// plain entry per page, replaced on every edit). The list shows the page once
// either way; an editor's open doc then clears the extra entry on its own, as
// no undo step.
test('a page left with two entries shows once, and the open doc clears the extra', async ({ page }) => {
  await openDocWithChild(page);
  const depth = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const arr = T.getScope().pages;
    const entry = arr.toArray().find((p) => p.name === 'Scene two');
    T.ydoc.transact(() => arr.push([{ ...entry }]), 'remote-test');
    return T.getDocUndoManager(T.ydoc, T.getScope()).undoStack.length;
  });
  await expect(child(page)).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__soleilDocTest.getScope().pages
    .toArray().filter((p) => p.name === 'Scene two').length), { timeout: 8000 }).toBe(1);
  await expect(child(page)).toHaveCount(1);
  expect(await page.evaluate(() => {
    const T = window.__soleilDocTest;
    return T.getDocUndoManager(T.ydoc, T.getScope()).undoStack.length;
  })).toBe(depth);
});
