import { expect, test } from '@playwright/test';

// NOTES-01: a note whose text lives only in plain `body` (a run of text dropped
// on the canvas, or a note made through /api/v1 or MCP) opened EMPTY in the
// editor, and the first write-through saved that emptiness over the body.
// NOTES-02: ticking a checklist box on a non-editing note saved the rendered
// display back into the note, which stripped @-mentions and comment anchors.
// Drives the real NoteCardCollab through the ?noteqa harness.

const A = '[data-client="A"] .note';
const A_EDIT = '[data-client="A"] .note-body[contenteditable="true"]';

async function ready(page, query = '') {
  page.on('pageerror', (e) => { throw e; });
  await page.goto(`/?noteqa=1${query}`);
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
}

// Put client A's card into a given state, the way a remote writer would.
async function setCard(page, fields) {
  await page.evaluate((f) => {
    const T = window.__soleilNoteTest;
    T.docA.transact(() => {
      for (const [k, v] of Object.entries(f)) T.cardA.set(k, v);
    }, 'remote-test');
  }, fields);
}

const cardField = (page, k) => page.evaluate((key) => window.__soleilNoteTest.cardA.get(key), k);

test('a body-only note opens with its text and keeps it', async ({ page }) => {
  await ready(page);
  await setCard(page, { body: 'Dropped from a web page\nsecond line' });
  await expect(page.locator(A)).toContainText('Dropped from a web page');

  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await expect(page.locator(A_EDIT)).toContainText('Dropped from a web page');
  await expect(page.locator(A_EDIT)).toContainText('second line');
  await page.keyboard.press('Escape');

  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getTextA())).toContain('second line');
  await expect.poll(() => cardField(page, 'html')).toContain('Dropped from a web page');
  expect(await cardField(page, 'body')).toBeNull();
  await expect(page.locator(A)).toContainText('second line');
});

test('a note the old seed already blanked heals from its leftover body', async ({ page }) => {
  await ready(page);
  // The state the html-only seed left behind: marked seeded, fragment empty,
  // cache textless, body still there (here, re-sent by an API PATCH).
  await setCard(page, { noteFragmentSeeded: true, html: '<p></p>', body: 'Patched by the API' });
  await expect(page.locator(A)).toContainText('Patched by the API');

  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await expect(page.locator(A_EDIT)).toContainText('Patched by the API');
  await page.keyboard.press('Escape');
  await expect.poll(() => cardField(page, 'html')).toContain('Patched by the API');
});

test('emptying a body-only note on purpose stays empty', async ({ page }) => {
  await ready(page);
  await setCard(page, { body: 'Delete me' });

  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await expect(page.locator(A_EDIT)).toContainText('Delete me');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');

  await expect.poll(() => cardField(page, 'body')).toBeNull();
  expect(await cardField(page, 'html')).not.toContain('Delete me');

  // Re-open: the deleted text must not come back.
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await expect(page.locator(A_EDIT)).not.toContainText('Delete me');
  await page.keyboard.press('Escape');
});

test('ticking a box on a non-editing note keeps its mention and comment anchor', async ({ page }) => {
  // &trie=1: render the display through renderHtmlWithAutoLinks, as the
  // signed-in app does. That render is what used to get saved back.
  await ready(page, '&trie=1');
  await page.evaluate(() => {
    const T = window.__soleilNoteTest;
    const ref = JSON.stringify({ kind: 'tag', id: 'tag-1' }).replace(/"/g, '&quot;');
    const src = '<p>Ask <span data-entity-ref="' + ref + '" class="tt-link tt-link-manual">Ana</span>'
      + ' about <span data-comment-id="th-1" class="tt-comment">the ending</span></p>'
      + '<ul class="note-checklist">'
      + '<li class="ck"><span class="ck-box" role="checkbox" aria-checked="false"></span><div class="ck-text"><p>one</p></div></li>'
      + '<li class="ck"><span class="ck-box" role="checkbox" aria-checked="false"></span><div class="ck-text"><p>two</p></div></li>'
      + '</ul>';
    T.seedNoteFragmentFromHtml(T.docA, T.cardA, src);
    T.docA.transact(() => T.cardA.set('html', T.noteFragmentToHtml(T.getNoteFragment(T.cardA))), 'remote-test');
  });
  await expect(page.locator(`${A} .ck-box`)).toHaveCount(2);
  // Readers reach a note's threads through this attribute on the display.
  await expect(page.locator(`${A} .tt-comment[data-comment-id="th-1"]`)).toHaveCount(1);

  await page.locator(`${A} .ck-box`).nth(1).click();

  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getFragHtmlA()))
    .toMatch(/<li class="ck"><span class="ck-box is-checked"[^>]*><\/span><div class="ck-text"><p>two/);
  const frag = await page.evaluate(() => window.__soleilNoteTest.getFragHtmlA());
  expect(frag).toContain('data-comment-id="th-1"');
  expect(frag).toContain('data-entity-ref=');
  expect(frag).toMatch(/<span class="ck-box" [^>]*><\/span><div class="ck-text"><p>one/);
  // The html cache follows the fragment, mention and anchor included.
  await expect.poll(() => cardField(page, 'html')).toContain('data-comment-id="th-1"');
  expect(await cardField(page, 'html')).toContain('data-entity-ref=');
  await expect(page.locator(`${A} .ck-box`).nth(1)).toHaveClass(/is-checked/);
});
