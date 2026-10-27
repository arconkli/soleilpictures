// Documents: Word, PowerPoint, Excel, Keynote, Pages, Numbers, OpenDocument
// and the rest (boards/src/lib/fileView.js DOC_EXTS). LibreOffice prints a
// document to a PDF, its first DOC_MAX_PAGES pages, and poppler's pdftoppm
// draws the PDF's first page as the picture its view is made of; a
// spreadsheet's is its first sheet's cells (sheetPicture, cellsOf). The PDF
// goes up too, for Quick look.
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
import { run, isRoot, isStopping, openOwn, MEDIA_UID, MEDIA_GID } from './ffmpeg.js';
import { vipsEnv } from './viewArgs.js';
import { scrubError } from './args.js';

const SOFFICE_TIMEOUT_MS = 4 * 60_000;
const PDFINFO_TIMEOUT_MS = 60_000;
const PAGE_TIMEOUT_MS = 2 * 60_000;
const SHEET_TIMEOUT_MS = 90_000;
// LibreOffice shrinks a sheet too long for one page about 5 m tall until it
// fits, and one this long has been.
const SHRUNK_PTS = 14_000;
// A shrunk sheet narrower than this is a sliver: its printed first page shows
// it better.
const SLIVER_PTS = 144;
// A sheet region's long side in pixels, before its margin goes round it.
const SHEET_EDGE = 1800;

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

// A spreadsheet's card shows its first sheet: Calc's whole-sheet export puts
// each sheet on one page as big as its cells, where its printed pages split a
// wide sheet's columns across pages, and the first held only those on the
// left. Every sheet comes out (PageRange doesn't hold with it); only the
// first page is read.
export function sheetFilter() {
  return `pdf:calc_pdf_Export:${JSON.stringify({
    SinglePageSheets: { type: 'boolean', value: true },
    ReduceImageResolution: { type: 'boolean', value: true },
    MaxImageResolution: { type: 'long', value: 150 },
    Quality: { type: 'long', value: 85 },
  })}`;
}

