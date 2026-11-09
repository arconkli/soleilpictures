// Opening a note changes nothing on screen, in the real signed-in app with
// the real ydoc and the production note editor (helpers/signedInStub.js,
// Supabase stubbed): the caret lands on what you double-clicked, a centred
// note's text stays put, and a link preview stays under the text.
//
//   cd boards && PW_PORT=5291 npx playwright test tests/note-editing-real.spec.js --project=desktop-chrome --workers=2
import { test, expect } from '@playwright/test';
import { bootSignedIn } from './helpers/signedInStub.js';

const rpc = { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] };
const EDIT = '.card .note-body[contenteditable="true"]';
const READ = '.card .note > .note-body';

async function openBoard(page) {
  // A power reveal can hold the screen; mark this tab's as spent.
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch {} });
  await bootSignedIn(page, { rpc });
  await page.waitForSelector('.canvas-wrap', { timeout: 30_000 });
  await page.waitForTimeout(3500); // a board's first 3s are the doc arriving
}

async function closeNote(page) {
  await page.locator('.canvas-wrap').click({ position: { x: 40, y: 600 } });
  await expect(page.locator(EDIT)).toHaveCount(0);
}

async function centreInBox(page) {
  const btn = page.getByRole('button', { name: 'Center in the box', exact: true });
  if (await btn.isVisible().catch(() => false)) { await btn.click(); return; }
  await page.getByRole('button', { name: 'More formatting', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Center in the box' })
    .or(page.getByRole('menuitem', { name: 'Center in the box' })).first().click();
}

// A note placed with the note tool at canvas point (x, y), `text` typed in,
// optionally centred in its box, then closed.
async function placeNote(page, text, { x = 420, y = 160, centred = false } = {}) {
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x, y } });
  await page.locator(EDIT).waitFor();
  await expect(page.locator(EDIT)).toBeFocused();
  await page.keyboard.type(text);
  if (centred) await centreInBox(page);
  await closeNote(page);
  await expect(page.locator('.card')).toHaveCount(1);
}

// Client centre of `word` inside the element matched by `sel`.
function wordCentre(page, sel, word) {
  return page.evaluate(({ sel, word }) => {
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
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    return null;
  }, { sel, word });
}

// Client point at fraction `frac` of `word`'s width, on its middle line.
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

function firstLineTop(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    const first = el?.firstElementChild || el;
    return first ? first.getBoundingClientRect().top : null;
  }, sel);
}

const selectedText = (page) => page.evaluate(() => String(window.getSelection()));

