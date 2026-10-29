// The share ask's timing, driven through the REAL signed-in app.
//
// ?local=1 renders LocalBoardsApp, which never mounts Workspace — and the ask
// (the shareAskBaseRef effect and the soleil:share-ask listener) lives in
// Workspace, so the local harness cannot reach it. These specs boot the real
// app with every Supabase call stubbed instead (helpers/signedInStub.js).
// share-ambient.spec.js pins the same wiring as source checks; this runs it.
//
// The ask is "This cluster is looking good — send it to someone?" and it is for
// a cluster that JUST reached 10 genuine cards in front of the person: App
// remembers each cluster's count the first time it loads on the page, and one
// that opened below 10 and has since reached it is asked about, one that
// opened at 10 or more never is.
import { expect, test } from '@playwright/test';
import * as Y from 'yjs';
import { bytesToB64, cardToYMap } from '../src/lib/yhelpers.js';
import { bootSignedIn, ROOT_ID } from './helpers/signedInStub.js';

const ASK = 'This cluster is looking good — send it to someone?';
// The toast's own text; a screen-reader live region repeats it off screen.
const askToast = (page) => page.locator('.toast-msg', { hasText: ASK });
const cardCount = (page) => page.locator('.card[data-card-id]').count();

// The one-shot feature tips ("Notes can grow into full docs", …) are ambient
// toasts that claim the shared upsell slot for a minute. The third note raises
// the docs tip, and a spec adding ten notes in seconds would find the ask
// refused by that minute, not by anything this spec is about. A person who has
// already seen the tips is the same case, so mark them seen up front.
const seeTipsAlready = (page) => page.addInitScript(() => {
  try {
    for (const k of ['grids', 'list_drive', 'docs', 'palette']) localStorage.setItem(`soleil.reveal.${k}`, '1');
  } catch (_) {}
});

// A saved board of `n` notes, as board_state holds it: a Y.Doc with a card map.
function savedBoard(n) {
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  for (let i = 0; i < n; i++) {
    const id = `saved-note-${i + 1}`;
    cards.set(id, cardToYMap({
      id, kind: 'note', x: 420 + (i % 3) * 150, y: 120 + Math.floor(i / 3) * 130,
      w: 140, h: 100, title: `saved note ${i + 1}`, text: `saved note ${i + 1}`,
    }));
  }
  return bytesToB64(Y.encodeStateAsUpdate(doc));
}

// `saved`: a board_state doc the stubbed backend already holds for the root
// cluster, so it opens with those cards. Without it every read is "no rows"
// and the cluster opens blank.
async function boot(page, { saved = null } = {}) {
  await seeTipsAlready(page);
  await bootSignedIn(page, {
    rest: saved ? {
      // boardStateQuery uses maybeSingle(): one object, not an array.
      board_state: (url, method) => (method === 'GET' ? { doc: saved } : []),
    } : {},
  });
  await page.waitForSelector('.sb-ws-trigger', { timeout: 30000 });
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add note tool', exact: true })).toBeVisible();
  // Toasts stack over the top right of the canvas and would swallow a click
  // there; they stay in the DOM, so the assertions below still see them.
  await page.addStyleTag({ content: '.toast-stack,.toast-stack *{pointer-events:none!important}' });
}

// One note with text in it, placed on bare canvas. The first goes low and
// right, clear of the empty cluster's "Start your storyboard" panel, and the
// rest fill a grid left of the toast stack. `already` is how many cards the
// cluster held before this one.
async function addNote(page, i, already = i) {
  const at = i === 0
    ? { x: 900, y: 650 }
    : { x: 420 + ((i - 1) % 3) * 150, y: 120 + Math.floor((i - 1) / 3) * 130 };
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: at });
  await page.locator('.note-body[contenteditable="true"]').last().click();
  await page.keyboard.type(`note ${i + 1}`);
  // Leave the note by clicking bare canvas, where no card sits.
  await page.locator('.canvas-wrap').click({ position: { x: 400, y: 700 } });
  await expect.poll(() => cardCount(page)).toBe(already + 1);
}

test('a blank cluster is asked about when its 10th card lands, not before', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.card[data-card-id]')).toHaveCount(0);

  for (let i = 0; i < 9; i++) {
    await addNote(page, i);
    await expect(askToast(page)).toHaveCount(0);
  }
  // Nine cards, and long enough for an ask to have shown if it were going to.
  await page.waitForTimeout(1500);
  await expect(askToast(page)).toHaveCount(0);

  await addNote(page, 9);
  await expect(askToast(page)).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
});

test('a cluster that opens past 10 cards is not asked about when it grows', async ({ page }) => {
  // Twelve saved cards, there from the first paint. Nothing else is stamped
  // (a fresh browser: no per-cluster or weekly ask stamp, tips already seen),
  // so the only thing between this cluster and the ask is that it opened big.
  await boot(page, { saved: savedBoard(12) });
  await expect.poll(() => cardCount(page), { timeout: 15000 }).toBe(12);
  expect(await page.evaluate((id) => localStorage.getItem(`soleil.shareask.${id}`), ROOT_ID)).toBeNull();

  await addNote(page, 12, 12);
  await addNote(page, 13, 13);
  await page.waitForTimeout(3000);
  await expect(askToast(page)).toHaveCount(0);
});
