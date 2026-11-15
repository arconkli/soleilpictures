// What happens to a file once it's shared: the Shared page (with me / by me)
// and the in-app viewer the bell, the page and a shortcut open. Driven through
// the DEV harness (?fileshareqa=shared-page | overlay, src/local/
// FileShareQaHarness.jsx): the real components over a fake of 0424's RPCs.
//
//   PW_PORT=5231 npx playwright test tests/shared-page.spec.js --project=desktop-chrome
import { expect, test } from '@playwright/test';

const TOKEN = '0f9a5c3e-1b2d-4e5f-8a9b-0c1d2e3f4a5b';

async function open(page, fixture) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?fileshareqa=${fixture}`);
  await page.waitForSelector('[data-fileshareqa-ready]', { state: 'attached' });
}
const calls = (page, fn) => page.evaluate((f) => window.__fileShareQa.calls.filter((c) => c.fn === f), fn);

test.describe('the Shared page', () => {
  test('lists what was shared with you, newest first, with who and how', async ({ page }) => {
    await open(page, 'shared-page');
    const rows = page.locator('.shp-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Opening titles v3');
    await expect(rows.nth(0)).toContainText('Shared by Rae Okafor');
    await expect(rows.nth(0)).toHaveClass(/is-unread/);
    await expect(rows.nth(0).getByLabel('New')).toBeVisible();
    await expect(rows.nth(1)).not.toHaveClass(/is-unread/);
    await expect(rows.nth(2)).toContainText('Opened from a link');
    // No gold at rest: the unread dot is neutral ink.
    const dot = await rows.nth(0).locator('.shp-dot').evaluate((el) => getComputedStyle(el).backgroundColor);
    const gold = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--soleil)';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(dot).not.toBe(gold);
  });

  test('taking a file off the list asks the server, and Undo puts it back', async ({ page }) => {
    await open(page, 'shared-page');
    const first = page.locator('.shp-row').first();
    await first.getByRole('button', { name: /More for Opening titles v3/ }).click();
    await page.getByRole('menuitem', { name: 'Remove from Shared with me' }).click();
    await expect(page.locator('.shp-row')).toHaveCount(2);
    await expect.poll(async () => (await calls(page, 'hideSharedFile')).map((c) => c.args[1])).toEqual([true]);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.shp-row')).toHaveCount(3);
    await expect.poll(async () => (await calls(page, 'hideSharedFile')).map((c) => c.args[1])).toEqual([true, false]);
  });

  test('Save a copy is offered only where the sharer allows downloading', async ({ page }) => {
    await open(page, 'shared-page');
    await page.locator('.shp-row').nth(1).getByRole('button', { name: /More for Shooting script/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Save a copy…' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('.shp-row').nth(0).getByRole('button', { name: /More for Opening titles v3/ }).click();
    await page.getByRole('menuitem', { name: 'Save a copy…' }).click();
    await expect.poll(async () => (await calls(page, 'onSaveCopy')).length).toBe(1);
  });

  test('By me: Stop sharing removes everyone at once, and Undo brings back exactly that', async ({ page }) => {
    await open(page, 'shared-page');
    await page.getByRole('tab', { name: /By me/ }).click();
    const row = page.locator('.shp-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Opening sequence · Anyone with the link can view · 2 people');
    await row.getByRole('button', { name: /More for Rough cut/ }).click();
    await page.getByRole('menuitem', { name: 'Stop sharing' }).click();
    await expect(page.locator('.shp-row')).toHaveCount(0);
    await expect.poll(async () => (await calls(page, 'stopFileShare')).length).toBe(1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.shp-row')).toHaveCount(1);
    const undo = await calls(page, 'undoStopFileShare');
    expect(undo).toHaveLength(1);
    expect(undo[0].args[2]).toEqual({ linkAccess: 'view', stoppedAt: '2026-10-18T12:00:00.123456+00:00' });
  });

  test('a row opens the file over the app', async ({ page }) => {
    await open(page, 'shared-page');
    const opened = page.evaluate(() => new Promise((resolve) => {
      document.addEventListener('soleil-open-shared-file', (e) => resolve(e.detail), { once: true });
    }));
    await page.locator('.shp-open').first().click();
    expect(await opened).toEqual({ token: '1a2b3c4d-0000-4000-8000-000000000001', via: 'shared_page' });
  });
});

test.describe('a shared file inside the app', () => {
  test('opens over the app, marks it opened, and Escape closes it', async ({ page }) => {
    await open(page, 'overlay');
    await page.getByRole('button', { name: 'Open shared file' }).click();
    const dialog = page.getByRole('dialog', { name: 'Shared file' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Opening titles v3' })).toBeVisible();
    await expect(dialog.getByText('Shared with you')).toBeVisible();
    // The app's own sign-up footer stays on the public page only.
    await expect(dialog.getByText('Try Clusters free')).toHaveCount(0);
    await expect.poll(async () => (await calls(page, 'markFileShareOpened')).map((c) => c.args[0])).toEqual([TOKEN]);
    // Its media resolve through the scoped resolver: the video has its url.
    await expect.poll(() => dialog.locator('video').evaluate((v) => v.currentSrc || v.src || '')).toContain('frames-vp9.mp4');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('Add to cluster: Escape closes the menu, not the file; Save a copy asks the app', async ({ page }) => {
    await open(page, 'overlay');
    await page.getByRole('button', { name: 'Open shared file' }).click();
    const dialog = page.getByRole('dialog', { name: 'Shared file' });
    await dialog.getByRole('button', { name: 'Add to cluster' }).click();
    await expect(page.getByRole('menu', { name: 'Add to cluster' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Add to cluster' })).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Add to cluster' }).click();
    await page.getByRole('menuitem', { name: /Save a copy/ }).click();
    await expect.poll(async () => (await calls(page, 'onSaveCopy')).map((c) => c.args)).toEqual([[TOKEN, 'video']]);
    await expect(page.locator('.toast-msg', { hasText: 'Saved to Opening sequence' })).toBeVisible();
  });
});

test.describe('finding on the Shared page', () => {
  const people = ['Rae Okafor', 'Jun Park', 'Ana Silva'];
  const withMe = Array.from({ length: 8 }, (_, i) => ({
    token: `aaaaaaaa-0000-4000-8000-00000000010${i}`, kind: 'file', name: `Reference ${i + 1}.zip`, ext: 'zip', access: 'view',
    allow_download: true, shared_by: { name: people[i % 3], avatar_url: null }, source: 'person',
    shared_at: new Date(Date.now() - (i + 1) * 3600000).toISOString(), opened_at: null, activity_at: null, unread: false,
  }));
  const byMe = (n) => Array.from({ length: n }, (_, i) => ({
    token: `bbbbbbbb-0000-4000-8000-00000000010${i}`, board_id: 'qa-board', board_name: i % 2 ? 'Title sequence' : 'Opening sequence',
    card_id: `c${i}`, kind: 'file', name: `Cut ${i + 1}.mov`, link_access: 'view', allow_download: true,
    people_count: 1, people: ['a@example.com'], comment_count: 0, updated_at: new Date().toISOString(),
  }));

  async function feed(page, byMeCount) {
    await open(page, 'shared-page');
    await page.evaluate(async ({ withMe, byMe }) => {
      const { setSharedFilesSource, refreshSharedFiles } = await import('/src/hooks/useSharedFiles.js');
      setSharedFilesSource({
        listSharedWithMe: async () => ({ data: { items: withMe }, error: null }),
        listMyFileShares: async () => ({ data: { items: byMe }, error: null }),
      });
      await refreshSharedFiles({ force: true });
    }, { withMe, byMe: byMe(byMeCount) });
    await expect(page.locator('.shp-row')).toHaveCount(8);
  }

  test('With me: the field matches a person; "N of 8"; Escape clears; By me clears it and finds by cluster', async ({ page }) => {
    await feed(page, 7);
    const find = page.getByPlaceholder('Find a file or person…');
    await expect(find).toBeVisible();
    await find.fill('jun');
    await expect(page.locator('.shp-row')).toHaveCount(3);
    for (const r of await page.locator('.shp-row .shp-sub').allTextContents()) expect(r).toContain('Jun Park');
    await expect(page.locator('.shp-count')).toHaveText('3 of 8');
    await find.press('Escape');
    await expect(find).toHaveValue('');
    await expect(page.locator('.shp-row')).toHaveCount(8);

    await find.fill('ana');
    await expect(page.locator('.shp-row')).toHaveCount(2);
    await page.getByRole('tab', { name: /By me/ }).click();
    const byMeFind = page.getByPlaceholder('Find a file or cluster…');
    await expect(byMeFind).toBeVisible();
    await expect(byMeFind).toHaveValue('');
    await expect(page.locator('.shp-row')).toHaveCount(7);
    await byMeFind.fill('title');
    await expect(page.locator('.shp-row')).toHaveCount(3);
    await expect(page.locator('.shp-count')).toHaveText('3 of 7');
  });

  test('a tab with 6 files has no field', async ({ page }) => {
    await feed(page, 6);
    await expect(page.getByPlaceholder('Find a file or person…')).toBeVisible();
    await page.getByRole('tab', { name: /By me/ }).click();
    await expect(page.locator('.shp-row')).toHaveCount(6);
    await expect(page.locator('.shp-find-input')).toHaveCount(0);
  });
});
