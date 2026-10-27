// The doc window's controls by what they do, in the doc look (the owner's
// pick, shipped 2026-10-24: tests/doc-look-frame.spec.js, doc-bar-a.spec.js,
// doc-panel-*.spec.js), where a control can sit in more than one place: the
// bar's, ⋯'s once the bar has folded it, a phone's header. `scope` is the
// page or a locator. (A doc shared on its own, fileShare/DocShareView.jsx,
// keeps the editor before the look: doc-share.spec.js.)

import { expect } from '@playwright/test';

const pageOf = (scope) => (typeof scope.page === 'function' ? scope.page() : scope);

// Opens the page list as a phone's or a touch tablet's drawer: the header's
// pages toggle.
export const pageListButton = (scope) => scope.getByRole('button', { name: 'Show pages', exact: true });

// Docks the doc beside the canvas.
export const dockButton = (scope) => scope.getByRole('button', { name: 'Dock beside the canvas', exact: true });

// The doc's footer, across the whole window.
export const docFooter = (scope) => scope.locator('.dl-foot');

// The doc's row of tools.
export const docBar = (scope) => scope.getByRole('toolbar', { name: 'Formatting', exact: true }).first();

// The bar's Link and Comment.
export const linkButton = (scope) => docBar(scope).getByRole('button', { name: 'Link', exact: true });
export const commentButton = (scope) => docBar(scope).getByRole('button', { name: 'Comment', exact: true });

// The bar's Insert.
export const insertButton = (scope) => docBar(scope).getByRole('button', { name: 'Insert', exact: true });

// Opens Insert and picks a row (`name`, a RegExp or a row's name).
export async function insertRow(scope, name) {
  await insertButton(scope).click();
  await pageOf(scope).getByRole('menuitem', { name: typeof name === 'string' ? new RegExp(`^${name}`) : name }).click();
}

// Bookmarks the caret's spot: Insert's Bookmark this spot, or a screenplay's
// bar's button.
export async function bookmarkSpot(scope) {
  const button = docBar(scope).getByRole('button', { name: 'Bookmark this spot', exact: true });
  const insert = docBar(scope).getByRole('button', { name: 'Insert', exact: true });
  await button.or(insert).first().waitFor();
  if (await button.count()) { await button.click(); return; }
  await insertRow(scope, 'Bookmark this spot');
}

// Find's field, in the side panel.
export const findPanel = (scope) => scope.getByRole('complementary', { name: 'Comments and find' });
export const findField = (scope) => findPanel(scope).getByRole('textbox', { name: 'Find', exact: true });

// Zooms in `times` times: the footer's zoom menu, or a reader's bar's +.
export async function zoomIn(scope, times = 1) {
  const page = pageOf(scope);
  const plus = docBar(scope).getByRole('button', { name: 'Zoom in', exact: true });
  const foot = scope.locator('.dl-foot-zoom');
  await plus.or(foot).first().waitFor();
  for (let i = 0; i < times; i++) {
    if (await plus.count()) { await plus.click(); continue; }
    await foot.click();
    await page.getByRole('menu', { name: 'Zoom' }).getByRole('menuitem', { name: /^Zoom in/ }).click();
  }
}

// ⋯'s menu, open.
async function openMore(scope) {
  const page = pageOf(scope);
  await docBar(scope).getByRole('button', { name: 'More', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'More', exact: true });
  await menu.waitFor();
  return menu;
}

// A row of ⋯ that's either in it or, with the bar narrowed, in its submenu
// `sub` (Layout, Export): the row itself.
async function moreRow(scope, sub, role, name) {
  const page = pageOf(scope);
  const menu = await openMore(scope);
  const direct = menu.getByRole(role, { name });
  if (await direct.count()) return direct;
  await menu.getByRole('menuitem', { name: new RegExp(`^${sub}`) }).click();
  return page.getByRole('menu', { name: new RegExp(`^${sub}`) }).getByRole(role, { name });
}

// Sets the layout, in ⋯'s Layout: real pages (`paged`) or pageless.
export async function setPaged(scope, paged = true) {
  const row = await moreRow(scope, 'Layout', 'menuitemradio', paged ? /^Pages/ : /^Pageless/);
  if ((await row.getAttribute('aria-checked')) === 'true') { await pageOf(scope).keyboard.press('Escape'); return; }
  await row.click();
}

// The layout ⋯'s Layout says the doc has, real pages (`paged`) or pageless
// (⋯ put away again after).
export async function expectLayoutShown(scope, paged) {
  const row = await moreRow(scope, 'Layout', 'menuitemradio', paged ? /^Pages/ : /^Pageless/);
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await pageOf(scope).keyboard.press('Escape');
}

