// The Comments tab of a doc's side panel, drawn with the shared comment parts
// (components/comments/DocThreadsPanel.jsx): every open thread of the doc in
// the doc's order as a short row; the one that is open is the whole
// conversation with the box to reply in, and the only gold on the page (its
// bar and its words); resolved threads wait in a "Resolved n" section that
// opens on a press. Words take you to their thread and a thread takes you to
// its words, on whatever page they are. Driven in the ?docqa=1 harness, as
// QA Tester (docqa-user).

import { expect, test } from '@playwright/test';

async function openDoc(page, query = '') {
  await page.goto(`/?docqa=1${query}`);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(modal(page)).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const modal = (page) => page.locator('.doc-card-modal');
const panel = (page) => modal(page).getByRole('complementary', { name: 'Comments and find' });
// A thread at rest is a row (a button); the open one is the whole card.
const rows = (page) => panel(page).locator('button.cmt-list-row');
const row = (page, id) => panel(page).locator(`button.cmt-list-row[data-thread="${id}"]`);
const opened = (page) => panel(page).locator('.cmt-thread.is-open');
const card = (page, id) => panel(page).locator(`.cmt-thread.is-open[data-thread="${id}"]`);
// Open a thread from its row (it may be open already: the caret in its words opens it).
const pick = async (page, id) => {
  await expect(panel(page).locator(`[data-thread="${id}"]`)).toHaveCount(1);
  if (!(await card(page, id).count())) await row(page, id).click();
  await expect(card(page, id)).toBeVisible();
};
const fold = (page) => panel(page).locator('.cmt-fold');
const toast = (page, text) => page.locator('.toast', { hasText: text });
const resolve = (page, id) => page.evaluate((id) => {
  const T = window.__soleilDocTest;
  T.resolveComment(T.ydoc, id, true, T.getScope(), { by: 'docqa-user', byName: 'QA Tester' });
}, id);
const mark = (page, id) => modal(page).locator(`.tt-comment[data-comment-id="${id}"]`);

async function openPanel(page) {
  await modal(page).locator('.dl-head').getByRole('button', { name: /^Comments/ }).click();
  await expect(panel(page)).toBeVisible();
}

// The open page's text, then a comment on each `word` in it, the thread and
// its mark made as the editor's Comment makes them. Returns the thread ids.
async function writeWithComments(page, html, comments) {
  return page.evaluate(({ html, comments }) => {
    const T = window.__soleilDocTest;
    const ed = T.editor;
    ed.commands.setContent(html);
    const [first] = T.readPages(T.ydoc, T.getScope());
    return comments.map(({ word, body, author = 'QA Tester', authorId = 'docqa-user', pageId = first.id }) => {
      let at = null;
      ed.state.doc.descendants((node, pos) => {
        if (at || !node.isText) return !at;
        const i = node.text.indexOf(word);
        if (i >= 0) at = { from: pos + i, to: pos + i + word.length };
        return false;
      });
      const id = T.addCommentThread(T.ydoc, { pageId, body, author, authorId, authorColor: '#4f8df8', scope: T.getScope() });
      ed.chain().setTextSelection(at).setMark('comment', { id }).run();
      return id;
    }).map((id, i, all) => {
      // The caret is left at the top, in no comment's words (the caret in a
      // thread's words opens that thread).
      if (i === all.length - 1) ed.commands.setTextSelection(1);
      return id;
    });
  }, { html, comments });
}

// A page that isn't open, with words on it under a comment, written straight
// into the doc as y-prosemirror files them (a comment can overlap another, so
// its mark is filed under its name and a hash). Returns { pageId, id }.
async function pageWithComment(page, name, [before, words, after], body) {
  return page.evaluate(({ name, before, words, after, body }) => {
    const T = window.__soleilDocTest;
    const scope = T.getScope();
    const pageId = T.addPage(T.ydoc, { name, scope });
    const id = T.addCommentThread(T.ydoc, { pageId, body, author: 'Maya Chen', authorId: 'u-maya', authorColor: '#4f8df8', scope });
    const p = new T.Y.XmlElement('paragraph');
    const t = new T.Y.XmlText();
    p.insert(0, [t]);
    T.ydoc.transact(() => {
      scope.content.get(pageId).insert(0, [p]);
      // Each run says its marks ({} for none), or it takes the run before's.
      t.insert(0, before, {});
      t.insert(before.length, words, { 'comment--QaTest01': { id } });
      t.insert(before.length + words.length, after, {});
    });
    return { pageId, id };
  }, { name, before, words, after, body });
}

// The colour the panel lights a picked thread's words in.
const litColour = (page) => page.evaluate(() => {
  const probe = document.createElement('span');
  probe.style.background = 'var(--soleil-soft)';
  document.querySelector('.dl-surface').appendChild(probe);
  const c = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return c;
});
const background = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);

