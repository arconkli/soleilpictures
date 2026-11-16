// What happens to a file once it's shared: the Shared page (With you / By you)
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
  test('With you: tabs, always-visible search, and groups by sharer, then links, then workspace', async ({ page }) => {
    await open(page, 'shared-page');
    await expect(page.getByRole('tab', { name: /With you/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /By you/ })).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByPlaceholder('Search shared')).toBeVisible();
    await expect(page.locator('.shp-gh-name')).toHaveText(['Rae Okafor', 'Jun Park', 'From links', 'Workspace']);
    await expect(page.locator('.shp-row')).toHaveCount(7);
    // Newest first inside a sharer's group: the file (1h) before the clusters (3h, 20h).
    const rae = page.locator('.shp-group').first().locator('.shp-row');
    await expect(rae).toHaveCount(3);
    await expect(rae.nth(0)).toContainText('Opening titles v3');
    await expect(rae.nth(0)).toHaveClass(/is-new/);
    await expect(rae.nth(0).getByLabel('New')).toBeVisible();
    await expect(rae.nth(1)).toContainText('Opening sequence');
    await expect(rae.nth(2)).toContainText('Locations scout');
    await expect(rae.nth(2).locator('.shp-chip-ro')).toHaveText('View');
    // No gold at rest: the unread dot is neutral ink.
    const dot = await rae.nth(0).locator('.shp-dot').evaluate((el) => getComputedStyle(el).backgroundColor);
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
    const row = (name) => page.locator('.shp-row', { hasText: name });
    await row('Opening titles v3').getByRole('button', { name: /More for Opening titles v3/ }).click();
    await page.getByRole('menuitem', { name: 'Remove from my list' }).click();
    await expect(page.locator('.shp-row')).toHaveCount(6);
    await expect.poll(async () => (await calls(page, 'hideSharedFile')).map((c) => c.args[1])).toEqual([true]);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.shp-row')).toHaveCount(7);
    await expect.poll(async () => (await calls(page, 'hideSharedFile')).map((c) => c.args[1])).toEqual([true, false]);
  });

  test('a cluster row calls through: Open and Remove from my list', async ({ page }) => {
    await open(page, 'shared-page');
    const more = page.locator('.shp-row', { hasText: 'Costume references' }).getByRole('button', { name: /More for/ });
    await more.click();
    await page.getByRole('menuitem', { name: 'Open' }).click();
    await more.click();
    await page.getByRole('menuitem', { name: 'Remove from my list' }).click();
    expect((await calls(page, 'onOpenBoard')).map((c) => c.args[0])).toEqual(['qa-c-3']);
    expect((await calls(page, 'onRemoveCluster')).map((c) => c.args[0])).toEqual(['qa-c-3']);
  });

  test('Save a copy is offered only where the sharer allows downloading', async ({ page }) => {
    await open(page, 'shared-page');
    await page.locator('.shp-row', { hasText: 'Shooting script' }).getByRole('button', { name: /More for Shooting script/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Save a copy…' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('.shp-row', { hasText: 'Opening titles v3' }).getByRole('button', { name: /More for Opening titles v3/ }).click();
    await page.getByRole('menuitem', { name: 'Save a copy…' }).click();
    await expect.poll(async () => (await calls(page, 'onSaveCopy')).length).toBe(1);
  });

  test('By you: a cluster lists its people, and Stop sharing on a file is undoable', async ({ page }) => {
    await open(page, 'shared-page');
    await page.getByRole('tab', { name: /By you/ }).click();
    const rows = page.locator('.shp-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Pitch deck' }).locator('.shp-face')).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Pitch deck' }).locator('.shp-chip')).toHaveText('Link on');
    // The faces are round discs, not squares.
    const radius = await rows.filter({ hasText: 'Pitch deck' }).locator('.shp-face').first().evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).toBe('50%');
    const cut = rows.filter({ hasText: 'Rough cut' });
    await expect(cut).toContainText('Shared with 2 people');
    await cut.getByRole('button', { name: /More for Rough cut/ }).click();
    await page.getByRole('menuitem', { name: 'Stop sharing' }).click();
    await expect(rows).toHaveCount(2);
    await expect.poll(async () => (await calls(page, 'stopFileShare')).length).toBe(1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(rows).toHaveCount(3);
    const undo = await calls(page, 'undoStopFileShare');
    expect(undo).toHaveLength(1);
    expect(undo[0].args[2]).toEqual({ linkAccess: 'view', stoppedAt: '2026-10-18T12:00:00.123456+00:00' });
  });

  test('a file row opens the file over the app', async ({ page }) => {
    await open(page, 'shared-page');
    const opened = page.evaluate(() => new Promise((resolve) => {
      document.addEventListener('soleil-open-shared-file', (e) => resolve(e.detail), { once: true });
    }));
    await page.locator('.shp-open', { hasText: 'Opening titles v3' }).click();
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

test.describe('searching the Shared page', () => {
  const find = (page) => page.getByPlaceholder('Search shared');

  test('a person narrows to their rows; no match offers Clear; Escape clears', async ({ page }) => {
    await open(page, 'shared-page');
    await find(page).fill('jun');
    await expect(page.locator('.shp-gh-name')).toHaveText(['Jun Park']);
    await expect(page.locator('.shp-row')).toHaveCount(2);

    await find(page).fill('zzz');
    await expect(page.getByText('Nothing shared matches “zzz”')).toBeVisible();
    await expect(page.locator('.shp-row')).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(find(page)).toHaveValue('');
    await expect(page.locator('.shp-row')).toHaveCount(7);

    await find(page).fill('script');
    await expect(page.locator('.shp-row')).toHaveCount(1);
    await find(page).press('Escape');
    await expect(find(page)).toHaveValue('');
    await expect(page.locator('.shp-row')).toHaveCount(7);
  });

  test('switching tabs clears the search, and By you searches too', async ({ page }) => {
    await open(page, 'shared-page');
    await find(page).fill('jun');
    await page.getByRole('tab', { name: /By you/ }).click();
    await expect(find(page)).toBeVisible();
    await expect(find(page)).toHaveValue('');
    await expect(page.locator('.shp-row')).toHaveCount(3);
    await find(page).fill('pitch');
    await expect(page.locator('.shp-row')).toHaveCount(1);
  });

  test('the focused search shows one ring, the box’s, not a second one on the input', async ({ page }) => {
    await open(page, 'shared-page');
    await find(page).focus();
    const input = await find(page).evaluate((el) => { const c = getComputedStyle(el); return [c.boxShadow, c.outlineStyle]; });
    expect(input).toEqual(['none', 'none']);
    const box = await page.locator('.shp-find').evaluate((el) => getComputedStyle(el).boxShadow);
    expect(box).not.toBe('none');
  });
});

// The real shell: the islands float over a band at the top of main, and the
// page has to start below them. The tests above render the page alone.
test.describe('in the app shell', () => {
  test('the page starts below the floating top bar: title, tabs, search and close are clear of the islands', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto('/?sidebarqa=1&look=today&surface=shared');
    await page.waitForSelector('[data-sidebarqa-ready]');
    await expect(page.locator('.app.is-floating-chrome > main.main > section.shp')).toBeVisible();
    await expect(page.locator('.shp-title')).toBeVisible();
    const islandsBottom = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.chrome-island')]
      .filter((el) => el.getClientRects().length).map((el) => el.getBoundingClientRect().bottom)));
    expect(islandsBottom).toBeGreaterThan(0);
    for (const sel of ['.shp-title', '.shp-tabs', '.shp-find', '.shp-close']) {
      const box = await page.locator(sel).first().boundingBox();
      expect(box, sel).not.toBeNull();
      expect(box.y, `${sel} top (${box.y}) is under the islands (bottom ${islandsBottom})`).toBeGreaterThanOrEqual(islandsBottom);
    }
  });
});
