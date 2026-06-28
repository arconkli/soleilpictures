import { expect, test } from '@playwright/test';

test('note format buttons reflect active state + size picker shows current size', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  await page.keyboard.type('hello world');
  await page.keyboard.press('ControlOrMeta+a');

  const boldBtn = page.getByTitle('Bold (⌘B)');
  await expect(boldBtn).toBeVisible();
  await expect(boldBtn).not.toHaveClass(/is-active/);

  // Bold → button becomes active; unbold → inactive again.
  await page.keyboard.press('ControlOrMeta+b');
  await expect(boldBtn).toHaveClass(/is-active/);
  await page.keyboard.press('ControlOrMeta+b');
  await expect(boldBtn).not.toHaveClass(/is-active/);

  // The size combobox reflects the caret's font size instead of the blank
  // "Size" placeholder. (.tob-select was the pre-SizeInput selector — this
  // assertion had rotted into a guaranteed miss.)
  const size = page.locator('.tob-size-combo');
  await expect(size).not.toHaveValue('');
});

async function openNoteForEdit(page, text = 'hello world') {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  const body = page.locator('.note-body[contenteditable="true"]');
  await body.waitFor();
  await body.click();
  await page.keyboard.type(text);
  return body;
}

test('unbold works on a MIXED selection that starts bold', async ({ page }) => {
  const body = await openNoteForEdit(page, 'hello world');
  // Bold only the FIRST word: select "hello" from the start.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ArrowLeft'); // collapse to start
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ControlOrMeta+b');
  // Select ALL → mixed ("hello" bold + " world" plain), range START is in
  // the bold run so the button shows LIT. Clicking it must honor what the
  // user saw and UNBOLD — Chrome's own execCommand direction on a mixed
  // selection is "bold everything", which silently re-bolded instead
  // ("I un-bold and it's still bold").
  await page.keyboard.press('ControlOrMeta+a');
  const boldBtn = page.getByTitle('Bold (⌘B)');
  await expect(boldBtn).toHaveClass(/is-active/);
  await boldBtn.click();
  await expect(boldBtn).not.toHaveClass(/is-active/);
  const html = await body.innerHTML();
  expect(html).not.toMatch(/font-weight:\s*(bold|[6-9]00)|<b[\s>]|<strong/i);
});

test('size combobox reflects a freshly applied selection size', async ({ page }) => {
  await openNoteForEdit(page, 'resize me');
  await page.keyboard.press('ControlOrMeta+a');
  const size = page.locator('.tob-size-combo');
  await size.click();
  await size.fill('24');
  await page.keyboard.press('Enter');
  // The box must keep showing the size it just applied — sampling the
  // PARENT of the new span used to snap it back to the old value.
  await expect(size).toHaveValue('24');
});

test('caret-only size commit rescales the whole note via its base font', async ({ page }) => {
  await openNoteForEdit(page, 'whole note');
  // Collapse the caret — nothing selected.
  await page.keyboard.press('ArrowRight');
  const size = page.locator('.tob-size-combo');
  await size.click();
  await size.fill('21');
  await page.keyboard.press('Enter');
  // Falls back to the card-level fontSize prop → inline style on .note.
  const note = page.locator('.card .note').last();
  await expect.poll(() => note.evaluate(el => el.style.fontSize)).toBe('21px');
});

test('size steppers and preset dropdown work without ending the edit session', async ({ page }) => {
  await openNoteForEdit(page, 'stepper');
  await page.keyboard.press('ControlOrMeta+a');
  const size = page.locator('.tob-size-combo');
  const before = parseInt(await size.inputValue(), 10);
  await page.getByTitle('Increase font size').click();
  await expect(size).toHaveValue(String(before + 1));
  await expect(page.locator('.note-body[contenteditable="true"]')).toHaveCount(1);

  // Preset dropdown: visible list, picking applies and keeps editing.
  await page.getByTitle('Preset sizes').click();
  await expect(page.locator('.size-combo-pop')).toBeVisible();
  await page.locator('.size-combo-item', { hasText: /^32$/ }).click();
  await expect(size).toHaveValue('32');
  await expect(page.locator('.size-combo-pop')).toHaveCount(0);
  await expect(page.locator('.note-body[contenteditable="true"]')).toHaveCount(1);
});

test('font picker label names the font under the caret', async ({ page }) => {
  await openNoteForEdit(page, 'typeface');
  // The default note font stack starts with Inter — the trigger label should
  // surface a real family name, not the static "Font".
  await expect(page.locator('.tob .doc-tb-pill-label').first()).not.toHaveText('Font');
});
