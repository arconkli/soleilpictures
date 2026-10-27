// The note bar's controls by what they do (components/toolbar/NoteBarA.jsx,
// whose own spec is tests/note-bar-look.spec.js), wherever the bar has put
// them.

export const noteBar = (page) => page.locator('.tob');

// Bold, Italic, Underline, Strikethrough and the rest by name.
export const formatButton = (page, name) => noteBar(page).getByRole('button', { name, exact: true });

// The font: its button ("Font: Inter"; a finger's bar adds the size,
// "Font: Inter, size 15"), the font it names, and its list.
export const fontButton = (page) => noteBar(page).getByRole('button', { name: /^Font(: .+)?$/ });
export async function fontNamed(page) {
  const label = (await fontButton(page).getAttribute('aria-label')) || '';
  return label.replace(/^Font:?\s*/, '').replace(/, size \S+$/, '');
}
export const fontList = (page) => page.locator('.nb-font-pop');
// The list's heading over every font.
export const fontListHead = (page) => page.locator('.nb-font-pop .tl-mh').filter({ hasText: /^fonts$/i });
export async function pickFont(page, name) {
  await fontButton(page).click();
  await fontList(page).getByText(name, { exact: true }).first().click();
}
export async function openCustomFonts(page) {
  await fontButton(page).click();
  await page.getByRole('menuitem', { name: 'Add a custom font…' }).click();
}

// The size: the field, − and +, its presets' button and their list.
export const sizeField = (page) => noteBar(page).locator('input[aria-label="Font size"]');
export const sizeUp = (page) => noteBar(page).getByRole('button', { name: 'Increase font size' });
export const sizeDown = (page) => noteBar(page).getByRole('button', { name: 'Decrease font size' });
export const sizePresets = (page) => noteBar(page).getByRole('button', { name: 'Preset sizes' });
export const sizeList = (page) => page.locator('.size-combo-tl');
export const sizeOption = (page, px) => sizeList(page).getByRole('option', { name: String(px), exact: true });

// A colour's button ("Text color", "Card background", "Box background"), its
// menu, and a swatch in it by its colour (a hex, or 'transparent').
export const colourButton = (page, name) => noteBar(page).getByRole('button', { name, exact: true });
export const colourList = (page) => page.locator('.nb-colour-menu');
export const swatch = (page, c) => colourList(page)
  .getByLabel(c === 'transparent' ? 'No background' : `Color ${c}`, { exact: true }).first();
// The first of the menu's swatches that isn't the clear one or +.
export const someColour = (page) => colourList(page).locator('.tl-sw:not(.is-add):not(.is-clear)').first();
// What a colour's button shows: a bar (::after) or a chip (::before) of its
// own.
export const shownColour = (page, name) => colourButton(page, name).evaluate((b) => {
  const cs = getComputedStyle(b, b.classList.contains('nb-bg') ? '::before' : '::after');
  return { color: cs.backgroundColor, image: cs.backgroundImage };
});

// What a box's change applies to: the "Style scope" group, All boxes | This box.
export const scopeGroup = (page) => noteBar(page).getByRole('group', { name: 'Style scope' });

// Center in the box, by name.
export const centerInBox = (page) => noteBar(page).getByRole('button', { name: 'Center in the box', exact: true });

// The bar folds a row too wide for its window a step at a time (NoteBarA):
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

// A press on the bar that isn't on a control: the padding at its start.
export async function pressBarGap(page) {
  const b = await noteBar(page).boundingBox();
  await page.mouse.click(b.x + 2, b.y + b.height / 2);
}
