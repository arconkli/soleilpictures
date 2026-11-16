// canvas-comment-pins.spec.js
//
// Comments on the canvas: each open conversation is a small pin on what it is
// about (components/comments/CanvasCommentPins.jsx), opening as the shared
// comment card beside its card (CanvasCommentCard.jsx), with the list of them
// all behind the comments island (CanvasCommentsList.jsx).
//
// The ?local=1 harness has no comments backend, so tests/commentSeed.js stands
// in for one: nine rows on the harness's own seeded cluster (five open
// conversations, one resolved, one put away by the old per-comment Hide), held
// in memory, so what a press writes can be read back.
//
// A comment link needs a real cluster id (a uuid: lib/commentLink.js), which
// the local harness's 'root' is not, so that one test boots the signed-in app
// with every Supabase call answered by the test.
//
// The phone's sheet is tests/mobile/canvas-comment-sheet.spec.js.

import { expect, test } from '@playwright/test';
import { seedComments, openSeeded, setZoom, zoomPct, pinTally, IDS, ME } from './commentSeed.js';

const pin = (page, id) => page.locator(`[data-cmt-pin="${id}"]`);
const realPins = (page) => page.locator('.cmt-pin[data-cmt-pin]');
const card = (page) => page.locator('.cmt-canvas-card');
const toast = (page, text) => page.locator('.toast-msg').filter({ hasText: text });
const island = (page) => page.locator('.cnv-comments-eye');
const list = (page) => page.locator('.cmt-list');
const tab = (page, name) => list(page).getByRole('tab', { name });
const showSwitch = (page) => page.getByRole('switch', { name: 'Show comments on the canvas' });
const canvasCards = (page) => page.locator('.canvas-wrap [data-card-id]');
const box = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; });

test.describe('pins', () => {
  test('a pin is the same size on screen at 10%, 100% and 400%', async ({ page }) => {
    await seedComments(page);
    await openSeeded(page);
    for (const pct of [10, 100, 400]) {
      await setZoom(page, pct);
      const measure = (sel) => page.locator(sel).evaluateAll((els) => els.map((el) => {
        const r = el.getBoundingClientRect();
        return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
      }));
      const sizes = await measure('.cmt-pin[data-cmt-pin]');
      expect(sizes.length, `pins at ${pct}%`).toBeGreaterThan(0);
      for (const s of sizes) expect(s, `a pin at ${pct}%`).toEqual([30, 30]);
      // a count pin is a pill: as tall as a pin, as wide as its number needs,
      // and no smaller for the canvas being at 10%
      for (const s of await measure('.cmt-pin--count')) {
        expect(s[1], `a count pin's height at ${pct}%`).toBe(30);
        expect(s[0], `a count pin's width at ${pct}%`).toBeGreaterThanOrEqual(30);
        expect(s[0], `a count pin's width at ${pct}%`).toBeLessThanOrEqual(44);
      }
    }
  });

  test('pins that crowd at a low zoom gather into a count; pressing it zooms in until they part', async ({ page }) => {
    await seedComments(page);
    await openSeeded(page);
    // every open conversation has its own pin at 100%
    await setZoom(page, 100);
    await expect.poll(() => pinTally(page)).toEqual({ singles: 5, counts: [], total: 5 });
    // at 10% the cards are a few px apart: some pins become one, and none is lost
    await setZoom(page, 10);
    await expect.poll(async () => (await pinTally(page)).counts.length).toBeGreaterThan(0);
    const low = await pinTally(page);
    expect(low.total).toBe(5);
    expect(low.singles).toBeLessThan(5);
    const count = page.locator('.cmt-pin--count').first();
    await expect(count).toHaveAttribute('aria-label', new RegExp(`^${low.counts[0]} conversations here.*Zoom in$`));
    // unread ones inside it still show
    await expect(count.locator('.cmt-pin-dot')).toHaveCount(1);
    await count.click();
    await expect.poll(() => zoomPct(page)).toBeGreaterThan(10);
    await expect.poll(() => pinTally(page)).toEqual({ singles: 5, counts: [], total: 5 });
    // nothing opened: a count pin only zooms
    await expect(card(page)).toHaveCount(0);
  });

  test('resting the mouse on a pin shows who, when, how it begins and how it has gone', async ({ page }) => {
    await seedComments(page);
    await openSeeded(page);
    const p = pin(page, IDS.features);
    await expect(p).toHaveAttribute('aria-label', 'Comment by Maya Reyes, 1 reply, unread');
    await p.hover();
    const pv = page.locator('.cmt-pv');
    await expect(pv).toBeVisible();
    await expect(pv.locator('.cmt-pv-who')).toHaveText('Maya Reyes');
    await expect(pv.locator('.cmt-pv-when')).toHaveText('2h');
    await expect(pv.locator('.cmt-pv-text')).toHaveText('Warmer grade on this one, closer to the dusk stills');
    await expect(pv.locator('.cmt-pv-foot')).toContainText('1 reply · 10m');
    expect(Math.round((await box(pv)).w)).toBe(272);
    // a look, not an opening
    await expect(card(page)).toHaveCount(0);
    await page.mouse.move(4, 4);
    await expect(pv).toHaveCount(0);
    // one with no replies says so
    await pin(page, IDS.palette).hover();
    await expect(pv.locator('.cmt-pv-foot')).toHaveText('No replies yet');
  });

  test('pressing a pin opens its conversation beside the card, inside the view; Esc goes back to the pin', async ({ page }) => {
    await seedComments(page);
    await openSeeded(page);
    const p = pin(page, IDS.mine);
    await p.click();
    const c = card(page);
    await expect(c).toBeVisible();
    await expect(c.locator(`[data-cmt-card="${IDS.mine}"]`)).toBeVisible();
    await expect(c.locator('.cmt-title')).toHaveText('Halcyon');
    await expect(c.locator('[data-cmt-row]')).toHaveCount(2);
    // the pin and its card are ringed while it is open (the one use of gold)
    await expect(p).toHaveAttribute('aria-expanded', 'true');
    await expect(p).toHaveClass(/is-open/);
    await expect(page.locator('.cmt-hl:not(.is-look)')).toHaveCount(1);
    // no look-ahead over an open conversation
    await expect(page.locator('.cmt-pv')).toHaveCount(0);
    // beside what it is about (to its right, or its left when there is no
    // room), never over it, and 12px inside the canvas view
    await expect(c).not.toHaveClass(/is-placing/);
    const [cb, ab, wb] = await Promise.all([box(c), box(page.locator('[data-card-id="b-halcyon"]')), box(page.locator('.canvas-wrap'))]);
    expect(cb.x >= ab.right - 1 || cb.right <= ab.x + 1, `card ${JSON.stringify(cb)} beside ${JSON.stringify(ab)}`).toBe(true);
    expect(cb.x).toBeGreaterThanOrEqual(wb.x + 12 - 1);
    expect(cb.right).toBeLessThanOrEqual(wb.right - 12 + 1);
    expect(cb.y).toBeGreaterThanOrEqual(wb.y + 12 - 1);
    expect(cb.bottom).toBeLessThanOrEqual(wb.bottom - 12 + 1);
    // one conversation at a time
    await pin(page, IDS.palette).click();
    await expect(c.locator(`[data-cmt-card="${IDS.palette}"]`)).toBeVisible();
    await expect(page.locator('[data-cmt-card]')).toHaveCount(1);
    // Esc (the caret is in the reply box, which is empty) closes it back to its pin
    await page.keyboard.press('Escape');
    await expect(c).toHaveCount(0);
    await expect(pin(page, IDS.palette)).toBeFocused();
    await expect(page.locator('.cmt-hl')).toHaveCount(0);
    // Enter on a pin opens it
    await page.keyboard.press('Enter');
    await expect(c.locator(`[data-cmt-card="${IDS.palette}"]`)).toBeVisible();
  });

  test('a resolved conversation, and one the old Hide put away, have no pin', async ({ page }) => {
    await seedComments(page);
    await openSeeded(page);
    await expect(realPins(page)).toHaveCount(5);
    await expect(pin(page, IDS.resolved)).toHaveCount(0);
    await expect(pin(page, IDS.hidden)).toHaveCount(0);
  });
});

