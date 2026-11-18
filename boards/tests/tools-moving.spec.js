// Moving around the canvas and moving cards, on the ?local=1 harness (the
// seeded Studio, so it has real cluster cards to drop onto):
//   - the wheel tip: a few reversals show "Zoom with the wheel"; one click
//     switches the wheel to zoom and its Undo switches it back
//   - the zoom buttons say so at either limit and do nothing there
//   - the zoom readout: a click goes to 100% after ~220 ms, a double-click
//     fits the view without a passing 100%
//   - Space held, then the window loses focus (no keyup): not left in pan mode
//   - a plain click on one of three selected cards keeps only it selected
//   - a selected note's rotate handle is drawn above it where a mouse can
//     press it; a real drag turns the card by the dragged angle, Shift in 15° steps
//   - dragging a corner of a turned card keeps the opposite corner fixed and
//     the card does not jump on release
//   - a mouse drag whose card overlaps a cluster card while the pointer stays
//     outside it leaves the card on the canvas
//   - a drag of a cluster card together with a file over another cluster card:
//     no drop outline, the "go separately" label, a toast on release, all back
//   - on the real signed-in app: the top bar's cluster name opens its menu and
//     a second click closes it; after Rename the focus is off the name and a
//     held Space pans; Space pans after a mouse click left the focus on a
//     button, but a keyboard-focused button keeps its own Space
//
//   cd boards && PW_PORT=5291 npx playwright test tests/tools-moving.spec.js --project=desktop-chrome
import { expect, test } from '@playwright/test';
import { bootLocal, bootRealBoard, card, cardsOnCanvas } from './tools-helpers.js';
import { ROOT_ID, USER_ID, WS_ID } from './helpers/signedInStub.js';

test.describe.configure({ timeout: 60_000 });

const camera = (page) => page.evaluate(() => {
  const el = document.querySelector('.canvas-wrap > .canvas');
  const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(el).transform || '');
  const p = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
  return { zoom: p[0], x: p[4], y: p[5] };
});
const zoomBar = (page) => page.getByRole('group', { name: 'Zoom' });
const zoomOut = (page) => zoomBar(page).locator('button').first();
const zoomIn = (page) => zoomBar(page).locator('button').last();
const readout = (page) => zoomBar(page).locator('.cnv-zoom-val');
// The local harness's settings gear can sit over the bar's corner
// (zoom-look.spec.js), so these buttons are clicked by event.
const press = (loc) => loc.dispatchEvent('click');

