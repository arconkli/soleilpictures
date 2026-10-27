import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  viewKindOfKey, viewKeys, isViewKey, isViewPdfKey, drawsNowhere, viewKeyOfCard, turnsIntoPicture, VIEW_EDGE,
  VIEW_SM_EDGE, RAW_EXTS, PSD_EXTS, DOC_EXTS, DOC_MAX_BYTES, VIEW_MAX_BYTES, DOC_MAX_PAGES, docFamily, docDropSize,
  DOC_DROP_PAGE, DOC_DROP_SLIDE, extOfKey, fileFamily, fileDropSize, TABLE_DROP, FONT_DROP, DRAWN_FAMILIES, isDrawnFamily,
  DESIGN_DROP, VIEW_KINDS, isCardViewKind, SHEET_DROP, LIST_DROP, ZIP_EXTS, LISTED_EXTS,
} from './fileView.js';
import { mediaKindOfKey, isCopyKey } from './playCopy.js';

const WS = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';

test('the formats some browser can\'t draw get views; the ones every browser draws do not', () => {
  for (const ext of ['heic', 'HEIF', 'hif', 'tif', 'tiff', 'jxl', 'exr', 'jp2', 'j2k', 'jpf', 'jpx',
    'arw', 'CR3', 'cr2', 'nef', 'raf', 'orf', 'rw2', 'dng', 'pef', 'srw', 'x3f', 'psd', 'psb']) {
    assert.equal(viewKindOfKey(`${WS}/a.${ext}`), 'image', ext);
  }
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg', 'mov', 'pdf', 'txt', 'csv', 'raw']) {
    assert.equal(viewKindOfKey(`${WS}/a.${ext}`), null, ext);
  }
  assert.equal(viewKindOfKey(`${WS}/noext`), null);
  assert.equal(viewKindOfKey(''), null);
  assert.equal(viewKindOfKey(null), null);
});

test('a view sits beside its original, keeps its extension, and is never an original itself', () => {
  const k = `${WS}/4f1c2d3e-0000-4000-8000-000000000001.heic`;
  assert.deepEqual(viewKeys(k), {
    view: `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.heic.view.webp`,
    sm: `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.heic.view_sm.webp`,
    pdf: `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.heic.view.pdf`,
  });
  assert.notEqual(viewKeys(`${WS}/a.heic`).view, viewKeys(`${WS}/a.tif`).view, 'same name, other format: other view');
  assert.ok(isViewKey(viewKeys(k).view) && isViewKey(viewKeys(k).sm));
  assert.equal(viewKindOfKey(viewKeys(k).view), null);
  assert.equal(viewKindOfKey(`${WS}/previews/x.tif`), null, 'nothing under previews/ is an original');
  assert.ok(!isViewKey(`${WS}/previews/4f1c2d3e-0000-4000-8000-000000000001.webp`), 'a browser-made preview is not a view');
  assert.ok(!isCopyKey(viewKeys(k).view) && mediaKindOfKey(viewKeys(k).view) === null, 'nor a playable copy');
});

test('every raw and Photoshop extension is a short lowercase one, and none is a format a browser draws', () => {
  for (const ext of [...RAW_EXTS, ...PSD_EXTS]) {
    assert.match(ext, /^[a-z0-9]{2,4}$/, ext);
    assert.equal(viewKindOfKey(`${WS}/a.${ext}`), 'image', ext);
  }
  assert.equal(new Set([...RAW_EXTS, ...PSD_EXTS]).size, RAW_EXTS.length + PSD_EXTS.length, 'no extension twice');
});

test('raws, Photoshop documents and OpenEXR are drawn by no browser; HEIC, TIFF and the rest by Safari', () => {
  for (const ext of ['arw', 'CR3', 'dng', 'psd', 'psb', 'exr']) assert.equal(drawsNowhere(`${WS}/a.${ext}`), true, ext);
  for (const ext of ['heic', 'tif', 'jxl', 'jp2', 'jpg', 'png', 'mov', 'pdf', 'txt']) assert.equal(drawsNowhere(`${WS}/a.${ext}`), false, ext);
  for (const ext of ['docx', 'PPTX', 'xls', 'key', 'pages', 'numbers', 'odt']) assert.equal(drawsNowhere(`${WS}/a.${ext}`), true, ext);
  assert.equal(drawsNowhere(viewKeys(`${WS}/a.arw`).view), false, 'a view is drawn everywhere');
  assert.equal(drawsNowhere(null), false);
});

test('the small view is smaller than the view', () => {
  assert.ok(VIEW_SM_EDGE < VIEW_EDGE);
});

