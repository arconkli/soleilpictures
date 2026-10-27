// A zip in Quick look is a folder to walk through (ZipStage.jsx): its folders
// first with their counts, then its pictures drawn small, then its files,
// from the one folder it holds; a folder opens and the crumbs lead back, a
// picture opens large and Escape steps back from it, a file selects and
// downloads, a locked one says so, and Unpack into clusters hands the zip to
// the board when the board can unpack. Every read is a byte range: driven
// through the ?local=1 harness, with a real zip built in the page
// (lib/zipFixture.mjs) and served by ranges from a route on the dev server's
// own origin, under its own key (r2.js setPrefixResolver), on cards added
// through __soleilFileLive.
import { expect, test } from '@playwright/test';

async function board(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  const b64 = await page.evaluate(async () => {
    const picture = (color, type) => new Promise((done) => {
      const c = document.createElement('canvas');
      c.width = 300;
      c.height = 200;
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.fillRect(0, 0, 300, 200);
      c.toBlob(async (b) => done(new Uint8Array(await b.arrayBuffer())), type, 0.9);
    });
    const { storedZip } = await import('/src/lib/zipFixture.mjs');
    const zip = storedZip([
      { path: 'Location scouts/Dock/a.jpg', bytes: await picture('#3a6ea5', 'image/jpeg') },
      { path: 'Location scouts/b.png', bytes: await picture('#c0392b', 'image/png') },
      { path: 'Location scouts/notes.txt', bytes: 'Dock at 06:10' },
      { path: 'Location scouts/secret.txt', bytes: 'locked' },
    ], 'Location scouts.zip');
    const bytes = new Uint8Array(await zip.arrayBuffer());
    // secret.txt as a password-protected entry: bit 0 of its flags, in its
    // local header and in the directory.
    const view = new DataView(bytes.buffer);
    const name = new TextEncoder().encode('Location scouts/secret.txt');
    for (let p = 0; p + 46 < bytes.length; p += 1) {
      const sig = view.getUint32(p, true);
      const at = sig === 0x04034b50 ? p + 30 : sig === 0x02014b50 ? p + 46 : -1;
      if (at < 0 || !name.every((b, i) => bytes[at + i] === b)) continue;
      const flags = sig === 0x04034b50 ? p + 6 : p + 8;
      view.setUint16(flags, view.getUint16(flags, true) | 1, true);
    }
    let s = '';
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  });
  const zip = Buffer.from(b64, 'base64');
  const asked = [];
  await page.route('**/__qa-zip/**', (route) => {
    const body = route.request().url().endsWith('/broken.zip') ? Buffer.from('not a zip at all, only words') : zip;
    const range = route.request().headers().range || '';
    asked.push(range);
    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!m) return route.fulfill({ status: 200, body, contentType: 'application/zip' });
    return route.fulfill({
      status: 206, body: body.subarray(Number(m[1]), Number(m[2]) + 1), contentType: 'application/zip',
      headers: { 'content-range': `bytes ${m[1]}-${m[2]}/${body.length}` },
    });
  });
  await page.evaluate(async (size) => {
    const r2 = await import('/src/lib/r2.js');
    const url = (k) => `/__qa-zip/${k.split('/').pop()}`;
    r2.setPrefixResolver('qa-zip/', { cached: url, resolve: async (k) => url(k) });
    // No contact sheet yet: the cards are their glyphs, and never read the zip.
    const im = await import('/src/lib/imageMeta.js');
    for (const k of ['qa-zip/scouts.zip', 'qa-zip/broken.zip']) im.setMetaLocal(k, { previewKey: null, checked: true });
    const add = window.__soleilFileLive.addFile;
    add({ id: 'zip', fileSrc: 'r2:qa-zip/scouts.zip', fileName: 'Location scouts.zip', ext: 'zip', sizeBytes: size,
      x: 60, y: 60, w: 360, h: 220 });
    add({ id: 'broken', fileSrc: 'r2:qa-zip/broken.zip', fileName: 'broken.zip', ext: 'zip', sizeBytes: 28,
      x: 460, y: 60, w: 360, h: 220 });
  }, zip.length);
  return { asked, size: zip.length };
}

const open = async (page, id) => {
  await page.locator(`[data-card-id="${id}"] .filec-body`).dblclick();
  await expect(page.locator('.ql')).toBeVisible();
};

