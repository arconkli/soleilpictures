// Typing in a doc redraws the text and nothing else. Every keystroke used to
// re-render the whole open doc: the card refreshed its closed preview and took
// the overlay with it, the editor re-rendered on every transaction (TipTap's
// legacy default) and took its gutters and menus with it, and the toolbar
// re-ran every one of its states. Each was a few milliseconds on every key,
// more in a long doc. The toolbar still has to light what's under the caret,
// so that's pinned here too; doc-typing-budget.spec.js times the result.
import { expect, test } from '@playwright/test';
import { setScreenplay } from './helpers/docFrame.js';
import { countRenders, renders, resetRenders } from './helpers/renderCounter.js';

async function openDoc(page, html) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 15000 });
  if (html) await page.evaluate((h) => window.__soleilDocTest.editor.commands.setContent(h), html);
}

async function openScreenplay(page, blocks) {
  await openDoc(page);
  await setScreenplay(page.locator('.doc-card-modal'), true);
  await page.waitForFunction(() => window.__soleilDocTest.editor?.state?.doc?.firstChild?.type?.name === 'screenplayBlock',
    null, { timeout: 15000 });
  await page.evaluate((b) => {
    const T = window.__soleilDocTest;
    T.editor.commands.setContent(T.screenplay.blocksToDocJSON(b));
  }, blocks);
}

// The caret into the first text that reads `text`, `at` characters in. The
// editor takes focus a frame later (TipTap's focus()), and a key pressed
// before then lands on the page instead.
const caretAt = async (page, text, at = 1) => {
  await page.evaluate(([t, a]) => {
    const ed = window.__soleilDocTest.editor;
    let pos = null;
    ed.state.doc.descendants((n, p) => {
      if (pos != null) return false;
      if (n.isText && n.text.includes(t)) { pos = p + n.text.indexOf(t) + a; return false; }
      return true;
    });
    ed.chain().focus().setTextSelection(pos).run();
  }, [text, at]);
  await expect(page.locator('.doc-card-modal .tt-editor')).toBeFocused();
};

// What re-rendered, keeping only the doc's own chrome.
const CHROME = ['RichDocCard', 'DocCardOverlay', 'DocSurface', 'DocPageTree', 'DocToolbar', 'DocFindReplace',
  'DocPageEditor', 'DocEditorContextMenu', 'DocTagGutter', 'DocCandidateGutter', 'CommentGutter', 'ScreenplaySceneNav'];
const chromeRenders = async (page) => {
  const all = await renders(page);
  return Object.fromEntries(CHROME.filter((n) => all[n]).map((n) => [n, all[n]]));
};

test('typing a sentence redraws none of the doc around the text', async ({ page }) => {
  await countRenders(page);
  await openDoc(page, '<p>One two three.</p><p>Four five six.</p>');
  await caretAt(page, 'six.', 4);
  await page.waitForTimeout(500);
  await resetRenders(page);
  await page.keyboard.type(' And seven more.', { delay: 25 });
  await expect.poll(() => page.evaluate(() => window.__soleilDocTest.editor.getText())).toContain('six. And seven more.');
  await page.waitForTimeout(300);
  expect(await chromeRenders(page)).toEqual({});
});

test('typing a speech redraws neither the scene list nor the toolbar; renaming a scene redraws the list', async ({ page }) => {
  await countRenders(page);
  await openScreenplay(page, [
    { element: 'scene', text: 'INT. CAFE - NIGHT' },
    { element: 'action', text: 'Rain on the glass.' },
    { element: 'character', text: 'MINSU' },
    { element: 'dialogue', text: 'Two coffees.' },
  ]);
  const scenes = page.locator('.doc-card-modal .sp-scenenav-item:not(.sp-scenenav-title)');
  await expect(scenes).toHaveCount(1);
  await caretAt(page, 'Two coffees.', 12);
  await page.waitForTimeout(500);
  await resetRenders(page);
  await page.keyboard.type(' Please.', { delay: 25 });
  await expect.poll(() => page.evaluate(() => window.__soleilDocTest.editor.getText())).toContain('Two coffees. Please.');
  await page.waitForTimeout(300);
  expect(await chromeRenders(page)).toEqual({});
  await caretAt(page, 'NIGHT', 5);
  await page.keyboard.type(' (LATER)');
  await expect(scenes.first()).toContainText('INT. CAFE - NIGHT (LATER)');
});

