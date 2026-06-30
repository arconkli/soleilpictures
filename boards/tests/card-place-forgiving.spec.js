// A place tool that's armed should drop a card wherever you click — INCLUDING
// on top of an existing card. Before the fix, clicking a card with a tool armed
// dead-ended in a "Click an empty spot…" toast and created nothing
// (card_create_blocked: place_miss) — the single friction the activation data
// surfaced. See CanvasSurface onCardPointerDown / placeToolAt.
import { expect, test } from '@playwright/test';

const cardIds = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.card[data-card-id]'))
      .map((el) => el.getAttribute('data-card-id')));

test.describe('forgiving tool placement', () => {
  test('Note tool + click ON a card still places a note (no dead-end toast)', async ({ page }) => {
    page.on('pageerror', (e) => { throw e; });
    await page.goto('/?local=1&reset=1');
    await expect(page.locator('.canvas-wrap')).toBeVisible();
    // Need a seeded card to mis-click on.
    await expect.poll(async () => (await cardIds(page)).length).toBeGreaterThan(0);
    const before = await cardIds(page);

    // Arm the Note tool from the left rail.
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();

    // Click just inside the top-left corner of a seeded card (card chrome, not
    // its editable centre) — a place tool is armed, so this used to be a miss.
    const card = page.locator('.card[data-card-id]').first();
    const box = await card.boundingBox();
    expect(box, 'a seeded card should be on screen').not.toBeNull();
    await page.mouse.click(box.x + 8, box.y + 8);

    // A note was placed at the click, and the dead-end toast never appeared.
    await expect.poll(async () => (await cardIds(page)).length).toBe(before.length + 1);
    await expect(page.getByText(/click an empty spot/i)).toHaveCount(0);
  });
});
