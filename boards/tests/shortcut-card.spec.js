// A live shortcut to a file shared with you (components/cards/ShortcutCard.jsx)
// and the ways one is made. Driven through the DEV harness
// (?fileshareqa=shortcuts | shared-page | overlay, src/local/FileShareQaHarness.jsx):
// each card resolves its share as the viewer sees it, from a fake /file-share.
//
//   PW_PORT=5291 npx playwright test tests/shortcut-card.spec.js --project=desktop-chrome
import { expect, test } from '@playwright/test';

const TOKEN = '0f9a5c3e-1b2d-4e5f-8a9b-0c1d2e3f4a5b';
const PUBLIC = '5c000000-0000-4000-8000-000000000005';

async function open(page, fixture) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?fileshareqa=${fixture}`);
  await page.waitForSelector('[data-fileshareqa-ready]', { state: 'attached' });
}
const calls = (page, fn) => page.evaluate((f) => window.__fileShareQa.calls.filter((c) => c.fn === f), fn);
const card = (page, k) => page.locator(`[data-shortcut-fixture="${k}"] .sc-card`);

test.describe('a shortcut card', () => {
  test('shows the file as the share shows it to whoever is looking', async ({ page }) => {
    await open(page, 'shortcuts');
    await expect(card(page, 'ok')).toHaveAttribute('data-shortcut-state', 'ok');
    await expect(card(page, 'ok').locator('.sc-name')).toHaveText('Look book');
    await expect(card(page, 'ok').locator('.sc-sub')).toHaveText('Image · Shared by Rae Okafor');
    await expect(card(page, 'ok').locator('img')).toHaveAttribute('src', /film-noir-look-book/);
    await expect(card(page, 'doc').locator('.sc-name')).toHaveText('Pilot, revisions');
    await expect(card(page, 'doc').locator('.sc-sub')).toHaveText('Doc · Shared by Rae Okafor');
  });

  test('someone it was not shared with sees a neutral tile, never the name', async ({ page }) => {
    await open(page, 'shortcuts');
    const c = card(page, 'noAccess');
    await expect(c).toHaveAttribute('data-shortcut-state', 'no_access');
    await expect(c.locator('.sc-empty-title')).toHaveText('Shared file');
    await expect(c).toContainText('Only the people it was shared with can open it.');
    await expect(c.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  });

  test('a stopped share stays as "No longer shared", with Remove', async ({ page }) => {
    await open(page, 'shortcuts');
    const c = card(page, 'gone');
    await expect(c).toHaveAttribute('data-shortcut-state', 'gone');
    await expect(c.locator('.sc-empty-title')).toHaveText('No longer shared');
    await c.getByRole('button', { name: 'Remove' }).click();
    await expect.poll(async () => (await calls(page, 'onRemove')).map((x) => x.args[0])).toEqual(['gone']);
  });

  test('on a public board nothing is asked, and the tile is neutral', async ({ page }) => {
    await open(page, 'shortcuts');
    await expect(card(page, 'public').locator('.sc-empty-title')).toHaveText('Shared file');
    const asked = (await calls(page, 'fetchFileShare')).map((x) => x.args[0]);
    expect(asked).not.toContain(PUBLIC);
  });
});

test.describe('making a shortcut', () => {
  test('from Shared with me: "Add shortcut…" asks the app for the file', async ({ page }) => {
    await open(page, 'shared-page');
    await page.locator('.shp-row').first().getByRole('button', { name: /More for Opening titles v3/ }).click();
    await page.getByRole('menuitem', { name: 'Add shortcut…' }).click();
    await expect.poll(async () => (await calls(page, 'onAddShortcut')).map((x) => x.args[1])).toEqual(['video']);
  });

  test('from the in-app viewer: Add to cluster → Add shortcut', async ({ page }) => {
    await open(page, 'overlay');
    await page.getByRole('button', { name: 'Open shared file' }).click();
    const dialog = page.getByRole('dialog', { name: 'Shared file' });
    await dialog.getByRole('button', { name: 'Add to cluster' }).click();
    await page.getByRole('menuitem', { name: /Add shortcut/ }).click();
    await expect.poll(async () => (await calls(page, 'onAddShortcut')).map((x) => x.args)).toEqual([[TOKEN, 'video']]);
  });
});
