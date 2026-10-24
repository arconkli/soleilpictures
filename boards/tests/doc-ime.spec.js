// Korean typing, proven. A Korean syllable is built by the IME jamo by jamo
// (ㅎ, 하, 한) and only lands when the IME commits it, so every key a doc acts
// on must leave a syllable still being composed alone. Chromium's own IME path
// is driven over CDP (Input.imeSetComposition, then Input.insertText to
// commit), and Enter is pressed the way Chrome on macOS delivers it with a
// syllable still in the IME: a keydown with isComposing and keyCode 229, then
// the IME commits the syllable. A real Enter after that is the user's next one.
import { expect, test } from '@playwright/test';
import { setScreenplay, setTitlePage, todaysLook } from './helpers/docFrame.js';
import { korean } from './imeHelpers.js';

test.skip(({ browserName }) => browserName !== 'chromium', 'CDP drives Chromium\'s IME');

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 15000 });
}

// Every text block of the open doc, as [element or node type, text].
const blocks = (page) => page.evaluate(() => {
  const out = [];
  window.__soleilDocTest.editor.state.doc.descendants((n) => {
    if (!n.isTextblock) return true;
    out.push([n.attrs?.element || n.type.name, n.textContent]);
    return false;
  });
  return out;
});
const bodyText = (page) => page.evaluate(() => window.__soleilDocTest.editor.state.doc.textContent);

test('prose: Korean lands whole, and Enter mid-syllable leaves the line to the next Enter', async ({ page }) => {
  await openDoc(page);
  await page.locator('.doc-card-modal .tt-editor').first().click();
  const ko = await korean(page);
  await ko.typeThenEnterMidSyllable('한글 문서');
  expect(await blocks(page)).toEqual([['paragraph', '한글 문서']]);
  await page.keyboard.press('Enter');
  await ko.type('둘째 줄');
  expect(await blocks(page)).toEqual([['paragraph', '한글 문서'], ['paragraph', '둘째 줄']]);
});

test('a screenplay: Korean scene, action, a cast name with its autocomplete open, and dialogue', async ({ page }) => {
  await openDoc(page);
  await setScreenplay(page.locator('.doc-card-modal'), true);
  await page.waitForFunction(() => window.__soleilDocTest.editor?.state?.doc?.firstChild?.type?.name === 'screenplayBlock',
    null, { timeout: 15000 });
  // A scene in which 민수 already speaks, so his name is offered on a new cue.
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.editor.commands.setContent(T.screenplay.blocksToDocJSON([
      { element: 'scene', text: '실내. 카페 - 밤' },
      { element: 'action', text: '민수가 들어온다.' },
      { element: 'character', text: '민수' },
      { element: 'dialogue', text: '커피 두 잔.' },
      { element: 'character', text: '' },
    ]));
    T.editor.commands.focus('end');
  });
  const ko = await korean(page);
  await ko.typeThenEnterMidSyllable('민수');
  expect((await blocks(page)).slice(-1)).toEqual([['character', '민수']]);
  // Enter takes the name (the autocomplete may have it), then moves on.
  for (let i = 0; i < 2 && (await blocks(page)).at(-1)[0] === 'character'; i++) await page.keyboard.press('Enter');
  await ko.type('안녕하세요');
  expect((await blocks(page)).slice(-2)).toEqual([['character', '민수'], ['dialogue', '안녕하세요']]);
  expect(await bodyText(page)).toBe('실내. 카페 - 밤민수가 들어온다.민수커피 두 잔.민수안녕하세요');
});

test('a screenplay\'s title page: Enter mid-syllable leaves the title to the IME, the next Enter sets it', async ({ page }) => {
  await openDoc(page);
  await setScreenplay(page.locator('.doc-card-modal'), true);
  await setTitlePage(page.locator('.doc-card-modal'), true);
  const field = page.locator('.doc-card-modal .sp-title-page .sp-tp-title');
  await field.click();
  const before = await bodyText(page);
  const ko = await korean(page);
  await ko.typeThenEnterMidSyllable('봄날');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('봄날');
  await page.keyboard.press('Enter');
  await expect(field).not.toBeFocused();
  await expect(field).toHaveValue('봄날');
  expect(await bodyText(page)).toBe(before);
});

