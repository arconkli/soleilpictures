// The doc look's side panel, Find (the owner's pick of 2026-10-21, mockup
// AC-find), shipped 2026-10-24 (lib/appHost.js docLookAllowed): a search of
// every page of the doc or the one open, in any case or as typed (Aa), whole
// words or not; its hits listed page by page with the words around them, and
// lit in the open page's text; Enter and ⇧Enter through them, opening the
// page each is on; Replace, and Replace all on every page with one Undo; no
// Replace for a reader. Driven in the ?docqa=1 harness.

import { expect, test } from '@playwright/test';
import { korean } from './imeHelpers.js';

async function openDoc(page, query = '') {
  await page.goto(`/?docqa=1${query}`);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(modal(page)).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const modal = (page) => page.locator('.doc-card-modal');
const panel = (page) => modal(page).getByRole('complementary', { name: 'Comments and find' });
const field = (page) => panel(page).getByRole('textbox', { name: 'Find', exact: true });
const replaceField = (page) => panel(page).getByRole('textbox', { name: 'Replace with' });
const count = (page) => panel(page).locator('.dl-find-n');
const groups = (page) => panel(page).locator('.dl-find-res section');
const rows = (page) => panel(page).locator('.dl-fr');
const hits = (page) => modal(page).locator('.doc-find-hit');
const button = (page, name) => panel(page).getByRole('button', { name, exact: true });
const toggle = (page, name) => panel(page).getByRole('button', { name });

// The open page's words.
const write = (page, html) => page.evaluate((h) => window.__soleilDocTest.editor.commands.setContent(h), html);
// A page that isn't open, its paragraphs written straight into the doc.
// Returns its id.
const addPageWith = (page, name, paras) => page.evaluate(({ name, paras }) => {
  const T = window.__soleilDocTest;
  const scope = T.getScope();
  const pageId = T.addPage(T.ydoc, { name, scope });
  T.ydoc.transact(() => {
    const frag = scope.content.get(pageId);
    paras.forEach((s, i) => {
      const p = new T.Y.XmlElement('paragraph');
      const t = new T.Y.XmlText();
      p.insert(0, [t]);
      frag.insert(i, [p]);
      t.insert(0, s, {});
    });
  });
  return pageId;
}, { name, paras });
const pageText = (page, pageId) => page.evaluate((id) => {
  const T = window.__soleilDocTest;
  return T.readPageText(T.ydoc, id, T.getScope());
}, pageId);
const editorText = (page) => page.evaluate(() => window.__soleilDocTest.editor.getText());
// The words selected in the open page's editor.
const selected = (page) => page.evaluate(() => {
  const ed = window.__soleilDocTest.editor;
  const { from, to } = ed.state.selection;
  return ed.state.doc.textBetween(from, to);
});
// The editor focused: TipTap's focus lands on the next frame, so a key
// pressed straight after it would go to the page.
const focused = (page) => page.waitForFunction(() => !!document.activeElement?.closest?.('.doc-card-modal .ProseMirror'));
// The n-th `word` in the open page selected, the editor focused.
const selectWord = async (page, word, nth = 0) => { await page.evaluate(({ word, nth }) => {
  const ed = window.__soleilDocTest.editor;
  const found = [];
  ed.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    let i = node.text.indexOf(word);
    while (i >= 0) { found.push(pos + i); i = node.text.indexOf(word, i + 1); }
    return false;
  });
  ed.chain().focus().setTextSelection({ from: found[nth], to: found[nth] + word.length }).run();
}, { word, nth }); await focused(page); };

// Find, by ⌘F with nothing selected (the bar folds its Find into ⋯ at this
// width, doc-bar-a.spec).
async function openFind(page) {
  await page.evaluate(() => window.__soleilDocTest.editor.commands.focus('end'));
  await focused(page);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(field(page)).toBeFocused();
}