test('with no comments, the panel says how to make one', async ({ page }) => {
  await openDoc(page);
  await openPanel(page);
  await expect(panel(page).locator('.cmt-list-empty')).toContainText('No comments yet');
  await expect(panel(page).locator('.cmt-list-empty')).toContainText('Select some words, then Comment');
});

test('every open thread is a row in the doc\'s order, with the words it\'s on and who said it', async ({ page }) => {
  await openDoc(page);
  // Written in the other order from where their words sit.
  const [sign, drive] = await writeWithComments(page,
    '<p>A night drive across the desert.</p><p>The sodium-orange sign of the motel.</p>', [
      { word: 'sodium-orange', body: 'Name the gas station?', author: 'Maya Chen', authorId: 'u-maya' },
      { word: 'across the desert', body: 'Too long a drive?' },
    ]);
  const dots = modal(page).locator('.comment-gutter-dot');
  await expect(dots.first()).toBeVisible();
  // (the first dot is on the reader's own comment, which is not said by name)
  await expect(dots.first()).toHaveAttribute('aria-label', /^Your comment: Too long a drive\?/);
  await openPanel(page);
  await expect(rows(page)).toHaveCount(2);
  // The rows say where every thread is; the margin's dots step aside.
  await expect(dots.first()).toBeHidden();
  await expect(rows(page).nth(0)).toHaveAttribute('data-thread', drive);
  await expect(rows(page).nth(1)).toHaveAttribute('data-thread', sign);
  await expect(row(page, drive).locator('.cmt-list-foot')).toContainText('“across the desert”');
  await expect(row(page, sign).locator('.cmt-list-foot')).toContainText('“sodium-orange”');
  await expect(row(page, sign).locator('.cmt-list-who')).toHaveText('Maya Chen');
  await expect(row(page, sign).locator('.cmt-list-text')).toHaveText('Name the gas station?');
  await expect(row(page, sign)).toHaveAttribute('aria-label', /^Comment by Maya Chen: Name the gas station\?/);
  // Nothing is open, so nothing is gold.
  await expect(opened(page)).toHaveCount(0);
});

