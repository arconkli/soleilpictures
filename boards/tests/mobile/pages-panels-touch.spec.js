// Pages and panels a finger can reach (the mobile functionality pass, step
// 6a): the things only a right-click, a wide screen or a tall one could do.
//
//   - a doc's page list: a hold on a page opens its menu (rename, sub-page,
//     delete), which only a right-click did
//   - the phone's drawer has a "Deleted clusters" row: the trash had no way in
//   - the add sheet on a phone held sideways shows rows of tiles, not one
//   - a photo opened full size uses the phone's width
//   - the toast after making a link sits above Share's Done, not on it
//   - Share's Copy link starts the clipboard write inside the tap (WebKit:
//     Safari drops a write that comes after an await)
//   - the return question (and the upgrade one, the same frame) stays on a
//     sideways phone's screen and scrolls inside itself
//
// Holds need CDP touch: Chromium only (touch/helpers.js).
import { expect, test } from '@playwright/test';
import { bootSignedIn } from '../helpers/signedInStub.js';
import { pageListButton } from '../helpers/docFrame.js';
import { hold, needsHold } from '../touch/helpers.js';

const menu = (page) => page.locator('.ctx-menu');
const phoneOnly = (testInfo) => test.skip(testInfo.project.name === 'tablet', 'phone-width only (≤640px)');

async function bootSigned(page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.mb-nav')).toBeVisible({ timeout: 30000 });
}

async function bootLocal(page) {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap .card').first()).toBeVisible({ timeout: 30000 });
}

test.describe('the drawer', () => {
  test('has Deleted clusters, which closes the drawer and opens the trash; Back closes it', async ({ page }) => {
    await bootSigned(page);
    await page.getByLabel('Open menu').first().tap();
    const drawer = page.locator('.sidebar.is-mobile-open');
    await expect(drawer).toBeVisible();
    const row = drawer.locator('.sb-row', { hasText: 'Deleted clusters' });
    await expect(row).toBeVisible();
    // After Version history, as the mockup has it.
    const labels = await drawer.locator('.sb-row .sb-row-label').allInnerTexts();
    expect(labels.indexOf('Deleted clusters')).toBe(labels.indexOf('Version history') + 1);
    await row.tap();
    await expect(drawer).toHaveCount(0);
    const dialog = page.locator('.modal-shell');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Deleted clusters');
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.canvas-wrap')).toBeVisible();
  });
});

test.describe('a doc\'s page list', () => {
  async function openDocPages(page) {
    // As on an iPhone, which never fires contextmenu for a touch: the menu can
    // only open through the hold.
    await page.addInitScript(() => window.addEventListener('contextmenu', (e) => e.stopImmediatePropagation(), true));
    await page.goto('/?docqa=1');
    await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
    await page.evaluate(() => window.__soleilDocTest.openCard());
    await expect(page.locator('.doc-card-modal')).toBeVisible();
    await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
    await page.evaluate(() => {
      const T = window.__soleilDocTest;
      T.addPage(T.ydoc, { name: 'Chapter Two', scope: T.getScope() });
    });
    await pageListButton(page.locator('.doc-card-modal')).tap();
    await expect(page.locator('.doc-surface.mobile-rail-open .doc-rail-left')).toBeVisible();
  }
  const pageRow = (page, name) => page.locator('.doc-tree-row', { hasText: name }).first();
  const mid = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

  test('a hold on a page opens its menu, and letting go opens nothing else', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await openDocPages(page);
    await hold(page, await mid(pageRow(page, 'Chapter Two')));
    await expect(menu(page)).toBeVisible();
    // "Rename…", with the ellipsis of a row that asks for more (plan.md §3, Doc page tree).
    for (const name of ['Rename…', 'New sub-page', 'Delete']) {
      await expect(menu(page).getByRole('menuitem', { name, exact: true })).toBeVisible();
    }
    // The lift's click did not open the page: the drawer is still up.
    await expect(page.locator('.doc-surface.mobile-rail-open')).toHaveCount(1);
  });

  test('Rename from the menu names the page; Delete takes it away with an Undo', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await openDocPages(page);
    await hold(page, await mid(pageRow(page, 'Chapter Two')));
    await menu(page).getByRole('menuitem', { name: 'Rename…', exact: true }).tap();
    const field = page.getByLabel('Page name');
    await expect(field).toBeVisible();
    await field.fill('Second act');
    await field.press('Enter');
    await expect(pageRow(page, 'Second act')).toBeVisible();

    await hold(page, await mid(pageRow(page, 'Second act')));
    await menu(page).getByRole('menuitem', { name: 'Delete', exact: true }).tap();
    const names = () => page.evaluate(() => {
      const T = window.__soleilDocTest;
      return T.readPages(T.ydoc, T.getScope()).map((p) => p.name);
    });
    await expect.poll(names).not.toContain('Second act');
    const toast = page.locator('.toast', { hasText: 'Page deleted' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).tap();
    await expect.poll(names).toContain('Second act');
  });

  test('Back closes the page menu and nothing else', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await openDocPages(page);
    await hold(page, await mid(pageRow(page, 'Chapter Two')));
    await expect(menu(page)).toBeVisible();
    await page.goBack();
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator('.doc-card-modal')).toBeVisible();
  });
});

