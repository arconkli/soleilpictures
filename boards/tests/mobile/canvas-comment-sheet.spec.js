// canvas-comment-sheet.spec.js
//
// Comments on the canvas, on a phone (390px): the list of them is a sheet,
// and a conversation opens as a sheet from the bottom edge, not as a card
// floating beside its pin. Seeded like tests/canvas-comment-pins.spec.js.

import { expect, test } from '@playwright/test';
import { seedComments, openSeeded, IDS } from '../commentSeed.js';

test.use({ viewport: { width: 390, height: 780 } });

const island = (page) => page.locator('.cnv-comments-eye');
const sheet = (page) => page.locator('.cmt-sheet-host');

test('the list is a sheet; a row opens its conversation as a sheet from the bottom edge', async ({ page }) => {
  await seedComments(page);
  await openSeeded(page);
  await island(page).tap();
  const list = page.locator('.cmt-list');
  await expect(list).toBeVisible();
  await expect(list).toHaveClass(/cmt-list--sheet/);
  await expect(page.locator('.cmt-list-scrim')).toHaveCount(1);
  await expect(list.getByRole('tab')).toHaveText([/^Open\s*5$/, /^Resolved\s*2$/, /^For you\s*1$/]);
  const lb = await list.boundingBox();
  expect(Math.round(lb.x)).toBe(0);
  expect(Math.round(lb.width)).toBe(390);

  await list.locator('.cmt-list-row').filter({ hasText: 'Love this palette for the bar scene' }).tap();
  // on a phone the list makes way for the conversation
  await expect(list).toHaveCount(0);
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('.cmt-sheet-scrim')).toHaveCount(1);
  await expect(page.locator('.cmt-canvas-card')).toHaveCount(0);
  const cardEl = sheet(page).locator(`[data-cmt-card="${IDS.palette}"]`);
  await expect(cardEl).toBeVisible();
  await expect(cardEl).toHaveClass(/cmt-card--sheet/);
  await expect(cardEl.locator('[data-cmt-row]')).toHaveCount(1);
  // full width, on the bottom edge
  await expect.poll(async () => {
    const b = await cardEl.boundingBox();
    return [Math.round(b.x), Math.round(b.width), Math.round(b.y + b.height)];
  }).toEqual([0, 390, 780]);
  // 16px in the box, so iOS does not zoom the page on focus
  const input = cardEl.locator('.cmt-foot textarea.cmt-input');
  expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  // its pin is the open one, and was brought into view above the sheet
  const p = page.locator(`[data-cmt-pin="${IDS.palette}"]`);
  await expect(p).toHaveClass(/is-open/);

  await cardEl.getByRole('button', { name: 'Close' }).tap();
  await expect(sheet(page)).toHaveCount(0);
});

test('tapping a pin opens the sheet, with no hover preview; a reply posts from it', async ({ page }) => {
  const db = await seedComments(page);
  await openSeeded(page);
  // bring a pin into view the way a person would: from the list
  await island(page).tap();
  await page.locator('.cmt-list .cmt-list-row').filter({ hasText: 'Halcyon needs a second pass' }).tap();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Close' }).tap();
  await expect(sheet(page)).toHaveCount(0);

  const p = page.locator(`[data-cmt-pin="${IDS.mine}"]`);
  await expect(p).toBeInViewport();
  await p.tap();
  await expect(sheet(page).locator(`[data-cmt-card="${IDS.mine}"]`)).toBeVisible();
  await expect(page.locator('.cmt-canvas-card')).toHaveCount(0);
  await expect(page.locator('.cmt-pv')).toHaveCount(0);

  const input = sheet(page).locator('.cmt-foot textarea.cmt-input');
  await input.fill('Thanks, tomorrow is fine');
  await sheet(page).locator('.cmt-send').tap();
  await expect(sheet(page).locator('[data-cmt-row]')).toHaveCount(3);
  expect(db.rows.some((r) => r.body === 'Thanks, tomorrow is fine' && r.reply_to === IDS.mine)).toBe(true);
});

