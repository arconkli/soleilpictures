// An archive's file card shows what is inside it (direction A,
// lib/fileView.js): a zip's contact sheet, or the names inside any other
// archive, from the top, at the shape it landed at, under its name strip,
// which wears the archive glyph and counts the files inside; its glyph when
// it can't be read; and a new one lands at its family's shape. Driven through
// the ?local=1 harness: the pictures are sample views (tests/fixtures/doc-pages)
// standing in for the converter's, served under their own keys (r2.js
// setPrefixResolver), with the meta the editors' pass writes (imageMeta
// setMetaLocal) and the count it writes on the card, on cards added through
// __soleilFileLive.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const dataUrl = (name) => `data:image/webp;base64,${readFileSync(new URL(`./fixtures/doc-pages/${name}`, import.meta.url)).toString('base64')}`;
const PICTURES = {
  'qa-archive/previews/scouts.zip.view_sm.webp': dataUrl('pitch-deck.webp'),
  'qa-archive/previews/renders.7z.view_sm.webp': dataUrl('shot-list.webp'),
};

async function board(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.evaluate(async (pictures) => {
    const r2 = await import('/src/lib/r2.js');
    r2.setPrefixResolver('qa-archive/', { cached: (k) => pictures[k] || null, resolve: async (k) => pictures[k] || null });
    const im = await import('/src/lib/imageMeta.js');
    const meta = (name, w, h) => ({
      previewKey: `qa-archive/previews/${name}.view_sm.webp`, previewW: w, previewH: h,
      previewSmKey: `qa-archive/previews/${name}.view_sm.webp`, previewSmW: w, previewSmH: h, checked: true,
    });
    im.setMetaLocal('qa-archive/scouts.zip', meta('scouts.zip', 640, 391));
    im.setMetaLocal('qa-archive/renders.7z', meta('renders.7z', 640, 440));
    im.setMetaLocal('qa-archive/call-times.csv.gz', meta('renders.7z', 640, 440));
    // The converter couldn't read this one: its record says so.
    im.setMetaLocal('qa-archive/broken.zip', { previewKey: null, checked: true });

    const add = window.__soleilFileLive.addFile;
    add({ id: 'zip', fileSrc: 'r2:qa-archive/scouts.zip', fileName: 'Location scouts.zip', ext: 'zip', sizeBytes: 195_035_136,
      itemCount: 24, x: 60, y: 60, w: 360, h: 220 });
    add({ id: '7z', fileSrc: 'r2:qa-archive/renders.7z', fileName: 'Old renders.7z', ext: '7z', sizeBytes: 2_254_857_830,
      itemCount: 118, x: 460, y: 60, w: 240, h: 165 });
    add({ id: 'gz', fileSrc: 'r2:qa-archive/call-times.csv.gz', fileName: 'call-times.csv.gz', ext: 'gz', sizeBytes: 70,
      itemCount: 1, x: 740, y: 60, w: 240, h: 165 });
    // Placed before archives showed anything: no count yet, a file card's size.
    add({ id: 'old', fileSrc: 'r2:qa-archive/scouts.zip', fileName: 'Scouts copy.zip', ext: 'zip', sizeBytes: 195_035_136,
      x: 60, y: 320, w: 240, h: 150 });
    add({ id: 'broken', fileSrc: 'r2:qa-archive/broken.zip', fileName: 'Broken.zip', ext: 'zip', sizeBytes: 3_008,
      x: 340, y: 320, w: 240, h: 150 });
  }, PICTURES);
  for (const id of ['zip', '7z', 'gz', 'old']) {
    await expect(page.locator(`[data-card-id="${id}"] .filec-page img.r2p-img.is-loaded`)).toBeVisible();
  }
}

const card = (page, id) => page.locator(`[data-card-id="${id}"]`);

test("an archive's card shows what is inside it, from the top, and counts its files", async ({ page }) => {
  await board(page);
  await expect(card(page, 'zip').locator('.filec-info-size')).toHaveText('24 files');
  await expect(card(page, '7z').locator('.filec-info-size')).toHaveText('118 files');
  await expect(card(page, 'gz').locator('.filec-info-size')).toHaveText('1 file');
  for (const id of ['zip', '7z', 'old']) {
    const c = card(page, id);
    await expect(c.locator('.filec-page.is-picture')).toHaveCount(0);
    expect(await c.locator('img.r2p-img').evaluate((img) => getComputedStyle(img).objectPosition)).toBe('50% 0%');
    await expect(c.locator('.filec-info-icon svg')).toBeVisible();
    await expect(c.locator('.filec-glyph')).toHaveCount(0, { timeout: 5_000 });
  }
  // A card that doesn't know its count yet gives its size, and keeps the size it was placed at.
  await expect(card(page, 'old').locator('.filec-info-size')).toHaveText('186 MB');
  expect(await card(page, 'old').evaluate((el) => [el.offsetWidth, el.offsetHeight])).toEqual([240, 150]);
  await expect(card(page, 'zip').locator('.filec-info-name')).toHaveText('Location scouts.zip');
});

test("an archive that can't be read is its glyph, with its size", async ({ page }) => {
  await board(page);
  const broken = card(page, 'broken');
  await expect(broken.locator('.filec-page .filec-glyph svg')).toBeVisible();
  await expect(broken.locator('img')).toHaveCount(0);
  await expect(broken).not.toContainText('Preview not available');
  await expect(broken.locator('.filec-info-size')).toHaveText('2.9 KB');
});

test("a dropped zip lands at its contact sheet's shape, any other archive at its list's", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  const sizes = {};
  for (const [name, type] of [['Location scouts.zip', 'application/zip'], ['Old renders.7z', 'application/x-7z-compressed'],
    ['Stems.tar.gz', 'application/gzip']]) {
    await page.mouse.move(300 + Object.keys(sizes).length * 400, 420);
    const before = await page.locator('.filec').count();
    await page.evaluate(({ name, type }) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['PK\u0003\u0004 not really an archive'], name, { type }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, { name, type });
    await expect(page.locator('.filec')).toHaveCount(before + 1);
    sizes[name] = await page.evaluate((name) => {
      const el = [...document.querySelectorAll('[data-card-id]')].find((n) => n.querySelector('.filec-info-name')?.textContent === name);
      return el ? [el.offsetWidth, el.offsetHeight] : null;
    }, name);
  }
  expect(sizes['Location scouts.zip']).toEqual([360, 220]);
  expect(sizes['Old renders.7z']).toEqual([240, 165]);
  expect(sizes['Stems.tar.gz']).toEqual([240, 165]);
});
