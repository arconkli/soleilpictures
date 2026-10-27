// Documents: Word, PowerPoint, Excel, Keynote, Pages, Numbers, OpenDocument
// and the rest (boards/src/lib/fileView.js DOC_EXTS). LibreOffice prints a
// document to a PDF, its first DOC_MAX_PAGES pages, and poppler's pdftoppm
// draws the PDF's first page as the picture its view is made of. The PDF goes
// up too, for Quick look.
//
// LibreOffice reads more formats than anything else on this box, so it is
// held the hardest: as the unprivileged user, with no network at all (run's
// `isolate`), a bare environment, and a throwaway profile in the job's work
// folder that runs no macro and follows no link out of the document
// (BlockUntrustedRefererLinks: no picture, section or sheet a document points
// to outside itself is fetched, local files included). A document must look
// like one by its first bytes before LibreOffice sees it (viewArgs.js
// sniffDoc), and its helpers die with it (run's `group`).

import { mkdir, open, chown } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { DOC_MAX_PAGES, VIEW_EDGE, VIEW_MAX_BYTES } from '../../boards/src/lib/fileView.js';
import { run, isRoot, openOwn, MEDIA_UID, MEDIA_GID } from './ffmpeg.js';

const SOFFICE_TIMEOUT_MS = 4 * 60_000;
const PDFINFO_TIMEOUT_MS = 60_000;
const PAGE_TIMEOUT_MS = 2 * 60_000;

// The profile's settings: macros at the highest security and never run, and
// links out of a document blocked. LibreOffice reads them from
// <profile>/user/registrymodifications.xcu when it starts.
export const PROFILE_XCU = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`;

// The PDF export, as LibreOffice 7.4 takes it on --convert-to (its JSON
// options; any module's document takes this filter name): the first
// `maxPages` pages, pictures at screen resolution. A 60,000-row sheet prints
// to over a thousand pages without the range.
export function pdfFilter(maxPages = DOC_MAX_PAGES) {
  return `pdf:writer_pdf_Export:${JSON.stringify({
    PageRange: { type: 'string', value: `1-${maxPages}` },
    ReduceImageResolution: { type: 'boolean', value: true },
    MaxImageResolution: { type: 'long', value: 150 },
    Quality: { type: 'long', value: 85 },
  })}`;
}

// soffice's arguments: convert `src` to a PDF in `outDir`, with the profile at
// `profileDir`.
export function sofficeArgs(src, outDir, profileDir, maxPages = DOC_MAX_PAGES) {
  return ['--headless', '--invisible', '--nocrashreport', '--nodefault', '--nofirststartwizard', '--nolockcheck',
    '--nologo', '--norestore', `-env:UserInstallation=file://${profileDir}`,
    '--convert-to', pdfFilter(maxPages), '--outdir', outDir, src];
}

// pdftoppm's: the first page of `pdf`, `edge` on its long side, as
// `<outBase>.png`.
export const pageArgs = (pdf, outBase, edge = VIEW_EDGE) => ['-f', '1', '-l', '1', '-png', '-scale-to', String(edge),
  '-singlefile', pdf, outBase];

// The number of pages pdfinfo reports, or 0.
export function pagesOf(info) {
  const m = /^Pages:\s+([0-9]{1,7})\s*$/m.exec(String(info || ''));
  return m ? Number(m[1]) : 0;
}

// A folder of the unprivileged user's, made by root before any decoder runs.
async function ownedDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (isRoot()) await chown(path, MEDIA_UID, MEDIA_GID);
}

// The document `src` (in `work`), printed: { pdfPath, pages, pagePath }, the
// PDF copied into the root process's own `dir`, and its first page drawn in
// `work`. Throws `refuse(reason, message)` for a document LibreOffice can't
// read (a password, damage, not a document after all).
export async function docPages(src, { dir, work }, { refuse }) {
  const profile = join(work, 'lo');
  const out = join(work, 'out');
  for (const d of [profile, join(profile, 'user'), out, join(work, 'home'), join(work, 'tmp')]) await ownedDir(d);
  const xcu = await open(join(profile, 'user', 'registrymodifications.xcu'), 'wx', 0o644);
  try {
    await xcu.writeFile(PROFILE_XCU);
    if (isRoot()) await xcu.chown(MEDIA_UID, MEDIA_GID);
  } finally {
    await xcu.close();
  }

  await run('soffice', sofficeArgs(src, out, profile), {
    timeoutMs: SOFFICE_TIMEOUT_MS, isolate: true, group: true,
    env: { HOME: join(work, 'home'), TMPDIR: join(work, 'tmp') },
  });
  // soffice says nothing useful when it can't read a file (it exits 0): the
  // PDF being there is the answer.
  const made = join(out, `${src.slice(src.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '')}.pdf`);
  let own;
  try {
    own = await openOwn(made);
  } catch (_) {
    throw refuse('unsupported', 'LibreOffice could not read it (a password, damage, or not a document)');
  }
  const pdfPath = join(dir, 'view.pdf');
  try {
    if (own.size > VIEW_MAX_BYTES) throw refuse('too_large', 'the PDF is too large');
    await pipeline(own.fh.createReadStream({ autoClose: false }), createWriteStream(pdfPath, { flags: 'wx', mode: 0o644 }));
  } finally {
    await own.fh.close().catch(() => {});
  }

  const pages = pagesOf(await run('pdfinfo', [pdfPath], { timeoutMs: PDFINFO_TIMEOUT_MS, isolate: true }));
  if (!pages) throw refuse('unsupported', 'the PDF has no pages');
  const pageBase = join(work, 'page');
  await run('pdftoppm', pageArgs(pdfPath, pageBase), { timeoutMs: PAGE_TIMEOUT_MS, isolate: true });
  return { pdfPath, pages, pagePath: `${pageBase}.png` };
}