test.describe('opening a note', () => {
  test('a double-click in a word puts the caret at its nearer edge, not the end', async ({ page }) => {
    await openBoard(page);
    const canvas = await page.locator('.canvas-wrap').boundingBox();
    // Near the middle, so a zoom step keeps it on screen.
    await placeNote(page, 'alpha bravo charlie delta echo', {
      x: Math.round(canvas.width / 2), y: Math.round(canvas.height / 2) - 80,
    });
    const readTop = await firstLineTop(page, READ);
    const at = await wordAtFraction(page, READ, 'charlie', 0.25);
    expect(at).not.toBeNull();
    await page.mouse.dblclick(at.x, at.y);
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    // A caret, not a selection: the first half of a word snaps to its start.
    await expect.poll(() => selectedText(page)).toBe('');
    // An uncentred note's text doesn't move on open either.
    expect(Math.abs((await firstLineTop(page, EDIT)) - readTop)).toBeLessThanOrEqual(1.5);
    await page.keyboard.type('X');
    await expect(page.locator(EDIT)).toHaveText('alpha bravo Xcharlie delta echo');
    await closeNote(page);

    // The canvas is zoomed by a CSS transform; the point still maps to the word.
    await page.getByRole('button', { name: 'Zoom in', exact: true }).first().click();
    await page.waitForTimeout(500);
    const at2 = await wordAtFraction(page, READ, 'delta', 0.75);
    expect(at2).not.toBeNull();
    await page.mouse.dblclick(at2.x, at2.y);
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    await expect.poll(() => selectedText(page)).toBe('');
    await page.keyboard.type('X');
    await expect(page.locator(EDIT)).toHaveText('alpha bravo Xcharlie deltaX echo');
  });

  test('a centred note keeps its first line where it was', async ({ page }) => {
    await openBoard(page);
    await placeNote(page, 'Centred line', { centred: true });
    await expect(page.locator('.card .note.is-balanced')).toHaveCount(1);
    const box = await page.locator('.card .note').boundingBox();
    const readTop = await firstLineTop(page, READ);
    // It really is centred: there is slack above the text.
    expect(readTop - box.y).toBeGreaterThan(30);

    const at = await wordCentre(page, READ, 'line');
    await page.mouse.dblclick(at.x, at.y);
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    expect(Math.abs((await firstLineTop(page, EDIT)) - readTop)).toBeLessThanOrEqual(1);
    await page.waitForTimeout(400); // past the first write-through
    expect(Math.abs((await firstLineTop(page, EDIT)) - readTop)).toBeLessThanOrEqual(1);

    // A press in the empty band above the text keeps the note open, caret in it.
    await page.mouse.click(at.x, box.y + 22);
    await expect(page.locator(EDIT)).toBeFocused();
    await expect(page.locator(EDIT)).toHaveCount(1);
  });

  test('a link preview stays under the text while the note is edited', async ({ page }) => {
    await openBoard(page);
    await placeNote(page, 'See https://example.com');
    const preview = page.locator('.card .note-link-preview').first();
    await expect(preview).toBeVisible();
    const card = page.locator('.card').first();
    const before = await card.boundingBox();
    const pBefore = await preview.boundingBox();

    const at = await wordCentre(page, READ, 'See');
    await page.mouse.dblclick(at.x, at.y);
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    await page.waitForTimeout(400); // past the first write-through
    await expect(page.locator('.card .note-edit-previews .note-link-preview')).toBeVisible();
    const after = await card.boundingBox();
    const pAfter = await preview.boundingBox();
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(pAfter.y - pBefore.y)).toBeLessThanOrEqual(1);

    // Its remove button works while editing, and the note stays open.
    await page.locator('.card .note-edit-previews .note-preview-remove').click();
    await expect(page.locator('.card .note-link-preview')).toHaveCount(0);
    await expect(page.locator(EDIT)).toBeFocused();
    await closeNote(page);
    await expect(page.locator('.card .note-link-preview')).toHaveCount(0);
  });
});

