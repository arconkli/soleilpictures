import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_XCU, pdfFilter, sofficeArgs, pageArgs, pagesOf, sheetFilter, sizeOfPage, sheetRegion, marginsOf, sheetDpi,
  regionArgs, frameArgs, trimOf, trimCrop, cropArgs,
} from '../src/doc.js';
import { sniffDoc, sniffLoader, SOURCE_LOADERS } from '../src/viewArgs.js';
import { DOC_MAX_PAGES, VIEW_EDGE } from '../../boards/src/lib/fileView.js';

const bytes = (...xs) => new Uint8Array(xs);
const ascii = (s) => new TextEncoder().encode(s);

test('a document is known by its container: ZIP, OLE2, RTF or WordPerfect, and nothing else LibreOffice reads', () => {
  assert.equal(sniffDoc(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0)), true, 'docx, xlsx, pptx, odt, key, pages, numbers, vsdx');
  assert.equal(sniffDoc(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0)), true, 'doc, xls, ppt, pub, vsd');
  assert.equal(sniffDoc(ascii('{\\rtf1\\ansi')), true, 'rtf');
  assert.equal(sniffDoc(bytes(0xff, 0x57, 0x50, 0x43, 0x10)), true, 'WordPerfect');
  for (const s of ['<html><body>', '<?xml version="1.0"?>', '<svg xmlns=', '%PDF-1.7', 'plain text', '{\\rt', 'PK\u0005\u0006']) {
    assert.equal(sniffDoc(ascii(s)), false, s);
  }
  assert.equal(sniffDoc(bytes(0xff, 0xd8, 0xff, 0xe0)), false, 'a JPEG');
  assert.equal(sniffDoc(bytes(0xd0, 0xcf, 0x11, 0xe0)), false, 'half an OLE2 header');
  assert.equal(sniffDoc(null), false);
});

test('a page pdftoppm drew is read as a PNG, which no stranger\'s file is ever read as', () => {
  assert.equal(sniffLoader(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13)), 'pngload');
  assert.ok(!SOURCE_LOADERS.includes('pngload'));
  assert.equal(sniffLoader(bytes(0x89, 0x50, 0x4e, 0x47)), null, 'half a PNG signature');
});

test('LibreOffice\'s profile runs no macro and follows no link out of a document', () => {
  const setting = (name) => new RegExp(`<prop oor:name="${name}" oor:op="fuse"><value>([^<]+)</value></prop>`).exec(PROFILE_XCU)?.[1];
  assert.equal(setting('MacroSecurityLevel'), '3');
  assert.equal(setting('DisableMacrosExecution'), 'true');
  assert.equal(setting('BlockUntrustedRefererLinks'), 'true');
  assert.equal((PROFILE_XCU.match(/oor:path="\/org\.openoffice\.Office\.Common\/Security\/Scripting"/g) || []).length, 3);
  assert.match(PROFILE_XCU, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<oor:items /);
});

