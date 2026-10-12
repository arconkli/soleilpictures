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
