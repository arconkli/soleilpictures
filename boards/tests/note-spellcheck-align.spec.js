import { expect, test } from '@playwright/test';

// Spellcheck-underline alignment fix. The canvas zooms via `transform:
// scale(z)` on .canvas, under which the browser's native spellcheck
// squiggles drift from the glyphs (they paint in screen space). While
// editing, .note.is-editing neutralizes that scale — `transform: scale(1/z)`
// (net transform scale → 1, so underlines align) — and re-grows to the right
// on-screen size via CSS `zoom: z` (zoom scales the LAYOUT box, which keeps
// underlines aligned). `--cz` is published live by applyCanvasTransform().
//
// We can't reliably screenshot OS-native squiggles in CI, so we assert the
// GEOMETRY that makes them align: the editing note's computed zoom == the
// canvas zoom, its transform == scale(1/zoom) (net transform scale 1), the
// on-screen SIZE is preserved (no overflow/shrink), and the caret still
// hit-tests correctly inside the text.

const canvasZoom = (page) => page.evaluate(() =>
  new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.canvas')).transform).a);

const cz = (page) => page.evaluate(() =>
  parseFloat(getComputedStyle(document.querySelector('.canvas')).getPropertyValue('--cz')));

// { zoom, transformA } for the editing note. NB: getBoundingClientRect is
// unreliable for a `zoom`-ed element (Chrome reports it in a frame that
// drops the ancestor canvas scale), so we assert the computed zoom/transform
// directly — those are the load-bearing values, and zoom*transformA == 1
// proves the on-screen size is preserved (net scale identity).
async function editingNoteGeom(page) {
  return page.evaluate(() => {
    const note = document.querySelector('.note.is-editing');
    if (!note) return null;
    const cs = getComputedStyle(note);
    return {
      zoom: parseFloat(cs.zoom),
      transformA: new DOMMatrixReadOnly(cs.transform).a,
    };
  });
}

async function placeEditingNote(page) {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByTitle('Add note').click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  const card = page.locator('.card:has(.note-body)').last();
  await expect(card).toBeVisible();
  await page.keyboard.type('teh quikc brwon fox'); // deliberately misspelled
  // Commit, then re-open via double-click so we're firmly in edit mode
  // (a freshly-placed note's auto-focus can race the assertions).
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: cb.height - 30 } });
  await card.locator('.note-body').dblclick();
  await expect(page.locator('.note.is-editing')).toBeVisible();
}

function assertGeom(g, zoom) {
  expect(g, 'an editing note should exist').not.toBeNull();
  // CSS zoom on the editing note tracks the canvas zoom (squiggle-safe size)…
  expect(Math.abs(g.zoom - zoom)).toBeLessThan(0.02);
  // …and the counter-transform is its reciprocal, so the TEXT's net transform
  // scale is 1 (this is what keeps native spellcheck underlines aligned).
  expect(Math.abs(g.transformA - 1 / zoom)).toBeLessThan(0.02);
  // zoom * counter-transform == 1 → on-screen size identical to a non-edited
  // note at this zoom (verified visually via screenshot comparison too).
  expect(Math.abs(g.zoom * g.transformA - 1)).toBeLessThan(0.01);
}

test('editing note neutralizes the canvas transform-scale + hit-tests (z < 1, default zoom)', async ({ page }) => {
  await placeEditingNote(page);
  const z = await canvasZoom(page);
  expect(z).toBeLessThan(1); // local reset opens at ~0.66–0.79
  expect(Math.abs((await cz(page)) - z)).toBeLessThan(0.01); // --cz published
  assertGeom(await editingNoteGeom(page), z);

  // Hit-testing under the zoom+counter-scale combo (pitfall g): a screen point
  // visually over the on-screen note must resolve to the editable note. We
  // derive it from the CARD's boundingBox (the card has no `zoom`, so its rect
  // is reliable — unlike the zoomed .note's). elementFromPoint exercises the
  // browser's real painted hit-testing; if the transform broke it the point
  // would resolve to the canvas/background instead.
  const box = await page.locator('.card:has(.note.is-editing)').boundingBox();
  const hit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return !!(el && el.closest && el.closest('.note.is-editing'));
  }, [box.x + box.width * 0.5, box.y + box.height * 0.25]);
  expect(hit, 'a point over the note should hit-test to the editable note').toBe(true);
});

test('geometry holds at a higher zoom (z > 1)', async ({ page }) => {
  await placeEditingNote(page);
  // Zoom IN one notch, anchored at the NOTE's own screen centre so it stays in
  // view, then let state settle.
  const cardBox = await page.locator('.card:has(.note.is-editing)').boundingBox();
  await page.evaluate(([cx, cy]) => {
    document.querySelector('.canvas-wrap').dispatchEvent(new WheelEvent('wheel', {
      deltaY: -150, ctrlKey: true, deltaMode: 0,
      clientX: cx, clientY: cy, bubbles: true, cancelable: true,
    }));
  }, [cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2]);
  await page.waitForTimeout(300);
  const z = await canvasZoom(page);
  expect(z).toBeGreaterThan(1);
  expect(Math.abs((await cz(page)) - z)).toBeLessThan(0.02);
  assertGeom(await editingNoteGeom(page), z);
});
