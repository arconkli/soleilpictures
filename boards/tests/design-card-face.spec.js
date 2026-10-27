// A design file's card shows the picture the file keeps of itself (direction
// A, lib/fileView.js): the converter's view of it, whole, under the name
// strip, which wears the app's glyph; its glyph when the file has no picture;
// a new one lands at a design file's size, an EPS included, which stays a
// file card; and Quick look opens on the picture, to zoom as a photo's. Driven
// through the ?local=1 harness: the pictures are sample views
// (tests/fixtures/doc-pages), served under their own keys (r2.js
// setPrefixResolver), with the meta the editors' pass writes (imageMeta
// setMetaLocal), on cards added through __soleilFileLive.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const dataUrl = (name) => `data:image/webp;base64,${readFileSync(new URL(`./fixtures/doc-pages/${name}`, import.meta.url)).toString('base64')}`;
const PICTURES = {
  'qa-design/previews/title.sketch.view_sm.webp': dataUrl('pitch-deck.webp'),
  'qa-design/previews/boards.procreat.view_sm.webp': dataUrl('treatment.webp'),
};

async function board(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.evaluate(async (pictures) => {
    const r2 = await import('/src/lib/r2.js');
    r2.setPrefixResolver('qa-design/', { cached: (k) => pictures[k] || null, resolve: async (k) => pictures[k] || null });
    const im = await import('/src/lib/imageMeta.js');
    const meta = (name, w, h) => ({
      previewKey: `qa-design/previews/${name}.view_sm.webp`, previewW: w, previewH: h,
      previewSmKey: `qa-design/previews/${name}.view_sm.webp`, previewSmW: w, previewSmH: h, checked: true,
    });
    im.setMetaLocal('qa-design/title.sketch', meta('title.sketch', 640, 360));
    // A .procreate as the uploader stores it: eight letters of its extension.
    im.setMetaLocal('qa-design/boards.procreat', meta('boards.procreat', 495, 640));
    // A Figma file from before 2023 keeps no picture: its record says so.
    im.setMetaLocal('qa-design/old.fig', { previewKey: null, checked: true });

    const add = window.__soleilFileLive.addFile;
    add({ id: 'sketch', fileSrc: 'r2:qa-design/title.sketch', fileName: 'Title card v3.sketch', ext: 'sketch', sizeBytes: 27_748,
      x: 60, y: 60, w: 320, h: 180 });
    add({ id: 'procreate', fileSrc: 'r2:qa-design/boards.procreat', fileName: 'Boards p1.procreate', ext: 'procreat',
      sizeBytes: 31_473_971, x: 420, y: 60, w: 186, h: 240 });
    add({ id: 'fig', fileSrc: 'r2:qa-design/old.fig', fileName: 'Old cut.fig', ext: 'fig', sizeBytes: 3_008,
      x: 660, y: 60, w: 320, h: 240 });
  }, PICTURES);
  for (const id of ['sketch', 'procreate']) {
    await expect(page.locator(`[data-card-id="${id}"] .filec-page img.r2p-img.is-loaded`)).toBeVisible();
  }
}

const card = (page, id) => page.locator(`[data-card-id="${id}"]`);

test('a design file\'s card shows the picture it keeps, whole, under its name strip', async ({ page }) => {
  await board(page);
  for (const id of ['sketch', 'procreate']) {
    const c = card(page, id);
    await expect(c.locator('.filec-page.is-picture')).toHaveCount(1);
    expect(await c.locator('img.r2p-img').evaluate((img) => getComputedStyle(img).objectPosition)).toBe('50% 50%');
    await expect(c.locator('.filec-info-icon svg')).toBeVisible();
    await expect(c.locator('.filec-glyph')).toHaveCount(0, { timeout: 5_000 });
  }
  await expect(card(page, 'sketch').locator('.filec-info-name')).toHaveText('Title card v3.sketch');
  await expect(card(page, 'procreate').locator('.filec-info-name')).toHaveText('Boards p1.procreate');
});

test('a design file with no picture inside is its glyph', async ({ page }) => {
  await board(page);
  const fig = card(page, 'fig');
  await expect(fig.locator('.filec-page .filec-glyph svg')).toBeVisible();
  await expect(fig.locator('img')).toHaveCount(0);
  await expect(fig).not.toContainText('Preview not available');
  await expect(fig.locator('.filec-info-size')).toHaveText('2.9 KB');
});

test('a dropped design file lands at a design file\'s size, and an EPS stays a file card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  const sizes = {};
  for (const [name, type] of [['Title card.sketch', ''], ['Boards.procreate', ''], ['Logo lockup.eps', 'application/postscript']]) {
    await page.mouse.move(300 + Object.keys(sizes).length * 360, 420);
    const before = await page.locator('.filec').count();
    await page.evaluate(({ name, type }) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['PK\u0003\u0004 not really a design file'], name, { type }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, { name, type });
    await expect(page.locator('.filec')).toHaveCount(before + 1);
    sizes[name] = await page.evaluate((name) => {
      const el = [...document.querySelectorAll('[data-card-id]')].find((n) => n.querySelector('.filec-info-name')?.textContent === name);
      return el ? [el.offsetWidth, el.offsetHeight] : null;
    }, name);
  }
  expect(sizes['Title card.sketch']).toEqual([320, 240]);
  expect(sizes['Boards.procreate']).toEqual([320, 240]);
  expect(sizes['Logo lockup.eps']).toEqual([320, 240]);
});

test('Quick look opens a design file on its picture, to zoom, and one with no picture on its card', async ({ page }) => {
  await board(page);
  const ql = page.locator('.ql');
  await card(page, 'sketch').locator('.filec-body').dblclick();
  await expect(ql).toBeVisible();
  await expect(ql.locator('.lightbox-stage img.lightbox-img')).toBeVisible();
  await expect(ql.locator('.ql-meta')).toHaveText('Design file');
  await page.keyboard.press('Escape');
  await expect(ql).toHaveCount(0);

  await card(page, 'fig').locator('.filec-body').dblclick();
  await expect(ql).toBeVisible();
  await expect(ql.locator('.lightbox-stage')).toHaveCount(0);
  await expect(ql.locator('.ql-card')).toBeVisible();
});