test('one thread is open at a time, and it is the whole conversation', async ({ page }) => {
  await openDoc(page);
  const [sign, night] = await writeWithComments(page, '<p>Keep the motel sign lit all night</p>', [
    { word: 'sign', body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya' },
    { word: 'night', body: 'Or dusk?' },
  ]);
  await openPanel(page);
  await pick(page, sign);
  await expect(opened(page)).toHaveCount(1);
  await expect(card(page, sign).locator('.cmt-row')).toHaveCount(1);
  await expect(card(page, sign).locator('.cmt-who')).toHaveText('Maya Chen');
  await expect(card(page, sign).locator('.cmt-title')).toHaveText('“sign”');
  await expect(card(page, sign).locator('textarea')).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await pick(page, night);
  await expect(opened(page)).toHaveCount(1);
  await expect(card(page, night)).toBeVisible();
  await expect(row(page, sign)).toBeVisible();
  // Close puts it back among the rows.
  await card(page, night).getByRole('button', { name: 'Close' }).click();
  await expect(opened(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(2);
});

test('Resolve says so, with an Undo that puts the thread back', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [
    { word: 'sign', body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya' },
  ]);
  await openPanel(page);
  await pick(page, id);
  await card(page, id).getByRole('button', { name: 'Resolve' }).click();
  await expect(toast(page, 'Comment resolved')).toBeVisible();
  await expect(fold(page)).toHaveText(/Resolved\s*1/);
  const state = await page.evaluate((id) => window.__soleilDocTest.getScope().comments.get(`${id}~s`), id);
  expect(state).toMatchObject({ kind: 'state', resolved: true, by: 'docqa-user', byName: 'QA Tester' });
  await toast(page, 'Comment resolved').getByRole('button', { name: 'Undo' }).click();
  await expect(fold(page)).toHaveCount(0);
  await expect(panel(page).getByRole('list', { name: 'Open comments' }).locator(`[data-thread="${id}"]`)).toHaveCount(1);
});

test('the Resolved section is shut until pressed; Reopen brings a thread back', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [
    { word: 'sign', body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya' },
  ]);
  await resolve(page, id);
  await openPanel(page);
  await expect(panel(page).locator('.cmt-list-empty')).toContainText('Nothing open');
  await expect(fold(page)).toHaveText(/Resolved\s*1/);
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(rows(page)).toHaveCount(0);
  await fold(page).click();
  await expect(row(page, id)).toHaveAttribute('aria-label', /^Resolved comment by Maya Chen/);
  await pick(page, id);
  await expect(card(page, id).locator('.cmt-resolved')).toContainText('Resolved by');
  await card(page, id).getByRole('button', { name: 'Reopen' }).click();
  await expect(fold(page)).toHaveCount(0);
  await expect(panel(page).getByRole('list', { name: 'Open comments' }).locator(`[data-thread="${id}"]`)).toHaveCount(1);
});

test('a reply on a resolved thread reopens it', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [{ word: 'sign', body: 'Which sign?' }]);
  await resolve(page, id);
  await openPanel(page);
  await fold(page).click();
  await pick(page, id);
  const box = card(page, id).locator('textarea');
  await expect(box).toHaveAttribute('placeholder', /reopen/i);
  await box.fill('Still not sure');
  await box.press('Enter');
  await expect(fold(page)).toHaveCount(0);
  await expect(card(page, id).locator('.cmt-row')).toHaveCount(2);
  await expect(card(page, id).locator('.cmt-resolved')).toHaveCount(0);
});

test('a reply typed on a thread is filed beside it and shows on the card', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [
    { word: 'sign', body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya' },
  ]);
  await openPanel(page);
  await pick(page, id);
  const reply = card(page, id).locator('textarea');
  await expect(card(page, id).getByRole('button', { name: 'Send' })).toBeDisabled();
  await reply.fill('The neon one');
  await reply.press('Shift+Enter');
  await reply.pressSequentially('not the motel');
  await reply.press('Enter');
  await expect(card(page, id).locator('.cmt-row')).toHaveCount(2);
  // Shift+Enter is a new line, and it is kept.
  await expect.poll(() => card(page, id).locator('.cmt-row').nth(1).locator('.cmt-text').innerText()).toBe('The neon one\nnot the motel');
  await expect(reply).toHaveValue('');
  const keys = await page.evaluate(() => [...window.__soleilDocTest.getScope().comments.keys()]);
  expect(keys.some((k) => k.startsWith(`${id}~r~`))).toBe(true);
});

test('your own comment can be edited, and says it was', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [{ word: 'sign', body: 'Which sgin?' }]);
  await openPanel(page);
  await pick(page, id);
  const first = card(page, id).locator('.cmt-row').first();
  await first.hover();
  await first.getByRole('button', { name: 'Edit', exact: true }).click();
  const box = first.locator('textarea');
  await expect(box).toHaveValue('Which sgin?');
  await box.fill('Which sign?');
  await first.getByRole('button', { name: 'Save' }).click();
  await expect(first.locator('.cmt-text')).toHaveText('Which sign?');
  await expect(first.locator('.cmt-ed')).toHaveText('· edited');
});

