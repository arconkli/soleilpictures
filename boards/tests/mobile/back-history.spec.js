// Back on a phone or an iPad goes where you were, and never out of the app
// while there is somewhere in the app to go back to.
//
// Under a finger each cluster (and Home) the in-app history visits is one
// browser history entry, and each open panel is one more on top of it
// (lib/modalGuard.js, "Back closes the top layer, then goes where you were";
// App.jsx recordNav). So the phone's Back, the iOS edge swipe and Android's
// Back button close the panel on top first, then return to the cluster you
// were on before. The unit tests for the model are
// src/lib/modalGuardHistory.test.mjs; this drives the real app, signed in
// through the stub. Quick look and the full-size picture need files and
// pictures the stub has none of, so they run on ?local=1, which has no
// cluster history: there the test puts one entry of its own beneath, and
// checks Back closes the panel onto it and Back again leaves it.

import { expect, test } from '@playwright/test';
import { bootSignedIn, USER_ID, WS_ID, ROOT_ID } from '../helpers/signedInStub.js';
import { hold, needsHold } from '../touch/helpers.js';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'touch history');
});

const phoneOnly = () => test.skip(test.info().project.name === 'tablet', 'the phone\'s Info sheet (≤640px)');

const ALPHA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BETA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const created = '2026-10-01T00:00:00Z';
const board = (id, name, parent) => ({
  id, workspace_id: WS_ID, parent_board_id: parent, deleted_at: null, name,
  kind: 'canvas', created_by: USER_ID, created_at: created,
});
// Studio (the workspace's root) holds Alpha, which holds Beta.
const BOARDS = [board(ROOT_ID, 'Studio', null), board(ALPHA, 'Alpha', ROOT_ID), board(BETA, 'Beta', ALPHA)];

const menu = (page) => page.locator('.ctx-menu');
const tab = (page, name) => page.locator('.mb-nav-tab', { hasText: name });

async function boot(page, { rpc = {} } = {}) {
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }], ...rpc },
    rest: { boards: BOARDS },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.mb-nav')).toBeVisible({ timeout: 30000 });
  await expectCluster(page, 'Studio');
}

// Which place is on screen: a cluster by its name in the tab's title, or Home.
async function expectCluster(page, name) {
  await expect(page).toHaveTitle(new RegExp(`^${name} — `), { timeout: 15000 });
  await expect(page.locator('.app.is-home')).toHaveCount(0);
  await expect(page.locator('.canvas-wrap')).toBeVisible();
}
async function expectHome(page) {
  await expect(page.locator('.app.is-home')).toHaveCount(1);
}
// Still our page: Back has not walked out to the blank page the test began on.
const expectInApp = (page) => expect(page).toHaveURL(/^http:\/\/[^/]+\/$/);

async function goHome(page) {
  await tab(page, 'Home').tap();
  await expectHome(page);
}
// A cluster by name, through Search: the sheet closes as the cluster opens.
async function openBySearch(page, name) {
  await tab(page, 'Search').tap();
  await page.locator('.cmdk-input').fill(name);
  await page.locator('.cmdk-row', { hasText: name }).first().tap();
  await expect(page.locator('.cmdk')).toHaveCount(0);
  await expectCluster(page, name);
}
// Home's list of projects, then Alpha's row.
async function openAlphaFromHome(page) {
  await goHome(page);
  await page.locator('.ch-row', { hasText: 'Alpha' }).tap();
  await expectCluster(page, 'Alpha');
}

async function back(page) { await page.goBack(); }

// The cluster card on Studio's board (Alpha's), and its menu the way a finger
// gets it: tap the card, then its ⋯.
async function openCardMenu(page) {
  const card = page.locator('.canvas-wrap .card').first();
  await expect(card).toBeVisible({ timeout: 30000 });
  const b = await card.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height - 6);
  const more = page.locator('.sel-menu .card-menu-btn');
  await expect(more).toBeVisible();
  await more.tap();
  await expect(menu(page)).toBeVisible();
}

test('Back walks Home, a cluster and its nested cluster in reverse, and Forward returns', async ({ page }) => {
  await boot(page);
  await openAlphaFromHome(page);
  await openBySearch(page, 'Beta');

  await back(page);
  await expectCluster(page, 'Alpha');
  await expectInApp(page);
  await back(page);
  await expectHome(page);
  await expectInApp(page);

  await page.goForward();
  await expectCluster(page, 'Alpha');
  await page.goForward();
  await expectCluster(page, 'Beta');

  // All the way down: Home, then where the app started, and still in it.
  await back(page);
  await back(page);
  await expectHome(page);
  await back(page);
  await expectCluster(page, 'Studio');
  await expectInApp(page);
});

