// One cluster, one menu: the sidebar tree, a folder row on the Files page and a
// Home star's card build the cluster's menu with the one builder
// (lib/menus/clusterMenu.js), so it shows the same rows in the same order
// wherever it opens. On the canvas a cluster is a card, whose own menu
// (cardMenu's `board` kind) wraps the cluster rows with the card's.
//
// The Shared page is left out on purpose: its menus are short.
//
// The tree, Files and Home run in the sidebar QA harness (?sidebarqa=1), the
// real surfaces over fixture clusters; the canvas card in ?local=1. Local mode
// has no sidebar tree and no Home of its own (LocalBoardsApp), so those two
// are the harness's.
//
// The harness mounts without the app's shared action set (useClusterActions:
// only App provides it), so each surface offers the rows of its own handlers
// and they are not all the same set. What holds on every surface is the ORDER:
// the rows that are there come in the builder's order, and nothing the
// builder does not know shows up.
import { expect, test } from '@playwright/test';

const menu = (page) => page.locator('.ctx-menu:not(.ctx-submenu)');
const labelsOf = (page) => menu(page).locator('.ctx-item .ctx-label').allTextContents();

// clusterMenu.js's order, by rank: a row's words per state (Star / Unstar,
// Info / Hide info) share a rank.
const RANK = new Map([
  ['Select', 0],
  ['Open', 1], ['Send to…', 2], ['Share…', 3], ['Copy link', 4],
  ['Rename…', 5], ['New cluster inside', 6], ['Move to…', 7], ['Color and cover', 8],
  ['Star', 9], ['Unstar', 9], ['Info', 10], ['Hide info', 10], ['More', 11],
  ['Delete', 12], ['Remove from my list', 12],
]);
const ranks = (labels) => labels.map((l) => RANK.get(l));

function expectInOrder(labels, where) {
  const unknown = labels.filter((l) => !RANK.has(l));
  expect(unknown, `${where}: rows the cluster menu does not have`).toEqual([]);
  const r = ranks(labels);
  expect(r, `${where}: ${labels.join(' | ')}`).toEqual([...r].sort((a, b) => a - b));
  expect(new Set(r).size, `${where}: a row twice`).toBe(r.length);
}

async function openHarness(page, query = '') {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?sidebarqa=1${query}`);
  await page.waitForSelector('[data-sidebarqa-ready]');
}

// The same cluster ("Locations", inside Feature film) on each surface.
const SURFACES = {
  'the sidebar tree': async (page) => {
    await openHarness(page);
    await page.locator('.sb-tree-row', { hasText: 'Locations' }).first().click({ button: 'right' });
  },
  'a folder row on the Files page': async (page) => {
    await openHarness(page, '&surface=files');
    const folder = page.locator('.list-wrap [data-folder-id="loc"]');
    await expect(folder).toBeVisible({ timeout: 15000 });
    await folder.click({ button: 'right' });
  },
  'a Home star\'s card': async (page) => {
    // The universe is drawn in software here and drifts; reduced motion holds a
    // star still enough to click (as sidebar-home-messages.spec.js does).
    test.slow();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHarness(page, '&surface=home');
    await page.waitForSelector('.hg-map.is-ready');
    await page.locator('.hg-name', { hasText: 'Locations' }).click();
    const card = page.locator('.hg-card .ch-card');
    await expect(card).toBeVisible();
    await card.click({ button: 'right' });
  },
};

async function surfaceLabels(page, name) {
  await SURFACES[name](page);
  await expect(menu(page)).toBeVisible();
  const labels = await labelsOf(page);
  expect(labels.length, name).toBeGreaterThan(3);
  return labels;
}

for (const name of Object.keys(SURFACES)) {
  test(`${name}: the cluster menu's rows come in the one order`, async ({ page }) => {
    const labels = await surfaceLabels(page, name);
    expectInOrder(labels, name);
    // What every surface can do.
    expect(labels, name).toContain('Open');
    expect(labels, name).toContain('Color and cover');
  });
}

// The one builder's rows and order are unit-tested in
// src/lib/menuBuilders.test.mjs ("clusterMenu: editor" and the tests after it).

test.describe('a cluster card on the canvas', () => {
  async function openCluster(page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?local=1&reset=1');
    const card = page.locator('[data-card-id="b-features"]');
    await expect(card).toBeVisible({ timeout: 30000 });
    await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
    await card.click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
  }

  // A cluster card is a card: its menu is the card's universal order (plan.md
  // §1.4, §3 "cluster card": Open cluster · Color and cover › in the open
  // group, with Copy to my workspace after it), with the cluster's own rows
  // (Share…, Copy link, Star, Info) in it.
  const CARD_RANK = new Map([
    ['Open cluster', 0], ['Color and cover', 1], ['Copy to my workspace', 1.5],
    ['Send to…', 2], ['Share…', 3], ['Copy link', 4],
    ['Rename…', 5], ['Add comment', 6], ['Move to cluster', 7], ['Add to group', 8], ['Arrange', 9],
    ['Star', 10], ['Unstar', 10], ['Info', 11],
  ]);

  test('its menu has the cluster rows in the card\'s universal order, its quick row above them', async ({ page }) => {
    await openCluster(page);
    const labels = await labelsOf(page);
    const known = labels.filter((l) => CARD_RANK.has(l));
    // The cluster's rows are there, and in the card's order.
    expect(known, labels.join(' | ')).toEqual(expect.arrayContaining(['Open cluster', 'Copy link', 'Info']));
    const r = known.map((l) => CARD_RANK.get(l));
    expect(r, known.join(' | ')).toEqual([...r].sort((a, b) => a - b));
    // And the card's own quick row is there too.
    await expect(menu(page).locator('.ctx-quick')).toBeVisible();
  });

  // The canvas card says "Open cluster" and "Move to cluster" (rows.js
  // 'open-cluster', 'move'), where the cluster menu says "Open" and "Move to…":
  // on purpose, the canvas's words (plan.md §9, decisions of 11-17; the help
  // pages say so).
  test('it says the canvas\'s words: Open cluster, Move to cluster', async ({ page }) => {
    await openCluster(page);
    const labels = await labelsOf(page);
    expect(labels).toContain('Open cluster');
    expect(labels).toContain('Move to cluster');
    expect(labels).not.toContain('Open');
    expect(labels).not.toContain('Move to…');
  });
});