test('clicking commented words opens the panel on their thread and lights them gold', async ({ page }) => {
  await openDoc(page);
  const [sign, lit] = await writeWithComments(page, '<p>Keep the motel sign lit all night</p>', [
    { word: 'sign', body: 'Which sign?' },
    { word: 'night', body: 'Or dusk?' },
  ]);
  const colour = await litColour(page);
  // At rest: a tint, and not the gold one.
  const resting = await background(mark(page, sign));
  expect(resting).not.toBe('rgba(0, 0, 0, 0)');
  expect(resting).not.toBe(colour);
  await mark(page, sign).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('tab', { name: /^Comments/ })).toHaveAttribute('aria-selected', 'true');
  await expect(card(page, sign)).toBeVisible();
  await expect.poll(() => background(mark(page, sign))).toBe(colour);
  expect(await background(mark(page, lit))).toBe(resting);
  // The caret moved into other commented words opens their thread.
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    const at = ed.getText().indexOf('night') + 3;
    ed.commands.setTextSelection(at);
  });
  await expect(card(page, lit)).toBeVisible();
  await expect(opened(page)).toHaveCount(1);
});

test('a resolved thread\'s words read as plain text and open nothing', async ({ page }) => {
  await openDoc(page);
  const [sign, night] = await writeWithComments(page, '<p>Keep the motel sign lit all night</p>', [
    { word: 'sign', body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya' },
    { word: 'night', body: 'Or dusk?' },
  ]);
  const looks = (id) => mark(page, id).evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.backgroundColor, cs.cursor];
  });
  const resting = await looks(night);
  expect(resting[1]).toBe('pointer');
  await resolve(page, sign);
  // No tint, no hand; the open one beside it keeps them.
  await expect.poll(() => looks(sign).then((l) => [l[0], l[1] !== 'pointer'])).toEqual(['rgba(0, 0, 0, 0)', true]);
  expect(await looks(night)).toEqual(resting);
  // A click puts the caret in its words and opens nothing.
  await mark(page, sign).click();
  await expect(modal(page).locator('.tt-editor').first()).toBeFocused();
  await expect(panel(page)).toBeHidden();
  // Picked from the Resolved section, its words show where it was.
  await openPanel(page);
  await fold(page).click();
  await pick(page, sign);
  const colour = await litColour(page);
  await expect.poll(() => background(mark(page, sign)), { timeout: 4000 }).toBe(colour);
  // Reopened, its words are a comment's again.
  await card(page, sign).getByRole('button', { name: 'Reopen' }).click();
  await expect.poll(() => looks(sign).then((l) => l[1])).toBe('pointer');
});

test('a thread for words on another page opens that page and shows the words', async ({ page }) => {
  await openDoc(page);
  const [drive] = await writeWithComments(page, '<p>A night drive across the desert.</p>', [
    { word: 'across the desert', body: 'Too long a drive?' },
  ]);
  const motel = await pageWithComment(page, 'Motel', ['The ', 'sodium-orange', ' sign'], 'Name the gas station?');
  await openPanel(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).toHaveAttribute('data-thread', drive);
  await expect(row(page, motel.id).locator('.cmt-list-foot')).toContainText('“sodium-orange”');
  await expect(mark(page, motel.id)).toHaveCount(0);

  await pick(page, motel.id);
  await expect(modal(page).locator('.doc-tree-row.is-active')).toContainText('Motel');
  await expect(mark(page, motel.id)).toBeVisible();
  await expect(card(page, motel.id)).toBeVisible();
  const colour = await litColour(page);
  await expect.poll(() => background(mark(page, motel.id)), { timeout: 4000 }).toBe(colour);
});

test('deleting a conversation says so, keeps its words marked, and Undo brings it back', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [{ word: 'sign', body: 'Which sign?' }]);
  await openPanel(page);
  await pick(page, id);
  await card(page, id).locator('.cmt-head').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Delete conversation' }).click();
  await expect(panel(page).locator(`[data-thread="${id}"]`)).toHaveCount(0);
  // The span stays in the text (so Undo has somewhere to come back to) and
  // reads as plain words.
  await expect(mark(page, id)).toHaveCount(1);
  await expect.poll(() => background(mark(page, id))).toBe('rgba(0, 0, 0, 0)');
  await expect(toast(page, 'Comment deleted')).toBeVisible();
  await toast(page, 'Comment deleted').getByRole('button', { name: 'Undo' }).click();
  await expect(panel(page).locator(`[data-thread="${id}"]`)).toHaveCount(1);
  await expect.poll(() => background(mark(page, id))).not.toBe('rgba(0, 0, 0, 0)');
});

