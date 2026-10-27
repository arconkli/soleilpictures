// Photoshop documents (.psd, and .psb, Photoshop's large-document format): the
// flattened picture Photoshop keeps beside the layers, read from the file
// ourselves. It sits in the file's last section, so reading it takes the
// header, the palette (indexed colour), two image resources and the picture's
// own rows; the layers, most of a document's bytes, are skipped unread. No
// decoder library: the box keeps no npm dependencies, and this runs in a node
// process of its own as the unprivileged user (psdMain.js), on a local copy.
//
// Out comes an 8-bit TIFF (RGB, grey or CMYK) carrying the document's colour
// profile, for vips to make the views from in sRGB, so a CMYK poster or a
// ProPhoto photograph keeps its colours. It is shrunk by whole steps while the
// rows are read (a box average), so a 20000-pixel poster never becomes a
// gigabyte of pixels on the way. When there is no usable flattened
// picture (an old compression, a mode we don't read, or a document saved
// without "Maximize Compatibility") the small JPEG Photoshop stores as the
// document's thumbnail stands in.
//
// The layout is Adobe's "Photoshop File Formats Specification": a 26-byte
// header, then four sections each led by its length (colour mode data, image
// resources, layers and masks, 8 bytes long in a .psb), then the picture.

// A document this makes no picture of, and why (the view record's reason).
export class PsdRefused extends Error {
  constructor(reason, message = reason) {
    super(message);
    this.reason = reason;
  }
}

const MODE = { bitmap: 0, gray: 1, indexed: 2, rgb: 3, cmyk: 4, multichannel: 7, duotone: 8, lab: 9 };
const MAX_SIDE = { 1: 30_000, 2: 300_000 };
const RES_THUMB = 1036;      // the JPEG thumbnail (1033, its Photoshop 4 form, is BGR: unread)
const RES_ICC = 1039;        // the document's colour profile
const RES_VERSION = 1057;    // "version info", which says whether the flattened picture is real
const RES_SIGS = new Set(['8BIM', 'MeSa', 'AgHg', 'PHUT', 'DCSR']);

const sig = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u64 = (b, i) => u32(b, i) * 2 ** 32 + u32(b, i + 4);

// `read(offset, length)` → Promise<Uint8Array> of up to `length` bytes.
async function exactly(read, offset, length) {
  const b = await read(offset, length);
  if (b.length < length) throw new PsdRefused('unsupported', 'truncated document');
  return b;
}

// Where everything is: the header's facts, the palette, the thumbnail's and
// the picture's places. Throws PsdRefused for anything that is not a
// Photoshop document this reads.
export async function readLayout(read, fileSize) {
  const h = await exactly(read, 0, 26);
  if (sig(h, 0) !== '8BPS') throw new PsdRefused('unsupported', 'not a Photoshop document');
  const version = u16(h, 4);
  if (version !== 1 && version !== 2) throw new PsdRefused('unsupported', `version ${version}`);
  const channels = u16(h, 12);
  const height = u32(h, 14);
  const width = u32(h, 18);
  const depth = u16(h, 22);
  const mode = u16(h, 24);
  if (channels < 1 || channels > 56 || ![1, 8, 16, 32].includes(depth)) {
    throw new PsdRefused('unsupported', `channels ${channels}, depth ${depth}`);
  }
  if (width < 1 || height < 1 || width > MAX_SIDE[version] || height > MAX_SIDE[version]) {
    throw new PsdRefused('unsupported', `size ${width}x${height}`);
  }

  let at = 26;
  const modeLen = u32(await exactly(read, at, 4), 0);
  let palette = null;
  if (mode === MODE.indexed && modeLen >= 768) palette = await exactly(read, at + 4, 768);
  at += 4 + modeLen;

  const resLen = u32(await exactly(read, at, 4), 0);
  const resources = parseResources(await exactly(read, at + 4, resLen), at + 4);
  at += 4 + resLen;

  const lenBytes = version === 2 ? 8 : 4;
  const layersHead = await exactly(read, at, lenBytes);
  at += lenBytes + (version === 2 ? u64(layersHead, 0) : u32(layersHead, 0));

  let image = null;
  if (at + 2 <= fileSize) {
    const compression = u16(await exactly(read, at, 2), 0);
    image = { offset: at + 2, compression, end: fileSize };
  }
  return { version, channels, width, height, depth, mode, palette, image, ...resources };
}

