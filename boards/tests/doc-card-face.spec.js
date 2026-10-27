// A document's file card shows its first page (direction A, lib/fileView.js):
// the converter's view of it, from its top (a sheet's cells from their top
// left), with its pages counted in the strip; its glyph when no page will
// come, never "Preview not available"; and a new one lands at its family's
// shape. Driven through the ?local=1 harness: the pages are the converter's
// views of three sample documents (tests/fixtures/doc-pages), served under
// their own keys (r2.js setPrefixResolver), with the meta the editors' pass
// writes (imageMeta setMetaLocal), on cards added through __soleilFileLive.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const dataUrl = (name) => `data:image/webp;base64,${readFileSync(new URL(`./fixtures/doc-pages/${name}`, import.meta.url)).toString('base64')}`;
const PAGES = {
  'qa-docs/previews/pitch.pptx.view_sm.webp': dataUrl('pitch-deck.webp'),
  'qa-docs/previews/treatment.docx.view_sm.webp': dataUrl('treatment.webp'),
  'qa-docs/previews/shots.xlsx.view_sm.webp': dataUrl('shot-list.webp'),
};

async function board(page, theme = 'dark') {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.evaluate(async ({ pages, theme }) => {
    document.documentElement.dataset.theme = theme;
    const r2 = await import('/src/lib/r2.js');
    r2.setPrefixResolver('qa-docs/', { cached: (k) => pages[k] || null, resolve: async (k) => pages[k] || null });
    const im = await import('/src/lib/imageMeta.js');
    const meta = (name, w, h) => ({
      previewKey: `qa-docs/previews/${name}.view_sm.webp`, previewW: w, previewH: h,
      previewSmKey: `qa-docs/previews/${name}.view_sm.webp`, previewSmW: w, previewSmH: h, checked: true,
    });
    im.setMetaLocal('qa-docs/pitch.pptx', meta('pitch.pptx', 640, 360));
    im.setMetaLocal('qa-docs/treatment.docx', meta('treatment.docx', 495, 640));
    im.setMetaLocal('qa-docs/old-treatment.docx', meta('treatment.docx', 495, 640));
    im.setMetaLocal('qa-docs/shots.xlsx', meta('shots.xlsx', 640, 304));
    // The converter couldn't read this one (a password): its record says so.
    im.setMetaLocal('qa-docs/locked.docx', { previewKey: null, checked: true });

    const add = window.__soleilFileLive.addFile;
    add({ id: 'deck', fileSrc: 'r2:qa-docs/pitch.pptx', fileName: 'Pitch deck.pptx', ext: 'pptx', sizeBytes: 2_645_446,
      pageCount: 12, x: 60, y: 60, w: 400, h: 225 });
    add({ id: 'treat', fileSrc: 'r2:qa-docs/treatment.docx', fileName: 'Treatment v3.docx', ext: 'docx', sizeBytes: 368_812,
      pageCount: 1, x: 500, y: 60, w: 300, h: 388 });
    add({ id: 'shots', fileSrc: 'r2:qa-docs/shots.xlsx', fileName: 'Shot list.xlsx', ext: 'xlsx', sizeBytes: 5_884,
      pageCount: 2, x: 840, y: 60, w: 400, h: 190 });
    add({ id: 'old', fileSrc: 'r2:qa-docs/old-treatment.docx', fileName: 'Old treatment.docx', ext: 'docx', sizeBytes: 368_812,
      pageCount: 1, x: 840, y: 300, w: 240, h: 150 });
    add({ id: 'locked', fileSrc: 'r2:qa-docs/locked.docx', fileName: 'Locked memo.docx', ext: 'docx', sizeBytes: 41_022,
      x: 60, y: 340, w: 240, h: 150 });
    add({ id: 'zip', fileSrc: 'r2:qa-docs/selects.zip', fileName: 'selects.zip', ext: 'zip', sizeBytes: 9_000_000,
      x: 340, y: 340, w: 240, h: 150 });
  }, { pages: PAGES, theme });
  // Every page has faded in.
  for (const id of ['deck', 'treat', 'shots', 'old']) {
    await expect(page.locator(`[data-card-id="${id}"] .filec-page img.r2p-img.is-loaded`)).toBeVisible();
  }
}

const card = (page, id) => page.locator(`[data-card-id="${id}"]`);

test('a document card shows its first page, from the top, and counts its pages', async ({ page }) => {
  await board(page);
  await expect(card(page, 'deck').locator('.filec-info-size')).toHaveText('12 slides');
  await expect(card(page, 'treat').locator('.filec-info-size')).toHaveText('1 page');
  await expect(card(page, 'shots').locator('.filec-info-size')).toHaveText('2 pages');
  const pos = (id) => card(page, id).locator('img.r2p-img').evaluate((img) => getComputedStyle(img).objectPosition);
  expect(await pos('treat')).toBe('50% 0%');
  // A card placed before pages showed keeps its size and shows the page's top.
  expect(await pos('old')).toBe('50% 0%');
  // A sheet's cells from their top left.
  expect(await pos('shots')).toBe('0% 0%');
  // The page fills the card under the strip, and nothing of the glyph stays.
  await expect(card(page, 'treat').locator('.filec-glyph')).toHaveCount(0, { timeout: 5_000 });
  await expect(card(page, 'deck').locator('.filec-info-icon svg')).toBeVisible();
});

test('a document with no page is its glyph, and any other file keeps its card', async ({ page }) => {
  await board(page);
  const locked = card(page, 'locked');
  await expect(locked.locator('.filec-page .filec-glyph svg')).toBeVisible();
  await expect(locked.locator('img')).toHaveCount(0);
  await expect(locked).not.toContainText('Preview not available');
  await expect(locked.locator('.filec-info-size')).toHaveText('40 KB');
  const zip = card(page, 'zip');
  await expect(zip.locator('.filec-page')).toHaveCount(0);
  await expect(zip.locator('.filec-glyph svg')).toBeVisible();
});

test('a dropped deck lands at a slide’s shape, a dropped document at a page’s, a zip at a file card’s', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  const sizes = {};
  for (const [name, type] of [['Pitch.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['Treatment.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['pack.zip', 'application/zip']]) {
    await page.mouse.move(400 + Object.keys(sizes).length * 300, 420);
    const before = await page.locator('.filec').count();
    await page.evaluate(({ name, type }) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['PK\u0003\u0004 not really a document'], name, { type }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, { name, type });
    await expect(page.locator('.filec')).toHaveCount(before + 1);
    sizes[name] = await page.evaluate((name) => {
      const el = [...document.querySelectorAll('[data-card-id]')].find((n) => n.querySelector('.filec-info-name')?.textContent === name);
      return el ? [el.offsetWidth, el.offsetHeight] : null;
    }, name);
  }
  expect(sizes['Pitch.pptx']).toEqual([400, 225]);
  expect(sizes['Treatment.docx']).toEqual([300, 388]);
  expect(sizes['pack.zip']).toEqual([240, 150]);
});

test('the light theme keeps the page white and the strip readable', async ({ page }) => {
  await board(page, 'light');
  const bg = await card(page, 'treat').locator('img.r2p-img').evaluate((img) => getComputedStyle(img).backgroundColor);
  expect(bg).toBe('rgb(255, 255, 255)');
  await expect(card(page, 'treat').locator('.filec-info')).toBeVisible();
});