// Plan step 1: opening a note changes nothing; height follows the text both
// ways; only real changes save; a trailing Shift-Enter survives closing.
test.describe('note height and saves', () => {
  test.describe.configure({ timeout: 60_000 });
  const EDIT = '.note-body[contenteditable="true"]';
  const AWAY = { x: 950, y: 600 }; // empty canvas, clear of every note placed here
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const toEnd = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';

  async function boardReady(page) {
    await bootSignedIn(page);
    await page.waitForSelector('.canvas-wrap', { timeout: 30_000 });
    await page.waitForTimeout(3500); // a board's first 3s are the doc arriving
  }
  async function placeNote(page, at) {
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await page.locator('.canvas-wrap').click({ position: at });
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
  }
  async function closeNote(page) {
    await page.locator('.canvas-wrap').click({ position: AWAY });
    await expect(page.locator(EDIT)).toHaveCount(0);
  }
  async function reopen(page, note) {
    await note.dblclick({ position: { x: 30, y: 20 } });
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    await page.keyboard.press(toEnd); // wherever the click put the caret
  }
  async function typeLines(page, prefix, n) {
    for (let i = 1; i <= n; i++) {
      if (i > 1) await page.keyboard.press('Enter');
      await page.keyboard.type(`${prefix} ${i}`);
    }
  }
  const height = (note) => note.evaluate((n) => n.offsetHeight);

  test('a note shown in full keeps its height when opened, and grows on from there', async ({ page }) => {
    await boardReady(page);
    await placeNote(page, { x: 700, y: 60 });
    await typeLines(page, 'row', 26);
    await closeNote(page);
    const note = page.locator('.note').first();
    await expect.poll(() => height(note)).toBe(480); // auto-height stops at 480
    await page.locator('.note-more-chip').click();   // Show all fits the text
    await expect.poll(() => height(note)).toBeGreaterThan(560);
    const shown = await height(note);

    await reopen(page, note);
    await page.waitForTimeout(700); // past any open-time write or debounce
    expect(await height(note)).toBe(shown);

    // Typing grows it past 480 (the ceiling is Show all's 1600 now).
    for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
    await page.keyboard.type('more');
    await expect.poll(() => height(note)).toBeGreaterThan(shown);
    await closeNote(page);
  });

  test('deleting lines shrinks the note, never below its minimum', async ({ page }) => {
    await boardReady(page);
    await placeNote(page, { x: 300, y: 120 });
    const note = page.locator('.note').first();
    const placed = await height(note); // a new note keeps its placed size as a floor
    await typeLines(page, 'line', 12);
    await expect.poll(() => height(note)).toBeGreaterThan(placed);
    const tall = await height(note);

    for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Backspace');
    await expect.poll(() => height(note)).toBeLessThan(tall);
    expect(await height(note)).toBeGreaterThanOrEqual(placed);
    await closeNote(page);

    // Reopened, a note with text fits its text: two more lines out and it
    // drops below the size it was placed at.
    await reopen(page, note);
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Backspace');
    await expect.poll(() => height(note)).toBeLessThan(placed);

    // All of it out: one empty line, never under the card minimum (40).
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.press('Backspace');
    await expect.poll(() => height(note)).toBeLessThan(80);
    expect(await height(note)).toBeGreaterThanOrEqual(40);
    await closeNote(page);
    await expect(page.locator('.note-more-chip')).toHaveCount(0);
  });

  test('opening and closing a note without typing writes nothing', async ({ page }) => {
    await boardReady(page);
    await placeNote(page, { x: 300, y: 120 });
    await page.keyboard.type('hello there');
    await closeNote(page);
    await page.waitForTimeout(1000); // the first session's writes settle
    const note = page.locator('.note').first();
    const updates = () => page.evaluate(() => window.perf.snapshot().counters['yboard.update'] || 0);
    await page.evaluate(() => { window.perf.enable(); window.perf.reset(); });

    await note.dblclick();
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    await page.waitForTimeout(800); // longer than the co-editor debounce (400ms)
    await page.keyboard.press('Escape');
    await expect(page.locator(EDIT)).toHaveCount(0);
    await page.waitForTimeout(800);
    expect(await updates()).toBe(0);

    // The counter does see a real edit, so the zero above means something.
    await note.dblclick();
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    await page.keyboard.type('!');
    await page.keyboard.press('Escape');
    await expect(page.locator(EDIT)).toHaveCount(0);
    await expect.poll(updates).toBeGreaterThan(0);
  });

  test('a Shift-Enter line at the end stays after closing', async ({ page }) => {
    await boardReady(page);
    await placeNote(page, { x: 300, y: 120 });
    await page.keyboard.type('first');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second');
    await page.keyboard.press('Shift+Enter');
    const lines = () => page.locator('.note .note-body p').evaluateAll((ps) => ps.map((p) => p.offsetHeight));
    const editing = await lines();
    expect(editing).toHaveLength(2);
    expect(editing[1]).toBeGreaterThan(editing[0] * 1.8); // the editor shows the empty line

    await closeNote(page);
    await expect.poll(async () => (await lines()).length).toBe(2);
    const reading = await lines();
    expect(Math.abs(reading[1] - editing[1])).toBeLessThanOrEqual(1);
    // The saved html carries the break and a filler (a block's last <br>
    // draws no line in html)…
    expect(await page.locator('.note .note-body p').nth(1).innerHTML()).toBe('second<br><br>');

    // …so reopening shows one empty line, not two.
    await page.locator('.note').first().dblclick();
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    const reopened = await lines();
    expect(reopened).toHaveLength(2);
    expect(Math.abs(reopened[1] - editing[1])).toBeLessThanOrEqual(1);
    await closeNote(page);
  });
});

