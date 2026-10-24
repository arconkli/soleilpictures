// The doc window's controls by what they do, in either of its looks: today's,
// and the doc look's (lib/appHost.js docLookAllowed; on dev the opt-in
// soleil.dev.docLook = '1'), which carries the same controls under its own
// names and in its own places (tests/doc-look-frame.spec.js, doc-bar-a.spec.js,
// doc-panel-*.spec.js). A spec that reaches a control through these passes
// with the look on and off. `scope` is the page or a locator.

import { expect } from '@playwright/test';

const pageOf = (scope) => (typeof scope.page === 'function' ? scope.page() : scope);

// Holds a spec to today's look: one of today's controls whose counterpart in
// the look has a spec of its own (named where this is called). Call it before
// the page loads.
export const todaysLook = (page) => page.addInitScript(() => {
  try { window.localStorage.setItem('soleil.dev.docLook', '0'); } catch (_) {}
});

// Whether the page wears the look (main.jsx marks <html data-doc-look="a">).
export const inDocLook = (page) => page.evaluate(() => document.documentElement.dataset.docLook === 'a');

// Opens the page list as a phone's or a touch tablet's drawer: today the button
// above the toolbar, in the look the header's pages toggle.
export const pageListButton = (scope) =>
  scope.getByRole('button', { name: /^(Page list|Pages and scenes|Show pages)$/ });

// Docks the doc beside the canvas.
export const dockButton = (scope) =>
  scope.getByRole('button', { name: /^(Dock to side|Dock beside the canvas)$/ });

// The doc's footer: under the page today, across the whole window in the look.
export const docFooter = (scope) => scope.locator('.doc-foot, .dl-foot');

// The doc's row of tools: today's .doc-tb, the look's Formatting toolbar.
export const docBar = (scope) =>
  scope.locator('.doc-tb').or(scope.getByRole('toolbar', { name: 'Formatting', exact: true })).first();

// The bar's Link and Comment: "Add link" and "Add comment" today.
export const linkButton = (scope) => docBar(scope).getByRole('button', { name: /^(Add link|Link)$/ });
export const commentButton = (scope) => docBar(scope).getByRole('button', { name: /^(Add comment|Comment)$/ });

// The bar's Insert: "Insert a block" today.
export const insertButton = (scope) => docBar(scope).getByRole('button', { name: /^(Insert|Insert a block)$/ });

// Opens Insert and picks a row (`name`, a RegExp or a row's name).
export async function insertRow(scope, name) {
  await insertButton(scope).click();
  await pageOf(scope).getByRole('menuitem', { name: typeof name === 'string' ? new RegExp(`^${name}`) : name }).click();
}

// Bookmarks the caret's spot: today the bar's button; in the look Insert's
// Bookmark this spot (a screenplay's bar has the button).
export async function bookmarkSpot(scope) {
  const button = docBar(scope).getByRole('button', { name: 'Bookmark this spot', exact: true });
  const insert = docBar(scope).getByRole('button', { name: 'Insert', exact: true });
  await button.or(insert).first().waitFor();
  if (await button.count()) { await button.click(); return; }
  await insertRow(scope, 'Bookmark this spot');
}

// Find's field: today's find bar, the look's side panel.
export const findPanel = (scope) => scope.getByRole('complementary', { name: 'Comments and find' });
export const findField = (scope) =>
  scope.locator('.doc-find-input:not(.doc-find-input--replace)')
    .or(findPanel(scope).getByRole('textbox', { name: 'Find', exact: true })).first();

// Zooms in `times` times: today the bar's +, in the look the footer's zoom
// menu (a reader's bar keeps its +).
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

// ⋯'s menu, open; in the look only (today's bar has no ⋯).
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

// Sets the layout: real pages (`paged`) or pageless. Today the bar's Pages
// pill; in the look ⋯'s Layout.
export async function setPaged(scope, paged = true) {
  const pill = scope.locator('.doc-tb-pages-toggle');
  const more = docBar(scope).getByRole('button', { name: 'More', exact: true });
  await pill.or(more).first().waitFor();
  if (await pill.count()) {
    if ((await pill.getAttribute('aria-pressed')) !== String(paged)) await pill.click();
    return;
  }
  const row = await moreRow(scope, 'Layout', 'menuitemradio', paged ? /^Pages/ : /^Pageless/);
  if ((await row.getAttribute('aria-checked')) === 'true') { await pageOf(scope).keyboard.press('Escape'); return; }
  await row.click();
}

