// Two docs side by side (lib/docPanes.js). With a doc docked beside the board,
// opening any other doc puts it in the board's place, so two docs can be read
// at once; × on either brings the board back. Through ?docqa=1&panes=1: the
// real RichDocCard, DockedDocPane and DocPaneFrame in App's split chain.
import { expect, test } from '@playwright/test';

async function open(page) {
  await page.goto('/?docqa=1&panes=1');
  await page.waitForSelector('[data-docqa-panes-ready]');
}
const card = (page, id) => page.locator(`[data-docqa-card="${id}"] .doc-card`);
const pane = (page, which) => page.locator(`[data-doc-pane="${which}"]`);
const title = (page, which) => pane(page, which).getByRole('textbox', { name: 'Document title' });
const openOnBoard = (page, id) => card(page, id).locator('.doc-card-page').dblclick();
const pages = (page, id) => page.evaluate((cardId) => {
  const T = window.__soleilDocTest;
  return T.readPages(T.ydoc, T.scopeOf(cardId)).length;
}, id);

async function dock(page, id, name) {
  await card(page, id).getByRole('button', { name: 'Open beside' }).click();
  await expect(title(page, 'split')).toHaveValue(name);
}

test('with a doc docked, opening another puts it beside, and the docked one stays', async ({ page }) => {
  await open(page);
  await dock(page, 'doc-a', 'Treatment');
  await expect(pane(page, 'beside')).toHaveCount(0);

  await openOnBoard(page, 'doc-b');
  await expect(title(page, 'beside')).toHaveValue('Sundown Highway');
  await expect(title(page, 'split')).toHaveValue('Treatment');
  // In the board's place, the whole of its pane.
  const board = await page.locator('[data-docqa-canvas]').boundingBox();
  const beside = await pane(page, 'beside').boundingBox();
  expect(beside).toEqual(board);
  // Nothing opened over everything.
  await expect(page.locator('.doc-card-modal-full')).toHaveCount(0);

  // A third, from anywhere that opens a doc (Files, a peer, ⌘K): beside, in
  // place of the second.
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('soleil-open-doc-card', {
    detail: { cardId: 'doc-c', pageId: null, scrollTop: 0 },
  })));
  await expect(title(page, 'beside')).toHaveValue('Notes');
  await expect(title(page, 'split')).toHaveValue('Treatment');
});

test('opening the docked doc itself moves nothing', async ({ page }) => {
  await open(page);
  await dock(page, 'doc-a', 'Treatment');
  await openOnBoard(page, 'doc-a');
  await expect(title(page, 'split')).toHaveValue('Treatment');
  await expect(pane(page, 'beside')).toHaveCount(0);
  await expect(page.locator('.doc-card-modal-full')).toHaveCount(0);
});

test('× on the docked doc moves the one beside into the dock, and the board comes back', async ({ page }) => {
  await open(page);
  await dock(page, 'doc-a', 'Treatment');
  await openOnBoard(page, 'doc-b');
  await expect(title(page, 'beside')).toHaveValue('Sundown Highway');

  await pane(page, 'split').getByRole('button', { name: 'Close document' }).click();
  await expect(title(page, 'split')).toHaveValue('Sundown Highway');
  await expect(pane(page, 'beside')).toHaveCount(0);
  await expect(card(page, 'doc-a')).toBeVisible();

  await pane(page, 'split').getByRole('button', { name: 'Close document' }).click();
  await expect(pane(page, 'split')).toHaveCount(0);
});

test('× on the doc beside brings the board back and leaves the dock as it was', async ({ page }) => {
  await open(page);
  await dock(page, 'doc-a', 'Treatment');
  await openOnBoard(page, 'doc-b');
  await pane(page, 'beside').getByRole('button', { name: 'Close document' }).click();
  await expect(pane(page, 'beside')).toHaveCount(0);
  await expect(card(page, 'doc-b')).toBeVisible();
  await expect(title(page, 'split')).toHaveValue('Treatment');
});

test('⌘Z undoes page changes only in the doc whose pane the keyboard is in', async ({ page }) => {
  await open(page);
  await dock(page, 'doc-a', 'Treatment');
  await openOnBoard(page, 'doc-b');
  await expect(title(page, 'beside')).toHaveValue('Sundown Highway');
  // Each doc seeds its first page as it opens, as no undo step.
  await expect.poll(() => pages(page, 'doc-a')).toBe(1);
  await expect.poll(() => pages(page, 'doc-b')).toBe(1);
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.addPage(T.ydoc, { name: 'Act two', scope: T.scopeOf('doc-b') });
  });
  await expect.poll(() => pages(page, 'doc-b')).toBe(2);

  // The keyboard in the docked doc: ⌘Z there is that doc's, and it has
  // nothing to undo.
  await pane(page, 'split').locator('.doc-foot').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => pages(page, 'doc-b')).toBe(2);
  expect(await pages(page, 'doc-a')).toBe(1);

  // In the doc beside, it takes the page back.
  await pane(page, 'beside').locator('.doc-foot').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => pages(page, 'doc-b')).toBe(1);
  expect(await pages(page, 'doc-a')).toBe(1);
});

test('⌘F opens find only in the doc it is pressed in', async ({ page }) => {
  await open(page);
  await dock(page, 'doc-a', 'Treatment');
  await openOnBoard(page, 'doc-b');
  await pane(page, 'beside').locator('.tt-editor').first().click();
  await page.keyboard.press('ControlOrMeta+f');
  await expect(pane(page, 'beside').locator('.doc-find')).toBeVisible();
  await expect(pane(page, 'split').locator('.doc-find')).toHaveCount(0);
});

test('with nothing docked, a double-click opens a doc the way it always has', async ({ page }) => {
  await open(page);
  await openOnBoard(page, 'doc-b');
  await expect(page.locator('.doc-card-modal-full')).toBeVisible();
  await expect(pane(page, 'beside')).toHaveCount(0);
  await expect(pane(page, 'split')).toHaveCount(0);
});