// Plan step 2: formatting rules. Tab, checklist Enter, plain-text paste, links.
test.describe('formatting', () => {
  test.describe.configure({ timeout: 60_000 });
  // End only scrolls on a Mac, so the note's end is a platform key. Within a
  // line, plain arrow presses are the same everywhere.
  const toEnd = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
  const press = async (page, key, n) => { for (let i = 0; i < n; i++) await page.keyboard.press(key); };

  // A new note, open for typing.
  async function fmtNewNote(page) {
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await page.locator('.canvas-wrap').click({ position: { x: 160, y: 220 } });
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    // ProseMirror ignores a caret move to the start of the note within 200ms
    // of the editor taking focus when no click or touch came in the last
    // 300ms (prosemirror-view's focus guard restores the old selection). A
    // person is never that fast; a script is, so wait it out.
    await page.waitForTimeout(250);
  }
  async function fmtPaste(page, { html = null, text = '' }) {
    await page.evaluate(([h, t, sel]) => {
      const dt = new DataTransfer();
      if (h) dt.setData('text/html', h);
      dt.setData('text/plain', t);
      document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, [html, text, EDIT]);
  }

  test('Tab nests a bullet item and Shift-Tab un-nests it', async ({ page }) => {
    await openBoard(page);
    await fmtNewNote(page);
    await fmtPaste(page, { html: '<ul><li><p>one</p></li><li><p>two</p></li></ul>', text: 'one\ntwo' });
    await expect(page.locator(`${EDIT} ul > li`)).toHaveCount(2);
    // The caret is at the end of "two" after the paste.
    await page.keyboard.press('Tab');
    await expect(page.locator(`${EDIT} ul ul > li`)).toHaveText('two');
    await expect(page.locator(EDIT)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator(`${EDIT} ul ul`)).toHaveCount(0);
    await expect(page.locator(`${EDIT} ul > li`)).toHaveCount(2);
    await expect(page.locator(EDIT)).toBeFocused();
  });

  test('Tab over a selection keeps the text', async ({ page }) => {
    await openBoard(page);
    await fmtNewNote(page);
    await page.keyboard.type('keep this');
    const text = () => page.locator(EDIT).evaluate((el) => el.textContent.replace(/\u00a0/g, ' '));
    await press(page, 'Shift+ArrowLeft', 9); // select "keep this"
    await expect.poll(() => selectedText(page)).toBe('keep this');
    await page.waitForTimeout(150); // the editor reads the selection on selectionchange
    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);
    expect(await text()).toBe('keep this');
    await expect(page.locator(EDIT)).toBeFocused();
    await page.keyboard.press('ArrowRight'); // collapses to the end
    await expect.poll(() => selectedText(page)).toBe('');
    await page.waitForTimeout(150);
    await page.keyboard.press('Tab'); // empty selection: two spaces, as before
    await expect.poll(text).toBe('keep this  ');
  });

  test('Enter after a ticked checklist item gives an unticked one', async ({ page }) => {
    await openBoard(page);
    await fmtNewNote(page);
    await fmtPaste(page, {
      html: '<ul class="note-checklist"><li class="ck"><span class="ck-box is-checked" role="checkbox" aria-checked="true"></span><div class="ck-text"><p>done</p></div></li></ul>',
      text: 'done',
    });
    await expect(page.locator(`${EDIT} .ck`)).toHaveCount(1);
    await page.keyboard.press('Enter');
    await page.keyboard.type('next');
    const boxes = page.locator(`${EDIT} .ck .ck-box`);
    await expect(boxes).toHaveCount(2);
    await expect(boxes.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(boxes.nth(1)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator(`${EDIT} .ck`).nth(1)).toHaveText('next');
  });

  test('Enter at the start of a ticked item opens an unticked one above, and the line keeps its tick', async ({ page }) => {
    await openBoard(page);
    await fmtNewNote(page);
    // Built with the bar. An earlier version pasted it and lost the arrow
    // keys; the cause was ProseMirror's focus guard (see fmtNewNote).
    await page.getByRole('button', { name: 'Checklist' }).first().click();
    await page.locator(`${EDIT} .ck-box`).click(); // tick it
    await expect(page.locator(`${EDIT} .ck-box`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(EDIT)).toBeFocused();
    await page.keyboard.type('done');
    await press(page, 'ArrowLeft', 4); // before "done"
    // The editor reads a moved caret on selectionchange, a beat after the keys.
    await expect.poll(() => page.evaluate((sel) =>
      document.querySelector(sel).editor.state.selection.$from.parentOffset, EDIT)).toBe(0);
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    const items = page.locator(`${EDIT} .ck`);
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).locator('.ck-box')).toHaveAttribute('aria-checked', 'false');
    await expect(items.nth(0)).toHaveText('');
    await expect(items.nth(1).locator('.ck-box')).toHaveAttribute('aria-checked', 'true');
    await expect(items.nth(1)).toHaveText('done');
  });

  test('typing "> a" and backticks stays literal text', async ({ page }) => {
    await openBoard(page);
    await fmtNewNote(page);
    await page.keyboard.type('> a');
    await page.keyboard.press('Enter');
    await page.keyboard.type('say `hi` now');
    await expect(page.locator(`${EDIT} blockquote`)).toHaveCount(0);
    await expect(page.locator(`${EDIT} code`)).toHaveCount(0);
    await expect(page.locator(`${EDIT} p`).nth(0)).toHaveText('> a');
    await expect(page.locator(`${EDIT} p`).nth(1)).toHaveText('say `hi` now');
  });

  test('pasting "a\\n\\nb" keeps the empty line', async ({ page }) => {
    await openBoard(page);
    await fmtNewNote(page);
    await fmtPaste(page, { text: 'a\n\nb' });
    const ps = page.locator(`${EDIT} > p`);
    await expect(ps).toHaveCount(3);
    await expect(ps.nth(0)).toHaveText('a');
    await expect(ps.nth(1)).toHaveText('');
    await expect(ps.nth(2)).toHaveText('b');
  });

  test('a link keeps its address after closing, reopening, typing and a tick', async ({ page }) => {
    await openBoard(page);
    await fmtNewNote(page);
    // The real canvas has no hook to seed card.html, so the link arrives by
    // paste; the seeded-html path is note-links.spec.js ("a legacy named link
    // seeds as a link mark").
    await fmtPaste(page, {
      html: '<ul class="note-checklist"><li class="ck"><span class="ck-box" role="checkbox" aria-checked="false"></span><div class="ck-text"><p>see <a href="https://example.com">x</a></p></div></li></ul>',
      text: 'see x',
    });
    await closeNote(page);
    const link = page.locator('.note a[href="https://example.com"]');
    await expect(link).toHaveText('x');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await page.locator('.note').first().dblclick();
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    await page.keyboard.press(toEnd);
    await page.keyboard.type('!');
    await closeNote(page);
    await expect(link).toHaveText('x');
    await page.locator('.note .ck-box').first().click(); // tick in read mode
    await expect(page.locator('.note .ck-box').first()).toHaveAttribute('aria-checked', 'true');
    await expect(link).toHaveText('x');
  });
});