test('the file a card shows that gets views: an image card\'s, a file card\'s that can turn into a picture, a file card\'s document', () => {
  const ws = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';
  assert.equal(viewKeyOfCard({ kind: 'image', src: `r2:${ws}/a.heic` }), `${ws}/a.heic`);
  assert.equal(viewKeyOfCard({ kind: 'file', fileSrc: `r2:${ws}/DSC1.ARW` }), `${ws}/DSC1.ARW`);
  assert.equal(viewKeyOfCard({ kind: 'file', fileSrc: `r2:${ws}/comp.psd` }), `${ws}/comp.psd`);
  for (const card of [
    { kind: 'image', src: `r2:${ws}/a.jpg` }, { kind: 'file', fileSrc: `r2:${ws}/firmware.bin` },
    { kind: 'image', src: `r2:${ws}/a.heic`, pending: true }, { kind: 'file', fileSrc: 'blob:x' },
    { kind: 'file', fileSrc: `r2:${ws}/DSC1.ARW`, locked: true },
    { kind: 'file', fileSrc: `r2:${ws}/DSC1.ARW`, versions: [{ fileSrc: `r2:${ws}/old.zip`, id: 'v1' }] },
    { kind: 'video', src: `r2:${ws}/a.heic` }, { kind: 'file', src: `r2:${ws}/DSC1.ARW` }, null,
  ]) assert.equal(viewKeyOfCard(card), '', JSON.stringify(card));
  // An image card with versions still shows its current file.
  assert.equal(viewKeyOfCard({ kind: 'image', src: `r2:${ws}/b.tif`, versions: [{ src: `r2:${ws}/a.tif`, id: 'v1' }] }), `${ws}/b.tif`);
  // A document's file card shows its first page whatever else it is: it never
  // turns into anything, so locked and versioned ones ask too.
  assert.equal(viewKeyOfCard({ kind: 'file', fileSrc: `r2:${ws}/Deck.PPTX` }), `${ws}/Deck.PPTX`);
  assert.equal(viewKeyOfCard({ kind: 'file', fileSrc: `r2:${ws}/brief.docx`, locked: true }), `${ws}/brief.docx`);
  assert.equal(viewKeyOfCard({ kind: 'file', fileSrc: `r2:${ws}/budget.xlsx`, versions: [{ fileSrc: `r2:${ws}/old.zip`, id: 'v1' }] }),
    `${ws}/budget.xlsx`);
  for (const card of [
    { kind: 'image', src: `r2:${ws}/brief.docx` }, { kind: 'file', fileSrc: `r2:${ws}/brief.docx`, pending: true },
    { kind: 'pdf', pdfSrc: `r2:${ws}/brief.docx` }, { kind: 'file', fileSrc: `r2:${ws}/previews/brief.docx.view.pdf` },
  ]) assert.equal(viewKeyOfCard(card), '', JSON.stringify(card));
});

test('only a file card holding a photo turns into a picture card; a document stays a file card', () => {
  const ws = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';
  assert.equal(turnsIntoPicture({ kind: 'file', fileSrc: `r2:${ws}/DSC1.ARW` }), true);
  assert.equal(turnsIntoPicture({ kind: 'file', fileSrc: `r2:${ws}/scan.tif` }), true);
  for (const card of [
    { kind: 'file', fileSrc: `r2:${ws}/brief.docx` }, { kind: 'file', fileSrc: `r2:${ws}/Deck.key` },
    { kind: 'file', fileSrc: `r2:${ws}/DSC1.ARW`, locked: true },
    { kind: 'file', fileSrc: `r2:${ws}/DSC1.ARW`, versions: [{ fileSrc: `r2:${ws}/old.zip`, id: 'v1' }] },
    { kind: 'file', fileSrc: `r2:${ws}/DSC1.ARW`, pending: true }, { kind: 'image', src: `r2:${ws}/a.heic` },
    { kind: 'file', fileSrc: 'blob:x' }, null,
  ]) assert.equal(turnsIntoPicture(card), false, JSON.stringify(card));
});

test('documents get a first page and a PDF beside it; the PDF is no picture and no original', () => {
  for (const ext of ['doc', 'DOCX', 'rtf', 'odt', 'pages', 'wpd', 'ppt', 'pptx', 'key', 'odp', 'xls', 'xlsx', 'xlsb',
    'ods', 'numbers', 'vsdx', 'pub', 'docm', 'potx']) {
    assert.equal(viewKindOfKey(`${WS}/a.${ext}`), 'doc', ext);
  }
  const k = `${WS}/4f1c2d3e-0000-4000-8000-000000000002.pptx`;
  const { view, sm, pdf } = viewKeys(k);
  assert.equal(pdf, `${WS}/previews/4f1c2d3e-0000-4000-8000-000000000002.pptx.view.pdf`);
  assert.ok(isViewKey(view) && isViewKey(sm) && !isViewKey(pdf), 'the first page is a view, the PDF is not a picture');
  assert.ok(isViewPdfKey(pdf) && !isViewPdfKey(view) && !isViewPdfKey(`${WS}/a.pdf`) && !isViewPdfKey(`${WS}/previews/x.pdf`));
  assert.ok(isViewPdfKey(`${WS}/previews/x.DOCX.VIEW.PDF`));
  for (const out of [view, sm, pdf]) {
    assert.equal(viewKindOfKey(out), null, out);
    assert.equal(mediaKindOfKey(out), null, out);
  }
});