// Each panel, opened on Alpha (reached from Studio): Back closes it and Alpha
// is still on screen; Back again goes to Home, where Alpha was opened from.
const PANELS = [
  { name: 'Search', open: (page) => tab(page, 'Search').tap(), panel: (page) => page.locator('.cmdk') },
  { name: 'Messages', open: (page) => tab(page, 'Messages').tap(), panel: (page) => page.locator('.msg-panel') },
  { name: 'the bell', open: (page) => page.locator('.nb-bell').tap(), panel: (page) => page.locator('.ntf-panel') },
  { name: 'Share', open: (page) => page.locator('.tb-share').tap(), panel: (page) => page.locator('.share-modal') },
];

test('Back closes Search, Messages, the bell or Share and stays on the cluster; Back again goes to where you were', async ({ page }) => {
  await boot(page);
  await openAlphaFromHome(page);
  for (const p of PANELS) {
    await test.step(p.name, async () => {
      await p.open(page);
      await expect(p.panel(page)).toBeVisible();
      await back(page);
      await expect(p.panel(page)).toHaveCount(0);
      await expectCluster(page, 'Alpha');
      await expectInApp(page);
      // One Back closed one thing: the next is the place before.
      await back(page);
      await expectHome(page);
      await expectInApp(page);
      await page.goForward();
      await expectCluster(page, 'Alpha');
    });
  }
});

test('Back closes a card\'s menu and stays; Back again goes to where you were', async ({ page }) => {
  await boot(page);
  await goHome(page);
  await page.locator('.ch-row', { hasText: 'Studio' }).tap();
  await expectCluster(page, 'Studio');
  await openCardMenu(page);
  await back(page);
  await expect(menu(page)).toHaveCount(0);
  await expectCluster(page, 'Studio');
  await back(page);
  await expectHome(page);
  await expectInApp(page);
});

test('a panel closed by its own button leaves nothing behind: Back goes to where you were', async ({ page }) => {
  await boot(page);
  await openAlphaFromHome(page);

  await tab(page, 'Search').tap();
  await expect(page.locator('.cmdk')).toBeVisible();
  await page.locator('.cmdk-close').tap();
  await expect(page.locator('.cmdk')).toHaveCount(0);

  await page.locator('.tb-share').tap();
  await expect(page.locator('.share-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.share-modal')).toHaveCount(0);

  await tab(page, 'Messages').tap();
  await expect(page.locator('.msg-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Close messages' }).tap();
  await expect(page.locator('.msg-panel')).toHaveCount(0);

  await back(page);
  await expectHome(page);
  await expectInApp(page);
});

test('a cluster opened from Search: Back returns to where Search was opened, with Search closed', async ({ page }) => {
  await boot(page);
  await openAlphaFromHome(page);
  await openBySearch(page, 'Beta');
  await back(page);
  await expectCluster(page, 'Alpha');
  await expect(page.locator('.cmdk')).toHaveCount(0);
  await back(page);
  await expectHome(page);
  await expectInApp(page);
});

test('a card menu row that opens a cluster: Back returns to the board the card is on', async ({ page }) => {
  await boot(page);
  await goHome(page);
  await page.locator('.ch-row', { hasText: 'Studio' }).tap();
  await expectCluster(page, 'Studio');
  await openCardMenu(page);
  await menu(page).getByRole('menuitem', { name: 'Open cluster', exact: true }).tap();
  await expect(menu(page)).toHaveCount(0);
  await expectCluster(page, 'Alpha');
  await back(page);
  await expectCluster(page, 'Studio');
  await expect(menu(page)).toHaveCount(0);
  await back(page);
  await expectHome(page);
});

test('a card menu row that opens a panel: Back closes the panel only, then goes to where you were', async ({ page }) => {
  phoneOnly();
  await boot(page);
  await goHome(page);
  await page.locator('.ch-row', { hasText: 'Studio' }).tap();
  await expectCluster(page, 'Studio');
  await openCardMenu(page);
  // The menu closes (its entry is taken off) as Info opens (and adds its own).
  await menu(page).getByRole('menuitem', { name: /^Info/ }).tap();
  await expect(menu(page)).toHaveCount(0);
  const info = page.locator('.info-host > *').first();
  await expect(info).toBeVisible();
  await back(page);
  await expect(page.locator('.info-host > *')).toHaveCount(0);
  await expectCluster(page, 'Studio');
  await expectInApp(page);
  await back(page);
  await expectHome(page);
  await expectInApp(page);
});

