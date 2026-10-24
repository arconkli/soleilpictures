// A doc narrower than a page, on any screen: docked beside the board, or one of
// two side by side (?docqa=1&panes=1, the real DockedDocPane in App's split
// chain). A script keeps the page's wrap column, the one the paginator and the
// PDF count on, and fits it to the pane; prose takes the narrow margins; the
// page list tucks away to its toggle, which brings it back for as long as the
// doc stays narrow and stores nothing. A wide doc is as it always was.
import { expect, test } from '@playwright/test';
import { dockFromCard, setScreenplay } from './helpers/docFrame.js';
import { wrapLines } from '../src/lib/screenplayPaginate.js';
import { elementWidth } from '../src/lib/screenplayMetrics.js';

const ACTION = 'The jukebox plays to nobody. MARA (30s) counts change on the counter, coin by coin, and the line runs long.';
const DIALOGUE = 'Two coffees. And whatever he was having, if he ever comes back for it.';
const RAILS_KEY = 'soleil.boards.docRails';

const DESK = { width: 1440, height: 900 };   // one docked doc: ~720px pane
const IPAD = { width: 1180, height: 820 };   // two docs side by side: ~590px each

async function open(page, size) {
  await page.setViewportSize(size);
  await page.goto('/?docqa=1&panes=1');
  await page.waitForSelector('[data-docqa-panes-ready]');
}
const card = (page, id) => page.locator(`[data-docqa-card="${id}"] .doc-card`);
const pane = (page, which) => page.locator(`[data-doc-pane="${which}"]`);

async function dock(page, id) {
  await dockFromCard(card(page, id));
  await expect(pane(page, 'split').locator('.doc-paper')).toBeVisible();
}
// On the page's corner: an empty doc's middle is the look's Start writing.
async function besideIt(page, id) {
  await card(page, id).locator('.doc-card-page').dblclick({ position: { x: 12, y: 12 } });
  await expect(pane(page, 'beside').locator('.doc-paper')).toBeVisible();
}

// Turn the doc in `which` pane into a short script, through its own editor.
async function makeScript(page, which) {
  await setScreenplay(pane(page, which), true);
  const sel = `[data-doc-pane="${which}"] .ProseMirror`;
  await page.waitForFunction((s) => document.querySelector(s)?.editor?.state?.doc?.firstChild?.type?.name === 'screenplayBlock',
    sel, { timeout: 15000 });
  await page.evaluate(({ s, action, dialogue }) => {
    const S = window.__soleilDocTest.screenplay;
    document.querySelector(s).editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. DINER - NIGHT' },
      { element: 'action', text: action },
      { element: 'character', text: 'MARA' },
      { element: 'dialogue', text: dialogue },
    ]));
  }, { s: sel, action: ACTION, dialogue: DIALOGUE });
  await expect(pane(page, which).locator('[data-screenplay-element="dialogue"]')).toHaveText(DIALOGUE);
}

// How the script lies in its pane: lines per element at the applied zoom (one
// --sp-line is 16px at 100%), and whether the action column is all on screen.
function scriptLayout(page, which) {
  return page.evaluate((w) => {
    const paper = document.querySelector(`[data-doc-pane="${w}"] .doc-paper`);
    const zoom = parseFloat(paper.style.getPropertyValue('--doc-zoom')) || 1;
    const lines = (el) => Math.round(el.getBoundingClientRect().height / (16 * zoom));
    const act = paper.querySelector('[data-screenplay-element="action"]');
    const dlg = paper.querySelector('[data-screenplay-element="dialogue"]');
    const p = paper.getBoundingClientRect();
    const a = act.getBoundingClientRect();
    const right = p.left + paper.clientLeft + paper.clientWidth;
    return {
      zoom,
      fit: paper.classList.contains('is-fit-width'),
      actionLines: lines(act),
      dialogueLines: lines(dlg),
      onScreen: a.left >= p.left - 0.5 && a.right <= right + 0.5,
    };
  }, which);
}
const pageLines = {
  action: wrapLines(ACTION, elementWidth('action')).length,
  dialogue: wrapLines(DIALOGUE, elementWidth('dialogue')).length,
};

