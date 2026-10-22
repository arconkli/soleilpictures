// Typing in a long doc lands on screen within two frames. For each key: from
// the keydown's own timestamp to just after the next frame (a rAF, then a
// message posted from it, which runs once that frame is drawn), over 40 keys
// typed mid-document at a fast typist's pace; the 95th percentile must stay
// under the budget. A 40-page prose doc (continuous, then in pages) and a
// 120-page screenplay, on the dev build, so React's own dev checks are in the
// numbers too.
//
// This is the backstop. doc-typing.spec.js and lib/docDecorationPlugins.test
// pin the work itself: what redraws on a key, and what a key makes the
// decorations read again.
import { expect, test } from '@playwright/test';
import { setScreenplay } from './helpers/docFrame.js';

test.skip(({ browserName }) => browserName !== 'chromium', 'timed on Chromium');

const BUDGET_MS = 34; // two frames at 60Hz
const KEYS = 'and then the kettle stops all at once';

const WORDS = ('the light falls across her desk while rain keeps time on the glass and somewhere below a door '
  + 'opens then closes again she writes another line crosses it out and begins once more').split(' ');
function para(i, n) {
  const w = Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length]);
  return `${w.join(' ')}.`;
}
// About 500 words a page.
const PROSE_40_PAGES = Array.from({ length: 200 }, (_, i) =>
  `${i % 10 === 0 ? `<h2>Part ${i / 10 + 1}</h2>` : ''}<p>${para(i, 100)}</p>`).join('');

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 15000 });
}

async function pagesOn(page) {
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.editor = null;
    T.setPageless(T.ydoc, T.getScope(), false);
  });
  await page.locator('.doc-card-modal .doc-pages-bg').waitFor({ timeout: 8000 });
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

async function screenplayOn(page) {
  await setScreenplay(page.locator('.doc-card-modal'), true);
  await page.waitForFunction(() => window.__soleilDocTest.editor?.state?.doc?.firstChild?.type?.name === 'screenplayBlock',
    null, { timeout: 15000 });
}

// 300 scenes of about ten blocks: some 120 pages.
const loadScreenplay = (page) => page.evaluate(() => {
  const T = window.__soleilDocTest;
  const cast = ['MINSU', 'JIHYE', 'OLD MAN', 'DETECTIVE PARK'];
  const blocks = [];
  for (let s = 0; s < 300; s++) {
    blocks.push({ element: 'scene', text: `${s % 2 ? 'EXT.' : 'INT.'} LOCATION ${s + 1} - ${s % 3 ? 'DAY' : 'NIGHT'}` });
    blocks.push({ element: 'action', text: 'Rain on the window. A kettle starts to whistle in the next room, and nobody moves to stop it for a long moment.' });
    for (let d = 0; d < 3; d++) {
      blocks.push({ element: 'character', text: cast[(s + d) % cast.length] });
      if (d === 1) blocks.push({ element: 'parenthetical', text: '(quietly)' });
      blocks.push({ element: 'dialogue', text: 'I told you we would be late, and you said it did not matter, so here we are.' });
    }
    blocks.push({ element: 'action', text: 'She turns away.' });
  }
  T.editor.commands.setContent(T.screenplay.blocksToDocJSON(blocks));
});

// The caret halfway down, inside a block with text either side of it.
const caretMidDoc = (page) => page.evaluate(() => {
  const ed = window.__soleilDocTest.editor;
  const doc = ed.state.doc;
  const half = doc.content.size / 2;
  let at = null;
  doc.descendants((n, pos) => {
    if (at != null) return false;
    if (n.isTextblock && pos >= half && n.content.size > 20) { at = pos + 1 + Math.floor(n.content.size / 2); return false; }
    return true;
  });
  ed.chain().focus().setTextSelection(at).scrollIntoView().run();
});

async function p95KeyToFrame(page) {
  await page.waitForTimeout(1500); // let pagination and the first measures settle
  await page.evaluate(() => {
    window.__soleilKeyLat = [];
    document.addEventListener('keydown', (e) => {
      const t0 = e.timeStamp;
      requestAnimationFrame(() => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => window.__soleilKeyLat.push(performance.now() - t0);
        ch.port2.postMessage(0);
      });
    }, true);
  });
  for (let i = 0; i < KEYS.length; i++) {
    await page.keyboard.press(KEYS[i] === ' ' ? 'Space' : KEYS[i]);
    await page.waitForFunction((n) => window.__soleilKeyLat.length >= n, i + 1);
    await page.waitForTimeout(40);
  }
  const lat = (await page.evaluate(() => window.__soleilKeyLat)).sort((a, b) => a - b);
  return lat[Math.floor(lat.length * 0.95)];
}

test('a 40-page doc takes each key within two frames', async ({ page }) => {
  await openDoc(page);
  await page.evaluate((h) => window.__soleilDocTest.editor.commands.setContent(h), PROSE_40_PAGES);
  await caretMidDoc(page);
  const p95 = await p95KeyToFrame(page);
  test.info().annotations.push({ type: 'p95 ms', description: p95.toFixed(1) });
  expect(p95).toBeLessThan(BUDGET_MS);
});

test('the same doc in pages takes each key within two frames', async ({ page }) => {
  await openDoc(page);
  await pagesOn(page);
  await page.evaluate((h) => window.__soleilDocTest.editor.commands.setContent(h), PROSE_40_PAGES);
  await expect.poll(() => page.locator('.doc-card-modal .doc-page-sheet').count(), { timeout: 10000 }).toBeGreaterThan(35);
  await caretMidDoc(page);
  const p95 = await p95KeyToFrame(page);
  test.info().annotations.push({ type: 'p95 ms', description: p95.toFixed(1) });
  expect(p95).toBeLessThan(BUDGET_MS);
});

test('a 120-page screenplay takes each key within two frames', async ({ page }) => {
  await openDoc(page);
  await screenplayOn(page);
  await loadScreenplay(page);
  await expect.poll(() => page.locator('.doc-card-modal .sp-page-break').count(), { timeout: 10000 }).toBeGreaterThan(110);
  await caretMidDoc(page);
  const p95 = await p95KeyToFrame(page);
  test.info().annotations.push({ type: 'p95 ms', description: p95.toFixed(1) });
  expect(p95).toBeLessThan(BUDGET_MS);
});
