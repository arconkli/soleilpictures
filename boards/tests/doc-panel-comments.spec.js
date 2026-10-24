// The doc look's side panel, Comments (the owner's pick of 2026-10-21, mockup
// AC-comments), held to a dev opt-in (lib/appHost.js docLookAllowed): every
// thread of the doc, open and resolved, in the doc's order, a card each with
// the words it's on; a reply, Resolve, Reopen and Delete on the card; a card
// takes you to its words on whatever page they're on, and the words take you
// to their card. Driven in the ?docqa=1 harness, as QA Tester (docqa-user).

import { expect, test } from '@playwright/test';

async function openDoc(page, query = '') {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('soleil.dev.docLook', '1'); } catch (_) {}
  });
  await page.goto(`/?docqa=1${query}`);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(modal(page)).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const modal = (page) => page.locator('.doc-card-modal');
const panel = (page) => modal(page).getByRole('complementary', { name: 'Comments and find' });
const cards = (page) => panel(page).locator('.dl-th');
const card = (page, id) => panel(page).locator(`.dl-th[data-thread="${id}"]`);
const filter = (page, name) => panel(page).getByRole('radio', { name: new RegExp(`^${name}`) });
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
  await expect(panel(page).locator('.dl-cmts-none')).toContainText('No comments yet');
  await expect(panel(page).locator('.dl-cmts-none')).toContainText('Select some words, then Comment');
  await expect(filter(page, 'All')).toHaveAttribute('aria-checked', 'true');
  await expect(filter(page, 'All')).toContainText('0');
});

test('every thread is a card in the doc\'s order, with the words it\'s on and who said it', async ({ page }) => {
  await openDoc(page);
  // Written in the other order from where their words sit.
  const [sign, drive] = await writeWithComments(page,
    '<p>A night drive across the desert.</p><p>The sodium-orange sign of the motel.</p>', [
      { word: 'sodium-orange', body: 'Name the gas station?', author: 'Maya Chen', authorId: 'u-maya' },
      { word: 'across the desert', body: 'Too long a drive?' },
    ]);
  const dots = modal(page).locator('.comment-gutter-dot');
  await expect(dots.first()).toBeVisible();
  await openPanel(page);
  await expect(cards(page)).toHaveCount(2);
  // The cards say where every thread is; the margin's dots step aside.
  await expect(dots.first()).toBeHidden();
  await expect(cards(page).nth(0)).toHaveAttribute('data-thread', drive);
  await expect(cards(page).nth(1)).toHaveAttribute('data-thread', sign);
  await expect(card(page, drive).locator('.dl-th-q')).toHaveText('“across the desert”');
  await expect(card(page, sign).locator('.dl-th-q')).toHaveText('“sodium-orange”');
  await expect(card(page, sign).locator('.dl-cm-h b')).toHaveText('Maya Chen');
  await expect(card(page, sign).locator('.dl-cm-t')).toHaveText('Name the gas station?');
  await expect(card(page, drive).locator('.dl-cm-h b')).toHaveText('You');
  // Your face is your own initial.
  await expect(card(page, drive).locator('.dl-face')).toHaveText('Q');
  await expect(card(page, sign).locator('.dl-face')).toHaveText('M');
  await expect(card(page, drive).locator('.dl-cm-h time')).toHaveText('Just now');
  await expect(filter(page, 'All')).toContainText('2');
  await expect(filter(page, 'Open')).toContainText('2');
  await expect(filter(page, 'Resolved')).toContainText('0');
});

