// A note's formatting bar keeps the caret in the note while one of its
// popovers is open (the font list, the size list, the colours), so the note
// heard an Escape before the popover did and ended the edit, taking the bar
// and the popover with it: closing the colours ended the note. A popover now
// takes one Escape and hands it to nothing else; the next one is the note's.
// Against the real collaborative note editor, through ?noteqa&toolbar=1.
import { expect, test } from '@playwright/test';

const A = '[data-client="A"] .note';
const A_EDIT = '[data-client="A"] .note-body[contenteditable="true"]';

async function editA(page) {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?noteqa=1&toolbar=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  await page.keyboard.type('hello world');
  await expect(page.locator('.tob')).toBeVisible();
}

const POPOVERS = [
  ['font list', (bar) => bar.getByTitle('Font family'), '.font-pop'],
  ['size list', (bar) => bar.getByRole('button', { name: 'Preset sizes' }), '.size-combo-pop'],
  ['text colours', (bar) => bar.getByTitle('Text color'), '.tob-pop'],
  ['background colours', (bar) => bar.getByTitle('Card background'), '.tob-pop'],
];

for (const [label, trigger, pop] of POPOVERS) {
  test(`Escape closes a note's ${label} and the note stays in edit`, async ({ page }) => {
    await editA(page);
    await trigger(page.locator('.tob')).click();
    await expect(page.locator(pop)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(pop)).toHaveCount(0);
    await page.waitForTimeout(200);
    await expect(page.locator(A_EDIT)).toBeFocused();
    await expect(page.locator('.tob')).toBeVisible();
    await expect(page.locator(A_EDIT)).toContainText('hello world');
    // The next Escape is the note's.
    await page.keyboard.press('Escape');
    await expect(page.locator(A_EDIT)).toHaveCount(0);
  });
}
