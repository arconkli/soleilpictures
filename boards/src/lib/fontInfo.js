// A font's names, read from its own `name` and `OS/2` tables so a card can
// say "Fraunces · Black" without the browser's help. Never throws: a file it
// can't read is named from its file name instead. WOFF2 is Brotli with
// transforms, so it always takes the file name.
const tag = (v, at) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

// A record pointing past the end of the buffer is skipped, never read.
const fits = (v, at, len) => Number.isInteger(at) && Number.isInteger(len) && at >= 0 && len >= 0 && at + len <= v.byteLength;

function sfntTables(v, at) {
  const out = new Map();
  if (!fits(v, at, 12)) return out;
  const n = v.getUint16(at + 4);
  for (let i = 0; i < n; i++) {
    const rec = at + 12 + 16 * i;
    if (!fits(v, rec, 16)) break;
    const offset = v.getUint32(rec + 8);
    const length = v.getUint32(rec + 12);
    if (fits(v, offset, length)) out.set(tag(v, rec), { offset, length });
  }
  return out;
}

function woffTables(v) {
  const out = new Map();
  if (!fits(v, 0, 44)) return out;
  const n = v.getUint16(12);
  for (let i = 0; i < n; i++) {
    const rec = 44 + 20 * i;
    if (!fits(v, rec, 20)) break;
    const offset = v.getUint32(rec + 4);
    const compLength = v.getUint32(rec + 8);
    const origLength = v.getUint32(rec + 12);
    if (fits(v, offset, compLength)) out.set(tag(v, rec), { offset, compLength, origLength });
  }
  return out;
}

async function inflate(slice) {
  const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The bytes of one table, inflated when a WOFF stored it compressed.
async function tableBytes(bytes, t) {
  if (t.compLength === undefined) return bytes.subarray(t.offset, t.offset + t.length);
  const slice = bytes.subarray(t.offset, t.offset + t.compLength);
  return t.compLength < t.origLength ? inflate(slice) : slice;
}

// Windows (UTF-16BE) in US English first, then any Windows, then Mac Roman.
function readNames(table) {
  const v = new DataView(table.buffer, table.byteOffset, table.byteLength);
  if (!fits(v, 0, 6)) return new Map();
  const count = v.getUint16(2);
  const strings = v.getUint16(4);
  const best = new Map();
  for (let i = 0; i < count; i++) {
    const rec = 6 + 12 * i;
    if (!fits(v, rec, 12)) break;
    const platform = v.getUint16(rec);
    const lang = v.getUint16(rec + 4);
    const id = v.getUint16(rec + 6);
    const length = v.getUint16(rec + 8);
    const at = strings + v.getUint16(rec + 10);
    if (!fits(v, at, length)) continue;
    const rank = platform === 3 ? (lang === 0x409 ? 3 : 2) : platform === 1 ? 1 : 0;
    if (!rank || rank <= (best.get(id)?.rank || 0)) continue;
    const raw = table.subarray(at, at + length);
    const text = platform === 3 ? new TextDecoder('utf-16be').decode(raw) : new TextDecoder('latin1').decode(raw);
    best.set(id, { rank, text: text.trim() });
  }
  return new Map([...best].map(([id, b]) => [id, b.text]));
}

function fromFileName(fileName) {
  const base = String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  const cut = Math.max(base.lastIndexOf('-'), base.lastIndexOf('_'));
  if (cut > 0 && cut < base.length - 1) return { family: base.slice(0, cut), style: base.slice(cut + 1) };
  return { family: base || 'Font', style: 'Regular' };
}

export function licenseLabel(text, url) {
  const t = String(text || '').trim();
  const u = String(url || '');
  if (/SIL Open Font License/i.test(t) || /scripts\.sil\.org\/OFL/i.test(u) || /scripts\.sil\.org\/OFL/i.test(t)) return 'SIL Open Font License 1.1';
  if (/Apache License/i.test(t) || /apache\.org\/licenses/i.test(u)) return 'Apache License 2.0';
  if (/Ubuntu Font Licen[cs]e/i.test(t) || /ubuntu\.com\/legal\/font-licence/i.test(u)) return 'Ubuntu Font Licence';
  if (/GNU General Public/i.test(t) || /gnu\.org\/licenses\/gpl/i.test(u)) return 'GPL';
  if (!t) return null;
  const sentence = t.match(/^.*?[.!?](?=\s|$)/s)?.[0] || t;
  return sentence.slice(0, 80);
}

export async function fontInfo(bytes, fileName) {
  const named = fromFileName(fileName);
  const fallback = (format) => ({ ...named, weight: null, format: format || 'TrueType', license: null });
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!fits(v, 0, 4)) return fallback();
    const sig = tag(v, 0);
    if (sig === 'wOF2') return fallback('WOFF2');
    let format;
    let tables;
    if (sig === 'wOFF') { format = 'WOFF'; tables = woffTables(v); }
    else if (sig === 'ttcf') {
      format = 'TrueType Collection';
      tables = fits(v, 12, 4) ? sfntTables(v, v.getUint32(12)) : new Map();
    } else if (sig === 'OTTO') { format = 'OpenType'; tables = sfntTables(v, 0); }
    else if (sig === 'true' || v.getUint32(0) === 0x00010000) { format = 'TrueType'; tables = sfntTables(v, 0); }
    else return fallback();
    const nameT = tables.get('name');
    if (!nameT) return fallback(format);
    const names = readNames(await tableBytes(bytes, nameT));
    const family = names.get(16) || names.get(1) || named.family;
    const style = names.get(17) || names.get(2) || named.style;
    let weight = null;
    const os2 = tables.get('OS/2');
    if (os2) {
      const t = await tableBytes(bytes, os2);
      if (t.length >= 6) weight = new DataView(t.buffer, t.byteOffset, t.byteLength).getUint16(4) || null;
    }
    return { family, style, weight, format, license: licenseLabel(names.get(13), names.get(14)) };
  } catch {
    return fallback();
  }
}