test('⌘F opens Find on the words selected, counts the hits and lights them in the text', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>A night drive. The night is long; night falls.</p>');
  await selectWord(page, 'night');
  await page.keyboard.press('ControlOrMeta+f');
  await expect(panel(page).getByRole('tab', { name: 'Find' })).toHaveAttribute('aria-selected', 'true');
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveValue('night');
  await expect(count(page)).toHaveText('1 of 3');
  await expect(hits(page)).toHaveCount(3);
  await expect(modal(page).locator('.doc-find-hit-current')).toHaveCount(1);
  // The panel's Find, not the old find bar.
  await expect(modal(page).locator('.doc-find')).toHaveCount(0);
  await expect(rows(page).nth(1)).toHaveText('A night drive. The night is long; night falls.');
  await expect(rows(page).nth(1).locator('mark')).toHaveText('night');
});

test('the hits are listed page by page, and Enter and ⇧Enter go through them, opening each page', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>A night drive.</p>');
  await addPageWith(page, 'Diner', ['Open all night.', 'The night shift.']);
  await openFind(page);
  await field(page).fill('night');
  await expect(count(page)).toHaveText('1 of 3');
  await expect(groups(page)).toHaveCount(2);
  await expect(groups(page).nth(1)).toHaveAttribute('aria-label', 'Diner, 2 hits');
  await expect(groups(page).nth(1).locator('.dl-fr').first()).toHaveText('Open all night.');
  await field(page).press('Enter');
  await expect(count(page)).toHaveText('2 of 3');
  await expect.poll(() => editorText(page)).toContain('Open all night.');
  await expect.poll(() => selected(page)).toBe('night');
  await expect(rows(page).nth(1)).toHaveClass(/is-on/);
  await field(page).press('Enter');
  await expect(count(page)).toHaveText('3 of 3');
  await field(page).press('Enter');
  await expect(count(page)).toHaveText('1 of 3');
  await expect.poll(() => editorText(page)).toBe('A night drive.');
  await expect.poll(() => selected(page)).toBe('night');
  await field(page).press('Shift+Enter');
  await expect(count(page)).toHaveText('3 of 3');
  await expect.poll(() => editorText(page)).toContain('The night shift.');
  // The field keeps the keys through it all.
  await expect(field(page)).toBeFocused();
});

test('This page keeps the search to the page that\'s open', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>A night drive.</p>');
  await addPageWith(page, 'Diner', ['Open all night.']);
  await openFind(page);
  await field(page).fill('night');
  await expect(count(page)).toHaveText('1 of 2');
  await panel(page).getByRole('radio', { name: 'This page' }).click();
  await expect(count(page)).toHaveText('1 of 1');
  await expect(groups(page)).toHaveCount(1);
  await panel(page).getByRole('radio', { name: 'All pages' }).click();
  await expect(count(page)).toHaveText('1 of 2');
});

test('Aa finds only the case typed, and Whole word only whole words', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>Night nightly night</p>');
  await openFind(page);
  await field(page).fill('night');
  await expect(count(page)).toHaveText('1 of 3');
  await toggle(page, 'Match case').click();
  await expect(toggle(page, 'Match case')).toHaveAttribute('aria-pressed', 'true');
  await expect(count(page)).toHaveText('1 of 2');
  await toggle(page, 'Whole word').click();
  await expect(count(page)).toHaveText('1 of 1');
  await toggle(page, 'Match case').click();
  await expect(count(page)).toHaveText('1 of 2');
  await expect(hits(page)).toHaveCount(2);
});

test('a hit on another page, clicked, opens that page with its words selected', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>A night drive.</p>');
  await addPageWith(page, 'Diner', ['Open all night.']);
  await openFind(page);
  await field(page).fill('night');
  await groups(page).nth(1).locator('.dl-fr').click();
  await expect.poll(() => editorText(page)).toBe('Open all night.');
  await expect.poll(() => selected(page)).toBe('night');
  await expect(count(page)).toHaveText('2 of 2');
  await expect(modal(page).locator('.doc-find-hit-current')).toHaveCount(1);
});

