// What a video file is, read from its own container: resolution, length, frame
// rate, codec, audio, start timecode. An ISO-BMFF / QuickTime box reader —
// MP4, MOV, M4V — over a ByteSource, so the same code reads a File at upload
// (blob slices) and a stored file later (HTTP Range requests on its signed URL).
//
// It reads only the boxes it needs: the top-level headers (16 bytes each),
// then `moov` whole (it's the index, usually tens of KB — a file whose moov is
// at the END is handled by jumping over `mdat` by its declared size), then 4
// bytes of a timecode track's first sample. A 2 GB clip costs a few requests.
//
// Returns null for anything it can't read (Matroska/WebM, fragmented MP4 with
// no sample table, a truncated file). The player then measures the frame rate
// itself (requestVideoFrameCallback); Info just shows less.
//
//   { container, dur, w, h, rot, fps:[num,den], vfr, frames, codec, prof,
//     editOffset, tc:{ start, df, frame }, audio:{ codec, rate, ch } | null, bitrate }
//
// editOffset is the edit list's start in the video track (a B-frame codec's
// composition delay). Browsers apply edit lists themselves, so it is NOT where
// frame 0 sits in currentTime — the player measures that (t0) on its own.

import { snapFps, frameToTC } from './timecode.js';

const MAX_MOOV = 32 * 1024 * 1024;
const MAX_TOP_BOXES = 256;

// ── Byte sources ───────────────────────────────────────────────────────────
export function bytesSource(u8) {
  return { size: u8.byteLength, read: async (off, len) => u8.subarray(off, Math.min(u8.byteLength, off + len)) };
}

export function blobSource(blob) {
  return {
    size: blob.size,
    read: async (off, len) => new Uint8Array(await blob.slice(off, Math.min(blob.size, off + len)).arrayBuffer()),
  };
}

// A signed URL, read with Range requests. `no-store`: a cached plain response
// for the same URL makes a CORS fetch fail (see lib/corsImage.js). A server
// that ignores Range answers 200 with the whole file — read only what was
// asked for and cancel the rest.
export function urlSource(url, { fetchImpl = (typeof fetch === 'function' ? fetch : null), size = null } = {}) {
  return {
    size,
    async read(off, len) {
      if (!fetchImpl || len <= 0) return new Uint8Array(0);
      const res = await fetchImpl(url, { headers: { Range: `bytes=${off}-${off + len - 1}` }, cache: 'no-store' });
      if (!res.ok && res.status !== 206) throw new Error(`probe read ${res.status}`);
      if (res.status === 206) return new Uint8Array(await res.arrayBuffer());
      // 200: the whole file is coming. Take bytes off..off+len, then stop.
      const want = off + len;
      const reader = res.body?.getReader?.();
      if (!reader) {
        const all = new Uint8Array(await res.arrayBuffer());
        return all.subarray(off, want);
      }
      const chunks = [];
      let got = 0;
      while (got < want) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.byteLength;
      }
      try { await reader.cancel(); } catch (_) {}
      const all = new Uint8Array(Math.min(got, want));
      let p = 0;
      for (const c of chunks) {
        const take = Math.min(c.byteLength, all.byteLength - p);
        if (take <= 0) break;
        all.set(c.subarray(0, take), p);
        p += take;
      }
      return all.subarray(off);
    },
  };
}

// ── Box reading ────────────────────────────────────────────────────────────
const fourcc = (u8, at) => String.fromCharCode(u8[at], u8[at + 1], u8[at + 2], u8[at + 3]);
function u64(dv, at) {
  const hi = dv.getUint32(at);
  const lo = dv.getUint32(at + 4);
  return hi * 2 ** 32 + lo;
}

// Children of the box whose content runs [start, end) in `u8`.
function* children(u8, dv, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = fourcc(u8, p + 4);
    let hdr = 8;
    if (size === 1) {
      if (p + 16 > end) return;
      size = u64(dv, p + 8);
      hdr = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (type === 'uuid') hdr += 16;
    if (size < hdr || p + size > end) return;
    yield { type, start: p + hdr, end: p + size };
    p += size;
  }
}

function child(u8, dv, box, type) {
  for (const c of children(u8, dv, box.start, box.end)) if (c.type === type) return c;
  return null;
}