test('the filter is one stop, and the arrows move it', async ({ page }) => {
  await openDoc(page);
  await writeWithComments(page, '<p>Keep the motel sign lit</p>', [{ word: 'sign', body: 'Which sign?' }]);
  await openPanel(page);
  await filter(page, 'All').focus();
  await page.keyboard.press('ArrowRight');
  await expect(filter(page, 'Open')).toHaveAttribute('aria-checked', 'true');
  await expect(filter(page, 'Open')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(filter(page, 'Resolved')).toHaveAttribute('aria-checked', 'true');
  await expect(panel(page).locator('.dl-cmts-none')).toHaveText('Nothing resolved yet');
});

test('Resolve on a card says who resolved it and when, and Reopen brings it back', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [
    { word: 'sign', body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya' },
  ]);
  await openPanel(page);
  await card(page, id).getByRole('button', { name: 'Resolve' }).click();
  await expect(card(page, id)).toHaveClass(/is-res/);
  await expect(card(page, id).locator('.dl-th-by')).toHaveText('Resolved by you · just now');
  await expect(card(page, id).getByRole('textbox')).toHaveCount(0);
  await expect(filter(page, 'Open')).toContainText('0');
  await expect(filter(page, 'Resolved')).toContainText('1');
  const state = await page.evaluate((id) => window.__soleilDocTest.getScope().comments.get(`${id}~s`), id);
  expect(state).toMatchObject({ kind: 'state', resolved: true, by: 'docqa-user', byName: 'QA Tester' });

  await filter(page, 'Open').click();
  await expect(panel(page).locator('.dl-cmts-none')).toHaveText('Nothing open: every comment is resolved');
  await filter(page, 'Resolved').click();
  await card(page, id).getByRole('button', { name: 'Reopen' }).click();
  await expect(panel(page).locator('.dl-cmts-none')).toHaveText('Nothing resolved yet');
  await filter(page, 'Open').click();
  await expect(card(page, id)).not.toHaveClass(/is-res/);
  await expect(card(page, id).getByRole('textbox', { name: 'Reply to Maya Chen' })).toBeVisible();
});

test('a reply typed on a card is filed beside its thread and shows on the card', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [
    { word: 'sign', body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya' },
  ]);
  await openPanel(page);
  const reply = card(page, id).getByRole('textbox', { name: 'Reply to Maya Chen' });
  await expect(card(page, id).getByRole('button', { name: 'Send reply' })).toHaveCount(0);
  await reply.fill('The neon one');
  await expect(card(page, id).getByRole('button', { name: 'Send reply' })).toBeVisible();
  await reply.press('Enter');
  await expect(card(page, id).locator('.dl-cm')).toHaveCount(2);
  await expect(card(page, id).locator('.dl-cm').nth(1).locator('.dl-cm-t')).toHaveText('The neon one');
  await expect(card(page, id).locator('.dl-cm').nth(1).locator('b')).toHaveText('You');
  await expect(reply).toHaveValue('');
  const keys = await page.evaluate((id) => [...window.__soleilDocTest.getScope().comments.keys()], id);
  expect(keys.some((k) => k.startsWith(`${id}~r~`))).toBe(true);
});

test('clicking commented words opens the panel on their card and lights them', async ({ page }) => {
  await openDoc(page);
  const [sign, lit] = await writeWithComments(page, '<p>Keep the motel sign lit all night</p>', [
    { word: 'sign', body: 'Which sign?' },
    { word: 'night', body: 'Or dusk?' },
  ]);
  await mark(page, sign).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('tab', { name: /^Comments/ })).toHaveAttribute('aria-selected', 'true');
  await expect(card(page, sign)).toHaveClass(/is-on/);
  // The panel's card, not the thread's pop-up.
  await expect(page.locator('.comment-inline-pop')).toHaveCount(0);
  const colour = await litColour(page);
  await expect.poll(() => background(mark(page, sign))).toBe(colour);
  expect(await background(mark(page, lit))).not.toBe(colour);
  // The caret moved into other commented words picks their card.
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    const at = ed.getText().indexOf('night') + 3;
    ed.commands.setTextSelection(at);
  });
  await expect(card(page, lit)).toHaveClass(/is-on/);
  await expect(card(page, sign)).not.toHaveClass(/is-on/);
});

