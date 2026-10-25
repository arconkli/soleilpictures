import { expect, test } from '@playwright/test';
import { arrowBar, arrowHeadPicked, pickArrowHead } from './helpers/arrowBar.js';
import { TOKEN, routeShareBundle, routeAnalytics } from './helpers/share-fixture.js';

// Canvas pointer gestures and menus: small regressions, one test each.
// Harness: ?local=1&reset=1&blank=1.

async function blank(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  // Generous: the first load after an edit re-transforms the whole canvas.
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800);
}

test('reordering a palette swatch and missing never drops a stray note', async ({ page }) => {
  await blank(page);
  await page.getByRole('button', { name: 'Add menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Palette', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x: 460, y: 360 } });
  await expect(page.locator('.pc').last()).toBeVisible();
  const cards = await page.locator('.card').count();

  // Release the swatch on bare canvas, well away from the palette. Dispatched
  // by hand with one shared DataTransfer, which is what a real drag carries
  // from dragstart through to drop.
  const accepted = await page.evaluate(() => {
    const dt = new DataTransfer();
    const cell = document.querySelector('.pc-cell');
    cell.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const wrap = document.querySelector('.canvas-wrap');
    const r = wrap.getBoundingClientRect();
    const at = { clientX: r.left + 700, clientY: r.top + 600 };
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at });
    wrap.dispatchEvent(over);
    wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
    cell.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return over.defaultPrevented;
  });
  await page.waitForTimeout(400);
  // The canvas doesn't even offer itself as a drop target for a swatch.
  expect(accepted).toBe(false);
  await expect(page.locator('.card')).toHaveCount(cards);
});

async function drag(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test('deleting an arrow from its menu does not select the next one', async ({ page }) => {
  await blank(page);
  await page.keyboard.press('a');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-arrow/);
  await drag(page, 380, 200, 600, 200);
  await page.keyboard.press('a');
  await drag(page, 380, 300, 600, 300);
  await page.keyboard.press('a');
  await drag(page, 380, 400, 600, 400);
  await page.keyboard.press('Escape');
  await expect(page.locator('.arrow-g')).toHaveCount(3);

  // Right-click the middle arrow's hit path (arrows arc, so its bbox centre
  // isn't on the line — dispatch straight to the element).
  await page.locator('.arrow-g[data-arrow-idx="1"] > path').first()
    .dispatchEvent('contextmenu', { button: 2, clientX: 490, clientY: 300 });
  await page.locator('.ctx-menu').getByText('Delete arrow', { exact: true }).click();
  await expect(page.locator('.arrow-g')).toHaveCount(2);
  await expect(page.locator('.arrow-g.is-selected')).toHaveCount(0);
});

test('Clear all drawings shows Undo, and the old selection does not grab the next stroke', async ({ page }) => {
  await blank(page);
  await page.keyboard.press('d');
  await drag(page, 380, 300, 480, 340);
  await drag(page, 380, 420, 480, 460);
  const strokes = page.locator('.strokes-layer path[data-stroke-line]');
  await expect(strokes).toHaveCount(2);
  // Select the first stroke with the select tool.
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.mouse.click(430, 320);
  await expect(page.locator('.strokes-layer rect')).toHaveCount(1);

  await page.mouse.click(800, 600, { button: 'right' });
  await page.locator('.ctx-menu').getByText('Clear all drawings', { exact: true }).click();
  await expect(strokes).toHaveCount(0);
  const toast = page.locator('.toast', { hasText: 'Drawings cleared' });
  await expect(toast).toBeVisible();

  // A fresh stroke is not born selected.
  await page.keyboard.press('d');
  await drag(page, 380, 300, 480, 340);
  await expect(strokes).toHaveCount(1);
  await page.keyboard.press('v');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-select/);
  await expect(page.locator('.strokes-layer rect')).toHaveCount(0);
});

test('the Clear all drawings toast puts every stroke back', async ({ page }) => {
  await blank(page);
  await page.keyboard.press('d');
  await drag(page, 380, 300, 480, 340);
  await drag(page, 380, 420, 480, 460);
  const strokes = page.locator('.strokes-layer path[data-stroke-line]');
  await expect(strokes).toHaveCount(2);
  await page.mouse.click(800, 600, { button: 'right' });
  await page.locator('.ctx-menu').getByText('Clear all drawings', { exact: true }).click();
  await expect(strokes).toHaveCount(0);
  await page.locator('.toast', { hasText: 'Drawings cleared' }).getByRole('button', { name: 'Undo' }).click();
  await expect(strokes).toHaveCount(2);
});

