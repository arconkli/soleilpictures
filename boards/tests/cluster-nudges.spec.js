// cluster-nudges.spec.js — making a cluster from what is already on the canvas.
//
// Everything here sits behind clusterNudgesAllowed() (lib/appHost.js): the
// preview deploy sees it, production doesn't, and on dev it is opt-in through
// localStorage soleil.dev.clusterNudges, so other sessions' specs never meet it.
// The first test pins that hold.
//
// ?mixqa=3 seeds a bare Studio holding three images (mixqa-0..2) and no other
// cluster — the pile this feature exists for. The move itself is the one
// "Move to cluster…" runs (move-to-cluster.spec.js); the local harness mirrors
// App.jsx's listener, so the undo that trashes the new cluster is checked on
// the preview deploy.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');

const card = (page, id) => page.locator(`.card[data-card-id="${id}"]`);
const optIn = (page) => page.addInitScript(() => {
  try { window.localStorage.setItem('soleil.dev.clusterNudges', '1'); } catch (_) {}
});

async function studio(page) {
  await page.goto('/?local=1&reset=1&blank=1&mixqa=3');
  await expect(card(page, 'mixqa-0')).toBeVisible();
}

// Record every move the canvas hands off, without changing what happens to it.
async function recordMoves(page) {
  await page.evaluate(() => {
    window.__moves = [];
    window.addEventListener('soleil-card-into-board-drop', (e) => {
      const d = e.detail || {};
      window.__moves.push({ ids: (d.cards || []).map((c) => c.id), created: d.createdBoardId || null, name: d.createdBoardName || null });
    }, true);
  });
}

async function nameIt(page, name, { expectMessage } = {}) {
  const dialog = page.locator('.feedback-dialog');
  await expect(dialog.locator('.feedback-title')).toHaveText('Name this cluster');
  if (expectMessage) await expect(dialog.locator('.feedback-message')).toHaveText(expectMessage);
  await dialog.locator('.feedback-field input').fill(name);
  await dialog.locator('.btn-primary').click();
}