// The image resources this reads: where the thumbnail's JPEG and the colour
// profile are, and whether Photoshop says the flattened picture is real. `base` is where `b` starts in
// the file.
export function parseResources(b, base) {
  let thumbnail = null;
  let icc = null;
  let realMerged = null;
  for (let i = 0; i + 12 <= b.length;) {
    if (!RES_SIGS.has(sig(b, i))) break;
    const id = u16(b, i + 4);
    const nameLen = b[i + 6];
    let j = i + 7 + nameLen;
    if ((nameLen + 1) & 1) j += 1;     // the name, with its length byte, is padded to even
    if (j + 4 > b.length) break;
    const size = u32(b, j);
    const data = j + 4;
    if (data + size > b.length) break;
    if (id === RES_THUMB && size > 28 && u32(b, data) === 1) {
      thumbnail = { offset: base + data + 28, length: Math.min(u32(b, data + 20), size - 28) };
    } else if (id === RES_ICC && size > 128) {
      icc = { offset: base + data, length: size };
    } else if (id === RES_VERSION && size >= 5) {
      realMerged = b[data + 4] !== 0;
    }
    i = data + size + (size & 1);
  }
  return { thumbnail, icc, realMerged };
}

// PackBits, one row: exactly `out.length` bytes into `out`, from `src`. A row
// that runs short is left zero-filled; one that runs long is cut.
export function unpackBits(src, out) {
  let i = 0;
  let o = 0;
  out.fill(0);
  while (i < src.length && o < out.length) {
    const n = src[i++];
    if (n < 128) {
      const end = Math.min(i + n + 1, src.length);
      while (i < end && o < out.length) out[o++] = src[i++];
      i = end;
    } else if (n > 128) {
      const v = src[i++];
      for (let k = 257 - n; k > 0 && o < out.length; k--) out[o++] = v;
    }
  }
}

// A reader that serves one channel's bytes in order, a megabyte at a time:
// the picture is stored a whole channel after another, and its rows are read
// across every channel at once.
function sequential(read) {
  let start = 0;
  let buf = new Uint8Array(0);
  return async (offset, length) => {
    if (offset < start || offset + length > start + buf.length) {
      buf = await read(offset, Math.max(length, 1 << 20));
      start = offset;
      if (buf.length < length) throw new PsdRefused('unsupported', 'truncated picture');
    }
    return buf.subarray(offset - start, offset - start + length);
  };
}

const D50 = [0.9642, 1, 0.8249];
// D50 → D65 (Bradford), then XYZ → linear sRGB, as one matrix.
const LAB_TO_RGB = (() => {
  const brad = [[0.9555766, -0.0230393, 0.0631636], [-0.0282895, 1.0099416, 0.0210077], [0.0122982, -0.0204830, 1.3299098]];
  const srgb = [[3.2404542, -1.5371385, -0.4985314], [-0.9692660, 1.8760108, 0.0415560], [0.0556434, -0.2040259, 1.0572252]];
  return srgb.map((row) => [0, 1, 2].map((c) => row.reduce((s, v, k) => s + v * brad[k][c], 0)));
})();
// Linear light to sRGB's curve, 0-255.
const gamma = (v) => {
  const x = v <= 0 ? 0 : v >= 1 ? 1 : v;
  return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
};

// A Lab pixel as Photoshop stores it (L 0-255 for 0-100, a and b around 128)
// into sRGB at out[o..o+2].
export function labToRgb(v, out, o) {
  const fy = (v[0] * 100 / 255 + 16) / 116;
  const fx = fy + (v[1] - 128) / 500;
  const fz = fy - (v[2] - 128) / 200;
  const inv = (f) => (f > 6 / 29 ? f ** 3 : 3 * (6 / 29) ** 2 * (f - 4 / 29));
  const xyz = [inv(fx) * D50[0], inv(fy) * D50[1], inv(fz) * D50[2]];
  for (let c = 0; c < 3; c++) {
    const m = LAB_TO_RGB[c];
    out[o + c] = gamma(m[0] * xyz[0] + m[1] * xyz[1] + m[2] * xyz[2]);
  }
}