test('Escape goes back to the text with the hit that\'s on selected', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>night one, night two</p>');
  await openFind(page);
  await field(page).fill('night');
  await field(page).press('Enter');
  await expect(count(page)).toHaveText('2 of 2');
  await page.keyboard.press('Escape');
  await expect(modal(page).locator('.ProseMirror').first()).toBeFocused();
  expect(await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    const { from, to } = ed.state.selection;
    return [ed.state.doc.textBetween(from, to), from];
  })).toEqual(['night', 12]);
  await expect(panel(page)).toBeVisible();
});

test('a hit across a change of marks is found, and Replace keeps its marks', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>The <strong>nig</strong>ht drive</p>');
  await openFind(page);
  await field(page).fill('night');
  await expect(count(page)).toHaveText('1 of 1');
  await replaceField(page).fill('day');
  await button(page, 'Replace').click();
  await expect.poll(() => page.evaluate(() => window.__soleilDocTest.editor.getHTML())).toBe('<p>The <strong>day</strong> drive</p>');
  await expect(count(page)).toHaveText('None');
});

test('Replace replaces the one that\'s on and goes on to the next; ⌘Z takes each back', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>night and night</p>');
  await openFind(page);
  await field(page).fill('night');
  await replaceField(page).fill('day');
  await button(page, 'Replace').click();
  await expect.poll(() => editorText(page)).toBe('day and night');
  await expect(count(page)).toHaveText('1 of 1');
  await button(page, 'Replace').click();
  await expect.poll(() => editorText(page)).toBe('day and day');
  await expect(count(page)).toHaveText('None');
  await expect(panel(page).locator('.dl-find-none')).toHaveText('Nothing found');
  await modal(page).locator('.ProseMirror').first().click();
  // The harness's Chrome reports Windows, so the editor's Mod is Control.
  await page.keyboard.press('Control+z');
  await expect.poll(() => editorText(page)).toBe('day and night');
});

test('a replacement holding the words isn\'t replaced again', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>cat and cat</p>');
  await openFind(page);
  await field(page).fill('cat');
  await replaceField(page).fill('cats');
  await button(page, 'Replace').click();
  await expect.poll(() => editorText(page)).toBe('cats and cat');
  // On to the second cat, past the one just put in.
  await expect(count(page)).toHaveText('2 of 2');
  await button(page, 'Replace').click();
  await expect.poll(() => editorText(page)).toBe('cats and cats');
});

test('Replace all replaces on every page, says how many on how many pages, and Undo takes them all back', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>night one, night two</p>');
  const diner = await addPageWith(page, 'Diner', ['Open all night.']);
  await openFind(page);
  await field(page).fill('night');
  await replaceField(page).fill('day');
  await button(page, 'Replace all 3').click();
  const toast = page.locator('.toast', { hasText: 'Replaced 3 matches on 2 pages' });
  await expect(toast).toBeVisible();
  await expect(count(page)).toHaveText('3 replaced');
  await expect.poll(() => editorText(page)).toBe('day one, day two');
  await expect.poll(() => pageText(page, diner)).toBe('Open all day.');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => editorText(page)).toBe('night one, night two');
  await expect.poll(() => pageText(page, diner)).toBe('Open all night.');
  await expect(count(page)).toHaveText('1 of 3');
});

test('Replace all with nothing says it deleted them; the toast\'s Undo won\'t take back typing since', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>a cat, a cat</p>');
  await openFind(page);
  await field(page).fill(' cat');
  await button(page, 'Replace all 2').click();
  const toast = page.locator('.toast', { hasText: 'Deleted 2 matches' });
  await expect(toast).toBeVisible();
  await expect.poll(() => editorText(page)).toBe('a, a');
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus('end').insertContent(' Then.').run());
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast', { hasText: '⌘Z' })).toBeVisible();
  await expect.poll(() => editorText(page)).toBe('a, a Then.');
});

