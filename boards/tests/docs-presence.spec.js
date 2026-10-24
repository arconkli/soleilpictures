import { expect, test } from '@playwright/test';
import { zoomIn } from './helpers/docFrame.js';

// Doc presence: a peer's caret is a DOCUMENT position, resolved against this
// tab's own layout (DOCS-10), and the overlay is quiet when nothing moves
// (PERF-07). Peers are simulated through the doc QA harness's real Awareness
// (?docqa=1&presence=1, setPeer()).

async function openDoc(page) {
  await page.goto('/?docqa=1&presence=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const PEER_USER = { id: 'peer-1', name: 'Pat Peer', color: '#3fa39a' };

// Put a peer's caret at the start of `word`, with legacy pixel fields that are
// deliberately wrong so a pixel-based render would miss.
async function peerCaretAt(page, word, user = PEER_USER, name = 'pat') {
  return page.evaluate(({ word, user, name }) => {
    const T = window.__soleilDocTest;
    const ed = T.editor;
    let pos = null;
    ed.state.doc.descendants((n, p) => {
      if (pos == null && n.isText && n.text.includes(word)) pos = p + n.text.indexOf(word);
    });
    const scope = T.getScope();
    const pageId = (T.readPages(T.ydoc, scope)[0] || {}).id;
    T.setPeer(name, {
      user,
      docCaret: { boardId: 'docqa-card', pageId, x: 5, y: 5, head: T.encodeAnchor(ed, pos) },
    });
    return pos;
  }, { word, user, name });
}

async function expectCaretOn(page, pos) {
  await expect.poll(async () => page.evaluate((pos) => {
    const el = document.querySelector('.doc-peer-caret');
    if (!el) return 'no caret';
    const T = window.__soleilDocTest;
    const c = T.editor.view.coordsAtPos(pos);
    const r = el.getBoundingClientRect();
    return Math.abs(r.left - c.left) <= 3 && Math.abs(r.top - c.top) <= 3 ? 'on' : `off by ${Math.round(r.left - c.left)},${Math.round(r.top - c.top)}`;
  }, pos), { timeout: 5000 }).toBe('on');
}

test('DOCS-10: a peer caret lands on the same word at any local zoom', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    window.__soleilDocTest.editor.commands.setContent('<p>Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike.</p><p>Second paragraph with target word here.</p>');
  });
  const pos = await peerCaretAt(page, 'target');
  await expectCaretOn(page, pos);
  // Zoom in locally: the caret must follow the text, not stay at peer pixels.
  await zoomIn(page.locator('.doc-card-modal'), 3);
  await expectCaretOn(page, pos);
});

test('DOCS-10: typing above a peer caret moves it with the text', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    window.__soleilDocTest.editor.commands.setContent('<p>First line.</p><p>Second line with target here.</p>');
  });
  const pos = await peerCaretAt(page, 'target');
  await expectCaretOn(page, pos);
  await page.evaluate(() => window.__soleilDocTest.editor.commands.insertContentAt(1, '<p>An inserted paragraph above.</p>'));
  const moved = await page.evaluate(() => {
    let pos = null;
    window.__soleilDocTest.editor.state.doc.descendants((n, p) => {
      if (pos == null && n.isText && n.text.includes('target')) pos = p + n.text.indexOf('target');
    });
    return pos;
  });
  await expectCaretOn(page, moved);
});

test('PERF-07: an idle peer caret settles at the quiet opacity', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    window.__soleilDocTest.editor.commands.setContent('<p>Some target text.</p>');
  });
  await peerCaretAt(page, 'target');
  const caret = page.locator('.doc-peer-caret');
  await expect(caret).toHaveCount(1);
  await expect(caret).toHaveClass(/doc-peer-caret--typing/);
  // Typing window (1.5 s) closes → one re-render → eases to the idle level.
  await expect(caret).not.toHaveClass(/doc-peer-caret--typing/, { timeout: 4000 });
  await expect.poll(() => caret.evaluate(el => Number(getComputedStyle(el).opacity)), { timeout: 6000 }).toBeLessThan(0.6);
});

test('PERF-07: two peers whose typing windows overlap both settle', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    window.__soleilDocTest.editor.commands.setContent('<p>Some target text and another word.</p>');
  });
  await peerCaretAt(page, 'target');
  // The second peer stops typing well inside the first one's window, so only
  // the first boundary is armed when the timer is scheduled from `peers`.
  await page.waitForTimeout(600);
  await peerCaretAt(page, 'another', { id: 'peer-2', name: 'Quinn Peer', color: '#a35b3f' }, 'quinn');
  const carets = page.locator('.doc-peer-caret');
  await expect(carets).toHaveCount(2);
  await expect(page.locator('.doc-peer-caret--typing')).toHaveCount(0, { timeout: 5000 });
});