test.describe('cluster nudges', () => {
  test('held: without the opt-in nothing new appears', async ({ page }) => {
    await studio(page);
    // The rail's Cluster tool keeps its plain tip and its old icon.
    const tool = page.locator('.cnv-tool[data-tour="cluster-tool"]');
    await expect(tool).toHaveAttribute('data-tip', 'Add cluster');
    await expect(tool.locator('.cnv-tool-card')).toHaveCount(0);
    await expect(page.locator('.tb-newcluster')).toHaveCount(0);
    await card(page, 'mixqa-0').click({ button: 'right' });
    await expect(page.locator('.ctx-menu')).toBeVisible();
    await expect(page.locator('.ctx-menu .ctx-item', { hasText: 'new cluster' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await card(page, 'mixqa-0').click();
    await card(page, 'mixqa-1').click({ modifiers: ['Shift'] });
    await card(page, 'mixqa-1').click({ button: 'right' });
    await expect(page.locator('.ctx-menu .ctx-item', { hasText: /^New cluster from/ })).toHaveCount(0);
    // The empty Studio's panel keeps its old ending.
    await page.goto('/?local=1&reset=1&blank=1');
    await expect(page.locator('.cnv-empty-tiles')).toBeVisible();
    await expect(page.locator('.cnv-empty-clusters')).toHaveCount(0);
  });

  test('one card with nowhere to go: "Move to a new cluster…" makes the cluster it goes into', async ({ page }) => {
    await optIn(page);
    await studio(page);
    await recordMoves(page);
    await card(page, 'mixqa-0').click({ button: 'right' });
    await page.locator('.ctx-menu .ctx-item', { hasText: 'Move to a new cluster…' }).click();
    await nameIt(page, 'Kitchen refs', { expectMessage: 'The card moves into it. Undo puts it back.' });

    await expect(card(page, 'mixqa-0')).toHaveCount(0);
    await expect(card(page, 'mixqa-1')).toBeVisible();
    await expect(page.locator('.card.card-kind-board', { hasText: 'Kitchen refs' })).toHaveCount(1);
    const moves = await page.evaluate(() => window.__moves);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ ids: ['mixqa-0'], name: 'Kitchen refs' });
    expect(moves[0].created).toBeTruthy();
  });

  test('a selection: "New cluster from 2 cards" sits beside Group, and cancelling makes nothing', async ({ page }) => {
    await optIn(page);
    await studio(page);
    await recordMoves(page);
    await card(page, 'mixqa-0').click();
    await card(page, 'mixqa-1').click({ modifiers: ['Shift'] });
    await card(page, 'mixqa-1').click({ button: 'right' });
    await expect(page.locator('.ctx-menu .ctx-item', { hasText: 'Group (2)' })).toBeVisible();
    const item = page.locator('.ctx-menu .ctx-item', { hasText: 'New cluster from 2 cards' });
    await expect(item).toBeVisible();

    // Cancel first: no cluster, nothing moved.
    await item.click();
    await page.locator('.feedback-dialog .btn-secondary', { hasText: 'Cancel' }).click();
    await expect(page.locator('.card.card-kind-board')).toHaveCount(0);
    await expect(card(page, 'mixqa-0')).toBeVisible();
    expect(await page.evaluate(() => window.__moves.length)).toBe(0);

    // Start the selection over (both cards are still selected).
    await page.locator('.canvas-wrap').first().click({ position: { x: 900, y: 650 } });
    await card(page, 'mixqa-0').click();
    await card(page, 'mixqa-1').click({ modifiers: ['Shift'] });
    await card(page, 'mixqa-1').click({ button: 'right' });
    await page.locator('.ctx-menu .ctx-item', { hasText: 'New cluster from 2 cards' }).click();
    await nameIt(page, 'Diner', { expectMessage: 'The 2 cards move into it. Undo puts them back.' });
    await expect(card(page, 'mixqa-0')).toHaveCount(0);
    await expect(card(page, 'mixqa-1')).toHaveCount(0);
    await expect(card(page, 'mixqa-2')).toBeVisible();
    await expect(page.locator('.card.card-kind-board', { hasText: 'Diner' })).toHaveCount(1);

    // The cards arrived inside it.
    await page.locator('.card.card-kind-board', { hasText: 'Diner' }).dblclick();
    await expect(page.locator('.crumbs .crumb')).toHaveText(['Studio', 'Diner']);
    await expect(page.locator('.card.card-kind-image')).toHaveCount(2);
  });

  test('C picks the Cluster tool, and the tool says what a cluster is', async ({ page }) => {
    await optIn(page);
    await studio(page);
    // A pause on the tool opens a card instead of the plain tip; picking the
    // tool closes it, and the hint below the toolbar takes over.
    const tool = page.locator('.cnv-tool[data-tour="cluster-tool"]');
    await expect(tool).not.toHaveAttribute('data-tip', /.*/);
    await tool.hover();
    const hoverCard = tool.locator('.cnv-tool-card');
    await expect(hoverCard).toBeVisible();
    await expect(hoverCard).toContainText('A canvas inside this one. Make one per project, then drop cards onto it to file them.');
    await expect(hoverCard.locator('kbd')).toHaveText('C');
    await page.mouse.move(900, 600);
    await expect(hoverCard).toBeHidden();
    await page.locator('.canvas-wrap').first().click({ position: { x: 900, y: 600 } });
    await page.keyboard.press('c');
    await expect(page.locator('.cnv-hint')).toContainText('Click to place a cluster: a canvas inside this one. Drop cards onto it to file them.');
    await page.keyboard.press('Escape');
  });

  test('double-click offers a Cluster', async ({ page }) => {
    await optIn(page);
    await studio(page);
    await page.locator('.canvas-wrap').first().dblclick({ position: { x: 900, y: 650 } });
    await expect(page.locator('.cnv-quick-add .cnv-quick-add-lbl', { hasText: 'Cluster' })).toBeVisible();
  });

  test('the top bar: "+ New cluster" with nothing picked lands beside the pile, named, and opens', async ({ page }) => {
    await optIn(page);
    await studio(page);
    const btn = page.locator('.topbar .tb-newcluster');
    await expect(btn).toHaveText('New cluster');
    await expect(btn.locator('.ncl-count')).toHaveCount(0);
    await btn.click();
    const pop = page.locator('.ncl-pop');
    await expect(pop.locator('.ncl-pop-h')).toHaveText('Name this cluster');
    await expect(pop.locator('.ncl-help')).toHaveText('It lands on Studio as a card and opens, ready to fill.');
    await expect(pop.locator('.ncl-field')).toBeFocused();
    await pop.locator('.ncl-field').fill('Short film');
    await page.keyboard.press('Enter');
    await expect(pop).toHaveCount(0);
    await expect(page.locator('.crumbs .crumb')).toHaveText(['Studio', 'Short film']);

    // Back on Studio: the pile is untouched and the cluster sits to its right.
    await page.locator('.crumbs .crumb', { hasText: 'Studio' }).click();
    const made = page.locator('.card.card-kind-board', { hasText: 'Short film' });
    await expect(made).toHaveCount(1);
    await expect(page.locator('.card.card-kind-image')).toHaveCount(3);
    const pileRight = Math.max(...await Promise.all(['mixqa-0', 'mixqa-1', 'mixqa-2'].map(async (id) => {
      const b = await card(page, id).boundingBox();
      return b.x + b.width;
    })));
    expect((await made.boundingBox()).x).toBeGreaterThan(pileRight);
  });

  test('the top bar: with cards picked it counts them and files them in, staying put', async ({ page }) => {
    await optIn(page);
    await studio(page);
    await recordMoves(page);
    await card(page, 'mixqa-0').click();
    await card(page, 'mixqa-1').click({ modifiers: ['Shift'] });
    const btn = page.locator('.topbar .tb-newcluster');
    await expect(btn.locator('.ncl-count')).toHaveText('2');
    await btn.click();
    const pop = page.locator('.ncl-pop');
    await expect(pop.locator('.ncl-help')).toHaveText('The 2 cards you picked move into it. Undo puts them back.');
    await pop.locator('.ncl-field').fill('Diner');
    await pop.locator('.ncl-create').click();

    await expect(card(page, 'mixqa-0')).toHaveCount(0);
    await expect(card(page, 'mixqa-1')).toHaveCount(0);
    await expect(card(page, 'mixqa-2')).toBeVisible();
    await expect(page.locator('.card.card-kind-board', { hasText: 'Diner' })).toHaveCount(1);
    await expect(page.locator('.crumbs .crumb')).toHaveText(['Studio']);
    await expect(btn.locator('.ncl-count')).toHaveCount(0);
    const moves = await page.evaluate(() => window.__moves);
    expect(moves).toHaveLength(1);
    expect(moves[0].ids.sort()).toEqual(['mixqa-0', 'mixqa-1']);
    expect(moves[0]).toMatchObject({ name: 'Diner' });
    expect(moves[0].created).toBeTruthy();
  });

  test('the top bar popover: Escape and Cancel make nothing, and keys typed there never reach the canvas', async ({ page }) => {
    await optIn(page);
    await studio(page);
    await card(page, 'mixqa-0').click();
    const btn = page.locator('.topbar .tb-newcluster');
    await expect(btn.locator('.ncl-count')).toHaveText('1');
    await btn.click();
    const pop = page.locator('.ncl-pop');
    await expect(pop.locator('.ncl-help')).toHaveText('The card you picked moves into it. Undo puts it back.');
    // Backspace on a focused button in the popover is not the canvas's Delete.
    await page.keyboard.press('Tab');
    await expect(pop.locator('.ncl-cancel')).toBeFocused();
    await page.keyboard.press('Backspace');
    await expect(card(page, 'mixqa-0')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(btn).toBeFocused();
    await btn.click();
    await pop.locator('.ncl-cancel').click();
    await expect(pop).toHaveCount(0);
    await expect(page.locator('.card.card-kind-board')).toHaveCount(0);
    await expect(card(page, 'mixqa-0')).toBeVisible();
  });

  test('the empty Studio ends with a line about clusters that opens the bar\'s popover', async ({ page }) => {
    await optIn(page);
    await page.goto('/?local=1&reset=1&blank=1');
    const line = page.locator('.cnv-empty-tiles .cnv-empty-clusters');
    await expect(line).toContainText('Working on more than one thing?');
    await line.locator('button', { hasText: 'Start a cluster for each' }).click();
    const pop = page.locator('.ncl-pop');
    await expect(pop.locator('.ncl-help')).toHaveText('It lands on Studio as a card and opens, ready to fill.');
    await expect(pop.locator('.ncl-field')).toBeFocused();
    await pop.locator('.ncl-field').fill('Music video');
    await page.keyboard.press('Enter');
    await expect(page.locator('.crumbs .crumb')).toHaveText(['Studio', 'Music video']);
    // Inside a cluster the empty panel has no such line: it is Studio's alone.
    await expect(page.locator('.cnv-empty-tiles')).toBeVisible();
    await expect(page.locator('.cnv-empty-clusters')).toHaveCount(0);
  });

  // The App.jsx half the local harness doesn't mirror: the toast names the
  // cluster that was just made (its `boards` can predate it), and the toast's
  // undo trashes that cluster before the source reloads, then drops its card.
  test('App: the toast names a made cluster and its undo trashes it', () => {
    const app = read('src/App.jsx');
    const drop = app.slice(app.indexOf('const onDrop = async (e) => {'), app.indexOf("document.addEventListener('soleil-card-into-board-drop', onDrop);"));
    expect(drop).toMatch(/createdBoardId = null, createdBoardName = null \} = e\.detail/);
    expect(drop).toMatch(/const targetName = createdBoardName \|\| boards\[targetBoardId\]\?\.name \|\| 'cluster';/);
    expect(drop).toMatch(/Made “\$\{targetName\}” from \$\{movedCards\.length\} cards/);
    const undo = drop.slice(drop.indexOf('onUndo: async () => {'));
    const trash = undo.indexOf('await deleteBoard(createdBoardId);');
    expect(trash).toBeGreaterThan(-1);
    expect(trash).toBeLessThan(undo.indexOf('// 2) Restore the originals on the SOURCE'));
    expect(undo).toMatch(/if \(createdBoardId && cm\.has\(createdBoardId\)\) cm\.delete\(createdBoardId\);/);
  });
});
