import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeFileName } from './safeFileName.js';

const bytes = (s) => new TextEncoder().encode(s).length;

const ROWS = [
  ['Report: Q1/Q2 *final*?', { ext: 'pdf' }, 'Report- Q1-Q2 -final-.pdf'],
  ['報告書　第1稿', { ext: 'pdf', fallback: 'document' }, '報告書　第1稿.pdf'],
  ['Café NFD', { ext: 'pdf' }, 'Café NFD.pdf'],
  ['CON', { ext: 'txt' }, 'CON_.txt'],
  ['con.tar', { ext: 'gz' }, 'con_.tar.gz'],
  ['Lpt1', {}, 'Lpt1_'],
  ['COM¹', { ext: 'png' }, 'COM¹_.png'],
  ['console', { ext: 'png' }, 'console.png'],
  ['  name. . ', { ext: 'png' }, 'name.png'],
  ['...hidden', { ext: 'png' }, 'hidden.png'],
  ['', { ext: 'png', fallback: 'board' }, 'board.png'],
  ['///', { ext: 'png', fallback: 'board' }, 'board.png'],
  ['!!!', { ext: 'webp', fallback: 'phone' }, 'phone.webp'],
  ['invoice' + '\u{202E}' + 'fdp.exe', {}, 'invoicefdp.exe'],
  ['Doc.PDF', { ext: 'pdf' }, 'Doc.PDF'],
  ['Take 2.1', { ext: 'wav' }, 'Take 2.1.wav'],
  ['a:b*c?d"e<f>g|h', { ext: 'wav' }, 'a-b-c-d-e-f-g-h.wav'],
  ['line1\nline2\ttab', { ext: 'txt' }, 'line1-line2-tab.txt'],
  ['שלום עולם', { ext: 'pdf' }, 'שלום עולם.pdf'],
  ['مرحبا', { ext: 'pdf' }, 'مرحبا.pdf'],
  ['Résumé', { ext: '.PDF' }, 'Résumé.pdf'],
  ['clip', { ext: 'we bm' }, 'clip'],
];

test('safeFileName: table', () => {
  for (const [input, opts, expect] of ROWS) {
    const got = safeFileName(input, opts);
    assert.equal(got, expect, JSON.stringify(input));
    assert.equal(safeFileName(got, opts), got, `idempotent: ${JSON.stringify(input)}`);
  }
});

test('safeFileName: NFC output', () => {
  assert.equal(safeFileName('Café NFD', { ext: 'pdf' }).length, 12);
});

test('safeFileName: long names keep the extension and stay whole', () => {
  const a = safeFileName('x'.repeat(500), { ext: 'wav' });
  assert.equal(a.length, 84);
  assert.ok(a.endsWith('.wav'));
  assert.equal(safeFileName(a, { ext: 'wav' }), a);

  const b = safeFileName('あ'.repeat(79) + '😀', { ext: 'wav' });
  assert.equal(bytes(b), 199);
  assert.equal(Array.from(b).length, 69);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(b));
  assert.equal(safeFileName(b, { ext: 'wav' }), b);

  const fam = '👨‍👩‍👧‍👦';
  const c = safeFileName(fam.repeat(30), { ext: 'png' });
  assert.ok(bytes(c) <= 200);
  assert.equal(c.slice(0, -4).split(fam).join(''), '');
  assert.equal(safeFileName(c, { ext: 'png' }), c);
});

test('safeFileName: lone surrogate is replaced', () => {
  const r = safeFileName('\uD83D' + 'x', {});
  assert.ok(r.includes('�'));
  assert.doesNotThrow(() => encodeURIComponent(r));
});

test('callers use safeFileName', () => {
  const files = [
    'attachmentDisposition.js', 'exportDelivery.js', 'exportBoard.js', 'imageFilename.js',
    'cardAssetName.js', 'uploads.js', 'captureRecorder.js', '../worker-api.js', '../worker-showcase.js',
    '../components/DocExportMenu.jsx', '../components/PdfViewer.jsx', '../hooks/useAudioPeaksBackfill.js',
  ];
  for (const f of files) {
    assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /safeFileName/, f);
  }
});

test('a cut that leaves only a reserved word is escaped', () => {
  const RES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  for (const out of [
    safeFileName('con a' + '\u0301'.repeat(120), { ext: 'pdf' }),
    safeFileName('con 12345', { ext: 'pdf', maxChars: 4 }),
  ]) {
    assert.ok(out.endsWith('.pdf'), out);
    assert.ok(!RES.test(out.slice(0, -4)), out);
  }
});
