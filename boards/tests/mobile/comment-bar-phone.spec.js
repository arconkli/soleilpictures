// A comment on a phone is written in a sheet on top of the keyboard.
//
// A new comment used to open on the canvas beside its card, inside the
// canvas's zoom: at a phone's opening zoom it was a few px tall and could
// open past the screen's edge. On a phone and an upright iPad it is the
// comment sheet (.cmt-sheet-host, comments/CanvasCommentCard.jsx): across the
// foot of the screen, out of the canvas's zoom, riding the top of the
// keyboard. The posted comment still lands on the card it was made for. And
// nothing a finger reads names a key: no "Enter to post · Esc to cancel", no
// Cmd+Z in the delete question.

import { expect, test } from '@playwright/test';
import { bootSignedIn, USER_ID, WS_ID, ROOT_ID } from '../helpers/signedInStub.js';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'the phone shell');
});

const card = (page, id) => page.locator(`[data-card-id="${id}"]`);
const menu = (page) => page.locator('.ctx-menu');
const bar = (page) => page.locator('.cmt-sheet-host');
const field = (page) => bar(page).locator('textarea.cmt-input');
const send = (page) => bar(page).locator('.cmt-send');
const close = (page) => bar(page).getByRole('button', { name: 'Close', exact: true });

async function bootLocal(page) {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  // What only the dev harness draws, over the corner a menu opens in.
  await page.addStyleTag({ content: '.twk-gear { display: none !important; }' });
  await expect(card(page, 'home-image')).toBeVisible({ timeout: 30000 });
}

// A card's menu, the way a finger gets it: tap the card, then its ⋯.
async function openCardMenu(page, locator) {
  const b = await locator.boundingBox();
  // Its foot: a note's middle is its text.
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height - 6);
  const more = page.locator('.sel-menu .card-menu-btn');
  await expect(more).toBeVisible();
  await more.tap();
  await expect(menu(page)).toBeVisible();
}

async function addComment(page, locator) {
  await openCardMenu(page, locator);
  await menu(page).getByRole('menuitem', { name: 'Add comment', exact: true }).tap();
  await expect(bar(page)).toBeVisible();
}

// A keyboard `h` px tall: the visual viewport gives up its foot, the way iOS
// and Android report one, and says so.
async function stubKeyboard(page, h) {
  await page.evaluate((kb) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - kb });
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
    vv.dispatchEvent(new Event('resize'));
  }, h);
}

