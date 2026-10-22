// Screenplay / Pages switches in the ?docqa=1 harness: Screenplay off → on is
// lossless, and a collaborator's flip doesn't throw my caret out of the editor.
// A "collaborator" here is a write to the doc's Y state from outside the UI —
// the same meta observer path a peer's update takes.

import { expect, test } from '@playwright/test';
import { setScreenplay } from './helpers/docFrame.js';

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await expect(page.locator('.tt-editor').first()).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const liveBlocks = (page) => page.evaluate(() =>
  window.__soleilDocTest.screenplay.docJSONToBlocks(window.__soleilDocTest.editor.getJSON()));

test('Screenplay off then on keeps every element type', async ({ page }) => {
  await openDoc(page);
  await setScreenplay(page.locator('.doc-card-modal'), true);
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();
  await page.waitForFunction(() =>
    window.__soleilDocTest.editor?.state?.doc?.firstChild?.type?.name === 'screenplayBlock', null, { timeout: 10000 });
  const script = [
    { element: 'scene', text: 'INT. ROOM - DAY' },
    { element: 'action', text: 'They face off.' },
    { element: 'character', text: 'JOHN' },
    { element: 'parenthetical', text: '(beat)' },
    { element: 'dialogue', text: 'Hello there.' },
    { element: 'transition', text: 'CUT TO:' },
  ];
  await page.evaluate((blocks) => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON(blocks));
  }, script);
  await expect.poll(() => liveBlocks(page)).toEqual(script);

  await setScreenplay(page.locator('.doc-card-modal'), false);
  await expect(page.locator('.doc-paper.is-screenplay')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() =>
    (window.__soleilDocTest.editor.getJSON().content || []).map(n => n.type),
  )).toEqual(Array(script.length).fill('paragraph'));

  await setScreenplay(page.locator('.doc-card-modal'), true);
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();
  await expect.poll(() => liveBlocks(page)).toEqual(script);
});

test('a collaborator flipping Pages or Screenplay leaves my caret where I was typing', async ({ page }) => {
  await openDoc(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  await page.keyboard.type('Hello world');
  // Caret right after "Hello".
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setTextSelection(6));

  // The peer turns on Pages.
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.setPageless(T.ydoc, T.getScope(), false);
  });
  await expect(page.locator('.doc-paper.is-pageless')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList?.contains('tt-editor'))).toBe(true);
  await page.keyboard.type(',');

  // The peer turns on Screenplay.
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.switchDocMode(T.ydoc, T.getScope(), 'screenplay');
  });
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList?.contains('tt-editor'))).toBe(true);
  await page.keyboard.type(' big');

  await expect.poll(() => page.evaluate(() => window.__soleilDocTest.editor.state.doc.textContent))
    .toBe('Hello, big world');
});