test('find: Enter mid-syllable doesn\'t jump; the next Enter goes to the next match', async ({ page }) => {
  // Today's find bar. The look's Find takes Korean in doc-panel-find.spec.js.
  await todaysLook(page);
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setContent('<p>한글 문서, 한글 노트, 한글 대본</p>'));
  await page.locator('.doc-card-modal .tt-editor').first().click();
  await page.keyboard.press('ControlOrMeta+f');
  const input = page.locator('.doc-card-modal .doc-find-input').first();
  await expect(input).toBeFocused();
  const count = page.locator('.doc-card-modal .doc-find-count');
  const ko = await korean(page);
  await ko.typeThenEnterMidSyllable('한글');
  await expect(input).toHaveValue('한글');
  await expect(count).toHaveText('1/3');
  await page.keyboard.press('Enter');
  await expect(count).toHaveText('2/3');
});

test('renaming a page in Korean: Enter mid-syllable keeps it open, the next Enter names it, nothing spills', async ({ page }) => {
  await openDoc(page);
  const before = await bodyText(page);
  await page.locator('.doc-card-modal .doc-tree-name').first().dblclick();
  const input = page.locator('.doc-card-modal .doc-tree-rename');
  await expect(input).toBeFocused();
  const ko = await korean(page);
  await ko.typeThenEnterMidSyllable('첫 장면');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('첫 장면');
  await page.keyboard.press('Enter');
  await expect(page.locator('.doc-card-modal .doc-tree-name').first()).toHaveText('첫 장면');
  expect(await page.evaluate(() => {
    const T = window.__soleilDocTest;
    return T.readPages(T.ydoc, T.getScope())[0].name;
  })).toBe('첫 장면');
  expect(await bodyText(page)).toBe(before);
});

test('naming the card on the canvas in Korean: Enter mid-syllable keeps it open, the next Enter names it once', async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  const title = page.locator('.docqa-card-wrap .doc-card-title');
  await title.dblclick();
  await expect(title).toHaveClass(/is-editing/);
  await page.keyboard.press('ControlOrMeta+a');
  const ko = await korean(page);
  await ko.typeThenEnterMidSyllable('시나리오');
  await expect(title).toHaveClass(/is-editing/);
  await expect(title).toHaveText('시나리오');
  await page.keyboard.press('Enter');
  await expect(title).not.toHaveClass(/is-editing/);
  await expect(title).toHaveText('시나리오');
});

test('the title in the open doc\'s header takes Korean whole', async ({ page }) => {
  await openDoc(page);
  const input = page.locator('.doc-card-modal .doc-card-title-input');
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  const ko = await korean(page);
  await ko.type('단편 영화');
  await expect(input).toHaveValue('단편 영화');
  await expect(page.locator('.docqa-card-wrap .doc-card-title')).toHaveText('단편 영화');
});

test('a page break: Korean typed right where the next page begins lands once, where it was typed', async ({ page }) => {
  await openDoc(page);
  // Pages are opt-in: turn them on, and wait for the editor they remount.
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.editor = null;
    T.setPageless(T.ydoc, T.getScope(), false);
  });
  await page.locator('.doc-card-modal .doc-pages-bg').waitFor({ timeout: 8000 });
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await page.evaluate(() => {
    const big = '바람이 분다. 우리는 살아야 한다. '.repeat(260);
    window.__soleilDocTest.editor.chain().focus().setContent(`<p>${big}</p>`).run();
  });
  const gap = page.locator('.doc-card-modal .doc-page-gap').first();
  await expect(gap).toBeAttached({ timeout: 10000 });
  // The caret at the first character of the next page, just past the gap.
  const at = await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    const g = document.querySelector('.doc-card-modal .doc-page-gap');
    const pos = ed.view.posAtDOM(g, 0);
    ed.commands.setTextSelection(pos);
    ed.commands.focus();
    return pos;
  });
  const before = await bodyText(page);
  const ko = await korean(page);
  await ko.type('새벽');
  const after = await bodyText(page);
  expect(after.length).toBe(before.length + 2);
  expect(after.split('새벽').length - 1).toBe(1);
  expect(await page.evaluate((p) => window.__soleilDocTest.editor.state.doc.textBetween(p, p + 2), at)).toBe('새벽');
});