test.describe('the people online', () => {
  test('a hold on a face opens their recent comments, not a jump; Back closes it', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await page.addInitScript(() => window.addEventListener('contextmenu', (e) => e.stopImmediatePropagation(), true));
    await page.route('**/rest/v1/comments*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await bootLocal(page);
    // One stubbed peer, mounted over the local board (helpers/panelsProbe.js).
    await page.evaluate(async () => {
      const m = await import('/tests/helpers/panelsProbe.js');
      m.mountPresence();
    });
    const face = page.locator('.panels-probe-host .ws-presence-avatar');
    await expect(face).toBeVisible();
    const b = await face.boundingBox();
    await hold(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const audit = page.locator('.ws-presence-audit');
    await expect(audit).toBeVisible();
    // The lift's click did not jump to them.
    expect(await page.evaluate(() => window.__probeJumped || 0)).toBe(0);
    await page.goBack();
    await expect(audit).toHaveCount(0);
    await expect(page.locator('.canvas-wrap')).toBeVisible();
    await expect(page.locator('.canvas-wrap .card').first()).toBeVisible();
  });
});

test.describe('fit', () => {
  test('held sideways, the add sheet shows rows of tiles and stays on screen', async ({ page }, testInfo) => {
    phoneOnly(testInfo);
    await page.setViewportSize({ width: 844, height: 390 });
    await bootLocal(page);
    await page.getByRole('button', { name: 'Add a card' }).tap();
    const grid = page.locator('.mobile-add-grid');
    await expect(grid).toBeVisible();
    // Past the sheet's slide up.
    await expect.poll(async () => {
      const b = await page.locator('.sheet-panel').boundingBox();
      return Math.round(b.y + b.height);
    }).toBe(390);
    const tiles = await grid.locator('.mobile-add-tile').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    }));
    const firstRow = tiles.filter((t) => t.top === tiles[0].top).length;
    expect(firstRow).toBeGreaterThanOrEqual(5);
    for (const t of tiles) expect(t.h).toBeGreaterThanOrEqual(44);
    // More than half the height, and inside the screen.
    const panel = await page.locator('.sheet-panel').boundingBox();
    expect(panel.height).toBeGreaterThan(390 * 0.6);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    // At least two whole rows in view without scrolling.
    const seen = tiles.filter((t) => t.bottom <= 390);
    expect(new Set(seen.map((t) => t.top)).size).toBeGreaterThanOrEqual(2);
  });

  test('a photo opened full size uses the phone\'s width, with its buttons in reach', async ({ page }, testInfo) => {
    phoneOnly(testInfo);
    await bootLocal(page);
    const b = await page.locator('[data-card-id="home-image"]').boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height - 6);
    await page.locator('.sel-menu .card-menu-btn').tap();
    await menu(page).getByRole('menuitem', { name: 'View full size', exact: true }).tap();
    await expect(page.locator('.lightbox-img')).toBeVisible();
    const vw = page.viewportSize().width;
    const stage = await page.locator('.lightbox-stage').boundingBox();
    expect(stage.width).toBeGreaterThanOrEqual(vw - 16);
    const x = await page.locator('.lightbox-x').boundingBox();
    expect(x.width).toBeGreaterThanOrEqual(40);
    expect(x.height).toBeGreaterThanOrEqual(40);
    expect(x.x + x.width).toBeLessThanOrEqual(vw - 8 + 0.5);
    // The buttons have a row of their own: the photo starts under them.
    expect(stage.y).toBeGreaterThanOrEqual(x.y + x.height);
  });

  test('a toast with Share open sits above the panel\'s Done', async ({ page }, testInfo) => {
    phoneOnly(testInfo);
    await bootSigned(page);
    await page.locator('.topbar .tb-share').first().tap();
    const done = page.locator('.share-foot-done');
    await expect(done).toBeVisible();
    // Making a link answers with a toast (the stub's answer or its failure:
    // either lands in the same stack).
    await page.locator('.share-link-copy').first().tap();
    const toast = page.locator('.toast-stack .toast').first();
    await expect(toast).toBeVisible({ timeout: 15000 });
    const t = await toast.boundingBox();
    const foot = await page.locator('.share-foot').boundingBox();
    expect(t.y + t.height).toBeLessThanOrEqual(foot.y);
    await done.tap();
    await expect(page.locator('.share-modal')).toHaveCount(0);
  });

  test('held sideways, the question stays on screen and scrolls inside itself', async ({ page }, testInfo) => {
    phoneOnly(testInfo);
    await page.setViewportSize({ width: 750, height: 342 });
    await page.route('**/rest/v1/analytics_events*', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: '[]' }));
    await page.goto('/?local=1&reset=1&onboarded=1&returnqa=1');
    const ask = page.locator('.rr-ask');
    await expect(ask).toBeVisible({ timeout: 15000 });
    // Past its entrance.
    await expect.poll(async () => {
      const b = await ask.boundingBox();
      return b && b.y >= 0 && b.y + b.height <= 342;
    }).toBe(true);
    const box = await ask.boundingBox();
    const scroll = await ask.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, oy: getComputedStyle(el).overflowY }));
    expect(scroll.oy).toBe('auto');
    // The top bar's two ends are not under it.
    const menuBtn = await page.getByLabel('Open menu').first().boundingBox();
    if (menuBtn) expect(menuBtn.x + menuBtn.width).toBeLessThanOrEqual(box.x);
  });
});