function path(u8, dv, box, ...types) {
  let b = box;
  for (const t of types) {
    b = b && child(u8, dv, b, t);
    if (!b) return null;
  }
  return b;
}

// ── Leaf parsers ───────────────────────────────────────────────────────────
function parseMvhd(dv, b) {
  const v = dv.getUint8(b.start);
  const ts = v === 1 ? dv.getUint32(b.start + 20) : dv.getUint32(b.start + 12);
  const dur = v === 1 ? u64(dv, b.start + 24) : dv.getUint32(b.start + 16);
  return ts ? { timescale: ts, duration: dur / ts } : null;
}

function parseTkhd(dv, b) {
  const v = dv.getUint8(b.start);
  // version+flags (4), then the times and ids (20 or 32 bytes), then 16
  // reserved/layer/group/volume bytes: the 3×3 matrix starts at 40 (or 52).
  const m = b.start + (v === 1 ? 52 : 40);
  const a = dv.getInt32(m) / 65536;
  const bb = dv.getInt32(m + 4) / 65536;
  const w = dv.getUint32(m + 36) / 65536;
  const h = dv.getUint32(m + 40) / 65536;
  let rot = Math.round((Math.atan2(bb, a) * 180) / Math.PI);
  rot = ((rot % 360) + 360) % 360;
  return { w: Math.round(w), h: Math.round(h), rot };
}

function parseMdhd(dv, b) {
  const v = dv.getUint8(b.start);
  const ts = v === 1 ? dv.getUint32(b.start + 20) : dv.getUint32(b.start + 12);
  const dur = v === 1 ? u64(dv, b.start + 24) : dv.getUint32(b.start + 16);
  return { timescale: ts, duration: dur };
}

function parseHdlr(u8, b) {
  return fourcc(u8, b.start + 8);
}

function parseStts(dv, b) {
  const n = dv.getUint32(b.start + 4);
  const entries = [];
  let p = b.start + 8;
  for (let i = 0; i < n && p + 8 <= b.end; i++, p += 8) entries.push([dv.getUint32(p), dv.getUint32(p + 4)]);
  return entries;
}

function parseElst(dv, b) {
  const v = dv.getUint8(b.start);
  const n = dv.getUint32(b.start + 4);
  let p = b.start + 8;
  for (let i = 0; i < n && p < b.end; i++) {
    const mediaTime = v === 1 ? Number(dv.getBigInt64(p + 8)) : dv.getInt32(p + 4);
    p += v === 1 ? 20 : 12;
    if (mediaTime >= 0) return mediaTime;    // the first non-empty edit
  }
  return 0;
}

function firstChunkOffset(u8, dv, stbl) {
  const stco = child(u8, dv, stbl, 'stco');
  if (stco && dv.getUint32(stco.start + 4) > 0) return dv.getUint32(stco.start + 8);
  const co64 = child(u8, dv, stbl, 'co64');
  if (co64 && dv.getUint32(co64.start + 4) > 0) return u64(dv, co64.start + 8);
  return null;
}

const AVC_PROFILES = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High', 110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4' };
const HEVC_PROFILES = { 1: 'Main', 2: 'Main 10', 3: 'Main Still', 4: 'Range extensions' };

// The sample description: codec fourcc, plus what each kind adds.
function parseStsd(u8, dv, stsd, handler) {
  const entry = [...children(u8, dv, stsd.start + 8, stsd.end)][0];
  if (!entry) return null;
  const out = { codec: entry.type };
  const s = entry.start;   // after size + type
  if (handler === 'vide') {
    // 78 bytes of VisualSampleEntry, then codec config boxes.
    for (const c of children(u8, dv, s + 78, entry.end)) {
      if (c.type === 'avcC' && c.end - c.start > 2) out.prof = AVC_PROFILES[u8[c.start + 1]] || null;
      if (c.type === 'hvcC' && c.end - c.start > 2) out.prof = HEVC_PROFILES[u8[c.start + 1] & 0x1f] || null;
    }
  } else if (handler === 'soun') {
    const version = dv.getUint16(s + 8);
    if (version === 2 && s + 44 <= entry.end) {
      out.rate = Math.round(dv.getFloat64(s + 32));
      out.ch = dv.getUint32(s + 40);
    } else {
      out.ch = dv.getUint16(s + 16);
      out.rate = dv.getUint32(s + 24) >>> 16;
    }
    // AAC in MP4 often says 0 Hz here and means "see esds": trust the track's timescale then.
  } else if (handler === 'tmcd') {
    // reserved(4) flags(4) timescale(4) frameDuration(4) numberOfFrames(1)
    const flags = dv.getUint32(s + 12);
    out.df = (flags & 1) === 1;
    out.tcScale = dv.getUint32(s + 16);
    out.tcDur = dv.getUint32(s + 20);
    out.tcFrames = u8[s + 24];
  }
  return out;
}

