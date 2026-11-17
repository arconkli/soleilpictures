// Files under a finger, as the iPad's Files app works (owner, 2026-10-20): a
// tap opens what it lands on (a folder opens, a file opens in Quick look),
// and a hold opens the menu, whose Select puts a check on everything so taps
// pick several for the bar to act on. A finger drags nothing here: a hold is
// the menu. The sidebar's files work the same way.
//
// Released with the sidebar (lib/appHost.js touchPassAllowed is open
// everywhere); the specs still set its old dev flag, which nothing reads, and
// one opens Files without it to pin that. Holds need CDP touch: Chromium only
// (helpers.js).
import { expect, test } from '@playwright/test';
import { hold, needsHold, tap } from './helpers.js';

const optIn = (page, on = true) => page.addInitScript((on) => {
  try { if (on) localStorage.setItem('soleil.dev.touchPass', '1'); } catch (_) {}
}, on);

const files = (page) => page.locator('.list-wrap');
const tile = (page, id) => files(page).locator(`.ct-tile[data-item-id="${id}"]`);
const folder = (page, name) => files(page).locator('.ft', { hasText: name });
const quickLook = (page) => page.getByRole('dialog', { name: /^Quick look/ });
const menu = (page) => page.locator('.ctx-menu').last();
const bar = (page) => files(page).locator('.list-selbar');
// The phone's shell (phones, and touch tablets up to 1024px wide: an upright
// iPad; lib/deviceShell.js) gets its menus as a bottom sheet; a wider one, an
// iPad held sideways, keeps the menu beside the finger (plan.md §1, decision 11).
const sheetShell = (page) => (page.viewportSize()?.width ?? 0) <= 1024;

// `filesrules`: the harness's stand-in for moving and copying between
// clusters (window.__filesRulesQa), which Copy to… needs.
async function openFiles(page, { touchPass = true, filesrules = false } = {}) {
  await optIn(page, touchPass);
  await page.goto(`/?local=1&reset=1${filesrules ? '&filesrules=1' : ''}`);
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  // The harness's settings gear sits over the bar's right end; the app has none.
  await page.addStyleTag({ content: '.twk-gear { display: none !important; }' });
  // The view switch's second half: beside the board where there's room, the
  // whole screen where there isn't.
  await page.locator('.view-pill--primary .view-pill-btn').nth(1).tap();
  await expect(tile(page, 'home-note')).toBeVisible();
}