test('a docked script in a narrow pane keeps the page\'s wrap column and fits it on screen', async ({ page }) => {
  await open(page, DESK);
  await dock(page, 'doc-b');
  await makeScript(page, 'split');
  await expect.poll(() => scriptLayout(page, 'split')).toMatchObject({
    fit: true, actionLines: pageLines.action, dialogueLines: pageLines.dialogue, onScreen: true,
  });
});

test('two docs side by side on a tablet-wide window: the script beside fits its column too', async ({ page }) => {
  await open(page, IPAD);
  await dock(page, 'doc-a');
  await besideIt(page, 'doc-b');
  await makeScript(page, 'beside');
  await expect.poll(() => scriptLayout(page, 'beside')).toMatchObject({
    fit: true, actionLines: pageLines.action, dialogueLines: pageLines.dialogue, onScreen: true,
  });
});

test('zooming a script by hand in a narrow pane pans the page; it never squeezes the column', async ({ page }) => {
  await open(page, DESK);
  await dock(page, 'doc-b');
  await makeScript(page, 'split');
  await expect.poll(() => scriptLayout(page, 'split')).toMatchObject({ fit: true });
  await pane(page, 'split').locator('[data-screenplay-element="action"]').click();
  await page.keyboard.press('ControlOrMeta+Equal');
  await expect.poll(() => scriptLayout(page, 'split')).toMatchObject({
    fit: false, actionLines: pageLines.action, dialogueLines: pageLines.dialogue,
  });
});

test('prose in a narrow pane takes the narrow margins', async ({ page }) => {
  await open(page, DESK);
  await dock(page, 'doc-a');
  const padLeft = () => pane(page, 'split').locator('.doc-editor-wrap').first()
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  await expect.poll(padLeft).toBeLessThanOrEqual(56);
  // Two side by side on a tablet-wide window: the phone's.
  await page.setViewportSize(IPAD);
  await besideIt(page, 'doc-b');
  await expect.poll(padLeft).toBeLessThanOrEqual(28);
});

test('the page list tucks away in a narrow pane, and its toggle brings it back without storing anything', async ({ page }) => {
  await open(page, DESK);
  const stored = () => page.evaluate((k) => localStorage.getItem(k), RAILS_KEY);
  await dock(page, 'doc-a');
  const surface = pane(page, 'split').locator('.doc-surface');
  await expect(surface).toHaveClass(/rail-left-collapsed/);
  // How the list opens wherever there is room: open, as it was.
  const before = await stored();
  expect(JSON.parse(before)).toMatchObject({ left: true });
  await pane(page, 'split').getByRole('button', { name: 'Show pages' }).click();
  await expect(surface).not.toHaveClass(/rail-left-collapsed/);
  await expect(pane(page, 'split').locator('.doc-rail-left')).toBeVisible();
  await pane(page, 'split').getByRole('button', { name: 'Hide pages' }).click();
  await expect(surface).toHaveClass(/rail-left-collapsed/);
  expect(await stored()).toBe(before);
});

test('a script with room for its page is as it always was: actual size, the list open', async ({ page }) => {
  await open(page, DESK);
  await card(page, 'doc-b').locator('.doc-card-page').dblclick({ position: { x: 12, y: 12 } });
  const full = page.locator('.doc-card-modal-full');
  await expect(full).toBeVisible();
  await setScreenplay(full, true);
  await page.waitForFunction(() => document.querySelector('.doc-card-modal-full .ProseMirror')?.editor?.state?.doc?.firstChild?.type?.name === 'screenplayBlock',
    null, { timeout: 15000 });
  const layout = await page.evaluate(() => {
    const paper = document.querySelector('.doc-card-modal-full .doc-paper');
    const wrap = paper.querySelector('.doc-editor-wrap:not(.sp-title-page)');
    return {
      fit: paper.classList.contains('is-fit-width'),
      zoom: parseFloat(paper.style.getPropertyValue('--doc-zoom')) || 1,
      wrapWidth: Math.round(wrap.getBoundingClientRect().width),
      railCollapsed: !!paper.closest('.doc-surface')?.classList.contains('rail-left-collapsed'),
    };
  });
  expect(layout).toEqual({ fit: false, zoom: 1, wrapWidth: 816, railCollapsed: false });
});
