// mobile/cluster-nudges.spec.js — on a phone, "New cluster" leads the + sheet.
//
// The desktop bar's "+ New cluster" has no room in a phone's bar (SHELL-06),
// so the sheet the bottom-nav "+" opens carries it as a full-width row above
// the tiles, and the Cluster tile goes. Behind clusterNudgesAllowed(): on dev
// it is opt-in through localStorage soleil.dev.clusterNudges, so the held
// sheet (create-button.spec.js) is untouched. ?mixqa=3 puts three images on a
// bare Studio, so the "+" opens the sheet rather than the photo picker an
// empty board gets.
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome' || testInfo.project.name === 'tablet',
    'phone-width only (≤640px)');
  await page.addInitScript(() => {
    try { window.localStorage.setItem('soleil.dev.clusterNudges', '1'); } catch (_) {}
  });
  await page.goto('/?local=1&reset=1&blank=1&mixqa=3');
  await expect(page.locator('.card[data-card-id="mixqa-0"]')).toBeVisible();
});

test('the + sheet leads with New cluster, and its tile is gone', async ({ page }) => {
  await page.locator('.mb-nav-create').tap();
  const sheet = page.locator('.sheet-panel');
  await expect(sheet).toBeVisible();
  const row = sheet.locator('.mobile-add-cluster');
  await expect(row).toContainText('New cluster');
  await expect(row).toContainText('A canvas inside this one. Make one per project.');
  const grid = sheet.locator('.mobile-add-grid');
  await expect(grid.getByRole('button', { name: 'Cluster', exact: true })).toHaveCount(0);
  await expect(grid.locator('.mobile-add-tile').first()).toContainText('Photos');
  // The row sits above the tiles — both measured in one frame, since the
  // sheet is still sliding up.
  const [rowBottom, gridTop] = await page.evaluate(() => [
    document.querySelector('.sheet-panel .mobile-add-cluster').getBoundingClientRect().bottom,
    document.querySelector('.sheet-panel .mobile-add-grid').getBoundingClientRect().top,
  ]);
  expect(rowBottom).toBeLessThanOrEqual(gridTop + 0.5);
  // No top-bar pill on a phone.
  await expect(page.locator('.tb-newcluster')).toHaveCount(0);
});

test('the row names the cluster first, then opens it', async ({ page }) => {
  await page.locator('.mb-nav-create').tap();
  await page.locator('.sheet-panel .mobile-add-cluster').tap();
  await expect(page.locator('.sheet-panel')).toHaveCount(0);
  const dialog = page.locator('.feedback-dialog');
  await expect(dialog.locator('.feedback-title')).toHaveText('Name this cluster');
  await expect(dialog.locator('.feedback-message')).toHaveText('It lands on Studio as a card and opens, ready to fill.');
  await dialog.locator('.feedback-field input').fill('Short film');
  await dialog.locator('.btn-primary').tap();
  await expect(page.locator('.crumbs .crumb.here')).toHaveText('Short film');
});

test('the empty Studio\'s line asks the name in the prompt, with no bar to hang a popover from', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  const line = page.locator('.cnv-empty-tiles .cnv-empty-clusters button');
  await expect(line).toHaveText('Start a cluster for each');
  await line.tap();
  const dialog = page.locator('.feedback-dialog');
  await expect(dialog.locator('.feedback-message')).toHaveText('It lands on Studio as a card and opens, ready to fill.');
  await dialog.locator('.feedback-field input').fill('Music video');
  await dialog.locator('.btn-primary').tap();
  await expect(page.locator('.crumbs .crumb.here')).toHaveText('Music video');
});

test('the Studio bar on a phone: the sweep asks the name in the prompt', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1&mixqa=8');
  const bar = page.locator('.cnv-studio-bar');
  await expect(bar.locator('.cnv-studio-bar-txt')).toContainText('8 loose cards');
  await expect(bar.locator('.cnv-studio-bar-where')).toBeHidden();
  await bar.locator('.cnv-studio-bar-go').tap();
  const dialog = page.locator('.feedback-dialog');
  await expect(dialog.locator('.feedback-message')).toHaveText('All 8 loose cards move into it. Undo puts them back.');
  await dialog.locator('.feedback-field input').fill('Lost Time');
  await dialog.locator('.btn-primary').tap();
  await expect(page.locator('.card.card-kind-image')).toHaveCount(0);
  await expect(page.locator('.card.card-kind-board', { hasText: 'Lost Time' })).toHaveCount(1);
});

test('the second idea on a phone: the toast\'s New cluster asks the name in the prompt', async ({ page }) => {
  // An old pile (mixqa's cards carry no createdAt) without the Studio bar's
  // own offer, and a note pasted onto it.
  await page.addInitScript(() => {
    try { window.localStorage.setItem('soleil.hint.studio_bar', '1'); } catch (_) {}
  });
  await page.goto('/?local=1&reset=1&blank=1&mixqa=8');
  await expect(page.locator('.card[data-card-id="mixqa-7"]')).toBeVisible();
  await page.evaluate(() => {
    window.__moves = [];
    window.addEventListener('soleil-card-into-board-drop', (e) => {
      window.__moves.push((e.detail?.cards || []).map((c) => c.id));
    }, true);
  });
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Scout the diner on 5th');
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const toast = page.locator('.toast', { hasText: 'New idea?' });
  await expect(toast).toContainText('New idea? Give this card its own cluster.');
  await toast.locator('.toast-action', { hasText: 'New cluster' }).tap();
  const dialog = page.locator('.feedback-dialog');
  await expect(dialog.locator('.feedback-message')).toHaveText('The card you picked moves into it. Undo puts it back.');
  await dialog.locator('.feedback-field input').fill('Diner');
  await dialog.locator('.btn-primary').tap();
  await expect(page.locator('.card.card-kind-board', { hasText: 'Diner' })).toHaveCount(1);
  await expect(page.locator('.card.card-kind-note')).toHaveCount(0);
  // Only the note went in. (The pile is counted from the move, not the DOM:
  // the viewport cull unmounts what a phone's screen can't show.)
  const moves = await page.evaluate(() => window.__moves);
  expect(moves).toHaveLength(1);
  expect(moves[0]).toHaveLength(1);
  expect(moves[0][0].startsWith('mixqa-')).toBe(false);
});