test('Add comment opens a sheet across the screen with finger-sized buttons', async ({ page }) => {
  await bootLocal(page);
  await addComment(page, card(page, 'home-image'));

  const vw = page.viewportSize().width;
  const sheetCard = bar(page).locator('.cmt-card--sheet');
  await expect(sheetCard).toBeVisible();
  const b = await sheetCard.boundingBox();
  expect(Math.abs(b.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(b.width - vw)).toBeLessThanOrEqual(0.5);
  expect(b.y + b.height).toBeLessThanOrEqual(page.viewportSize().height + 0.5);
  // Out of the canvas's zoom, and no box is drawn on the canvas too.
  expect(await bar(page).evaluate((el) => el.parentElement === document.body)).toBe(true);
  await expect(page.locator('.cmt-canvas-card')).toHaveCount(0);

  const input = field(page);
  await expect(input).toBeFocused();
  expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  // The keyboard's own key says Send.
  await expect(input).toHaveAttribute('enterkeyhint', 'send');

  const cb = await close(page).boundingBox();
  expect(cb.height).toBeGreaterThanOrEqual(44);
  expect(cb.width).toBeGreaterThanOrEqual(44);
  // Send is drawn at 34px inside the field; what a finger hits is the 44px
  // around it (its ::before).
  const pb = await send(page).boundingBox();
  expect(pb.height).toBeGreaterThanOrEqual(34);
  const hit = await send(page).evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return [parseFloat(s.width), parseFloat(s.height), s.position];
  });
  expect(hit).toEqual([44, 44, 'absolute']);
  expect((await bar(page).locator('.cmt-box').boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(send(page)).toBeDisabled();

  // Nothing here names a key.
  expect(await bar(page).innerText()).not.toMatch(/Enter|Esc/);
  expect(await input.getAttribute('placeholder')).not.toMatch(/Enter|Esc/);

  await input.fill('Hold this a beat longer');
  await expect(send(page)).toBeEnabled();
  // Send is ink once there is something to send, never gold.
  const { bg, gold } = await send(page).evaluate((el) => {
    const d = document.createElement('div');
    d.style.background = 'var(--soleil)';
    document.body.appendChild(d);
    const c = getComputedStyle(d).backgroundColor;
    d.remove();
    return { bg: getComputedStyle(el).backgroundColor, gold: c };
  });
  expect(bg).not.toBe(gold);

  // The field grows with what is written in it.
  const one = (await input.boundingBox()).height;
  await input.fill('Hold this a beat longer\nand the next\nand the one after');
  await expect.poll(async () => (await input.boundingBox()).height).toBeGreaterThan(one);
  await input.fill('Hold this a beat longer');

  // What happens in the sheet stays in the sheet: a double tap on a word is
  // not the canvas's quick add, a right-click on its padding not the canvas
  // menu, and a drop on it is not a file for the board.
  await input.dblclick();
  await expect(page.locator('.cnv-quick-add')).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await expect(input).toHaveValue('Hold this a beat longer');
  const bb = await sheetCard.boundingBox();
  await page.mouse.click(bb.x + 3, bb.y + 3, { button: 'right' });
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  const reached = await bar(page).evaluate((el) => {
    const seen = [];
    const wrap = document.querySelector('.canvas-wrap');
    const root = document.getElementById('root');
    for (const type of ['dragover', 'drop', 'dblclick', 'contextmenu']) {
      const note = () => seen.push(type);
      wrap.addEventListener(type, note); root.addEventListener(type, note);
      el.firstElementChild.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      wrap.removeEventListener(type, note); root.removeEventListener(type, note);
    }
    return seen;
  });
  expect(reached).toEqual([]);
});

test('the sheet rides the top of the keyboard', async ({ page }) => {
  await bootLocal(page);
  await addComment(page, card(page, 'home-image'));
  const vh = page.viewportSize().height;
  const foot = async () => {
    const b = await bar(page).locator('.cmt-card--sheet').boundingBox();
    return Math.round(b.y + b.height);
  };

  await stubKeyboard(page, 291);
  await expect.poll(foot).toBe(vh - 291);
  // The words and Send are above it, on the screen.
  const ib = await field(page).boundingBox();
  expect(ib.y).toBeGreaterThanOrEqual(0);
  expect(ib.y + ib.height).toBeLessThanOrEqual(vh - 291);

  // A taller one (the emoji keys), then none.
  await stubKeyboard(page, 340);
  await expect.poll(foot).toBe(vh - 340);

  await stubKeyboard(page, 0);
  await expect.poll(foot).toBeGreaterThan(vh - 120);
  expect(await foot()).toBeLessThanOrEqual(vh);
});

// In the installed app on an iPhone the sheet keeps room for the home bar at
// its foot (env(safe-area-inset-bottom)). On the keyboard there is no home
// bar under it, so that room is given up: the box sits on the keyboard. The
// browser here has no home bar, so the test gives the sheet 34px of its own,
// the way the sheet's rule does (one class), and looks at what is left.
test('on the keyboard the sheet keeps no room for the home bar; on the floor it does', async ({ page }) => {
  await bootLocal(page);
  await addComment(page, card(page, 'home-image'));
  await page.addStyleTag({ content: '.cmt-card--sheet { padding-bottom: 34px; }' });
  const vh = page.viewportSize().height;
  const sheetCard = bar(page).locator('.cmt-card--sheet');
  // The card's foot, and how far its last part stops short of it.
  const read = () => sheetCard.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const last = el.lastElementChild.getBoundingClientRect();
    return { foot: Math.round(r.bottom), spare: Math.round(r.bottom - last.bottom), pad: getComputedStyle(el).paddingBottom };
  });

  await expect(bar(page)).not.toHaveClass(/is-lifted/);
  const floor = await read();
  expect(floor.pad).toBe('34px');
  expect(floor.foot).toBe(vh);

  await stubKeyboard(page, 291);
  await expect(bar(page)).toHaveClass(/is-lifted/);
  await expect.poll(async () => (await read()).foot).toBe(vh - 291);
  const lifted = await read();
  expect(lifted.pad).toBe('0px');
  // Nothing between the card's last part and the keyboard but what was there
  // before the home bar's room.
  expect(lifted.spare).toBe(floor.spare - 34);

  await stubKeyboard(page, 0);
  await expect(bar(page)).not.toHaveClass(/is-lifted/);
  await expect.poll(async () => (await read()).pad).toBe('34px');
  expect((await read()).foot).toBe(vh);
});

test('Close and Escape close the sheet without posting', async ({ page }) => {
  let posts = 0;
  await page.route('**/rest/v1/comments**', (route) => {
    if (route.request().method() === 'POST') posts += 1;
    return route.fallback();
  });
  await bootLocal(page);
  await addComment(page, card(page, 'home-image'));
  await field(page).fill('Not this one');
  await close(page).tap();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('.cmt-pin[data-cmt-pin]')).toHaveCount(0);
  await expect(page.locator('.toast-msg').filter({ hasText: 'Comment' })).toHaveCount(0);

  // Escape with words in the box asks before it puts them away.
  await addComment(page, card(page, 'home-image'));
  await field(page).fill('Nor this');
  await field(page).press('Escape');
  await expect(bar(page).getByText('Discard this comment?')).toBeVisible();
  const discard = bar(page).locator('[data-cmt-discard]');
  expect((await discard.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await discard.tap();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('.cmt-pin[data-cmt-pin]')).toHaveCount(0);
  expect(posts).toBe(0);
});