test('deleting a reply says so with an Undo', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [{ word: 'sign', body: 'Which sign?' }]);
  await openPanel(page);
  await pick(page, id);
  const box = card(page, id).locator('textarea');
  await box.fill('The neon one');
  await box.press('Enter');
  const second = card(page, id).locator('.cmt-row').nth(1);
  await expect(second).toBeVisible();
  await second.hover();
  await second.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(card(page, id).locator('.cmt-row:not(.is-deleted)')).toHaveCount(1);
  await toast(page, 'Reply deleted').getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, id).locator('.cmt-row:not(.is-deleted)')).toHaveCount(2);
});

test('a view-only member reads every comment, with no reply, resolve or delete', async ({ page }) => {
  await openDoc(page, '&viewer=1');
  const ids = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const scope = T.getScope();
    const [first] = T.readPages(T.ydoc, scope);
    const make = (words) => {
      const id = T.addCommentThread(T.ydoc, { pageId: first.id, body: `On ${words}`, author: 'Maya Chen', authorId: 'u-maya', scope });
      const p = new T.Y.XmlElement('paragraph');
      const t = new T.Y.XmlText();
      p.insert(0, [t]);
      T.ydoc.transact(() => {
        const frag = scope.content.get(first.id);
        frag.insert(frag.length, [p]);
        t.insert(0, words, { 'comment--QaTest02': { id } });
      });
      return id;
    };
    const open = make('the motel sign');
    const done = make('the desert road');
    T.resolveComment(T.ydoc, done, true, scope, { by: 'u-maya', byName: 'Maya Chen' });
    return { open, done };
  });
  await openPanel(page);
  await pick(page, ids.open);
  await expect(card(page, ids.open).locator('.cmt-title')).toHaveText('“the motel sign”');
  await expect(card(page, ids.open).locator('.cmt-readonly')).toHaveText('Only people who can edit this doc can reply.');
  await expect(panel(page).locator('textarea')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /^(Resolve|Reopen|Edit)$/ })).toHaveCount(0);
  await fold(page).click();
  await pick(page, ids.done);
  await expect(card(page, ids.done).locator('.cmt-resolved')).toContainText('Resolved by Maya Chen');
  await expect(panel(page).locator('textarea')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /^(Resolve|Reopen|Edit)$/ })).toHaveCount(0);
});

test('a margin dot opened from the keyboard puts the caret in its thread, and Escape closes it', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [
    { word: 'sign', body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya' },
  ]);
  const dot = modal(page).locator(`.comment-gutter-dot[data-thread="${id}"]`);
  await expect(dot).toHaveAttribute('aria-label', 'Comment by Maya Chen: Which sign? (unread)');
  const box = await dot.boundingBox();
  expect(Math.round(box.width)).toBeGreaterThanOrEqual(24);
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(24);
  await dot.focus();
  await page.keyboard.press('Enter');
  await expect(card(page, id)).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.cmt-card'))).toBe(true);
  await page.keyboard.press('Escape');
  // The doc stays open, the panel stays, the thread is a row again and holds the caret.
  await expect(modal(page)).toBeVisible();
  await expect(panel(page)).toBeVisible();
  await expect(opened(page)).toHaveCount(0);
  await expect(row(page, id)).toBeFocused();
});

