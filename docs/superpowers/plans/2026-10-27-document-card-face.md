# Document card face (direction A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Word, PowerPoint, Excel, Keynote, Pages, Numbers, OpenDocument or RTF file's card shows its first page at the page's own shape, as a PDF card does (direction A, picked by the owner 2026-10-27 from the canvas https://claude.ai/artifact/C6pR3SyXsA3xQH7bMKV9JE).

**Architecture:** The converter already makes each document's first-page view and records it as the original's `preview_path` (0662). This plan:
- teaches the card, the Files page and the sidebar to draw that view;
- gives new document cards a family-shaped first size (a page, a slide);
- has the editors' view pass reshape a card that's still that size, and record `pageCount`;
- returns a card that will never get a page to a file card's size;
- makes a spreadsheet's picture its first sheet's cells, on the converter.

**Tech Stack:** React 18 + Vite (boards/), Node 20 ESM converter on Fly (media/), LibreOffice 7.4 + poppler 22 + vips 8.14, node:test, Playwright.

## Global Constraints

- main = preview. Never promote to production here. Commit by pathspec from the worktree `<scratchpad>/wt-pv`, rebase on origin/main, then push `HEAD:refs/heads/main`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` after a blank line.
- The repo is public: no business metrics, revenue figures or user counts in commits or files.
- A public surface changes its docs in the same commit (`boards/content/docs/**`, then `npm run docs:build`, then `npm run docs:check`). Numbers come through `{{fact:}}`.
- Gold (`--soleil`) only for active, selection and focus states. Resting icons are neutral ink, Phosphor regular.
- appJs is measured by `scripts/bundleBudget.mjs` (ceiling 687.0 KB, CI at 686.4 on 9925dce4). Any growth past it is raised on purpose, in the same commit, with the measured figure in the message.
- Never `.catch()` a `supabase.rpc()` builder. Dev-only bridges stay behind `import.meta.env.DEV`.
- Never queue views of real users' files as a test. QA files live in the internal Party QA workspace `348f7064-3eea-4988-ba32-1a37535cd3a8`.
- The converter is deployed (`sh media/deploy.sh`) BEFORE any Worker change that depends on it. This plan changes no Worker code.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `boards/src/lib/fileView.js` | Shared, pure: which files get views, names | `docFamily`, `docDropSize`, `DOC_DROP_PAGE`, `DOC_DROP_SLIDE`, `extOfKey` |
| `media/src/doc.js` | LibreOffice → PDF → first-page picture | the whole-sheet picture, the cells crop, pure helpers |
| `media/src/view.js` | One view job | passes `sheet` to docPages; `picture` in the probe |
| `boards/src/lib/fileIngest.js` | Drop classification and sizes | a document's file route gets its family's size |
| `boards/src/components/CanvasSurface.jsx` | Canvas drop + card mount | `optimisticDropFile` size; FileCard props |
| `boards/src/lib/fileShareSave.js` | Save a shared file to a board | a document lands at its family's size |
| `boards/src/lib/fileViewClient.js` | Pure patches from view rows | document reshape, `pageCount`, `noPageCardPatch`, `page_count` in VIEW_COLS |
| `boards/src/lib/fileViewWork.js` | Lazy: the pass, waiting | writes doc patches, shrinks a failed doc |
| `boards/src/hooks/useFileViewBackfill.js` | Editors' pass trigger | targets doc cards with no `pageCount` |
| `boards/src/components/R2Image.jsx` | Every stored picture | optional `placeholder(state)` |
| `boards/src/components/cards/FileCard.jsx` + `fileCard.css` | The file card | the page face, family glyphs, upload state |
| `boards/src/lib/icons.js` | Icon re-exports | `FileXls`, `FilePpt`, `Presentation` |
| `boards/src/lib/listItem.js` | List items | `preview.page` for documents |
| `boards/src/components/clusterBrowser/CardPreview.jsx` (+ ClusterRow) | Files tiles, rows, Info, Quick look fallback | the page where a picture goes |
| `boards/src/components/sidebar/ClusterShelves.jsx` | Sidebar rows | the page as the row's thumb |
| `boards/src/local/LocalBoardsApp.jsx` | Local QA shell | DEV bridge `window.__soleilFileLive.addFile` |
| `boards/tests/doc-card-face.spec.js` | Playwright | the face on the local board |
| `boards/content/docs/files/index.md` | Public docs | documents show their first page |
| `boards/scripts/bundleBudget.mjs` | appJs ceiling | raised by the measured growth |

---

### Task 1: Document families and first sizes (shared)

**Files:**
- Modify: `boards/src/lib/fileView.js` (after `DOC_SET`, and the header comment's document paragraph)
- Test: `boards/src/lib/fileView.test.mjs`

**Interfaces:**
- Produces: `docFamily(ext) → 'page' | 'slides' | 'sheet' | null`, `DOC_DROP_PAGE = {w:300,h:388}`, `DOC_DROP_SLIDE = {w:400,h:225}`, `docDropSize(ext) → {w,h} | null`, `extOfKey(keyOrRef) → string` (lowercased, '' when none).

- [ ] **Step 1: Write the failing test** (append to `fileView.test.mjs`, importing the new names)

```js
test("a document's family decides its first size: a slide for a deck, a page for the rest", () => {
  for (const e of ['pptx', 'PPT', 'key', 'odp', 'ppsx', 'potx', 'sxi']) assert.equal(docFamily(e), 'slides', e);
  for (const e of ['xlsx', 'xls', 'xlsm', 'numbers', 'ods', 'sxc']) assert.equal(docFamily(e), 'sheet', e);
  for (const e of ['docx', 'doc', 'pages', 'odt', 'rtf', 'wpd', 'vsdx', 'pub']) assert.equal(docFamily(e), 'page', e);
  for (const e of ['pdf', 'zip', 'jpg', 'heic', '', null, undefined]) assert.equal(docFamily(e), null, String(e));
  for (const e of DOC_EXTS) assert.ok(docFamily(e), e);
  assert.deepEqual(docDropSize('pptx'), { w: 400, h: 225 });
  assert.deepEqual(docDropSize('Budget.XLSX'.split('.').pop()), { w: 300, h: 388 });
  assert.deepEqual(docDropSize('docx'), DOC_DROP_PAGE);
  assert.equal(docDropSize('zip'), null);
  assert.equal(extOfKey('r2:ws/abc/Deck v2.PPTX'), 'pptx');
  assert.equal(extOfKey('ws/abc/noext'), '');
  assert.equal(extOfKey(null), '');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd boards && node --test src/lib/fileView.test.mjs`
Expected: FAIL, `docFamily is not a function` (or a SyntaxError on the import).

- [ ] **Step 3: Implement** (after `const DOC_SET = new Set(DOC_EXTS);`)

```js
// A document's family, for the size its card first lands at and the glyph it
// wears: 'slides' (a deck), 'sheet' (a spreadsheet, whose picture is its first
// sheet's cells: media/src/doc.js) or 'page' (the rest, which print to pages).
// null for a file that isn't a document.
const SLIDE_EXTS = new Set(['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'pot', 'potx', 'potm', 'odp', 'otp', 'key', 'sxi']);
const SHEET_EXTS = new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'xltm', 'ods', 'ots', 'numbers', 'sxc']);
export function docFamily(ext) {
  const e = String(ext || '').toLowerCase();
  if (!DOC_SET.has(e)) return null;
  return SLIDE_EXTS.has(e) ? 'slides' : SHEET_EXTS.has(e) ? 'sheet' : 'page';
}

// The size a new document's card lands at, before its first page is made: a
// page's (a PDF card's) or a slide's. A card still this size takes its page's
// own shape when the page comes (lib/fileViewClient.js viewFileCardPatch),
// and goes back to a file card's 240×150 when none will (noPageCardPatch).
export const DOC_DROP_PAGE = Object.freeze({ w: 300, h: 388 });
export const DOC_DROP_SLIDE = Object.freeze({ w: 400, h: 225 });
export function docDropSize(ext) {
  const family = docFamily(ext);
  return family === 'slides' ? DOC_DROP_SLIDE : family ? DOC_DROP_PAGE : null;
}

// The extension of a stored file's key (or its "r2:" ref), lowercased, or ''.
export function extOfKey(key) {
  const m = String(key || '').match(EXT_RE);
  return m ? m[1].toLowerCase() : '';
}
```

In the header's document paragraph, replace "A document's view is its first page, which its file card shows, and a PDF of its pages goes beside it for Quick look (LibreOffice on the converter makes both). Its card stays a file card." with "A document's view is its first page (a spreadsheet's, its first sheet's cells), which its file card shows at the page's shape, and a PDF of its pages goes beside it for Quick look (LibreOffice on the converter makes both). Its card stays a file card."

- [ ] **Step 4: Run it to see it pass**

Run: `cd boards && node --test src/lib/fileView.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit** (with the plan file)

```bash
git add boards/src/lib/fileView.js boards/src/lib/fileView.test.mjs docs/superpowers/plans/2026-10-27-document-card-face.md
git commit -m "<what a document's family and first size are, why> …"
```

---

### Task 2: The converter draws a spreadsheet's first sheet

A wide sheet's printed first page holds only its left columns (LibreOffice splits columns across pages). Calc's whole-sheet export (`SinglePageSheets`) puts every column of a sheet on one page sized to its cells. Verified in the lab, 2026-10-27:
- a 7-column shot list → one 571.7 × 195.0 pt page;
- two sheets → 2 pages (PageRange doesn't hold; only page 1 is read);
- 60 columns × 30 rows → 2889 × 450 pt;
- 20,000 rows → 18.3 × 14285.7 pt. LibreOffice shrank it to fit about 5 m, so it's a sliver. For that case the plan falls back to the printed first page, cropped to its cells (`vips find_trim`), drawn again at full size (also proven in the lab).

**Files:**
- Modify: `media/src/doc.js`
- Modify: `media/src/view.js` (`viewsOf` doc branch, `processView` probe)
- Test: `media/test/doc.test.mjs`

**Interfaces:**
- Consumes: `docFamily`, `extOfKey` (Task 1).
- Produces: `docPages(src, dirs, { refuse, sheet })` → `{ pdfPath, pages, pagePath, picture }` with `picture ∈ 'sheet' | 'cells' | 'page'`; pure helpers `sheetFilter`, `sizeOfPage`, `sheetRegion`, `marginsOf`, `sheetDpi`, `regionArgs`, `frameArgs`, `trimOf`, `trimCrop`, `cropArgs`; `sofficeArgs(src, outDir, profileDir, filter = pdfFilter())`.

- [ ] **Step 1: Write the failing tests** (append to `media/test/doc.test.mjs`; import the new names)

```js
test("a sheet's picture comes from Calc's whole-sheet export, every sheet one page", () => {
  const f = sheetFilter();
  assert.ok(f.startsWith('pdf:calc_pdf_Export:'));
  const o = JSON.parse(f.slice('pdf:calc_pdf_Export:'.length));
  assert.equal(o.SinglePageSheets.value, true);
  assert.equal(o.ReduceImageResolution.value, true);
  assert.deepEqual(sofficeArgs('/w/source.xlsx', '/w/sheet', '/w/lo', f).slice(-4), ['--convert-to', f, '--outdir', '/w/sheet'].slice(0, 2).concat(['--outdir', '/w/sheet']).slice(0, 4));
});

test('pdfinfo page sizes are read in both its forms', () => {
  assert.deepEqual(sizeOfPage('Pages:           1\nPage size:       571.691 x 195.024 pts\n'), { w: 571.691, h: 195.024 });
  assert.deepEqual(sizeOfPage('Page    1 size: 18.3442 x 14285.7 pts\n'), { w: 18.3442, h: 14285.7 });
  for (const s of ['', 'Page size: big', null]) assert.equal(sizeOfPage(s), null);
});

test('the card shows a whole sheet, its first rows when long, its first columns when very wide', () => {
  assert.deepEqual(sheetRegion(571.691, 195.024), { w: 571.691, h: 195.024 });   // shot list: all of it
  assert.deepEqual(sheetRegion(266.428, 435.033), { w: 266.428, h: 435.033 });   // budget: all of it
  assert.deepEqual(sheetRegion(2889.04, 450.028), { w: 1400, h: 450.028 });      // 60 columns: the first 1400 pt
  assert.deepEqual(sheetRegion(600, 9000), { w: 600, h: 1080 });                 // long: the top rows
});

test("a page's margin goes round the cells, deeper below where the name strip sits", () => {
  assert.deepEqual(marginsOf(1794, 612), { m: 90, bottom: 237 });
  assert.deepEqual(marginsOf(648, 1050), { m: 53, bottom: 90 });
  assert.deepEqual(frameArgs('/w/r.png', '/w/sheet.png', { w: 1794, h: 612 }),
    ['embed', '/w/r.png', '/w/sheet.png', '90', '90', '1974', '939', '--extend', 'background', '--background', '255']);
});

test('a region is drawn at the resolution that makes it about the view, never past 450 dpi', () => {
  assert.equal(sheetDpi({ w: 571.691, h: 195.024 }), 226);
  assert.equal(sheetDpi({ w: 266.428, h: 435.033 }), 297);
  assert.equal(sheetDpi({ w: 40, h: 12 }), 450);
  assert.deepEqual(regionArgs('/w/s.pdf', '/w/r', { w: 1794, h: 612 }, 226),
    ['-f', '1', '-l', '1', '-png', '-r', '226', '-x', '0', '-y', '0', '-W', '1794', '-H', '612', '-singlefile', '/w/s.pdf', '/w/r']);
});

test("find_trim's answer is read, and a printed page is cropped to its cells with a page's margin", () => {
  assert.deepEqual(trimOf('131\n177\n648\n1050\n'), { left: 131, top: 177, width: 648, height: 1050 });
  for (const s of ['0\n0\n0\n0\n', '1\n2\n3\n', 'x', '', null]) assert.equal(trimOf(s), null, String(s));
  const page = { w: 1449, h: 2048 };
  assert.deepEqual(trimCrop({ left: 131, top: 177, width: 648, height: 1050 }, page), { x: 78, y: 124, w: 754, h: 1193 });
  assert.deepEqual(trimCrop({ left: 131, top: 175, width: 540, height: 459 }, page), { x: 104, y: 148, w: 594, h: 557 });
  // Cells that fill the page: nothing to gain.
  assert.equal(trimCrop({ left: 40, top: 40, width: 1369, height: 1968 }, page), null);
  // Cells against the page's edge: the margin stops at the page.
  assert.deepEqual(trimCrop({ left: 0, top: 0, width: 300, height: 200 }, page), { x: 0, y: 0, w: 315, h: 240 });
});

test('the crop is drawn again at the view’s size, at most four times the page', () => {
  const page = { w: 1449, h: 2048 };
  const a = cropArgs('/d/view.pdf', '/w/cells', { x: 78, y: 124, w: 754, h: 1193 }, page);
  assert.deepEqual(a, ['-f', '1', '-l', '1', '-png', '-scale-to', '3516', '-x', '134', '-y', '213', '-W', '1294', '-H', '2048', '-singlefile', '/d/view.pdf', '/w/cells']);
  const tiny = cropArgs('/d/view.pdf', '/w/cells', { x: 10, y: 10, w: 100, h: 50 }, page);
  assert.equal(tiny[tiny.indexOf('-scale-to') + 1], String(2048 * 4));
});
```

(The `sofficeArgs` assertion in the first test is clumsy; write it as: `const a = sofficeArgs('/w/source.xlsx', '/w/sheet', '/w/lo', f); assert.deepEqual(a.slice(a.indexOf('--convert-to'), a.indexOf('--convert-to') + 4), ['--convert-to', f, '--outdir', '/w/sheet']);`.)

- [ ] **Step 2: Run them to see them fail**

Run: `node --test media/test/doc.test.mjs`
Expected: FAIL on the missing exports.

- [ ] **Step 3: Implement the helpers in `media/src/doc.js`**

Imports become:

```js
import { DOC_MAX_PAGES, VIEW_EDGE, VIEW_MAX_BYTES } from '../../boards/src/lib/fileView.js';
import { run, isRoot, isStopping, openOwn, MEDIA_UID, MEDIA_GID } from './ffmpeg.js';
import { vipsEnv } from './viewArgs.js';
import { scrubError } from './args.js';
```

`sofficeArgs` takes the filter:

```js
// soffice's arguments: convert `src` to a PDF in `outDir` with `filter`, the
// profile at `profileDir`.
export function sofficeArgs(src, outDir, profileDir, filter = pdfFilter()) {
  return ['--headless', '--invisible', '--nocrashreport', '--nodefault', '--nofirststartwizard', '--nolockcheck',
    '--nologo', '--norestore', `-env:UserInstallation=file://${profileDir}`,
    '--convert-to', filter, '--outdir', outDir, src];
}
```

New helpers (below `pagesOf`):

```js
const SHEET_TIMEOUT_MS = 90_000;
// LibreOffice shrinks a sheet too long for a page about 5 m tall to fit one.
const SHRUNK_PTS = 14_000;
// A shrunk sheet narrower than this is a sliver: its printed first page
// shows it better.
const SLIVER_PTS = 144;
// A sheet region's long side in pixels before its margin goes round it.
const SHEET_EDGE = 1800;

// A spreadsheet's card shows its first sheet: Calc's "whole sheet" export
// puts each sheet on one page as big as its cells. Its printed pages split a
// wide sheet's columns across pages, so the first showed only those on the
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

// The first page's size in points, as pdfinfo reports it, or null.
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

// The resolution that draws a region about SHEET_EDGE on its long side.
export function sheetDpi(region) {
  return Math.max(36, Math.min(450, Math.floor((72 * SHEET_EDGE) / Math.max(region.w, region.h))));
}

// pdftoppm's: the top-left `w` × `h` pixels of the first page at `dpi`.
export const regionArgs = (pdf, outBase, { w, h }, dpi) => ['-f', '1', '-l', '1', '-png', '-r', String(dpi),
  '-x', '0', '-y', '0', '-W', String(w), '-H', String(h), '-singlefile', pdf, outBase];

// vips's: `src` (`w` × `h` pixels) on white paper, a page's margin round it.
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
// page's margin, inside the page; null when that keeps nearly all of it.
export function trimCrop(trim, page) {
  const { m, bottom } = marginsOf(trim.width, trim.height);
  const x = Math.max(0, trim.left - m);
  const y = Math.max(0, trim.top - m);
  const w = Math.min(page.w, trim.left + trim.width + m) - x;
  const h = Math.min(page.h, trim.top + trim.height + bottom) - y;
  return w >= page.w * 0.9 && h >= page.h * 0.9 ? null : { x, y, w, h };
}

// pdftoppm's: that crop of the first page, drawn again `edge` on its long
// side (at most four times the page's own drawing).
export function cropArgs(pdf, outBase, crop, page, edge = VIEW_EDGE) {
  const s = Math.min(4, edge / Math.max(crop.w, crop.h));
  const px = (v) => Math.round(v * s);
  return ['-f', '1', '-l', '1', '-png', '-scale-to', String(px(Math.max(page.w, page.h))),
    '-x', String(px(crop.x)), '-y', String(px(crop.y)), '-W', String(px(crop.w)), '-H', String(px(crop.h)),
    '-singlefile', pdf, outBase];
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test media/test/doc.test.mjs`
Expected: all pass. If one of the pinned numbers differs by one from rounding, recompute it with the function in node, check it against the lab outputs of 2026-10-27 (shot list frame 1974 × 939, budget crop 754 × 1193), then pin.

- [ ] **Step 5: Wire the picture into `docPages`**

In `docPages`, hoist the soffice env (`const env = { HOME: join(work, 'home'), TMPDIR: join(work, 'tmp') };`) and use it for both runs. The function now takes `{ refuse, sheet = false }`. After `if (!pages) throw refuse(...)`, the end becomes:

```js
  // A spreadsheet: its first sheet whole, else its printed first page cropped
  // to its cells, else the page as printed. Neither failing costs the view.
  const tryPicture = (what, make) => make().catch((e) => {
    if (isStopping()) throw e;
    console.warn(`[media] ${what} failed: ${scrubError(e?.message)}`);
    return null;
  });
  if (sheet) {
    const whole = await tryPicture('whole sheet', () => sheetPicture(src, work, profile, env));
    if (whole) return { pdfPath, pages, pagePath: whole, picture: 'sheet' };
  }
  const pageBase = join(work, 'page');
  await run('pdftoppm', pageArgs(pdfPath, pageBase), { timeoutMs: PAGE_TIMEOUT_MS, isolate: true });
  if (sheet) {
    const cells = await tryPicture('cells crop', () => cellsOf(pdfPath, `${pageBase}.png`, work));
    if (cells) return { pdfPath, pages, pagePath: cells, picture: 'cells' };
  }
  return { pdfPath, pages, pagePath: `${pageBase}.png`, picture: 'page' };
```

Two private helpers below `docPages`:

```js
// A spreadsheet's first sheet, whole (sheetFilter), its region framed on
// paper: the picture's path, or null when LibreOffice shrank the sheet to a
// sliver. Read only by the decoders: nothing here is opened by root.
async function sheetPicture(src, work, profile, env) {
  const out = join(work, 'sheet');
  await ownedDir(out);
  await run('soffice', sofficeArgs(src, out, profile, sheetFilter()), {
    timeoutMs: SHEET_TIMEOUT_MS, isolate: true, group: true, env,
  });
  const pdf = join(out, `${src.slice(src.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '')}.pdf`);
  const size = sizeOfPage(await run('pdfinfo', ['-f', '1', '-l', '1', pdf], { timeoutMs: PDFINFO_TIMEOUT_MS, isolate: true }));
  if (!size || (Math.max(size.w, size.h) >= SHRUNK_PTS && Math.min(size.w, size.h) < SLIVER_PTS)) return null;
  const region = sheetRegion(size.w, size.h);
  const dpi = sheetDpi(region);
  const px = { w: Math.max(1, Math.round((region.w * dpi) / 72)), h: Math.max(1, Math.round((region.h * dpi) / 72)) };
  const base = join(work, 'sheet-region');
  await run('pdftoppm', regionArgs(pdf, base, px, dpi), { timeoutMs: PAGE_TIMEOUT_MS, isolate: true });
  const framed = join(work, 'sheet.png');
  await run('vips', frameArgs(`${base}.png`, framed, px), { timeoutMs: PAGE_TIMEOUT_MS, isolate: true, env: vipsEnv('pngload') });
  return framed;
}

// A printed first page cropped to its cells and drawn again at full size, or
// null when its cells fill the page (or it's blank).
async function cellsOf(pdf, pagePng, work) {
  const env = vipsEnv('pngload');
  const opts = { timeoutMs: PAGE_TIMEOUT_MS, isolate: true, env };
  const dim = async (f) => Number((await run('vipsheader', ['-f', f, pagePng], opts)).toString().trim());
  const page = { w: await dim('width'), h: await dim('height') };
  const trim = trimOf(await run('vips', ['find_trim', pagePng, '--threshold', '12', '--background', '255'], opts));
  const crop = trim && page.w > 0 && page.h > 0 ? trimCrop(trim, page) : null;
  if (!crop) return null;
  const base = join(work, 'cells');
  await run('pdftoppm', cropArgs(pdf, base, crop, page), { timeoutMs: PAGE_TIMEOUT_MS, isolate: true });
  return `${base}.png`;
}
```

Update the header comment's first paragraph: "… and poppler's pdftoppm draws the PDF's first page as the picture its view is made of; a spreadsheet's is its first sheet's cells (sheetPicture, cellsOf)."

- [ ] **Step 6: `view.js` passes the family and reports the picture**

```js
import { DOC_MAX_BYTES, VIEW_EDGE, VIEW_SM_EDGE, VIEW_MAX_BYTES, VIEW_MAX_PIXELS, docFamily, extOfKey } from '../../boards/src/lib/fileView.js';
…
  if (decoder === 'doc') {
    if (!sniffDoc(head)) throw new Refused('unsupported', 'not a document');
    const doc = await docPages(src, dirs, { refuse, sheet: docFamily(extOfKey(src)) === 'sheet' });
    const made = await makeViews(doc.pagePath, dirs, { loaders: ['pngload'] });
    return { ...made, original: null, via: 'libreoffice', picture: doc.picture, pdfPath: doc.pdfPath, pages: doc.pages };
  }
```

and in `processView`:

```js
      : { loader: made.loader, via: made.via, pages: made.pages ?? null, ...(made.picture ? { picture: made.picture } : {}) };
```

- [ ] **Step 7: All converter tests**

Run: `node --test media/test/*.mjs`
Expected: all pass (50 before, more now).

- [ ] **Step 8: Lab run** (local Docker, never Fly first)

```sh
export PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH
# in: the six docmock samples + twosheets.xlsx, long.xlsx, wide.xlsx
docker run --rm --cap-add SYS_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  -v <in>:/in:ro -v <out>:/out -v <scratchpad>/boxlab/bin:/b:ro \
  -v <W>/media/src:/app/media/src:ro -v <W>/boards/src/lib/fileView.js:/app/boards/src/lib/fileView.js:ro \
  --entrypoint sh soleil-media:p3 /b/run.sh
```

Expected in `results.txt`:
- every row `done`;
- `picture` is `sheet` for the shot list, the budget, twosheets and wide, `cells` for long, `page` for the rest;
- no STRAY lines.

Look at every sheet's `.view` (open the WebP): all seven shot-list columns, white margins, and a deeper bottom margin.

- [ ] **Step 9: Commit** (media/ only)

- [ ] **Step 10: Deploy the box and check it on Fly**

`sh media/deploy.sh` from W, then wake the box with `curl https://soleil-media.fly.dev/healthz`. Re-queue the QA workspace's spreadsheets with `p_force`:

```sql
select public._file_view_request(storage_path, 'doc', null, true) from public.images
 where workspace_id = '348f7064-3eea-4988-ba32-1a37535cd3a8' and storage_path ~* '\.(xlsx|xls|ods|numbers)$' and deleted_at is null;
```

Then poll `file_views` until those rows are `done`, and check `probe->>'picture'`.

---

### Task 3: New documents land at their family's size

**Files:**
- Modify: `boards/src/lib/fileIngest.js` (the last `return` of `classifyDropFile`, and its comment)
- Modify: `boards/src/components/CanvasSurface.jsx` (`optimisticDropFile`, `const w = 240, h = 150;`)
- Modify: `boards/src/lib/fileShareSave.js` (`savedCard`'s file size)
- Test: `boards/src/lib/fileIngest.test.mjs`, `boards/src/lib/fileShareSave.test.mjs`

**Interfaces:**
- Consumes: `docDropSize`, `extOfKey` (Task 1).

- [ ] **Step 1: Failing tests**

```js
// fileIngest.test.mjs
test("a document lands at its family's size, any other file at a file card's", () => {
  const c = (name, type = '') => classifyDropFile({ name, type, size: 1000 });
  assert.deepEqual([c('Pitch.pptx').w, c('Pitch.pptx').h], [400, 225]);
  assert.deepEqual([c('Festival.key').w, c('Festival.key').h], [400, 225]);
  assert.deepEqual([c('Budget.xlsx').w, c('Budget.xlsx').h], [300, 388]);
  assert.deepEqual([c('Treatment.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').w, c('Treatment.docx').h], [300, 388]);
  assert.deepEqual([c('selects.zip').w, c('selects.zip').h], [240, 150]);
  assert.equal(c('Pitch.pptx').route, 'file');
});
```

For `fileShareSave.test.mjs`: read `savedCard` first and match its call shape. Assert that a saved `.pptx` file card is 400×225 and a `.zip` stays 240×150. The existing `SAVED_CARD_DIMS` deep-equals-`FALLBACK_DIMS` assertion stays as it is.

- [ ] **Step 2: Run them to see them fail** (`node --test src/lib/fileIngest.test.mjs src/lib/fileShareSave.test.mjs`)

- [ ] **Step 3: Implement**

`fileIngest.js` (import `docDropSize`, `extOfKey` from `./fileView.js`, beside the existing `viewKindOfKey` import):

```js
  // PDFs over the inline cap + every other type → downloadable file card. A
  // document lands at a page's or a slide's size, the shape its first page
  // will give it (lib/fileView.js docDropSize).
  return { route: 'file', kind: 'file', ...(docDropSize(extOfKey(name)) || FALLBACK_DIMS.file) };
```

`CanvasSurface.jsx` `optimisticDropFile`: move `const ext = …` above the size, then

```js
    const ext = (file.name?.split('.').pop() || '').toLowerCase();
    // A document lands at its first page's family shape (lib/fileView.js).
    const { w, h } = docDropSize(ext) || { w: 240, h: 150 };
```

(import `docDropSize` from `../lib/fileView.js`; CanvasSurface may already import from it, so extend that import).

`fileShareSave.js`: where the file card's size is taken from `SAVED_CARD_DIMS.file`, use `docDropSize(extOfKey(<the saved file's name or key>)) || SAVED_CARD_DIMS.file`.

- [ ] **Step 4: Run them to see them pass**, plus `npm test`.

- [ ] **Step 5: Commit**

---

### Task 4: The editors' pass gives a document its page's shape and its count

**Files:**
- Modify: `boards/src/lib/fileViewClient.js` (`VIEW_COLS`, `viewFileCardPatch`, new `noPageCardPatch`, constants)
- Modify: `boards/src/lib/fileViewWork.js` (`viewPass` `writeCards`, the failed-row branch, comments)
- Modify: `boards/src/hooks/useFileViewBackfill.js` (the targets filter)
- Test: `boards/src/lib/fileViewClient.test.mjs`

**Interfaces:**
- Consumes: `docDropSize`, `extOfKey`, `DOC_DROP_PAGE`, `DOC_DROP_SLIDE`, `viewKindOfKey` (Task 1).
- Produces: `viewFileCardPatch(card, size, pages = 0)`, `noPageCardPatch(card) → {} | {w:240,h:150}`, `VIEW_COLS` including `page_count`.

- [ ] **Step 1: Failing tests** (replace the old "`{}` for a document" assertion)

```js
const doc = (over = {}) => ({ id: 'd', kind: 'file', fileSrc: 'r2:ws/b/Treatment.docx', w: 300, h: 388, ...over });
const deck = (over = {}) => ({ id: 'k', kind: 'file', fileSrc: 'r2:ws/b/Pitch.pptx', w: 400, h: 225, ...over });
const sheet = (over = {}) => ({ id: 's', kind: 'file', fileSrc: 'r2:ws/b/Shots.xlsx', w: 300, h: 388, ...over });

test("a document's card still at the size it landed at takes its page's shape, and learns its count", () => {
  // A Letter page is the page size already: only the count.
  assert.deepEqual(viewFileCardPatch(doc(), { w: 1583, h: 2048 }, 1), { pageCount: 1 });
  // An A4 page stands a little taller.
  assert.deepEqual(viewFileCardPatch(doc(), { w: 1449, h: 2048 }, 3), { pageCount: 3, w: 300, h: 424 });
  // A wide sheet lies down, 400 wide, as a slide.
  assert.deepEqual(viewFileCardPatch(sheet(), { w: 1974, h: 939 }, 2), { pageCount: 2, w: 400, h: 190 });
  // A 16:9 deck is the slide size already; a 4:3 one grows taller.
  assert.deepEqual(viewFileCardPatch(deck(), { w: 2048, h: 1152 }, 12), { pageCount: 12 });
  assert.deepEqual(viewFileCardPatch(deck(), { w: 2048, h: 1536 }, 12), { pageCount: 12, w: 400, h: 300 });
});

test('a document card placed before pages showed, or resized, keeps its size', () => {
  assert.deepEqual(viewFileCardPatch(doc({ w: 240, h: 150 }), { w: 1449, h: 2048 }, 3), { pageCount: 3 });
  assert.deepEqual(viewFileCardPatch(doc({ w: 320, h: 410 }), { w: 1449, h: 2048 }, 3), { pageCount: 3 });
  assert.deepEqual(viewFileCardPatch(doc({ pageCount: 3 }), { w: 1583, h: 2048 }, 3), {});
  assert.deepEqual(viewFileCardPatch(doc({ pending: true }), { w: 1449, h: 2048 }, 3), {});
  assert.deepEqual(viewFileCardPatch(doc(), { w: 0, h: 0 }, 0), {});
});

test('a document with no page coming goes back to a file card, if it is still the size it landed at', () => {
  assert.deepEqual(noPageCardPatch(doc()), { w: 240, h: 150 });
  assert.deepEqual(noPageCardPatch(deck()), { w: 240, h: 150 });
  assert.deepEqual(noPageCardPatch(doc({ w: 240, h: 150 })), {});
  assert.deepEqual(noPageCardPatch(doc({ w: 500, h: 640 })), {});
  assert.deepEqual(noPageCardPatch({ kind: 'file', fileSrc: 'r2:ws/b/a.zip', w: 300, h: 388 }), {});
  assert.deepEqual(noPageCardPatch({ kind: 'image', src: 'r2:ws/b/a.heic', w: 300, h: 388 }), {});
});

test('the view columns carry the PDF’s number of pages', () => {
  assert.ok(VIEW_COLS.split(',').includes('page_count'));
});
```

- [ ] **Step 2: Run them to see them fail** (`node --test src/lib/fileViewClient.test.mjs`)

- [ ] **Step 3: Implement in `fileViewClient.js`**

- `VIEW_COLS` gets `,page_count` at the end.
- Import `docDropSize, extOfKey, DOC_DROP_PAGE, DOC_DROP_SLIDE, viewKindOfKey` from `./fileView.js`, beside `turnsIntoPicture`.
- Add `const FILE_CARD_H = 150;` beside `FILE_CARD_W`.

```js
// The document a file card holds (its key), or ''.
function docKeyOf(card) {
  if (!card || card.kind !== 'file' || card.pending || typeof card.fileSrc !== 'string' || !card.fileSrc.startsWith('r2:')) return '';
  const key = card.fileSrc.slice(3);
  return viewKindOfKey(key) === 'doc' ? key : '';
}
const atSize = (card, s) => Math.abs((Number(card.w) || 0) - s.w) <= 1 && Math.abs((Number(card.h) || 0) - s.h) <= 1;

// What a document's first page writes onto its file card: the PDF's number
// of pages (`pages`), which its strip shows, and, while the card is still the
// size it landed at (fileView.js docDropSize), the page's shape: 300 wide
// standing up, as a PDF card, 400 lying down, as a slide. A card placed
// before pages showed (a file card's 240×150) or resized keeps its size, and
// the page fills it from the top.
function docCardPatch(card, size, pages) {
  const key = docKeyOf(card);
  if (!key) return {};
  const patch = {};
  if (pages > 0 && card.pageCount !== pages) patch.pageCount = pages;
  const drop = docDropSize(extOfKey(key));
  const w = num(size?.w);
  const h = num(size?.h);
  if (drop && atSize(card, drop) && w && h) {
    const next = shapeAt(w >= h ? DOC_DROP_SLIDE.w : DOC_DROP_PAGE.w, w, h);
    if (Math.abs(next.w - card.w) > 2 || Math.abs(next.h - card.h) > 2) Object.assign(patch, next);
  }
  return patch;
}
```

`viewFileCardPatch` becomes:

```js
export function viewFileCardPatch(card, size, pages = 0) {
  if (docKeyOf(card)) return docCardPatch(card, size, pages);
  if (!turnsIntoPicture(card)) return {};
  … (unchanged)
}

// A document that won't get a first page (a password, damage, too big): a
// card still the size it landed at goes back to a file card's.
export function noPageCardPatch(card) {
  const key = docKeyOf(card);
  const drop = key ? docDropSize(extOfKey(key)) : null;
  return drop && atSize(card, drop) ? { w: FILE_CARD_W, h: FILE_CARD_H } : {};
}
```

Rewrite the comment above `viewFileCardPatch`: "… {} for a card that stays a file card (fileView.js turnsIntoPicture), except a document's, which takes its first page's shape and count (docCardPatch)."

- [ ] **Step 4: `fileViewWork.js` `viewPass`**

- In `writeCards`, pass the count: `viewFileCardPatch(c, size, row?.page_count || 0)`.
- Add, beside `writeCards`:

```js
  // A document that won't get a page: its cards go back to a file card's size.
  const writeNoPage = (key) => {
    const ref = `r2:${key}`;
    for (const c of cardsNow() || []) {
      const patch = c.kind === 'file' && c.fileSrc === ref ? noPageCardPatch(c) : {};
      if (Object.keys(patch).length) write(c.id, patch);
    }
  };
```

- In the `else if (row)` branch, before `settled.add(key)`: `if (row.state === 'failed') writeNoPage(key);`.
- Import `noPageCardPatch`.
- Update the `viewPass` comment: "… a file card holding a photo turns into its picture card, and a document's card takes its page's shape while it's the size it landed at, learns its number of pages, and goes back to a file card's size when no page will come."

- [ ] **Step 5: `useFileViewBackfill.js` targets.** Find the filter `turnsIntoPicture(c) || !getMeta(key)?.previewKey` and add the documents with no count:

```js
… || (viewKindOfKey(key) === 'doc' && !(c.pageCount > 0))
```

(import `viewKindOfKey` from `../lib/fileView.js`; the comment says a document's card is also a target until it knows its pages, so a page made while no editor had the board open still gives the card its shape and count).

- [ ] **Step 6: Run** `node --test src/lib/fileViewClient.test.mjs src/lib/mediaBackfillHooks.test.mjs && npm test`. Expected: all pass.

- [ ] **Step 7: Commit**

---

### Task 5: The card face

**Files:**
- Modify: `boards/src/components/R2Image.jsx` (Progressive's two placeholder returns, Basic's destructure)
- Modify: `boards/src/components/cards/FileCard.jsx`, `boards/src/components/cards/fileCard.css`
- Modify: `boards/src/lib/icons.js`
- Modify: `boards/src/components/CanvasSurface.jsx` (the `<FileCard` mount at ~11515)

**Interfaces:**
- Produces: `R2Image` prop `placeholder: (state: 'idle'|'making'|'none') => node`; `FileCard` props `w, h, boardId, cardId, pageCount`; `iconForFile` family glyphs.

- [ ] **Step 1: `R2Image` placeholder**

Progressive: add `placeholder = null` to its props. Then:

```js
  if (unavailable) {
    if (placeholder) return <div ref={rootRef} className={`r2p ${className || ''}`} style={style} {...rest}>{placeholder('none')}</div>;
    return <UnavailablePlaceholder …unchanged />;
  }
  if (awaitingView || blockOriginal) {
    return (
      <div ref={rootRef} className={`r2p ${className || ''}`} style={style} {...rest}>
        {placeholder ? placeholder(awaitingView ? 'making' : 'idle') : <div className="r2p-layer r2-img-loading" />}
      </div>
    );
  }
```

Comment at the prop: "`placeholder(state)` draws what stands in for a picture that isn't there: 'idle' until the file's meta says whether a view is coming, 'making' while one is made, 'none' when none will come. Without it, the shimmer and 'Preview not available'. A document's file card passes its glyph." Basic: add `placeholder` to the destructured, ignored props.

- [ ] **Step 2: icons.** In `icons.js`, next to `FileDoc`, add `FilePpt, FileXls, Presentation,` in the existing order and format.

- [ ] **Step 3: `FileCard.jsx`**

Imports: `R2Image` from `'../R2Image.jsx'`; `viewKindOfKey, docFamily, extOfKey` from `'../../lib/fileView.js'`; add `FilePpt, FileXls, Presentation, Table` to the icons import.

`iconForFile`: replace the `csv|tsv|xls|xlsx|numbers|parquet` and `doc|docx|pages|rtf|odt` lines with:

```js
  // A document wears its family's glyph: Excel's, PowerPoint's and Word's
  // own, a sheet's and a deck's for the rest.
  if (/^(xls|xlsx|xlsm|xlsb|xlt|xltx|xltm)$/.test(e)) return FileXls;
  if (/^(ppt|pptx|pptm|pps|ppsx|ppsm|pot|potx|potm)$/.test(e)) return FilePpt;
  if (/^(numbers|ods|ots|sxc)$/.test(e)) return Table;
  if (/^(key|odp|otp|sxi)$/.test(e)) return Presentation;
  if (/^(csv|tsv|parquet)$/.test(e)) return Database;
  if (/^(doc|docx|docm|dot|dotx|dotm|pages|rtf|odt|ott|wpd|wps|sxw)$/.test(e)) return FileDoc;
```

The signature gains `w, h, boardId = null, cardId = null, pageCount = null`. In the body, after `sizeText`:

```js
  // A document shows its first page (lib/fileView.js), as a PDF card shows
  // its: the page fills the card from its top (a sheet's cells from their top
  // left), so a card placed before pages showed, still a file card's shape,
  // shows the page's top. Until the page is made the card is its glyph,
  // saying so while it's being made; one that won't get a page stays its
  // glyph. Its strip counts its pages (slides, for a deck) once it knows them.
  const docKey = !pending && typeof fileSrc === 'string' && fileSrc.startsWith('r2:')
    && viewKindOfKey(fileSrc.slice(3)) === 'doc' ? fileSrc.slice(3) : '';
  const family = docKey ? docFamily(extOfKey(docKey)) : null;
  const pages = Number(pageCount) > 0 ? Number(pageCount) : 0;
  const metaText = docKey && pages
    ? `${pages} ${family === 'slides' ? (pages === 1 ? 'slide' : 'slides') : (pages === 1 ? 'page' : 'pages')}`
    : sizeText;
  const docPlaceholder = (state) => (
    <div className={`filec-glyph${state === 'making' ? ' is-making' : ''}`}>
      <Icon as={GlyphIcon} size={42} />
      {state === 'making' && <span className="filec-making">Making a preview…</span>}
    </div>
  );
```

The body's first child becomes:

```jsx
        {docKey ? (
          <R2Image progressive src={fileSrc} alt={label} w={w} h={h} boardId={boardId} cardId={cardId}
                   className={`filec-page${family === 'sheet' ? ' is-sheet' : ''}`} draggable="false"
                   placeholder={docPlaceholder} />
        ) : preview != null ? (
          <pre className={`filec-preview ${CODE_EXTS.has(e) ? 'is-code' : ''}`}>{preview}</pre>
        ) : (
          // Uploading, the spinner stands alone on the card.
          <div className="filec-glyph">{!pending && <Icon as={GlyphIcon} size={42} />}</div>
        )}
```

The strip's size span shows `metaText` (`{metaText && <span className="filec-info-size">{metaText}</span>}`).

- [ ] **Step 4: `fileCard.css`** (append)

```css
/* A document's first page (FileCard's R2Image): white paper filling the
   card from its top, a sheet's cells from their top left. */
