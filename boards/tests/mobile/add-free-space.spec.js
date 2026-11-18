// Adding from the phone's + sheet. The sheet points at no spot, so a new card
// goes in the free space nearest the middle of the board that can be seen
// (lib/placement.js freeAddPos), not on top of what is there. A note or doc
// added while zoomed out is too small to read what is typed: the view zooms in
// to it (CanvasSurface revealAdded), to 80% of the visible board's width and
// 1.5x at most, and never back out. The Text tool's tap keeps the tap point
// and zooms in the same way.
//
// The mobile shell has no rail: the board is the wrap's whole width, and the
// Text tool is reached by its key (N, an iPad with a keyboard). The helpers
// still read a rail when there is one, so the numbers hold either way.
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'the phone shell: phones and touch tablets');
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  await page.waitForTimeout(600);
});

// The board as it is drawn: zoom, the wrap, the rail's right edge and its
// gutter (when there is a rail), and every card's box on screen.
const scene = (page) => page.evaluate(() => {
  const wrap = document.querySelector('.canvas-wrap');
  const r = wrap.getBoundingClientRect();
  const m = new DOMMatrixReadOnly(getComputedStyle(wrap.querySelector('.canvas')).transform);
  const rail = wrap.querySelector('.cnv-tools')?.getBoundingClientRect();
  const nav = document.querySelector('.mb-nav')?.getBoundingClientRect();
  const cards = [...wrap.querySelectorAll('.cards-layer .card[data-card-id]')].map((el) => {
    const b = el.getBoundingClientRect();
    return { id: el.getAttribute('data-card-id'), x: b.left, y: b.top, w: b.width, h: b.height };
  });
  return {
    zoom: m.a,
    left: rail ? rail.right : r.left, gutter: rail ? 8 : 0, right: r.right, top: r.top,
    bottom: nav && nav.top < r.bottom ? nav.top : r.bottom,
    cards,
  };
});
const overlap = (a, b) => a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
const newCard = (before, after) => {
  const had = new Set(before.cards.map((c) => c.id));
  const made = after.cards.filter((c) => !had.has(c.id));
  expect(made).toHaveLength(1);
  return made[0];
};
const clearOfOthers = (s, card) => {
  for (const c of s.cards) if (c.id !== card.id) expect(overlap(card, c), `on top of ${c.id}`).toBe(false);
};
const insideBoard = (s, card) => {
  expect(card.x).toBeGreaterThanOrEqual(s.left);
  expect(card.x + card.w).toBeLessThanOrEqual(s.right);
  expect(card.y).toBeGreaterThanOrEqual(s.top);
  expect(card.y + card.h).toBeLessThanOrEqual(s.bottom);
};
// The zoom a new card `w` wide is brought to: 80% of the visible board (right
// of the rail and its 8px gutter, where there is one), 1.5x at most.
const zoomFor = (s, w) => Math.min(0.8 * (s.right - s.left - s.gutter) / w, 1.5);
// Out of a note: writing mode hides the + until the typing is over.
async function stopTyping(page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveAttribute('data-text-editing');
  await expect(page.getByRole('button', { name: 'Add a card' })).toBeVisible();
}

async function addFromSheet(page, name) {
  await page.getByRole('button', { name: 'Add a card' }).tap();
  await expect(page.locator('.mobile-add-grid')).toBeVisible();
  await page.waitForTimeout(300);
  await page.locator('.mobile-add-tile', { hasText: name }).first().tap();
  await expect(page.locator('.mobile-add-grid')).toHaveCount(0);
  await page.waitForTimeout(900);
}

test('a Text note from the + sheet lands in free space, the view zooms in to it, and it takes the typing', async ({ page }) => {
  const before = await scene(page);
  expect(before.zoom).toBeLessThan(0.9);   // the seeded board opens zoomed out
  await addFromSheet(page, 'Text note');
  const after = await scene(page);
  const note = newCard(before, after);
  clearOfOthers(after, note);
  // Zoomed in: the note is 80% of the visible board's width (1.5x at most).
  const want = zoomFor(after, note.w / after.zoom);
  expect(after.zoom).toBeGreaterThan(before.zoom);
  expect(Math.abs(after.zoom - want)).toBeLessThan(0.02);
  // Centred in the visible board, its top a little under the board's top edge.
  const mid = (after.left + after.gutter + after.right) / 2;
  expect(Math.abs(note.x + note.w / 2 - mid)).toBeLessThan(3);
  expect(note.y).toBeGreaterThanOrEqual(after.top + 20);
  expect(note.y).toBeLessThan(after.top + 140);
  // The editor has the focus, and what is typed is the note's.
  await page.keyboard.type('Shot list');
  await expect(page.locator(`.card[data-card-id="${note.id}"] .note-body`)).toContainText('Shot list');
});