// What the picture is made of: how many of the document's channels it reads
// (`planes`), how many values a pixel carries while it is averaged (an
// indexed pixel is its palette colour already), and what comes out: `bands`
// in `photometric` ('rgb' | 'gray' | 'cmyk'). `icc` says whether the
// document's colour profile still describes the output: not once Lab or
// 32-bit floats have been turned into sRGB here.
function planOf(layout) {
  const { mode, channels, depth, palette } = layout;
  const need = (n) => {
    if (channels < n) throw new PsdRefused('unsupported', `${channels} channels`);
    return n;
  };
  const deep = depth === 32;
  if (mode === MODE.bitmap && depth === 1) return { planes: 1, values: 1, bands: 1, photometric: 'gray', icc: false };
  if (depth === 1) throw new PsdRefused('unsupported', `1-bit mode ${mode}`);
  if (mode === MODE.gray || mode === MODE.duotone) return { planes: 1, values: 1, bands: 1, photometric: 'gray', icc: !deep && mode === MODE.gray };
  if (mode === MODE.indexed && depth === 8 && palette) return { planes: 1, values: 3, bands: 3, photometric: 'rgb', icc: true };
  if (mode === MODE.rgb) return { planes: need(3), values: 3, bands: 3, photometric: 'rgb', icc: !deep };
  if (mode === MODE.cmyk && !deep) return { planes: need(4), values: 4, bands: 4, photometric: 'cmyk', icc: true };
  if (mode === MODE.lab && !deep) return { planes: need(3), values: 3, bands: 3, photometric: 'rgb', icc: false };
  throw new PsdRefused('unsupported', `mode ${mode} at ${depth} bits`);
}

// Sample x of plane c's decoded row, as 0-255.
function sampler(depth, rows) {
  if (depth === 8) return (c, x) => rows[c][x];
  if (depth === 16) return (c, x) => rows[c][2 * x];
  // Bitmap mode: a set bit is black.
  if (depth === 1) return (c, x) => ((rows[c][x >> 3] >> (7 - (x & 7))) & 1 ? 0 : 255);
  // 32-bit is linear light, as floats.
  const views = rows.map((r) => new DataView(r.buffer, r.byteOffset, r.byteLength));
  return (c, x) => gamma(views[c].getFloat32(4 * x, false));
}

// The flattened picture, 8 bits a sample, under 2 × `maxEdge` on its long
// side: { w, h } the document's size; { outW, outH, bands, photometric,
// pixels } the picture (interleaved, CMYK as ink, 255 full); `icc` the
// document's colour profile when it describes them. Throws PsdRefused when
// the document has no picture this reads.
export async function composite(read, layout, { maxEdge, maxPixels }) {
  const { width: w, height: h, depth, mode, palette, image, version } = layout;
  if (w * h > maxPixels) throw new PsdRefused('too_large');
  if (!image) throw new PsdRefused('unsupported', 'no picture');
  if (image.compression !== 0 && image.compression !== 1) {
    throw new PsdRefused('unsupported', `compression ${image.compression}`);
  }
  if (layout.realMerged === false) throw new PsdRefused('unsupported', 'saved without a flattened picture');
  const plan = planOf(layout);
  const { planes, values, bands } = plan;
  const rowBytes = depth === 1 ? Math.ceil(w / 8) : w * (depth / 8);

  // Where each channel's rows are.
  const rowAt = [];   // per plane: (r) → [offset, length]
  if (image.compression === 0) {
    for (let c = 0; c < planes; c++) {
      const base = image.offset + c * h * rowBytes;
      rowAt.push((r) => [base + r * rowBytes, rowBytes]);
    }
    if (image.offset + planes * h * rowBytes > image.end) throw new PsdRefused('unsupported', 'truncated picture');
  } else {
    const cw = version === 2 ? 4 : 2;
    const all = layout.channels * h;
    const counts = await exactly(read, image.offset, all * cw);
    let at = image.offset + all * cw;
    for (let c = 0; c < planes; c++) {
      const starts = new Float64Array(h);
      const lens = new Uint32Array(h);
      for (let r = 0; r < h; r++) {
        const i = (c * h + r) * cw;
        lens[r] = cw === 4 ? u32(counts, i) : u16(counts, i);
        starts[r] = at;
        at += lens[r];
      }
      rowAt.push((r) => [starts[r], lens[r]]);
    }
    if (at > image.end) throw new PsdRefused('unsupported', 'truncated picture');
  }

  const k = Math.max(1, Math.floor(Math.max(w, h) / maxEdge));
  const outW = Math.ceil(w / k);
  const outH = Math.ceil(h / k);
  const pixels = new Uint8Array(outW * outH * bands);
  let outRow = 0;

  const readers = rowAt.map(() => sequential(read));
  const rows = rowAt.map(() => new Uint8Array(rowBytes));
  const sample = sampler(depth, rows);
  const indexed = mode === MODE.indexed;
  const sums = new Float64Array(outW * values);
  const counts = new Uint32Array(outW);
  const px = new Array(values).fill(0);
  const flush = () => {
    let o = outRow * outW * bands;
    for (let x = 0; x < outW; x++, o += bands) {
      const n = counts[x] || 1;
      for (let v = 0; v < values; v++) px[v] = sums[x * values + v] / n;
      if (mode === MODE.lab) labToRgb(px, pixels, o);
      // Photoshop stores CMYK inverted (255 is no ink); TIFF stores the ink.
      else if (mode === MODE.cmyk) for (let v = 0; v < 4; v++) pixels[o + v] = 255 - Math.round(px[v]);
      else for (let v = 0; v < bands; v++) pixels[o + v] = Math.round(px[v]);
    }
    outRow += 1;
    sums.fill(0);
    counts.fill(0);
  };

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < planes; c++) {
      const [offset, length] = rowAt[c](r);
      const bytes = await readers[c](offset, length);
      if (image.compression === 0) rows[c].set(bytes);
      else unpackBits(bytes, rows[c]);
    }
    for (let x = 0; x < w; x++) {
      const ox = Math.floor(x / k);
      const s = ox * values;
      if (indexed) {
        const i = rows[0][x];
        sums[s] += palette[i];
        sums[s + 1] += palette[256 + i];
        sums[s + 2] += palette[512 + i];
      } else {
        for (let c = 0; c < values; c++) sums[s + c] += sample(c, x);
      }
      counts[ox] += 1;
    }
    if ((r + 1) % k === 0 || r === h - 1) flush();
  }
  const icc = plan.icc && layout.icc ? await exactly(read, layout.icc.offset, layout.icc.length) : null;
  return { w, h, outW, outH, bands, photometric: plan.photometric, pixels, icc };
}

