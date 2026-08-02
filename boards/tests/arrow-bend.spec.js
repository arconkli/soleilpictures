import { expect, test } from '@playwright/test';

// End-to-end for the arrow bend handle: create a real arrow, discover the
// midpoint dot ON HOVER, grab it to bend, and confirm the rendered path changes
// shape. Runs the full editor in local QA mode (no backend).
//
// Coordinate note: in local QA mode the canvas auto-fits on content change and
// `panRef` can lag the rendered transform, so `clientToCanvas` (used mid-drag)
// isn't a reliable screen↔data inverse here. We therefore locate on-canvas SVG
// elements via their live `getScreenCTM()` (visual truth) and assert path SHAPE,
// not pixel-exact belly position — the exact apex math is covered by the pure
// geometry suite in arrows.spec.js ("arrow manual bend").
//
// Path-shape legend for the visible arrow line (data-arrow-line):
//   contains 'C'  → auto-routed cubic (open-space curve)  [default]
//   contains 'Q'  → manual quadratic bend                 [dot dragged]
//   contains 'L'  → straight line                         [straight toggle]

// Screen point at fraction `f` along the visible arrow path, via the SVG CTM.
const pointOnArrow = (page, f) => page.evaluate((frac) => {
  const el = document.querySelector('.arrows-layer [data-arrow-line]');
  const p = el.getPointAtLength(el.getTotalLength() * frac);
  const m = el.getScreenCTM();
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}, f);

// Screen center of the bend dot, via the SVG CTM (cx/cy exist regardless of the
// dot's hover opacity, so this works before the dot is revealed too).
const bendDotScreen = (page) => page.evaluate(() => {
  const el = document.querySelector('.arrows-layer [data-arrow-bend-dot]');
  if (!el) return null;
  const cx = parseFloat(el.getAttribute('cx')), cy = parseFloat(el.getAttribute('cy'));
  const m = el.getScreenCTM();
  return { x: m.a * cx + m.c * cy + m.e, y: m.b * cx + m.d * cy + m.f };
});

const bendVisOpacity = (page) => page.evaluate(() => {
  const el = document.querySelector('.arrows-layer .arrow-bend-vis');
  return el ? parseFloat(getComputedStyle(el).opacity) : null;
});

const arrowPathD = (page) =>
  page.locator('.arrows-layer [data-arrow-line]').getAttribute('d');

// Right-click the arrow's line at a point that actually lands on it — scans a
// few fractions and picks the first whose screen point hit-tests to the arrow
// group, so the floating popover / cards / endpoint handles don't intercept.
async function rightClickArrowLine(page) {
  const pt = await page.evaluate(() => {
    const el = document.querySelector('.arrows-layer [data-arrow-line]');
    const total = el.getTotalLength();
    const m = el.getScreenCTM();
    for (const f of [0.7, 0.75, 0.65, 0.8, 0.3, 0.35, 0.85, 0.25]) {
      const p = el.getPointAtLength(total * f);
      const sx = m.a * p.x + m.c * p.y + m.e, sy = m.b * p.x + m.d * p.y + m.f;
      const hit = document.elementFromPoint(sx, sy);
      if (hit && hit.closest('[data-arrow-idx]')) return { x: sx, y: sy };
    }
    return null;
  });
  if (!pt) throw new Error('no on-arrow right-click point found');
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
}

test('bend dot reveals on hover, drag bends, context menu toggles straight and resets', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  const canvas = page.locator('.canvas-wrap');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);

  // Two cards on the same row, far apart → auto route is an open-space cubic.
  await page.getByRole('button', { name: 'Add cluster tool', exact: true }).click();
  await canvas.click({ position: { x: 300, y: 420 } });
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await canvas.click({ position: { x: 950, y: 420 } });
  await expect(page.locator('.card')).toHaveCount(2);

  // Draw the arrow between them (two card clicks; tool auto-returns to select).
  await page.getByRole('button', { name: 'Arrow tool', exact: true }).click();
  await page.locator('.card', { has: page.locator('.bc') }).first().click({ position: { x: 20, y: 20 } });
  await page.locator('.card', { has: page.locator('.note') }).last().click({ position: { x: 20, y: 20 } });
  await expect(page.locator('.arrows-layer [data-arrow-line]')).toHaveCount(1);

  // Sync the canvas transform with `panRef` via a real pan gesture, then return
  // to the Select tool. In QA mode the on-open auto-fit leaves panRef lagging the
  // rendered transform, which throws mid-drag `clientToCanvas` math off; a genuine
  // pan gesture re-syncs it so the bend drag behaves exactly like the real editor
  // (belly tracks the cursor, path stays on-screen). Not needed in production.
  await page.getByRole('button', { name: 'Pan tool', exact: true }).click();
  await page.mouse.move(640, 300);
  await page.mouse.down();
  await page.mouse.move(665, 325, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('v'); // back to Select tool
  expect(await arrowPathD(page)).toContain('C');

  // The dot exists but is hidden until the arrow is hovered (discoverability).
  await page.mouse.move(8, 8); // park the cursor off the arrow
  await expect.poll(() => bendVisOpacity(page)).toBe(0);

  // Hover the arrow → the mid-arrow dot fades in (no click/select needed).
  const dot = await bendDotScreen(page);
  await page.mouse.move(dot.x, dot.y);
  await expect.poll(() => bendVisOpacity(page)).toBeGreaterThan(0);

  // Grab the hovered dot and drag → selects the arrow AND bends it in one
  // gesture; the path becomes a manual quadratic ('Q', no longer 'C').
  await page.mouse.down();
  await page.mouse.move(dot.x + 30, dot.y + 70, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => arrowPathD(page)).toContain('Q');
  expect(await arrowPathD(page)).not.toContain('C');
  // Now selected → the dot is fully solid.
  await expect.poll(() => bendVisOpacity(page)).toBe(1);

  // Right-click the arrow line → arrow menu → "Straight arrow" → goes straight.
  await rightClickArrowLine(page);
  await page.getByRole('menuitem', { name: 'Straight arrow' }).click();
  await expect.poll(() => arrowPathD(page)).toContain('L');
  expect(await arrowPathD(page)).not.toContain('Q');

  // Back to curved → the earlier bend is restored (survives the straight
  // round-trip, so 'Q' again, not the auto 'C').
  await rightClickArrowLine(page);
  await page.getByRole('menuitem', { name: 'Curved arrow' }).click();
  await expect.poll(() => arrowPathD(page)).toContain('Q');

  // Reset curve → back to the auto route (cubic again).
  await rightClickArrowLine(page);
  await page.getByRole('menuitem', { name: 'Reset curve' }).click();
  await expect.poll(() => arrowPathD(page)).toContain('C');
  expect(await arrowPathD(page)).not.toContain('Q');
});