test('a row that closes its menu and opens a dialog: Back closes the dialog only, then goes to where you were', async ({ page }) => {
  await boot(page);
  await openAlphaFromHome(page);
  // The drawer's Version history row closes the drawer (its entry is taken
  // off) and opens a Modal (which adds its own) in the same tap.
  await page.getByLabel('Open menu').first().tap();
  const drawer = page.locator('.sidebar.is-mobile-open');
  await expect(drawer).toBeVisible();
  await drawer.locator('.sb-row', { hasText: 'Version history' }).tap();
  await expect(drawer).toHaveCount(0);
  const dialog = page.locator('.modal-shell');
  await expect(dialog).toBeVisible();
  await expectInApp(page);
  await back(page);
  await expect(dialog).toHaveCount(0);
  await expect(drawer).toHaveCount(0);
  await expectCluster(page, 'Alpha');
  await expectInApp(page);
  await back(page);
  await expectHome(page);
  await expectInApp(page);
});

test('after a reload, Back stays in the app and the next cluster opened still goes Back to this one', async ({ page }) => {
  await boot(page);
  await openAlphaFromHome(page);
  await page.reload();
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await expectCluster(page, 'Alpha');
  // The entry beneath is from before the reload: this load doesn't know it.
  await back(page);
  await expectCluster(page, 'Alpha');
  await expectInApp(page);
  await openBySearch(page, 'Beta');
  await back(page);
  await expectCluster(page, 'Alpha');
  await expectInApp(page);
});

test('the limit\'s pricing wall closes on Back and the cluster stays', async ({ page }) => {
  await boot(page, { rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 25, onboarding: { seeded: true, done: true } }] } });
  await openAlphaFromHome(page);
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).tap();
  await page.touchscreen.tap(wrap.x + wrap.width * 0.55, wrap.y + wrap.height * 0.5);
  const wall = page.locator('.upgrade-backdrop');
  await expect(wall).toBeVisible({ timeout: 15000 });
  await back(page);
  await expect(wall).toHaveCount(0);
  await expectCluster(page, 'Alpha');
  await expectInApp(page);
  await back(page);
  await expectHome(page);
});

// The app's own question (feedback.confirm): Back answers it the way Escape
// does, cancel, so nothing is deleted and the cluster stays; Back again goes
// to where you were.
test('Back cancels a delete question: nothing is deleted and the cluster stays; Back again goes to where you were', async ({ page }) => {
  await boot(page);
  await openAlphaFromHome(page);
  // Beta's cluster card on Alpha: deleting a cluster asks first.
  await openCardMenu(page);
  // Delete is a tile of the sheet's quick row now (plan.md §2.3, Phone sheet).
  await page.locator('.ctx-quick').getByRole('menuitem', { name: 'Delete', exact: true }).tap();
  await expect(menu(page)).toHaveCount(0);
  const question = page.locator('.feedback-dialog');
  await expect(question).toBeVisible();
  await expectInApp(page);
  await back(page);
  await expect(question).toHaveCount(0);
  await expect(page.locator('.canvas-wrap .card')).toHaveCount(1);
  await expectCluster(page, 'Alpha');
  await expectInApp(page);
  await back(page);
  await expectHome(page);
  await expectInApp(page);
});

// A comment's sheet lies over the whole screen on a phone and an iPad
// (comments/CanvasCommentCard.jsx): Back closes it and the cluster stays, the
// words written in it are kept for next time, and Back again goes to where
// you were.
test('Back closes a comment sheet, keeps what was written and stays on the cluster; Back again goes to where you were', async ({ page }) => {
  await boot(page);
  await openAlphaFromHome(page);
  const sheet = page.locator('.cmt-sheet-host');
  const addComment = async () => {
    await openCardMenu(page);
    await menu(page).getByRole('menuitem', { name: 'Add comment', exact: true }).tap();
    await expect(menu(page)).toHaveCount(0);
    await expect(sheet).toBeVisible();
  };
  await addComment();
  await sheet.locator('textarea.cmt-input').fill('Hold this a beat longer');
  await expectInApp(page);
  await back(page);
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.cmt-sheet-scrim')).toHaveCount(0);
  await expectCluster(page, 'Alpha');
  await expectInApp(page);

  // Unsent words are kept, as when the sheet is closed any other way.
  await addComment();
  await expect(sheet.locator('textarea.cmt-input')).toHaveValue('Hold this a beat longer');
  // Closed by its own button it leaves nothing behind: one Back is the place before.
  await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(sheet).toHaveCount(0);
  await expectCluster(page, 'Alpha');
  await back(page);
  await expectHome(page);
  await expectInApp(page);
});