test.describe('the list', () => {
  test('Open / Resolved / For you, each with its count; a row opens its conversation', async ({ page }) => {
    await seedComments(page);
    await openSeeded(page);
    const eye = island(page);
    await expect(eye).toHaveAttribute('aria-label', 'Comments, 5 open, some unread');
    await expect(eye.locator('.cnv-comments-eye-count')).toHaveText('5');
    await eye.click();
    await expect(list(page)).toBeVisible();
    await expect(list(page).getByRole('tab')).toHaveText([/^Open\s*5$/, /^Resolved\s*2$/, /^For you\s*1$/]);
    await expect(tab(page, /^Open/)).toHaveAttribute('aria-selected', 'true');
    const rows = list(page).locator('.cmt-list-row');
    // newest activity first
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText('Warmer grade on this one');
    await expect(rows.first().locator('.cmt-list-foot')).toHaveText('Features · 1 reply · 10m');
    await expect(rows.filter({ hasText: 'Leave this corner open' }).locator('.cmt-list-foot')).toHaveText('On the canvas');

    await tab(page, /^Resolved/).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Crop this frame tighter on the left' })).toHaveCount(1);
    // what the old per-comment Hide put away is kept here, not lost
    await expect(rows.filter({ hasText: 'Hold the inbox note until Friday' })).toHaveCount(1);

    await tab(page, /^For you/).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Halcyon needs a second pass');

    // pointing at a row lights its card; pressing it opens the conversation
    await rows.first().hover();
    await expect(page.locator('.cmt-hl.is-look')).toHaveCount(1);
    await rows.first().click();
    await expect(card(page).locator(`[data-cmt-card="${IDS.mine}"]`)).toBeVisible();
    await expect(pin(page, IDS.mine)).toHaveClass(/is-open/);
    // the list stays open beside it on a desktop
    await expect(list(page)).toBeVisible();
  });

  test('"Show comments on the canvas" is mine alone: nothing is written, and vote cards stay', async ({ page }) => {
    const db = await seedComments(page);
    await openSeeded(page);
    await expect(realPins(page)).toHaveCount(5);
    const vote = page.locator('.canvas-vote');
    await expect(vote).toHaveCount(1);
    const before = JSON.stringify(db.rows);
    const writesBefore = db.writes.length;

    await island(page).click();
    await expect(showSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await showSwitch(page).click();
    await expect(showSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('.cmt-pin')).toHaveCount(0);
    await expect(island(page)).toHaveClass(/is-muted/);
    // the island still counts them, and the list still lists them
    await expect(island(page).locator('.cnv-comments-eye-count')).toHaveText('5');
    await expect(list(page).locator('.cmt-list-row')).toHaveCount(5);
    // vote cards are not comments: they stay, whole
    await expect(vote).toHaveCount(1);
    await expect(vote).toBeVisible();

    // this browser remembers it, for this person on this cluster
    const kept = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('soleil.boards.comments.show.')));
    expect(kept).toEqual([[`soleil.boards.comments.show.${ME}.root`, '0']]);
    await page.goto('/?local=1');
    await expect(island(page).locator('.cnv-comments-eye-count')).toHaveText('5');
    await expect(island(page)).toHaveClass(/is-muted/);
    await expect(page.locator('.cmt-pin')).toHaveCount(0);
    await expect(vote).toHaveCount(1);

    // …and back on
    await island(page).click();
    await showSwitch(page).click();
    await expect(realPins(page)).toHaveCount(5);
    await expect(island(page)).not.toHaveClass(/is-muted/);

    // Off, on, a reload in between: not one request that writes, and the
    // rows everyone shares are as they were (the old eye un-hid them for all).
    expect(db.writes.slice(writesBefore).filter((w) => !/\/rpc\/(get_my_tier|image_seen_for_board)$/.test(w))).toEqual([]);
    expect(db.calls).toEqual([]);
    expect(JSON.stringify(db.rows)).toBe(before);
  });

  test('starting a comment while they are switched off switches them back on', async ({ page }) => {
    await seedComments(page);
    await openSeeded(page);
    await island(page).click();
    await showSwitch(page).click();
    await expect(page.locator('.cmt-pin')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(list(page)).toHaveCount(0);
    await page.locator('[data-card-id="home-note"]').click({ button: 'right', position: { x: 12, y: 12 } });
    await page.locator('.ctx-menu').first().getByText('Add comment', { exact: true }).click();
    await expect(card(page).locator('[data-cmt-card="new"]')).toBeVisible();
    await expect(realPins(page)).toHaveCount(5);
    await expect(island(page)).not.toHaveClass(/is-muted/);
  });
});