// The picture as a baseline TIFF vips reads with a decoder it trusts: one
// uncompressed strip, 8 bits a sample, and the colour profile, which vips
// uses to turn it into sRGB (a CMYK one without a profile gets vips' own).
export function encodeTiff({ outW: w, outH: h, bands, photometric, pixels, icc = null }) {
  const PHOTOMETRIC = { gray: 1, rgb: 2, cmyk: 5 };
  const entries = [
    [256, 4, 1, w], [257, 4, 1, h], [258, 3, bands, null], [259, 3, 1, 1],
    [262, 3, 1, PHOTOMETRIC[photometric]], [273, 4, 1, null], [277, 3, 1, bands],
    [278, 4, 1, h], [279, 4, 1, pixels.length], [284, 3, 1, 1],
  ];
  if (photometric === 'cmyk') entries.push([332, 3, 1, 1]);   // InkSet: CMYK
  if (icc) entries.push([34675, 7, icc.length, null]);
  const ifdSize = 2 + entries.length * 12 + 4;
  const bitsAt = 8 + ifdSize;
  const bitsSize = bands > 2 ? bands * 2 : 0;
  const iccAt = bitsAt + bitsSize;
  const iccSize = icc ? icc.length + (icc.length & 1) : 0;
  const dataAt = iccAt + iccSize;
  const out = Buffer.alloc(dataAt + pixels.length);
  out.write('II', 0, 'latin1');
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(8, 4);
  out.writeUInt16LE(entries.length, 8);
  entries.forEach(([tag, type, count, value], i) => {
    const e = 10 + i * 12;
    out.writeUInt16LE(tag, e);
    out.writeUInt16LE(type, e + 2);
    out.writeUInt32LE(count, e + 4);
    if (tag === 258) {
      if (bands > 2) out.writeUInt32LE(bitsAt, e + 8);
      else for (let b = 0; b < bands; b++) out.writeUInt16LE(8, e + 8 + 2 * b);
    } else if (tag === 273) out.writeUInt32LE(dataAt, e + 8);
    else if (tag === 34675) out.writeUInt32LE(iccAt, e + 8);
    else if (type === 3) out.writeUInt16LE(value, e + 8);
    else out.writeUInt32LE(value, e + 8);
  });
  out.writeUInt32LE(0, 8 + ifdSize - 4);
  for (let b = 0; b < bitsSize / 2; b++) out.writeUInt16LE(8, bitsAt + 2 * b);
  if (icc) out.set(icc, iccAt);
  out.set(pixels, dataAt);
  return out;
}