// Plan step 2b: Cmd-Z after a whole-note style.
test.describe('undo after a note style', () => {
  test.describe.configure({ timeout: 60_000 });
  // Wide enough that the note bar shows its background and Center in the box
  // on the row, not folded into the more menu (NoteBarA useIslandFit).
  test.use({ viewport: { width: 1440, height: 900 } });

  async function newNote(page) {
    await openBoard(page);
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await page.locator('.canvas-wrap').click({ position: { x: 240, y: 240 } });
    const body = page.locator(EDIT);
    await body.waitFor();
    await expect(body).toBeFocused();
    await page.keyboard.type('hello');
    await page.waitForTimeout(700); // past both undo capture windows (500ms)
    return { body, note: page.locator('.note.is-editing') };
  }

  test('Cmd-Z takes back the colour first, then the text', async ({ page }) => {
    const { body, note } = await newNote(page);
    const bg0 = await note.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.getByRole('button', { name: 'Card background' }).click();
    await page.getByRole('menuitemradio', { name: 'Color #dbeafe' }).click();
    await expect(note).toHaveCSS('background-color', 'rgb(219, 234, 254)');
    await expect(body).toBeFocused();

    await page.keyboard.press('ControlOrMeta+z');
    await expect(note).toHaveCSS('background-color', bg0);
    await expect(body).toHaveText('hello');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(body).not.toContainText('hello');
    await expect(note).toHaveCSS('background-color', bg0);
  });

  test('Center in the box undoes in one step, and redoes in one', async ({ page }) => {
    const { body, note } = await newNote(page);
    await page.getByRole('button', { name: 'Center in the box' }).click();
    await expect(note).toHaveClass(/is-balanced/);
    await expect(body.locator('p').first()).toHaveCSS('text-align', 'center');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(note).not.toHaveClass(/is-balanced/);
    await expect(body.locator('p').first()).not.toHaveCSS('text-align', 'center');
    await expect(body).toHaveText('hello');

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(note).toHaveClass(/is-balanced/);
    await expect(body.locator('p').first()).toHaveCSS('text-align', 'center');
    await expect(body).toHaveText('hello');
  });
});

