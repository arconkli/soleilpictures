import { expect, test } from '@playwright/test';

// The note formatting bar against the REAL collaborative note editor (the
// ?local canvas still runs the legacy contentEditable, so these drive the
// ?noteqa harness with its &toolbar=1 bar instead).

const A = '[data-client="A"] .note';
const A_EDIT = '[data-client="A"] .note-body[contenteditable="true"]';

async function editA(page, text = 'hello world') {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?noteqa=1&toolbar=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  if (text) await page.keyboard.type(text);
  await expect(page.locator('.tob')).toBeVisible();
}

// NOTES-04: the custom-font dialog took focus out of the note, the note left
// edit mode, and the bar that owned the dialog unmounted it within a frame.
test('Add custom font opens a dialog that stays, and closing it returns to the note', async ({ page }) => {
  await editA(page);
  await page.getByTitle('Font family').click();
  await page.getByRole('button', { name: '+ Add custom font…' }).click();
  const dialog = page.locator('.cfont');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(300);
  await expect(dialog).toBeVisible();
  await expect(page.locator('#cfont-title')).toHaveText('Custom fonts');
  await expect(page.locator(A_EDIT)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(A_EDIT)).toBeFocused();
});

// NOTES-05: with the caret in unformatted text the size box read blank and
// the steppers worked from a hard-coded 15, so + stuck at 16 and could shrink
// a big note. The bar now reads the size the caret's text actually renders at.
test('size steppers work from the note\'s own size', async ({ page }) => {
  await editA(page);
  const size = page.locator('.tob-size-combo');
  await expect(size).toHaveValue('15');
  const plus = page.getByRole('button', { name: 'Increase font size' });
  await plus.click();
  await plus.click();
  await expect(size).toHaveValue('17');
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.cardA.get('fontSize'))).toBe(17);
  await expect(page.locator(A_EDIT)).toBeFocused();
});

test('a note that is already 24px steps up from 24, not down to 16', async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?noteqa=1&toolbar=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
  await page.evaluate(() => {
    const t = window.__soleilNoteTest;
    t.docA.transact(() => t.cardA.set('fontSize', 24), 'local');
  });
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.keyboard.type('big');
  const size = page.locator('.tob-size-combo');
  await expect(size).toHaveValue('24');
  await page.getByRole('button', { name: 'Increase font size' }).click();
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.cardA.get('fontSize'))).toBe(25);
  await expect(size).toHaveValue('25');
});

test('picking a whole-note font names it on the font button', async ({ page }) => {
  await editA(page);
  await page.getByTitle('Font family').click();
  await page.locator('.font-pop-row', { hasText: /^Mono$/ }).click();
  await expect(page.getByTitle('Font family')).toContainText('JetBrains Mono');
});

// NOTES-15: the text-colour bar only updated where a colour mark existed, so
// it kept showing the last coloured span (or near-white on a light note).
test('the text colour bar follows the caret out of coloured text', async ({ page }) => {
  await editA(page, 'plain');
  const bar = page.locator('.tob-color-bar').first();
  const plainInk = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.keyboard.type(' red');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.getByTitle('Text color').click();
  await page.locator('.tob-pop .tob-sw[style*="239, 68, 68"]').click();
  await expect(bar).toHaveCSS('background-color', 'rgb(239, 68, 68)');
  // Back into "plain" (Home is not line-start on every platform).
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  await expect(bar).toHaveCSS('background-color', plainInk);
});

// NOTES-13: a caret-only size typed into the size box never handed focus back,
// and the note only leaves edit mode on its own blur, so it stayed "editing"
// with nothing focused and a click elsewhere no longer closed it.
test('Enter in the size box hands the caret back to the note', async ({ page }) => {
  await editA(page);
  const size = page.locator('.tob-size-combo');
  await size.click();
  await size.fill('20');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.cardA.get('fontSize'))).toBe(20);
  await expect(page.locator(A_EDIT)).toBeFocused();
  await page.mouse.click(5, 5);
  await expect(page.locator(A_EDIT)).toHaveCount(0);
});

test('clicking away from the size box applies the size and ends editing', async ({ page }) => {
  await editA(page);
  const size = page.locator('.tob-size-combo');
  await size.click();
  await size.fill('22');
  await page.mouse.click(5, 5);
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.cardA.get('fontSize'))).toBe(22);
  await expect(page.locator(A_EDIT)).toHaveCount(0);
  await expect(page.locator('.tob')).toHaveCount(0);
});

// NOTES-14: a press on the bar's padding, a separator or a popover label
// moved focus to <body>, which read as leaving the note.
test('clicking the toolbar between buttons keeps the note in edit mode', async ({ page }) => {
  await editA(page);
  await page.locator('.tob .tob-sep').first().click({ force: true });
  await expect(page.locator(A_EDIT)).toBeFocused();
  await expect(page.locator('.tob')).toBeVisible();

  await page.getByTitle('Font family').click();
  await page.locator('.font-pop-label', { hasText: 'FONTS' }).click();
  await expect(page.locator(A_EDIT)).toBeFocused();
  await expect(page.locator('.font-pop')).toBeVisible();
});

// NOTES-17: the editor chunk loads on the first edit of a session, and the
// note sat blank while it did.
test('a note keeps showing its text while the editor loads', async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/src/components/NoteTiptapSurface.jsx*', async (route) => { await gate; await route.continue(); });
  await page.goto('/?noteqa=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
  await page.evaluate(() => {
    const t = window.__soleilNoteTest;
    t.docA.transact(() => t.cardA.set('html', '<p>keep me visible</p>'), 'local');
  });
  await expect(page.locator(A)).toContainText('keep me visible');
  await page.locator(A).dblclick();
  await page.waitForTimeout(300);
  await expect(page.locator(A_EDIT)).toHaveCount(0);
  await expect(page.locator(A)).toContainText('keep me visible');
  release();
  await expect(page.locator(A_EDIT)).toBeVisible();
  await expect(page.locator(A_EDIT)).toContainText('keep me visible');
});

test('Add custom font from the legacy note editor stays open too', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  const body = page.locator('.note-body[contenteditable="true"]');
  await body.waitFor();
  await page.keyboard.type('legacy');
  await page.getByTitle('Font family').click();
  await page.getByRole('button', { name: '+ Add custom font…' }).click();
  await page.waitForTimeout(300);
  await expect(page.locator('.cfont')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cfont')).toHaveCount(0);
  await expect(body).toBeFocused();
});
