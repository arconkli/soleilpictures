// The selection's bar in the toolbar look (the owner's pick "A · Islands",
// mockup A-select), shipped 2026-10-25 (components/toolbar/SelectionBarA.jsx):
// two or more cards picked on a desktop canvas get, on the bottom row, what
// right-clicking one of them offers, each control the card menu's own item:
// Tidy up, Align (and Distribute), Group, Tag (its picker, 2026-10-26), New
// cluster from N cards, Move N cards to…; ⋯ is that menu itself, over the bar,
// and Delete is ⌫'s, with its undo.
//
// On the real canvas, through ?local=1 (the home cluster's cards).
import { expect, test } from '@playwright/test';

const bar = (page) => page.getByRole('toolbar', { name: 'Selection' });
const button = (page, name) => bar(page).getByRole('button', { name, exact: true });
const card = (page, id) => page.locator(`[data-card-id="${id}"]`);
const PICKED = ['home-note', 'home-pal', 'home-image'];
const names = (loc) => loc.locator('button')
  .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()));
const meets = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// The note, the palette and the image on the home cluster, picked.
async function threePicked(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await expect(card(page, 'home-note')).toBeVisible({ timeout: 30000 });
  await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
  // By a corner, clear of what's on a card (the note's text), but the image
  // by its middle: its corner is its caption's +.
  const at = (id) => (id === 'home-image' ? {} : { position: { x: 6, y: 6 } });
  await card(page, PICKED[0]).click(at(PICKED[0]));
  for (const id of PICKED.slice(1)) await card(page, id).click({ ...at(id), modifiers: ['Shift'] });
  await expect(page.locator('.card.is-selected')).toHaveCount(3);
}
const lefts = (page) => page.evaluate((ids) => ids.map((id) => {
  const el = document.querySelector(`[data-card-id="${id}"]`);
  return Math.round(parseFloat(el.style.left));
}), PICKED);

test('three cards picked: the count, then Tidy up, Align, Group, Tag, New cluster, Move, More and Delete, by name', async ({ page }) => {
  await threePicked(page);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toContainText('3 selected');
  await expect(page.locator('.cnv-selcount')).toHaveCount(0);
  expect(await names(bar(page))).toEqual(['Tidy up', 'Align', 'Group', 'Tag', 'New cluster from 3 cards', 'Move 3 cards to…',
    'More', 'Delete']);
  await expect(button(page, 'Group')).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+G$/);
  await expect(button(page, 'Delete')).toHaveAttribute('aria-keyshortcuts', 'Backspace');
  // On the bottom row, clear of the rail and the zoom.
  const [b, rail, zoom, wrap] = await Promise.all([bar(page).boundingBox(), page.locator('.cnv-tools').boundingBox(),
    page.locator('.cnv-zoom').boundingBox(), page.locator('.canvas-wrap').boundingBox()]);
  expect(meets(b, rail)).toBe(false);
  expect(meets(b, zoom)).toBe(false);
  expect(wrap.y + wrap.height - (b.y + b.height)).toBeLessThan(30);
});

test('Tidy up\'s and Align\'s menus are the card menu\'s, and Align lines the cards up', async ({ page }) => {
  await threePicked(page);
  await button(page, 'Tidy up').click();
  const tidy = page.getByRole('menu', { name: 'Tidy up' });
  await expect(tidy.getByRole('menuitem')).toHaveText(['Justified rows', 'Masonry columns', 'Grid', 'Single row',
    'Single column']);
  await page.keyboard.press('Escape');
  await expect(tidy).toHaveCount(0);
  await button(page, 'Align').click();
  const align = page.getByRole('menu', { name: 'Align' });
  await expect(align.getByRole('menuitem')).toHaveText(['Left', 'Center', 'Right', 'Top', 'Middle', 'Bottom',
    'Horizontally', 'Vertically']);
  expect(new Set(await lefts(page)).size).toBeGreaterThan(1);
  await align.getByRole('menuitem', { name: 'Left', exact: true }).click();
  await expect.poll(async () => new Set(await lefts(page)).size).toBe(1);
  // Still picked, so the bar stays for the next step.
  await expect(bar(page)).toContainText('3 selected');
});