// ?local=1 has no Supabase, so a post there fails: the sheet stays with its
// text (comment-draft-keeps-text.spec.js, for the sheet).
test('a post that fails keeps the sheet and its text', async ({ page }) => {
  // Refused at once: left to the network, the refusal takes seconds.
  await page.route('**/rest/v1/comments**', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"refused by the test"}' })
    : route.fallback()));
  await bootLocal(page);
  await addComment(page, card(page, 'home-image'));
  const input = field(page);
  await input.fill('The cut at 01:12 is late');
  await send(page).tap();
  await expect(bar(page).getByRole('alert')).toHaveText("Couldn't send. Your words are still here.");
  await expect(input).toHaveValue('The cut at 01:12 is late');
  await expect(send(page)).toBeEnabled();
});

// The real app, every request stubbed, so the post goes through.
test('Send puts the comment on the card it was made for', async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  const posted = [];
  const ctx = {};
  ctx.boot = await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
    rest: {
      comments: (url, method) => {
        if (method !== 'POST') return posted;
        const sent = ctx.boot.calls[ctx.boot.calls.length - 1].body;
        const row = {
          id: `55555555-5555-4555-8555-00000000000${posted.length + 1}`,
          created_at: new Date().toISOString(), updated_at: null, deleted_at: null,
          resolved: false, hidden: false,
          ...(Array.isArray(sent) ? sent[0] : sent),
        };
        posted.push(row);
        return row;
      },
    },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.mb-add-fab')).toBeVisible({ timeout: 30000 });

  // The empty board's first note comes from the empty panel's Note tile (a
  // phone's cluster has no rail).
  await page.locator('.cnv-empty-tile').filter({ hasText: /note/i }).first().tap();
  const note = page.locator('.card').first();
  await expect(note).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.isContentEditable)).toBe(true);
  await page.keyboard.type('Opening shot');
  // Out of the note by the top bar's Done, and nothing selected.
  await page.locator('.topbar .tb-done').tap();
  await expect(page.locator('body')).not.toHaveAttribute('data-text-editing');
  if (await page.locator('.card.is-selected').count()) {
    const wrap = await page.locator('.canvas-wrap').boundingBox();
    await page.touchscreen.tap(wrap.x + wrap.width * 0.85, wrap.y + wrap.height * 0.9);
  }
  await expect(page.locator('.note.is-editing, .sel-menu')).toHaveCount(0);
  const cardId = await note.getAttribute('data-card-id');

  await addComment(page, note);
  await field(page).fill('Hold this a beat longer');
  await send(page).tap();

  // What was sent names the card.
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({
    workspace_id: WS_ID, board_id: ROOT_ID, author: USER_ID,
    body: 'Hold this a beat longer', anchor_kind: 'card', anchor_id: cardId,
  });

  // It is the conversation now, in the same sheet, ready for a reply…
  await expect(bar(page).locator('[data-cmt-row]')).toHaveCount(1);
  await expect(bar(page).locator('[data-cmt-row]')).toContainText('Hold this a beat longer');
  await close(page).tap();
  await expect(bar(page)).toHaveCount(0);

  // …and its pin is drawn on or beside that card.
  const pin = page.locator(`[data-cmt-pin="${posted[0].id}"]`);
  await expect(pin).toBeVisible();
  const c = await note.boundingBox();
  const m = await pin.boundingBox();
  const gapX = Math.max(0, c.x - (m.x + m.width), m.x - (c.x + c.width));
  const gapY = Math.max(0, c.y - (m.y + m.height), m.y - (c.y + c.height));
  expect(gapX).toBeLessThanOrEqual(48);
  expect(gapY).toBeLessThanOrEqual(48);
});

test('deleting a cluster card asks with the top bar, not Cmd+Z', async ({ page }) => {
  await bootLocal(page);
  await openCardMenu(page, card(page, 'b-sundown'));
  // Delete is a tile of the sheet's quick row now (plan.md §2.3, Phone sheet).
  await page.locator('.ctx-quick').getByRole('menuitem', { name: 'Delete', exact: true }).tap();
  const msg = page.locator('.feedback-dialog .feedback-message');
  await expect(msg).toContainText('You can undo this from the top bar.');
  await expect(msg).not.toContainText('Cmd+Z');
});
