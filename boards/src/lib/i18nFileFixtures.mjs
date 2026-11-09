// Fixtures for the file-handling tests of the non-Latin scripts. Built by hand,
// byte for byte, so a test needs no binary file checked in.

import { crc32 } from './zipStore.js';

// A one-page PDF whose text is Japanese, set in a Type0 font that is NOT
// embedded (KozMinPro-Regular, UniJIS-UCS2-H, Adobe-Japan1). Reading its text
// needs pdf.js's character maps: without cMapUrl the page reads as ''.
// The page says こんにちは世界 (<30533093306B3061306F4E16754C>).
export function japaneseCidPdf() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    null, // the content stream, below
    '<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPro-Regular /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /KozMinPro-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 4 >> /FontDescriptor 7 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /KozMinPro-Regular /Flags 6 /FontBBox [-195 -272 1110 1075] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 740 /StemV 80 >>',
  ];
  const content = 'BT /F1 24 Tf 72 700 Td <30533093306B3061306F4E16754C> Tj ET';
  objs[3] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

// SJIS for 報告書_ソフト表.txt: 0x5C, the backslash, is the second byte of ソ
// and 表, which is what made a CP437 reader split the name into folders.
export const SHIFT_JIS_NAME = [149, 241, 141, 144, 143, 145, 95, 131, 92, 131, 116, 131, 103, 149, 92, 46, 116, 120, 116];

const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };

// A stored zip (flags 0: no UTF-8 bit) of the Shift_JIS-named entry and an
// ASCII one, local headers, central directory and EOCD by hand.
export function shiftJisZip() {
  const specs = [
    { name: Buffer.from(SHIFT_JIS_NAME), data: Buffer.from('report') },
    { name: Buffer.from('readme.txt'), data: Buffer.from('hello') },
  ];
  const parts = [];
  const central = [];
  let off = 0;
  for (const s of specs) {
    const crc = crc32(s.data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x5a21),
      u32(crc), u32(s.data.length), u32(s.data.length), u16(s.name.length), u16(0), s.name,
    ]);
    parts.push(local, s.data);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x5a21),
      u32(crc), u32(s.data.length), u32(s.data.length), u16(s.name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(off), s.name,
    ]));
    off += local.length + s.data.length;
  }
  const cd = Buffer.concat(central);
  parts.push(cd, Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(specs.length), u16(specs.length), u32(cd.length), u32(off), u16(0),
  ]));
  return new Blob(parts);
}
