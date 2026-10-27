// The design-file finder's own process (design.js), run by view.js as the
// unprivileged user with a bare environment and a capped heap:
//
//   node designMain.js <ext> <source> <outDir>
//
// Writes the picture it finds to <outDir>/picture.png, .jpg or .tiff and
// prints one line of JSON: {"made":{"file":"picture.png"}}, {"pdf":true} (the
// file is a PDF inside: the root process draws its first page) or
// {"refused":"no_picture"}. Anything else is a crash.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { designPictureOf } from './design.js';

const [ext, src, outDir] = process.argv.slice(2);
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const buf = await readFile(src);
const found = designPictureOf(buf, ext);
if (!found) say({ refused: 'no_picture' });
else if (found.kind === 'pdf') say({ pdf: true });
else {
  const file = { png: 'picture.png', jpeg: 'picture.jpg', tiff: 'picture.tiff' }[found.kind];
  await writeFile(join(outDir, file), found.bytes ?? buf.subarray(found.start, found.end), { flag: 'wx', mode: 0o644 });
  say({ made: { file } });
}