function parseTrak(u8, dv, trak) {
  const mdia = child(u8, dv, trak, 'mdia');
  const mdhd = mdia && child(u8, dv, mdia, 'mdhd');
  const hdlr = mdia && child(u8, dv, mdia, 'hdlr');
  const stbl = mdia && path(u8, dv, mdia, 'minf', 'stbl');
  if (!mdhd || !hdlr || !stbl) return null;
  const handler = parseHdlr(u8, hdlr);
  const md = parseMdhd(dv, mdhd);
  const stsd = child(u8, dv, stbl, 'stsd');
  const stts = child(u8, dv, stbl, 'stts');
  const tkhd = child(u8, dv, trak, 'tkhd');
  const elst = path(u8, dv, trak, 'edts', 'elst');
  return {
    handler, timescale: md.timescale, duration: md.duration,
    desc: stsd ? parseStsd(u8, dv, stsd, handler) : null,
    stts: stts ? parseStts(dv, stts) : [],
    tkhd: tkhd ? parseTkhd(dv, tkhd) : null,
    mediaTime: elst ? parseElst(dv, elst) : 0,
    chunk0: firstChunkOffset(u8, dv, stbl),
  };
}

// The frame rate from the sample durations. One dominant duration covering
// all but a stray frame or two (encoders often end on an odd one) is a
// constant rate; anything else is variable and reports the mean.
export function rateFromStts(stts, timescale) {
  if (!timescale || !stts.length) return null;
  let frames = 0, ticks = 0;
  const byDelta = new Map();
  for (const [count, delta] of stts) {
    frames += count;
    ticks += count * delta;
    byDelta.set(delta, (byDelta.get(delta) || 0) + count);
  }
  if (!frames || !ticks) return null;
  let dominant = 0, dominantCount = 0;
  for (const [d, c] of byDelta) if (c > dominantCount) { dominant = d; dominantCount = c; }
  const vfr = frames - dominantCount > Math.max(2, frames * 0.01);
  const fps = vfr ? snapFps((frames * timescale) / ticks) : snapFps(timescale, dominant);
  return { fps, frames, vfr };
}

// ── The probe ──────────────────────────────────────────────────────────────
async function findMoov(src) {
  const head = await src.read(0, 64 * 1024);
  if (head.byteLength < 8) return null;
  let brand = '';
  let off = 0;
  for (let i = 0; i < MAX_TOP_BOXES; i++) {
    let hdr;
    if (off + 16 <= head.byteLength) hdr = head.subarray(off, off + 16);
    else {
      if (src.size != null && off + 8 > src.size) return null;
      hdr = await src.read(off, 16);
    }
    if (hdr.byteLength < 8) return null;
    const dv = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
    let size = dv.getUint32(0);
    const type = fourcc(hdr, 4);
    if (!/^[\x20-\x7e]{4}$/.test(type)) return null;     // not a box: not ISO-BMFF
    if (size === 1) {
      if (hdr.byteLength < 16) return null;
      size = u64(dv, 8);
    } else if (size === 0) {
      size = src.size != null ? src.size - off : Infinity;
    }
    if (size < 8) return null;
    if (type === 'ftyp' && off + 12 <= head.byteLength) brand = fourcc(head, off + 8);
    if (type === 'moov') {
      if (size > MAX_MOOV) return null;
      const body = off + size <= head.byteLength ? head.subarray(off, off + size) : await src.read(off, size);
      if (body.byteLength < size) return null;
      return { moov: body, brand };
    }
    if (!Number.isFinite(size)) return null;
    off += size;
  }
  return null;
}