test.describe('what a conversation lets you do', () => {
  test('edit: only on my own words, and it says "edited"', async ({ page }) => {
    const db = await seedComments(page);
    await openSeeded(page);
    await pin(page, IDS.mine).click();
    const c = card(page);
    const mine = c.locator(`[data-cmt-row="${IDS.mine}"]`);
    const theirs = c.locator(`[data-cmt-row="${IDS.mineReply}"]`);
    await theirs.hover();
    await expect(theirs.getByRole('button', { name: 'More' })).toBeVisible();
    await expect(theirs.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(mine.locator('.cmt-ed')).toHaveCount(0);
    await mine.hover();
    await mine.getByRole('button', { name: 'Edit', exact: true }).click();
    const box_ = mine.locator('textarea');
    await expect(box_).toHaveValue('Halcyon needs a second pass');
    await box_.fill('Halcyon needs a third pass');
    await mine.locator('.cmt-editbtns').getByRole('button', { name: 'Save' }).click();
    await expect(mine.locator('.cmt-text')).toHaveText('Halcyon needs a third pass');
    await expect(mine.locator('.cmt-ed')).toHaveText('· edited');
    expect(db.rows.find((r) => r.id === IDS.mine).body).toBe('Halcyon needs a third pass');
    expect(db.calls).toEqual([['PATCH', IDS.mine, { body: 'Halcyon needs a third pass', mentions: [] }]]);
  });

  test('before the migration (no mentions, no edited_at): posting and editing still work', async ({ page }) => {
    const db = await seedComments(page, { columns: false });
    await openSeeded(page);
    await pin(page, IDS.palette).click();
    const c = card(page);
    const reply = c.locator('.cmt-foot textarea.cmt-input');
    await reply.fill('Agreed on the palette');
    await reply.press('Enter');
    await expect(c.locator('[data-cmt-row]')).toHaveCount(2);
    const posted = db.rows.find((r) => r.body === 'Agreed on the palette');
    expect(posted).toMatchObject({ author: ME, reply_to: IDS.palette, anchor_kind: 'card', anchor_id: 'home-pal' });
    expect('mentions' in posted).toBe(false);
    const mine = c.locator(`[data-cmt-row="${posted.id}"]`);
    await mine.hover();
    await mine.getByRole('button', { name: 'Edit', exact: true }).click();
    await mine.locator('textarea').fill('Agreed on the palette, mostly');
    await mine.locator('.cmt-editbtns').getByRole('button', { name: 'Save' }).click();
    await expect(mine.locator('.cmt-text')).toHaveText('Agreed on the palette, mostly');
    expect(posted.body).toBe('Agreed on the palette, mostly');
    // nothing went wrong in the person's face
    await expect(c.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.toast-msg')).toHaveCount(0);
    // the missing column was learnt from one refusal, not asked for again
    expect(db.calls.filter((x) => x[1] === 'REFUSED').length).toBeLessThanOrEqual(1);
  });

  test('resolve: it leaves the canvas for Resolved, and Undo brings it back', async ({ page }) => {
    const db = await seedComments(page);
    await openSeeded(page);
    await pin(page, IDS.mine).click();
    await card(page).getByRole('button', { name: 'Resolve' }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(pin(page, IDS.mine)).toHaveCount(0);
    await expect(toast(page, 'Comment resolved')).toBeVisible();
    await expect(island(page).locator('.cnv-comments-eye-count')).toHaveText('4');
    expect(db.rows.find((r) => r.id === IDS.mine).resolved).toBe(true);
    await island(page).click();
    await expect(list(page).getByRole('tab')).toHaveText([/^Open\s*4$/, /^Resolved\s*3$/, /^For you\s*0$/]);

    await page.locator('.toast', { hasText: 'Comment resolved' }).getByRole('button', { name: 'Undo' }).click();
    await expect(pin(page, IDS.mine)).toHaveCount(1);
    await expect(list(page).getByRole('tab')).toHaveText([/^Open\s*5$/, /^Resolved\s*2$/, /^For you\s*1$/]);
    expect(db.rows.find((r) => r.id === IDS.mine).resolved).toBe(false);
  });

  test('delete: the conversation goes with an Undo, and Undo brings it and its replies back', async ({ page }) => {
    const db = await seedComments(page);
    await openSeeded(page);
    await pin(page, IDS.mine).click();
    await card(page).locator('.cmt-head').getByRole('button', { name: 'More' }).click();
    await page.locator('.cmt-menu').getByRole('menuitem', { name: 'Delete' }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(pin(page, IDS.mine)).toHaveCount(0);
    await expect(toast(page, 'Comment deleted')).toBeVisible();
    await expect(realPins(page)).toHaveCount(4);
    expect(db.calls).toEqual([['delete', IDS.mine]]);

    await page.locator('.toast', { hasText: 'Comment deleted' }).getByRole('button', { name: 'Undo' }).click();
    await expect(pin(page, IDS.mine)).toHaveCount(1);
    expect(db.calls).toEqual([['delete', IDS.mine], ['restore', IDS.mine]]);
    await expect(pin(page, IDS.mine)).toHaveAttribute('aria-label', /^Your comment, 1 reply/);
  });

  test('Backspace and Delete in the conversation, on a pin or in the list delete no card and no comment', async ({ page }) => {
    const db = await seedComments(page);
    await openSeeded(page);
    // a card is selected: Backspace on the canvas would delete it
    const note = page.locator('[data-card-id="home-note"]');
    await note.click({ position: { x: 12, y: 12 } });
    await expect(note).toHaveClass(/is-selected/);
    const cards = await canvasCards(page).count();
    const strike = async (where) => {
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Delete');
      await expect(canvasCards(page), `cards after Backspace/Delete ${where}`).toHaveCount(cards);
      await expect(note).toBeVisible();
      await expect(realPins(page), `pins after Backspace/Delete ${where}`).toHaveCount(5);
    };

    // on a pin
    await pin(page, IDS.features).focus();
    await strike('on a pin');
    // on a button of the open conversation (not a field, so the canvas used
    // to take the key as its own)
    await pin(page, IDS.features).click();
    const resolve = card(page).getByRole('button', { name: 'Resolve' });
    await resolve.focus();
    await expect(resolve).toBeFocused();
    await strike('on Resolve');
    await expect(card(page)).toBeVisible();
    // on the conversation itself
    await card(page).locator('[data-cmt-card]').focus();
    await strike('on the card');
    // in its reply box, where Backspace is just Backspace
    const reply = card(page).locator('.cmt-foot textarea.cmt-input');
    await reply.fill('ab');
    await reply.press('Backspace');
    await expect(reply).toHaveValue('a');
    await strike('in the reply box');
    await reply.fill('');
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);

    // in the list: on the list, a tab, a row and the switch
    await island(page).click();
    await expect(list(page)).toBeFocused();
    await strike('on the list');
    await tab(page, /^Open/).focus();
    await strike('on a tab');
    await list(page).locator('.cmt-list-row').first().focus();
    await strike('on a row');
    await showSwitch(page).focus();
    await strike('on the switch');

    expect(db.calls).toEqual([]);
    await expect(note).toHaveClass(/is-selected/);
  });
});

test.describe('who may comment', () => {
  test('someone who can only view the cluster can start a comment, and edit their own', async ({ page }) => {
    const db = await seedComments(page);
    await openSeeded(page, { query: '&filesrules=1&viewonly=1' });
    await expect(page.locator('.canvas-wrap.is-readonly')).toHaveCount(1);

    // from a card's menu
    await page.locator('[data-card-id="home-note"]').click({ button: 'right', position: { x: 12, y: 12 } });
    await page.getByRole('menu').last().getByText('Add comment', { exact: true }).click();
    const c = card(page);
    await expect(c.locator('[data-cmt-card="new"]')).toBeVisible();
    const input = c.locator('textarea.cmt-input');
    await expect(input).toBeFocused();
    await input.fill('A viewer asks about the note');
    await input.press('Enter');
    await expect(c.locator('[data-cmt-row]')).toHaveCount(1);
    const posted = db.rows.find((r) => r.body === 'A viewer asks about the note');
    expect(posted).toMatchObject({ author: ME, anchor_kind: 'card', anchor_id: 'home-note', reply_to: null });
    // the draft's pin became the comment's own
    await expect(page.locator('.cmt-pin--draft')).toHaveCount(0);
    await expect(pin(page, posted.id)).toHaveClass(/is-open/);
    await expect(realPins(page)).toHaveCount(6);
    // their own words are theirs to edit and delete
    const mine = c.locator(`[data-cmt-row="${posted.id}"]`);
    await mine.hover();
    await expect(mine.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(c).toHaveCount(0);

    // a teammate's conversation: they can reply, not resolve, edit or delete
    await pin(page, IDS.features).click();
    await expect(c.locator(`[data-cmt-card="${IDS.features}"]`)).toBeVisible();
    await expect(c.locator('.cmt-foot textarea.cmt-input')).toBeVisible();
    await expect(c.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
    const theirs = c.locator(`[data-cmt-row="${IDS.features}"]`);
    await theirs.hover();
    await expect(theirs.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await theirs.getByRole('button', { name: 'More' }).click();
    await expect(page.locator('.cmt-menu').getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(c).toHaveCount(0);

    // from the canvas's own menu, on a point
    const spot = await page.evaluate(() => {
      const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
      for (let y = wrap.bottom - 60; y > wrap.top + 120; y -= 40) {
        for (let x = wrap.right - 60; x > wrap.left + 120; x -= 40) {
          const el = document.elementFromPoint(x, y);
          if (el && el.closest('.canvas-wrap') && !el.closest('[data-card-id], button, [role="toolbar"], .rail, .cnv-zoom, .cmt-pin, .canvas-vote, svg path')) return { x, y };
        }
      }
      return null;
    });
    expect(spot, 'a bare point on the canvas').not.toBeNull();
    await page.mouse.click(spot.x, spot.y, { button: 'right' });
    await page.getByRole('menu').last().getByText('Add comment', { exact: true }).click();
    await expect(c.locator('[data-cmt-card="new"]')).toBeVisible();
    await expect(page.locator('.cmt-pin--draft.is-open')).toHaveCount(1);
  });
});

test.describe('replying to a resolved conversation', () => {
  const openResolved = async (page) => {
    await island(page).click();
    await tab(page, 'Resolved').click();
    await list(page).locator('.cmt-list-row').filter({ hasText: 'Crop this frame tighter on the left' }).click();
    const c = card(page);
    await expect(c.locator(`[data-cmt-card="${IDS.resolved}"]`)).toBeVisible();
    return c;
  };

  test('someone who may not reopen it: the box does not promise to, and the reply says it stayed resolved', async ({ page }) => {
    const db = await seedComments(page);
    await openSeeded(page, { query: '&filesrules=1&viewonly=1' });
    const c = await openResolved(page);
    await expect(c.getByRole('button', { name: 'Reopen' })).toHaveCount(0);
    const input = c.locator('.cmt-foot textarea.cmt-input');
    await expect(input).toHaveAttribute('placeholder', /^Reply…/);
    await input.fill('Still looks loose to me');
    await input.press('Enter');
    await expect(toast(page, 'Sent. Only an editor or the person who started this can reopen it.')).toBeVisible();
    expect(db.rows.find((r) => r.body === 'Still looks loose to me')).toMatchObject({ reply_to: IDS.resolved, author: ME });
    // nothing they may not write was tried; the conversation was read once, and is still resolved
    expect(db.calls.filter((k) => k[0] === 'PATCH')).toEqual([]);
    expect(db.calls.filter((k) => k[0] === 'GET' && k[1] === IDS.resolved)).toHaveLength(1);
    expect(db.rows.find((r) => r.id === IDS.resolved).resolved).toBe(true);
    await expect(pin(page, IDS.resolved)).toHaveCount(0);
    await expect(c.locator('.cmt-resolved')).toBeVisible();
  });

  test('…and once the database reopens on a reply, it is open again and nothing is said', async ({ page }) => {
    const db = await seedComments(page, { replyReopens: true });
    await openSeeded(page, { query: '&filesrules=1&viewonly=1' });
    const c = await openResolved(page);
    const input = c.locator('.cmt-foot textarea.cmt-input');
    await input.fill('Still looks loose to me');
    await input.press('Enter');
    await expect(pin(page, IDS.resolved)).toHaveCount(1);
    await expect(c.locator('.cmt-resolved')).toHaveCount(0);
    expect(db.calls.filter((k) => k[0] === 'GET' && k[1] === IDS.resolved)).toHaveLength(1);
    await expect(toast(page, 'Only an editor')).toHaveCount(0);
  });

  test('an editor is told a reply reopens it, and it does, with no second read', async ({ page }) => {
    const db = await seedComments(page);
    await openSeeded(page);
    const c = await openResolved(page);
    const input = c.locator('.cmt-foot textarea.cmt-input');
    await expect(input).toHaveAttribute('placeholder', 'Reply to reopen…');
    await input.fill('Reopening: tighter still');
    await input.press('Enter');
    await expect(pin(page, IDS.resolved)).toHaveCount(1);
    expect(db.calls.filter((k) => k[0] === 'PATCH')).toEqual([['PATCH', IDS.resolved, { resolved: false, hidden: false }]]);
    expect(db.calls.filter((k) => k[0] === 'GET')).toEqual([]);
  });

  test('an editor whose reopen is refused: the reply is sent, it is read once, and they are told it stayed resolved', async ({ page }) => {
    const db = await seedComments(page);
    await page.route('https://example.supabase.co/rest/v1/comments**', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({
        status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ code: '42501', message: 'new row violates row-level security policy' }),
      });
    });
    await openSeeded(page);
    const c = await openResolved(page);
    const input = c.locator('.cmt-foot textarea.cmt-input');
    await expect(input).toHaveAttribute('placeholder', 'Reply to reopen…');
    await input.fill('Reopening: tighter still');
    await input.press('Enter');
    // (they may reopen it, so they are told the reopen failed, not that they may not)
    await expect(toast(page, "Sent, but it couldn't be reopened. Try again.")).toBeVisible();
    expect(db.rows.find((r) => r.body === 'Reopening: tighter still')).toMatchObject({ reply_to: IDS.resolved, author: ME });
    expect(db.calls.filter((k) => k[0] === 'GET' && k[1] === IDS.resolved)).toHaveLength(1);
    expect(db.rows.find((r) => r.id === IDS.resolved).resolved).toBe(true);
    await expect(pin(page, IDS.resolved)).toHaveCount(0);
    await expect(c.locator('.cmt-resolved')).toBeVisible();
  });
});

test.describe('a comment left unsent', () => {
  test('keeps its pin however it was left: for another pin, for a row of the list', async ({ page }) => {
    const db = await seedComments(page);
    await openSeeded(page);
    const draftPin = page.locator('.cmt-pin--draft');
    await page.locator('[data-card-id="home-note"]').click({ button: 'right', position: { x: 12, y: 12 } });
    await page.getByRole('menu').last().getByText('Add comment', { exact: true }).click();
    const c = card(page);
    await c.locator('textarea.cmt-input').fill('Half a thought about the note');
    await expect(draftPin).toHaveCount(1);
    // left by pressing another pin
    await pin(page, IDS.palette).click();
    await expect(c.locator(`[data-cmt-card="${IDS.palette}"]`)).toBeVisible();
    await expect(draftPin).toHaveCount(1);
    await expect(draftPin).not.toHaveClass(/is-open/);
    // its pin brings the words back
    await draftPin.click();
    await expect(c.locator('textarea.cmt-input')).toHaveValue('Half a thought about the note');
    await expect(draftPin).toHaveClass(/is-open/);
    // left by pressing a row of the list
    await island(page).click();
    await list(page).locator('.cmt-list-row').filter({ hasText: 'Can we get the alley at blue hour?' }).click();
    await expect(c.locator(`[data-cmt-card="${IDS.image}"]`)).toBeVisible();
    await expect(draftPin).toHaveCount(1);
    await expect(draftPin).not.toHaveClass(/is-open/);
    // a comment started and left with nothing in it keeps none
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('[data-card-id="home-pal"]').click({ button: 'right', position: { x: 12, y: 12 } });
    await page.getByRole('menu').last().getByText('Add comment', { exact: true }).click();
    await expect(draftPin).toHaveCount(2);
    await pin(page, IDS.image).click();
    await expect(draftPin).toHaveCount(1);
    expect(db.calls).toEqual([]);
  });
});

test.describe('the people "@" offers', () => {
  test('are asked for once per cluster, not on every open', async ({ page }) => {
    const db = await seedComments(page);
    await openSeeded(page);
    const asks = () => db.reads.filter((r) => /workspace_members|list_board_shares|list_inherited_board_shares/.test(r));
    const c = card(page);
    for (const id of [IDS.image, IDS.palette, IDS.image]) {
      await pin(page, id).click();
      await expect(c.locator(`[data-cmt-card="${id}"]`)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(c).toHaveCount(0);
    }
    expect(asks().sort()).toEqual(['GET /rest/v1/workspace_members', 'POST /rest/v1/rpc/list_board_shares', 'POST /rest/v1/rpc/list_inherited_board_shares']);
  });
});

test.describe('from the keyboard', () => {
  test('Enter on a pin opens it with the caret in the conversation; Tab stays in it; Esc goes back to the pin', async ({ page }) => {
    await seedComments(page);
    await openSeeded(page);
    const p = pin(page, IDS.image);
    await p.focus();
    await page.keyboard.press('Enter');
    const c = card(page);
    await expect(c.locator(`[data-cmt-card="${IDS.image}"]`)).toBeVisible();
    const inCard = () => page.evaluate(() => !!document.activeElement?.closest('.cmt-canvas-card'));
    await expect.poll(inCard).toBe(true);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      expect(await inCard(), `Tab ${i + 1} stays in the conversation`).toBe(true);
    }
    await page.keyboard.press('Escape');
    // (the first Esc may leave the reply box; the card then closes)
    if (await c.count()) await page.keyboard.press('Escape');
    await expect(c).toHaveCount(0);
    await expect(p).toBeFocused();
    // a press with the mouse leaves the caret where a press puts it
    await p.click();
    await expect(c.locator(`[data-cmt-card="${IDS.image}"]`)).toBeVisible();
    expect(await inCard()).toBe(false);
  });
});

test.describe('when the comment parts cannot be fetched', () => {
  const PARTS = /\/components\/comments\/commentParts\.js/;
  const crashed = (page) => page.getByText("Couldn't load this page");
  const SAID = "Comments couldn't load. Check your connection.";

  test('online: one reload, then a press says so; the look-ahead says nothing; the canvas stays', async ({ page }) => {
    await seedComments(page);
    await page.route(PARTS, (route) => route.abort());
    await openSeeded(page);
    const p = pin(page, IDS.image);
    // resting on a pin: no look-ahead, no reload, no crash
    await page.evaluate(() => { window.__same = true; });
    await p.hover();
    await page.waitForTimeout(700);
    await expect(page.locator('.cmt-pv')).toHaveCount(0);
    expect(await page.evaluate(() => window.__same)).toBe(true);
    await expect(crashed(page)).toHaveCount(0);
    // a press: the one reload a replaced chunk needs
    const reloaded = page.waitForEvent('load');
    await p.click();
    await reloaded;
    await realPins(page).first().waitFor({ state: 'attached', timeout: 30000 });
    // after it, resting on a pin still shows nothing and breaks nothing
    await page.evaluate(() => { window.__same = true; });
    await p.hover();
    await page.waitForTimeout(700);
    await expect(crashed(page)).toHaveCount(0);
    await expect(page.locator('.canvas-wrap')).toBeVisible();
    // …and a press says so, and leaves the pin to be pressed again. That one
    // reload was this tab's: a press long after it (the ten seconds the
    // app's reloads share are over) still only says so.
    await page.evaluate(() => sessionStorage.removeItem('soleil:chunk-reload-at'));
    await p.click();
    await expect(toast(page, SAID)).toBeVisible();
    await expect(p).not.toHaveClass(/is-open/);
    await expect(card(page)).toHaveCount(0);
    // the list too
    await island(page).click();
    await expect(island(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(list(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__same)).toBe(true);
    await expect(crashed(page)).toHaveCount(0);
    await expect(canvasCards(page).first()).toBeVisible();
    await expect(realPins(page)).toHaveCount(5);
  });

  test('offline: no reload at all; back online the conversation opens', async ({ page, context }) => {
    await seedComments(page);
    let down = true;
    await page.route(PARTS, (route) => (down ? route.abort() : route.continue()));
    await openSeeded(page);
    await page.evaluate(() => { window.__same = true; });
    const p = pin(page, IDS.image);
    // pointed at while still online (that also fetches the toast's own overlay)
    await p.hover();
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    await p.click();
    await expect(toast(page, SAID)).toBeVisible();
    await expect(p).not.toHaveClass(/is-open/);
    expect(await page.evaluate(() => window.__same)).toBe(true);
    await expect(crashed(page)).toHaveCount(0);
    // back online
    down = false;
    await context.setOffline(false);
    await p.click();
    // (a browser that kept the failed fetch needs the one reload first)
    const c = card(page).locator(`[data-cmt-card="${IDS.image}"]`);
    try { await expect(c).toBeVisible({ timeout: 4000 }); } catch (_) {
      await realPins(page).first().waitFor({ state: 'attached', timeout: 30000 });
      await p.click();
      await expect(c).toBeVisible();
    }
    await expect(crashed(page)).toHaveCount(0);
  });

  // Wifi with no internet behind it: the browser still says it is online.
  // The request that asks whether the site answers (lib/commentChunkReload.js)
  // gets nothing, so nothing reloads.
  const PROBE = /\/robots\.txt/;
  const OVERLAY = /\/components\/FeedbackOverlay\.jsx/;

  test('a dead network the browser calls online: no reload, however often it is pressed; a press says so', async ({ page }) => {
    await seedComments(page);
    await page.route(PARTS, (route) => route.abort());
    await page.route(PROBE, (route) => route.abort());
    // the toast's overlay is fetched once the canvas has painted, with nothing pointed at
    const warmed = page.waitForResponse(OVERLAY);
    await openSeeded(page);
    await warmed;
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await page.evaluate(() => { window.__same = true; });
    const p = pin(page, IDS.image);
    await p.click();
    await expect(toast(page, SAID)).toBeVisible();
    await expect(p).not.toHaveClass(/is-open/);
    // again, past the ten seconds two reloads are kept apart by
    await page.evaluate(() => sessionStorage.removeItem('soleil:chunk-reload-at'));
    await page.waitForTimeout(1600);
    await island(page).click();
    await expect(island(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(toast(page, SAID).first()).toBeVisible();
    expect(await page.evaluate(() => window.__same)).toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem('soleil:comment-chunk-reloaded'))).toBe(null);
    await expect(crashed(page)).toHaveCount(0);
    await expect(realPins(page)).toHaveCount(5);
  });

  test("…and when the toast's own overlay could not be fetched either, a press says nothing and reloads nothing", async ({ page }) => {
    await seedComments(page);
    await page.route(PARTS, (route) => route.abort());
    await page.route(PROBE, (route) => route.abort());
    let asks = 0;
    await page.route(OVERLAY, (route) => { asks += 1; return route.abort(); });
    await openSeeded(page);
    await expect.poll(() => asks).toBeGreaterThan(0);
    await page.evaluate(() => { window.__same = true; });
    const p = pin(page, IDS.image);
    await p.click();
    await expect(p).not.toHaveClass(/is-open/);
    await island(page).click();
    await expect(island(page)).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(800);
    await expect(page.locator('.toast-msg')).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__same)).toBe(true);
    await expect(crashed(page)).toHaveCount(0);
    await expect(canvasCards(page).first()).toBeVisible();
    await expect(realPins(page)).toHaveCount(5);
  });

  test('slow to arrive: the press waits for it, and the conversation opens', async ({ page }) => {
    await seedComments(page);
    await page.route(PARTS, async (route) => { await new Promise((r) => setTimeout(r, 3000)); await route.continue(); });
    await openSeeded(page);
    const p = pin(page, IDS.image);
    await p.focus();
    await page.keyboard.press('Enter');
    await expect(p).toHaveClass(/is-open/);
    await expect(card(page)).toHaveCount(0);
    await expect(crashed(page)).toHaveCount(0);
    await expect(card(page).locator(`[data-cmt-card="${IDS.image}"]`)).toBeVisible({ timeout: 8000 });
    // opened from the keyboard: the caret went in when it arrived
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.cmt-canvas-card'))).toBe(true);
  });
});

// The pins are a chunk of their own (CanvasCommentPins.jsx), asked for as the
// canvas mounts. The retry asks at the same address with a query added.
const PINS = /\/components\/comments\/CanvasCommentPins\.jsx/;

test.describe('when the pins cannot be fetched', () => {
  const crashed = (page) => page.getByText("Couldn't load this page");
  const again = (page) => page.evaluate(() => window.dispatchEvent(new Event('online')));

  test('a dead network: the canvas and the island are fine, no pins, no reload; they appear when it is back', async ({ page }) => {
    await seedComments(page);
    let down = true;
    let asks = 0;
    await page.route(PINS, (route) => { asks += 1; return down ? route.abort() : route.continue(); });
    await page.route(/\/robots\.txt/, (route) => (down ? route.abort() : route.continue()));
    await openSeeded(page, { pins: null });
    await page.evaluate(() => { window.__same = true; });
    await expect(island(page).locator('.cnv-comments-eye-count')).toHaveText('5');
    await expect.poll(() => asks).toBeGreaterThan(0);
    await page.waitForTimeout(1200);
    await expect(page.locator('.cmt-pin')).toHaveCount(0);
    await expect(canvasCards(page).first()).toBeVisible();
    await expect(crashed(page)).toHaveCount(0);
    await expect(page.locator('.toast-msg')).toHaveCount(0);
    // the island still opens its list, and a row its conversation
    await island(page).click();
    await expect(list(page)).toBeVisible();
    await list(page).locator('.cmt-list-row').first().click();
    await expect(card(page)).toBeVisible();
    await page.keyboard.press('Escape');
    // still down: asking again changes nothing
    await again(page);
    await page.waitForTimeout(800);
    await expect(page.locator('.cmt-pin')).toHaveCount(0);
    // back
    down = false;
    await again(page);
    await expect(realPins(page)).toHaveCount(5);
    expect(await page.evaluate(() => window.__same)).toBe(true);
    await expect(crashed(page)).toHaveCount(0);
  });

  test('a site that answers: the one reload, then no pins and no second reload; looking at the tab again brings them', async ({ page }) => {
    await seedComments(page);
    let down = true;
    let asks = 0;
    await page.route(PINS, (route) => { asks += 1; return down ? route.abort() : route.continue(); });
    await openSeeded(page, { pins: null });
    // the reload a replaced chunk needs, once
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('soleil:comment-chunk-reloaded')).catch(() => null), { timeout: 20000 }).toBeTruthy();   // the build it reloaded from
    await expect.poll(() => asks, { timeout: 30000 }).toBeGreaterThan(1);
    await page.locator('.canvas-wrap').waitFor({ state: 'visible', timeout: 60000 });
    await page.evaluate(() => { window.__same = true; sessionStorage.removeItem('soleil:chunk-reload-at'); });
    await expect(island(page).locator('.cnv-comments-eye-count')).toHaveText('5');
    await page.waitForTimeout(1500);
    await expect(page.locator('.cmt-pin')).toHaveCount(0);
    expect(await page.evaluate(() => window.__same)).toBe(true);
    await expect(crashed(page)).toHaveCount(0);
    down = false;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(realPins(page)).toHaveCount(5);
    expect(await page.evaluate(() => window.__same)).toBe(true);
  });

  test('slow to arrive (3 s): the canvas and the island do not wait, and the pins come in', async ({ page }) => {
    await seedComments(page);
    await page.route(PINS, async (route) => { await new Promise((r) => setTimeout(r, 3000)); await route.continue(); });
    await openSeeded(page, { pins: null });
    await expect(canvasCards(page).first()).toBeVisible();
    await expect(island(page).locator('.cnv-comments-eye-count')).toHaveText('5');
    await expect(page.locator('.cmt-pin')).toHaveCount(0);
    await expect(realPins(page)).toHaveCount(5, { timeout: 10000 });
    await expect(crashed(page)).toHaveCount(0);
  });
});

test.describe('a link to a comment', () => {
  // The real signed-in app, every Supabase call answered here.
  const UID = '99999999-9999-4999-8999-999999999999';
  const WS = '77777777-7777-4777-8777-777777777777';
  const BOARD = '55555555-5555-4555-8555-555555555555';
  const OTHER = '11111111-1111-4111-8111-111111111111';
  const T1 = 'a0000000-0000-4000-8000-000000000001';
  const R1 = 'a0000000-0000-4000-8000-000000000002';

  async function signedIn(page, baseURL) {
    const now = Date.now();
    const iso = (m) => new Date(now - m * 60000).toISOString();
    const row = (o) => ({
      workspace_id: WS, board_id: BOARD, anchor_kind: 'point', anchor_id: null, anchor_x: 500, anchor_y: 520,
      doc_page_id: null, doc_from: null, doc_to: null, reply_to: null, hidden: false, resolved: false,
      offset_x: 0, offset_y: 0, deleted_at: null, updated_at: iso(5), mentions: [], edited_at: null, ...o,
    });
    const rows = [
      row({ id: T1, author: OTHER, body: 'Leave this corner open for the title treatment', created_at: iso(120) }),
      row({ id: R1, author: UID, body: 'Agreed, keeping it clear', reply_to: T1, created_at: iso(30) }),
    ];
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const user = {
      id: UID, aud: 'authenticated', role: 'authenticated', email: 'tester@example.com', email_confirmed_at: iso(9999),
      app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Tess Tester' }, created_at: iso(99999),
    };
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp: Math.floor(now / 1000) + 3600, role: 'authenticated', email: user.email })}.sig`;
    const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, user };
    const workspace = { id: WS, name: 'Test Studio', owner: UID, created_at: iso(99999), kind: 'personal' };
    const board = {
      id: BOARD, workspace_id: WS, parent_board_id: null, name: 'Test Studio', title: 'Test Studio', deleted_at: null,
      created_at: iso(9999), updated_at: iso(99), created_by: UID, view: 'canvas', position: 0,
    };
    await page.addInitScript((s) => {
      try {
        if (!sessionStorage.getItem('planted')) {
          localStorage.setItem('sb-example-auth-token', s);
          sessionStorage.setItem('planted', '1');
        }
      } catch (_) { /* the app then shows its sign-in page, and the test says so */ }
    }, JSON.stringify(session));
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await page.route(/.*/, async (route) => {
      const req = route.request();
      const url = req.url();
      const m = req.method();
      if (url.startsWith(baseURL)) return route.continue();
      if (!url.startsWith('https://example.supabase.co/')) return route.abort();
      const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
      if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const one = (req.headers().accept || '').includes('vnd.pgrst.object');
      if (url.includes('/auth/v1/user')) return json(user);
      if (url.includes('/auth/v1/token')) return json(session);
      if (url.includes('/auth/v1/')) return json({});
      if (url.includes('rpc/get_my_tier')) return json([{ tier: 'admin', demo_card_count: 0, onboarding: { done: true } }]);
      if (url.includes('rpc/get_or_create_personal_workspace')) return json(workspace);
      if (url.includes('/rest/v1/workspace_members')) return json([{ workspace_id: WS, role: 'owner', created_at: iso(9999), user_id: UID, workspaces: workspace }]);
      if (url.includes('/rest/v1/boards') && m === 'GET') return one ? json(board) : json([board]);
      if (url.includes('/rest/v1/comments')) return json(m === 'GET' ? rows.filter((r) => !r.deleted_at) : []);
      if (url.includes('/rest/v1/member_profiles')) {
        return json([
          { user_id: OTHER, display_name: 'Maya Reyes', color: '#d98c2b', avatar_url: null },
          { user_id: UID, display_name: 'Tess Tester', color: '#4f8fd6', avatar_url: null },
        ]);
      }
      if (m === 'GET' && one) return json({ code: 'PGRST116', message: 'no rows' }, 406);
      if (url.includes('/functions/') || url.includes('/storage/')) return json({});
      return json([]);
    });
    await page.routeWebSocket(/.*/, (ws) => { if (ws.url().startsWith(baseURL.replace(/^http/, 'ws'))) ws.connectToServer(); else ws.close(); });
  }

  test('?board=&comment= opens the cluster on that conversation, the reply it names lit; the address is cleaned', async ({ page, baseURL }) => {
    await signedIn(page, baseURL);
    await page.goto(`/?board=${BOARD}&comment=${R1}`);
    await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
    const c = card(page);
    await expect(c.locator(`[data-cmt-card="${T1}"]`)).toBeVisible({ timeout: 20000 });
    await expect(c.locator('[data-cmt-row]')).toHaveCount(2);
    // the reply the link named is the one lit
    await expect(c.locator('[data-cmt-row].is-flash')).toHaveAttribute('data-cmt-row', R1);
    await expect(pin(page, T1)).toHaveClass(/is-open/);
    // its pin is in view
    await expect(pin(page, T1)).toBeInViewport();
    // one-shot: the address no longer names the comment
    await expect.poll(() => new URL(page.url()).search).toBe('');
  });

  test('with the pins 3 s late the link still opens its card, and its pin arrives open beside it', async ({ page, baseURL }) => {
    await signedIn(page, baseURL);
    await page.route(PINS, async (route) => { await new Promise((r) => setTimeout(r, 3000)); await route.continue(); });
    await page.goto(`/?board=${BOARD}&comment=${R1}`);
    await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
    const c = card(page);
    await expect(c.locator(`[data-cmt-card="${T1}"]`)).toBeVisible({ timeout: 20000 });
    await expect(c.locator('[data-cmt-row].is-flash')).toHaveAttribute('data-cmt-row', R1);
    const p = pin(page, T1);
    await expect(p).toHaveClass(/is-open/, { timeout: 10000 });
    await expect(p).toBeInViewport();
    // beside its pin: next to it, not over it
    await expect(c).not.toHaveClass(/is-placing/);
    const [cb, pb] = await Promise.all([box(c), box(p)]);
    const gap = Math.max(cb.x - pb.right, pb.x - cb.right);
    expect(gap, `card ${JSON.stringify(cb)} beside pin ${JSON.stringify(pb)}`).toBeGreaterThanOrEqual(-1);
    expect(gap).toBeLessThan(60);
    expect(pb.bottom).toBeGreaterThan(cb.y - 60);
    expect(pb.y).toBeLessThan(cb.bottom + 60);
  });

  test('while the comments cannot be fetched the link waits, and is never called gone; it opens when they come', async ({ page, baseURL }) => {
    await signedIn(page, baseURL);
    let down = true;
    let failed = 0;
    await page.route(/example\.supabase\.co\/rest\/v1\/comments/, (route) => {
      if (!down || route.request().method() !== 'GET') return route.fallback();
      failed += 1;
      return route.abort();
    });
    await page.goto(`/?board=${BOARD}&comment=${R1}`);
    await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
    await expect.poll(() => failed, { timeout: 20000 }).toBeGreaterThan(0);
    await page.waitForTimeout(5000);   // past every "it may still arrive" wait
    await expect(toast(page, "That comment isn't here any more")).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    down = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(card(page).locator(`[data-cmt-card="${T1}"]`)).toBeVisible({ timeout: 20000 });
    await expect(card(page).locator('[data-cmt-row].is-flash')).toHaveAttribute('data-cmt-row', R1);
    await expect(pin(page, T1)).toHaveClass(/is-open/);
  });

  test('a link to the conversation itself opens it; one to a comment that is gone says so', async ({ page, baseURL }) => {
    await signedIn(page, baseURL);
    await page.goto(`/?board=${BOARD}&comment=${T1}`);
    await expect(card(page).locator(`[data-cmt-card="${T1}"]`)).toBeVisible({ timeout: 60000 });
    await expect(card(page).locator('[data-cmt-row].is-flash')).toHaveCount(0);

    await page.goto(`/?board=${BOARD}&comment=a0000000-0000-4000-8000-0000000000ff`);
    await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
    await expect(toast(page, "That comment isn't here any more")).toBeVisible({ timeout: 20000 });
    await expect(card(page)).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search).toBe('');
  });
});


// The canvas has a menu of its own on a right-click (a card's, or the
// background's). A comment part is not the canvas: a right-click on a pin, an
// open conversation, the island or the list opens neither menu, selects no
// card and changes nothing.
test.describe('a right-click on a comment part', () => {
  const menu = (page) => page.locator('.ctx-menu');
  const selected = (page) => page.locator('.canvas-wrap [data-card-id].selected');

  test('opens no canvas menu: a pin, an open conversation, the island, the list', async ({ page }) => {
    await seedComments(page);
    await openSeeded(page);
    // the canvas does answer a right-click here, so the rest means something
    await canvasCards(page).first().click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(selected(page)).toHaveCount(0);

    const p = pin(page, IDS.mine);
    await p.click({ button: 'right' });
    await page.waitForTimeout(300);
    await expect(menu(page)).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    await expect(selected(page)).toHaveCount(0);

    await p.click();
    await expect(card(page).locator(`[data-cmt-card="${IDS.mine}"]`)).toBeVisible();
    await card(page).locator('.cmt-head').click({ button: 'right' });
    await card(page).locator('[data-cmt-row]').first().click({ button: 'right' });
    await page.waitForTimeout(300);
    await expect(menu(page)).toHaveCount(0);
    await expect(card(page).locator(`[data-cmt-card="${IDS.mine}"]`)).toBeVisible();
    await expect(selected(page)).toHaveCount(0);
    await card(page).getByRole('button', { name: 'Close' }).click();
    await expect(card(page)).toHaveCount(0);

    await island(page).click({ button: 'right' });
    await page.waitForTimeout(300);
    await expect(menu(page)).toHaveCount(0);

    await island(page).click();
    await expect(list(page)).toBeVisible();
    await list(page).locator('.cmt-list-row').first().click({ button: 'right' });
    await page.waitForTimeout(300);
    await expect(menu(page)).toHaveCount(0);
    await expect(list(page)).toBeVisible();
    await expect(realPins(page)).toHaveCount(5);
  });
});
