import { expect, test } from '@playwright/test';

// Comments on a note's words, in the shared comment card that floats beside
// the note (comments/DocFloatCards.jsx, NoteCommentsLayer.jsx). Drives the
// real NoteCardCollab through the ?noteqa harness, as Alice (user-A).
//
// NOTES-03 is still guarded here: the box takes focus on mount, the note
// editor used to read that blur as "left the note", leave edit mode and take
// the box with it.

const A = '[data-client="A"] .note';
const A_EDIT = '[data-client="A"] .note-body[contenteditable="true"]';
const card = (page) => page.locator('.cmt-float-host .cmt-card');
const box = (page) => card(page).locator('textarea.cmt-input');
const mark = (page) => page.locator('[data-client="A"] .tt-comment');

// ProseMirror picks a keyboard selection up from selectionchange, a tick after
// the keypress; the shortcut no-ops on an empty selection.
const selectionReady = (page) => expect.poll(() => page.evaluate(
  () => window.__soleilNoteTest.getActiveEditor()?.state.selection.empty === false,
)).toBe(true);

async function open(page, query = '') {
  page.on('pageerror', (e) => { throw e; });
  await page.goto(`/?noteqa=1${query}`);
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
}

async function startComment(page, words) {
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  await page.keyboard.type(words);
  await expect(async () => {
    await page.keyboard.press('Shift+Home'); // select what was typed
    await selectionReady(page);
  }).toPass({ timeout: 15000 });
  await page.keyboard.press('ControlOrMeta+Alt+m');
  await expect(card(page)).toBeVisible();
}

// A thread on the note's words, written as the editor writes one (the note is
// left being read, not edited). Returns its id.
async function seedThread(page, { resolved = false } = {}) {
  await startComment(page, 'Rewrite the ending');
  await box(page).fill('Too abrupt?');
  await box(page).press('Enter');
  await expect(card(page).locator('.cmt-row')).toHaveCount(1);
  const id = await mark(page).first().getAttribute('data-comment-id');
  if (resolved) {
    await card(page).getByRole('button', { name: 'Resolve' }).click();
    await expect(card(page).locator('.cmt-resolved')).toBeVisible();
  }
  await card(page).getByRole('button', { name: 'Close' }).click();
  await expect(card(page)).toHaveCount(0);
  await page.mouse.click(5, 5);
  await expect(page.locator(A_EDIT)).toHaveCount(0);
  return id;
}

test('a note comment can be written and posted, and the card stays on the thread it became', async ({ page }) => {
  await open(page);
  await startComment(page, 'Rewrite the ending');
  // Still there a beat later: it used to flash and vanish.
  await page.waitForTimeout(300);
  await expect(card(page)).toBeVisible();
  await expect(page.locator(A_EDIT)).toBeVisible();
  await expect(box(page)).toBeFocused();
  // The words being commented on are held in a neutral tint meanwhile.
  await expect(page.locator('[data-client="A"] .cmt-pending').first()).toBeVisible();

  await page.keyboard.type('Too abrupt?');
  await page.keyboard.press('Enter');
  await expect(card(page).locator('.cmt-row .cmt-text')).toHaveText('Too abrupt?');
  await expect(page.locator('[data-client="A"] .cmt-pending')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getFragHtmlA()))
    .toMatch(/data-comment-id="[^"]+"/);
  // The note is still being edited; a click elsewhere ends that and the card.
  await expect(page.locator(A_EDIT)).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.locator(A_EDIT)).toHaveCount(0);
});

test('Escape out of a new comment keeps the note in edit mode', async ({ page }) => {
  await open(page);
  await startComment(page, 'Keep going');
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(A_EDIT)).toBeFocused();
});

test('pressing commented words in a note being read opens their thread; Backspace in the box leaves the note alone', async ({ page }) => {
  await open(page);
  await seedThread(page);
  await mark(page).first().click();
  await expect(card(page).locator('.cmt-row .cmt-text')).toHaveText('Too abrupt?');
  // Not in edit mode: the press opened the thread, not the editor.
  await expect(page.locator(A_EDIT)).toHaveCount(0);
  await box(page).fill('ab');
  await box(page).press('Backspace');
  await box(page).press('Delete');
  await expect(box(page)).toHaveValue('a');
  await expect(page.locator(A)).toContainText('Rewrite the ending');
  await box(page).fill('Fixed in v2');
  await box(page).press('Enter');
  await expect(card(page).locator('.cmt-row')).toHaveCount(2);
});

test('resolving says so with an Undo, and resolved words open nothing', async ({ page }) => {
  await open(page);
  await seedThread(page, { resolved: true });
  const toast = page.locator('.toast', { hasText: 'Comment resolved' });
  await expect(toast).toBeVisible();
  await mark(page).first().click();
  await expect(card(page)).toHaveCount(0);
  await toast.getByRole('button', { name: 'Undo' }).click();
  await page.mouse.click(5, 5);
  await expect(page.locator(A_EDIT)).toHaveCount(0);
  await mark(page).first().click();
  await expect(card(page)).toBeVisible();
});