// Width resize and Fit to content size a note to what it shows. The measurer
// (lib/noteMeasure.js) used to lay the html out in a classless div, without
// the .note-body rules, so blank lines, list indents and heading sizes went
// unmeasured and the note came out short, under a "Show all" chip.
test.describe('note size', () => {
  const H3 = 'Shot list for the harbour day';
  const ITEM1 = 'Wide establishing shot of the harbour lights at dusk';
  const ITEM2 = 'Close on the hands as the rope comes off the cleat';
  const TAIL = 'Notes after two blank lines that run on long enough to wrap at a narrow width, twice over.';

  // A note with a heading, a bulleted list, two blank lines and a long
  // paragraph, then closed. The heading comes from "### "; the list from the
  // bar, since a typed "- " stays text in a note (note-lists.spec.js).
  async function placeShapedNote(page) {
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await page.locator('.canvas-wrap').click({ position: { x: 420, y: 160 } });
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    await page.keyboard.type(`### ${H3}`);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Bulleted list' }).first().click();
    await expect(page.locator(EDIT)).toBeFocused();
    await page.keyboard.type(ITEM1);
    await page.keyboard.press('Enter');
    await page.keyboard.type(ITEM2);
    await page.keyboard.press('Enter'); // empty item
    await page.keyboard.press('Enter'); // leaves the list: an empty paragraph
    await page.keyboard.press('Enter'); // blank line 1 stays behind
    await page.keyboard.press('Enter'); // blank line 2
    await page.keyboard.type(TAIL);
    await expect(page.locator(`${EDIT} h3`)).toHaveCount(1);
    await expect(page.locator(`${EDIT} ul > li`)).toHaveCount(2);
    await closeNote(page);
    await expect(page.locator('.card')).toHaveCount(1);
    const body = page.locator(READ).first();
    await expect(body.locator('h3')).toHaveCount(1);
    await expect(body.locator('ul > li')).toHaveCount(2);
    await expect.poll(() => body.evaluate((el) => el.querySelectorAll(':scope > p:empty').length)).toBe(2);
    return page.locator('.card').first();
  }

  const overflow = (page) => page.locator(READ).first().evaluate((el) => el.scrollHeight - el.clientHeight);

  async function dragResize(page, card, dx, dy) {
    await card.click({ position: { x: 8, y: 8 } }); // select; a single click doesn't open a note
    const handle = card.locator('.card-resize');
    await expect(handle).toBeVisible();
    const hb = await handle.boundingBox();
    const sx = hb.x + hb.width / 2;
    const sy = hb.y + hb.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + dx / 2, sy + dy / 2, { steps: 5 });
    await page.mouse.move(sx + dx, sy + dy, { steps: 5 });
    await page.mouse.up();
  }

  test('a narrower width resize leaves no text hidden', async ({ page }) => {
    await openBoard(page);
    const card = await placeShapedNote(page);
    await expect.poll(() => overflow(page)).toBeLessThanOrEqual(1);
    const before = await card.boundingBox();

    // Mostly horizontal, so the height follows the text (no height mode).
    await dragResize(page, card, -Math.round(before.width * 0.4), 0);

    await expect.poll(async () => (await card.boundingBox()).width).toBeLessThan(before.width - 30);
    const after = await card.boundingBox();
    expect(after.height).toBeGreaterThan(before.height); // re-wrapped taller
    await expect.poll(() => overflow(page)).toBeLessThanOrEqual(1);
    await expect(page.locator('.card .note-more-chip')).toHaveCount(0);
  });

  test('Fit to content leaves no text hidden', async ({ page }) => {
    await openBoard(page);
    const card = await placeShapedNote(page);
    const before = await card.boundingBox();

    // Pin it narrower and much shorter than its text (a deliberate vertical
    // pull latches height mode), so Fit has real work to do.
    await dragResize(page, card, -Math.round(before.width * 0.3), -Math.round(before.height * 0.5));
    await expect.poll(() => overflow(page)).toBeGreaterThan(1);

    await card.click({ button: 'right', position: { x: 8, y: 8 } });
    await page.locator('.ctx-menu').getByText('Fit to content', { exact: true }).click();

    await expect.poll(() => overflow(page)).toBeLessThanOrEqual(1);
    await expect(page.locator('.card .note-more-chip')).toHaveCount(0);
  });
});

test.describe('typing attributes', () => {
  test('a computer keeps native spellcheck off and Grammarly out', async ({ page }) => {
    await openBoard(page);
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await page.locator('.canvas-wrap').click({ position: { x: 420, y: 200 } });
    const ed = page.locator(EDIT);
    await ed.waitFor();
    await expect(ed).toHaveAttribute('spellcheck', 'false');
    await expect(ed).toHaveAttribute('data-gramm', 'false');
    expect(await ed.getAttribute('autocorrect')).toBeNull();
    expect(await ed.getAttribute('autocapitalize')).toBeNull();
  });
});