test('the toolbar lights what is under the caret, and what the next key will type', async ({ page }) => {
  await openDoc(page, '<h2>A heading</h2><p>Plain <strong>bold</strong> plain.</p><ul><li><p>An item</p></li></ul>');
  const bar = page.locator('.doc-card-modal .doc-tb');
  const bold = bar.getByRole('button', { name: 'Bold', exact: true });
  const bullets = bar.getByRole('button', { name: 'Bulleted list', exact: true });
  const style = bar.locator('.doc-tb-select');

  await caretAt(page, 'A heading', 3);
  await expect(style).toHaveValue('h2');
  await expect(bold).not.toHaveClass(/is-active/);

  await caretAt(page, 'bold', 2);
  await expect(bold).toHaveClass(/is-active/);
  await expect(style).toHaveValue('p');

  await caretAt(page, ' plain.', 3);
  await expect(bold).not.toHaveClass(/is-active/);
  // Bold armed at a caret: no selection change, only the next key's marks.
  await page.keyboard.press('Control+b');
  await expect(bold).toHaveClass(/is-active/);
  await page.keyboard.type('x');
  await expect(bold).toHaveClass(/is-active/);
  await page.keyboard.press('Control+b');
  await expect(bold).not.toHaveClass(/is-active/);

  await caretAt(page, 'An item', 2);
  await expect(bullets).toHaveClass(/is-active/);
  await expect(style).toHaveValue('');

  // Link needs a selection: off at a caret (its tooltip says why), on with
  // text selected. Its name stays Add link either way.
  const link = bar.getByRole('button', { name: 'Add link', exact: true });
  await expect(link).toBeDisabled();
  await expect(link).toHaveAttribute('title', 'Select text to link');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(link).toBeEnabled();
});

test('a screenplay\'s element picker follows the caret', async ({ page }) => {
  await openScreenplay(page, [
    { element: 'scene', text: 'INT. CAFE - NIGHT' },
    { element: 'character', text: 'MINSU' },
    { element: 'dialogue', text: 'Two coffees.' },
  ]);
  const picker = page.locator('.doc-card-modal .doc-tb-select--sp');
  await caretAt(page, 'MINSU', 2);
  await expect(picker).toHaveValue('character');
  await caretAt(page, 'Two coffees.', 2);
  await expect(picker).toHaveValue('dialogue');
  await caretAt(page, 'CAFE', 2);
  await expect(picker).toHaveValue('scene');
});

test('typing on a page leaves the page breaks below it where they are', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.editor = null;
    T.setPageless(T.ydoc, T.getScope(), false);
  });
  await page.locator('.doc-card-modal .doc-pages-bg').waitFor({ timeout: 8000 });
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  // Short lines, so the typing below never wraps one and nothing reflows.
  await page.evaluate(() => {
    const lines = Array.from({ length: 160 }, (_, i) => `<p>Line ${i + 1}.</p>`).join('');
    window.__soleilDocTest.editor.commands.setContent(lines);
  });
  const gaps = page.locator('.doc-card-modal .doc-page-gap');
  await expect.poll(() => gaps.count(), { timeout: 10000 }).toBeGreaterThan(2);
  await page.waitForTimeout(500);
  const before = await gaps.count();
  await page.evaluate(() => { window.__soleilGaps = [...document.querySelectorAll('.doc-card-modal .doc-page-gap')]; });
  await caretAt(page, 'Line 10.', 7);
  await page.keyboard.type(' ok', { delay: 40 });
  await page.waitForTimeout(400);
  expect(await gaps.count()).toBe(before);
  // The same elements, still in the page: none was torn down and rebuilt.
  expect(await page.evaluate(() => window.__soleilGaps.filter((g) => !g.isConnected).length)).toBe(0);
});