.filec .filec-page { position: absolute; inset: 0; background: #fff; }
.filec .filec-page .r2p-img { object-fit: cover; object-position: center top; }
.filec .filec-page.is-sheet .r2p-img { object-position: left top; }
/* Its glyph stands in on the card's own ground until the page is made. */
.filec .filec-page > .filec-glyph { position: absolute; inset: 0; }
.filec-glyph.is-making { flex-direction: column; gap: 10px; }
/* Said only when the page takes a while: a quick answer never flashes it. */
.filec-making { font-size: 11px; color: var(--ink-2); opacity: 0; animation: filec-making-in .2s ease-out .8s forwards; }
@keyframes filec-making-in { to { opacity: 1; } }

/* Uploading in the light theme: the card isn't greyed, and the spinner reads
   on it. */
[data-theme="light"] .filec .ic-upload-overlay { background: transparent; }
[data-theme="light"] .filec .ic-upload-overlay .spinner-on-dark { border-color: var(--line-2); border-top-color: var(--soleil); }
[data-theme="light"] .filec .ic-upload-progress { color: var(--ink-2); text-shadow: none; }
```

Before writing, read the `.r2p`, `.r2p-img`, `.r2p-layer` rules in `styles.css`. If `.r2p-img` doesn't fill its box, add `width: 100%; height: 100%` to `.filec .filec-page .r2p-img`. Check every `var()` against `cssTokens.test`.

- [ ] **Step 5: The mount** in `CanvasSurface.jsx` (~11515): add `w={Math.round(c.w)} h={Math.round(c.h)} boardId={board.id} pageCount={c.pageCount}`. `cardId={c.id}` is already passed.

- [ ] **Step 6: `npm test`** (cssTokens, stylesheetNesting, and the source pins included). Expected: pass.

- [ ] **Step 7: Commit**

---

### Task 6: The page wherever a file's picture goes

**Files:**
- Modify: `boards/src/lib/listItem.js` (`case 'file'`)
- Modify: `boards/src/components/clusterBrowser/CardPreview.jsx`, `ClusterRow.jsx` (the `glyphOnly` test)
- Modify: `boards/src/components/sidebar/ClusterShelves.jsx` (`ItemGlyph`)
- Test: `boards/tests/list-item-logic.spec.js` or a node test if `listItem.js` has one (`src/lib/listItem.test.mjs` exists: use it)

- [ ] **Step 1: Failing test** (`listItem.test.mjs`): a docx file card's item has `preview.page === card.fileSrc`, and a zip's has no `page`. Match the file's existing builder call (`toListItem(card)` or whatever it exports).

- [ ] **Step 2: `listItem.js`**

```js
      // A document's first page, once made, is its picture (CardPreview).
      item.preview = {
        mode: 'file', ext: card.ext, mime: card.mime, kind,
        ...(typeof card.fileSrc === 'string' && card.fileSrc.startsWith('r2:') && viewKindOfKey(card.fileSrc.slice(3)) === 'doc'
          ? { page: card.fileSrc } : {}),
      };
```

- [ ] **Step 3: `CardPreview.jsx`.** The meta hook reads the page too:

```js
  const meta = useImageMeta(p.mode === 'r2' ? p.src : p.mode === 'file' ? p.page : null);
```

Then at the top of the `p.mode === 'file'` branch:

```js
    // A document whose first page is made shows the page, its top in the
    // tile's shape, as its card does on the canvas.
    if (p.page && meta?.previewKey) {
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const src = tileImageSrc(p.page, meta, displayPx * dpr);
      return <R2Image key={src} src={src} alt="" className="cbp-img cbp-page" draggable="false" w={displayPx} h={displayPx} />;
    }
```

Add `.cbp-img.cbp-page { object-position: center top; }` (or `.cbp-page img` if R2Image Basic puts the class on a wrapper) next to the `.cbp-img` rule, wherever it lives.

- [ ] **Step 4: `ClusterRow.jsx`.** `glyphOnly` must not hide a document that has a page: add `&& !item.preview?.page` to its condition. CardPreview then draws the page, or `.cbp-file` until there is one.

- [ ] **Step 5: `ClusterShelves.jsx` `ItemGlyph`**

```js
// A document's first page, once it's made (lib/fileView.js): its small view,
// as the row's thumb.
function useDocThumb(item) {
  const ref = item.kind === 'file' ? item.meta?.fileSrc : null;
  const key = typeof ref === 'string' && ref.startsWith('r2:') && viewKindOfKey(ref.slice(3)) === 'doc' ? ref.slice(3) : null;
  const [, bump] = useState(0);
  useEffect(() => (key ? subscribeMeta(key, () => bump((n) => n + 1)) : undefined), [key]);
  const m = key ? getMeta(key) : null;
  const view = m?.previewSmKey || m?.previewKey;
  return view ? `r2:${view}` : null;
}

function ItemGlyph({ item }) {
  const page = useDocThumb(item);
  const src = thumbSrc(item) || page;
  if (src) return <span className={`sbf-file-thumb${page && src === page ? ' is-page' : ''}`}><R2Image src={src} alt="" /></span>;
  …unchanged
}
```

In `clusterSidebar.css`, add `.sbf-file-thumb.is-page img { object-position: center top; }`, matching the selector the existing thumb rule uses.

- [ ] **Step 6: `npm test`**, then commit.

---

### Task 7: The face on the local board (Playwright) and side by side with the mockup

**Files:**
- Modify: `boards/src/local/LocalBoardsApp.jsx` (a DEV bridge beside `__soleilVideoLive`)
- Create: `boards/tests/doc-card-face.spec.js`
- Fixtures: copy the lab's views of the deck, the treatment and the shot list (PNG or WebP, under 200 KB each) to `boards/tests/fixtures/doc-pages/`

- [ ] **Step 1: The bridge** (same guard and shape as `__soleilVideoLive`)

```js
  // The same for files (the document card spec): a file card on any
  // fileSrc, an "r2:" key included, which local mode can't upload.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__soleilFileLive = {
      addFile: ({ x = 200, y = 200, w = 240, h = 150, ...rest } = {}) => {
        const id = rest.id || createId('file');
        addCard({ id, kind: 'file', x, y, w, h, ...rest });
        return id;
      },
    };
    return () => { delete window.__soleilFileLive; };
  });