async function middle(loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// A tap in the middle of what it's for. Playwright scrolls a target only as
// far as the list's edge, and once earlier taps have scrolled the list, a
// tile can sit half under the sticky header, where its middle is the header's
// (a finger taps the half it can see).
async function tapClear(loc) {
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await loc.tap();
}

// One of the bar's actions that a phone's bar folds into its ⋯ (the 'tight'
// fit): on the bar where it fits, in the ⋯ menu where it doesn't. Opens the
// menu when that is where it is; `closeFoldMenu` puts it away again.
async function foldedAction(page, name) {
  const onBar = bar(page).getByRole('button', { name, exact: true });
  if (await onBar.isVisible()) return onBar;
  const more = bar(page).getByRole('button', { name: 'More actions', exact: true });
  if (!(await more.isVisible())) return onBar;
  await more.tap();
  await expect(menu(page)).toBeVisible();
  return menu(page).getByRole('menuitem', { name, exact: true });
}
async function closeFoldMenu(page) {
  if (await menu(page).count()) {
    // As a phone closes it: Back takes the menu and nothing else.
    await page.goBack();
    await expect(menu(page)).toHaveCount(0);
  }
}

// Held until the menu shows, then Select.
async function holdToSelect(page, loc) {
  await hold(page, await middle(loc));
  await expect(menu(page).getByRole('menuitem').first()).toHaveText('Select');
  await menu(page).getByRole('menuitem', { name: 'Select', exact: true }).tap();
  await expect(menu(page)).toHaveCount(0);
}

test.describe('Files', () => {
  test('a tap on a file opens it in Quick look, and selects nothing', async ({ page }) => {
    await openFiles(page);
    await tile(page, 'home-note').tap();
    await expect(quickLook(page)).toHaveAttribute('aria-label', 'Quick look: Studio inbox');
    await expect(files(page).locator('.is-selected')).toHaveCount(0);
  });

  test('a tap where the hidden round check sits opens the file too', async ({ page }) => {
    await openFiles(page);
    await tile(page, 'home-image').scrollIntoViewIfNeeded();
    const b = await tile(page, 'home-image').boundingBox();
    await tap(page, { x: b.x + 16, y: b.y + 16 });
    await expect(quickLook(page)).toBeVisible();
    await expect(files(page).locator('.is-selected')).toHaveCount(0);
  });

  test('a tap on a folder opens it', async ({ page }) => {
    await openFiles(page);
    await folder(page, 'Features').tap();
    // Beside the board, Files browses into it; full screen, the app goes there.
    await expect(page.locator('.pb .pb-step.is-here, .crumb.here').filter({ hasText: 'Features' }).first()).toBeVisible();
  });

  test('a finger drags nothing out of Files: a hold is the menu', async ({ page }) => {
    await openFiles(page);
    await expect(files(page).locator('[draggable="true"]')).toHaveCount(0);
  });

  test('released: without the old dev flag, a tap still opens the file', async ({ page }) => {
    await openFiles(page, { touchPass: false });
    await tile(page, 'home-note').tap();
    await expect(quickLook(page)).toBeVisible();
  });

  test('a hold opens the menu at the finger (a sheet on a phone), Select first, and letting go picks nothing from it', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await openFiles(page);
    const at = await middle(tile(page, 'home-note'));
    await hold(page, at);
    await expect(menu(page).getByRole('menuitem').first()).toHaveText('Select');
    if (sheetShell(page)) {
      // A phone's menu rises from the foot of the screen, over the tab bar
      // (plan.md §1, decision 11; steps 2-3: the sheet "covers the tab bar").
      await expect(menu(page)).toHaveClass(/is-sheet/);
      // Once it has risen (sheet-up, 260ms): its foot on the window's.
      await expect.poll(async () => {
        const panel = await page.locator('.sheet-panel').boundingBox();
        return !!panel && Math.abs(panel.y + panel.height - page.viewportSize().height) < 2;
      }).toBe(true);
    } else {
      const box = await menu(page).boundingBox();
      // At the finger: the hold point is on the menu's edge or beside it, even
      // where a tall menu is lifted to stay in the window (lib/ctxMenuFit.js),
      // which puts the finger halfway down its side.
      await expect(menu(page)).not.toHaveClass(/is-sheet/);
      const gap = Math.hypot(
        Math.max(box.x - at.x, 0, at.x - (box.x + box.width)),
        Math.max(box.y - at.y, 0, at.y - (box.y + box.height)));
      expect(gap).toBeLessThan(48);
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
    }
    await page.waitForTimeout(300);
    await expect(menu(page)).toBeVisible();
    await expect(quickLook(page)).toHaveCount(0);
    // The menu acts on what was held.
    await expect(tile(page, 'home-note')).toHaveClass(/is-selected/);
  });

  test('Select puts a check on everything; taps pick and unpick, and Done puts them away', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await openFiles(page, { filesrules: true });
    await holdToSelect(page, tile(page, 'home-note'));
    await expect(files(page)).toHaveClass(/is-selecting/);
    // The one held starts picked.
    await expect(bar(page)).toContainText('1 selected');
    await expect(tile(page, 'home-note')).toHaveClass(/is-selected/);
    // Every tile shows its check, and every folder one of its own.
    const opacities = await files(page).locator('.ct-tile-check').evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
    expect(opacities.length).toBeGreaterThan(0);
    for (const o of opacities) expect(o).toBe('1');
    await expect(files(page).locator('.ft .row-check')).toHaveCount(await files(page).locator('.ft').count());
    // A tap picks, and opens nothing.
    await tapClear(tile(page, 'home-image'));
    await expect(bar(page)).toContainText('2 selected');
    await expect(quickLook(page)).toHaveCount(0);
    // Files only: the bar copies them too, with no right-click to find it.
    await expect(await foldedAction(page, 'Copy to…')).toBeVisible();
    await closeFoldMenu(page);
    // A second tap takes one back out.
    await tapClear(tile(page, 'home-note'));
    await expect(bar(page)).toContainText('1 selected');
    await expect(tile(page, 'home-note')).not.toHaveClass(/is-selected/);
    // A folder is picked, not opened.
    await tapClear(folder(page, 'Stills'));
    await expect(bar(page)).toContainText('2 selected');
    await expect(folder(page, 'Stills')).toHaveClass(/is-selected/);
    await expect(await foldedAction(page, 'Copy to…')).toHaveCount(0);
    await closeFoldMenu(page);
    // Done puts the checks away and lets go of everything.
    await bar(page).getByRole('button', { name: 'Done', exact: true }).tap();
    await expect(files(page)).not.toHaveClass(/is-selecting/);
    await expect(bar(page)).toHaveCount(0);
    await expect(files(page).locator('.row-check')).toHaveCount(0);
    // And a tap opens again.
    await tapClear(tile(page, 'home-note'));
    await expect(quickLook(page)).toBeVisible();
  });

  // A phone is narrower than the bar's icons (40px each to a finger): Info
  // and Done ran off the pill. The bar's last fit folds the rest into a ⋯.
  for (const [w, h] of [[375, 667], [320, 568]]) {
    test(`at ${w} wide the bar fits, with nothing cut off and the rest in its ⋯`, async ({ page, browserName }) => {
      needsHold(test, browserName);
      test.skip(page.viewportSize().width > 640, 'a phone\'s width');
      await page.setViewportSize({ width: w, height: h });
      await openFiles(page, { filesrules: true });
      await tile(page, 'home-note').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await holdToSelect(page, tile(page, 'home-note'));
      await tapClear(tile(page, 'home-image'));
      await expect(bar(page)).toContainText('2 selected');
      await expect(bar(page)).toHaveAttribute('data-fit', 'tight');
      // Every button that shows is whole, inside the bar and the screen, and
      // finger-sized.
      const fit = await bar(page).evaluate((el) => {
        const b = el.getBoundingClientRect();
        const shown = [...el.querySelectorAll('button')].filter((k) => k.getBoundingClientRect().width > 0);
        return {
          left: b.left, right: b.right, over: el.scrollWidth - el.clientWidth,
          kids: shown.map((k) => { const r = k.getBoundingClientRect(); return { name: k.getAttribute('aria-label') || k.textContent, left: r.left, right: r.right, w: r.width, h: r.height }; }),
        };
      });
      expect(fit.over).toBeLessThanOrEqual(1);
      expect(fit.left).toBeGreaterThanOrEqual(0);
      expect(fit.right).toBeLessThanOrEqual(w);
      for (const k of fit.kids) {
        expect(k.left, k.name).toBeGreaterThanOrEqual(fit.left);
        expect(k.right, k.name).toBeLessThanOrEqual(fit.right);
        expect(k.w, k.name).toBeGreaterThanOrEqual(40);
        expect(k.h, k.name).toBeGreaterThanOrEqual(40);
      }
      expect(fit.kids.map((k) => k.name)).toEqual(['Download', 'Move to…', 'Delete', 'More actions', 'Done']);
      // The folded ones are in the ⋯ (the Copy to… test presses one).
      await bar(page).getByRole('button', { name: 'More actions' }).tap();
      await expect(menu(page).getByRole('menuitem')).toHaveText(['Copy to…', 'New cluster', 'Info']);
      await closeFoldMenu(page);
      // Done is on the bar and puts the checks away.
      await bar(page).getByRole('button', { name: 'Done', exact: true }).tap();
      await expect(bar(page)).toHaveCount(0);
    });
  }

  test('the bar\'s Copy to… copies what the finger picked', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await openFiles(page, { filesrules: true });
    await page.evaluate(() => { (window.__filesRulesQa ||= { calls: [] }).pick = 'b-stills'; });
    await holdToSelect(page, tile(page, 'home-image'));
    await (await foldedAction(page, 'Copy to…')).tap();
    const calls = () => page.evaluate(() => window.__filesRulesQa?.calls || []);
    await expect.poll(async () => (await calls()).length).toBe(1);
    expect((await calls())[0]).toMatchObject({ from: 'root', to: 'b-stills', cardIds: ['home-image'], copy: true });
  });

  test('Select with nothing picked says so, and keeps its Done', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await openFiles(page);
    await holdToSelect(page, tile(page, 'home-note'));
    await tile(page, 'home-note').tap();
    await expect(bar(page)).toContainText('Select items');
    await expect(bar(page).getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await expect(bar(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  });

  test('in the list layout, Select checks the rows too', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await openFiles(page);
    const expand = page.getByRole('button', { name: 'Expand Files to full screen' });
    if (await expand.isVisible()) await expand.tap();
    await page.getByRole('button', { name: 'List layout' }).tap();
    const row = (id) => files(page).locator(`.ct-row[data-item-id="${id}"]`);
    await holdToSelect(page, row('home-note'));
    await expect(row('home-note').locator('.row-check')).toBeVisible();
    await expect(row('home-note')).toHaveClass(/is-selected/);
    await row('home-image').tap();
    await expect(bar(page)).toContainText('2 selected');
    await expect(quickLook(page)).toHaveCount(0);
  });
});

