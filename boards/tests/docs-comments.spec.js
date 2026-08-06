import { expect, test } from '@playwright/test';

// Word-level comments, Google-Docs style: select text → comment → the
// highlighted run is CLICKABLE and opens its thread.
//
// The clickable part is the regression this guards. The mark, the thread store
// and the margin dot all shipped earlier, but nothing was ever wired to the
// span itself — only the ~8px gutter dot opened a thread, so the highlight read
// as decoration (and on touch there is no gutter dot to hit at all).
//
// Anchoring note: the CommentMark lives inside the Y.XmlFragment, so the
// commented range survives concurrent edits with no stored offsets to remap.

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

// Type a line, select a word in it, and comment on it through the real flow
// (thread record + mark), returning the thread id.
async function commentOnWord(page, text, word, body) {
  return page.evaluate(({ text, word, body }) => {
    const T = window.__soleilDocTest;
    const editor = T.editor;
    editor.commands.setContent(`<p>${text}</p>`);
    const from = text.indexOf(word) + 1;          // +1: PM doc positions are 1-based
    const to = from + word.length;
    editor.commands.setTextSelection({ from, to });
    const id = T.addCommentThread(T.ydoc, {
      pageId: T.getScope() && T.readPages ? undefined : undefined,
      body,
      author: 'QA',
      authorId: null,
      authorColor: '#4f8df8',
      scope: T.getScope(),
    });
    editor.chain().setTextSelection({ from, to }).setMark('comment', { id }).run();
    return id;
  }, { text, word, body });
}

test('clicking commented text opens its thread', async ({ page }) => {
  await openDoc(page);
  const id = await commentOnWord(page, 'The quick brown fox jumps', 'brown', 'Is this the right animal?');

  const mark = page.locator(`.tt-comment[data-comment-id="${id}"]`);
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveText('brown');

  // No thread popover until the highlight is clicked.
  await expect(page.locator('.comment-inline-pop')).toHaveCount(0);
  await mark.click();

  const pop = page.locator('.comment-inline-pop');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('Is this the right animal?');
});

test('the mark reads as clickable, not decorative', async ({ page }) => {
  await openDoc(page);
  const id = await commentOnWord(page, 'Readable at rest matters', 'Readable', 'note');
  const style = await page.locator(`.tt-comment[data-comment-id="${id}"]`).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { cursor: cs.cursor, background: cs.backgroundColor };
  });
  expect(style.cursor).toBe('pointer');
  // A resting tint (not just a hover state) — touch has no hover, so a
  // hover-only affordance is invisible on a phone.
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.background).not.toBe('transparent');
});

test('deleting a thread strips its highlight', async ({ page }) => {
  await openDoc(page);
  const id = await commentOnWord(page, 'Delete me please now', 'Delete', 'gone soon');
  await expect(page.locator(`.tt-comment[data-comment-id="${id}"]`)).toHaveCount(1);

  // The popover portals to <body>, so it signals the editor by window event
  // rather than calling it directly — same path the delete button uses.
  await page.evaluate((id) => {
    const T = window.__soleilDocTest;
    T.deleteCommentThread(T.ydoc, id, T.getScope());
    window.dispatchEvent(new CustomEvent('soleil-remove-comment-mark', { detail: { id } }));
  }, id);

  await expect(page.locator(`.tt-comment[data-comment-id="${id}"]`)).toHaveCount(0);
  // The text itself must survive — only the mark is removed.
  await expect(page.locator('.ProseMirror').first()).toContainText('Delete me please now');
});

test('a commented range survives edits elsewhere in the paragraph', async ({ page }) => {
  await openDoc(page);
  const id = await commentOnWord(page, 'alpha bravo charlie', 'bravo', 'middle word');

  // Insert text BEFORE the mark. Stored integer offsets would drift here; the
  // mark rides the fragment, so it doesn't.
  await page.evaluate(() => {
    const editor = window.__soleilDocTest.editor;
    editor.commands.setTextSelection({ from: 1, to: 1 });
    editor.commands.insertContent('zzz ');
  });

  const mark = page.locator(`.tt-comment[data-comment-id="${id}"]`);
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveText('bravo');
});

test('notes carry the comment mark through the html round-trip', async ({ page }) => {
  // Notes cache their fragment as card.html on every keystroke, serialized
  // against the note schema. If CommentMark were missing from that schema the
  // span would be silently dropped and every note comment anchor would vanish.
  await page.goto('/?noteqa=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const m = await import('/src/lib/noteDocState.js');
    const html = '<p>keep <span data-comment-id="cm_test1">this</span> anchored</p>';
    const json = m.noteHtmlToJSON(html);
    const out = m.noteJSONToHtml(json);
    return { out, hasId: out.includes('data-comment-id="cm_test1"'), hasClass: out.includes('tt-comment') };
  });
  expect(r.hasId).toBe(true);
  expect(r.hasClass).toBe(true);
});
