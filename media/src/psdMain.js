// The Photoshop reader's own process (psd.js), run by view.js as the
// unprivileged user with a bare environment and a capped heap:
//
//   node psdMain.js <document> <out.tif> <thumb.jpg> <maxEdge> <maxPixels>
//
// Writes the flattened picture to <out.tif>, or, when the document has none
// it reads, the JPEG thumbnail Photoshop stored to <thumb.jpg>. Prints one line
// of JSON saying which: {"made":"tiff"|"jpeg","w":…,"h":…}, or
// {"refused":"unsupported"|"too_large","message":…}. Anything else is a crash.

import { open, writeFile } from 'node:fs/promises';
import { readLayout, composite, encodeTiff, PsdRefused } from './psd.js';

const [src, tiffPath, jpegPath, maxEdge, maxPixels] = process.argv.slice(2);
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const fh = await open(src, 'r');
try {
  const { size } = await fh.stat();
  const read = async (offset, length) => {
    const n = Math.max(0, Math.min(length, size - offset));
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, offset);
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
  };
  let layout = null;
  try {
    layout = await readLayout(read, size);
    const made = await composite(read, layout, { maxEdge: Number(maxEdge), maxPixels: Number(maxPixels) });
    await writeFile(tiffPath, encodeTiff(made), { mode: 0o644 });
    say({ made: 'tiff', w: made.w, h: made.h });
  } catch (e) {
    if (!(e instanceof PsdRefused)) throw e;
    // No flattened picture this reads: the thumbnail, when there is one.
    const t = e.reason === 'unsupported' ? layout?.thumbnail : null;
    const bytes = t ? await read(t.offset, t.length) : null;
    if (bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      await writeFile(jpegPath, bytes, { mode: 0o644 });
      say({ made: 'jpeg', w: layout.width, h: layout.height });
    } else {
      say({ refused: e.reason, message: e.message.slice(0, 200) });
    }
  }
} finally {
  await fh.close();
}