// The list of a cluster's comments is a sheet on a phone
// (comments/CanvasCommentsList.jsx): Back closes it and the cluster stays.
test('Back closes the comments list sheet and stays on the cluster; Back again goes to where you were', async ({ page }) => {
  test.skip(test.info().project.name === 'tablet', 'the list is a sheet on a phone (≤640px)');
  await boot(page);
  await openAlphaFromHome(page);
  await page.locator('.cnv-comments-eye').tap();
  const list = page.locator('.cmt-list--sheet');
  await expect(list).toBeVisible();
  await expectInApp(page);
  await back(page);
  await expect(list).toHaveCount(0);
  await expect(page.locator('.cmt-list-scrim')).toHaveCount(0);
  await expectCluster(page, 'Alpha');
  await expectInApp(page);
  await back(page);
  await expectHome(page);
  await expectInApp(page);
});

// The tag picker is a popover of its own, not a Modal or a Sheet: Back closes
// it and the cluster stays; Back again goes to where you were.
test('Back closes the tag picker and stays on the cluster; Back again goes to where you were', async ({ page }) => {
  await boot(page);
  await openAlphaFromHome(page);
  await openCardMenu(page);
  await menu(page).getByRole('menuitem', { name: 'Tag…', exact: true }).tap();
  await expect(menu(page)).toHaveCount(0);
  const picker = page.locator('.tag-picker');
  await expect(picker).toBeVisible();
  await expectInApp(page);
  await back(page);
  await expect(picker).toHaveCount(0);
  await expectCluster(page, 'Alpha');
  await expectInApp(page);
  await back(page);
  await expectHome(page);
  await expectInApp(page);
});

// ── ?local=1: a picture and a file to open ─────────────────────────────

const stillLocal = (page) => expect(page).toHaveURL(/\?local=1/);

async function bootLocal(page) {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  await page.addStyleTag({ content: '.twk-gear { display: none !important; }' });
  await expect(page.locator('[data-card-id="home-image"]')).toBeVisible({ timeout: 30000 });
}

// ?local=1 keeps no cluster history, so the test lays one same-page entry of
// its own under the panel. One Back must land exactly on it (a double pop
// would pass it), and the next must leave it (a dead panel entry would not).
const layUnder = (page) => page.evaluate(() => {
  window.history.pushState({ ...(window.history.state || {}), specUnder: 1 }, '');
});
const onUnder = (page) => page.evaluate(() => window.history.state?.specUnder === 1);
async function backToUnder(page) {
  await back(page);
  await stillLocal(page);
  await expect.poll(() => onUnder(page)).toBe(true);
}
async function backPastUnder(page) {
  await back(page);
  await stillLocal(page);
  await expect.poll(() => onUnder(page)).toBe(false);
  await expect(page.locator('.canvas-wrap, .list-wrap').first()).toBeVisible();
}

test('Back closes a picture opened full size', async ({ page }) => {
  await bootLocal(page);
  await layUnder(page);
  const b = await page.locator('[data-card-id="home-image"]').boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height - 6);
  await page.locator('.sel-menu .card-menu-btn').tap();
  await menu(page).getByRole('menuitem', { name: 'View full size', exact: true }).tap();
  await expect(page.locator('.lightbox-img')).toBeVisible();
  await backToUnder(page);
  await expect(page.locator('.lightbox')).toHaveCount(0);
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await backPastUnder(page);
  await expect(page.locator('.lightbox')).toHaveCount(0);
});

test('Back closes Quick look on a file', async ({ page }) => {
  await bootLocal(page);
  await page.locator('.view-pill--primary .view-pill-btn').nth(1).tap();
  const files = page.locator('.list-wrap');
  const tile = files.locator('.ct-tile[data-item-id="home-note"]');
  await expect(tile).toBeVisible();
  await layUnder(page);
  await tile.tap();
  const ql = page.getByRole('dialog', { name: /^Quick look/ });
  await expect(ql).toBeVisible();
  await backToUnder(page);
  await expect(ql).toHaveCount(0);
  await expect(tile).toBeVisible();
  await backPastUnder(page);
  await expect(ql).toHaveCount(0);
  await expect(tile).toBeVisible();
});

test('Back leaves Select in Files, as Done does', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await bootLocal(page);
  await page.locator('.view-pill--primary .view-pill-btn').nth(1).tap();
  const files = page.locator('.list-wrap');
  const tile = files.locator('.ct-tile[data-item-id="home-note"]');
  await expect(tile).toBeVisible();
  await tile.scrollIntoViewIfNeeded();
  await layUnder(page);
  const b = await tile.boundingBox();
  await hold(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await menu(page).getByRole('menuitem', { name: 'Select', exact: true }).tap();
  await expect(menu(page)).toHaveCount(0);
  await expect(files).toHaveClass(/is-selecting/);
  await backToUnder(page);
  await expect(files).not.toHaveClass(/is-selecting/);
  await expect(tile).toBeVisible();
  await backPastUnder(page);
  await expect(files).not.toHaveClass(/is-selecting/);
  await expect(tile).toBeVisible();
});