test('when the comment parts cannot be fetched: one reload, then a tap says so, no sheet, and the canvas stays', async ({ page }) => {
  await seedComments(page);
  await page.route(/\/components\/comments\/commentParts\.js/, (route) => route.abort());
  await openSeeded(page);
  const said = page.locator('.toast-msg').filter({ hasText: "Comments couldn't load. Check your connection." });
  const crashed = page.getByText("Couldn't load this page");
  // the island: the one reload a replaced chunk needs…
  const reloaded = page.waitForEvent('load');
  await island(page).tap();
  await reloaded;
  await page.locator('.canvas-wrap').waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('.cmt-pin[data-cmt-pin], .cmt-pin--count').first().waitFor({ state: 'attached', timeout: 30000 });
  // …then it says so, and is there to be pressed again
  await island(page).tap();
  await expect(said).toBeVisible();
  await expect(page.locator('.cmt-list')).toHaveCount(0);
  await expect(page.locator('.cmt-list-scrim')).toHaveCount(0);
  await expect(island(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('.cmt-sheet-scrim')).toHaveCount(0);
  await expect(crashed).toHaveCount(0);
  await expect(page.locator('.canvas-wrap')).toBeVisible();
});

test('someone who can only view: a reply to a resolved conversation is sent, and says it stayed resolved', async ({ page }) => {
  const db = await seedComments(page);
  await openSeeded(page, { query: '&filesrules=1&viewonly=1' });
  await island(page).tap();
  await page.locator('.cmt-list').getByRole('tab', { name: 'Resolved' }).tap();
  await page.locator('.cmt-list .cmt-list-row').filter({ hasText: 'Crop this frame tighter on the left' }).tap();
  const cardEl = sheet(page).locator(`[data-cmt-card="${IDS.resolved}"]`);
  await expect(cardEl).toBeVisible();
  const input = cardEl.locator('.cmt-foot textarea.cmt-input');
  await expect(input).toHaveAttribute('placeholder', /^Reply…/);
  await input.fill('Still loose on the left');
  await sheet(page).locator('.cmt-send').tap();
  await expect(page.locator('.toast-msg').filter({ hasText: 'Sent. Only an editor or the person who started this can reopen it.' })).toBeVisible();
  expect(db.rows.find((r) => r.id === IDS.resolved).resolved).toBe(true);
  expect(db.calls.filter((k) => k[0] === 'PATCH')).toEqual([]);
});


// A finger held on the canvas opens the canvas's menu. Held on a comment part
// it opens nothing of the canvas's: no menu, no card picked up or selected,
// and the part still answers the tap that follows.
test('a finger held on a pin, the island or the open conversation opens no canvas menu', async ({ page, browserName }) => {
  // the hold below is sent over a CDP session, which only Chromium has
  // (tests/touch/helpers.js needsHold): elsewhere it goes on the device checklist
  test.skip(browserName !== 'chromium',
    'a held finger needs CDP touch (Chromium); WebKit drops pointerType from synthesized ' +
    'PointerEvents — check this one on a real iPhone');
  await seedComments(page);
  await openSeeded(page);
  const menu = page.locator('.ctx-menu');
  const cdp = await page.context().newCDPSession(page);
  const hold = async (loc, ms = 800) => {
    const b = await loc.boundingBox();
    const pt = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
    await page.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
  };
  // the hold is a finger's, as the canvas's long-press listens for
  const held = page.evaluate(() => new Promise((res) => {
    let n = 0;
    const on = (e) => { if (e.pointerType === 'touch') n += 1; };
    window.addEventListener('pointerdown', on, true);
    setTimeout(() => { window.removeEventListener('pointerdown', on, true); res(n); }, 1500);
  }));
  await hold(island(page));
  expect(await held).toBeGreaterThan(0);
  await expect(menu).toHaveCount(0);
  // letting go of the island is still its press: the list, and only the list
  await expect(page.locator('.cmt-list')).toBeVisible();

  await page.locator('.cmt-list .cmt-list-row').filter({ hasText: 'Halcyon needs a second pass' }).tap();
  await expect(sheet(page)).toBeVisible();
  await hold(sheet(page).locator('.cmt-head'));
  await expect(menu).toHaveCount(0);
  await expect(sheet(page).locator(`[data-cmt-card="${IDS.mine}"]`)).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Close' }).tap();
  await expect(sheet(page)).toHaveCount(0);

  const p = page.locator(`[data-cmt-pin="${IDS.mine}"]`);
  await expect(p).toBeInViewport();
  await hold(p);
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.canvas-wrap [data-card-id].selected')).toHaveCount(0);
  await expect(page.locator('.canvas-wrap [data-card-id].is-lifted')).toHaveCount(0);
  // the pin is still a pin: letting go is its press, or the next tap is
  if (!(await sheet(page).count())) await p.tap();
  await expect(sheet(page).locator(`[data-cmt-card="${IDS.mine}"]`)).toBeVisible();
});

// An empty cluster on a phone: the first-card tiles fill the middle of the
// screen, where a comment left on the cluster sits. Its pin stays on top of
// them and opens; a tile beside it still answers.
test('a comment pin on an empty cluster sits over the first-card tiles and opens', async ({ page }) => {
  const now = new Date().toISOString();
  await seedComments(page, {
    rows: [{
      id: IDS.point, workspace_id: 'local-workspace', board_id: 'root', anchor_kind: 'point', anchor_id: null,
      anchor_x: 400, anchor_y: 300, doc_page_id: null, doc_from: null, doc_to: null, reply_to: null,
      hidden: false, resolved: false, offset_x: 0, offset_y: 0, deleted_at: null, updated_at: now, created_at: now,
      author: 'local-qa-user', body: 'Start the wall here',
    }],
  });
  await openSeeded(page, { query: '&blank=1', pins: 1 });
  const tiles = page.locator('.cnv-empty-tiles');
  await expect(tiles).toBeVisible();
  // put the pin in the middle of the screen, as opening it from the list does
  await island(page).tap();
  await page.locator('.cmt-list .cmt-list-row').filter({ hasText: 'Start the wall here' }).tap();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Close' }).tap();
  await expect(sheet(page)).toHaveCount(0);
  await expect(tiles).toBeVisible();

  const pin = page.locator(`[data-cmt-pin="${IDS.point}"]`);
  await expect(pin).toBeVisible();
  const at = await pin.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const t = document.querySelector('.cnv-empty-tiles').getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return {
      overTiles: x > t.left && x < t.right && y > t.top && y < t.bottom,
      top: !!document.elementFromPoint(x, y)?.closest('[data-cmt-pin]'),
    };
  });
  expect(at.overTiles, 'the pin is where the tiles are').toBe(true);
  expect(at.top, 'the pin is what a finger there touches').toBe(true);
  await pin.tap();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toContainText('Start the wall here');
  await sheet(page).getByRole('button', { name: 'Close' }).tap();
  await expect(sheet(page)).toHaveCount(0);

  // the tiles still take a tap of their own
  const note = tiles.getByRole('button', { name: 'Note' }).first();
  const hit = await note.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.cnv-empty-tiles');
  });
  expect(hit).toBe(true);
});
