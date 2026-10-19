// W A S D movement (lib/wasdPan.js, the CanvasSurface movement listener) on
// the ?local=1 harness, which mounts the real CanvasSurface. The setting is
// read from the soleil.ui cache, which is where a signed-in session mirrors
// profiles.settings.ui.wasdPan, so these tests set it there before the page
// loads.
import { expect, test } from '@playwright/test';

async function boot(page, { wasd }) {
  await page.addInitScript((on) => {
    try {
      const ui = JSON.parse(localStorage.getItem('soleil.ui') || '{}') || {};
      if (on) ui.wasdPan = true; else delete ui.wasdPan;
      localStorage.setItem('soleil.ui', JSON.stringify(ui));
    } catch (_) { /* storage off */ }
  }, wasd);
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap .card');
  await page.waitForTimeout(600);
  const box = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

// The camera as the cards show it.
const camera = (page) => page.evaluate(() => {
  const m = new DOMMatrix(getComputedStyle(document.querySelector('.canvas')).transform);
  return { x: m.m41, y: m.m42, z: m.a };
});

async function hold(page, key, ms, { shift = false } = {}) {
  if (shift) await page.keyboard.down('Shift');
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  if (shift) await page.keyboard.up('Shift');
}

// Until two reads a beat apart agree: the glide has eased to a stop.
async function atRest(page) {
  let prev = await camera(page);
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(100);
    const cur = await camera(page);
    if (cur.x === prev.x && cur.y === prev.y) return cur;
    prev = cur;
  }
  throw new Error('the board never came to rest');
}

test('off by default: D picks Free-draw and the board stays where it is', async ({ page }) => {
  await boot(page, { wasd: false });
  const before = await camera(page);
  await hold(page, 'd', 300);
  await page.waitForTimeout(300);
  expect(await camera(page)).toEqual(before);
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-draw/);
});

test('on: each key moves the view its way, and A and D pick no tool', async ({ page }) => {
  await boot(page, { wasd: true });
  const wrap = page.locator('.canvas-wrap');
  const start = await camera(page);

  // D looks right: the cards slide left.
  await hold(page, 'd', 400);
  const right = await atRest(page);
  expect(right.x).toBeLessThan(start.x - 150);
  expect(Math.abs(right.y - start.y)).toBeLessThan(1);
  await expect(wrap).not.toHaveClass(/tool-draw/);

  await hold(page, 'a', 400);
  const left = await atRest(page);
  expect(left.x).toBeGreaterThan(right.x + 150);
  await expect(wrap).not.toHaveClass(/tool-arrow/);

  // W looks up the board: the cards slide down.
  await hold(page, 'w', 400);
  const up = await atRest(page);
  expect(up.y).toBeGreaterThan(left.y + 150);

  await hold(page, 's', 400);
  const down = await atRest(page);
  expect(down.y).toBeLessThan(up.y - 150);

  expect(down.z).toBe(start.z);
  await expect(wrap).toHaveClass(/tool-select/);
});

test('Shift goes faster', async ({ page }) => {
  await boot(page, { wasd: true });
  const a = await camera(page);
  await hold(page, 'd', 300);
  const b = await atRest(page);
  await hold(page, 'd', 300, { shift: true });
  const c = await atRest(page);
  const plain = a.x - b.x;
  const fast = b.x - c.x;
  expect(plain).toBeGreaterThan(50);
  expect(fast).toBeGreaterThan(plain * 1.6);
});

test('it comes to rest where it stopped, and the next pan carries on from there', async ({ page }) => {
  await boot(page, { wasd: true });
  await hold(page, 's', 400);
  const rest = await atRest(page);
  // Past the commit (140ms after rest): no snap back to where it started.
  await page.waitForTimeout(400);
  expect(await camera(page)).toEqual(rest);
  await page.mouse.wheel(0, 40);
  await page.waitForTimeout(250);
  const after = await camera(page);
  expect(after.x).toBeCloseTo(rest.x, 3);
  expect(after.y).toBeLessThan(rest.y);
  expect(after.y).toBeGreaterThan(rest.y - 200);
});

test('a key held with Ctrl or ⌘ never moves the board', async ({ page }) => {
  await boot(page, { wasd: true });
  const before = await camera(page);
  for (const mod of ['Control', 'Meta', 'Alt']) {
    await page.keyboard.down(mod);
    await page.keyboard.down('s');
    await page.waitForTimeout(250);
    await page.keyboard.up('s');
    await page.keyboard.up(mod);
  }
  await page.waitForTimeout(300);
  expect(await camera(page)).toEqual(before);
});

test('typing W A S D into a note types them, and the board stays put', async ({ page }) => {
  await boot(page, { wasd: true });
  const note = page.locator('.canvas-wrap .card .note').first();
  await note.dblclick();
  const editor = page.locator('.canvas-wrap .note.is-editing [contenteditable="true"]').first();
  await editor.waitFor();
  const before = await camera(page);
  await page.keyboard.press('End');
  await page.keyboard.type(' wasd');
  await page.waitForTimeout(400);
  expect(await camera(page)).toEqual(before);
  await expect(editor).toContainText('wasd');
});

test('an open dialog keeps the keys: the shortcuts list stops a held key', async ({ page }) => {
  await boot(page, { wasd: true });
  await page.keyboard.press('?');
  await expect(page.locator('.shortcuts-modal')).toBeVisible();
  await expect(page.locator('.shortcuts-modal')).toContainText('Move around, Shift for faster');
  const before = await camera(page);
  await hold(page, 'd', 300);
  await page.waitForTimeout(300);
  expect(await camera(page)).toEqual(before);
});