// The layout the doc's controls say it has, real pages (`paged`) or
// pageless: today the Pages pill's state, in the look ⋯'s Layout (put away
// again after).
export async function expectLayoutShown(scope, paged) {
  const pill = scope.locator('.doc-tb-pages-toggle');
  const more = docBar(scope).getByRole('button', { name: 'More', exact: true });
  await pill.or(more).first().waitFor();
  if (await pill.count()) {
    await expect(pill).toHaveAttribute('aria-pressed', String(paged));
    return;
  }
  const row = await moreRow(scope, 'Layout', 'menuitemradio', paged ? /^Pages/ : /^Pageless/);
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await pageOf(scope).keyboard.press('Escape');
}

// An Export row, its menu open: today the bar's Export; in the look ⋯'s
// Export (a reader's bar has Export of its own). `kind` is pdf, markdown,
// html, fountain or fdx.
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

// Makes the doc a screenplay (`on`), or a document again: today the bar's
// Screenplay toggle, in the look the Doc type menu's rows (the bar's Doc
// type; folded, ⋯'s; on a phone, the header's ⋯).
export async function setScreenplay(scope, on = true) {
  const page = pageOf(scope);
  const toggle = scope.locator('.doc-tb-screenplay-toggle');
  const docType = scope.getByRole('button', { name: 'Doc type', exact: true });
  const barMore = docBar(scope).getByRole('button', { name: 'More', exact: true });
  const headMore = scope.locator('.dl-head').getByRole('button', { name: /^More/ });
  await toggle.or(docType).or(barMore).or(headMore).first().waitFor();
  if (await toggle.count()) {
    if ((await toggle.getAttribute('aria-pressed')) !== String(on)) await toggle.click();
    return;
  }
  if (await docType.count()) {
    await docType.click();
  } else {
    await ((await barMore.count()) ? barMore : headMore).click();
    await page.getByRole('menu', { name: 'More', exact: true }).getByRole('menuitem', { name: /^Doc type/ }).click();
  }
  await page.getByRole('menuitemradio', { name: on ? /^Screenplay/ : /^Document/ }).click();
}

// A screenplay's side panel on its Elements, in the look (⋯ › Elements).
async function openElements(scope) {
  const list = findPanel(scope).getByRole('listbox', { name: 'Element' });
  if (await list.count()) return;
  const menu = await openMore(scope);
  await menu.getByRole('menuitem', { name: /^Elements/ }).click();
  await list.waitFor();
}

// Turns a screenplay's title page on (`on`) or off: today the bar's Title
// Page pill, in the look the side panel's Title page.
export async function setTitlePage(scope, on = true) {
  const pill = scope.locator('.doc-tb-titlepage-toggle');
  const more = docBar(scope).getByRole('button', { name: 'More', exact: true });
  await pill.or(more).first().waitFor();
  if (await pill.count()) {
    if ((await pill.getAttribute('aria-pressed')) !== String(on)) await pill.click();
    return;
  }
  await openElements(scope);
  const sw = findPanel(scope).getByRole('switch', { name: 'Title page' });
  if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
}

// Pairs the caret's speech with the one above, as dual dialogue: today the
// bar's Dual, in the look the side panel's Pair with the speech above.
export async function pairDual(scope) {
  const dual = scope.locator('button[title^="Dual dialogue"]');
  const more = docBar(scope).getByRole('button', { name: 'More', exact: true });
  await dual.or(more).first().waitFor();
  if (await dual.count()) { await dual.click(); return; }
  await openElements(scope);
  await findPanel(scope).getByRole('button', { name: 'Pair with the speech above' }).click();
}

// A screenplay's element picker knows the caret's element: today the bar's
// select is enabled, in the look the side panel's Elements has the caret's
// checked and none greyed.
export async function expectElementsLive(scope) {
  const select = scope.locator('.doc-tb-select');
  const more = docBar(scope).getByRole('button', { name: 'More', exact: true });
  await select.or(more).first().waitFor();
  if (await select.count()) { await expect(select).toBeEnabled(); return; }
  await openElements(scope);
  const list = findPanel(scope).getByRole('listbox', { name: 'Element' });
  await expect(list.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
  await expect(list.locator('[role="option"][aria-disabled="true"]')).toHaveCount(0);
}

// Opens a closed doc card docked beside the canvas. Its Open beside, today and
// in the look for a doc with words; in the look an empty doc's card offers
// Start writing alone (mockup S-card), which opens it as it was last opened,
// so its header docks it from there.
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

// Opens a closed doc card over the canvas: its Open fullscreen, today and in
// the look for a doc with words; Start writing (as it was last opened, full
// screen for anyone who never docked) on an empty one in the look.
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