// A card's drawn place on the board: the style the app writes.
const placeOf = (page, id) => card(page, id).evaluate((el) => {
  const m = /rotate\(([-\d.]+)deg\)/.exec(el.style.transform || '');
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height), rot: m ? Number(m[1]) : 0 };
});
// One of a card's own corners on screen, turned with the card: 'tl' or 'br'.
const cornerOf = (page, id, which) => page.evaluate(({ id, which }) => {
  const el = document.querySelector(`.canvas-wrap [data-card-id="${id}"]`);
  const x = parseFloat(el.style.left), y = parseFloat(el.style.top);
  const w = parseFloat(el.style.width), h = parseFloat(el.style.height);
  const rm = /rotate\(([-\d.]+)deg\)/.exec(el.style.transform || '');
  const r = ((rm ? Number(rm[1]) : 0) * Math.PI) / 180;
  const sx = which === 'tl' ? -w / 2 : w / 2, sy = which === 'tl' ? -h / 2 : h / 2;
  const wx = x + w / 2 + sx * Math.cos(r) - sy * Math.sin(r);
  const wy = y + h / 2 + sx * Math.sin(r) + sy * Math.cos(r);
  const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(document.querySelector('.canvas-wrap > .canvas')).transform || '');
  const p = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
  const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
  return { x: wrap.left + p[4] + wx * p[0], y: wrap.top + p[5] + wy * p[3] };
}, { id, which });
// The one selected card's rotate handle: under a mouse it is drawn in the
// selection layer, above the card, where the card's clip can't cut it away.
const rotateHandle = (page) => page.locator('.canvas-wrap .sel-handle > .card-rotate');
// Drag from a point around a centre by `deg` degrees, in small real steps.
const turnBy = async (page, from, c, deg, steps = 12) => {
  const reach = Math.hypot(from.x - c.x, from.y - c.y);
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const a = a0 + ((deg * Math.PI) / 180) * (i / steps);
    await page.mouse.move(c.x + reach * Math.cos(a), c.y + reach * Math.sin(a));
    await page.waitForTimeout(16);
  }
};
// The difference between two angles in degrees, in (-180, 180].
const angleDiff = (a, b) => { const d = (((a - b) % 360) + 540) % 360 - 180; return d === -180 ? 180 : d; };
const centreOf = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('the wheel tip offers the zoom wheel, and its Undo gives the pan back', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('soleil.wheelHintSeen'); localStorage.removeItem('soleil.ui'); } catch (_) {}
  });
  await bootLocal(page);
  await page.waitForTimeout(800);
  await page.mouse.move(720, 450);
  // Down, up, down, up inside a second and a half: someone fighting the canvas.
  for (const dy of [300, -300, 300, -300, 300]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(60);
  }
  const tip = page.locator('.toast', { hasText: 'Scrolling pans the canvas' });
  await expect(tip).toBeVisible();
  await page.waitForTimeout(500);   // the burst's own pan settles
  await tip.getByRole('button', { name: 'Zoom with the wheel' }).click();
  const done = page.locator('.toast', { hasText: 'The wheel zooms now' });
  await expect(done).toBeVisible();

  const a = await camera(page);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await camera(page)).zoom).not.toBeCloseTo(a.zoom, 3);
  const b = await camera(page);
  expect(b.zoom).toBeGreaterThan(a.zoom);

  await done.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(600);   // a fresh gesture, not the zoom one's tail
  const c = await camera(page);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => Math.abs((await camera(page)).y - c.y)).toBeGreaterThan(50);
  expect((await camera(page)).zoom).toBeCloseTo(c.zoom, 3);
});

test('− and + say so at the limits and change nothing there', async ({ page }) => {
  await bootLocal(page);
  await expect(zoomBar(page)).toBeVisible();
  const step = async (btn, until) => {
    for (let i = 0; i < 40; i++) {
      if ((await btn.getAttribute('aria-disabled')) === 'true') return;
      await press(btn);
      await page.waitForTimeout(220);
    }
    throw new Error(`never reached ${until}`);
  };
  await step(zoomOut(page), 'the minimum');
  await expect(zoomOut(page)).toHaveAttribute('aria-label', 'Zoomed out all the way');
  await expect(zoomIn(page)).not.toHaveAttribute('aria-disabled', 'true');
  const min = { cam: await camera(page), shown: await readout(page).textContent() };
  await press(zoomOut(page));
  await page.waitForTimeout(500);
  expect((await camera(page)).zoom).toBeCloseTo(min.cam.zoom, 4);
  expect(await readout(page).textContent()).toBe(min.shown);

  await step(zoomIn(page), 'the maximum');
  await expect(zoomIn(page)).toHaveAttribute('aria-label', 'Zoomed in all the way');
  await expect(zoomOut(page)).not.toHaveAttribute('aria-disabled', 'true');
  const max = { cam: await camera(page), shown: await readout(page).textContent() };
  expect(max.cam.zoom).toBeGreaterThan(min.cam.zoom);
  await press(zoomIn(page));
  await page.waitForTimeout(500);
  expect((await camera(page)).zoom).toBeCloseTo(max.cam.zoom, 4);
  expect(await readout(page).textContent()).toBe(max.shown);
});