test('a new comment is written beside its words and opens as a thread in the panel', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.commands.setContent('<p>We open on the blue hour alley.</p>');
    ed.chain().focus().setTextSelection({ from: 16, to: 25 }).run();
  });
  await expect(modal(page).locator('.tt-editor').first()).toBeFocused(); // it takes focus a frame later
  await modal(page).getByRole('toolbar', { name: 'Formatting', exact: true }).first().getByRole('button', { name: 'Comment', exact: true }).click();
  const fresh = page.locator('.cmt-float-host .cmt-card');
  await expect(fresh).toBeVisible();
  // The words being commented on are held in a neutral tint while it is written.
  await expect(modal(page).locator('.cmt-pending').first()).toBeVisible();
  await fresh.locator('textarea').fill('Earlier than this?');
  await fresh.locator('textarea').press('Enter');
  await expect(fresh).toHaveCount(0);
  await expect(modal(page).locator('.cmt-pending')).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await expect(opened(page)).toHaveCount(1);
  await expect(opened(page).locator('.cmt-text')).toHaveText('Earlier than this?');
  await expect(modal(page).locator('.tt-comment')).toHaveText('blue hour');
});

// A link to a comment (?board=&card=&comment=): App.jsx leaves the request in
// lib/commentOpen.js, the canvas opens the doc, and the doc opens the thread.
// The harness has no app around it, so the request is left as App leaves it.
const openLink = (page, commentId) => page.evaluate(async (commentId) => {
  const m = await import('/src/lib/commentOpen.js');
  m.requestOpenComment({ boardId: 'docqa-board', cardId: 'docqa-card', commentId });
}, commentId);

test('a link to a reply opens its thread in the panel and lights the reply', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [
    { word: 'sign', body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya' },
  ]);
  const replyId = await page.evaluate((id) => {
    const T = window.__soleilDocTest;
    T.addCommentReply(T.ydoc, id, { body: 'The neon one', author: 'Maya Chen', authorId: 'u-maya', scope: T.getScope() });
    return T.readComments(T.ydoc, T.getScope()).find((t) => t.id === id).replies[0].id;
  }, id);
  await expect(panel(page)).toBeHidden();
  await openLink(page, replyId);
  await expect(card(page, id)).toBeVisible();
  await expect(card(page, id).locator(`[data-cmt-row="${replyId}"]`)).toHaveClass(/is-flash/);
});

test('a link to a resolved thread opens the Resolved section on it', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [
    { word: 'sign', body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya' },
  ]);
  await resolve(page, id);
  await openLink(page, id);
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(card(page, id).locator('.cmt-resolved')).toBeVisible();
});

test('a link to a comment that is gone says so', async ({ page }) => {
  await openDoc(page);
  await writeWithComments(page, '<p>Keep the motel sign lit</p>', [{ word: 'sign', body: 'Which sign?' }]);
  // a comment is called gone only once the cluster's server copy is in, which
  // the canvas says (lib/commentOpen.js); the harness has no canvas
  await page.evaluate(async () => {
    const m = await import('/src/lib/commentOpen.js');
    m.setCommentBoardSynced('docqa-board', true);
  });
  await openLink(page, 'cm_nothere');
  await expect(toast(page, "That comment isn't here any more")).toBeVisible({ timeout: 8000 });
  await expect(panel(page)).toBeHidden();
});

test('what is unread is dotted on the header, the margin and the row, until the thread is opened', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [
    { word: 'sign', body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya' },
  ]);
  const button = modal(page).locator('.dl-head').getByRole('button', { name: /^Comments/ });
  await expect(button).toHaveText(/1/);
  await expect(button.locator('.dl-dot')).toHaveCount(1);
  await expect(modal(page).locator(`.comment-gutter-dot[data-thread="${id}"]`)).toHaveClass(/is-unread/);
  await openPanel(page);
  await expect(row(page, id).locator('.cmt-list-new')).toHaveCount(1);
  await pick(page, id);
  await card(page, id).getByRole('button', { name: 'Close' }).click();
  await expect(row(page, id).locator('.cmt-list-new')).toHaveCount(0);
  await expect(button.locator('.dl-dot')).toHaveCount(0);
  // Remembered on this device, for this person and this doc.
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cmt-seen:')));
  expect(keys.length).toBe(1);
  expect(keys[0]).toMatch(/^cmt-seen:docqa-user:/);
  // My own comment is never unread.
  const [mine] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [{ word: 'motel', body: 'Mine' }]);
  await expect(row(page, mine).locator('.cmt-list-new')).toHaveCount(0);
});

