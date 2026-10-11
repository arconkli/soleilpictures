// CARDS-04: a shape's label only rendered for people who could edit it, so a
// labelled diagram reached a public /share link or a view-only member as bare
// rectangles. ?roqa=1 renders the local board with canEdit=false +
// isPublic=true (DEV-only, see lib/localMode.js); the labelled shape is planted
// in the saved local session first, then the page reloads read-only.

import { expect, test } from '@playwright/test';

const KEY = 'soleil.boards.local.session.v1';

async function plantShapes(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate((k) => !!localStorage.getItem(k), KEY)).toBe(true);
  await page.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k));
    const id = s.stack[s.stack.length - 1];
    const st = s.localState.boardState[id] || { cards: [], arrows: [], strokes: [] };
    st.cards = [
      ...(st.cards || []),
      { id: 'shape-labelled', kind: 'shape', shape: 'rect', x: 120, y: 120, w: 220, h: 140, label: 'Act 1' },
      { id: 'shape-bare', kind: 'shape', shape: 'ellipse', x: 400, y: 120, w: 160, h: 140 },
    ];
    s.localState.boardState[id] = st;
    localStorage.setItem(k, JSON.stringify(s));
  }, KEY);
}

test('view-only board: a shape shows its label', async ({ page }) => {
  await plantShapes(page);
  await page.goto('/?local=1&roqa=1');
  const labelled = page.locator('[data-card-id="shape-labelled"]');
  await expect(labelled).toBeVisible();
  await expect(labelled.locator('.shape-label')).toHaveText('Act 1');
  // Read-only: nothing to type into.
  await expect(labelled.locator('[contenteditable="true"]')).toHaveCount(0);
  // An unlabelled shape stays bare (no empty label box).
  await expect(page.locator('[data-card-id="shape-bare"] .shape-label')).toHaveCount(0);
});