// soffice's arguments: convert `src` to a PDF in `outDir` with `filter`, the
// profile at `profileDir`.
export function sofficeArgs(src, outDir, profileDir, filter = pdfFilter()) {
  return ['--headless', '--invisible', '--nocrashreport', '--nodefault', '--nofirststartwizard', '--nolockcheck',
    '--nologo', '--norestore', `-env:UserInstallation=file://${profileDir}`,
    '--convert-to', filter, '--outdir', outDir, src];
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

// The first page's size in points as pdfinfo reports it, or null.
export function sizeOfPage(info) {
  const m = /^Page(?:\s+1)? size:\s+([0-9]+(?:\.[0-9]+)?) x ([0-9]+(?:\.[0-9]+)?) pts/m.exec(String(info || ''));
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

// The part of a whole sheet (`w` × `h` points, from its top left) a card
// shows: all of it, its first rows when it's long, its first columns when
// it's very wide.
export function sheetRegion(w, h) {
  const rw = Math.min(w, h * 3.2, 1400);
  return { w: rw, h: Math.min(h, rw * 1.8) };
}

// A page's margin round cells `w` × `h`: a twentieth of the long side, and
// deeper below, where the card's name strip sits over it.
export function marginsOf(w, h) {
  const m = Math.round(Math.max(w, h) * 0.05);
  return { m, bottom: Math.max(m, Math.round((w + 2 * m) * 0.12)) };
}

// The resolution that draws a sheet region about SHEET_EDGE on its long side.
export function sheetDpi(region) {
  return Math.max(36, Math.min(450, Math.floor((72 * SHEET_EDGE) / Math.max(region.w, region.h))));
}

// pdftoppm's: the top-left `w` × `h` pixels of the first page of `pdf` at
// `dpi`, as `<outBase>.png`.
export const regionArgs = (pdf, outBase, { w, h }, dpi) => ['-f', '1', '-l', '1', '-png', '-r', String(dpi),
  '-x', '0', '-y', '0', '-W', String(w), '-H', String(h), '-singlefile', pdf, outBase];

// vips's: `src` (`w` × `h` pixels) on white paper with a page's margin round
// it, as `out`.
export function frameArgs(src, out, { w, h }) {
  const { m, bottom } = marginsOf(w, h);
  return ['embed', src, out, String(m), String(m), String(w + 2 * m), String(h + m + bottom),
    '--extend', 'background', '--background', '255'];
}

// vips find_trim's answer (left, top, width, height), or null for a blank page.
export function trimOf(out) {
  const n = String(out || '').trim().split(/\s+/).map(Number);
  if (n.length !== 4 || !n.every((v) => Number.isInteger(v) && v >= 0) || !n[2] || !n[3]) return null;
  return { left: n[0], top: n[1], width: n[2], height: n[3] };
}

// A printed page's cells (`trim`, on a `page` of that many pixels) with a
// page's margin round them, inside the page; null when that keeps nearly all
// of it.
export function trimCrop(trim, page) {
  const { m, bottom } = marginsOf(trim.width, trim.height);
  const x = Math.max(0, trim.left - m);
  const y = Math.max(0, trim.top - m);
  const w = Math.min(page.w, trim.left + trim.width + m) - x;
  const h = Math.min(page.h, trim.top + trim.height + bottom) - y;
  return w >= page.w * 0.9 && h >= page.h * 0.9 ? null : { x, y, w, h };
}

// pdftoppm's: that crop of the first page of `pdf`, drawn again `edge` on its
// long side (at most four times the page's own drawing), as `<outBase>.png`.
export function cropArgs(pdf, outBase, crop, page, edge = VIEW_EDGE) {
  const s = Math.min(4, edge / Math.max(crop.w, crop.h));
  const px = (v) => Math.round(v * s);
  return ['-f', '1', '-l', '1', '-png', '-scale-to', String(px(Math.max(page.w, page.h))),
    '-x', String(px(crop.x)), '-y', String(px(crop.y)), '-W', String(px(crop.w)), '-H', String(px(crop.h)),
    '-singlefile', pdf, outBase];
}

// A folder of the unprivileged user's, made by root before any decoder runs.
async function ownedDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (isRoot()) await chown(path, MEDIA_UID, MEDIA_GID);
}

// The PDF LibreOffice made of `src` in `outDir`.
const pdfIn = (outDir, src) => join(outDir, `${src.slice(src.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '')}.pdf`);

// The document `src` (in `work`), printed: { pdfPath, pages, pagePath,
// picture }, the PDF copied into the root process's own `dir`, and the
// picture its view is made of drawn in `work`: its first page ('page'), or a
// spreadsheet's (`sheet`) first sheet whole ('sheet') or its printed first
// page cropped to its cells ('cells'). Throws `refuse(reason, message)` for a
// document LibreOffice can't read (a password, damage, not a document after
// all).
export async function docPages(src, { dir, work }, { refuse, sheet = false }) {
  const profile = join(work, 'lo');
  const out = join(work, 'out');
  const env = { HOME: join(work, 'home'), TMPDIR: join(work, 'tmp') };
  // Every folder is made before LibreOffice first runs: after that, `work` is
  // the decoders' to change, and root makes nothing more in it.
  const dirs = [profile, join(profile, 'user'), out, env.HOME, env.TMPDIR, ...(sheet ? [join(work, 'sheet')] : [])];
  for (const d of dirs) await ownedDir(d);
  const xcu = await open(join(profile, 'user', 'registrymodifications.xcu'), 'wx', 0o644);
  try {
    await xcu.writeFile(PROFILE_XCU);
    if (isRoot()) await xcu.chown(MEDIA_UID, MEDIA_GID);
  } finally {
    await xcu.close();
  }

  await run('soffice', sofficeArgs(src, out, profile), {
    timeoutMs: SOFFICE_TIMEOUT_MS, isolate: true, group: true, env,
  });
  // soffice says nothing useful when it can't read a file (it exits 0): the
  // PDF being there is the answer.
  let own;
  try {
    own = await openOwn(pdfIn(out, src));
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

  // A spreadsheet: its first sheet whole, else its printed first page cropped
  // to its cells, else that page as printed. Neither failing costs the view.
  const tryPicture = (what, make) => make().catch((e) => {
    if (isStopping()) throw e;
    console.warn(`[media] ${what} failed: ${scrubError(e?.message)}`);
    return null;
  });
  if (sheet) {
    const whole = await tryPicture('whole sheet', () => sheetPicture(src, work, profile, env));
    if (whole) return { pdfPath, pages, pagePath: whole, picture: 'sheet' };
  }
  const pagePath = await firstPage(pdfPath, work);
  if (sheet) {
    const cells = await tryPicture('cells crop', () => cellsOf(pdfPath, pagePath, work));
    if (cells) return { pdfPath, pages, pagePath: cells, picture: 'cells' };
  }
  return { pdfPath, pages, pagePath, picture: 'page' };
}

// The first page of the PDF `pdf`, drawn by poppler into `work` (pageArgs):
// the picture's path. An Illustrator file, a PDF inside, comes here too.
export async function firstPage(pdf, work) {
  const pageBase = join(work, 'page');
  await run('pdftoppm', pageArgs(pdf, pageBase), { timeoutMs: PAGE_TIMEOUT_MS, isolate: true });
  return `${pageBase}.png`;
}

// A spreadsheet's first sheet, whole (sheetFilter), its region framed on
// paper: the picture's path in `work`, or null when LibreOffice shrank the
// sheet to a sliver. Root opens nothing here: the PDF is read by poppler and
// the picture by vips, as the decoders.
async function sheetPicture(src, work, profile, env) {
  const out = join(work, 'sheet');
  await run('soffice', sofficeArgs(src, out, profile, sheetFilter()), {
    timeoutMs: SHEET_TIMEOUT_MS, isolate: true, group: true, env,
  });
  const pdf = pdfIn(out, src);
  const size = sizeOfPage(await run('pdfinfo', ['-f', '1', '-l', '1', pdf], { timeoutMs: PDFINFO_TIMEOUT_MS, isolate: true }));
  if (!size || !(size.w > 0) || !(size.h > 0)) return null;
  if (Math.max(size.w, size.h) >= SHRUNK_PTS && Math.min(size.w, size.h) < SLIVER_PTS) return null;
  const region = sheetRegion(size.w, size.h);
  const dpi = sheetDpi(region);
  const px = { w: Math.max(1, Math.round((region.w * dpi) / 72)), h: Math.max(1, Math.round((region.h * dpi) / 72)) };
  const base = join(work, 'sheet-region');
  await run('pdftoppm', regionArgs(pdf, base, px, dpi), { timeoutMs: PAGE_TIMEOUT_MS, isolate: true });
  const framed = join(work, 'sheet.png');
  await run('vips', frameArgs(`${base}.png`, framed, px), { timeoutMs: PAGE_TIMEOUT_MS, isolate: true, env: vipsEnv('pngload') });
  return framed;
}

// A printed first page (`pagePng`, drawn from `pdf`) cropped to its cells and
// drawn again at the view's size: the picture's path in `work`, or null when
// its cells fill the page (or it's blank).
async function cellsOf(pdf, pagePng, work) {
  const opts = { timeoutMs: PAGE_TIMEOUT_MS, isolate: true, env: vipsEnv('pngload') };
  const dim = async (name) => Number((await run('vipsheader', ['-f', name, pagePng], opts)).toString().trim());
  const page = { w: await dim('width'), h: await dim('height') };
  if (!(page.w > 0) || !(page.h > 0)) return null;
  const trim = trimOf(await run('vips', ['find_trim', pagePng, '--threshold', '12', '--background', '255'], opts));
  const crop = trim ? trimCrop(trim, page) : null;
  if (!crop) return null;
  const base = join(work, 'cells');
  await run('pdftoppm', cropArgs(pdf, base, crop, page), { timeoutMs: PAGE_TIMEOUT_MS, isolate: true });
  return `${base}.png`;
}