test('Escape mid-drag cancels a shape and a free arrow', async ({ page }) => {
  await blank(page);
  const cards = await page.locator('.card').count();
  await page.getByRole('button', { name: 'Add menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Shape', exact: true }).click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(470, 360, { steps: 6 });
  await page.mouse.move(520, 400, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.move(540, 420, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(page.locator('.card')).toHaveCount(cards);

  await page.keyboard.press('a');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-arrow/);
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(470, 300, { steps: 6 });
  await page.mouse.move(560, 300, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.move(600, 300, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(page.locator('.arrow-g')).toHaveCount(0);
});

async function addNote(page, text, x, y) {
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x, y } });
  // A placed note opens already focused for typing. Don't click into it: the
  // card is still in its pop-in animation, Playwright's hit check misses, and
  // its retry force-scrolls the overflow-hidden .canvas-wrap (by 500,315),
  // which shifts every page coordinate the test uses afterwards.
  await expect(page.locator('.note-body[contenteditable="true"]').last()).toBeFocused();
  await page.keyboard.type(text);
  await page.locator('.canvas-wrap').click({ position: { x: 60, y: 640 } });
  const card = page.locator('.card', { hasText: text }).first();
  await expect(card).toBeVisible();
  // The canvas maps pointer coordinates assuming the wrap is never scrolled.
  await expect.poll(() => page.evaluate(() => {
    const w = document.querySelector('.canvas-wrap');
    return w.scrollLeft + w.scrollTop;
  })).toBe(0);
  return card;
}

test('a resize the OS cancels mid-gesture reverts instead of following the next touch', async ({ page }) => {
  await blank(page);
  const card = await addNote(page, 'cancel-me', 420, 320);
  await card.click({ position: { x: 8, y: 8 } });
  const before = await card.boundingBox();
  const hb = await card.locator('.card-resize').boundingBox();
  const x = hb.x + hb.width / 2, y = hb.y + hb.height / 2;
  // A real pointer starts the resize (the handle takes pointer capture, which
  // needs a live pointer)…
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 60, { steps: 6 });
  await expect.poll(async () => (await card.boundingBox()).width).toBeGreaterThan(before.width + 40);
  // …then the OS cancels it, and a different pointer moves and lifts.
  await page.evaluate(({ x, y }) => {
    const ev = (t, cx, cy, extra) => new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true, isPrimary: true, button: 0,
      clientX: cx, clientY: cy, ...extra,
    });
    window.dispatchEvent(ev('pointercancel', x + 80, y + 60, { pointerId: 1, buttons: 0 }));
    window.dispatchEvent(ev('pointermove', x + 200, y + 160, { pointerId: 10, pointerType: 'touch', buttons: 1 }));
    window.dispatchEvent(ev('pointerup', x + 200, y + 160, { pointerId: 10, pointerType: 'touch', buttons: 0 }));
  }, { x, y });
  await page.waitForTimeout(300);
  const after = await card.boundingBox();
  expect(Math.abs(after.width - before.width)).toBeLessThan(2);
  expect(Math.abs(after.height - before.height)).toBeLessThan(2);
  await page.mouse.up();
});

test('slowly dragging an arrow end onto a card attaches it', async ({ page }) => {
  await blank(page);
  const card = await addNote(page, 'target', 620, 300);
  const cb = await card.boundingBox();
  const wb = await page.locator('.canvas-wrap').boundingBox();
  // A free arrow ending well left of the card, placed from where the card
  // actually is rather than from fixed page coordinates.
  const y = cb.y + cb.height / 2;
  const x0 = cb.x - 260, x1 = cb.x - 140;
  expect(x0).toBeGreaterThan(wb.x + 80);
  // The drag must start on bare canvas, with nothing selected, or the Arrow
  // tool takes it as "connect from this card" instead of a free arrow.
  await page.keyboard.press('Escape');
  await expect(page.locator('.card.is-selected')).toHaveCount(0);
  expect(await page.evaluate(([px, py]) => !document.elementFromPoint(px, py)?.closest('.card'), [x0, y])).toBe(true);
  await page.keyboard.press('a');
  await drag(page, x0, y, x1, y);
  await expect(page.locator('.arrow-g')).toHaveCount(1);
  await page.locator('.arrow-g > path').first()
    .dispatchEvent('pointerdown', { button: 0, pointerId: 1, clientX: (x0 + x1) / 2, clientY: y });
  await page.mouse.up();
  // Grab the `to` handle (second endpoint circle) and creep onto the card in
  // 2px steps, so every move lands on the handle's previous position.
  const handles = page.locator('.arrows-layer circle[r]').filter({ hasNot: page.locator('title') });
  await expect.poll(() => handles.count()).toBeGreaterThanOrEqual(2);
  const toPos = { x: x1, y };
  await page.mouse.move(toPos.x, toPos.y);
  await page.mouse.down();
  const targetX = cb.x + 30;
  for (let x = toPos.x; x <= targetX; x += 2) await page.mouse.move(x, toPos.y);
  await page.mouse.up();
  await page.waitForTimeout(300);
  // Attached: the arrow now ends at the card's edge, not at the cursor
  // 30px inside it.
  const end = await page.evaluate(() => {
    const p = document.querySelector('.arrow-g path[data-arrow-line]');
    const len = p.getTotalLength();
    const pt = p.getPointAtLength(len);
    const m = p.getScreenCTM();
    return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f };
  });
  expect(end.x).toBeLessThan(targetX - 10);
});

