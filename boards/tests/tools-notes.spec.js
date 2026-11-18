// The note tool, as a person uses it, in the real signed-in app with the
// production note editor (Supabase stubbed, helpers/signedInStub.js): a second
// click opens a selected note with the caret where it landed, Enter opens it
// with the caret at the end, a new note left empty goes without a trace, the
// size buttons step a ladder, and Escape in the size box hands the focus back
// to the note.
//
//   cd boards && PW_PORT=5291 npx playwright test tests/tools-notes.spec.js --project=desktop-chrome
import { expect, test } from '@playwright/test';
import { bootRealBoard, cardsOnCanvas, undoToast } from './tools-helpers.js';
import { noteBar, sizeDown, sizeField, sizeUp } from './helpers/noteBar.js';

const EDIT = '.card .note-body[contenteditable="true"]';
const READ = '.card .note > .note-body';
const AWAY = { x: 1000, y: 640 };   // empty canvas, clear of every note placed here

test.describe.configure({ timeout: 60_000 });

async function placeNote(page, at = { x: 300, y: 160 }) {
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: at });
  await page.locator(EDIT).waitFor();
  await expect(page.locator(EDIT)).toBeFocused();
}
async function closeNote(page) {
  await page.locator('.canvas-wrap').click({ position: AWAY });
  await expect(page.locator(EDIT)).toHaveCount(0);
}
// A closed note holding `text`, at `at`.
async function noteWith(page, text, at) {
  await placeNote(page, at);
  await page.keyboard.type(text);
  await closeNote(page);
  await expect(page.locator(READ)).toHaveText(text);
}
// Client point at `frac` of `word`'s width, on its middle line.
function wordAtFraction(page, sel, word, frac) {
  return page.evaluate(({ sel, word, frac }) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const i = n.nodeValue.indexOf(word);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + word.length);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width * frac, y: b.top + b.height / 2 };
    }
    return null;
  }, { sel, word, frac });
}

test.describe('opening a note', () => {
  test('one click selects it; a second click, without moving, edits it with the caret where it landed', async ({ page }) => {
    await bootRealBoard(page);
    const text = 'alpha bravo charlie';
    await noteWith(page, text, { x: 300, y: 160 });
    const at = await wordAtFraction(page, READ, 'bravo', 0.5);
    expect(at).not.toBeNull();

    await page.mouse.click(at.x, at.y);
    await expect(cardsOnCanvas(page).first()).toHaveClass(/is-selected/);
    await expect(page.locator(EDIT)).toHaveCount(0);

    await page.waitForTimeout(700);   // well past a double-click
    await page.mouse.click(at.x, at.y);
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    await page.keyboard.type('X');
    const got = (await page.locator(EDIT).innerText()).replace(/\n/g, '');
    // Typed in the word that was clicked (or at its edge), not at the start or the end.
    expect(got.replace('X', '')).toBe(text);
    const i = got.indexOf('X');
    expect(i).toBeGreaterThanOrEqual('alpha '.length);
    expect(i).toBeLessThanOrEqual('alpha bravo'.length);
  });

  test('Enter on a selected note edits it with the caret at the end', async ({ page }) => {
    await bootRealBoard(page);
    await noteWith(page, 'alpha bravo charlie', { x: 300, y: 160 });
    const at = await wordAtFraction(page, READ, 'alpha', 0.5);
    await page.mouse.click(at.x, at.y);
    await expect(page.locator(EDIT)).toHaveCount(0);
    await page.keyboard.press('Enter');
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    await page.keyboard.type('Z');
    await expect(page.locator(EDIT)).toHaveText('alpha bravo charlieZ');
  });
});

test.describe('a new note', () => {
  test('left empty and clicked away from, it is gone and no Undo toast shows', async ({ page }) => {
    await bootRealBoard(page);
    await placeNote(page);
    await expect(cardsOnCanvas(page)).toHaveCount(1);
    await page.locator('.canvas-wrap').click({ position: AWAY });
    await expect(cardsOnCanvas(page)).toHaveCount(0);
    await page.waitForTimeout(800);   // a toast would be up by now
    await expect(undoToast(page)).toHaveCount(0);
  });

  test('discarding it takes nothing off the undo stack: Undo once undoes the real edit before it', async ({ page }) => {
    await bootRealBoard(page);
    await noteWith(page, 'keeper', { x: 300, y: 160 });
    const keeper = cardsOnCanvas(page).first();
    const start = await keeper.boundingBox();
    // A real edit: drag the note to a new spot.
    const grab = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(grab.x + (260 * i) / 12, grab.y + (120 * i) / 12);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await expect.poll(async () => Math.round((await keeper.boundingBox()).x - start.x)).toBeGreaterThan(200);
    const moved = await keeper.boundingBox();
    await page.waitForTimeout(400);
    const before = await cardsOnCanvas(page).count();

    // A new note, left empty, clicked away from: gone.
    await placeNote(page, { x: 300, y: 460 });
    await expect(cardsOnCanvas(page)).toHaveCount(before + 1);
    await page.locator('.canvas-wrap').click({ position: AWAY });
    await expect(cardsOnCanvas(page)).toHaveCount(before);
    await page.waitForTimeout(400);

    // One Undo gives the drag back: no blank note comes back instead.
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => Math.abs((await keeper.boundingBox()).x - start.x)).toBeLessThanOrEqual(2);
    const back = await keeper.boundingBox();
    expect(Math.abs(back.y - start.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(moved.x - back.x)).toBeGreaterThan(200);
    await page.waitForTimeout(400);
    await expect(cardsOnCanvas(page)).toHaveCount(before);
    await expect(page.locator(READ)).toHaveText('keeper');
  });

  test('with one letter typed it stays', async ({ page }) => {
    await bootRealBoard(page);
    await placeNote(page);
    await page.keyboard.type('a');
    await page.locator('.canvas-wrap').click({ position: AWAY });
    await expect(page.locator(EDIT)).toHaveCount(0);
    await page.waitForTimeout(800);
    await expect(cardsOnCanvas(page)).toHaveCount(1);
    await expect(page.locator(READ)).toHaveText('a');
  });
});

test.describe('the size box and buttons', () => {
  // Text at the default size, all of it picked so the bar reads and sets its size.
  async function noteAt15(page) {
    await placeNote(page);
    await page.keyboard.type('sizes');
    await page.keyboard.press('ControlOrMeta+a');
    await expect(noteBar(page)).toBeVisible();
    await expect(sizeField(page)).toHaveValue('15');
  }

  test('+ steps 15 to 18 to 24', async ({ page }) => {
    await bootRealBoard(page);
    await noteAt15(page);
    await sizeUp(page).click();
    await expect(sizeField(page)).toHaveValue('18');
    await sizeUp(page).click();
    await expect(sizeField(page)).toHaveValue('24');
  });

  test('− steps 15 to 13', async ({ page }) => {
    await bootRealBoard(page);
    await noteAt15(page);
    await sizeDown(page).click();
    await expect(sizeField(page)).toHaveValue('13');
  });

  test('Escape in the size box puts the focus back in the note: Backspace edits the note, not the card', async ({ page }) => {
    await bootRealBoard(page);
    await placeNote(page);
    await page.keyboard.type('hello');
    await expect(noteBar(page)).toBeVisible();
    await sizeField(page).click();
    await expect(sizeField(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator(EDIT)).toBeFocused();
    await page.keyboard.press('Backspace');
    await expect(page.locator(EDIT)).toHaveText('hell');
    await expect(cardsOnCanvas(page)).toHaveCount(1);
  });
});