test('a card that takes no typing lands in free space and in view, and the zoom stays', async ({ page }) => {
  const before = await scene(page);
  await addFromSheet(page, 'Shape');
  const after = await scene(page);
  const shape = newCard(before, after);
  clearOfOthers(after, shape);
  insideBoard(after, shape);
  expect(after.zoom).toBeLessThanOrEqual(before.zoom + 0.001);
  // One undo takes the new card and nothing else.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.cards-layer .card[data-card-id]')).toHaveCount(before.cards.length);
  await expect(page.locator(`.card[data-card-id="${shape.id}"]`)).toHaveCount(0);
});

test('a Doc from the + sheet: the view zooms in to its card under the editor', async ({ page }) => {
  const before = await scene(page);
  await addFromSheet(page, 'Doc');
  const after = await scene(page);
  const doc = newCard(before, after);
  clearOfOthers(after, doc);
  expect(after.zoom).toBeGreaterThan(before.zoom);
  expect(Math.abs(after.zoom - zoomFor(after, doc.w / after.zoom))).toBeLessThan(0.02);
});

test('already zoomed in: a second note keeps the zoom and comes into view', async ({ page }) => {
  await addFromSheet(page, 'Text note');
  await page.keyboard.type('One');
  // Typing hides the +: out of the first note, and the zoom it took stays.
  const typing = await scene(page);
  await stopTyping(page);
  const first = await scene(page);
  expect(Math.abs(first.zoom - typing.zoom)).toBeLessThan(0.005);
  await addFromSheet(page, 'Text note');
  const second = await scene(page);
  const note = newCard(first, second);
  clearOfOthers(second, note);
  expect(Math.abs(second.zoom - first.zoom)).toBeLessThan(0.005);
  expect(note.x).toBeGreaterThanOrEqual(second.left);
  expect(note.x + note.w).toBeLessThanOrEqual(second.right);
  expect(note.y).toBeGreaterThanOrEqual(second.top);
  await page.keyboard.type('Two');
  await expect(page.locator(`.card[data-card-id="${note.id}"] .note-body`)).toContainText('Two');
});

test('the Text tool\'s tap keeps the tap point and zooms in to the note', async ({ page }) => {
  const before = await scene(page);
  // No rail on the mobile shell: the Text tool by its key.
  await expect(page.locator('.cnv-tools')).toHaveCount(0);
  await page.keyboard.press('n');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-text/);
  // An empty spot low on the board.
  const at = { x: Math.round(before.left + (before.right - before.left) * 0.6), y: Math.round(before.bottom - 110) };
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForTimeout(900);
  const after = await scene(page);
  const note = newCard(before, after);
  expect(after.zoom).toBeGreaterThan(before.zoom);
  expect(Math.abs(after.zoom - zoomFor(after, note.w / after.zoom))).toBeLessThan(0.02);
  // Where the finger put it on the board: its top edge's middle is the tap
  // point, carried by the same camera move.
  const z = after.zoom / before.zoom;
  const seeded = before.cards[0];
  const moved = after.cards.find((c) => c.id === seeded.id);
  const tapNow = { x: moved.x + (at.x - seeded.x) * z, y: moved.y + (at.y - seeded.y) * z };
  expect(Math.abs(note.x + note.w / 2 - tapNow.x)).toBeLessThan(4);
  expect(Math.abs(note.y - tapNow.y)).toBeLessThan(4);
  await page.keyboard.type('Here');
  await expect(page.locator(`.card[data-card-id="${note.id}"] .note-body`)).toContainText('Here');
});