// Plan step 6: a weak connection. The note editor is its own chunk, and a
// browser keeps a failed import for the page's life, so the one way to fetch
// it again is a reload: online the page reloads once, as before; offline it
// never does, and the note stays readable with a toast.
test.describe('weak connection', () => {
  test.describe.configure({ timeout: 60_000 });
  test.skip(({ hasTouch }) => hasTouch, 'touch devices fetch the editor at boot (CanvasSurface), before the route');

  // Dev serves /src/components/NoteTiptapSurface.jsx, a build /assets/NoteTiptapSurface-<hash>.js.
  const EDITOR_CHUNK = /\/NoteTiptapSurface(?:\.jsx|-[\w-]+\.js)(?:\?.*)?$/;
  const TOAST = '.toast';
  const TOAST_TEXT = "Couldn't open the note editor. Check your connection and try again.";

  // Fails the editor chunk's first `failures` fetches (Infinity: every one).
  async function failEditorChunk(page, failures) {
    const seen = { count: 0 };
    await page.route(EDITOR_CHUNK, (route) => {
      seen.count += 1;
      return seen.count <= failures ? route.abort('internetdisconnected') : route.continue();
    });
    return seen;
  }

  // A note placed with the note tool opens straight into editing: the
  // session's first import of the editor.
  async function placeNewNote(page) {
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await page.locator('.canvas-wrap').click({ position: { x: 420, y: 160 } });
    await expect(page.locator('.card .note')).toHaveCount(1);
  }

  // A marker on window: gone if the page reloaded.
  const mark = (page) => page.evaluate(() => { window.__noteStepSix = 'kept'; });
  const marker = (page) => page.evaluate(() => window.__noteStepSix || null);

  test('online, a failed fetch reloads the page once to fetch it again', async ({ page }) => {
    await openBoard(page);
    await mark(page);
    await failEditorChunk(page, 1);
    const reloaded = page.waitForEvent('load', { timeout: 15_000 });
    // Not placeNewNote: the reload can come before its count check.
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await page.locator('.canvas-wrap').click({ position: { x: 420, y: 160 } });
    await reloaded;
    expect(await marker(page)).toBe(null);
  });

  test('offline: the note stays readable, a toast says why, the page stays', async ({ page }) => {
    await openBoard(page);
    await mark(page);
    await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
    const seen = await failEditorChunk(page, Infinity);
    await placeNewNote(page);
    await expect(page.locator(TOAST, { hasText: TOAST_TEXT })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(EDIT)).toHaveCount(0);
    await expect(page.locator('.card .note:not(.is-editing)')).toHaveCount(1);
    expect(seen.count).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(1500);              // past any late reload
    expect(await marker(page)).toBe('kept');

    // Back online: the next open reloads the page once, the one way to fetch
    // the editor again. (The boundary's reset() is what lets this open reach
    // the reload; React.lazy's kept failure would only repeat the toast.)
    await page.unroute(EDITOR_CHUNK);
    await page.evaluate(() => { delete navigator.onLine; });
    const reloaded = page.waitForEvent('load', { timeout: 15_000 });
    await page.locator('.card .note').dblclick();
    await reloaded;
    expect(await marker(page)).toBe(null);
  });

  test('online, just after a chunk reload: no second reload, the toast instead', async ({ page }) => {
    await openBoard(page);
    await mark(page);
    // lazyWithReload's shared guard: a reload for a chunk happened a moment ago.
    await page.evaluate(() => sessionStorage.setItem('soleil:chunk-reload-at', String(Date.now())));
    await failEditorChunk(page, Infinity);
    await placeNewNote(page);
    await expect(page.locator(TOAST, { hasText: TOAST_TEXT })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(EDIT)).toHaveCount(0);
    await expect(page.locator('.card .note')).toHaveCount(1);
    expect(await marker(page)).toBe('kept');
  });
});

// Plan step 6: the editor mounts without writing to the board mid-render.
test.describe('clean mount', () => {
  test('opening a note logs no "Cannot update a component" warning', async ({ page }) => {
    const warnings = [];
    page.on('console', (m) => { if (/Cannot update a component/.test(m.text())) warnings.push(m.text()); });
    await openBoard(page);
    // A new note: its first open seeds the fragment and makes its comment map.
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await page.locator('.canvas-wrap').click({ position: { x: 420, y: 160 } });
    await page.locator(EDIT).waitFor();
    await page.keyboard.type('Clean mount');
    await closeNote(page);
    // And a reopen.
    await page.locator('.card .note').dblclick();
    await page.locator(EDIT).waitFor();
    await closeNote(page);
    expect(warnings).toEqual([]);
  });
});