test.describe('copy link on an iPhone', () => {
  test('Copy link starts the clipboard write inside the tap, as Safari requires', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'WebKit is the engine this rule exists for');
    await page.addInitScript(() => {
      window.__cb = { calls: 0, sync: [], inClick: false };
      document.addEventListener('click', () => { window.__cb.inClick = true; }, true);
      // A bubble listener on window runs after the app handlers; awaits (microtasks) run before it.
      window.addEventListener('click', () => { window.__cb.inClick = false; });
      window.ClipboardItem = function ClipboardItem(items) { this.items = items; };
      const stub = { write: () => { window.__cb.calls++; window.__cb.sync.push(window.__cb.inClick); return Promise.resolve(); }, writeText: () => Promise.resolve() };
      try { Object.defineProperty(navigator, 'clipboard', { value: stub, configurable: true }); } catch (_) { navigator.clipboard.write = stub.write; }
    });
    await bootSigned(page);
    await page.locator('.topbar .tb-share').first().tap();
    await expect(page.locator('.share-foot-done')).toBeVisible();
    await page.locator('.share-link-copy').first().tap();
    await expect.poll(() => page.evaluate(() => window.__cb.calls)).toBeGreaterThan(0);
    const cb = await page.evaluate(() => window.__cb);
    expect(cb.sync[0]).toBe(true);
  });
});
