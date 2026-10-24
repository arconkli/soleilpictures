// Typing straight after placing a note lands in the note: the editor mounts
// and takes focus a few frames after the card appears, and the keys typed in
// between used to reach the page instead, lost, or worse, taken as the
// canvas's shortcuts (D is the draw tool, H is Pan). On the real canvas,
// through ?local=1.
import { expect, test } from '@playwright/test';

async function blank(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.waitForTimeout(800);
  // Clear of the empty board's tiles in the middle.
  const box = await page.locator('.canvas-wrap').boundingBox();
  return { x: box.x + box.width * 0.75, y: box.y + box.height * 0.3 };
}

const body = (page) => page.locator('.canvas-wrap .card .note-body').first();
const TEXT = 'hello world, drawn';

test('the note tool, a click, then typing at once: every key is the note\'s', async ({ page }) => {
  const at = await blank(page);
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type(TEXT);
  await expect(body(page)).toHaveText(TEXT);
  // The canvas took none of them: no draw bar, and the note still edits.
  await expect(page.locator('.tob[aria-label="Draw"]')).toHaveCount(0);
  await expect(page.locator('.card .note-body[contenteditable="true"]')).toBeFocused();
});

test('N, a click, then typing at once: every key is the note\'s', async ({ page }) => {
  const at = await blank(page);
  await page.keyboard.press('n');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type(TEXT);
  await expect(body(page)).toHaveText(TEXT);
});

test('the add menu\'s Note, then typing at once: every key is the note\'s', async ({ page }) => {
  const at = await blank(page);
  await page.mouse.dblclick(at.x, at.y);
  await page.getByRole('menuitem', { name: /^Note/ }).first().click();
  await page.keyboard.type(TEXT);
  await expect(body(page)).toHaveText(TEXT);
});

// The collaborative note (production's) through ?noteqa=1: its editor is a
// chunk of its own, held back here so the typing comes while it loads.
test('the collaborative note\'s editor takes what was typed while its code loaded', async ({ page }) => {
  await page.goto('/?noteqa=1');
  await page.waitForFunction(() => !!window.__soleilNoteTest?.ready, null, { timeout: 15000 });
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route(/\/src\/components\/NoteTiptapSurface\.jsx/, async (route) => { await held; await route.continue(); });
  // Editing, its editor still loading: then the note is placed (the hold) and
  // typed into.
  await page.locator('[data-client="A"] .note').dblclick();
  await page.evaluate(() => window.__soleilNoteTest.holdTypeAhead('noteqa-card'));
  await page.keyboard.type('typed early');
  release();
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getTextA())).toContain('typed early');
  await expect(page.locator('[data-client="A"] .note-body[contenteditable="true"]')).toBeFocused();
});

test('a press elsewhere, or Escape, gives the canvas its keys back', async ({ page }) => {
  const at = await blank(page);
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.card .note-body[contenteditable="true"]')).toBeFocused();
  // The note took the hold; the canvas's keys work as ever after it.
  await page.keyboard.press('Escape');
  await page.mouse.click(at.x - 300, at.y + 200);
  await page.keyboard.press('h');
  await expect(page.locator('.cnv-tools [aria-label^="Pan"]').first()).toHaveClass(/active/);
  await expect(page.locator('.note-typeahead')).toHaveCount(0);
});