test('the zoom readout: a double-click fits without passing 100%, a click goes to 100% after a beat', async ({ page }) => {
  await bootLocal(page);
  await expect(zoomBar(page)).toBeVisible();
  await page.waitForTimeout(1200);   // the opening fit settles
  // Out of the fitted view, below it: fit and 100% both lie above.
  await press(zoomOut(page));
  await page.waitForTimeout(300);
  await press(zoomOut(page));
  await page.waitForTimeout(600);
  const start = (await camera(page)).zoom;
  expect(start).toBeLessThan(0.9);

  // Sample the zoom every frame through the double-click's ease.
  await page.evaluate(() => {
    window.__zooms = [];
    const read = () => {
      const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(document.querySelector('.canvas-wrap > .canvas')).transform || '');
      window.__zooms.push(m ? Number(m[1].split(',')[0]) : 1);
      window.__zoomRaf = requestAnimationFrame(read);
    };
    read();
  });
  await readout(page).dblclick();
  await page.waitForTimeout(1500);
  const zooms = await page.evaluate(() => { cancelAnimationFrame(window.__zoomRaf); return window.__zooms; });
  const fitted = zooms[zooms.length - 1];
  expect(fitted).toBeGreaterThan(start);
  expect(Math.abs(fitted - 1)).toBeGreaterThan(0.03);
  expect(zooms.filter((z) => Math.abs(z - 1) < 0.02)).toEqual([]);

  // A single click: 100%, but not before the beat that waits for a second click.
  const t0 = Date.now();
  await readout(page).click();
  await expect.poll(async () => Math.abs((await camera(page)).zoom - 1), { timeout: 3000 }).toBeLessThan(0.01);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(180);
  await expect(readout(page)).toHaveText('100%');
});

test('Space held, then the window loses focus: the canvas is not left in pan mode', async ({ page }) => {
  await bootLocal(page);
  const wrap = page.locator('.canvas-wrap');
  await page.mouse.move(720, 450);
  await page.keyboard.down('Space');
  await expect(wrap).toHaveClass(/is-pan/);
  // The window loses focus with the key still down: no keyup arrives.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(wrap).not.toHaveClass(/is-pan/);
  await page.keyboard.up('Space');
  await expect(wrap).not.toHaveClass(/is-pan/);
});

test('a click on one of three selected cards keeps only that one, and Delete removes only it', async ({ page }) => {
  await bootLocal(page);
  const ids = ['home-note', 'home-link', 'home-pal'];
  await card(page, ids[0]).click({ position: { x: 6, y: 6 } });
  for (const id of ids.slice(1)) await card(page, id).click({ position: { x: 6, y: 6 }, modifiers: ['Shift'] });
  await expect(page.locator('.canvas-wrap .card.is-selected')).toHaveCount(3);

  await card(page, 'home-pal').click({ position: { x: 6, y: 6 } });   // no move
  await expect(page.locator('.canvas-wrap .card.is-selected')).toHaveCount(1);
  await expect(card(page, 'home-pal')).toHaveClass(/is-selected/);

  await page.keyboard.press('Delete');
  await expect(card(page, 'home-pal')).toHaveCount(0);
  await expect(card(page, 'home-note')).toBeVisible();
  await expect(card(page, 'home-link')).toBeVisible();
});

