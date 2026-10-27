import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_XCU, pdfFilter, sofficeArgs, pageArgs, pagesOf } from '../src/doc.js';
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