// Two dozen pictures dropped on an empty cluster, all picked. A drop is
// centred on the pointer, so the block reaches left of and above the board's
// corner, as most boards' cards do: there Tidy up used to floor each card at
// 8px on its own and pile every row onto one line, and Left on a grid piled
// each row.
async function dozensPicked(page, n = 24) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
  await page.evaluate(async (count) => {
    const shapes = [[1600, 1067], [1067, 1600], [1200, 1200], [1920, 800], [900, 1350], [2000, 1125]];
    const dt = new DataTransfer();
    for (let i = 0; i < count; i++) {
      const [w, h] = shapes[i % shapes.length];
      const c = new OffscreenCanvas(w / 8, h / 8);
      const g = c.getContext('2d');
      g.fillStyle = `hsl(${(i * 37) % 360} 60% 50%)`;
      g.fillRect(0, 0, w, h);
      dt.items.add(new File([await c.convertToBlob({ type: 'image/png' })], `still-${i + 1}.png`, { type: 'image/png' }));
    }
    const wrap = document.querySelector('.canvas-wrap');
    const r = wrap.getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, dataTransfer: dt };
    for (const type of ['dragenter', 'dragover', 'drop']) wrap.dispatchEvent(new DragEvent(type, at));
  }, n);
  await expect(page.locator('[data-card-id].card')).toHaveCount(n, { timeout: 15000 });
  await page.mouse.click(1300, 150);
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('.card.is-selected')).toHaveCount(n);
}
const boxes = (page) => page.evaluate(() => [...document.querySelectorAll('[data-card-id].card')].map((el) => ({
  id: el.dataset.cardId, x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: el.offsetWidth, height: el.offsetHeight,
})));
const piledPairs = (bs) => {
  let n = 0;
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (meets(bs[i], bs[j])) n++;
  return n;
};
const corner = (bs) => ({ x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)) });

test('Tidy up lays dozens of pictures out where they were, none on another, past the board\'s corner too', async ({ page }) => {
  await dozensPicked(page);
  const before = await boxes(page);
  expect(corner(before).y).toBeLessThan(8);
  await button(page, 'Tidy up').click();
  await page.getByRole('menu', { name: 'Tidy up' }).getByRole('menuitem', { name: 'Justified rows', exact: true }).click();
  await expect.poll(async () => piledPairs(await boxes(page))).toBe(0);
  const after = await boxes(page);
  expect(after.filter((b) => before.some((a) => a.id === b.id && (a.x !== b.x || a.y !== b.y))).length).toBeGreaterThan(0);
  // Where it was, to the pixel (a drop can leave half pixels; a tidy rounds).
  const [was, is] = [corner(before), corner(after)];
  expect(Math.abs(is.x - was.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(is.y - was.y)).toBeLessThanOrEqual(1);
});

test('Align lines dozens of pictures up without piling them: Left makes one column, in reading order', async ({ page }) => {
  await dozensPicked(page);
  const before = await boxes(page);
  const reading = [...before].sort((a, b) => a.y - b.y || a.x - b.x).map((b) => b.id);
  await button(page, 'Align').click();
  await page.getByRole('menu', { name: 'Align' }).getByRole('menuitem', { name: 'Left', exact: true }).click();
  await expect.poll(async () => new Set((await boxes(page)).map((b) => b.x)).size).toBe(1);
  const after = await boxes(page);
  expect(piledPairs(after)).toBe(0);
  expect([...after].sort((a, b) => a.y - b.y).map((b) => b.id)).toEqual(reading);
});

test('Group asks for a name, as the card menu\'s does, and groups them', async ({ page }) => {
  await threePicked(page);
  const labels = page.locator('.group-label');
  await expect(labels).toHaveCount(0);
  await button(page, 'Group').click();
  const dialog = page.getByRole('dialog', { name: 'Group these cards' });
  await dialog.getByRole('textbox').fill('Moodboard');
  await dialog.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(labels).toHaveCount(1);
  await expect(labels).toContainText('Moodboard');
});

test('Delete takes the three away with an undo, and Undo brings them back', async ({ page }) => {
  await threePicked(page);
  await button(page, 'Delete').click();
  for (const id of PICKED) await expect(card(page, id)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  for (const id of PICKED) await expect(card(page, id)).toHaveCount(1);
});

test('More opens the right-click menu itself, over the bar', async ({ page }) => {
  await threePicked(page);
  await button(page, 'More').click();
  const menu = page.locator('.ctx-menu').first();
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Delete (3)');
  const [m, b] = await Promise.all([menu.boundingBox(), bar(page).boundingBox()]);
  expect(m.y + m.height).toBeLessThanOrEqual(b.y + 1);
});

test('Escape closes a menu, and then lets go of the selection', async ({ page }) => {
  await threePicked(page);
  await button(page, 'Tidy up').click();
  await expect(page.getByRole('menu', { name: 'Tidy up' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Tidy up' })).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('.card.is-selected')).toHaveCount(0);
});

test('the arrows walk the bar, and leave the cards where they are', async ({ page }) => {
  await threePicked(page);
  const before = await lefts(page);
  await button(page, 'Tidy up').click();
  await page.keyboard.press('Escape');
  await expect(button(page, 'Tidy up')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(button(page, 'Align')).toBeFocused();
  await page.keyboard.press('End');
  await expect(button(page, 'Delete')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(button(page, 'Tidy up')).toBeFocused();
  expect(await lefts(page)).toEqual(before);
  // ⌫ from the bar is still the canvas's, on the selection.
  await page.keyboard.press('Backspace');
  for (const id of PICKED) await expect(card(page, id)).toHaveCount(0);
});