test('a turned card keeps its opposite corner while a corner is dragged, and does not jump on release', async ({ page }) => {
  await bootLocal(page);
  const id = 'home-image';
  await card(page, id).click({ position: { x: 20, y: 20 } });
  await expect(card(page, id)).toHaveClass(/is-selected/);

  // Turn it the way the app does: drag its rotate handle part of a turn about
  // the centre, with the real mouse.
  const rot = rotateHandle(page);
  await expect(rot).toBeVisible();
  const hb = await centreOf(rot);
  const c = await centreOf(card(page, id));
  const reach = Math.hypot(hb.x - c.x, hb.y - c.y);
  const a0 = Math.atan2(hb.y - c.y, hb.x - c.x);
  const a1 = a0 + (35 * Math.PI) / 180;
  await page.mouse.move(hb.x, hb.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    const a = a0 + (a1 - a0) * (i / 10);
    await page.mouse.move(c.x + reach * Math.cos(a), c.y + reach * Math.sin(a));
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await placeOf(page, id)).rot)).toBeGreaterThan(20);
  await page.waitForTimeout(300);

  const tl0 = await cornerOf(page, id, 'tl');
  const before = await placeOf(page, id);
  const handle = card(page, id).locator('.card-resize');
  await expect(handle).toBeVisible();
  const h = await centreOf(handle);
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(h.x + 8 * i, h.y + 6 * i);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  const midSize = await placeOf(page, id);
  expect(midSize.w).toBeGreaterThan(before.w);   // it is growing
  const tlMid = await cornerOf(page, id, 'tl');
  expect(Math.abs(tlMid.x - tl0.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(tlMid.y - tl0.y)).toBeLessThanOrEqual(2);
  const brMid = await cornerOf(page, id, 'br');

  await page.mouse.up();
  await page.waitForTimeout(400);
  const tl1 = await cornerOf(page, id, 'tl');
  const br1 = await cornerOf(page, id, 'br');
  expect(Math.abs(tl1.x - tl0.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(tl1.y - tl0.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(br1.x - brMid.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(br1.y - brMid.y)).toBeLessThanOrEqual(2);
  expect((await placeOf(page, id)).rot).toBe(before.rot);
});

test('a selected note shows its rotate handle above it, and a real mouse drag turns it (Shift: 15° steps)', async ({ page }) => {
  await bootLocal(page);
  const id = 'home-note';
  await card(page, id).click({ position: { x: 6, y: 6 } });
  await expect(card(page, id)).toHaveClass(/is-selected/);

  // Drawn once, outside the card, and it is what a mouse at its centre meets.
  const rot = rotateHandle(page);
  await expect(rot).toHaveCount(1);
  await expect(rot).toBeVisible();
  await expect(card(page, id).locator('.card-rotate')).toHaveCount(0);
  await expect(rot).toHaveAttribute('title', 'Drag to rotate (shift = 15° steps)');
  const hb = await centreOf(rot);
  const cb = await card(page, id).boundingBox();
  expect(hb.y).toBeLessThan(cb.y);                                   // above the card
  expect(Math.abs(hb.x - (cb.x + cb.width / 2))).toBeLessThanOrEqual(2);
  const box = await rot.boundingBox();
  expect(box.width).toBeLessThanOrEqual(16);                         // the desktop dot, not the finger puck
  expect(await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return !!el && el.matches('.sel-handle > .card-rotate');
  }, hb)).toBe(true);

  // A real drag of ~40° about the card's centre turns it by about that much.
  const before = (await placeOf(page, id)).rot;
  const c = await centreOf(card(page, id));
  await turnBy(page, hb, c, 40);
  await page.mouse.up();
  await expect.poll(async () => Math.abs(angleDiff((await placeOf(page, id)).rot, before + 40))).toBeLessThanOrEqual(5);
  await page.waitForTimeout(300);

  // With Shift held, the angle lands on a multiple of 15.
  const hb2 = await centreOf(rot);
  const c2 = await centreOf(card(page, id));
  await page.keyboard.down('Shift');
  await turnBy(page, hb2, c2, 23);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await placeOf(page, id)).rot).not.toBeCloseTo(before + 40, 0);
  const shifted = (await placeOf(page, id)).rot;
  expect(((shifted % 15) + 15) % 15).toBe(0);
});