test('a resolved thread\'s words read as plain text, and its card still lights them', async ({ page }) => {
  await openDoc(page);
  const [sign, night] = await writeWithComments(page, '<p>Keep the motel sign lit all night</p>', [
    { word: 'sign', body: 'Which sign?', author: 'Maya Chen', authorId: 'u-maya' },
    { word: 'night', body: 'Or dusk?' },
  ]);
  const looks = (id) => mark(page, id).evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.backgroundColor, cs.textDecorationColor, cs.cursor];
  });
  const resting = await looks(night);
  await page.evaluate((id) => {
    const T = window.__soleilDocTest;
    T.resolveComment(T.ydoc, id, true, T.getScope(), { by: 'docqa-user', byName: 'QA Tester' });
  }, sign);
  // No tint, no dotted rule, no hand; the open one beside it keeps them.
  await expect.poll(() => looks(sign)).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', 'text']);
  expect(await looks(night)).toEqual(resting);
  expect(resting[2]).toBe('pointer');
  // A click puts the caret in its words and opens nothing.
  await mark(page, sign).click();
  await expect(modal(page).locator('.tt-editor').first()).toBeFocused();
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('.comment-inline-pop')).toHaveCount(0);
  // The caret in its words picks no card; in an open thread's, it does.
  await openPanel(page);
  await expect(card(page, sign)).toHaveClass(/is-res/);
  const caretIn = (word) => page.evaluate((word) => {
    const ed = window.__soleilDocTest.editor;
    ed.commands.setTextSelection(ed.getText().indexOf(word) + 2);
  }, word);
  await caretIn('night');
  await expect(card(page, night)).toHaveClass(/is-on/);
  await caretIn('sign');
  await page.waitForTimeout(400);
  await expect(card(page, sign)).not.toHaveClass(/is-on/);
  await expect(card(page, night)).toHaveClass(/is-on/);
  // Its card still shows where it was.
  await card(page, sign).locator('.dl-th-q').click();
  await expect(card(page, sign)).toHaveClass(/is-on/);
  const colour = await litColour(page);
  await expect.poll(() => background(mark(page, sign)), { timeout: 4000 }).toBe(colour);
  // Reopened, its words are a comment's again.
  await card(page, sign).getByRole('button', { name: 'Reopen' }).click();
  await expect.poll(() => looks(sign).then((l) => l[2])).toBe('pointer');
});

test('a card for words on another page opens that page and shows the words', async ({ page }) => {
  await openDoc(page);
  const [drive] = await writeWithComments(page, '<p>A night drive across the desert.</p>', [
    { word: 'across the desert', body: 'Too long a drive?' },
  ]);
  const motel = await pageWithComment(page, 'Motel', ['The ', 'sodium-orange', ' sign'], 'Name the gas station?');
  await openPanel(page);
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0)).toHaveAttribute('data-thread', drive);
  await expect(card(page, motel.id).locator('.dl-th-q')).toHaveText('“sodium-orange”');
  await expect(mark(page, motel.id)).toHaveCount(0);

  await card(page, motel.id).locator('.dl-th-q').click();
  await expect(modal(page).locator('.doc-tree-row.is-active')).toContainText('Motel');
  await expect(mark(page, motel.id)).toBeVisible();
  await expect(card(page, motel.id)).toHaveClass(/is-on/);
  const colour = await litColour(page);
  await expect.poll(() => background(mark(page, motel.id)), { timeout: 4000 }).toBe(colour);
});

test('deleting a thread from its card says so, and Undo brings it back', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [{ word: 'sign', body: 'Which sign?' }]);
  await openPanel(page);
  await card(page, id).hover();
  await card(page, id).getByRole('button', { name: 'Delete thread' }).click();
  await expect(cards(page)).toHaveCount(0);
  const toast = page.locator('.toast', { hasText: 'Comment thread deleted' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, id)).toBeVisible();
  await expect(card(page, id).locator('.dl-cm-t')).toHaveText('Which sign?');
  await expect(mark(page, id)).toHaveCount(1);
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
  await expect(cards(page)).toHaveCount(2);
  await expect(card(page, ids.open).locator('.dl-th-q')).toHaveText('“the motel sign”');
  await expect(card(page, ids.done).locator('.dl-th-by')).toHaveText('Resolved by Maya Chen · just now');
  await expect(panel(page).getByRole('textbox')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /^(Resolve|Reopen|Delete thread)$/ })).toHaveCount(0);
});

test('Escape in the panel keeps the doc open and puts you back in the text', async ({ page }) => {
  await openDoc(page);
  const [id] = await writeWithComments(page, '<p>Keep the motel sign lit</p>', [{ word: 'sign', body: 'Which sign?' }]);
  await openPanel(page);
  await card(page, id).getByRole('textbox').click();
  await page.keyboard.press('Escape');
  await expect(modal(page)).toBeVisible();
  await expect(panel(page)).toBeVisible();
  await expect(modal(page).locator('.tt-editor').first()).toBeFocused();
});
