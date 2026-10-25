// A picked arrow's bar by what it does, in either of its looks: today's
// popover (components/ArrowPopover.jsx), and the toolbar look's
// (lib/appHost.js toolbarLookAllowed; on everywhere, and on dev unless
// soleil.dev.toolbarLook = '0'; components/toolbar/CanvasBarsA.jsx
// PickedArrowBarA), which carries the same controls by the same names, a
// phone's heads in ⋯ (tests/arrow-picked-look.spec.js). A spec that reaches a
// control through these passes with the look on and off.

export const arrowBar = (page) => page.locator('.arrow-popover, .tl-bar.pa-a');

// Its label field.
export const arrowLabel = (page) => arrowBar(page).locator('input.ap-label-input');

// A head by its name ('No arrowheads', 'Single arrowhead', 'Double
// arrowhead'): today's carries it as a title, the look's as its name, in the
// row or, on a phone, in ⋯.
const onRow = (page, name) => arrowBar(page).locator(`[title="${name}"], [aria-label="${name}"]`);
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

// Whether a head is the arrow's: today's heads and ⋯'s are radios
// (aria-checked), the look's row toggles (aria-pressed).
export const arrowHeadPicked = (page, name) => arrowHead(page, name)
  .evaluate((el) => (el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed')) === 'true');
