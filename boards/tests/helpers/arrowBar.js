// A picked arrow's bar by what it does (components/toolbar/CanvasBarsA.jsx
// PickedArrowBarA, whose own spec is tests/arrow-picked-look.spec.js), a
// phone's heads in ⋯.

export const arrowBar = (page) => page.locator('.tl-bar.pa-a');

// Its label field.
export const arrowLabel = (page) => arrowBar(page).locator('input.ap-label-input');

// A head by its name ('No arrowheads', 'Single arrowhead', 'Double
// arrowhead'), in the row or, on a phone, in ⋯.
const onRow = (page, name) => arrowBar(page).locator(`[aria-label="${name}"]`);
export const arrowHead = (page, name) => onRow(page, name)
  .or(page.getByRole('menu', { name: 'More arrow options' }).getByRole('menuitemradio', { name, exact: true }));

// Picks a head, through ⋯ where the row doesn't carry it.
export async function pickArrowHead(page, name) {
  await arrowBar(page).waitFor();
  if (!(await onRow(page, name).count())) {
    await arrowBar(page).getByRole('button', { name: 'More arrow options' }).click();
  }
  await arrowHead(page, name).click();
}

// Whether a head is the arrow's: the row's are toggles (aria-pressed), ⋯'s
// radios (aria-checked).
export const arrowHeadPicked = (page, name) => arrowHead(page, name)
  .evaluate((el) => (el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed')) === 'true');