test('Quick look walks a zip as a folder: folders first with their counts, its pictures drawn small, every read a range', async ({ page }) => {
  const { asked } = await board(page);
  const before = asked.length;
  await open(page, 'zip');
  const sheet = page.locator('.ql .qzip');
  const tiles = sheet.locator('.qzip-t');
  await expect(sheet.locator('.qzip-crumb b')).toHaveText('Location scouts.zip');
  await expect(sheet.locator('.qzip-m')).toHaveText(/^4 files · \d/);
  await expect(tiles.locator('.qzip-nm')).toHaveText(['Dock', 'b.png', 'notes.txt', 'secret.txt']);
  await expect(tiles.nth(0).locator('.qzip-pic em')).toHaveText('1 item');
  await expect(tiles.nth(0).locator('.qzip-sz')).toHaveText('Folder');
  await expect(tiles.nth(1).locator('.qzip-pic img')).toBeVisible();
  expect(await tiles.nth(1).locator('.qzip-pic img').evaluate((img) => img.naturalWidth)).toBe(360);
  await expect(tiles.nth(2).locator('.qzip-sz')).toHaveText('13 B');
  // Nothing on this board unpacks, so nothing offers to.
  await expect(sheet.getByRole('button', { name: 'Unpack into clusters' })).toHaveCount(0);
  // A folder opens; the crumbs lead back.
  await tiles.nth(0).locator('.qzip-hit').dblclick();
  await expect(sheet.locator('.qzip-crumb button')).toHaveText('Location scouts.zip');
  await expect(sheet.locator('.qzip-crumb b')).toHaveText('Dock');
  await expect(tiles.locator('.qzip-nm')).toHaveText(['a.jpg']);
  await expect(tiles.nth(0).locator('.qzip-pic img')).toBeVisible();
  await sheet.locator('.qzip-crumb button').click();
  await expect(sheet.locator('.qzip-crumb b')).toHaveText('Location scouts.zip');
  await expect(tiles).toHaveCount(4);
  // Never the whole zip: each read asked for a range.
  const reads = asked.slice(before);
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every((r) => /^bytes=\d+-\d+$/.test(r))).toBe(true);
});

test('a file in a zip selects and downloads; a locked one says so and offers nothing', async ({ page }) => {
  await board(page);
  await open(page, 'zip');
  const sheet = page.locator('.ql .qzip');
  const notes = sheet.locator('.qzip-t').filter({ hasText: 'notes.txt' });
  await notes.locator('.qzip-hit').click();
  await expect(notes).toHaveClass(/is-sel/);
  const download = page.waitForEvent('download');
  await notes.getByRole('button', { name: 'Download notes.txt' }).click();
  expect((await download).suggestedFilename()).toBe('notes.txt');

  const secret = sheet.locator('.qzip-t').filter({ hasText: 'secret.txt' });
  await secret.locator('.qzip-hit').dblclick();
  await expect(sheet.locator('.qzip-note')).toHaveText('This file is locked with a password.');
  await expect(secret).toHaveClass(/is-sel/);
  await expect(secret.getByRole('button', { name: 'Download secret.txt' })).toHaveCount(0);
  await expect(sheet.locator('.qzip.is-picture')).toHaveCount(0);
});

test('a picture in a zip opens large; Escape steps back to its folder, then closes Quick look', async ({ page }) => {
  await board(page);
  await open(page, 'zip');
  const ql = page.locator('.ql');
  await ql.locator('.qzip-t').filter({ hasText: 'b.png' }).locator('.qzip-hit').dblclick();
  await expect(ql.locator('.qzip.is-picture .qzip-view img')).toBeVisible();
  await expect(ql.locator('.qzip-crumb b')).toHaveText('b.png');
  await expect(ql.getByRole('button', { name: 'Back' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(ql.locator('.qzip.is-picture')).toHaveCount(0);
  await expect(ql.locator('.qzip-t')).toHaveCount(4);
  await expect(ql.locator('.qzip-t').filter({ hasText: 'b.png' }).locator('.qzip-hit')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(ql).toHaveCount(0);
});

test('Unpack into clusters downloads the zip and hands it to the board, and Quick look closes', async ({ page }) => {
  const { size } = await board(page);
  await page.evaluate(async () => {
    const actions = await import('/src/lib/fileActions.js');
    window.__qaCalls = [];
    actions.setFileActions('root', { unpackZip: (file) => { window.__qaCalls.push(['unpackZip', file.name, file.size, file.type]); } });
  });
  await open(page, 'zip');
  await page.locator('.ql .qzip').getByRole('button', { name: 'Unpack into clusters' }).click();
  await expect(page.locator('.ql')).toHaveCount(0);
  expect(await page.evaluate(() => window.__qaCalls)).toEqual([['unpackZip', 'Location scouts.zip', size, 'application/zip']]);
});

test("a zip the browser can't read opens on its card", async ({ page }) => {
  await board(page);
  await open(page, 'broken');
  await expect(page.locator('.ql .ql-card')).toBeVisible();
  await expect(page.locator('.ql .qzip')).toHaveCount(0);
});
