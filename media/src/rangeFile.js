// A file held only in part, read like a Blob. The converter reads a zip it
// doesn't hold whole (zipJob.js) into a sparse local copy: the bytes it has
// are the ranges in `have`, the rest of the file is a hole of zeros. Reading
// a range the copy doesn't hold throws NeedRange naming it, so the parser
// (zipMain.js, which can't reach the network) can only ask for bytes and the
// root process fetches them.
//
// It is the Blob lib/zipRead.js reads: `size`, `slice` and `arrayBuffer`,
// and a `stream` for an entry that is inflated.

import { open } from 'node:fs/promises';

const PIECE = 1024 * 1024;

// The ranges ([start, end) in the whole file) a read needs and the copy lacks.
export class NeedRange extends Error {
  constructor(ranges) {
    super('needs bytes the copy does not hold');
    this.name = 'NeedRange';
    this.ranges = ranges;
  }
}

// Sorted, with the ranges that touch or overlap merged into one.
export function mergeRanges(ranges) {
  const out = [];
  for (const [s, e] of [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

// Whether every byte of [start, end) is held.
export function covered(have, start, end) {
  if (end <= start) return true;
  return mergeRanges(have).some(([s, e]) => s <= start && end <= e);
}

export class RangeFile {
  // `start` and `end` are where this slice sits in the whole file.
  constructor(path, have, size, start = 0, end = size) {
    this.path = path;
    this.have = have;
    this.total = size;
    this.start = start;
    this.end = end;
    this.size = end - start;
  }

  // Relative to this slice, as a Blob's is (a negative index counts from its end).
  slice(a = 0, b = this.size) {
    const rel = (v) => (v < 0 ? Math.max(0, this.size + v) : Math.min(v, this.size));
    const from = rel(a);
    const to = Math.max(from, rel(b));
    return new RangeFile(this.path, this.have, this.total, this.start + from, this.start + to);
  }

  check() {
    if (!covered(this.have, this.start, this.end)) throw new NeedRange([[this.start, this.end]]);
  }

  async arrayBuffer() {
    this.check();
    const buf = Buffer.alloc(this.size);
    const fh = await open(this.path, 'r');
    try {
      let got = 0;
      while (got < this.size) {
        const { bytesRead } = await fh.read(buf, got, this.size - got, this.start + got);
        if (!bytesRead) break;
        got += bytesRead;
      }
    } finally {
      await fh.close();
    }
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  stream() {
    this.check();
    let at = this.start;
    let fh = null;
    const end = this.end;
    const path = this.path;
    return new ReadableStream({
      async pull(controller) {
        if (at >= end) {
          await fh?.close();
          fh = null;
          controller.close();
          return;
        }
        fh ??= await open(path, 'r');
        const buf = Buffer.alloc(Math.min(PIECE, end - at));
        const { bytesRead } = await fh.read(buf, 0, buf.length, at);
        if (!bytesRead) {
          await fh.close();
          fh = null;
          controller.error(new Error('the copy is shorter than its size'));
          return;
        }
        at += bytesRead;
        controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, bytesRead));
      },
      async cancel() {
        await fh?.close();
        fh = null;
      },
    });
  }
}
