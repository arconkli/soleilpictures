// Selecting, cutting, copying, duplicating, and the top bar's cluster name:
//   - a cluster card can't be cut (it stays, and the toast says why)
//   - a pasted copy lands on top of every other card
//   - Duplicate of a grouped card makes a copy in a group of its own
//   - the current cluster's name in the top bar opens that cluster's menu;
//     Rename turns the name into a field
//
// The first test is the ?local=1 harness (its Studio has cluster cards); the
// rest are the real signed-in app (Supabase stubbed), whose mutators and top
// bar the harness does not run.
//
//   cd boards && PW_PORT=5291 npx playwright test tests/tools-select-copy.spec.js --project=desktop-chrome
import { expect, test } from '@playwright/test';
import { bootLocal, bootRealBoard, card, cardsOnCanvas, paste } from './tools-helpers.js';
import { ROOT_ID, WS_ID, USER_ID } from './helpers/signedInStub.js';

test.describe.configure({ timeout: 60_000 });

test('a cluster card can\'t be cut: it stays, and the toast says so', async ({ page }) => {
  await bootLocal(page);
  const cluster = card(page, 'b-features');
  await cluster.click({ position: { x: 6, y: 6 } });
  await expect(cluster).toHaveClass(/is-selected/);
  await page.keyboard.press('ControlOrMeta+x');
  await expect(page.locator('.toast', { hasText: /Clusters can.t be cut/ })).toBeVisible();
  await expect(cluster).toBeVisible();
});

// A note made the way a paste of words makes one, at the pointer.
async function noteAt(page, text, at) {
  const before = await cardsOnCanvas(page).count();
  await paste(page, { at, text });
  await expect(cardsOnCanvas(page)).toHaveCount(before + 1);
}
// The card holding `text`.
const noteOf = (page, text) => cardsOnCanvas(page).filter({ hasText: text });
// A press at a card's top-left corner: on it, but clear of a card lying over its lower right.
async function pressCorner(page, text) {
  const b = await noteOf(page, text).boundingBox();
  await page.mouse.click(b.x + 6, b.y + 6);
}

test('a pasted copy lands on top of every other card, even when the original sat under one', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await bootRealBoard(page);
  await noteAt(page, 'under', { x: 300, y: 250 });
  await noteAt(page, 'above', { x: 360, y: 290 });   // over the lower right of 'under'
  await pressCorner(page, 'under');
  await expect(noteOf(page, 'under')).toHaveClass(/is-selected/);
  await page.keyboard.press('ControlOrMeta+c');
  await page.mouse.move(900, 500);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(cardsOnCanvas(page)).toHaveCount(3);
  // Stacking is the DOM order of the cards (sorted by z): the pasted one, the
  // selected card now, comes last.
  const order = await cardsOnCanvas(page).evaluateAll((els) => els.map((el) => ({
    text: el.textContent.trim(), selected: el.classList.contains('is-selected'),
  })));
  expect(order.map((c) => c.selected)).toEqual([false, false, true]);
  expect(order[2].text).toContain('under');
});

test('Duplicate of a grouped card makes a copy in a new group: dragging the copy leaves the original', async ({ page }) => {
  await bootRealBoard(page);
  await noteAt(page, 'alpha', { x: 300, y: 250 });
  await noteAt(page, 'bravo', { x: 800, y: 250 });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+g');   // one group of both
  await page.locator('.canvas-wrap').click({ position: { x: 1000, y: 640 } });
  await pressCorner(page, 'alpha');
  await expect(noteOf(page, 'alpha')).toHaveClass(/is-selected/);

  const idsBefore = await cardsOnCanvas(page).evaluateAll((els) => els.map((el) => el.dataset.cardId));
  const originals = {};
  for (const text of ['alpha', 'bravo']) {
    const el = noteOf(page, text);
    originals[text] = { id: await el.getAttribute('data-card-id'), box: await el.boundingBox() };
  }
  await page.keyboard.press('ControlOrMeta+d');
  // The whole group is copied (a copy of each), however the click picked it.
  await expect.poll(() => cardsOnCanvas(page).count()).toBeGreaterThan(idsBefore.length);

  // The copy of 'alpha' (a new card, the selected one) is on top of the original.
  const copy = cardsOnCanvas(page).filter({ hasText: 'alpha' }).and(page.locator('.is-selected'));
  await expect(copy).toHaveCount(1);
  const copyId = await copy.getAttribute('data-card-id');
  expect(idsBefore).not.toContain(copyId);
  const cb = await copy.boundingBox();
  const from = { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x, from.y + i * 20);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();

  await expect.poll(async () => (await card(page, copyId).boundingBox()).y).toBeGreaterThan(cb.y + 150);
  for (const text of ['alpha', 'bravo']) {
    const now = await card(page, originals[text].id).boundingBox();
    // Within 2px (a drag of the copy carries a dragged original 240px): the
    // first read can catch a card still settling from its own placement.
    expect(Math.abs(now.x - originals[text].box.x), `${text} x`).toBeLessThanOrEqual(2);
    expect(Math.abs(now.y - originals[text].box.y), `${text} y`).toBeLessThanOrEqual(2);
  }
});

test.describe('the cluster name in the top bar', () => {
  const crumb = (page) => page.locator('.crumbs .crumb.here:not(.crumb-edit)').first();
  const field = (page) => page.locator('.crumbs input.crumb-edit');
  const menu = (page) => page.locator('.ctx-menu:not(.ctx-submenu)');

  // The stubbed server keeps the root's name, so a rename shows on the refresh that follows it.
  async function bootNamed(page) {
    let name = 'Studio';
    const root = () => ({
      id: ROOT_ID, workspace_id: WS_ID, parent_board_id: null, deleted_at: null, name,
      kind: 'canvas', created_by: USER_ID, created_at: '2026-10-01T00:00:00Z',
    });
    await bootRealBoard(page, {
      rest: { boards: (url, method) => (method === 'GET' ? [root()] : []) },
      rpc: { rename_board: (body) => { name = body?.p_name ?? name; return null; } },
    });
    await expect(crumb(page)).toHaveText('Studio');
  }

  async function openRename(page) {
    await crumb(page).click();
    await expect(menu(page)).toBeVisible();
    await menu(page).getByRole('menuitem', { name: /^Rename/ }).click();
    await expect(field(page)).toBeFocused();
  }

  test('clicking it opens the cluster\'s menu: Rename and Star, no Open', async ({ page }) => {
    await bootNamed(page);
    await crumb(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('menuitem', { name: /^Rename/ })).toBeVisible();
    await expect(menu(page).getByRole('menuitem', { name: /^(Star|Unstar)$/ })).toBeVisible();
    await expect(menu(page).getByRole('menuitem', { name: /^Open/ })).toHaveCount(0);
  });

  test('Rename turns the name into a field with the name selected; a new name and Enter show in the crumb', async ({ page }) => {
    await bootNamed(page);
    await openRename(page);
    const selected = await field(page).evaluate((el) => [el.selectionStart, el.selectionEnd, el.value.length]);
    expect(selected).toEqual([0, 'Studio'.length, 'Studio'.length]);
    await page.keyboard.type('Reel one');
    await page.keyboard.press('Enter');
    await expect(field(page)).toHaveCount(0);
    await expect(crumb(page)).toHaveText('Reel one');
  });

  test('Escape cancels the rename', async ({ page }) => {
    await bootNamed(page);
    await openRename(page);
    await page.keyboard.type('Never saved');
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveCount(0);
    await expect(crumb(page)).toHaveText('Studio');
  });
});
