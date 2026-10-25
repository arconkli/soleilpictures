// The note bar's controls by what they do, in either of its looks: today's,
// and the toolbar look's (lib/appHost.js toolbarLookAllowed; on everywhere,
// and on dev unless soleil.dev.toolbarLook = '0';
// components/toolbar/NoteBarA.jsx), which carries the same controls under its
// own names and in its own places (tests/note-bar-look.spec.js). A spec that
// reaches a control through these passes with the look on and off.

// Holds a spec to today's bars: one of today's controls whose counterpart in
// the look has a spec of its own (named where this is called). Call it before
// the page loads.
export const todaysBars = (page) => page.addInitScript(() => {
  try { window.localStorage.setItem('soleil.dev.toolbarLook', '0'); } catch (_) {}
});

// Whether the page wears the look (main.jsx marks <html data-tb="a">).
export const inToolbarLook = (page) => page.evaluate(() => document.documentElement.dataset.tb === 'a');

export const noteBar = (page) => page.locator('.tob');

// Bold, Italic, Underline and the rest by name; Strikethrough is "Strike"
// today.
export const formatButton = (page, name) => noteBar(page).getByRole('button', {
  name: name === 'Strikethrough' ? /^(Strike|Strikethrough)$/ : name,
  exact: true,
});

// The font: its button ("Font: Inter"; a finger's bar in the look adds the
// size, "Font: Inter, size 15"), the font it names, and its list.
export const fontButton = (page) => noteBar(page).getByRole('button', { name: /^Font(: .+)?$/ });
export async function fontNamed(page) {
  const label = (await fontButton(page).getAttribute('aria-label')) || '';
  return label.replace(/^Font:?\s*/, '').replace(/, size \S+$/, '');
}
export const fontList = (page) => page.locator('.font-pop, .nb-font-pop');
// The list's heading over every font ("FONTS" today, "Fonts" in the look).
export const fontListHead = (page) => page.locator('.font-pop .font-pop-label, .nb-font-pop .tl-mh').filter({ hasText: /^fonts$/i });
export async function pickFont(page, name) {
  await fontButton(page).click();
  await fontList(page).getByText(name, { exact: true }).first().click();
}
export async function openCustomFonts(page) {
  await fontButton(page).click();
  await page.getByRole('button', { name: '+ Add custom font…' })
    .or(page.getByRole('menuitem', { name: 'Add a custom font…' })).first().click();
}

// The size: the field, − and +, its presets' button and their list (options
// in both).
export const sizeField = (page) => noteBar(page).locator('input[aria-label="Font size"]');
export const sizeUp = (page) => noteBar(page).getByRole('button', { name: 'Increase font size' });
export const sizeDown = (page) => noteBar(page).getByRole('button', { name: 'Decrease font size' });
export const sizePresets = (page) => noteBar(page).getByRole('button', { name: 'Preset sizes' });
export const sizeList = (page) => page.locator('.size-combo-pop, .size-combo-tl');
export const sizeOption = (page, px) => sizeList(page).getByRole('option', { name: String(px), exact: true });

// A colour's button ("Text color", "Card background", "Box background"), its
// popover, and a swatch in it by its colour (a hex, or 'transparent').
export const colourButton = (page, name) => noteBar(page).getByRole('button', { name, exact: true });
export const colourList = (page) => page.locator('.tob-pop, .nb-colour-menu');
export const swatch = (page, c) => colourList(page)
  .getByLabel(c === 'transparent' ? 'No background' : `Color ${c}`, { exact: true }).first();
// The first of the bar's own swatches that isn't the clear one or +.
export const someColour = (page) => colourList(page)
  .locator('.tob-sw:not(.tob-sw-custom):not([title="No background"]), .tl-sw:not(.is-add):not(.is-clear)').first();
// What a colour's button shows: today a bar under the A or a dot, in the look
// a bar (::after) or a chip (::before) of its own.
export const shownColour = (page, name) => colourButton(page, name).evaluate((b) => {
  const el = b.querySelector('.tob-color-bar, .tob-sw-dot');
  const cs = el ? getComputedStyle(el) : getComputedStyle(b, b.classList.contains('nb-bg') ? '::before' : '::after');
  return { color: cs.backgroundColor, image: cs.backgroundImage };
});

// What a box's change applies to: the "Style scope" group, All boxes | This box.
export const scopeGroup = (page) => noteBar(page).getByRole('group', { name: 'Style scope' });

// Center in the box, by name in both.
export const centerInBox = (page) => noteBar(page).getByRole('button', { name: 'Center in the box', exact: true });

// The look folds a row too wide for its window a step at a time (NoteBarA):
// Strikethrough, Clear formatting, the aligns, Center in the box and Comment
// go into ⋯ (More formatting). Presses the bar's button of that name, or ⋯'s
// row where the bar has folded it away.
export const moreButton = (page) => noteBar(page).getByRole('button', { name: 'More formatting', exact: true });
export async function pressControl(page, name) {
  const button = noteBar(page).getByRole('button', { name, exact: true });
  if (await button.count()) { await button.click(); return; }
  await moreButton(page).click();
  await page.locator('.nb-more').getByText(name, { exact: true }).click();
}

// A press on the bar that isn't on a control: a separator today, the
// padding at the bar's start in the look.
export async function pressBarGap(page) {
  if (await inToolbarLook(page)) {
    const b = await noteBar(page).boundingBox();
    await page.mouse.click(b.x + 2, b.y + b.height / 2);
  } else {
    await noteBar(page).locator('.tob-sep').first().click({ force: true });
  }
}