test('a mouse drag whose card overlaps a cluster card, with the pointer outside it, stays on the canvas', async ({ page }) => {
  await bootLocal(page);
  const cluster = card(page, 'b-stills');
  const note = card(page, 'home-note');
  await expect(cluster).toBeVisible();
  const before = await placeOf(page, 'home-note');
  const count = await cardsOnCanvas(page).count();
  const nb = await note.boundingBox();
  const cb = await cluster.boundingBox();
  // Grab the note near its bottom edge and lift it until its top edge sits
  // inside the cluster card's bottom by ~a fifth of its height; the pointer,
  // a note-height below that edge, stays clear of the cluster.
  const grab = { x: nb.x + nb.width / 2, y: nb.y + nb.height - 10 };
  const lift = (nb.y - (cb.y + cb.height)) + nb.height * 0.22;
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(grab.x, grab.y - (lift * i) / 14);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  const over = await note.boundingBox();
  expect(over.y).toBeLessThan(cb.y + cb.height);                 // overlaps the cluster card
  expect(grab.y - lift).toBeGreaterThan(cb.y + cb.height);       // the pointer does not
  await page.mouse.up();
  await page.waitForTimeout(500);

  await expect(cardsOnCanvas(page)).toHaveCount(count);
  await expect(note).toBeVisible();
  await expect(cluster).toBeVisible();
  const after = await placeOf(page, 'home-note');
  expect(after.y).toBeLessThan(before.y - 10);                   // it moved, and stayed
});

// An empty board does not pan, so give the real app's empty Studio one note first.
async function oneNote(page) {
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x: 300, y: 160 } });
  await page.locator('.card .note-body[contenteditable="true"]').waitFor();
  await page.keyboard.type('hello');
  await page.locator('.canvas-wrap').click({ position: { x: 1000, y: 640 } });
  await expect(page.locator('.card .note-body[contenteditable="true"]')).toHaveCount(0);
  await page.waitForTimeout(600);
}

// A held Space and a real mouse drag over the canvas; the camera before and after.
async function spacePan(page) {
  const before = await camera(page);
  await page.mouse.move(700, 420);
  await page.keyboard.down('Space');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/is-pan/);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(700 + 12 * i, 420 + 6 * i);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.keyboard.up('Space');
  return { before, after: await camera(page) };
}

test.describe("the top bar's cluster name", () => {
  const crumb = (page) => page.locator('.crumbs .crumb.here');
  const menu = (page) => page.locator('.ctx-menu');

  test('a click opens its menu and a second click on the name closes it', async ({ page }) => {
    await bootRealBoard(page);
    await expect(menu(page)).toHaveCount(0);
    await crumb(page).click();
    await expect(menu(page)).toBeVisible();
    await crumb(page).click();
    await expect(menu(page)).toHaveCount(0);
  });

  test('after Rename and a click on the canvas the focus is off the name, and Space pans with no menu', async ({ page }) => {
    // The stub's boards table is static; let rename_board stick so the name reads back.
    let name = 'Studio';
    await bootRealBoard(page, {
      rpc: { rename_board: (body) => { name = body.p_name; return null; } },
      rest: {
        boards: (url, method) => (method === 'GET'
          ? [{ id: ROOT_ID, workspace_id: WS_ID, parent_board_id: null, deleted_at: null, name, kind: 'canvas', created_by: USER_ID, created_at: '2026-10-01T00:00:00Z' }]
          : []),
      },
    });
    await oneNote(page);
    await crumb(page).click();
    await expect(menu(page)).toBeVisible();
    await menu(page).getByRole('menuitem', { name: 'Rename' }).click();
    const field = page.locator('.crumbs input.crumb-edit');
    await expect(field).toBeFocused();
    await page.keyboard.type('Renamed studio');
    await page.locator('.canvas-wrap').click({ position: { x: 1000, y: 640 } });
    await expect(field).toHaveCount(0);
    await expect(crumb(page)).toHaveText('Renamed studio');
    expect(await page.evaluate(() => !!document.activeElement?.closest?.('.crumbs'))).toBe(false);

    const { before, after } = await spacePan(page);
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(40);
    await expect(menu(page)).toHaveCount(0);
  });
});