// An Export row, its menu open: ⋯'s Export, or a reader's bar's own Export.
// `kind` is pdf, markdown, html, fountain or fdx.
const EXPORTS = {
  pdf: /^(Export PDF|PDF|Print \/ Save as PDF|Print or save as PDF)/,
  markdown: /^(Export )?Markdown/,
  html: /^(Export )?HTML/,
  fountain: /^(Export )?Fountain/,
  fdx: /^(Export )?Final Draft/,
};
export async function exportRow(scope, kind) {
  const page = pageOf(scope);
  const name = EXPORTS[kind];
  const button = docBar(scope).getByRole('button', { name: 'Export', exact: true });
  const more = docBar(scope).getByRole('button', { name: 'More', exact: true });
  await button.or(more).first().waitFor();
  if (await button.count()) {
    await button.click();
    return page.getByRole('menuitem', { name });
  }
  return moreRow(scope, 'Export', 'menuitem', name);
}

// Makes the doc a screenplay (`on`), or a document again: the Doc type
// menu's rows (the bar's Doc type; folded, ⋯'s; on a phone, the header's ⋯).
export async function setScreenplay(scope, on = true) {
  const page = pageOf(scope);
  const docType = scope.getByRole('button', { name: 'Doc type', exact: true });
  const barMore = docBar(scope).getByRole('button', { name: 'More', exact: true });
  const headMore = scope.locator('.dl-head').getByRole('button', { name: /^More/ });
  await docType.or(barMore).or(headMore).first().waitFor();
  if (await docType.count()) {
    await docType.click();
  } else {
    await ((await barMore.count()) ? barMore : headMore).click();
    await page.getByRole('menu', { name: 'More', exact: true }).getByRole('menuitem', { name: /^Doc type/ }).click();
  }
  await page.getByRole('menuitemradio', { name: on ? /^Screenplay/ : /^Document/ }).click();
}

// A screenplay's side panel on its Elements (⋯ › Elements).
async function openElements(scope) {
  const list = findPanel(scope).getByRole('listbox', { name: 'Element' });
  if (await list.count()) return;
  const menu = await openMore(scope);
  await menu.getByRole('menuitem', { name: /^Elements/ }).click();
  await list.waitFor();
}

// Turns a screenplay's title page on (`on`) or off: the side panel's Title
// page.
export async function setTitlePage(scope, on = true) {
  await openElements(scope);
  const sw = findPanel(scope).getByRole('switch', { name: 'Title page' });
  if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
}

// Pairs the caret's speech with the one above, as dual dialogue: the side
// panel's Pair with the speech above.
export async function pairDual(scope) {
  await openElements(scope);
  await findPanel(scope).getByRole('button', { name: 'Pair with the speech above' }).click();
}

// A screenplay's element picker knows the caret's element: the side panel's
// Elements has the caret's checked and none greyed.
export async function expectElementsLive(scope) {
  await openElements(scope);
  const list = findPanel(scope).getByRole('listbox', { name: 'Element' });
  await expect(list.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
  await expect(list.locator('[role="option"][aria-disabled="true"]')).toHaveCount(0);
}

// Opens a closed doc card docked beside the canvas: its Open beside, on a
// doc with words. An empty doc's card offers Start writing alone (mockup
// S-card), which opens it as it was last opened, so its header docks it from
// there.
export async function dockFromCard(card) {
  const page = pageOf(card);
  const beside = card.getByRole('button', { name: 'Open beside' });
  const start = card.getByRole('button', { name: 'Start writing' });
  await beside.or(start).first().waitFor();
  if (await beside.count()) { await beside.click(); return; }
  await start.click();
  await page.locator('.doc-card-modal').first().waitFor();
  const full = page.locator('.doc-card-modal-full');
  if (await full.count()) await dockButton(full).click();
}

// Opens a closed doc card over the canvas: its Open fullscreen, on a doc with
// words; Start writing (as it was last opened, full screen for anyone who
// never docked) on an empty one.
export async function openFullFromCard(card) {
  const page = pageOf(card);
  const full = card.getByRole('button', { name: 'Open fullscreen' });
  const start = card.getByRole('button', { name: 'Start writing' });
  await full.or(start).first().waitFor();
  if (await full.count()) { await full.click(); return; }
  await start.click();
  await page.locator('.doc-card-modal').first().waitFor();
  if (!(await page.locator('.doc-card-modal-full').count())) {
    await page.locator('.doc-card-modal').getByRole('button', { name: 'Open fullscreen' }).click();
  }
}