test('right-clicking a text field on the canvas keeps the browser menu', async ({ page }) => {
  await blank(page);
  // Stand-in for a comment draft or a vote label: a textarea floating in the
  // canvas wrap, outside any card.
  const prevented = await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap');
    const ta = document.createElement('textarea');
    ta.style.cssText = 'position:absolute;left:500px;top:300px;width:200px;height:60px;z-index:50';
    wrap.appendChild(ta);
    const r = ta.getBoundingClientRect();
    const ev = new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, clientX: r.left + 20, clientY: r.top + 20,
    });
    ta.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
});

test('a card menu on a short window starts on screen and scrolls instead of crushing its rows', async ({ page }) => {
  await blank(page);
  const card = await addNote(page, 'short-menu', 420, 200);
  await page.setViewportSize({ width: 1100, height: 420 });
  await page.waitForTimeout(300);
  const box = await card.boundingBox();
  await page.mouse.click(box.x + 20, box.y + 20, { button: 'right' });
  const menu = page.locator('.ctx-menu').first();
  await expect(menu).toBeVisible();
  const m = await menu.boundingBox();
  expect(m.y).toBeGreaterThanOrEqual(0);
  expect(m.y + m.height).toBeLessThanOrEqual(420 + 1);
  const rowH = await menu.locator('button.ctx-item').first().evaluate((el) => el.getBoundingClientRect().height);
  expect(rowH).toBeGreaterThanOrEqual(30);
});

test('a card-to-card connector set to No arrowheads keeps its editor', async ({ page }) => {
  await blank(page);
  const a = await addNote(page, 'from-here', 380, 260);
  const b = await addNote(page, 'to-there', 760, 260);
  await page.keyboard.press('a');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-arrow/);
  await a.click({ position: { x: 20, y: 20 } });
  await b.click({ position: { x: 20, y: 20 } });
  await expect(page.locator('.arrow-g')).toHaveCount(1);
  await page.keyboard.press('v');
  const hit = page.locator('.arrow-g > path').first();
  const box = await hit.boundingBox();
  await hit.dispatchEvent('pointerdown', {
    button: 0, pointerId: 1, isPrimary: true,
    clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
  });
  await page.mouse.up();
  // Its bar in either look (helpers/arrowBar.js).
  const pop = arrowBar(page);
  await expect(pop).toBeVisible();
  await pickArrowHead(page, 'No arrowheads');
  // Still editable: the popover stays, and the heads can come back.
  await expect(pop).toBeVisible();
  await pickArrowHead(page, 'Single arrowhead');
  await expect.poll(() => arrowHeadPicked(page, 'Single arrowhead')).toBe(true);
});

async function zoomIntoCentre(page, notches = 12) {
  await page.evaluate((n) => {
    const wrap = document.querySelector('.canvas-wrap');
    const r = wrap.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      wrap.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -240, ctrlKey: true, bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      }));
    }
  }, notches);
}

test('a card whose media is playing stays mounted when you zoom away from it', async ({ page }) => {
  // The dense 60-note share fixture: fit-all mounts everything, a deep zoom
  // into the centre culls the corners.
  await routeAnalytics(page, []);
  await routeShareBundle(page, { dense: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Note 0', { exact: true })).toBeVisible();

  // Stand-in for an audio card mid-playback: a media element inside the card
  // that has fired `play` (which doesn't bubble).
  await page.evaluate(() => {
    const card = document.querySelector('[data-card-id="card-grid-0"]');
    const a = document.createElement('audio');
    card.appendChild(a);
    a.dispatchEvent(new Event('play'));
  });
  await zoomIntoCentre(page);
  // The opposite corner, not playing, is culled once the zoom settles…
  await expect(page.locator('[data-card-id="card-grid-9"]')).toHaveCount(0, { timeout: 4000 });
  // …while the playing one is still there, its media element with it.
  await expect(page.locator('[data-card-id="card-grid-0"] audio')).toHaveCount(1);
});