test.describe('Space with the focus on a button outside the canvas', () => {
  const themeBtn = (page) => page.getByRole('button', { name: 'Toggle theme', exact: true });

  test('after a mouse click on it, Space and a drag still pan, and the button does not fire again', async ({ page }) => {
    await bootRealBoard(page);
    await oneNote(page);
    await themeBtn(page).click();
    // The precondition: a button outside the canvas holds the focus, and it is not a keyboard focus.
    const held = await page.evaluate(() => {
      const a = document.activeElement;
      return { tag: a?.tagName, outside: !!a && !a.closest('.canvas-wrap'), visible: !!a?.matches(':focus-visible') };
    });
    expect(held).toEqual({ tag: 'BUTTON', outside: true, visible: false });
    // Its clicks are counted, not the theme: the stub hands the old theme back
    // straight after the toggle saves, so the theme flips back on its own.
    await page.evaluate(() => {
      window.__btnClicks = 0;
      document.activeElement.addEventListener('click', () => { window.__btnClicks += 1; });
    });

    const { before, after } = await spacePan(page);
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(40);
    expect(await page.evaluate(() => window.__btnClicks)).toBe(0);
  });

  test('a keyboard-focused button keeps its Space: it presses the button and does not pan', async ({ page }) => {
    await bootRealBoard(page);
    // Tab to a sidebar toggle (the right-hand chrome buttons are not in the Tab order at this width).
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Show files beside the clusters');
    }
    expect(found).toBe(true);
    expect(await page.evaluate(() => document.activeElement.matches(':focus-visible'))).toBe(true);
    const btn = await page.evaluateHandle(() => document.activeElement);
    const pressed = () => btn.evaluate((el) => el.getAttribute('aria-pressed'));
    const p0 = await pressed();
    const cam0 = await camera(page);
    await page.mouse.move(700, 420);
    await page.keyboard.down('Space');
    await expect(page.locator('.canvas-wrap')).not.toHaveClass(/is-pan/);
    await page.keyboard.up('Space');
    await expect.poll(pressed).not.toBe(p0);   // the button's own Space
    const cam1 = await camera(page);
    expect(cam1.x).toBeCloseTo(cam0.x, 1);
    expect(cam1.y).toBeCloseTo(cam0.y, 1);
  });
});

test('a cluster card and a file dragged together over another cluster card: refused with a label, no drop outline, and a toast on release', async ({ page }) => {
  await bootLocal(page);
  const file = card(page, 'home-image');
  const withIt = card(page, 'b-halcyon');
  const target = card(page, 'b-stills');
  await expect(target).toBeVisible();
  await file.click({ position: { x: 20, y: 20 } });
  await withIt.click({ position: { x: 20, y: 20 }, modifiers: ['Shift'] });
  await expect(page.locator('.canvas-wrap .card.is-selected')).toHaveCount(2);
  const fileBefore = await file.boundingBox();
  const withBefore = await withIt.boundingBox();
  const count = await cardsOnCanvas(page).count();

  const from = { x: fileBefore.x + fileBefore.width / 2, y: fileBefore.y + fileBefore.height / 2 };
  const tb = await target.boundingBox();
  const to = { x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 14, from.y + ((to.y - from.y) * i) / 14);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  await page.mouse.move(to.x + 2, to.y + 1);

  // Held over the target: refused, and the target does not light up as a drop.
  const label = page.locator('.board-drop-label.is-no');
  await expect(label).toBeVisible();
  await expect(label).toContainText('Clusters and files go separately');
  await expect(target).not.toHaveClass(/is-card-drop-target/);
  await expect(page.locator('.canvas-wrap .is-card-drop-target')).toHaveCount(0);
  const lb = await label.boundingBox();
  await page.screenshot({
    path: '/tmp/claude-501/mixed-drag-label.png',
    clip: {
      x: Math.max(0, lb.x - 300), y: Math.max(0, lb.y - 150),
      width: Math.min(900, 1440 - Math.max(0, lb.x - 300)), height: 300,
    },
  });

  await page.mouse.up();
  await expect(page.locator('.toast', { hasText: 'Clusters and files go separately' })).toBeVisible();
  await expect(label).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(cardsOnCanvas(page)).toHaveCount(count);
  const fileAfter = await file.boundingBox();
  const withAfter = await withIt.boundingBox();
  expect(Math.abs(fileAfter.x - fileBefore.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(fileAfter.y - fileBefore.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(withAfter.x - withBefore.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(withAfter.y - withBefore.y)).toBeLessThanOrEqual(2);
});
