// The doc look's side panel, Elements, for a screenplay (the owner's pick of
// 2026-10-21, mockup AC-script), shipped 2026-10-24 (lib/appHost.js
// docLookAllowed): the eight elements, the caret's checked, a click setting
// the caret's; Tab and Enter still step them (ScreenplayKeymap); and the
// script's Title page, Scene numbers and Dual dialogue, run as the bar runs
// them. Driven in the ?docqa=1 harness.

import { expect, test } from '@playwright/test';
import { setScreenplay } from './helpers/docFrame.js';

const SCRIPT = [
  { element: 'scene', text: 'INT. DINER - NIGHT' },
  { element: 'action', text: 'The jukebox plays to nobody.' },
  { element: 'character', text: 'MARA' },
  { element: 'dialogue', text: 'Two coffees.' },
  { element: 'character', text: 'COOK' },
  { element: 'dialogue', text: 'He hasn’t been in since June.' },
];

async function openScript(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(modal(page)).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await setScreenplay(modal(page), true);
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();
  // The editor is rebuilt for a screenplay; write into the new one.
  await page.waitForFunction(() =>
    window.__soleilDocTest.editor?.state?.doc?.firstChild?.type?.name === 'screenplayBlock',
  null, { timeout: 10000 });
  await page.evaluate((blocks) => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON(blocks));
  }, SCRIPT);
}

const modal = (page) => page.locator('.doc-card-modal');
const panel = (page) => modal(page).getByRole('complementary', { name: 'Comments and find' });
const elements = (page) => panel(page).getByRole('listbox', { name: 'Element' });
const element = (page, name) => elements(page).getByRole('option', { name, exact: true });
const checked = (page) => elements(page).locator('[aria-selected="true"]');

// The caret put in the block holding `text`, the editor focused.
const caretIn = async (page, text) => {
  await page.evaluate((t) => {
    const ed = window.__soleilDocTest.editor;
    let at = null;
    ed.state.doc.descendants((node, pos) => {
      if (at != null || !node.isText) return at == null;
      const i = node.text.indexOf(t);
      if (i >= 0) at = pos + i + 1;
      return false;
    });
    ed.chain().focus().setTextSelection(at).run();
  }, text);
  await page.waitForFunction(() => !!document.activeElement?.closest?.('.doc-card-modal .ProseMirror'));
};
const elementAtCaret = (page) => page.evaluate(() => {
  const ed = window.__soleilDocTest.editor;
  return ed.getAttributes('screenplayBlock').element || null;
});

async function openElements(page) {
  await modal(page).locator('.dl-head').getByRole('button', { name: /^Comments/ }).click();
  await panel(page).getByRole('tab', { name: 'Elements' }).click();
  await expect(elements(page)).toBeVisible();
}

test('a screenplay\'s panel lists its eight elements first, the caret\'s checked', async ({ page }) => {
  await openScript(page);
  await caretIn(page, 'Two coffees');
  await openElements(page);
  const tabs = await panel(page).getByRole('tab').allTextContents();
  expect(tabs.map((t) => t.replace(/\d+$/, '').trim())).toEqual(['Elements', 'Comments', 'Find']);
  expect(await elements(page).getByRole('option').allTextContents()).toEqual([
    'Scene Heading', 'Action', 'Character', 'Parenthetical', 'Dialogue', 'Transition', 'Shot', 'Centered',
  ]);
  await expect(checked(page)).toHaveCount(1);
  await expect(element(page, 'Dialogue')).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page)).toContainText('Tab steps through these. Enter picks the one that usually comes next.');
});

test('a click on an element sets the caret\'s block to it, and the caret stays in the text', async ({ page }) => {
  await openScript(page);
  await caretIn(page, 'The jukebox');
  await openElements(page);
  await expect(element(page, 'Action')).toHaveAttribute('aria-selected', 'true');
  await element(page, 'Shot').click();
  await expect.poll(() => elementAtCaret(page)).toBe('shot');
  await expect(element(page, 'Shot')).toHaveAttribute('aria-selected', 'true');
  await expect(modal(page).locator('.ProseMirror').first()).toBeFocused();
});

test('the check follows the caret, and Tab still steps the element', async ({ page }) => {
  await openScript(page);
  await openElements(page);
  await caretIn(page, 'MARA');
  await expect(element(page, 'Character')).toHaveAttribute('aria-selected', 'true');
  await caretIn(page, 'Two coffees');
  await expect(element(page, 'Dialogue')).toHaveAttribute('aria-selected', 'true');
  // A new line after the action, then Tab: the panel names what the keys made.
  await caretIn(page, 'The jukebox');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const LABEL = { scene: 'Scene Heading', action: 'Action', character: 'Character', parenthetical: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition', shot: 'Shot', centered: 'Centered' };
  const afterEnter = await elementAtCaret(page);
  await expect(element(page, LABEL[afterEnter])).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab');
  await expect.poll(() => elementAtCaret(page)).not.toBe(afterEnter);
  await expect(element(page, LABEL[await elementAtCaret(page)])).toHaveAttribute('aria-selected', 'true');
});

test('↑ and ↓ move through the elements, and Enter sets one', async ({ page }) => {
  await openScript(page);
  await caretIn(page, 'The jukebox');
  await openElements(page);
  await element(page, 'Action').focus();
  await page.keyboard.press('ArrowDown');
  await expect(element(page, 'Character')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(element(page, 'Scene Heading')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => elementAtCaret(page)).toBe('scene');
});

test('Title page and Scene numbers switch on and off, as the bar\'s do', async ({ page }) => {
  await openScript(page);
  await openElements(page);
  const title = panel(page).getByRole('switch', { name: 'Title page' });
  const numbers = panel(page).getByRole('switch', { name: 'Scene numbers' });
  await expect(title).toHaveAttribute('aria-checked', 'false');
  await title.click();
  await expect(title).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(() => {
    const T = window.__soleilDocTest;
    return !!T.getTitlePage(T.ydoc, T.getScope()).enabled;
  })).toBe(true);
  const was = await numbers.getAttribute('aria-checked');
  await numbers.click();
  await expect(numbers).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');
  await expect(page.locator('.doc-paper.show-scene-numbers')).toHaveCount(was === 'true' ? 0 : 1);
});

test('Pair with the speech above makes the speech dual dialogue, and says so', async ({ page }) => {
  await openScript(page);
  await caretIn(page, 'The jukebox');
  await openElements(page);
  const pair = panel(page).getByRole('button', { name: 'Pair with the speech above' });
  // Not in a speech: nothing to pair.
  await expect(pair).toBeDisabled();
  await caretIn(page, 'He hasn’t');
  await expect(pair).toBeEnabled();
  await pair.click();
  await expect.poll(() => page.evaluate(() => !!window.__soleilDocTest.editor.getAttributes('screenplayBlock').dual)).toBe(true);
  await expect(pair).toHaveAttribute('aria-pressed', 'true');
});

test('a document\'s panel has no Elements', async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await modal(page).locator('.dl-head').getByRole('button', { name: /^Comments/ }).click();
  await expect(panel(page).getByRole('tab', { name: 'Elements' })).toHaveCount(0);
});