// Moved from ws5-note-selection.spec.js, which ran them on ?local=1's legacy
// editor. A drag inside an open note selects text, across lines and blank
// lines, and the canvas's selection box never takes it over.
test.describe('drag-select in an open note', () => {
  // A note placed with the tool, `lines` typed (an empty string is a blank
  // line), left open. A new card pops in (200ms of scale and fade); a drag
  // started while it grows presses on a moving note, so wait until it holds
  // still (a trial click presses nothing).
  async function openNoteWith(page, lines) {
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await page.locator('.canvas-wrap').click({ position: { x: 420, y: 160 } });
    await page.locator(EDIT).waitFor();
    await expect(page.locator(EDIT)).toBeFocused();
    for (let i = 0; i < lines.length; i++) {
      if (i) await page.keyboard.press('Enter');
      if (lines[i]) await page.keyboard.type(lines[i]);
    }
    await page.locator(EDIT).click({ trial: true });
  }

  // Client points on the first and the last glyph of the open note's text,
  // so a press always lands on a letter (short words leave corners empty).
  function glyphEnds(page) {
    return page.evaluate((sel) => {
      const body = document.querySelector(sel);
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let first = null;
      let last = null;
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (!n.nodeValue.trim()) continue;
        if (!first) first = n;
        last = n;
      }
      const r1 = document.createRange();
      r1.setStart(first, 0);
      r1.setEnd(first, 1);
      const r2 = document.createRange();
      r2.setStart(last, last.length - 1);
      r2.setEnd(last, last.length);
      const a = r1.getBoundingClientRect();
      const b = r2.getBoundingClientRect();
      return {
        first: { x: a.left + 1, y: a.top + a.height / 2 },
        last: { x: b.right - 1, y: b.top + b.height / 2 },
      };
    }, EDIT);
  }

  test('a drag selects across lines', async ({ page }) => {
    await openBoard(page);
    await openNoteWith(page, ['alpha', 'bravo', 'charlie']);
    const p = await glyphEnds(page);
    await page.mouse.move(p.first.x, p.first.y);
    await page.mouse.down();
    await page.mouse.move((p.first.x + p.last.x) / 2, (p.first.y + p.last.y) / 2, { steps: 4 });
    await page.mouse.move(p.last.x, p.last.y, { steps: 6 });
    await page.mouse.up();
    // The leading "a" can be clipped by where the press lands; the point is
    // that the first line is in and the selection crosses both breaks.
    await expect.poll(() => selectedText(page)).toMatch(/lpha[\s\S]*bravo[\s\S]*charli/);
  });

  test('a drag selects across a blank line', async ({ page }) => {
    await openBoard(page);
    await openNoteWith(page, ['alpha', '', 'bravo']);
    const p = await glyphEnds(page);
    await page.mouse.move(p.first.x, p.first.y);
    await page.mouse.down();
    await page.mouse.move(p.last.x, p.last.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => selectedText(page)).toMatch(/lpha[\s\S]*brav/);
  });

  test('a slow drag upward is not taken over by the canvas selection box', async ({ page }) => {
    await openBoard(page);
    await openNoteWith(page, ['alpha', 'bravo', 'charlie']);
    const p = await glyphEnds(page);
    // Press at the end of "charlie" and crawl up to "alpha" with real pauses,
    // so a selection box, if one armed, has frames to draw.
    await page.mouse.move(p.last.x, p.last.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(
        p.last.x + (p.first.x - p.last.x) * (i / 8),
        p.last.y + (p.first.y - p.last.y) * (i / 8));
      await page.waitForTimeout(30);
    }
    const marqueeDuringDrag = await page.locator('.marquee').count();
    await page.mouse.up();
    expect(marqueeDuringDrag).toBe(0);
    await expect.poll(() => selectedText(page)).toMatch(/lpha[\s\S]*bravo[\s\S]*charli/);
    // A click on bare canvas still finishes the note, with the text kept.
    await closeNote(page);
    await expect(page.locator(READ).last()).toContainText('charlie');
  });
});