test('every document extension is a short lowercase one, in no other queue, and none is a picture\'s', () => {
  for (const ext of DOC_EXTS) {
    assert.match(ext, /^[a-z0-9]{2,7}$/, ext);
    assert.equal(mediaKindOfKey(`${WS}/a.${ext}`), null, `.${ext} would go to the copy queue first`);
    assert.ok(!RAW_EXTS.includes(ext) && !PSD_EXTS.includes(ext), ext);
  }
  assert.equal(new Set(DOC_EXTS).size, DOC_EXTS.length, 'no extension twice');
  for (const ext of ['pdf', 'txt', 'md', 'csv', 'json', 'html', 'zip']) assert.ok(!DOC_EXTS.includes(ext), ext);
});

test('the document ceilings are under the photo ones', () => {
  assert.ok(DOC_MAX_BYTES > 0 && DOC_MAX_BYTES <= VIEW_MAX_BYTES);
  assert.ok(Number.isInteger(DOC_MAX_PAGES) && DOC_MAX_PAGES >= 50);
});

test("a document's family decides its first size: a slide for a deck, a page for the rest", () => {
  for (const e of ['pptx', 'PPT', 'key', 'odp', 'ppsx', 'potx', 'sxi']) assert.equal(docFamily(e), 'slides', e);
  for (const e of ['xlsx', 'xls', 'xlsm', 'numbers', 'ods', 'sxc']) assert.equal(docFamily(e), 'sheet', e);
  for (const e of ['docx', 'doc', 'pages', 'odt', 'rtf', 'wpd', 'vsdx', 'pub']) assert.equal(docFamily(e), 'page', e);
  for (const e of ['pdf', 'zip', 'jpg', 'heic', '', null, undefined]) assert.equal(docFamily(e), null, String(e));
  for (const e of DOC_EXTS) assert.ok(docFamily(e), e);
  assert.deepEqual(docDropSize('pptx'), DOC_DROP_SLIDE);
  assert.deepEqual(DOC_DROP_SLIDE, { w: 400, h: 225 });
  assert.deepEqual(docDropSize('XLSX'), { w: 300, h: 388 });
  assert.deepEqual(docDropSize('docx'), DOC_DROP_PAGE);
  assert.equal(docDropSize('zip'), null);
  assert.equal(docDropSize(''), null);
});

test("a stored file's extension is read off its key or its r2: ref", () => {
  assert.equal(extOfKey(`r2:${WS}/abc/Deck v2.PPTX`), 'pptx');
  assert.equal(extOfKey(`${WS}/abc/Budget.xlsx`), 'xlsx');
  assert.equal(extOfKey(`${WS}/abc/noext`), '');
  assert.equal(extOfKey(null), '');
  assert.equal(extOfKey(undefined), '');
});

test("a file's family comes from its extension, then its type; a video's type is never text", () => {
  assert.equal(fileFamily('md'), 'markdown');
  assert.equal(fileFamily('MARKDOWN'), 'markdown');
  assert.equal(fileFamily('csv'), 'table');
  assert.equal(fileFamily('tsv'), 'table');
  assert.equal(fileFamily('srt'), 'subtitles');
  assert.equal(fileFamily('vtt'), 'subtitles');
  assert.equal(fileFamily('py'), 'code');
  assert.equal(fileFamily('json'), 'code');
  assert.equal(fileFamily('log'), 'text');
  assert.equal(fileFamily('txt'), 'text');
  assert.equal(fileFamily('docx'), 'doc');
  assert.equal(fileFamily('', 'application/json'), 'code');
  assert.equal(fileFamily('', 'text/plain'), 'text');
  assert.equal(fileFamily('ts', 'video/mp2t'), null);
  assert.equal(fileFamily('woff2'), 'font');
  assert.equal(fileFamily('TTC'), 'font');
  assert.equal(fileFamily('', 'font/ttf'), 'font');
  assert.equal(fileFamily('', 'application/font-woff'), 'font');
  assert.equal(fileFamily('eml'), 'mail');
  assert.equal(fileFamily('MSG'), 'mail');
  assert.equal(fileFamily('', 'message/rfc822'), 'mail');
  assert.equal(fileFamily('x', 'application/vnd.ms-outlook'), 'mail');
  assert.deepEqual(fileDropSize('eml'), DOC_DROP_PAGE);
  assert.equal(fileFamily('dmg'), null);
  assert.equal(fileFamily(''), null);
  assert.ok(DRAWN_FAMILIES.every(isDrawnFamily));
  assert.equal(isDrawnFamily('doc'), false);
});