```

- [ ] **Step 2: The spec.** It runs on `?local=1&reset=1&blank=1`, with its own `PW_PORT` and private Vite `cacheDir`. In the page:
- `const r2 = await import('/src/lib/r2.js'); r2.setReadUrlResolver((key) => MAP[key] || null)`, where MAP sends the preview keys to the fixtures' URLs (`/tests/fixtures/...` won't be served, so read them in Node and pass them as `data:` URLs).
- `const im = await import('/src/lib/imageMeta.js'); im.setMetaLocal('qa/Pitch.pptx', { previewKey: 'qa/previews/Pitch.pptx.view.webp', previewW: 2048, previewH: 1152, previewSmKey: 'qa/previews/Pitch.pptx.view_sm.webp', previewSmW: 640, previewSmH: 360, checked: true })`, and the same for the treatment and the shot list.
- Add three cards through `__soleilFileLive.addFile`: `fileSrc: 'r2:qa/Pitch.pptx'` at 400×225 with `pageCount: 12`, the treatment at 300×388, the shot list at 400×190. Add a fourth, `fileSrc: 'r2:qa/Old treatment.docx'` at 240×150, with meta pointing at the treatment's page.

Assertions:
1. Each doc card has an `img.r2p-img` inside `.filec-page`.
2. The deck's strip says `12 slides`.
3. The 240×150 card's img has `object-position` `50% 0%`.
4. A docx with no meta and no converter (local) ends with `.filec-glyph` and no "Preview not available".
5. A `.zip` card at 240×150 has no `.filec-page`.
6. Light theme (`document.documentElement.dataset.theme = 'light'`): the doc page's background stays white.

Screenshot the board, dark and light, for Step 3.

- [ ] **Step 3: Side by side with the picked mockup.** Shoot the same cards at 0.8 zoom in both themes and compare against the mockup stills `<scratchpad>/docmock/shots/board-A-{dark,light}.jpg`: the strip, radius, page fill, glyph state and making note. Fix differences in CSS before committing.

- [ ] **Step 4: Run the spec, then the suites that must stay green:**

```sh
npx playwright test tests/doc-card-face.spec.js tests/file-card-download.spec.js tests/list-item-logic.spec.js tests/pdf.spec.js tests/files-audit.spec.js --project=desktop-chrome
```

- [ ] **Step 5: Commit**

---

### Task 8: Public docs

**Files:**
- Modify: `boards/content/docs/files/index.md` (the frontmatter `answer`, the FAQ `a:`, the table row, the documents paragraph, `updated`)
- Check: `boards/content/docs/canvas/images.md`, `boards/content/docs/files/pdf.md` (lines that say every other file is an icon card)

- [ ] **Step 1:** grep `src/lib/seoProbeContract.js` for each sentence about to change, so no probe asserts on it. If one does, update that row too and name it in the commit.

- [ ] **Step 2: Edits**
- `answer:` → "… Images (camera raws and Photoshop documents included), video, audio and PDFs get real players and viewers; Word, PowerPoint, Excel and other documents show their first page; everything else — a .fig, a .zip, a project file — becomes a file card with a type icon and a download, on every plan. …"
- The table row → `| Document (Word, PowerPoint, Excel, Keynote, Pages, Numbers, OpenDocument, RTF) | A card showing its first page, opening on all its pages |`
- The paragraph:

```md
A document's card shows its first page, as a [PDF](/docs/files/pdf)'s does, and
opens on its pages, which page through the same way. A spreadsheet's card shows
its first sheet. The page is made once, in the background, so a new document's
card takes a few seconds to show it: the first {{fact:docMaxPages}} pages of a
document up to {{fact:docMaxSize}}. A document with a password, or one that's
damaged, stays a file card, with the download.
```

- `updated: 2026-10-27`

- [ ] **Step 3:** `npm run docs:build && npm run docs:check && npm test`. Expected: clean. If `docsite.test.mjs` names a moved surface, update its page; `docs:accept` only after that.

- [ ] **Step 4: Commit** with Task 5/6's last change if they're pending, or on its own.

---

### Task 9: Budget, verification, push

- [ ] **Step 1: Build and measure**

```sh
cd boards && VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=ci-budget-key VITE_SUPABASE_ANON_KEY=ci-budget-key npx vite build --outDir <scratchpad>/dist-docface && node scripts/bundleBudget.mjs <scratchpad>/dist-docface
```

If appJs is over 687.0 KB, set `CEILINGS.appJs` to the measured figure plus 0.6 KB, which is the file's convention. Give the reason in its comment and the commit: the document page face, family glyphs, and the placeholder hook. The shared node_modules reads about 0.6 KB low, so compare against CI's number after the push.

- [ ] **Step 2: Everything green.** Run `npm test`, `npm run docs:check`, the Task 7 Playwright set, and `node --test media/test/*.mjs`.

- [ ] **Step 3: Push.** `git fetch && git rebase origin/main && git push origin HEAD:refs/heads/main`, then watch CI (`gh run list --branch main --limit 3`).

- [ ] **Step 4: On preview.** In the QA workspace, the re-queued docs' rows hold `page_count` and `probe->>'picture'`. Confirm with SQL that `page_count` is filled for every `done` doc.
