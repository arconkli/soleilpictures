// move-to-cluster.spec.js — "Move to cluster…" on a card selection.
//
// The menu entry runs the SAME move a drop onto a cluster card runs
// (CanvasSurface's moveCardsIntoBoard): the target saves first, the source
// deletes only once it has. Live on the local harness, whose
// 'soleil-card-into-board-drop' listener is a reduced mirror of App.jsx's; the
// App.jsx half is pinned by source guard at the bottom.
//
// ?mixqa=3 seeds a bare Studio holding three images (mixqa-0..2), so the first
// project's references sit on the root — the case this menu exists for.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');

const card = (page, id) => page.locator(`.card[data-card-id="${id}"]`);

// Start a project from Home (it opens), then come back to the root.
async function withProject(page, name) {
  await page.goto('/?local=1&reset=1&blank=1&mixqa=3');
  await expect(card(page, 'mixqa-0')).toBeVisible();
  await page.locator('.sb-row', { hasText: 'Home' }).first().click();
  await page.locator('.ph-tile-new').click();
  await page.locator('.ph-new-input').fill(name);
  await page.locator('.ph-new-input').press('Enter');
  await expect(page.locator('.crumbs .crumb')).toHaveText(['Studio', name]);
  await page.locator('.crumbs .crumb', { hasText: 'Studio' }).click();
  await expect(card(page, 'mixqa-0')).toBeVisible();
}

// Record every move the canvas hands off, without changing what happens to it.
async function recordMoves(page) {
  await page.evaluate(() => {
    window.__moves = [];
    window.addEventListener('soleil-card-into-board-drop', (e) => {
      const d = e.detail || {};
      window.__moves.push({ source: d.sourceBoardId, target: d.targetBoardId, ids: (d.cards || []).map((c) => c.id), via: d.via });
    }, true);
  });
}

test.describe('move to cluster', () => {
  test('a card on the root moves into a project from the menu, and arrives there', async ({ page }) => {
    await withProject(page, 'Spec ad');
    await recordMoves(page);

    await card(page, 'mixqa-0').click({ button: 'right' });
    const item = page.locator('.ctx-menu .ctx-item', { hasText: 'Move to cluster…' });
    await expect(item).toBeVisible();
    await item.click();
    const sub = page.locator('.ctx-submenu');
    await expect(sub.locator('.ctx-item', { hasText: 'Spec ad' })).toBeVisible();
    // Never the cluster the card is already on.
    await expect(sub.locator('.ctx-item', { hasText: 'Studio' })).toHaveCount(0);
    await sub.locator('.ctx-item', { hasText: 'Spec ad' }).click();

    // The source loses exactly that card…
    await expect(card(page, 'mixqa-0')).toHaveCount(0);
    await expect(card(page, 'mixqa-1')).toBeVisible();
    await expect(card(page, 'mixqa-2')).toBeVisible();
    const moves = await page.evaluate(() => window.__moves);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ source: 'root', ids: ['mixqa-0'], via: 'menu' });

    // …and the project has it.
    await page.locator('.sb-row', { hasText: 'Home' }).first().click();
    await page.locator('.ph-grid .ph-tile', { hasText: 'Spec ad' }).click();
    await expect(page.locator('.crumbs .crumb')).toHaveText(['Studio', 'Spec ad']);
    await expect(page.locator('.card.card-kind-image')).toHaveCount(1);
  });

  test('when the destination cannot save, every card stays where it was', async ({ page }) => {
    await withProject(page, 'Spec ad');
    // Play the destination refusing: answer before the app's listener can.
    await page.evaluate(() => {
      window.addEventListener('soleil-card-into-board-drop', (e) => {
        e.stopImmediatePropagation();
        e.detail?.onTargetFailed?.(new Error('destination refused'));
      }, true);
    });

    await card(page, 'mixqa-0').click();
    await card(page, 'mixqa-1').click({ modifiers: ['Shift'] });
    await card(page, 'mixqa-1').click({ button: 'right' });
    const item = page.locator('.ctx-menu .ctx-item', { hasText: 'Move 2 cards to…' });
    await expect(item).toBeVisible();
    await item.click();
    await page.locator('.ctx-submenu .ctx-item', { hasText: 'Spec ad' }).click();

    await expect(page.locator('.toast')).toContainText('Move failed');
    await expect(card(page, 'mixqa-0')).toBeVisible();
    await expect(card(page, 'mixqa-1')).toBeVisible();
    await expect(card(page, 'mixqa-2')).toBeVisible();
  });

  test('a selection that mixes a cluster with other cards offers no card move', async ({ page }) => {
    await withProject(page, 'Spec ad');
    const cluster = page.locator('.card.card-kind-board', { hasText: 'Spec ad' }).first();
    await expect(cluster).toBeVisible();

    // A cluster alone still nests through its own entry.
    await cluster.click({ button: 'right' });
    await expect(page.locator('.ctx-menu .ctx-item', { hasText: 'Move to cluster…' })).toBeVisible();
    await page.keyboard.press('Escape');

    await card(page, 'mixqa-0').click();
    await cluster.click({ modifiers: ['Shift'] });
    await card(page, 'mixqa-0').click({ button: 'right' });
    await expect(page.locator('.ctx-menu').first()).toBeVisible();
    await expect(page.locator('.ctx-menu .ctx-item', { hasText: /^Move / })).toHaveCount(0);
  });
});

test.describe('move to cluster wiring (source guard)', () => {
  test('the drag and the menu run one move, so the menu keeps every guard the drag has', () => {
    const cs = read('src/components/CanvasSurface.jsx');
    // One hand-off to the target half, inside the shared function.
    expect((cs.match(/new CustomEvent\('soleil-card-into-board-drop'/g) || []).length).toBe(1);
    const fnAt = cs.indexOf('const moveCardsIntoBoard = async (');
    const dispatchAt = cs.indexOf("new CustomEvent('soleil-card-into-board-drop'");
    expect(fnAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeGreaterThan(fnAt);
    expect(cs).toMatch(/moveCardsIntoBoard\(dragIds, targetBoardId, movedCards\);/);
    expect(cs).toMatch(/moveCardsIntoBoard\(ids, t\.id, moving, \{ via: 'menu' \}\)/);
    // A group travels whole from the menu, as it does in a drag.
    expect(cs).toMatch(/const moving = \[\.\.\.expandWithGroupmates\(actingCards\.map\(cc => cc\.id\)\)\]/);
    // The source still deletes only after the target saved.
    const body = cs.slice(fnAt, cs.indexOf('const onCardPointerDown = (e, c) =>'));
    expect(body.indexOf('await targetSaved')).toBeGreaterThan(-1);
    expect(body.indexOf('await targetSaved')).toBeLessThan(body.indexOf('mutators.deleteCardsForMove?.(dragIds)'));
  });

  test('App.jsx logs the move once the destination has saved, saying which door', () => {
    const app = read('src/App.jsx');
    expect(app).toMatch(/onTargetSaved, onTargetFailed, via \} = e\.detail/);
    expect(app).toMatch(/ack\(\);\s*logEvent\(EV\.CARDS_MOVE, \{\s*via: via === 'menu' \? 'menu' : 'drag',/);
  });
});