test.describe('the sidebar’s files', () => {
  async function openSidebar(page) {
    await optIn(page);
    await page.goto('/?sidebarqa=1');
    await page.waitForSelector('[data-sidebarqa-ready]');
    await expect(page.locator('.sbf-block').first()).toBeVisible();
  }
  const row = (page, name) => page.locator('.sbf-files .sbf-file', { hasText: name });
  const photo = (page) => page.locator('.sbf-files [data-sb-item^="film:film-img-"]').first();
  const bulk = (page) => page.locator('.sbf-bulk');

  test('a finger drags no file out of the sidebar: a hold is the menu', async ({ page }) => {
    await openSidebar(page);
    await expect(row(page, 'film-take-1.mov')).toBeAttached();
    await expect(page.locator('.sbf-files .sbf-file[draggable="true"]')).toHaveCount(0);
  });

  test('a hold’s menu starts with Select; taps then pick files, and Done puts the checks away', async ({ page, browserName }) => {
    needsHold(test, browserName);
    await openSidebar(page);
    const take = row(page, 'film-take-1.mov');
    await take.scrollIntoViewIfNeeded();
    const b = await take.boundingBox();
    await hold(page, { x: b.x + 24, y: b.y + b.height / 2 });
    // On a phone the sheet rises under the finger still held: letting go
    // picks nothing from it, and it stays open.
    await page.waitForTimeout(300);
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('menuitem').first()).toHaveText('Select');
    await menu(page).getByRole('menuitem', { name: 'Select', exact: true }).tap();
    await expect(bulk(page)).toContainText('1 selected');
    await expect(take.locator('.row-check')).toBeVisible();
    await expect(take).toHaveClass(/is-selected/);
    // A tap picks, rather than opening Quick look.
    await photo(page).scrollIntoViewIfNeeded();
    await photo(page).tap();
    await expect(bulk(page)).toContainText('2 selected');
    await expect(page.getByText(/of 30$/)).toHaveCount(0);
    await photo(page).tap();
    await expect(bulk(page)).toContainText('1 selected');
    await bulk(page).getByRole('button', { name: 'Done', exact: true }).tap();
    await expect(bulk(page)).toHaveCount(0);
    await expect(page.locator('.sbf-files .row-check')).toHaveCount(0);
  });
});