export async function probeMedia(src) {
  let found;
  try { found = await findMoov(src); } catch (_) { return null; }
  if (!found) return null;
  const u8 = found.moov;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const moov = { start: dv.getUint32(0) === 1 ? 16 : 8, end: u8.byteLength };
  const mvhdBox = child(u8, dv, moov, 'mvhd');
  const mvhd = mvhdBox ? parseMvhd(dv, mvhdBox) : null;
  const traks = [];
  for (const c of children(u8, dv, moov.start, moov.end)) {
    if (c.type !== 'trak') continue;
    try {
      const t = parseTrak(u8, dv, c);
      if (t) traks.push(t);
    } catch (_) { /* a damaged track: skip it */ }
  }
  const video = traks.find((t) => t.handler === 'vide');
  const audio = traks.find((t) => t.handler === 'soun');
  const tmcd = traks.find((t) => t.handler === 'tmcd');
  if (!video && !audio) return null;

  const out = {
    container: found.brand === 'qt  ' ? 'mov' : 'mp4',
    dur: mvhd?.duration ?? (video ? video.duration / video.timescale : audio.duration / audio.timescale),
    w: null, h: null, rot: 0, fps: null, vfr: false, frames: null, codec: null, prof: null,
    editOffset: 0, tc: null, audio: null, bitrate: null,
  };
  if (video) {
    out.codec = video.desc?.codec || null;
    out.prof = video.desc?.prof || null;
    if (video.tkhd) {
      out.rot = video.tkhd.rot;
      // Display size, as the track header gives it (it already applies the
      // pixel aspect ratio); a 90°/270° rotation swaps what the viewer sees.
      const sideways = out.rot === 90 || out.rot === 270;
      out.w = sideways ? video.tkhd.h : video.tkhd.w;
      out.h = sideways ? video.tkhd.w : video.tkhd.h;
    }
    const r = rateFromStts(video.stts, video.timescale);
    if (r) { out.fps = r.fps; out.frames = r.frames; out.vfr = r.vfr; }
    out.editOffset = video.timescale ? video.mediaTime / video.timescale : 0;
  }
  if (audio) {
    out.audio = {
      codec: audio.desc?.codec || null,
      rate: audio.desc?.rate || audio.timescale || null,
      ch: audio.desc?.ch || null,
    };
  }
  if (tmcd?.desc && tmcd.chunk0 != null && tmcd.desc.tcScale && tmcd.desc.tcDur) {
    try {
      const b = await src.read(tmcd.chunk0, 4);
      if (b.byteLength === 4) {
        const frame = new DataView(b.buffer, b.byteOffset, 4).getUint32(0);
        const rate = snapFps(tmcd.desc.tcScale, tmcd.desc.tcDur);
        out.tc = { start: frameToTC(frame, rate, { df: tmcd.desc.df }), df: !!tmcd.desc.df, frame };
      }
    } catch (_) { /* no start timecode, then */ }
  }
  if (src.size && out.dur > 0) out.bitrate = Math.round((src.size * 8) / out.dur);
  return out;
}

// The `media` object a card stores (lib/cardInfo.js reads it). Compact, and
// free of r2: strings so it can't disturb storage liveness.
export function mediaFacts(p) {
  if (!p) return null;
  const m = { probed: 1 };
  if (Number.isFinite(p.dur) && p.dur > 0) m.dur = Math.round(p.dur * 1000) / 1000;
  if (p.w) m.w = p.w;
  if (p.h) m.h = p.h;
  if (p.rot) m.rot = p.rot;
  if (p.fps) m.fps = p.fps;
  if (p.vfr) m.vfr = 1;
  if (p.frames) m.frames = p.frames;
  if (p.codec) m.codec = p.codec;
  if (p.prof) m.prof = p.prof;
  if (p.tc?.start) m.tc = { start: p.tc.start, df: p.tc.df ? 1 : 0, frame: p.tc.frame };
  if (p.audio) m.audio = { codec: p.audio.codec || null, rate: p.audio.rate || null, ch: p.audio.ch || null };
  if (p.bitrate) m.bitrate = p.bitrate;
  return m;
}

// A local File at upload: its facts, or null. Never throws — an upload must
// not fail because a container couldn't be read.
export async function probeFile(file) {
  if (!file || typeof file.slice !== 'function') return null;
  try { return mediaFacts(await probeMedia(blobSource(file))); } catch (_) { return null; }
}