test('the PDF holds the first DOC_MAX_PAGES pages, pictures at screen resolution', () => {
  const f = pdfFilter();
  assert.match(f, /^pdf:writer_pdf_Export:\{/);
  const opts = JSON.parse(f.slice('pdf:writer_pdf_Export:'.length));
  assert.deepEqual(opts.PageRange, { type: 'string', value: `1-${DOC_MAX_PAGES}` });
  assert.deepEqual(opts.ReduceImageResolution, { type: 'boolean', value: true });
  assert.deepEqual(opts.MaxImageResolution, { type: 'long', value: 150 });
  assert.equal(JSON.parse(pdfFilter(5).slice(22)).PageRange.value, '1-5');
});

test('soffice runs headless with its own profile, converts one file into one folder, and restores nothing', () => {
  const a = sofficeArgs('/tmp/v/work/source.docx', '/tmp/v/work/out', '/tmp/v/work/lo');
  for (const flag of ['--headless', '--invisible', '--nocrashreport', '--nodefault', '--nofirststartwizard',
    '--nolockcheck', '--nologo', '--norestore']) assert.ok(a.includes(flag), flag);
  assert.ok(a.includes('-env:UserInstallation=file:///tmp/v/work/lo'));
  assert.deepEqual(a.slice(a.indexOf('--convert-to'), a.indexOf('--convert-to') + 2), ['--convert-to', pdfFilter()]);
  assert.deepEqual(a.slice(-3), ['--outdir', '/tmp/v/work/out', '/tmp/v/work/source.docx']);
  assert.ok(!a.some((x) => /macro|--accept|--pidfile|--infilter|-env:(?!UserInstallation)/i.test(x)), 'no listener, no macro, no other setting');
});

test('pdftoppm draws page one at the view\'s edge, and pdfinfo\'s page count is read strictly', () => {
  assert.deepEqual(pageArgs('/d/view.pdf', '/d/work/page'),
    ['-f', '1', '-l', '1', '-png', '-scale-to', String(VIEW_EDGE), '-singlefile', '/d/view.pdf', '/d/work/page']);
  assert.equal(pagesOf('Title:          x\nPages:          12\nEncrypted:      no\n'), 12);
  assert.equal(pagesOf(Buffer.from('Producer: LibreOffice 7.4\nPages: 1\n')), 1);
  for (const s of ['', 'Pages: none', 'Pages:', 'Title: Pages: 9', null]) assert.equal(pagesOf(s), 0, String(s));
});

test("a sheet's picture comes from Calc's whole-sheet export, each sheet one page as big as its cells", () => {
  const f = sheetFilter();
  assert.match(f, /^pdf:calc_pdf_Export:\{/);
  const opts = JSON.parse(f.slice('pdf:calc_pdf_Export:'.length));
  assert.deepEqual(opts.SinglePageSheets, { type: 'boolean', value: true });
  assert.deepEqual(opts.ReduceImageResolution, { type: 'boolean', value: true });
  assert.deepEqual(opts.MaxImageResolution, { type: 'long', value: 150 });
  const a = sofficeArgs('/tmp/v/work/source.xlsx', '/tmp/v/work/sheet', '/tmp/v/work/lo', f);
  assert.deepEqual(a.slice(a.indexOf('--convert-to'), a.indexOf('--convert-to') + 4), ['--convert-to', f, '--outdir', '/tmp/v/work/sheet']);
  assert.ok(!a.some((x) => /macro|--accept|--pidfile|--infilter/i.test(x)));
});

test("pdfinfo's first page size is read in both its forms, and nothing else", () => {
  assert.deepEqual(sizeOfPage('Pages:           1\nPage size:       571.691 x 195.024 pts\n'), { w: 571.691, h: 195.024 });
  assert.deepEqual(sizeOfPage(Buffer.from('Page    1 size: 18.3442 x 14285.7 pts\nPage    1 rot:  0\n')), { w: 18.3442, h: 14285.7 });
  assert.deepEqual(sizeOfPage('Page size:      612 x 792 pts (letter)\n'), { w: 612, h: 792 });
  for (const s of ['', 'Page size: big', 'Title: Page size: 1 x 1 pts', null]) assert.equal(sizeOfPage(s), null, String(s));
});

test('the card shows a whole sheet, its first rows when it is long, its first columns when it is very wide', () => {
  assert.deepEqual(sheetRegion(571.691, 195.024), { w: 571.691, h: 195.024 });
  assert.deepEqual(sheetRegion(266.428, 435.033), { w: 266.428, h: 435.033 });
  assert.deepEqual(sheetRegion(2889.04, 450.028), { w: 1400, h: 450.028 });
  assert.deepEqual(sheetRegion(600, 9000), { w: 600, h: 1080 });
});

test("a page's margin goes round the cells, deeper below, where the card's name strip sits", () => {
  assert.deepEqual(marginsOf(1794, 612), { m: 90, bottom: 237 });
  assert.deepEqual(marginsOf(648, 1050), { m: 53, bottom: 90 });
  assert.deepEqual(frameArgs('/w/r.png', '/w/sheet.png', { w: 1794, h: 612 }),
    ['embed', '/w/r.png', '/w/sheet.png', '90', '90', '1974', '939', '--extend', 'background', '--background', '255']);
});

test("a sheet's region is drawn about the view's size, never past 450 dpi", () => {
  assert.equal(sheetDpi({ w: 571.691, h: 195.024 }), 226);
  assert.equal(sheetDpi({ w: 266.428, h: 435.033 }), 297);
  assert.equal(sheetDpi({ w: 40, h: 12 }), 450);
  assert.equal(sheetDpi({ w: 1400, h: 14000 }), 36);
  assert.deepEqual(regionArgs('/w/s.pdf', '/w/r', { w: 1794, h: 612 }, 226),
    ['-f', '1', '-l', '1', '-png', '-r', '226', '-x', '0', '-y', '0', '-W', '1794', '-H', '612', '-singlefile', '/w/s.pdf', '/w/r']);
});

test("find_trim's answer is read strictly, and a printed page is cropped to its cells with a page's margin", () => {
  assert.deepEqual(trimOf('131\n177\n648\n1050\n'), { left: 131, top: 177, width: 648, height: 1050 });
  assert.deepEqual(trimOf(Buffer.from('0 0 10 10')), { left: 0, top: 0, width: 10, height: 10 });
  for (const s of ['0\n0\n0\n0\n', '1\n2\n3\n', '1\n2\n3\n4\n5', '1.5\n2\n3\n4', '-1\n2\n3\n4', 'x', '', null]) {
    assert.equal(trimOf(s), null, String(s));
  }
  const page = { w: 1449, h: 2048 };
  assert.deepEqual(trimCrop({ left: 131, top: 177, width: 648, height: 1050 }, page), { x: 78, y: 124, w: 754, h: 1193 });
  assert.deepEqual(trimCrop({ left: 131, top: 175, width: 540, height: 459 }, page), { x: 104, y: 148, w: 594, h: 557 });
  // Cells that fill the page: nothing to gain.
  assert.equal(trimCrop({ left: 40, top: 40, width: 1369, height: 1968 }, page), null);
  // Cells against the page's edge: the margin stops at the page.
  assert.deepEqual(trimCrop({ left: 0, top: 0, width: 300, height: 200 }, page), { x: 0, y: 0, w: 315, h: 240 });
});

test("the crop is drawn again at the view's size, at most four times the page", () => {
  const page = { w: 1449, h: 2048 };
  assert.deepEqual(cropArgs('/d/view.pdf', '/w/cells', { x: 78, y: 124, w: 754, h: 1193 }, page),
    ['-f', '1', '-l', '1', '-png', '-scale-to', '3516', '-x', '134', '-y', '213', '-W', '1294', '-H', '2048', '-singlefile',
      '/d/view.pdf', '/w/cells']);
  const tiny = cropArgs('/d/view.pdf', '/w/cells', { x: 10, y: 10, w: 100, h: 50 }, page);
  assert.equal(tiny[tiny.indexOf('-scale-to') + 1], String(2048 * 4));
  assert.equal(tiny[tiny.indexOf('-W') + 1], '400');
});
