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
    await card(page, 'mixqa-0').click({ button: 'right' });
    await expect(page.locator('.ctx-menu')).toBeVisible();
    await expect(page.locator('.ctx-menu .ctx-item', { hasText: 'new cluster' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await card(page, 'mixqa-0').click();
    await card(page, 'mixqa-1').click({ modifiers: ['Shift'] });
    await card(page, 'mixqa-1').click({ button: 'right' });
    await expect(page.locator('.ctx-menu .ctx-item', { hasText: /^New cluster from/ })).toHaveCount(0);
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