// Samples the board's zoom once a frame, so a test can tell a jump from a glide.
const sampleZoom = (page, ms) => page.evaluate((span) => {
  window.__zoomSamples = [];
  const t0 = performance.now();
  const tick = () => {
    const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.canvas-wrap .canvas')).transform);
    window.__zoomSamples.push(m.a);
    if (performance.now() - t0 < span) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, ms);
const distinctZooms = async (page) => {
  const samples = await page.evaluate(() => window.__zoomSamples);
  return [...new Set(samples.map((z) => Math.round(z * 1000) / 1000))];
};
// addFromSheet for a Text note, with the sampler started right before the tap.
async function addNoteSampled(page) {
  await page.getByRole('button', { name: 'Add a card' }).tap();
  await expect(page.locator('.mobile-add-grid')).toBeVisible();
  await page.waitForTimeout(300);
  await sampleZoom(page, 1200);
  await page.locator('.mobile-add-tile', { hasText: 'Text note' }).first().tap();
  await page.waitForTimeout(1400);
}

// Someone who asks their phone for less motion sees the board jump to the new
// note, not glide: the only zooms drawn are the one before and the one after.
test('a person who prefers reduced motion sees the zoom jump to the note, with no frames between', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const before = await scene(page);
  await addNoteSampled(page);
  const after = await scene(page);
  const note = newCard(before, after);
  const zooms = await distinctZooms(page);
  expect(zooms, `zooms seen: ${zooms.join(', ')}`).toHaveLength(2);
  expect(Math.abs(zooms[zooms.length - 1] - zoomFor(after, note.w / after.zoom))).toBeLessThan(0.02);
});

// The same sampler with motion allowed: the zoom glides, so frames between the
// two zooms are drawn. This is what makes the jump test above mean something.
test('without that setting the same zoom glides: frames between the two zooms are drawn', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await addNoteSampled(page);
  const zooms = await distinctZooms(page);
  expect(zooms.length, `zooms seen: ${zooms.join(', ')}`).toBeGreaterThan(2);
});

// A 64x48 PNG made here, so the test carries no picture file.
function makePng(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3;
    rows[o] = 200; rows[o + 1] = 120 + x; rows[o + 2] = 60 + y;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Photos from the sheet's first tile land in free space too, not on the
// cards that are there, and in the part of the board that can be seen.
test('a photo picked from the + sheet lands in free space and in view', async ({ page }) => {
  const before = await scene(page);
  await page.getByRole('button', { name: 'Add a card' }).tap();
  await expect(page.locator('.mobile-add-grid')).toBeVisible();
  await page.waitForTimeout(300);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.mobile-add-tile', { hasText: 'Photos' }).first().tap(),
  ]);
  await chooser.setFiles({ name: 'frame.png', mimeType: 'image/png', buffer: makePng(64, 48) });
  await expect(page.locator('.cards-layer .card[data-card-id]')).toHaveCount(before.cards.length + 1, { timeout: 15000 });
  await page.waitForTimeout(900);
  const after = await scene(page);
  const photo = newCard(before, after);
  clearOfOthers(after, photo);
  insideBoard(after, photo);
});

// Opening a note that is already on the board is not adding one. Text that
// would read small (under 15px on screen) brings the view in once, as a new
// note does; after that, opening the same note again changes no zoom.
test('opening a note that is already on the board: small text glides in once, then the zoom stays', async ({ page }) => {
  const before = await scene(page);
  const target = await page.evaluate(({ left, right, top, bottom }) => {
    for (const el of document.querySelectorAll('.cards-layer .card[data-card-id]')) {
      if (!el.querySelector('.note')) continue;
      const b = el.getBoundingClientRect();
      if (b.left >= left && b.right <= right && b.top >= top && b.bottom <= bottom) {
        return { id: el.getAttribute('data-card-id') };
      }
    }
    return null;
  }, before);
  expect(target, 'a seeded note wholly inside the visible board').not.toBeNull();
  const body = page.locator(`.card[data-card-id="${target.id}"] .note-body`);
  const open = async () => {
    const b = await page.locator(`.card[data-card-id="${target.id}"]`).boundingBox();
    const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + Math.min(20, b.height / 2));
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(90);
    await page.touchscreen.tap(x, y);
    await expect(page.locator(`.card[data-card-id="${target.id}"] .note-body[contenteditable="true"]`)).toBeVisible();
    await page.waitForTimeout(700);
  };
  // The text's size on screen: its own font size times the board's zoom.
  const textPx = async () => (await body.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) * (await scene(page)).zoom;
  const small = (await textPx()) < 15;
  await open();
  const opened = await scene(page);
  if (small) {
    expect(opened.zoom).toBeGreaterThan(before.zoom);
    expect(await textPx()).toBeGreaterThanOrEqual(15);
  } else {
    expect(Math.abs(opened.zoom - before.zoom)).toBeLessThan(0.005);
  }
  // Out, and in again: readable now, so nothing moves.
  await stopTyping(page);
  const rest = await scene(page);
  expect(Math.abs(rest.zoom - opened.zoom)).toBeLessThan(0.005);
  await open();
  const again = await scene(page);
  expect(Math.abs(again.zoom - opened.zoom)).toBeLessThan(0.005);
});