// A note with three commented phrases (the last one's thread resolved) and a
// thread whose words are gone, written straight into the note as a
// collaborator's would arrive. The note is left being read.
async function seed(page) {
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.evaluate(() => {
    const t = window.__soleilNoteTest;
    const html = '<p>The <span class="tt-comment" data-comment-id="cm_a">blue hour alley</span> opens the film. Then the <span class="tt-comment" data-comment-id="cm_b">bar scene</span> at night, and the <span class="tt-comment" data-comment-id="cm_c">closing shot</span> on the roof.</p>';
    t.getActiveEditor().commands.setContent(html, true);
    const m = t.ensureNoteComments(t.docA, t.cardA);
    const now = Date.now();
    t.docA.transact(() => {
      m.set('cm_a', { id: 'cm_a', authorId: 'user-B', author: 'Bob Hale', authorColor: '#3b82f6', body: 'Can we get this at real blue hour?', ts: now - 3600e3 });
      m.set('cm_a~r~cr_1', { kind: 'reply', threadId: 'cm_a', id: 'cr_1', authorId: 'user-A', author: 'Alice', authorColor: '#6aa86a', body: 'Yes, booked for Thursday.', ts: now - 1800e3 });
      m.set('cm_b', { id: 'cm_b', authorId: 'user-B', author: 'Bob Hale', authorColor: '#3b82f6', body: 'Love this palette for the bar scene', ts: now - 7200e3 });
      m.set('cm_c', { id: 'cm_c', authorId: 'user-A', author: 'Alice', authorColor: '#6aa86a', body: 'Hold on the skyline two beats longer', ts: now - 9000e3 });
      m.set('cm_c~s', { kind: 'state', threadId: 'cm_c', resolved: true, headerSeen: false, by: 'user-B', byName: 'Bob Hale', ts: now - 600e3 });
      m.set('cm_gone', { id: 'cm_gone', authorId: 'user-B', author: 'Bob Hale', authorColor: '#3b82f6', body: 'This line was cut, see the new draft', ts: now - 86400e3 });
    });
  });
  await page.keyboard.press('Escape');
  await expect(page.locator(A_EDIT)).toHaveCount(0);
}
const words = (page, id) => page.locator(`[data-client="A"] .tt-comment[data-comment-id="${id}"]`);
const looks = (page, id) => words(page, id).evaluate((el) => {
  const cs = getComputedStyle(el);
  return { tinted: cs.backgroundColor !== 'rgba(0, 0, 0, 0)', hand: cs.cursor === 'pointer', background: cs.backgroundColor };
});

test('open threads\' words are tinted and the open one is gold; a resolved thread\'s are plain', async ({ page }) => {
  await open(page);
  await seed(page);
  const rest = await looks(page, 'cm_a');
  expect(rest).toMatchObject({ tinted: true, hand: true });
  expect(await looks(page, 'cm_c')).toMatchObject({ tinted: false, hand: false });
  await words(page, 'cm_c').click();
  await expect(card(page)).toHaveCount(0);
  await words(page, 'cm_a').click();
  await expect(card(page).locator('.cmt-row')).toHaveCount(2);
  await expect.poll(() => looks(page, 'cm_a').then((l) => l.background)).not.toBe(rest.background);
  expect((await looks(page, 'cm_b')).background).toBe(rest.background);
});

test('someone who can only read the note reads the thread and is told why there is no box', async ({ page }) => {
  await open(page, '&reader=1');
  await seed(page);
  await words(page, 'cm_a').click();
  await expect(card(page).locator('.cmt-row')).toHaveCount(2);
  await expect(card(page).locator('.cmt-readonly')).toHaveText('Only people who can edit this note can reply.');
  await expect(card(page).locator('textarea')).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: /^(Resolve|Edit)$/ })).toHaveCount(0);
});

test('the note\'s list has Open and Resolved, and says when a thread\'s words were removed', async ({ page }) => {
  await open(page);
  await seed(page);
  await words(page, 'cm_a').click();
  await card(page).locator('button[aria-label^="All comments"]').click();
  const rows = page.locator('.cmt-float-host .cmt-list-row');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('.cmt-list-row[data-thread="cm_gone"]')).toContainText('Its words were removed');
  await page.getByRole('tab', { name: /^Resolved/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Hold on the skyline');
  await page.getByRole('tab', { name: /^Open/ }).click();
  await page.locator('.cmt-list-row[data-thread="cm_gone"]').click();
  await expect(card(page).locator('.cmt-title')).toHaveText('Its words were removed');
  await expect(card(page).locator('.cmt-row .cmt-text')).toHaveText('This line was cut, see the new draft');
});