test('⌘Z takes Replace all back as one step, leaving the typing just before it', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>night one, night two</p>');
  await page.evaluate(() => window.__soleilDocTest.editor.commands.focus('end'));
  await focused(page);
  await page.keyboard.type(' Then.');
  await page.keyboard.press('ControlOrMeta+f');
  await expect(field(page)).toBeFocused();
  await field(page).fill('night');
  await replaceField(page).fill('day');
  await button(page, 'Replace all 2').click();
  await expect.poll(() => editorText(page)).toBe('day one, day two Then.');
  await modal(page).locator('.ProseMirror').first().click();
  // The harness's Chrome reports Windows, so the editor's Mod is Control.
  await page.keyboard.press('Control+z');
  await expect.poll(() => editorText(page)).toBe('night one, night two Then.');
});

test('a page that runs to two sheets is searched through both', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>night one</p>');
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const scope = T.getScope();
    const [first] = T.readPages(T.ydoc, scope);
    const sid = T.addPageSheet(T.ydoc, first.id, scope);
    const frag = T.getOrCreateSheetContent(T.ydoc, first.id, sid, scope);
    T.ydoc.transact(() => {
      const p = new T.Y.XmlElement('paragraph');
      const t = new T.Y.XmlText();
      p.insert(0, [t]);
      frag.insert(0, [p]);
      t.insert(0, 'night two', {});
    });
  });
  await expect(modal(page).locator('.ProseMirror')).toHaveCount(2);
  await openFind(page);
  await field(page).fill('night');
  await expect(count(page)).toHaveText('1 of 2');
  await expect(hits(page)).toHaveCount(2);
  await field(page).press('Enter');
  await expect(count(page)).toHaveText('2 of 2');
  await expect(modal(page).locator('.ProseMirror').nth(1).locator('.doc-find-hit-current')).toHaveCount(1);
});

test('switching to Comments takes the lights off the text, and Find puts them back', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>night one, night two</p>');
  await openFind(page);
  await field(page).fill('night');
  await expect(hits(page)).toHaveCount(2);
  await panel(page).getByRole('tab', { name: /^Comments/ }).click();
  await expect(hits(page)).toHaveCount(0);
  await panel(page).getByRole('tab', { name: 'Find' }).click();
  await expect(hits(page)).toHaveCount(2);
  await expect(field(page)).toHaveValue('night');
});

test('a long list shows its first 300 hits and says how many more', async ({ page }) => {
  await openDoc(page);
  await write(page, `<p>${'night '.repeat(350).trim()}</p>`);
  await openFind(page);
  await field(page).fill('night');
  await expect(count(page)).toHaveText('1 of 350');
  await expect(rows(page)).toHaveCount(300);
  await expect(panel(page).locator('.dl-find-more')).toHaveText('And 50 more');
});

test('Korean typed in the IME is found, and Enter mid-syllable doesn\'t step', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>한글 문서, 한글 노트, 한글 대본</p>');
  await openFind(page);
  const ko = await korean(page);
  await ko.typeThenEnterMidSyllable('한글');
  await expect(field(page)).toHaveValue('한글');
  await expect(count(page)).toHaveText('1 of 3');
  await page.keyboard.press('Enter');
  await expect(count(page)).toHaveText('2 of 3');
  await toggle(page, 'Whole word').click();
  await expect(count(page)).toHaveText('1 of 3');
});

test('a reader\'s Find searches but has no Replace', async ({ page }) => {
  await openDoc(page, '&viewer=1');
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const scope = T.getScope();
    const [first] = T.readPages(T.ydoc, scope);
    const frag = scope.content.get(first.id);
    T.ydoc.transact(() => {
      const p = new T.Y.XmlElement('paragraph');
      const t = new T.Y.XmlText();
      p.insert(0, [t]);
      frag.insert(0, [p]);
      t.insert(0, 'A night drive at night.', {});
    });
  });
  // A reader's bar is short enough to keep its Find.
  await modal(page).getByRole('toolbar', { name: 'Formatting', exact: true }).getByRole('button', { name: 'Find', exact: true }).click();
  await expect(field(page)).toBeFocused();
  await field(page).fill('night');
  await expect(count(page)).toHaveText('1 of 2');
  await expect(replaceField(page)).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /^Replace/ })).toHaveCount(0);
});