test('a text file drops as a page, a table as a wide page, a font as a specimen, a document as before, anything else as nothing', () => {
  assert.deepEqual(fileDropSize('md'), DOC_DROP_PAGE);
  assert.deepEqual(fileDropSize('log'), DOC_DROP_PAGE);
  assert.deepEqual(fileDropSize('', 'text/plain'), DOC_DROP_PAGE);
  assert.deepEqual(fileDropSize('csv'), TABLE_DROP);
  assert.deepEqual(TABLE_DROP, { w: 400, h: 236 });
  assert.deepEqual(fileDropSize('otf'), FONT_DROP);
  assert.deepEqual(FONT_DROP, { w: 320, h: 220 });
  assert.deepEqual(fileDropSize('pptx'), DOC_DROP_SLIDE);
  assert.deepEqual(fileDropSize('xlsx'), DOC_DROP_PAGE);
  assert.equal(fileDropSize('dmg'), null);
  assert.equal(fileDropSize('bin', 'application/octet-stream'), null);
});

test('design files are their own view kind, drawn by no browser, and stay file cards with a picture', () => {
  for (const ext of ['sketch', 'fig', 'xd', 'procreate', 'procreat', 'kra', 'ora', 'afdesign', 'afphoto', 'afpub', 'indd', 'ai', 'eps']) {
    assert.equal(viewKindOfKey(`u/w/file.${ext}`), 'design', ext);
    assert.equal(drawsNowhere(`u/w/file.${ext}`), true, ext);
    assert.equal(fileFamily(ext, 'image/x-eps'), 'design', ext);
    assert.deepEqual(fileDropSize(ext), DESIGN_DROP, ext);
  }
  assert.deepEqual(DESIGN_DROP, { w: 320, h: 240 });
  assert.deepEqual(VIEW_KINDS, ['image', 'doc', 'design', 'archive']);
  assert.equal(isCardViewKind('design'), true);
  assert.equal(isCardViewKind('image'), false);
  const card = { kind: 'file', fileSrc: 'r2:u/w/Title card v3.sketch' };
  assert.equal(viewKeyOfCard(card), 'u/w/Title card v3.sketch');
  assert.equal(turnsIntoPicture(card), false);
});

test('archives are a view kind of their own, drawn by no browser, and stay file cards with a picture of what they hold', () => {
  assert.deepEqual(ZIP_EXTS, ['zip']);
  for (const ext of [...ZIP_EXTS, ...LISTED_EXTS, 'ZIP', '7Z']) {
    assert.equal(viewKindOfKey(`u/w/pack.${ext}`), 'archive', ext);
    assert.equal(drawsNowhere(`u/w/pack.${ext}`), true, ext);
  }
  assert.equal(viewKindOfKey('u/w/Stems and notes.tar.gz'), 'archive');
  // A disk image isn't one: nothing on the converter reads it.
  for (const ext of ['dmg', 'iso', 'cpio']) assert.equal(viewKindOfKey(`u/w/disk.${ext}`), null, ext);
  assert.equal(isCardViewKind('archive'), true);
  const card = { kind: 'file', fileSrc: 'r2:u/w/Location scouts.zip' };
  assert.equal(viewKeyOfCard(card), 'u/w/Location scouts.zip');
  assert.equal(turnsIntoPicture(card), false);
});

test('a zip is a family of its own and lands at its contact sheet\'s shape; every other archive at its list of names\'', () => {
  assert.equal(fileFamily('zip', 'application/zip'), 'zip');
  for (const [ext, type] of [['7z', 'application/x-7z-compressed'], ['rar', 'application/vnd.rar'], ['gz', 'application/gzip'],
    ['tar', 'application/x-tar'], ['tgz', ''], ['txz', '']]) {
    assert.equal(fileFamily(ext, type), 'listed', ext);
    assert.deepEqual(fileDropSize(ext, type), LIST_DROP, ext);
  }
  assert.equal(isDrawnFamily('zip'), false);
  assert.equal(isDrawnFamily('listed'), false);
  assert.deepEqual(fileDropSize('zip'), SHEET_DROP);
  assert.deepEqual(SHEET_DROP, { w: 360, h: 220 });
  assert.deepEqual(LIST_DROP, { w: 240, h: 165 });
  // The shapes the converter draws them at (media/src/sheet.js), so the card
  // never changes shape when its picture comes.
  assert.equal(SHEET_DROP.w / SHEET_DROP.h, 1440 / 880);
  assert.equal(LIST_DROP.w / LIST_DROP.h, 960 / 660);
});
