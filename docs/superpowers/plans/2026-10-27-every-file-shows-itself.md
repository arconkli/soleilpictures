# Every File Shows Itself (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every file a cluster holds shows what it is, on its card and in Quick look: text and code as white pages, tables as tables, subtitles as cues, fonts as specimen sheets, email as letters, design files as the picture saved inside them, a .zip as a contact sheet and any other archive as the names inside it. This is direction A, the owner's pick of 2026-10-27 (canvas https://claude.ai/artifact/PpYZNvXRviP3ZnzckggtN1).

**Architecture:** Two kinds of family.

- **Families the browser draws** (text, tables, subtitles, code, fonts, email):
  - The browser reads a capped head of the file over the signed R2 URL `resolveSrc()` already returns (one Range GET; R2's CORS allows any header).
  - It draws that head in two lazy chunks: `FamilyFace` on cards and in tiles, `FileStages` in Quick look. appJs does not grow.
- **Families the converter draws** (design files, zips, other archives):
  - They ride the Phase 1–3 view queue: two new view kinds, `'design'` and `'archive'`, in `lib/fileView.js`, plus a widened `_file_view_request`.
  - Converter jobs on the Fly box fetch only the byte ranges they need and make the same `view`/`view_sm` pictures a document gets.

A new drop lands at its family's shape through one `fileDropSize(ext, mime)`. A card placed before keeps its size.

**Tech Stack:**
- React 18 + Vite (lazy chunks)
- Cloudflare Worker
- Supabase Postgres (plpgsql, 0311 grants)
- The Node 20 converter on Fly (vips, bsdtar, pdftoppm; no npm deps)
- node:test and Playwright
- Existing deps markdown-it and DOMPurify; one new dep, postal-mime (Part C)

## Global Constraints

**Git and release**
- main = preview. Push `HEAD:refs/heads/main` after each task. Never promote to production.
- Work in the worktree `W=/private/tmp/claude-501/-Users-andrewconklin-soleilpictures-1/e16c071c-2296-46fb-895c-62aa6802710e/scratchpad/wt-pv`, detached at origin/main.
  - `git fetch && git rebase origin/main` before each push.
  - Commit by pathspec, own files only.
- Commit message:
  - one long plain sentence describing what users see;
  - trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - the repo is public, so no business metrics, revenue figures or user counts.

**Bundle**
- appJs sits at its ceiling.
- Every module that draws a family is reached only through a dynamic `import()`:
  - new chunk names go in `boards/scripts/bundleBudget.mjs` `LAZY_IN_APP`;
  - their paths go in `boards/tests/global-setup.js` `LAZY_MODULES`.
- A new Phosphor icon is imported only from a lazy module. vite `iconSplit` keeps it out of the boot set; each icon in the boot set costs ~0.7 KB.

**Public docs**
- The docs change in the same commit as the surface they describe: `boards/content/docs/files/index.md`.
- Numbers come only from `{{fact:…}}`, sourced in `boards/scripts/gen-docs.mjs` FACTS from the constants the code enforces.
- Then run `npm run docs:build` and `npm run docs:check`.
- Before rewording any `/docs/files` sentence, grep `src/lib/seoProbeContract.js` for it.

**House rules**
- Gold (`--soleil`) only for selection, focus and active. Resting icons are neutral ink.
- Dev harnesses sit behind the literal `import.meta.env.DEV`.
- Never `.catch()` a supabase rpc builder.

**Migrations**
- Take the next free number. 0707 is taken (`0707_keep_links_are_link_tokens.sql`), so re-check with `ls supabase/migrations | tail -1`.
- Follow the 0311 grants habit: revoke/grant, then a self-proving `do $$ … has_function_privilege … $$` block.
- Apply through the Supabase MCP `apply_migration`.

**Converter**
- No npm deps on the box.
- Every parser of a user's bytes runs in a child process under `run(…, { isolate: true })`.
- Deploy the box (`media/deploy.sh`) BEFORE pushing any app or Worker change that queues a new job kind.
- Never queue a real user's file as a test. Use only the QA workspace `348f7064-3eea-4988-ba32-1a37535cd3a8`.

**Untrusted content**
- File text, email HTML and names inside archives are untrusted:
  - never HTML without DOMPurify;
  - never script;
  - never a remote load without the viewer's click.
- No analytics event carries a file's text, the names inside it, or an email address (no profiling of board content).

**Read budgets**
- A card face reads at most `CARD_HEAD_BYTES` (64 KB) of a file.
- Quick look reads at most `TEXT_STAGE_MAX_BYTES` (2 MB).

**Before every commit**
- `cd boards && npm test` is green.
- Before every box change, `cd media && npm test`.

## File structure

**Part A: text pages**

| File | Responsibility |
|---|---|
| `boards/src/lib/fileView.js` (modify) | The families: `fileFamily`, `fileDropSize`, drop shapes; later parts add the design/archive view kinds |
| `boards/src/lib/fileFaceLimits.js` (new) | Every byte/row ceiling a drawn page obeys, for code and docs |
| `boards/src/lib/fileHead.js` (new) | `readHead` (capped Range read), `decodeText`, `looksBinary` |
| `boards/src/lib/textPages.js` (new) | `headLines`, `sniffSep`, `parseDelimited`, `parseCues` |
| `boards/src/components/cards/FamilyFace.jsx` + `familyFace.css` (new, lazy) | A card's page for each drawn family; `familyGlyph` for the strip |
| `boards/src/components/clusterBrowser/FileStages.jsx` + `fileStages.css` (new, lazy) | Quick look's stages for the drawn families |
| `FileCard.jsx`, `fileCard.css`, `CardPreview.jsx`, `listItem.js`, `QuickLook.jsx` (modify) | Wire the faces and stages in; delete the old small-text preview |

**Part B: fonts**

| File | Responsibility |
|---|---|
| `boards/src/lib/fontInfo.js` (new) | sfnt/TTC/WOFF name table: family, style, weight, licence |
| `boards/src/lib/fontLoad.js` (new) | Load a font file as a `FontFace`, once per src |

**Part C: email**

| File | Responsibility |
|---|---|
| `boards/src/lib/mailRead.js` (new) | .eml via postal-mime, and .msg via msgRead, into one letter shape |
| `boards/src/lib/msgRead.js` (new) | Outlook .msg: CFB container + MAPI properties |
| `boards/src/lib/fileActions.js` (new) | A small bus: Quick look asks App to put files on the board or unpack a zip |

**Part D: design files**

| File | Responsibility |
|---|---|
| `media/src/rangeFile.js` (new) | A sparse local copy that knows which byte ranges it holds |
| `media/src/zipPick.js` (new) | Which zip entry is a design file's picture; byte windows |
| `media/src/zipJob.js`, `zipMain.js` (new) | Read a remote zip in rounds of Range GETs (root) / parse it in a child |
| `media/src/design.js`, `designMain.js` (new) | Affinity, InDesign, EPS, Illustrator pictures |
| `supabase/migrations/07NN_file_views_design_archive.sql` (new) | `_file_view_request` accepts `'design'` and `'archive'` |

**Part E: archives**

| File | Responsibility |
|---|---|
| `boards/src/lib/archiveSheet.js` (new, shared with the box) | Tiles and rows from an archive's names: folders first, junk out |
| `media/src/sheet.js`, `listing.js` (new) | The contact sheet / listing SVG; `bsdtar -tv` parsing |
| `boards/src/lib/remoteBlob.js` (new) | A Blob-like over a signed URL, for `zipRead` in Quick look |
| `boards/src/components/clusterBrowser/ZipStage.jsx` (new, lazy) | Browse a zip, open a picture, Unpack into clusters |

---

## Part A: Text pages (txt, log, md, csv, tsv, srt, vtt, code)

What users see:
- A text file drops as a white page, 300×388.
  - A .csv or .tsv drops as a wide page, 400×236, with its rows as a table.
  - An .srt or .vtt shows numbered cues with timecodes.
  - Markdown is set as a document (headings, lists, quotes).
  - Code and logs are monospaced, exactly as the file has them.
- The name strip keeps its place, with the family's icon.
- Quick look shows:
  - text with line numbers, up to 2 MB, with a notice and "Download all of it" past that;
  - a .csv as a table with a header row and row numbers;
  - subtitles as cues.
- A card placed before keeps its size and shows the top of the page.
- The old small-text preview (whole file ≤256 KB, `.filec-preview`) is gone.

### Task A1: Families and drop shapes

**Files:**
- Modify: `boards/src/lib/fileView.js` (after `docDropSize`)
- Modify: `boards/src/lib/fileIngest.js:146`
- Modify: `boards/src/components/CanvasSurface.jsx:4` and `:4547-4548` (`optimisticDropFile`)
- Modify: `boards/src/lib/fileShareSave.js:74`
- Test: `boards/src/lib/fileView.test.mjs`, `boards/src/lib/fileIngest.test.mjs`

**Interfaces:**
- Produces:
  - `CODE_EXTS: string[]`, `FAMILY_EXTS: {markdown, table, subtitles, code, text}`, `DRAWN_FAMILIES: string[]`
  - `fileFamily(ext: string, mime?: string): 'doc'|'markdown'|'table'|'subtitles'|'code'|'text'|null`
  - `isDrawnFamily(family): boolean`
  - `TABLE_DROP = {w: 400, h: 236}`
  - `fileDropSize(ext, mime?): {w, h}|null`. Parts B–E extend it.

- [ ] **Step 1: Write the failing tests.** Append to `fileView.test.mjs` and add `fileFamily, fileDropSize, TABLE_DROP, DRAWN_FAMILIES, isDrawnFamily` to its import:

```js
test('a file\'s family comes from its extension, then its type; a video\'s type is never text', () => {
  assert.equal(fileFamily('md'), 'markdown');
  assert.equal(fileFamily('MARKDOWN'), 'markdown');
  assert.equal(fileFamily('csv'), 'table');
  assert.equal(fileFamily('tsv'), 'table');
  assert.equal(fileFamily('srt'), 'subtitles');
  assert.equal(fileFamily('vtt'), 'subtitles');
  assert.equal(fileFamily('py'), 'code');
  assert.equal(fileFamily('json'), 'code');
  assert.equal(fileFamily('log'), 'text');
  assert.equal(fileFamily('txt'), 'text');
  assert.equal(fileFamily('docx'), 'doc');
  assert.equal(fileFamily('', 'application/json'), 'code');
  assert.equal(fileFamily('', 'text/plain'), 'text');
  assert.equal(fileFamily('ts', 'video/mp2t'), null);
  assert.equal(fileFamily('zip'), null);
  assert.equal(fileFamily(''), null);
  assert.ok(DRAWN_FAMILIES.every(isDrawnFamily));
  assert.equal(isDrawnFamily('doc'), false);
});

test('a text file drops as a page, a table as a wide page, a document as before, anything else as nothing', () => {
  assert.deepEqual(fileDropSize('md'), DOC_DROP_PAGE);
  assert.deepEqual(fileDropSize('log'), DOC_DROP_PAGE);
  assert.deepEqual(fileDropSize('', 'text/plain'), DOC_DROP_PAGE);
  assert.deepEqual(fileDropSize('csv'), TABLE_DROP);
  assert.deepEqual(TABLE_DROP, { w: 400, h: 236 });
  assert.deepEqual(fileDropSize('pptx'), DOC_DROP_SLIDE);
  assert.deepEqual(fileDropSize('xlsx'), DOC_DROP_PAGE);
  assert.equal(fileDropSize('zip'), null);
  assert.equal(fileDropSize('bin', 'application/octet-stream'), null);
});
```

Then extend the test at `fileIngest.test.mjs:293`, and rename it to `"a document or a text file lands at its family's size, any other file at a file card's"`:

```js
  assert.deepEqual([c('Shot notes.md').w, c('Shot notes.md').h], [300, 388]);
  assert.deepEqual([c('Dailies log.txt', 'text/plain').w, c('Dailies log.txt', 'text/plain').h], [300, 388]);
  assert.deepEqual([c('Call times.csv', 'text/csv').w, c('Call times.csv', 'text/csv').h], [400, 236]);
  assert.deepEqual([c('README', 'text/plain').w, c('README', 'text/plain').h], [300, 388]);
```

- [ ] **Step 2: Run them and watch them fail.** Run `cd boards && node --test src/lib/fileView.test.mjs src/lib/fileIngest.test.mjs`. Expected: FAIL with `fileFamily is not a function` and the `.md` size `[240, 150]`.

- [ ] **Step 3: Implement.** In `fileView.js`, after `docDropSize`:

```js
// The families a card draws from what the file says (FamilyFace.jsx on a
// card, FileStages.jsx in Quick look), named by extension first, then by
// type for a file with none. A type of video, audio or image is never text:
// a .ts is a camera's as often as TypeScript, and a system that knows the
// camera's says video/mp2t.
export const CODE_EXTS = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'c', 'h', 'cpp', 'cc',
  'java', 'kt', 'swift', 'sh', 'bash', 'zsh', 'sql', 'css', 'scss', 'html', 'htm', 'xml', 'json', 'yml', 'yaml', 'toml'];
export const FAMILY_EXTS = Object.freeze({
  markdown: ['md', 'markdown', 'mdown', 'mkd'],
  table: ['csv', 'tsv'],
  subtitles: ['srt', 'vtt'],
  code: CODE_EXTS,
  text: ['txt', 'text', 'log', 'ini', 'env', 'conf', 'cfg', 'nfo'],
});
export const DRAWN_FAMILIES = Object.keys(FAMILY_EXTS);
const FAMILY_OF = new Map(DRAWN_FAMILIES.flatMap((family) => FAMILY_EXTS[family].map((e) => [e, family])));
export const isDrawnFamily = (family) => DRAWN_FAMILIES.includes(family);

export function fileFamily(ext, mime = '') {
  const e = String(ext || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  if (DOC_SET.has(e)) return 'doc';
  if (/^(video|audio|image)\//.test(m)) return null;
  const family = FAMILY_OF.get(e);
  if (family) return family;
  if (m === 'application/json' || m === 'application/xml') return 'code';
  return m.startsWith('text/') ? 'text' : null;
}

// A table is wider than it is tall; every other drawn page is a page.
export const TABLE_DROP = Object.freeze({ w: 400, h: 236 });

// The size a new file card lands at: its family's shape, so the card doesn't
// jump when its face arrives. Null: a file card's own 240 x 150.
export function fileDropSize(ext, mime = '') {
  const family = fileFamily(ext, mime);
  if (family === 'doc') return docDropSize(ext);
  if (family === 'table') return TABLE_DROP;
  return family ? DOC_DROP_PAGE : null;
}
```

Then switch the three callers:
- In `fileIngest.js:146`: `...(fileDropSize(extOfKey(name), type) || FALLBACK_DIMS.file)`. Swap the `docDropSize` import for `fileDropSize`.
- In `CanvasSurface.jsx` `optimisticDropFile`: `const { w, h } = fileDropSize(ext, file.type) || { w: 240, h: 150 };`. Swap the line-4 import the same way.
- In `fileShareSave.js:74`: `fileDropSize(extOfKey(srcKey), f.mime)`. Read the surrounding lines first and keep the variable it already passes the mime in. This file also runs in the Party worker, so it reaches shared-link saves with the next Party deploy, not with this push.
- Update the comment above line 146, from "A document lands at a page's or a slide's size" to "A document or a text file lands at its family's size".

- [ ] **Step 4: Run them and watch them pass.** Run `cd boards && npm test`. Expected: PASS. `fileView.test.mjs` already asserts `viewKindOfKey('a.txt') === null`, which stays true, since text is not a view kind.

- [ ] **Step 5: Commit and push.**

```bash
git add -- boards/src/lib/fileView.js boards/src/lib/fileView.test.mjs boards/src/lib/fileIngest.js boards/src/lib/fileIngest.test.mjs boards/src/components/CanvasSurface.jsx boards/src/lib/fileShareSave.js
git commit -m "A text file dropped on a board lands at a page's size (a .csv or .tsv at a wide page's), the shape its page will take, as a document already does; nothing draws the page yet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- boards/src/lib/fileView.js boards/src/lib/fileView.test.mjs boards/src/lib/fileIngest.js boards/src/lib/fileIngest.test.mjs boards/src/components/CanvasSurface.jsx boards/src/lib/fileShareSave.js
```

Do not push A1 alone: a page-sized card with the old glyph is worse than today. A1–A3 push together (see A3 Step 7).

### Task A2: Reading a head, decoding it, parsing it (pure)

**Files:**
- Create: `boards/src/lib/fileFaceLimits.js`, `boards/src/lib/fileHead.js`, `boards/src/lib/textPages.js`
- Test: `boards/src/lib/fileHead.test.mjs`, `boards/src/lib/textPages.test.mjs`

**Interfaces:**
- Produces:
  - `CARD_HEAD_BYTES = 65536`, `TEXT_STAGE_MAX_BYTES = 2097152`, `TABLE_STAGE_MAX_ROWS = 5000`. Parts B, C and E append their own constants here.
  - `readHead(url: string, max: number, {signal?, fetchImpl?, size?}): Promise<{bytes: Uint8Array, complete: boolean}>`
  - `looksBinary(bytes): boolean`
  - `decodeText(bytes, {complete?}): string|null` (null = not text)
  - `headLines(text, {max?, complete?}): string[]`
  - `sniffSep(text, ext): ',' | ';' | '\t'`
  - `parseDelimited(text, {sep, maxRows?, complete?}): {rows: string[][], more: boolean}`
  - `parseCues(text, {max?}): {n: string, start: string, end: string, text: string}[]`

- [ ] **Step 1: Write the failing tests.** `fileHead.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHead, decodeText, looksBinary } from './fileHead.js';

const enc = (s) => new TextEncoder().encode(s);
// A fetch that ignores Range and streams the whole body in 1 KB chunks,
// counting what it was asked for and how much was pulled.
function fakeFetch(body, { status = 200 } = {}) {
  const seen = { range: null, pulled: 0, cancelled: false };
  const impl = async (_url, init) => {
    seen.range = init?.headers?.Range ?? null;
    let at = 0;
    const stream = new ReadableStream({
      pull(c) {
        if (at >= body.length) { c.close(); return; }
        const chunk = body.subarray(at, at + 1024); at += chunk.length; seen.pulled = at; c.enqueue(chunk);
      },
      cancel() { seen.cancelled = true; },
    });
    return new Response(stream, { status });
  };
  return { impl, seen };
}

test('a head stops at its ceiling even when the server sends everything', async () => {
  const body = new Uint8Array(100 * 1024).fill(97);
  const { impl, seen } = fakeFetch(body);
  const { bytes, complete } = await readHead('u', 4096, { fetchImpl: impl });
  assert.equal(bytes.length, 4096);
  assert.equal(complete, false);
  assert.equal(seen.range, 'bytes=0-4095');
  assert.ok(seen.pulled <= 4096 + 1024, `pulled ${seen.pulled}`);
  assert.equal(seen.cancelled, true);
});

test('a small file is read whole, with no Range, and called complete', async () => {
  const { impl, seen } = fakeFetch(enc('hello\n'));
  const { bytes, complete } = await readHead('u', 4096, { fetchImpl: impl, size: 6 });
  assert.equal(new TextDecoder().decode(bytes), 'hello\n');
  assert.equal(complete, true);
  assert.equal(seen.range, null);
});

test('an empty file is complete without a request; a failed one throws', async () => {
  let asked = false;
  const r = await readHead('u', 10, { size: 0, fetchImpl: async () => { asked = true; } });
  assert.deepEqual([r.bytes.length, r.complete, asked], [0, true, false]);
  await assert.rejects(readHead('u', 10, { fetchImpl: fakeFetch(enc('x'), { status: 403 }).impl }));
});

test('text decodes with its BOM, a cut character is dropped, Windows-1252 still reads', () => {
  assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('café')])), 'café');
  assert.equal(decodeText(Uint8Array.from([0xff, 0xfe, 0x68, 0, 0x69, 0])), 'hi');
  assert.equal(decodeText(Uint8Array.from([...enc('ab'), 0xc3]), { complete: false }), 'ab');
  assert.equal(decodeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9])), 'café');
});

test('binary is not text: a NUL, or one byte in ten a control character', () => {
  assert.equal(looksBinary(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00])), true);
  assert.equal(looksBinary(enc('plain\ttext\r\n')), false);
  assert.equal(looksBinary(Uint8Array.from([1, 2, 3, 4, 5, 97, 98, 99, 100, 101])), true);
  assert.equal(decodeText(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])), null);
});
```

`textPages.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headLines, sniffSep, parseDelimited, parseCues } from './textPages.js';

test('lines: CRLF and CR read as LF, no phantom last line, a cut last line dropped', () => {
  assert.deepEqual(headLines('a\r\nb\rc\n'), ['a', 'b', 'c']);
  assert.deepEqual(headLines('a\nb\nhal', { complete: false }), ['a', 'b']);
  assert.deepEqual(headLines('one long cut line', { complete: false }), ['one long cut line']);
  assert.deepEqual(headLines('1\n2\n3\n4', { max: 2 }), ['1', '2']);
});

test('the separator: a tab for .tsv, else whichever of , ; or tab the first line has most of', () => {
  assert.equal(sniffSep('a\tb', 'tsv'), '\t');
  assert.equal(sniffSep('Name;Role;Call\nA;B;C', 'csv'), ';');
  assert.equal(sniffSep('Name,Role\nA,B', 'csv'), ',');
  assert.equal(sniffSep('"x;y",z', 'csv'), ',');
});

test('CSV: quotes, doubled quotes, newlines inside quotes, a cut last row dropped', () => {
  const { rows, more } = parseDelimited('Name,Note\n"Ellison, Mara","said ""go""\nthen left"\nPark,ok\nVo', { sep: ',', complete: false });
  assert.deepEqual(rows, [['Name', 'Note'], ['Ellison, Mara', 'said "go"\nthen left'], ['Park', 'ok']]);
  assert.equal(more, true);
  assert.deepEqual(parseDelimited('a,b\r\n1,2\r\n', { sep: ',' }), { rows: [['a', 'b'], ['1', '2']], more: false });
  assert.deepEqual(parseDelimited('a\n1\n2\n3', { sep: ',', maxRows: 2 }), { rows: [['a'], ['1']], more: true });
  assert.deepEqual(parseDelimited('a,b\n1,', { sep: ',' }).rows, [['a', 'b'], ['1', '']]);
});

test('cues from SRT and WebVTT: numbers, times, text without tags; headers and notes skipped', () => {
  const srt = '1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hello</i> there\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n{\\an8}Up top\r\nsecond line\r\n';
  assert.deepEqual(parseCues(srt), [
    { n: '1', start: '00:00:01,000', end: '00:00:03,500', text: 'Hello there' },
    { n: '2', start: '00:00:04,000', end: '00:00:05,000', text: 'Up top\nsecond line' },
  ]);
  const vtt = 'WEBVTT\n\nNOTE made by hand\n\nintro\n00:01.000 --> 00:02.000 align:start\nTom &amp; Jerry\n\n00:03.000 --> 00:04.000\n<v Mara>Go</v>\n';
  assert.deepEqual(parseCues(vtt), [
    { n: 'intro', start: '00:01.000', end: '00:02.000', text: 'Tom & Jerry' },
    { n: '2', start: '00:03.000', end: '00:04.000', text: 'Go' },
  ]);
  assert.equal(parseCues(srt, { max: 1 }).length, 1);
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `cd boards && node --test src/lib/fileHead.test.mjs src/lib/textPages.test.mjs`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** `fileFaceLimits.js`:

```js
// The most a page drawn from a file reads (FamilyFace on a card,
// FileStages in Quick look). The public docs quote these through
// scripts/gen-docs.mjs FACTS, so a number changes here or nowhere.
export const CARD_HEAD_BYTES = 64 * 1024;
export const TEXT_STAGE_MAX_BYTES = 2 * 1024 * 1024;
export const TABLE_STAGE_MAX_ROWS = 5000;
```

`fileHead.js`:

```js
// The first bytes of a stored file, for a page that draws what the file
// says. One GET with a Range (R2's CORS allows it), and the stream is
// cancelled at `max` even when a server answers with the whole file, so a
// 2 GB log costs a card 64 KB.

export async function readHead(url, max, { signal, fetchImpl = fetch, size } = {}) {
  if (size === 0) return { bytes: new Uint8Array(0), complete: true };
  const known = Number.isFinite(size) && size >= 0;
  const headers = known && size <= max ? undefined : { Range: `bytes=0-${max - 1}` };
  const res = await fetchImpl(url, { headers, signal });
  if (res.status === 416) return { bytes: new Uint8Array(0), complete: true };
  if (!res.ok) throw new Error(`head ${res.status}`);
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  let ended = false;
  while (got < max) {
    const { done, value } = await reader.read();
    if (done) { ended = true; break; }
    parts.push(value);
    got += value.byteLength;
  }
  if (!ended) reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(got, max));
  let at = 0;
  for (const p of parts) {
    const take = Math.min(p.byteLength, bytes.length - at);
    bytes.set(take === p.byteLength ? p : p.subarray(0, take), at);
    at += take;
    if (at >= bytes.length) break;
  }
  return { bytes, complete: known ? bytes.length >= size : ended };
}

// Binary, not text: a NUL anywhere in the first 4 KB, or more than one byte
// in ten a control character other than tab, LF, VT, FF or CR.
export function looksBinary(bytes) {
  const n = Math.min(bytes.length, 4096);
  let ctrl = 0;
  for (let i = 0; i < n; i += 1) {
    const b = bytes[i];
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) ctrl += 1;
  }
  return n > 0 && ctrl / n > 0.1;
}

// Text from a head: its BOM decides UTF-8 or UTF-16; a file that isn't
// valid UTF-8 is read as Windows-1252, as an old export usually is. A head
// cut mid-character drops that character instead of drawing a ?.
export function decodeText(bytes, { complete = true } = {}) {
  if (!bytes) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2), { stream: !complete });
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2), { stream: !complete });
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  if (looksBinary(body)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body, { stream: !complete });
  } catch {
    return new TextDecoder('windows-1252').decode(body);
  }
}
```

`textPages.js`:

```js
// Lines, tables and cues from the text of a file's head (lib/fileHead.js).
// When only a head was read (complete: false) a cut last line or row is
// dropped, never drawn half.

export function headLines(text, { max = Infinity, complete = true } = {}) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && !complete) lines.pop();
  else if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length > max ? lines.slice(0, max) : lines;
}

export function sniffSep(text, ext) {
  if (String(ext).toLowerCase() === 'tsv') return '\t';
  const first = String(text).split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
  const count = (ch) => first.split(ch).length - 1;
  const best = [',', ';', '\t'].reduce((a, b) => (count(b) > count(a) ? b : a));
  return count(best) ? best : ',';
}

// RFC 4180: a quoted field holds separators, newlines and doubled quotes.
export function parseDelimited(text, { sep = ',', maxRows = Infinity, complete = true } = {}) {
  const s = String(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i += 1; continue; }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i += 1; continue; }
    if (ch === sep) { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\n' || ch === '\r') {
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
      row.push(field); rows.push(row); row = []; field = '';
      if (rows.length >= maxRows) return { rows, more: !complete || /\S/.test(s.slice(i)) };
      continue;
    }
    field += ch; i += 1;
  }
  if (field !== '' || row.length) {
    if (complete) { row.push(field); rows.push(row); }
  }
  return { rows, more: !complete };
}

const TC = /((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})/;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&lrm;': '', '&rlm;': '', '&quot;': '"', '&#39;': "'" };

// SRT and WebVTT alike: a block is a cue when one of its lines is a timing
// line; the line above it (when there is one) is its number or id. WEBVTT,
// NOTE, STYLE and REGION blocks have no timing line and are skipped.
export function parseCues(text, { max = Infinity } = {}) {
  const blocks = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => TC.test(l));
    if (at < 0) continue;
    const [, start, end] = lines[at].match(TC);
    const n = at > 0 && lines[at - 1].trim() ? lines[at - 1].trim() : String(cues.length + 1);
    const body = lines.slice(at + 1).join('\n')
      .replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')
      .replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|#39);/g, (m) => ENTITIES[m])
      .trim();
    cues.push({ n, start, end, text: body });
    if (cues.length >= max) break;
  }
  return cues;
}
```

- [ ] **Step 4: Run them and watch them pass.** Run `cd boards && node --test src/lib/fileHead.test.mjs src/lib/textPages.test.mjs`. Expected: PASS. If the Windows-1252 case fails under Node, check `node -p "new TextDecoder('windows-1252').encoding"` prints `windows-1252` (Node 20 ships full ICU).

- [ ] **Step 5: Commit.** Commit, but don't push yet (it rides with A3):

```bash
git add -- boards/src/lib/fileFaceLimits.js boards/src/lib/fileHead.js boards/src/lib/textPages.js boards/src/lib/fileHead.test.mjs boards/src/lib/textPages.test.mjs
git commit -m "The pieces a drawn page reads with: a file's first bytes over one capped Range read, decoded as UTF-8, UTF-16 or Windows-1252 and refused when they're binary, then lines, CSV rows and subtitle cues from them (nothing visible yet)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- boards/src/lib/fileFaceLimits.js boards/src/lib/fileHead.js boards/src/lib/textPages.js boards/src/lib/fileHead.test.mjs boards/src/lib/textPages.test.mjs
```

### Task A3: The card's page (FamilyFace), and the old preview goes

**Files:**
- Create: `boards/src/components/cards/FamilyFace.jsx`, `boards/src/components/cards/familyFace.css`
- Modify: `boards/src/components/cards/FileCard.jsx` (imports; `iconForFile`; delete `TEXT_PREVIEW_*`, `CODE_EXTS`, `TEXT_EXTS` and the preview effect at ~110-128; the body JSX)
- Modify: `boards/src/components/cards/fileCard.css` (delete `.filec-preview*`)
- Modify: `boards/src/lib/icons.js` (add `FileMd`, `FileTxt`, `FileCsv`, `Subtitles`)
- Modify: `boards/scripts/bundleBudget.mjs` (`LAZY_IN_APP` += `'FamilyFace'`)
- Modify: `boards/tests/global-setup.js` (`LAZY_MODULES` += `'components/cards/FamilyFace.jsx'`)
- Modify: `boards/content/docs/files/index.md` (the table row for text; delete "Small text files get an inline preview on the card rather than only a download.")
- Test: `boards/tests/file-pages.spec.js` (new)

**Interfaces:**
- Consumes:
  - from A1: `fileFamily`, `isDrawnFamily`
  - from A2: `readHead`, `decodeText`, `headLines`, `sniffSep`, `parseDelimited`, `parseCues`, `CARD_HEAD_BYTES`
- Produces:
  - `default FamilyFace({ family, src, ext, sizeBytes, w, h, fallback }): JSX`
    - `src` is a card's `fileSrc` (`r2:<key>`).
    - `w` and `h` are the box in CSS px. When they're missing, the face measures its parent with a ResizeObserver.
    - It renders `fallback` when the file isn't text or can't be read.
  - `familyGlyph(family, ext): IconComponent|null`, the strip's icon for a family.
  - `useHeadText(src, max, sizeBytes): { text, complete } | null | undefined`
    - `undefined` = loading, `null` = not text or not readable.
    - Exported for FileStages; cached per `src`+`max` in a 96-entry LRU.

**Design (from the mockup kit, `scratchpad/p4mock/site/kit.css` lines 82-100 and `cards.js` `P.mdPage`/`logPage`/`srtPage`/`csvPage`):**
- The page is drawn at a fixed design width and scaled to the box, exactly as the mockup's `sheet(vw, w, h, …)`:
  - `width: vw`, `height: ceil(h * vw / w)`, `transform: scale(w / vw)`, `transform-origin: 0 0`.
  - Design widths: 520 for every family except table, which is 640.
  - Padding per family: markdown `46px 48px`, text and code `36px 34px`, subtitles `38px 44px`, table `34px 36px`.
- Type, at the design width:
  - Aileron `#1d1d1f` on `#fff`.
  - Markdown: h1 27px/700, h2 16px/700, li and p 15px/1.5 `#2a2a2e`; blockquote italic `#5a5a60` with a 22px indent.
  - Text and code: `--font-mono` 12.5px/1.6 `#2c2c30`, `white-space: pre`.
    - When there are 3 lines or fewer and one is longer than 160 characters, wrap instead (`pre-wrap`, `overflow-wrap: anywhere`), so a one-line JSON isn't one clipped line.
  - Cues: number 11px mono `#9a9aa0`; time 12px mono `#7a7a80` as `start → end`; text 16px/1.4 `#1a1a1c`; 15px between cues.
  - Table: 14px, tabular numbers; th 700 with a 1.5px `#1d1d1f` rule under it; td 8px vertical padding with a 1px `#e4e4e8` rule, nowrap.
- The page is never interactive on a card: `pointer-events: none`, so links in Markdown can't steal a drag.
- What it reads:
  - Card limits: 80 lines, 40 table rows × 12 columns, 12 cues, and a 64 KB head.
  - Markdown → `markdown-it` (dynamic import; `html: false`, `linkify: false`) → `DOMPurify.sanitize(html, { FORBID_TAGS: ['img', 'video', 'audio', 'iframe', 'form', 'style', 'svg', 'math', 'input', 'button'], FORBID_ATTR: ['style'] })`.
- Theme: the page stays white in both themes, as a document's page does.

- [ ] **Step 1: Write the failing spec.** Model it on `tests/doc-card-face.spec.js` (same harness: `/?local=1&reset=1&blank=1`, `r2.setPrefixResolver`, `window.__soleilFileLive.addFile`). Serve each file from a `blob:` URL made in the page:

```js
// tests/file-pages.spec.js
import { test, expect } from '@playwright/test';

const FILES = {
  'qa-files/Shot notes.md': '# Night Swim\n\n## Day 4\n\n- **Dock** at 06:10\n- Long lens\n\n> Keep the light\n',
  'qa-files/Dailies log.txt': Array.from({ length: 120 }, (_, i) => `B007C${String(i + 1).padStart(3, '0')}  long lens · PRINT`).join('\n'),
  'qa-files/Call times.csv': 'Name,Role,Call\n"Ellison, Mara",Director,06:00\nPark,DP,06:15\n',
  'qa-files/Night Swim.srt': '1\n00:00:01,000 --> 00:00:03,500\n<i>Hello</i> there\n\n2\n00:00:04,000 --> 00:00:05,000\nSecond\n',
  'qa-files/fake.txt': '\u0000\u0001\u0002binary',
};

async function boot(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForFunction(() => window.__soleilFileLive && window.__soleilR2);
  await page.evaluate((files) => {
    const urls = {};
    for (const [key, body] of Object.entries(files)) urls[key] = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    window.__soleilR2.setPrefixResolver('qa-files/', { cached: (k) => urls[k] || null, resolve: async (k) => urls[k] || null });
    window.__qaFileSizes = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Blob([v]).size]));
  }, FILES);
}
const add = (page, key, { w, h, x = 80, y = 80 } = {}) => page.evaluate(({ key, w, h, x, y }) => window.__soleilFileLive.addFile({
  fileSrc: `r2:${key}`, fileName: key.split('/').pop(), sizeBytes: window.__qaFileSizes[key], x, y, w, h,
}), { key, w, h, x, y });

test('a text file\'s card is its first page: markdown set, a log in mono, a table, cues', async ({ page }) => {
  await boot(page);
  await add(page, 'qa-files/Shot notes.md', { w: 300, h: 388 });
  await add(page, 'qa-files/Dailies log.txt', { w: 300, h: 388, x: 420 });
  await add(page, 'qa-files/Call times.csv', { w: 400, h: 236, x: 760 });
  await add(page, 'qa-files/Night Swim.srt', { w: 300, h: 388, x: 1200 });
  const face = (name) => page.locator('.file-card', { hasText: name }).locator('.fpg');
  await expect(face('Shot notes.md').locator('h1')).toHaveText('Night Swim');
  await expect(face('Shot notes.md').locator('li strong')).toHaveText('Dock');
  await expect(face('Dailies log.txt').locator('pre')).toContainText('B007C001  long lens');
  await expect(face('Call times.csv').locator('th')).toHaveText(['Name', 'Role', 'Call']);
  await expect(face('Call times.csv').locator('td').first()).toHaveText('Ellison, Mara');
  await expect(face('Night Swim.srt').locator('.fpg-cue')).toHaveCount(2);
  await expect(face('Night Swim.srt').locator('.fpg-cue').first()).toContainText('Hello there');
  await expect(page.locator('.filec-preview')).toHaveCount(0);
});

test('a file that says it is text but isn\'t keeps its icon; a card placed small keeps its size', async ({ page }) => {
  await boot(page);
  await add(page, 'qa-files/fake.txt', { w: 300, h: 388 });
  await add(page, 'qa-files/Shot notes.md', { w: 240, h: 150, x: 420 });
  await expect(page.locator('.file-card', { hasText: 'fake.txt' }).locator('.filec-glyph')).toBeVisible();
  const small = page.locator('.file-card', { hasText: 'Shot notes.md' });
  await expect(small.locator('.fpg h1')).toHaveText('Night Swim');
  const box = await small.boundingBox();
  expect(Math.round(box.width / box.height * 100)).toBe(160);
});
```

Before writing the spec, read the top of `tests/doc-card-face.spec.js` and match:
- its exact harness globals (the resolver hook and the `addFile` argument names);
- its card selector, if `.file-card` isn't the card's class.

- [ ] **Step 2: Run it and watch it fail.** Run `cd boards && npx playwright test tests/file-pages.spec.js --project=desktop-chrome`. Expected: FAIL, no `.fpg`.

- [ ] **Step 3: Write `FamilyFace.jsx`.**

```jsx
// A file's first page, drawn from what the file says: Markdown set as a
// document, a table, subtitle cues, text and code as the file has them.
// Lazy (FileCard and CardPreview import it on demand), so a board with no
// text files never loads it. The page is drawn at a fixed width and scaled
// to the box, so a small card shows the same page smaller.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { resolveSrc } from '../../lib/r2.js';
import { readHead, decodeText } from '../../lib/fileHead.js';
import { headLines, sniffSep, parseDelimited, parseCues } from '../../lib/textPages.js';
import { CARD_HEAD_BYTES } from '../../lib/fileFaceLimits.js';
import { FileMd, FileTxt, FileCsv, Subtitles, CodeIcon } from '../../lib/icons.js';
import './familyFace.css';

const GLYPHS = { markdown: FileMd, text: FileTxt, table: FileCsv, subtitles: Subtitles, code: CodeIcon };
export function familyGlyph(family, ext) { return GLYPHS[family] || null; }

const PAGE_W = { table: 640 };
const PAD = { markdown: '46px 48px', text: '36px 34px', code: '36px 34px', subtitles: '38px 44px', table: '34px 36px' };

// One read per file and ceiling, however many cards and tiles show it.
const heads = new Map();
function headOf(src, max, sizeBytes) {
  const key = `${max}:${src}`;
  let p = heads.get(key);
  if (p) { heads.delete(key); heads.set(key, p); return p; }
  p = resolveSrc(src)
    .then((url) => (url ? readHead(url, max, { size: sizeBytes ?? undefined }) : null))
    .then((r) => (r ? { text: decodeText(r.bytes, { complete: r.complete }), complete: r.complete } : null))
    .then((r) => (r && r.text != null ? r : null), () => null);
  heads.set(key, p);
  while (heads.size > 96) heads.delete(heads.keys().next().value);
  return p;
}

export function useHeadText(src, max, sizeBytes) {
  const [got, setGot] = useState({ key: '', value: undefined });
  const key = `${max}:${src}`;
  useEffect(() => {
    if (!src) return undefined;
    let live = true;
    headOf(src, max, sizeBytes).then((value) => { if (live) setGot({ key, value }); });
    return () => { live = false; };
  }, [key, src, max, sizeBytes]);
  return got.key === key ? got.value : undefined;
}

let md = null;
async function markdownHtml(text) {
  if (!md) {
    const [{ default: MarkdownIt }, { default: DOMPurify }] = await Promise.all([import('markdown-it'), import('dompurify')]);
    const it = new MarkdownIt({ html: false, linkify: false });
    md = (t) => DOMPurify.sanitize(it.render(t), {
      FORBID_TAGS: ['img', 'video', 'audio', 'iframe', 'form', 'style', 'svg', 'math', 'input', 'button'],
      FORBID_ATTR: ['style'],
    });
  }
  return md(text);
}

function MarkdownPage({ text }) {
  const [html, setHtml] = useState(null);
  useEffect(() => {
    let live = true;
    markdownHtml(text).then((h) => { if (live) setHtml(h); }, () => { if (live) setHtml(''); });
    return () => { live = false; };
  }, [text]);
  // eslint-disable-next-line react/no-danger -- sanitized above, no media, no styles
  return html == null ? null : <div className="fpg-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function TablePage({ text, ext, complete }) {
  const { rows } = parseDelimited(text, { sep: sniffSep(text, ext), maxRows: 40, complete });
  const [head = [], ...body] = rows;
  const cols = Math.min(12, Math.max(head.length, ...body.map((r) => r.length)));
  const cells = (r) => Array.from({ length: cols }, (_, i) => r[i] ?? '');
  return (
    <table className="fpg-grid">
      <thead><tr>{cells(head).map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
      <tbody>{body.map((r, j) => <tr key={j}>{cells(r).map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

function CuesPage({ text }) {
  return parseCues(text, { max: 12 }).map((c, i) => (
    <div className="fpg-cue" key={i}>
      <div className="fpg-cue-n">{c.n}</div>
      <div className="fpg-cue-tc">{c.start} → {c.end}</div>
      <div className="fpg-cue-t">{c.text}</div>
    </div>
  ));
}

function LinesPage({ text, complete }) {
  const lines = headLines(text, { max: 80, complete });
  const wrap = lines.length <= 3 && lines.some((l) => l.length > 160);
  return <pre className={`fpg-pre${wrap ? ' is-wrapped' : ''}`}>{lines.join('\n')}</pre>;
}

function useBox(w, h) {
  const ref = useRef(null);
  const [box, setBox] = useState(w && h ? { w, h } : null);
  useLayoutEffect(() => {
    if (w && h) { setBox((b) => (b && b.w === w && b.h === h ? b : { w, h })); return undefined; }
    const el = ref.current?.parentElement;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width && height) setBox({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);
  return [ref, box];
}

export default function FamilyFace({ family, src, ext = '', sizeBytes = null, w = 0, h = 0, fallback = null }) {
  const got = useHeadText(src, CARD_HEAD_BYTES, sizeBytes);
  const [ref, box] = useBox(w, h);
  if (got === null) return fallback;
  const vw = PAGE_W[family] || 520;
  const scale = box ? box.w / vw : 0;
  return (
    <div ref={ref} className="fpg" data-family={family} aria-hidden="true">
      {box && got && (
        <div className="fpg-sheet" style={{ width: vw, height: Math.ceil(box.h / scale), transform: `scale(${scale})`, padding: PAD[family] }}>
          {family === 'markdown' && <MarkdownPage text={got.text} />}
          {family === 'table' && <TablePage text={got.text} ext={ext} complete={got.complete} />}
          {family === 'subtitles' && <CuesPage text={got.text} />}
          {(family === 'text' || family === 'code') && <LinesPage text={got.text} complete={got.complete} />}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write `familyFace.css`.** Values come from the design list above. No nesting, no `*/` inside comments, and every `var()` must already be declared (cssTokens.test):

```css
/* A file's first page (FamilyFace.jsx): white in both themes, as a
   document's page is; drawn at its design width and scaled to the box. */
.fpg { position: absolute; inset: 0; overflow: hidden; background: #fff; pointer-events: none; }
.fpg-sheet { position: absolute; left: 0; top: 0; transform-origin: 0 0; box-sizing: border-box; overflow: hidden;
  color: #1d1d1f; font-family: var(--font-sans); }
.fpg-md h1 { margin: 0 0 6px; font-size: 27px; line-height: 1.15; font-weight: 700; color: #111; }
.fpg-md h2, .fpg-md h3 { margin: 24px 0 8px; font-size: 16px; font-weight: 700; color: #1d1d1f; }
.fpg-md p, .fpg-md li { margin: 0 0 6px; font-size: 15px; line-height: 1.5; color: #2a2a2e; }
.fpg-md ul, .fpg-md ol { margin: 0 0 10px; padding-left: 22px; }
.fpg-md strong { font-weight: 700; color: #111; }
.fpg-md blockquote { margin: 22px 0 0 22px; font-style: italic; color: #5a5a60; }
.fpg-md code, .fpg-md pre { font-family: var(--font-mono); font-size: 13px; }
.fpg-md a { color: inherit; text-decoration: underline; }
.fpg-pre { margin: 0; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; color: #2c2c30; white-space: pre; }
.fpg-pre.is-wrapped { white-space: pre-wrap; overflow-wrap: anywhere; }
.fpg-cue { margin: 0 0 15px; }
.fpg-cue-n { font-family: var(--font-mono); font-size: 11px; color: #9a9aa0; }
.fpg-cue-tc { margin: 1px 0 3px; font-family: var(--font-mono); font-size: 12px; color: #7a7a80; }
.fpg-cue-t { font-size: 16px; line-height: 1.4; color: #1a1a1c; white-space: pre-line; }
.fpg-grid { border-collapse: collapse; width: 100%; font-size: 14px; font-variant-numeric: tabular-nums; }
.fpg-grid th { text-align: left; font-weight: 700; color: #111; padding: 0 14px 8px 0; border-bottom: 1.5px solid #1d1d1f; white-space: nowrap; }
.fpg-grid td { padding: 8px 14px 8px 0; border-bottom: 1px solid #e4e4e8; color: #2a2a2e; white-space: nowrap; }
```

Before writing it, check that `--font-sans` and `--font-mono` are the declared names: `grep -n "\-\-font-mono\|\-\-font-sans" boards/src/styles.css | head -3`.

- [ ] **Step 5: Wire it into FileCard.**
  - Add the icons to `icons.js`: `FileMd, FileTxt, FileCsv, Subtitles` from `@phosphor-icons/react`, in the same export style as their neighbours. Only FamilyFace imports them, so `iconSplit` keeps them out of the boot set.
  - Replace the `CODE_EXTS`/`TEXT_EXTS` tests in `iconForFile` with `const family = fileFamily(e, m); if (family === 'code') return CodeIcon; if (family) return FileText;`. Keep that above the zip/doc lines; `'doc'` is handled before it, so check its order.
  - Delete `TEXT_PREVIEW_MAX_BYTES`, `TEXT_PREVIEW_MAX_CHARS`, `CODE_EXTS`, `TEXT_EXTS`, the `preview` state, the `isTextish` effect and the `<pre className="filec-preview">` branch.
  - Add the lazy loader near the top:

```js
// The drawn families' pages live in their own chunk (FamilyFace.jsx).
let facesMod = null;
let facesLoad = null;
const loadFaces = () => facesLoad || (facesLoad = import('./FamilyFace.jsx').then((m) => { facesMod = m; return m; }));
function useFaces(want) {
  const [mod, setMod] = useState(facesMod);
  useEffect(() => {
    if (!want || mod) return undefined;
    let live = true;
    loadFaces().then((m) => { if (live) setMod(m); }, () => {});
    return () => { live = false; };
  }, [want, mod]);
  return mod;
}
```

  - In the component:
    - `const family = fileFamily(e, mime);`
    - `const drawn = isDrawnFamily(family) && !pending && !!fileSrc;`
    - `const faces = useFaces(drawn);`
    - `const StripIcon = (drawn && faces?.familyGlyph(family)) || GlyphIcon;`
  - In the body, where the old preview rendered, render the face:

```jsx
{drawn && faces && <faces.default family={family} src={fileSrc} ext={e} sizeBytes={sizeBytes} w={w} h={h} fallback={glyph} />}
```

    Here `glyph` is the existing centred-icon element. Hoist it into a const if it's inline. While `faces` is still loading, render nothing over the white body: give the body `is-page` while `drawn`, so it's white at once and doesn't flash the glyph.
  - Use `StripIcon` in `.filec-info`.

- [ ] **Step 6: Register the lazy chunk.**
  - `bundleBudget.mjs` `LAZY_IN_APP`: add `'FamilyFace'`.
  - `tests/global-setup.js` `LAZY_MODULES`: add `'components/cards/FamilyFace.jsx'`.

- [ ] **Step 7: Docs, tests, build, budget, commit, push.**
  - In `content/docs/files/index.md`:
    - The "What each type becomes" table gets a row: `| Text, Markdown, code, logs, .csv, .tsv, .srt, .vtt | A white page showing the start of the file: Markdown set as a document, a table's rows, subtitle cues, code and logs as the file has them |`.
    - Delete the sentence about small text files.
    - First `grep -n "Small text\|inline preview" src/lib/seoProbeContract.js` (expected: no hit).
  - Then run, from `boards/`:

```bash
npm run docs:build && npm run docs:check && npm test
npx playwright test tests/file-pages.spec.js tests/doc-card-face.spec.js --project=desktop-chrome
npx vite build && node scripts/bundleBudget.mjs dist --report
```

  - Expected: every check passes, and appJs ≤ its ceiling.
    - If appJs is over, find the cause with `--report`. FileCard's own growth is `fileFamily` plus the loader, minus the deleted preview.
    - Never raise the ceiling without a dated comment naming the cause, the way the 2026-10-24 DOMPurify line does.
  - Commit A3 with the docs and push A1–A3 together:

```bash
git add -- boards/src/components/cards/FamilyFace.jsx boards/src/components/cards/familyFace.css boards/tests/file-pages.spec.js
git commit -m "A text file's card is its first page, white as a document's: Markdown set as a document (headings, lists, quotes, no pictures or styles), a .csv or .tsv as a table under its header row, an .srt or .vtt as numbered cues with their times, code and logs exactly as the file has them; it reads at most the file's first 64 KB however big the file is, a file that only says it's text keeps its icon, a card placed before keeps its size and shows the top of the page, and the old preview of small text files is gone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- boards/src/components/cards/FamilyFace.jsx boards/src/components/cards/familyFace.css boards/src/components/cards/FileCard.jsx boards/src/components/cards/fileCard.css boards/src/lib/icons.js boards/scripts/bundleBudget.mjs boards/tests/global-setup.js boards/tests/file-pages.spec.js boards/content/docs/files/index.md boards/src/lib/docsite*.js boards/public/docs boards/public/llms.txt boards/public/llms-full.txt
git fetch -q origin && git rebase origin/main && git push origin HEAD:refs/heads/main
```

  - Find the generated docs paths with `git status --short` after `docs:build` and commit exactly those.

### Task A4: Tiles and lists know the family

**Files:**
- Modify: `boards/src/lib/listItem.js:219-230` (file case) and `TYPE_LABELS`
- Modify: `boards/src/components/clusterBrowser/CardPreview.jsx:57-70`
- Modify: `boards/src/styles.css` (next to `.cbp-file-tile`: `.cbp-page { position: relative; width: 100%; height: 100%; overflow: hidden; }`)
- Test: `boards/src/lib/listItem.test.mjs` (or whichever node test covers `toListItem`; find it with `grep -ln "listItem" boards/src/lib/*.test.mjs`)

**Interfaces:**
- Consumes: `fileFamily`, `isDrawnFamily` (A1); `FamilyFace` default export (A3)
- Produces:
  - `item.preview.family` (string|null) and `item.preview.src` (the card's `fileSrc`) on file items.
  - `item.typeLabel` for files by family:

| family | typeLabel |
|---|---|
| markdown, text | `'Text'` |
| code | `'Code'` |
| table | `'Spreadsheet'` |
| subtitles | `'Subtitles'` |
| doc | `'Document'`, `'Presentation'` or `'Spreadsheet'`, by `docFamily` |

  Anything else stays `'File'`. Parts B–E add `'Font'`, `'Email'`, `'Design file'` and `'Archive'`.

- [ ] **Step 1: Write the failing test.**

```js
test('a file item names its family, and Quick look\'s bar says what it is', () => {
  const it = (fileName) => toListItem({ id: 'c', kind: 'file', fileName, fileSrc: `r2:k/${fileName}` });
  assert.equal(it('notes.md').preview.family, 'markdown');
  assert.equal(it('notes.md').preview.src, 'r2:k/notes.md');
  assert.equal(it('notes.md').typeLabel, 'Text');
  assert.equal(it('app.py').typeLabel, 'Code');
  assert.equal(it('crew.csv').typeLabel, 'Spreadsheet');
  assert.equal(it('cues.srt').typeLabel, 'Subtitles');
  assert.equal(it('Pitch.pptx').typeLabel, 'Presentation');
  assert.equal(it('Treatment.docx').typeLabel, 'Document');
  assert.equal(it('pack.bin').typeLabel, 'File');
});
```

  Use the module's real export name. `toListItem` is the assumption; check the file's exports first.

- [ ] **Step 2: Run it and watch it fail.** Run `node --test src/lib/listItem.test.mjs`. Expected: FAIL on `preview.family`.

- [ ] **Step 3: Implement.**
  - In the file case:
    - `const family = fileFamily(item.ext, card.mime);`
    - `item.preview = { mode: 'file', ext: card.ext, mime: card.mime, kind, family, src: card.fileSrc || '' };`
    - Then `item.typeLabel = FAMILY_LABELS[family === 'doc' ? `doc:${docFamily(item.ext)}` : family] || item.typeLabel;` with:

```js
const FAMILY_LABELS = { markdown: 'Text', text: 'Text', code: 'Code', table: 'Spreadsheet', subtitles: 'Subtitles',
  'doc:slides': 'Presentation', 'doc:sheet': 'Spreadsheet', 'doc:page': 'Document' };
```

    Check that `typeLabel` is assigned before the switch runs (line ~148). If it's built after, set it where the object is built from a `familyLabel` computed in the file case. The search haystack at ~407 already includes `typeLabel`, so "spreadsheet" finds a .csv.
  - In `CardPreview.jsx`, in the `p.mode === 'file'` branch, after the doc-page branch and before the `FileFace` tile:

```jsx
if (isDrawnFamily(p.family) && p.src) {
  return <div className="cbp-page"><FamilyFaceLazy family={p.family} src={p.src} ext={p.ext} sizeBytes={item?.card?.sizeBytes ?? null} fallback={fileTile} /></div>;
}
```

    Here `const FamilyFaceLazy = lazyWithReload(() => import('../cards/FamilyFace.jsx'));` sits at module scope, the element is wrapped in `<Suspense fallback={fileTile}>`, and `fileTile` is the existing `FileFace` element hoisted into a const. FamilyFace measures the tile with its ResizeObserver, since no `w`/`h` is passed.

- [ ] **Step 4: Run the tests.** Run `npm test`, plus `npx playwright test tests/file-pages.spec.js tests/cluster-browser.spec.js tests/quicklook-escape.spec.js --project=desktop-chrome`. Expected: PASS.

  Add one assertion to `file-pages.spec.js`: open the cluster's Files page with the F key, and expect the .md tile to hold `.cbp-page .fpg h1`. Read `tests/cluster-browser.spec.js` for how it opens the page in the local harness.

- [ ] **Step 5: Commit and push.** Message: "In the Files page, the sidebar's files and Quick look's fallback, a text file's tile is its first page too, and the type a file is called by (in a list's Type column, the search, Quick look's bar) is its family's: Text, Code, Spreadsheet, Subtitles, Document, Presentation".

### Task A5: Quick look reads it (FileStages)

**Files:**
- Create: `boards/src/components/clusterBrowser/FileStages.jsx`, `boards/src/components/clusterBrowser/fileStages.css`
- Modify: `boards/src/components/clusterBrowser/QuickLook.jsx`:
  - `Stage` gets an `onDownload` prop and a family branch after the `DocStage` line (~160);
  - the `<Stage …>` call passes `onDownload`.
- Modify: `bundleBudget.mjs` `LAZY_IN_APP` += `'FileStages'`; `global-setup.js` `LAZY_MODULES` += `'components/clusterBrowser/FileStages.jsx'`
- Modify: `boards/scripts/gen-docs.mjs` (import the limits; FACTS `textStageMax`, `tableStageRows`), `boards/content/docs/files/index.md`
- Test: `boards/tests/file-pages.spec.js` (append)

**Interfaces:**
- Consumes:
  - `useHeadText` (A3); `TEXT_STAGE_MAX_BYTES`, `TABLE_STAGE_MAX_ROWS` (A2); `headLines`, `sniffSep`, `parseDelimited`, `parseCues` (A2)
  - `item.preview.family` and `item.preview.src` (A4)
  - QuickLook's existing `onDownload(item)` prop
- Produces: `default FileStage({ family, item, onDownload, fallback })`. Parts B, C and E add families to its dispatch.

**Design (mockup `scratchpad/p4mock/site/ql.css` lines 37-65, `ql.html` `textStage`/`csvStage`):**
- All stages share `.qpage`: a white sheet on the dark stage with a 6px radius at the top, scrolling inside itself (`overflow: auto`), full stage height.
- Text and code (`.fst-text`):
  - The sheet is 900px wide, or `min(900px, 100%)`.
  - Two `<pre>`s side by side: the gutter's numbers in a 64px column, right-aligned, `#b4b4ba`, `position: sticky; left: 0` on a white ground; then the text.
  - Mono 13px/1.65, `white-space: pre`, no wrap, 30px top padding.
  - Past `TEXT_STAGE_MAX_BYTES` (`!complete`), a `.fst-top` notice sits above the lines: Info icon, "Showing the first 2 MB of 2.4 MB." and a "Download all of it" button that calls `onDownload(item)`. Both sizes come from `humanSize` (FileCard's, now exported; move it to `lib/fileSize.js` if FileCard can't be imported from here without pulling the card in).
- Markdown (`.fst-md`):
  - 900px sheet, padding `56px 72px`, the A3 markdown styles at 1.15× (h1 31px, body 16px/1.6).
  - Links open in a new tab: after the HTML is set, a `useLayoutEffect` gives each `a[href]` `target="_blank"` and `rel="noopener noreferrer"`. No DOMPurify hook: hooks are global and would leak into other sanitize calls.
- Table (`.fst-table`):
  - 1080px sheet.
  - A head line: "22 rows · 4 columns", or "First 5,000 rows · 4 columns" when cut by `TABLE_STAGE_MAX_ROWS` or by the 2 MB head; numbers via `toLocaleString()`.
  - The table has a sticky `thead`, a row-number column `.n` (`#a0a0a6`, 34px), 9px cells, 1px `#ececef` rules and `white-space: nowrap`. The sheet scrolls both ways.
- Cues (`.fst-cues`): 900px sheet, the A3 cue styles at 1.1×, every cue up to the 2 MB head.
- Loading shows the empty white sheet. A file that isn't text renders `fallback`, which is Quick look's own `.ql-card` with `CardPreview`.
- No colour is gold here. The sheet is white in both themes.

- [ ] **Step 1: Write the failing spec (append).**

```js
test('Quick look reads a text file with line numbers, a table with its header, and says when it shows only the start', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const big = 'x'.repeat(79) + '\n';
    const body = big.repeat(Math.ceil((2.2 * 1024 * 1024) / 80));
    const url = URL.createObjectURL(new Blob([body]));
    window.__qaFileSizes['qa-files/huge.log'] = body.length;
    const prev = window.__soleilR2.prefixResolver?.('qa-files/');
    window.__qaBigUrl = url;
  });
  await add(page, 'qa-files/Dailies log.txt', { w: 300, h: 388 });
  await page.locator('.file-card', { hasText: 'Dailies log.txt' }).click();
  await page.keyboard.press('Space');
  const stage = page.locator('.ql .fst-text');
  await expect(stage.locator('.fst-gutter')).toContainText('120');
  await expect(stage.locator('.fst-lines')).toContainText('B007C120  long lens');
  await expect(stage.locator('.fst-top')).toHaveCount(0);
  await expect(page.locator('.ql-meta')).toContainText('Text');
  await page.keyboard.press('Escape');

  await add(page, 'qa-files/Call times.csv', { w: 400, h: 236, x: 420 });
  await page.locator('.file-card', { hasText: 'Call times.csv' }).click();
  await page.keyboard.press('Space');
  await expect(page.locator('.ql .fst-table thead th')).toHaveText(['', 'Name', 'Role', 'Call']);
  await expect(page.locator('.ql .fst-table .fst-count')).toHaveText('2 rows · 3 columns');
});
```

  - Extend the resolver map in `boot` to serve `qa-files/huge.log` from the 2.2 MB body. The cleanest way: make `FILES` values allow a function returning a Blob.
  - Then add a third block: open `huge.log` and expect `.fst-top` to contain `Showing the first 2 MB of 2.2 MB.`, and its button `Download all of it`.
  - To select a card and open Quick look, mirror `tests/quicklook-escape.spec.js`.

- [ ] **Step 2: Run it and watch it fail.** Run `npx playwright test tests/file-pages.spec.js --project=desktop-chrome`. Expected: FAIL, no `.fst-text`.

- [ ] **Step 3: Implement `FileStages.jsx`.**

```jsx
// Quick look's pages for the files a browser can read: text and code with
// their line numbers, Markdown set as a document, a table under its header,
// subtitle cues. Up to TEXT_STAGE_MAX_BYTES of a file; past that, a notice
// and the whole file one click away. Lazy, like FamilyFace.

import { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { useHeadText, markdownHtml } from '../cards/FamilyFace.jsx';
import { headLines, sniffSep, parseDelimited, parseCues } from '../../lib/textPages.js';
import { TEXT_STAGE_MAX_BYTES, TABLE_STAGE_MAX_ROWS } from '../../lib/fileFaceLimits.js';
import { humanSize } from '../../lib/fileSize.js';
import { Icon } from '../Icon.jsx';
import { Info, Download } from '../../lib/icons.js';
import './fileStages.css';

function CutNotice({ sizeBytes, onDownload }) {
  return (
    <div className="fst-top" role="status">
      <Icon as={Info} size={16} />
      <span className="fst-grow">Showing the first {humanSize(TEXT_STAGE_MAX_BYTES)}{sizeBytes ? ` of ${humanSize(sizeBytes)}` : ''}.</span>
      {onDownload && <button type="button" className="fst-btn" onClick={onDownload}><Icon as={Download} size={14} />Download all of it</button>}
    </div>
  );
}

function TextStage({ got, sizeBytes, onDownload }) {
  const lines = headLines(got.text, { complete: got.complete });
  return (
    <div className="qpage fst-text">
      {!got.complete && <CutNotice sizeBytes={sizeBytes} onDownload={onDownload} />}
      <div className="fst-body">
        <pre className="fst-gutter" aria-hidden="true">{lines.map((_, i) => i + 1).join('\n')}</pre>
        <pre className="fst-lines">{lines.join('\n')}</pre>
      </div>
    </div>
  );
}

function MarkdownStage({ got, sizeBytes, onDownload }) {
  const [html, setHtml] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    let live = true;
    markdownHtml(got.text).then((h) => { if (live) setHtml(h); }, () => { if (live) setHtml(''); });
    return () => { live = false; };
  }, [got.text]);
  useLayoutEffect(() => {
    for (const a of ref.current?.querySelectorAll('a[href]') || []) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  }, [html]);
  return (
    <div className="qpage fst-md">
      {!got.complete && <CutNotice sizeBytes={sizeBytes} onDownload={onDownload} />}
      {html != null && <div ref={ref} className="fst-md-body fpg-md" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

function TableStage({ got, ext }) {
  const { rows, more } = parseDelimited(got.text, { sep: sniffSep(got.text, ext), maxRows: TABLE_STAGE_MAX_ROWS + 1, complete: got.complete });
  const [head = [], ...body] = rows;
  const cols = Math.max(head.length, ...body.map((r) => r.length));
  const cells = (r) => Array.from({ length: cols }, (_, i) => r[i] ?? '');
  const n = body.length.toLocaleString();
  return (
    <div className="qpage fst-table">
      <div className="fst-count">{more ? `First ${n} rows` : `${n} ${body.length === 1 ? 'row' : 'rows'}`} · {cols} {cols === 1 ? 'column' : 'columns'}</div>
      <table>
        <thead><tr><th className="n" />{cells(head).map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>{body.map((r, j) => <tr key={j}><td className="n">{j + 1}</td>{cells(r).map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function CuesStage({ got, sizeBytes, onDownload }) {
  return (
    <div className="qpage fst-cues">
      {!got.complete && <CutNotice sizeBytes={sizeBytes} onDownload={onDownload} />}
      {parseCues(got.text).map((c, i) => (
        <div className="fpg-cue" key={i}><div className="fpg-cue-n">{c.n}</div><div className="fpg-cue-tc">{c.start} → {c.end}</div><div className="fpg-cue-t">{c.text}</div></div>
      ))}
    </div>
  );
}

const TEXT_STAGES = { markdown: MarkdownStage, table: TableStage, subtitles: CuesStage, text: TextStage, code: TextStage };

function TextFamily({ family, item, onDownload, fallback }) {
  const p = item.preview || {};
  const sizeBytes = item.card?.sizeBytes ?? null;
  const got = useHeadText(p.src, TEXT_STAGE_MAX_BYTES, sizeBytes);
  if (got === null) return fallback;
  if (got === undefined) return <div className={`qpage fst-${family === 'table' ? 'table' : 'text'}`} />;
  const Stage = TEXT_STAGES[family];
  return <Stage got={got} ext={p.ext} sizeBytes={sizeBytes} onDownload={onDownload ? () => onDownload(item) : null} />;
}

export default function FileStage(props) {
  if (TEXT_STAGES[props.family]) return <TextFamily {...props} />;
  return props.fallback;
}
```

  Export `markdownHtml` from `FamilyFace.jsx`: it's already a module function, so add `export`. Write `fileStages.css` from the design list above, scoped under `.ql`, and port the exact values from `ql.css` 37-65 (`.qpage`, `.qtext`, `.qcsv`, `.qtop`).

- [ ] **Step 4: Wire it into QuickLook.**

```jsx
const FileStagesLazy = lazyWithReload(() => import('./FileStages.jsx'));
// in Stage({ item, playerRef, modalHandle, onDownload }), after the DocStage line:
const family = item.kind === 'file' ? item.preview?.family : null;
if (isDrawnFamily(family) && item.preview?.src) {
  const fallback = <div className="ql-card"><div className="ql-card-preview"><CardPreview item={item} size="tile" px={640} /></div></div>;
  return <Suspense fallback={fallback}><FileStagesLazy family={family} item={item} onDownload={onDownload} fallback={fallback} /></Suspense>;
}
```

  Pass `onDownload={onDownload}` where QuickLook renders `<Stage …>`. Import `Suspense`, `lazyWithReload` and `isDrawnFamily` if they aren't already imported. Keyboard behaviour must not change: Space and Esc close; ←/→ still step between files, even when the sheet scrolls, so the `.qpage` takes no key handlers.

- [ ] **Step 5: Docs and facts.**
  - In `gen-docs.mjs`: `import { TEXT_STAGE_MAX_BYTES, TABLE_STAGE_MAX_ROWS } from '../src/lib/fileFaceLimits.js';`, then in FACTS:

```js
  textStageMax: `${TEXT_STAGE_MAX_BYTES / MB} MB`,
  tableStageRows: TABLE_STAGE_MAX_ROWS.toLocaleString('en-US'),
```

  - In `files/index.md`, under Quick look (find the section with `grep -n "Quick look" content/docs/files/index.md`):

```md
A text file opens as its page with line numbers, up to its first {{fact:textStageMax}}; past that, Quick look says so and **Download all of it** saves the whole file. A `.csv` or `.tsv` opens as a table under its header row, up to {{fact:tableStageRows}} rows. Subtitles open as their cues, and Markdown as a document, with its links opening in a new tab.
```

- [ ] **Step 6: Run everything.** Run `npm run docs:build && npm run docs:check && npm test`, then `npx playwright test tests/file-pages.spec.js tests/quicklook-escape.spec.js tests/doc-card-face.spec.js --project=desktop-chrome`, then `npx vite build && node scripts/bundleBudget.mjs dist`. Expected: PASS, and appJs unchanged (±0.1 KB) by A5.

- [ ] **Step 7: Commit and push.** Message: "Quick look reads a text file: its page with line numbers, up to its first 2 MB (past that it says so, and Download all of it saves the whole file), Markdown as a document whose links open in a new tab, a .csv or .tsv as a table under its header row with row numbers, up to 5,000 rows, and subtitles as their cues". Commit with the docs and generated files; then rebase and push. After the push, open preview with a .md, .csv, .srt and .log on a board, and check the cards and Quick look in both themes.

---

## Part B: Fonts (.ttf .otf .woff .woff2 .ttc)

What users see:
- A font drops as a 320×220 specimen card: a big "Aa" in the font, its family name, its style in caps, a sample line and an alphabet line, as in the mockup's `P.specimen`.
- Quick look shows:
  - a header (family name in the font, plus Style / Format · size / Licence);
  - "Type to try it", with a size slider 12–160 px (default 66);
  - a waterfall at 12, 16, 24, 36 and 48 px;
  - a glyph grid.
- A font over 16 MB keeps its icon. So does a font that won't load (a broken file, or a WOFF2 the browser refuses).

### Task B1: Reading a font's names (pure)

**Files:**
- Create: `boards/src/lib/fontInfo.js`; Test: `boards/src/lib/fontInfo.test.mjs`
- Modify: `boards/src/lib/fileFaceLimits.js` (+ `FONT_FACE_MAX_BYTES = 16 * 1024 * 1024`)

**Interfaces:**
- Produces:
  - `async fontInfo(bytes: Uint8Array, fileName: string) → { family, style, weight, format, license }`, where:
    - `family` and `style` are strings;
    - `weight` is a number or null;
    - `format` is `'TrueType'|'OpenType'|'WOFF'|'WOFF2'|'TrueType Collection'`;
    - `license` is a string or null.
    - It never throws: on anything unreadable it returns names made from the file name.
  - `licenseLabel(text: string|null, url: string|null): string|null`

**Format notes (OpenType spec, `name`, `OS/2`):**
- sfnt header:
  - `uint32 version` (`0x00010000` or `'true'` = TrueType; `'OTTO'` = OpenType/CFF);
  - `uint16 numTables` at offset 4;
  - then 16-byte records at offset 12: `tag[4], checksum, offset, length`.
- TTC: `'ttcf'`, `uint32 version`, `uint32 numFonts`, then `uint32 offsets[numFonts]`. Read the first font's sfnt at `offsets[0]`.
- WOFF (`'wOFF'`):
  - header 44 bytes (`flavor` at 4, `numTables` at 12);
  - table directory at 44, 20 bytes each: `tag, offset, compLength, origLength, origChecksum`.
  - A table with `compLength < origLength` is zlib: inflate it with `new DecompressionStream('deflate')`. That's why `fontInfo` is async.
- WOFF2 (`'wOF2'`): Brotli plus transforms. Don't parse it; use the file name, with `format: 'WOFF2'`.
- `name` table:
  - `uint16 format, count, stringOffset`, then records of `platformID, encodingID, languageID, nameID, length, offset` (12 bytes each).
  - Prefer platform 3 (Windows, UTF-16BE) with language `0x0409`, then any platform 3, then platform 1 (Mac Roman; decode as latin1).
  - Family: nameID 16, else 1. Style: nameID 17, else 2. Licence text: nameID 13. Licence URL: nameID 14.
- `OS/2`: `usWeightClass` is the uint16 at offset 4.
- `licenseLabel`:

| Text contains or URL matches | Label |
|---|---|
| /SIL Open Font License/i (or scripts.sil.org/OFL) | `'SIL Open Font License 1.1'` |
| /Apache License/i | `'Apache License 2.0'` |
| /Ubuntu Font Licen[cs]e/i | `'Ubuntu Font Licence'` |
| /GNU General Public/i | `'GPL'` |
| any other non-empty text | its first sentence, cut at 80 characters |
| none | null |

- File-name fallback: `'Fraunces-Black.ttf'` → family `'Fraunces'`, style `'Black'`. Split on the last `-` or `_`. No separator → family = the name without its extension, style `'Regular'`.

- [ ] **Step 1: Write the failing tests.** Build a minimal sfnt in the test:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { fontInfo, licenseLabel } from './fontInfo.js';

const u16 = (n) => [n >> 8, n & 255];
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const utf16be = (s) => [...s].flatMap((c) => u16(c.charCodeAt(0)));
function nameTable(names) {
  const strings = names.map(([, s]) => utf16be(s));
  const head = [...u16(0), ...u16(names.length), ...u16(6 + 12 * names.length)];
  let off = 0;
  const recs = names.flatMap(([id], i) => { const r = [...u16(3), ...u16(1), ...u16(0x409), ...u16(id), ...u16(strings[i].length), ...u16(off)]; off += strings[i].length; return r; });
  return Uint8Array.from([...head, ...recs, ...strings.flat()]);
}
const os2 = (weight) => Uint8Array.from([...u16(4), ...u16(500), ...u16(weight), ...new Array(90).fill(0)]);
function sfnt(tables, version = 0x00010000) {
  const tags = Object.keys(tables);
  let off = 12 + 16 * tags.length;
  const dir = []; const body = [];
  for (const t of tags) { const b = tables[t]; dir.push(...[...t].map((c) => c.charCodeAt(0)), ...u32(0), ...u32(off), ...u32(b.length)); body.push(...b); off += b.length; }
  return Uint8Array.from([...u32(version), ...u16(tags.length), ...u16(0), ...u16(0), ...u16(0), ...dir, ...body]);
}
function woff(tables) {
  const tags = Object.keys(tables);
  let off = 44 + 20 * tags.length;
  const dir = []; const body = [];
  for (const t of tags) { const raw = tables[t]; const z = deflateSync(raw); dir.push(...[...t].map((c) => c.charCodeAt(0)), ...u32(off), ...u32(z.length), ...u32(raw.length), ...u32(0)); body.push(...z); off += z.length; }
  return Uint8Array.from([...[...'wOFF'].map((c) => c.charCodeAt(0)), ...u32(0x00010000), ...u32(off), ...u16(tags.length), ...u16(0), ...new Array(28).fill(0), ...dir, ...body]);
}
const NAMES = [[1, 'Fraunces'], [2, 'Regular'], [16, 'Fraunces'], [17, 'Black'], [13, 'This Font Software is licensed under the SIL Open Font License, Version 1.1.']];

test('a TrueType font names its family, style, weight and licence', async () => {
  const info = await fontInfo(sfnt({ name: nameTable(NAMES), 'OS/2': os2(900) }), 'x.ttf');
  assert.deepEqual(info, { family: 'Fraunces', style: 'Black', weight: 900, format: 'TrueType', license: 'SIL Open Font License 1.1' });
});

test('OpenType (CFF), a collection\'s first font and a WOFF read the same names', async () => {
  const otf = sfnt({ name: nameTable(NAMES) }, 0x4f54544f);
  assert.equal((await fontInfo(otf, 'x.otf')).format, 'OpenType');
  const one = sfnt({ name: nameTable(NAMES) });
  const ttc = Uint8Array.from([...[...'ttcf'].map((c) => c.charCodeAt(0)), ...u32(0x00010000), ...u32(1), ...u32(16), ...one]);
  // the inner sfnt's table offsets are relative to the file start, so shift them by 16
  assert.equal((await fontInfo(ttc, 'x.ttc')).format, 'TrueType Collection');
  const w = await fontInfo(woff({ name: nameTable(NAMES), 'OS/2': os2(900) }), 'x.woff');
  assert.deepEqual([w.family, w.style, w.weight, w.format], ['Fraunces', 'Black', 900, 'WOFF']);
});

test('a WOFF2 or a broken file is named from its file name', async () => {
  assert.deepEqual(await fontInfo(Uint8Array.from([...[...'wOF2'].map((c) => c.charCodeAt(0)), 0, 0]), 'Fraunces-Black.woff2'),
    { family: 'Fraunces', style: 'Black', weight: null, format: 'WOFF2', license: null });
  const junk = await fontInfo(Uint8Array.from([1, 2, 3]), 'Mystery.ttf');
  assert.deepEqual([junk.family, junk.style], ['Mystery', 'Regular']);
});

test('licences get their short names', () => {
  assert.equal(licenseLabel(null, 'https://scripts.sil.org/OFL'), 'SIL Open Font License 1.1');
  assert.equal(licenseLabel('Licensed under the Apache License, Version 2.0', null), 'Apache License 2.0');
  assert.equal(licenseLabel(null, null), null);
  assert.equal(licenseLabel('Copyright Foundry. All rights reserved. Not for resale.', null), 'Copyright Foundry.');
});
```

  For the TTC case, the test helper must write table offsets relative to the file start. Give `sfnt()` a `base` argument (`sfnt(tables, version, base = 0)`, adding `base` to each offset), and build the TTC's inner font with `base = 16`.

- [ ] **Step 2: Run them and watch them fail.** Run `node --test src/lib/fontInfo.test.mjs`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `fontInfo.js`** per the format notes:
  - A `DataView` over the bytes.
  - `tables(view, base)` returns `Map(tag → {offset, length})` for sfnt.
  - `woffTables(view)` returns `Map(tag → {offset, compLength, origLength})`.
  - `async tableBytes(...)` inflates a compressed WOFF table with `new Response(new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()`.
  - `readNames(bytes)` follows the preference order.
  - `fromFileName(name)`.
  - Wrap everything in try/catch, falling back to `fromFileName`.
  - Guard every offset against the buffer length: a record pointing past the end is skipped, never read.

- [ ] **Step 4: Run them and watch them pass.** Expected: PASS.

- [ ] **Step 5: Commit** (no push; it rides with B2). Message: "The piece a font's card reads its names with: family, style, weight and licence from a TrueType, OpenType, collection or WOFF font's name table, or from its file name when it can't be read (nothing visible yet)".

### Task B2: The specimen card

**Files:**
- Modify: `boards/src/lib/fileView.js`:
  - `FAMILY_EXTS.font = ['ttf', 'otf', 'woff', 'woff2', 'ttc']`
  - `fileFamily`: a `font/*` type → `'font'`. Put this check BEFORE the `video|audio|image` guard, since there is no clash.
  - `FONT_DROP = Object.freeze({ w: 320, h: 220 })`
  - `fileDropSize`: font → `FONT_DROP`.
- Create: `boards/src/lib/fontLoad.js`
- Modify: `boards/src/components/cards/FamilyFace.jsx` (a `FontPage` branch; `familyGlyph('font')` → `Type`, the existing TextAa export in icons.js; check its exported name)
- Modify: `boards/src/components/cards/familyFace.css` (`.fpg-spec*` from kit.css 109-114)
- Modify: `boards/src/lib/listItem.js` (`FAMILY_LABELS.font = 'Font'`)
- Test: `fileView.test.mjs`, `fileIngest.test.mjs`, `tests/file-pages.spec.js`

**Interfaces:**
- Consumes: `fontInfo` (B1), `FONT_FACE_MAX_BYTES` (B1), `readHead` (A2)
- Produces: `loadFontFile(src: string, { sizeBytes, fileName }) → Promise<{ cssFamily: string, info } | null>`, cached per src.
  - It reads the whole file (≤ `FONT_FACE_MAX_BYTES`, else null) with `readHead(url, FONT_FACE_MAX_BYTES, { size })`.
  - It names a `FontFace` `soleil-font-<n>` from a counter, never from the file's own name, so a font can't collide with or override the app's fonts.
  - `await face.load()`, then `document.fonts.add(face)`, then `fontInfo(bytes, fileName)`.
  - A load failure gives null.

- [ ] **Step 1: Write the failing tests.**
  - In `fileView.test.mjs`: `assert.equal(fileFamily('woff2'), 'font'); assert.equal(fileFamily('', 'font/ttf'), 'font'); assert.deepEqual(fileDropSize('otf'), FONT_DROP); assert.deepEqual(FONT_DROP, { w: 320, h: 220 });`
  - In `fileIngest.test.mjs`: `assert.deepEqual([c('Fraunces-Black.ttf', 'font/ttf').w, c('Fraunces-Black.ttf', 'font/ttf').h], [320, 220]);`
  - In `file-pages.spec.js`, serve a real font. Copy a small OFL font the repo already ships (`find boards/public -name '*.woff2' | head -3`) into `boards/tests/fixtures/` only if none is reachable by URL. Then expect:
    - `.fpg-spec .fpg-spec-fam` to have the font's family name;
    - `getComputedStyle(.fpg-spec-aa).fontFamily` to start with `soleil-font-`.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.**
  - `fontLoad.js` per the interface.
  - `FontPage` in FamilyFace: design width 640.
    - Layout: a grid `auto 1fr`, 34px/40px padding.
    - `.fpg-spec-aa`: "Aa" at 210px in the font.
    - On the right: the family at 34px, the style at 12px caps `.1em` `#8a8a90`, and the sample "The quick brown fox jumps over the lazy dog" at 25px.
    - Across the bottom: an alphabet line `ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789` at 19px over a 1px `#e4e4e8` rule.
    - Every sample's `font-family` is `${cssFamily}, var(--font-sans)` with `font-weight: normal`. The face is the file itself, so its own weight draws.
    - While loading, the white sheet. On null, `fallback`.
- [ ] **Step 4: Run them and watch them pass.** Run `npm test` and the spec.
- [ ] **Step 5: Commit** (pushed with B3).

### Task B3: Trying the font in Quick look

**Files:**
- Modify: `boards/src/components/clusterBrowser/FileStages.jsx` (a `FontStage`; dispatch `font`), `fileStages.css` (`.fst-font*` from ql.css `.qfont`, lines 68+)
- Modify: `boards/scripts/gen-docs.mjs` (FACTS `fontFaceMax: \`${FONT_FACE_MAX_BYTES / MB} MB\``), `boards/content/docs/files/index.md`
- Test: `tests/file-pages.spec.js`

**Design (`ql.html` `fontStage`):**
- 1080px sheet.
- Header: the family at 54px in the font, on the left; facts on the right in a `k v` grid: Style "Black, 900" (style plus weight when known), Format "TrueType · 312 KB", Licence (only when known).
- "Type to try it": a label, then the size slider. The field is a `contenteditable="plaintext-only"` div (or a textarea styled flat) seeded with "The quick brown fox jumps over the lazy dog".
  - Font size follows the slider: `<input type="range" min="12" max="160" value="66">`, with `accent-color: var(--ink-2)` and never gold.
  - The px value is shown beside it.
- Waterfall: 12/16/24/36/48 px of the typed sample, each line with its size in a 28px mono gutter.
- Glyphs: `A–Z a–z 0–9 & ? ! @` in a grid of 56px cells, 32px glyphs.
- Keyboard:
  - Typing in the field must not trigger Quick look's keys. Stop propagation of `keydown` inside the field, except `Escape`.
  - `Space` types a space there. Check how QuickLook listens: if it is `window` keydown, check `e.target.closest('.fst-font-try')` in QuickLook's handler instead. That is a one-line guard in QuickLook, so add it there, and note it in the commit.

- [ ] **Step 1: Write the failing spec.** Open the font in Quick look, then:
  - expect `.fst-font-fam` to have the family;
  - type into `.fst-font-try` (`'Hello'`) and expect the waterfall's first line to read `Hello`;
  - press `Space` inside the field and expect Quick look still open;
  - set the slider to 120 and expect the field's computed font-size `120px`;
  - press `Escape` and expect Quick look closed.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement** `FontStage` and the QuickLook guard.
- [ ] **Step 4: Add the docs.** In the table: `| Fonts (.ttf, .otf, .woff, .woff2, .ttc) | A specimen of the font: Aa, its name and style, a sample line and its alphabet |`. Under Quick look: `A font opens as a page to try it on: type your own words and change the size, with the font set at five sizes and its letters and numbers below. A font over {{fact:fontFaceMax}} keeps its icon.` Then run docs:build and docs:check.
- [ ] **Step 5: Run everything, commit B1–B3, push.** Message: "A font's card is a specimen of it, Aa in the font with its name, style, a sample line and its alphabet, and Quick look opens it as a page to try it on: type your own words, change the size from 12 to 160 px, see it at five sizes and every letter and number; its style, format, size and licence are read from the font itself".

---

## Part C: Email (.eml, .msg)

What users see:
- An email drops as a page: a letter with its subject, From / To / Date, a rule and its first paragraphs. Its strip reads "2 attachments" when it has them.
- Quick look shows the email as its sender laid it out, with:
  - pictures from the web hidden behind "Show pictures";
  - its attachments as chips that download;
  - "Put both on board" / "Put it on board" / "Put all 5 on board", which places them on the board as if dropped.
- Nothing in an email can run script.
- Nothing loads from the web until the viewer clicks Show pictures.

### Task C1: Outlook .msg (pure)

**Files:**
- Create: `boards/src/lib/msgRead.js`
- Test: `boards/src/lib/msgRead.test.mjs`, with an in-test CFB writer

**Interfaces:**
- Produces: `readMsg(bytes: Uint8Array) → { subject, from: {name, address}|null, to: {name, address}[], cc: {name, address}[], date: string|null (ISO), text: string, html: string, attachments: {filename, mimeType, contentId, content: Uint8Array}[] }`
  - It throws `Error('not_msg')` without the CFB signature.
  - Every read is bounds-checked, every chain is cut at a cycle (a visited set), and the walk visits at most 4096 directory entries.

**Format notes (MS-CFB, MS-OXMSG):**
- **Header, 512 bytes:**
  - signature `D0 CF 11 E0 A1 B1 1A E1`;
  - `uint16` sector shift at `0x1E` (9 → 512 B; 12 → 4096 B);
  - mini sector shift at `0x20` (6 → 64 B);
  - FAT sector count `0x2C`, first directory sector `0x30`, mini stream cutoff `0x38` (4096);
  - first mini FAT sector `0x3C`, mini FAT count `0x40`;
  - first DIFAT sector `0x44`, DIFAT count `0x48`;
  - 109 DIFAT entries at `0x4C`.
  - Everything is little-endian.
- **Sectors:**
  - Sector `n` starts at `(n + 1) << shift`.
  - The FAT is the concatenation of the sectors the DIFAT lists. A DIFAT sector holds `size/4 − 1` entries, plus the next DIFAT sector in its last slot.
  - A chain follows `fat[n]` until `0xFFFFFFFE`.
- **Directory:** 128-byte entries along the directory chain.
  - Name: UTF-16LE in the first 64 bytes, with its byte length incl. NUL at `0x40`.
  - Type at `0x42` (1 storage, 2 stream, 5 root).
  - Left `0x44`, right `0x48`, child `0x4C`, start sector `0x74`, size `0x78` (low 32 bits).
  - A storage's children are the tree under `child`, walked through left and right.
- **Mini stream:**
  - The root entry's chain holds the mini stream.
  - A stream smaller than the cutoff lives there in 64-byte mini sectors, chained through the mini FAT, which is itself a regular chain from `0x3C`.
- **MAPI properties:**
  - A property's stream is named `__substg1.0_PPPPTTTT` (hex, uppercase).
    - `001F` = UTF-16LE string.
    - `001E` = 8-bit string in the message codepage (`3FFD`, a PT_LONG in `__properties_version1.0`; 65001 → utf-8; 1250–1258 → `windows-NNNN`; else windows-1252).
    - `0102` = binary.
  - `__properties_version1.0` has a header (32 bytes at the root, 8 bytes in a recipient or attachment storage), then 16-byte records: `uint32 tag` (type low 16, id high 16), `uint32 flags`, `8 bytes value`. A PT_SYSTIME (`0x0040`) value is a FILETIME: 100 ns since 1601-01-01.
- **Message:**
  - Subject `0037`.
  - Sender name `0C1A`; sender address `5D01` (SMTP), else `0C1F`.
  - Body `1000`; HTML `1013` (binary in a charset, or a string; decode binary as utf-8 unless it declares a `charset=` in its first 1 KB).
  - Date `0039` (submit time), else `0E06` (delivery time).
- **Recipients** (`__recip_version1.0_#XXXXXXXX`):
  - name `3001`; address `39FE`, else `3003`;
  - type `0C15` (PT_LONG in its properties stream: 1 To, 2 Cc, 3 Bcc; Bcc is dropped).
  - With no recipient storages, fall back to splitting the display strings `0E04` (To) and `0E03` (Cc) on `;`.
- **Attachments** (`__attach_version1.0_#XXXXXXXX`):
  - data `3701` (binary; skip it when `3701` is a storage, which is an embedded message);
  - filename `3707`, else `3704`; mime `370E`; content id `3712`.

- [ ] **Step 1: Write the failing tests.** The test writes a CFB, version 3, 512-byte sectors:
  - All streams go in the regular FAT. Set the cutoff to 0 in the written header, so no mini stream is needed. Then add a second test with the cutoff at 4096, small streams in the mini stream and the root's chain holding them, which is the common real-world shape.
  - A ~120-line helper `writeCfb(tree)` takes `{ name, children? , data? }` and lays out directory entries as a degenerate tree (each sibling as the right child of the previous). Put the helper in `boards/src/lib/testCfb.mjs` (test-only; no app code imports it).

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMsg } from './msgRead.js';
import { writeCfb, utf16le, props } from './testCfb.mjs';

const MSG = (mini) => writeCfb({ name: 'Root Entry', children: [
  { name: '__substg1.0_0037001F', data: utf16le('Re: Day 4 call times') },
  { name: '__substg1.0_0C1A001F', data: utf16le('Ines Carvalho') },
  { name: '__substg1.0_5D01001F', data: utf16le('ines@example.com') },
  { name: '__substg1.0_1000001F', data: utf16le('Crew call is 05:30.\r\n\r\nSee you at the dock.') },
  { name: '__properties_version1.0', data: props(32, [[0x00390040, 133000000000000000n]]) },
  { name: '__recip_version1.0_#00000000', children: [
    { name: '__substg1.0_3001001F', data: utf16le('Mara Ellison') },
    { name: '__substg1.0_39FE001F', data: utf16le('mara@example.com') },
    { name: '__properties_version1.0', data: props(8, [[0x0C150003, 1n]]) },
  ] },
  { name: '__attach_version1.0_#00000000', children: [
    { name: '__substg1.0_3707001F', data: utf16le('call-sheet.pdf') },
    { name: '__substg1.0_370E001F', data: utf16le('application/pdf') },
    { name: '__substg1.0_37010102', data: new TextEncoder().encode('%PDF-1.4 tiny') },
  ] },
] }, { miniCutoff: mini ? 4096 : 0 });

for (const mini of [false, true]) {
  test(`an Outlook message reads its subject, people, date, body and attachments (${mini ? 'mini stream' : 'big sectors'})`, () => {
    const m = readMsg(MSG(mini));
    assert.equal(m.subject, 'Re: Day 4 call times');
    assert.deepEqual(m.from, { name: 'Ines Carvalho', address: 'ines@example.com' });
    assert.deepEqual(m.to, [{ name: 'Mara Ellison', address: 'mara@example.com' }]);
    assert.equal(m.date, new Date(Number((133000000000000000n - 116444736000000000n) / 10000n)).toISOString());
    assert.match(m.text, /^Crew call is 05:30\./);
    assert.equal(m.attachments.length, 1);
    assert.equal(m.attachments[0].filename, 'call-sheet.pdf');
    assert.equal(new TextDecoder().decode(m.attachments[0].content), '%PDF-1.4 tiny');
  });
}

test('anything that isn\'t a compound file is refused; a looping chain ends', () => {
  assert.throws(() => readMsg(new Uint8Array(600)), /not_msg/);
  const bad = MSG(false); // point the directory chain at itself
  const dv = new DataView(bad.buffer); const dirSector = dv.getUint32(0x30, true);
  const fatSector = dv.getUint32(0x4c, true);
  dv.setUint32(((fatSector + 1) << 9) + dirSector * 4, dirSector, true);
  assert.doesNotThrow(() => readMsg(bad));
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `node --test src/lib/msgRead.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `msgRead.js` per the notes, and `testCfb.mjs`'s writer. Both tests must pass with the same reader code; the mini-stream case is the one real files use.
- [ ] **Step 4: Run them and watch them pass.** Expected: PASS.
- [ ] **Step 5: Commit** (no push). Message: "The piece an Outlook message's card reads it with: subject, sender, recipients, date, text and HTML bodies and attachments out of a .msg's compound file, every chain bounds-checked and cut at a loop (nothing visible yet)".

### Task C2: One letter shape for .eml and .msg

**Files:**
- Modify: `boards/package.json`
  - Add `postal-mime` at the newest version published ≥14 days before install: `npm view postal-mime time --json`. On 2026-10-27 that is `4.0.5`; the 4.1.x releases are from 10-21/22.
  - Pin it exactly, with no caret: `npm install --save-exact postal-mime@4.0.5`.
- Create: `boards/src/lib/mailRead.js`; Test: `boards/src/lib/mailRead.test.mjs`
- Modify: `boards/src/lib/fileFaceLimits.js`: `MAIL_CARD_MAX_BYTES = 4 MB`, `MAIL_HEAD_BYTES = 256 KB`, `MAIL_MAX_BYTES = 50 MB`
- Modify: `boards/src/lib/fileView.js`: `FAMILY_EXTS.mail = ['eml', 'msg']`; `fileFamily`: `message/rfc822` or `application/vnd.ms-outlook` → `'mail'`

**Interfaces:**
- Consumes: `readMsg` (C1)
- Produces:
  - `async readMail(bytes: Uint8Array, ext: 'eml'|'msg') → Letter`, where `Letter = { subject, from, to, cc, date, text, html, attachments: {filename, mimeType, contentId, size, content: Uint8Array}[] }`.
    - `text` is the plain body, or the HTML's text when there is no plain part.
    - Attachments that the HTML references by `cid:` are not in `attachments`; they're in `inline: Map<cid, {mimeType, content}>`.
  - `letterParagraphs(text, max): string[]`. Blank-line separated; quoted lines (`>`) dropped from the card; whitespace collapsed.

- [ ] **Step 1: Verify postal-mime's API** in `node_modules/postal-mime/README.md`. Expected:
  - `PostalMime.parse(input)` takes a Uint8Array, ArrayBuffer or string;
  - it resolves `{ subject, from: {name, address}, to: [...], cc: [...], date, text, html, attachments: [{ filename, mimeType, disposition, related, contentId, content }] }`.
  - Record any difference (e.g. `content` as an ArrayBuffer, or `date` format) in the module's header comment, and adapt the mapping.
- [ ] **Step 2: Write the failing tests** with an inline .eml:

```js
const EML = [
  'From: Ines Carvalho <ines@example.com>', 'To: Mara Ellison <mara@example.com>', 'Cc: Theo Park <theo@example.com>',
  'Subject: =?UTF-8?Q?Re:_Day_4_call_times_=E2=80=94_dock?=', 'Date: Mon, 13 Oct 2026 21:04:00 +0000',
  'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b1"', '',
  '--b1', 'Content-Type: multipart/alternative; boundary="b2"', '',
  '--b2', 'Content-Type: text/plain; charset=utf-8', '', 'Crew call is 05:30.', '', '> Can we push crew call?', '',
  '--b2', 'Content-Type: text/html; charset=utf-8', '', '<p>Crew call is <b>05:30</b>.</p><img src="cid:logo1"><img src="https://tracker.example/p.gif">', '',
  '--b2--',
  '--b1', 'Content-Type: image/png', 'Content-ID: <logo1>', 'Content-Disposition: inline', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgo=', '',
  '--b1', 'Content-Type: application/pdf; name="call-sheet.pdf"', 'Content-Disposition: attachment; filename="call-sheet.pdf"', 'Content-Transfer-Encoding: base64', '', 'JVBERi0xLjQ=', '',
  '--b1--', '',
].join('\r\n');
test('an .eml reads as a letter: decoded subject, people, date, both bodies, its one real attachment', async () => {
  const m = await readMail(new TextEncoder().encode(EML), 'eml');
  assert.equal(m.subject, 'Re: Day 4 call times — dock');
  assert.deepEqual(m.from, { name: 'Ines Carvalho', address: 'ines@example.com' });
  assert.deepEqual(m.cc, [{ name: 'Theo Park', address: 'theo@example.com' }]);
  assert.equal(m.date, '2026-10-13T21:04:00.000Z');
  assert.match(m.html, /cid:logo1/);
  assert.deepEqual(m.attachments.map((a) => a.filename), ['call-sheet.pdf']);
  assert.equal(m.inline.get('logo1').mimeType, 'image/png');
  assert.deepEqual(letterParagraphs(m.text, 5), ['Crew call is 05:30.']);
});
test('a .msg reads through msgRead into the same shape', async () => { /* reuse testCfb's MSG(true) and assert subject + attachments */ });
```

  Write the second test in full using `writeCfb` from `testCfb.mjs`, with the same message as C1.
- [ ] **Step 3: Run them and watch them fail.** Then implement `mailRead.js`:
  - eml → `PostalMime.parse`, then map;
  - msg → `readMsg`, then map;
  - split inline from attached by `contentId` appearing as `cid:<id>` in the html (case-insensitive, `<>` stripped);
  - `date` → ISO, or null.
- [ ] **Step 4: Run them and watch them pass.** Then `npm test` and `npx vite build`. postal-mime is only reachable from lazy code (FamilyFace's mail branch, C3), so check `bundleBudget` that appJs is unchanged.
- [ ] **Step 5: Commit** (no push). Message: "The piece an email's card reads it with: an .eml through postal-mime and an Outlook .msg through msgRead into one letter, its subject decoded, its people, date, plain and HTML bodies, its attachments, and the pictures its HTML shows from inside the message set apart from them (nothing visible yet)".

### Task C3: The letter card, the email in Quick look, attachments to the board

**Files:**
- Create: `boards/src/lib/fileActions.js`; Test: `boards/src/lib/fileActions.test.mjs`
- Modify: `FamilyFace.jsx`:
  - a `LetterPage` branch: reads the whole file when `sizeBytes ≤ MAIL_CARD_MAX_BYTES`; an .eml over it reads the `MAIL_HEAD_BYTES` head; an .msg over it renders `fallback`;
  - an `onMeta` prop that FileCard uses for the strip's "N attachments";
  - `familyGlyph('mail')` → `EnvelopeSimple` (add it to icons.js).
- Modify: `familyFace.css` (`.fpg-mail*` from kit.css 101-108)
- Modify: `FileCard.jsx` (`faceMeta` state from `onMeta`; strip shows it over `metaText`)
- Modify: `FileStages.jsx` (`MailStage`; dispatch `mail`), `fileStages.css` (`.fst-mail*` from ql.css `.qmail`)
- Modify: `QuickLook.jsx` (pass `canEditItem` result as `canPut` to Stage → FileStage)
- Modify: `boards/src/App.jsx`. ListAgents first and message the sessions that hold App.jsx. The change is one `useEffect` next to `dropFilesOnCluster` (~4380):

```js
// Quick look's "Put both on board" (an email's attachments) and "Unpack into
// clusters" (a zip) reach the app through lib/fileActions.js.
useEffect(() => setFileActions({ putFiles: (boardId, files) => dropFilesOnCluster(boardId, files) }), [dropFilesOnCluster]);
```

  `dropFilesOnCluster` is re-created every render. Use the ref pattern App already uses for callbacks: grep `Ref.current = ` near it, and register a stable function that calls `dropFilesOnClusterRef.current`.
- Modify: `boards/src/local/LocalBoardsApp.jsx`. Under `import.meta.env.DEV`, register recorders: `setFileActions({ putFiles: (b, f) => window.__soleilFileActions.calls.push(['putFiles', b, f.map((x) => x.name)]), ... })`.
- Modify: `listItem.js` (`FAMILY_LABELS.mail = 'Email'`), `gen-docs.mjs` (FACTS `mailMaxSize`), `content/docs/files/index.md`
- Test: `tests/file-pages.spec.js`

**Interfaces:**
- Consumes: `readMail`, `letterParagraphs` (C2); `MAIL_*` limits; `deliverFile(blob, name)` (`lib/exportDelivery.js:49`)
- Produces:
  - `setFileActions(actions) → unregister`
  - `canPutFiles()`, `putFiles(boardId, files: File[])`
  - `canUnpackZip()`, `unpackZip(boardId, file: File)`. Registered by Part E.

**MailStage design (`ql.html` `mailStage`, `ql.css` `.qmail`):**
- An 860px sheet, flex column.
- Head: the subject at 24px/700; then the sender's initials in a 36px circle (`#ececef`, ink `#3a3a40`, never gold), "**Name** <address>" with "To … · Cc …" under it, and the date on the right (`toLocaleString` with the date and time short).
- **The body:**
  - **HTML:**
    1. `DOMPurify.sanitize(html, { WHOLE_DOCUMENT: false, FORBID_TAGS: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base'], FORBID_ATTR: ['srcset'] })`.
    2. `new DOMParser().parseFromString(clean, 'text/html')`. In that inert document:
       - every `a[href]` gets `target=_blank rel="noopener noreferrer"`;
       - every `img[src^="cid:"]` gets a `data:` URL from `inline`, with at most 10 MB of inline pictures in total, the rest left broken;
       - `hasRemote` = any `img[src]`, `[background]` or `style` with `url(` not starting with `data:`.
    3. `srcdoc` = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:${shown ? ' https: http:' : ''}"><meta name="referrer" content="no-referrer"><style>html{color-scheme:light}body{margin:0;padding:4px 2px;font:15px/1.55 -apple-system,system-ui,sans-serif;color:#222226;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>` + `doc.body.innerHTML`.
    4. `<iframe className="fst-mail-frame" title={subject} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={srcdoc} />`. No `allow-scripts`, no `allow-same-origin`. It fills the space between the head and the attachments, `flex: 1; min-height: 0`, and scrolls inside.
  - **Plain text only:** a `div` with `white-space: pre-wrap`, no iframe.
- The notice: `hasRemote && !shown` shows the `.fst-top` notice: EyeSlash icon (`EyeOff` in icons.js), "Pictures from the web are hidden in this email.", and a `Show pictures` button. It flips `shown`, which rebuilds `srcdoc` with the wider CSP.
- **Attachments** (`attachments.length > 0`):
  - A label "2 attachments", then chips: an icon by mime (image → `FileImage`, pdf → `FilePdf`, else `File`), the name, `humanSize(size)`, and a download button → `deliverFile(new Blob([content], { type: mimeType }), filename)`.
  - Then the put button, when `canPut && canPutFiles()`. Its label: 1 → "Put it on board", 2 → "Put both on board", n → `Put all ${n} on board`. It calls `putFiles(item.boardId, attachments.map((a) => new File([a.content], a.filename, { type: a.mimeType })))`, then closes Quick look (`onClose`) so the viewer sees them land.
- Over `MAIL_MAX_BYTES`: `fallback`, plus a line under it: "This email is too big to open here." and Download.

- [ ] **Step 1: Write the failing tests.**
  - `fileActions.test.mjs`: register, call, unregister. An unregister by a stale registrant doesn't clear a newer one.
  - Spec:
    - Serve the EML from C2 as `qa-files/Re Day 4.eml`.
    - Card: expect `.fpg-mail-subj` to have `Re: Day 4 call times — dock`, the strip to read `1 attachment`, and `.fpg-mail` to hold no `img`.
    - Quick look: expect the `iframe.fst-mail-frame` `sandbox` attribute to equal `allow-popups allow-popups-to-escape-sandbox`, and its `srcdoc` to contain `img-src data:;` and not `https:`.
    - Expect `.fst-top` to have `Pictures from the web are hidden in this email.`. Click `Show pictures` and expect `srcdoc` to contain `img-src data: https: http:`.
    - Expect the chip `call-sheet.pdf`. Click "Put it on board" and expect `window.__soleilFileActions.calls` to equal `[['putFiles', <boardId>, ['call-sheet.pdf']]]`.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement** per the design.
- [ ] **Step 4: Add the docs.** In the table: `| Email (.eml, .msg) | A letter: its subject, who it's from and to, the date and its first lines |`. Under Quick look: `An email opens as it was sent, with its attachments below it to download or put on the board. Pictures from the web stay hidden until you choose **Show pictures**, and nothing in an email can run. An email over {{fact:mailMaxSize}} keeps its icon.` Then docs:build and docs:check.
- [ ] **Step 5: Run everything, commit C1–C3, push.** Run `npm test`, the specs (file-pages, quicklook-escape, doc-card-face), and `vite build` + the budget. Message: "An email's card is a letter, its subject, who it's from and to, the date and its first lines, and Quick look opens it as it was sent: pictures from the web stay hidden until Show pictures, nothing in it can run, and its attachments sit below it to download one by one or put on the board together".

---

## Part D: Design files (.sketch .fig .xd .procreate .kra .ora .afdesign .afphoto .afpub .indd .ai .eps)

What users see:
- A design file drops at 320×240 while its picture is made ("Making its picture" on the card, as a document's).
- When the picture comes, the card takes the picture's shape at the card's width. It keeps its name strip and stays a file card, as a document does.
- A small picture keeps the card small. InDesign keeps only a thumbnail, so its card is at most 1.6× the picture's own size, and never under 160px wide.
- A file with no picture inside it (an old Figma file, a PostScript-only .ai, an EPS with no preview) goes back to a file card's 240×150 with its app's icon.
- Quick look shows the picture with zoom, as a photo's.

**Where pictures live inside each format:**

| Format | Container | Picture |
|---|---|---|
| .sketch | zip | `previews/preview.png` |
| .xd | zip | `preview.png`, else `thumbnail.png` |
| .kra | zip | `mergedimage.png` (full size), else `preview.png` |
| .ora | zip | `mergedimage.png`, else `Thumbnails/thumbnail.png` |
| .procreate | zip | `QuickLook/Thumbnail.png` (the file can be GBs of timelapse; the picture is small) |
| .fig | zip (Figma since 2023; older files are raw "fig-kiwi" with no picture) | `thumbnail.png` |
| .afdesign/.afphoto/.afpub | Serif's own | the largest embedded PNG (`89 50 4E 47 0D 0A 1A 0A` … `IEND AE 42 60 82`) |
| .indd | Adobe's own | the XMP thumbnail: base64 JPEG in `<xmpGImg:image>` (with `&#xA;` line breaks) |
| .ai | PDF since CS (starts `%PDF`); older ones PostScript | page 1 via pdftoppm; else the XMP thumbnail |
| .eps | PostScript, maybe in a DOS EPS binary header `C5 D0 D3 C6` | the header's TIFF preview (offset at byte 20, length at 24, LE); else the XMP thumbnail; else none (no Ghostscript on the box) |

**Box reading strategy:**
- A zip-based file is read in **rounds of Range GETs** into a sparse local copy:
  1. the tail (the end of central directory);
  2. the central directory;
  3. one entry.
- So a 4 GB .procreate costs a few MB.
- Under 8 MB, the box just downloads the whole file in round 0.
- Every other format downloads whole, capped at `VIEW_MAX_BYTES`, as photos do.

### Task D1: Design files are a view kind

**Files:**
- Modify: `boards/src/lib/fileView.js`:
  - `DESIGN_EXTS`.
  - `VIEW_KINDS = ['image', 'doc', 'design']` and `isViewKind(kind)`. E adds `'archive'`.
  - `CARD_VIEW_KINDS = ['doc', 'design']` and `isCardViewKind(kind)`. These kinds stay file cards and show a picture.
  - `viewKindOfKey`: design exts → `'design'`.
  - `drawsNowhere`: any view kind but `'image'` → true.
  - `viewKeyOfCard`: `isCardViewKind(kind) || turnsIntoPicture(card) ? key : ''`.
  - `fileFamily`: design exts → `'design'`. Check this BEFORE the type guard, because `.eps` arrives as `image/x-eps` and `.ora` as `image/openraster`.
  - `DESIGN_DROP = Object.freeze({ w: 320, h: 240 })`; `fileDropSize`: design → `DESIGN_DROP`.
- Modify: `boards/src/lib/fileIngest.js`: `isImage` must be false for design exts, whatever the type (`&& fileFamily(ext) !== 'design'`).
- Modify: `boards/src/worker-playCopy.js:100`: `const isView = isViewKind;`. Import it from `./lib/fileView.js`, which the Worker already imports from.
- Modify: `media/src/index.js:73`: `if (isViewKind(job.kind)) await processView(job)`. Import from `../boards/src/lib/fileView.js` the way `view.js` already does; check its import line.
- Test: `fileView.test.mjs`, `fileIngest.test.mjs`. In `media/test/args.test.mjs` or `view.test.mjs`, add `decoderOf` for design exts (D5).

- [ ] **Step 1: Write the failing tests.**

```js
test('design files are their own view kind, drawn by no browser, and stay file cards with a picture', () => {
  for (const ext of ['sketch', 'fig', 'xd', 'procreate', 'kra', 'ora', 'afdesign', 'afphoto', 'afpub', 'indd', 'ai', 'eps']) {
    assert.equal(viewKindOfKey(`u/w/file.${ext}`), 'design', ext);
    assert.equal(drawsNowhere(`u/w/file.${ext}`), true, ext);
    assert.equal(fileFamily(ext, 'image/x-eps'), 'design', ext);
    assert.deepEqual(fileDropSize(ext), DESIGN_DROP, ext);
  }
  assert.deepEqual(DESIGN_DROP, { w: 320, h: 240 });
  assert.deepEqual(VIEW_KINDS, ['image', 'doc', 'design']);
  assert.equal(isCardViewKind('design'), true);
  assert.equal(isCardViewKind('image'), false);
  const card = { kind: 'file', fileSrc: 'r2:u/w/Title card v3.sketch' };
  assert.equal(viewKeyOfCard(card), 'u/w/Title card v3.sketch');
  assert.equal(turnsIntoPicture(card), false);
});
// fileIngest.test.mjs
test('a design file is a file card at a design file\'s size whatever type the system gives it', () => {
  for (const [name, type] of [['flyer.eps', 'image/x-eps'], ['layers.ora', 'image/openraster'], ['poster.ai', 'application/postscript'], ['Title card v3.sketch', '']]) {
    const c = classifyDropFile(f(name, type));
    assert.deepEqual([c.route, c.w, c.h], ['file', 320, 240], name);
  }
});
```

  Also remove `'a.ai'` from the existing "not a view" assertion in `fileView.test.mjs` (around line 12-24). It is now a design file.
- [ ] **Step 2: Run them and watch them fail.** Then implement. Run `cd boards && npm test` and `cd media && npm test`. Expected: PASS. `viewArgs.decoderOf('sketch')` is still null until D5, so a design job is refused `unsupported`, which is harmless. Don't push D1 before D5 is deployed.
- [ ] **Step 3: Commit** (no push). Message: "Design files (.sketch, .fig, .xd, .procreate, .kra, .ora, Affinity's three, .indd, .ai and .eps) are their own kind of view in lib/fileView.js, which the app, the Worker and the converter share, and a dropped one is a file card at a design file's size however the system types it (nothing visible yet: nothing asks for their pictures until the converter can make them)".

### Task D2: A sparse copy and which entry is the picture (box, pure)

**Files:**
- Create: `media/src/rangeFile.js`, `media/src/zipPick.js`
- Modify: `boards/src/lib/zipRead.js`. Export `zipDirectoryBounds(blob) → { cdStart, cdEnd, entries, zip64 }`, factored out of the start of `readZipDirectory`, which then calls it. No behaviour change.
- Test: `media/test/rangeFile.test.mjs`, `media/test/zipPick.test.mjs`. Add a `zipDirectoryBounds` case to `boards/src/lib/zipRead.test.mjs` (find the existing test file with `ls boards/src/lib/zipRead*`).

**Interfaces:**
- Produces:
  - **`rangeFile.js`:**
    - `class NeedRange extends Error { ranges: [start, end][] }`
    - `mergeRanges(ranges): [start, end][]` (sorted, touching ranges merged)
    - `covered(have, start, end): boolean`
    - `class RangeFile { constructor(path, have, size, start = 0, end = size) }`
      - Blob-like: `size`; `slice(a, b)`, relative like Blob; `async arrayBuffer()` (throws `NeedRange([[abs a, abs b]])` when not covered); `stream()` (checks coverage up front, then reads 1 MB pieces with `fs.read`).
      - It opens the file read-only per call and closes it in `finally`.
  - **`zipPick.js`:**
    - `ZIP_TAIL_BYTES = 65557 + 20` (EOCD + max comment + zip64 locator)
    - `ZIP_CD_MAX_BYTES = 64 MB`, `ENTRY_MAX_BYTES = 256 MB`, `ZIP_FETCH_MAX_BYTES = 1 GB`
    - `entryWindow(entry, size): [start, end]` = `[entry.offset, min(size, entry.offset + 30 + 65535 * 2 + entry.compressedSize)]`
    - `DESIGN_PICTURES` (the table above) and `designEntry(entries, ext): entry|null`
      - Exact path first (case-insensitive), in the table's order.
      - Else the largest `.png`/`.jpg`/`.jpeg` whose base name contains `preview` or `thumb`.
      - Never a directory, never an entry over `ENTRY_MAX_BYTES`, and never an encrypted one (`flags & 1`).

- [ ] **Step 1: Write the failing tests.**

```js
// media/test/rangeFile.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RangeFile, NeedRange, mergeRanges, covered } from '../src/rangeFile.js';

test('ranges merge when they touch or overlap, and coverage needs every byte', () => {
  assert.deepEqual(mergeRanges([[10, 20], [0, 5], [5, 8], [18, 30]]), [[0, 8], [10, 30]]);
  assert.equal(covered([[0, 8], [10, 30]], 2, 8), true);
  assert.equal(covered([[0, 8], [10, 30]], 7, 11), false);
  assert.equal(covered([], 0, 0), true);
});

test('a sparse copy reads what it holds and asks for what it doesn\'t, as absolute ranges from any slice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rf-'));
  const path = join(dir, 'sparse.bin');
  const bytes = Buffer.alloc(1000); bytes.write('HEAD', 0); bytes.write('TAIL', 996);
  await writeFile(path, bytes);
  const rf = new RangeFile(path, [[0, 100], [900, 1000]], 1000);
  assert.equal(Buffer.from(await rf.slice(0, 4).arrayBuffer()).toString(), 'HEAD');
  assert.equal(Buffer.from(await rf.slice(-4).arrayBuffer()).toString(), 'TAIL');
  const mid = rf.slice(800, 1000).slice(50, 150);
  await assert.rejects(mid.arrayBuffer(), (e) => e instanceof NeedRange && e.ranges[0][0] === 850 && e.ranges[0][1] === 950);
  const chunks = []; for await (const c of rf.slice(900, 1000).stream()) chunks.push(Buffer.from(c));
  assert.equal(Buffer.concat(chunks).length, 100);
});
```

```js
// media/test/zipPick.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designEntry, entryWindow, ENTRY_MAX_BYTES } from '../src/zipPick.js';

const e = (path, size = 1000, extra = {}) => ({ path, dir: path.endsWith('/'), size, compressedSize: size, offset: 0, flags: 0, ...extra });
test('each design format\'s picture is found by its own path first, then by name', () => {
  assert.equal(designEntry([e('Data/doc.json'), e('previews/preview.png')], 'sketch').path, 'previews/preview.png');
  assert.equal(designEntry([e('preview.png', 10), e('mergedimage.png', 9000)], 'kra').path, 'mergedimage.png');
  assert.equal(designEntry([e('Thumbnails/thumbnail.png')], 'ora').path, 'Thumbnails/thumbnail.png');
  assert.equal(designEntry([e('quicklook/thumbnail.png')], 'procreate').path, 'quicklook/thumbnail.png');
  assert.equal(designEntry([e('thumbnail.png'), e('canvas.fig')], 'fig').path, 'thumbnail.png');
  assert.equal(designEntry([e('a/thumb_small.jpg', 10), e('b/big-preview.png', 500)], 'xd').path, 'b/big-preview.png');
  assert.equal(designEntry([e('canvas.fig')], 'fig'), null);
  assert.equal(designEntry([e('previews/preview.png', ENTRY_MAX_BYTES + 1)], 'sketch'), null);
  assert.equal(designEntry([e('previews/preview.png', 10, { flags: 1 })], 'sketch'), null);
});
test('an entry\'s window covers its local header at its longest and its data, inside the file', () => {
  assert.deepEqual(entryWindow({ offset: 100, compressedSize: 50 }, 1_000_000), [100, 100 + 30 + 131070 + 50]);
  assert.deepEqual(entryWindow({ offset: 100, compressedSize: 50 }, 500), [100, 500]);
});
```

- [ ] **Step 2: Run them and watch them fail.** Then implement both modules and the `zipDirectoryBounds` refactor.
- [ ] **Step 3: Run them and watch them pass.** Run `cd media && npm test` and `cd boards && npm test` (`zipRead.test.mjs` must still pass unchanged).
- [ ] **Step 4: Commit** (no push). Message: "The converter's pieces for reading a zip it holds only part of: a sparse copy that reads the byte ranges it has and names the ones it needs, and which entry inside a .sketch, .fig, .xd, .procreate, .kra or .ora is its picture (nothing visible yet)".

### Task D3: Reading a remote zip in rounds (box)

**Files:**
- Create: `media/src/zipJob.js` (root: fetches) and `media/src/zipMain.js` (child: parses)
- Modify: `media/src/ffmpeg.js`. `run()` gains `maxBytes` (cap captured stdout; kill the group and reject `output_too_large` past it).
- Modify: `media/Dockerfile` and `media/deploy.sh`. COPY `boards/src/lib/zipRead.js` and `boards/src/lib/zipStore.js` next to the two lib files they already copy, at the same relative paths, so `zipMain.js` imports `../../boards/src/lib/zipRead.js` exactly as `view.js` imports `fileView.js`. Check `view.js`'s import line and mirror it.
- Test: `media/test/zipJob.test.mjs`, with a local `http.createServer` serving a fixture zip with Range (206) and counting the bytes served

**Interfaces:**
- Consumes: `RangeFile`, `NeedRange`, `mergeRanges`, `covered` (D2); `designEntry`, `entryWindow`, the limits (D2); `zipDirectoryBounds`, `readZipDirectory`, `openEntry` (zipRead.js)
- Produces:
  - `readZipInRounds({ url, size, mode, ext, work, fetchImpl = fetch, runChild = defaultRunChild }) → { made: { path, entry, via: 'zip' } } | throws Refused(reason)`
    - `mode` is `'design'`; E adds `'sheet'`.
  - `zipMain.js` CLI: `node zipMain.js <mode> <ext> <sparsePath> <havePath> <size> <outDir>`. It prints ONE JSON line:
    - `{ need: [[s, e], …] }`
    - `{ made: { file, entry } }` (`file` is in outDir)
    - `{ refused: 'no_picture' | 'not_zip' | 'too_big' | 'crc' | 'encrypted' }`

**Rounds:**
- **Round 0:**
  - The sparse file is created with flag `'wx'` and truncated to `size`; the fd is held open for writes.
  - If `size ≤ 8 MB`, fetch `[0, size)`; else fetch `[max(0, size − ZIP_TAIL_BYTES), size)`.
- **Each round n (1–5):**
  1. Write `have-n.json` (flag `'wx'`, a fresh name each round, so a child can't swap the root's file).
  2. Run the child: `run(process.execPath, ['--max-old-space-size=1024', ZIP_MAIN, …], { isolate: true, capture: true, maxBytes: 1 MB, timeoutMs: 120_000 })`.
  3. Parse its last stdout line, then:
     - `made` → validate that `file` is a plain name inside `outDir` (`basename(file) === file`), then return it;
     - `refused` → throw `Refused`;
     - `need` → validate every range: integers, `0 ≤ s < e ≤ size`, total new bytes ≤ `ZIP_FETCH_MAX_BYTES` across the job (else `Refused('too_large')`); fetch them, each one GET with `Range: bytes=s-(e-1)`, demanding a 206 and exactly `e − s` bytes; write at offset `s`; merge into `have`.
- After round 5 with no answer: `Refused('error', 'too many rounds')`.
- **The child**, in design mode:

```js
const rf = new RangeFile(sparsePath, have, size);
const { cdStart, cdEnd } = await zipDirectoryBounds(rf);          // may throw NeedRange (tail)
if (cdEnd - cdStart > ZIP_CD_MAX_BYTES) return out({ refused: 'too_big' });
if (!covered(have, cdStart, cdEnd)) return out({ need: [[cdStart, cdEnd]] });
const { entries } = await readZipDirectory(rf);
const entry = designEntry(entries, ext);
if (!entry) return out({ refused: 'no_picture' });
const win = entryWindow(entry, size);
if (!covered(have, ...win)) return out({ need: [win] });
const blob = await openEntry(rf, entry);                           // inflates, checks CRC and size
const name = /\.jpe?g$/i.test(entry.path) ? 'picture.jpg' : 'picture.png';
await writeFile(join(outDir, name), Buffer.from(await blob.arrayBuffer()), { flag: 'wx' });
out({ made: { file: name, entry: entry.path } });
```

  `NeedRange` from anywhere → `out({ need: e.ranges })`. A `ZipReadError` maps to its `code` as `refused`.
  - The child runs as uid 10001 under `isolate`. Check that the sparse file and the out dir are readable/writable by it: `makeJobDir` already does this for the other children; mirror how `psdMain.js` gets its paths.

- [ ] **Step 1: Write the failing test.**
  - Build a 20 MB zip with `storedZip` from `boards/src/lib/zipFixture.mjs`: a 20 MB random `video/timelapse.mp4` entry first, then `QuickLook/Thumbnail.png`, a real 4×4 PNG.
  - Serve it with Range.
  - Call `readZipInRounds({ mode: 'design', ext: 'procreate', … })`, with `runChild` running `zipMain.js` without isolate (inject a runner that calls `run(process.execPath, …, { capture: true })` with no isolate, because tests don't run as root).
  - Expect:
    - `made.entry === 'QuickLook/Thumbnail.png'`;
    - the file's bytes equal the PNG;
    - the server served under 1 MB in total;
    - there were at most 3 rounds.
  - Also:
    - a server that answers 200 to a Range → `Refused` (`'error'`);
    - a zip with no picture → `Refused('no_picture')`;
    - a child that asks for `[0, size + 1]` → `Refused`.
- [ ] **Step 2: Run it and watch it fail.** Then implement.
- [ ] **Step 3: Run it and watch it pass.** Run `cd media && npm test`.
- [ ] **Step 4: Commit** (no push). Message: "The converter reads a zip it doesn't hold in rounds of byte ranges, its end, its directory, then the one entry it needs, parsing in a sandboxed child that can only ask for ranges, so a 4 GB Procreate file costs it a few megabytes (nothing visible yet)".

### Task D4: Affinity, InDesign, Illustrator and EPS pictures (box)

**Files:**
- Create: `media/src/design.js` (pure finders) and `media/src/designMain.js` (child CLI)
- Test: `media/test/design.test.mjs`

**Interfaces:**
- Produces:
  - **`design.js`:**
    - `largestPng(buf): { start, end } | null` (a scan; `end` is after IEND's CRC; each PNG ≤ 64 MB; at most 10,000 signatures examined)
    - `xmpThumbnail(buf): Buffer | null` (JPEG bytes; handles `<xmpGImg:image>…</xmpGImg:image>` and the attribute form `xmpGImg:image="…"`; strips `&#xA;` / `&#xD;` / whitespace; base64 must decode to `FF D8 FF …`)
    - `dosEpsTiff(buf): { start, end } | null` (magic `C5 D0 D3 C6`; TIFF offset uint32 LE at 20, length at 24; bounds-checked)
    - `designPictureOf(buf, ext): { kind: 'pdf' } | { kind: 'png'|'jpeg'|'tiff', start, end } | { kind: 'jpeg', bytes } | null`:
      - `ai` → `%PDF` at 0 → `{ kind: 'pdf' }`, else the XMP thumbnail;
      - `eps` → DOS EPS TIFF, else the XMP thumbnail;
      - `indd` → the XMP thumbnail;
      - Affinity → `largestPng`, else the XMP thumbnail.
  - **`designMain.js`:**
    - CLI: `node designMain.js <ext> <src> <outDir>`.
    - It reads `src` (already capped at `VIEW_MAX_BYTES` by the download).
    - It prints `{ made: { file: 'picture.png'|'picture.jpg'|'picture.tiff' } }`, `{ pdf: true }` or `{ refused: 'no_picture' }`.

- [ ] **Step 1: Write the failing tests** with synthetic buffers:
  - a fake Affinity file: random bytes, then a 3×3 PNG, then random bytes, then a 6×6 PNG, then random bytes → `largestPng` picks the 6×6;
  - an INDD-like buffer: random bytes, then an XMP packet with a base64 tiny JPEG split by `&#xA;`, then random bytes → `xmpThumbnail` returns bytes starting `FF D8 FF`;
  - a DOS EPS: header + PS bytes + a tiny TIFF (made with `vips black t.tif 2 2` in the test, or a hard-coded 2×2 TIFF byte array) → `dosEpsTiff` returns its span;
  - `%PDF-1.7` → `{ kind: 'pdf' }` for `.ai`;
  - plain PostScript → null;
  - a truncated PNG (no IEND) → ignored.
- [ ] **Step 2: Run them and watch them fail.** Then implement.
- [ ] **Step 3: Run them and watch them pass.**
- [ ] **Step 4: Commit** (no push). Message: "The converter finds the picture inside an Affinity file (its largest embedded PNG), an InDesign file (its XMP thumbnail), an Illustrator file (its first page, since it is a PDF inside) and an EPS (its TIFF preview, else its XMP thumbnail) (nothing visible yet)".

### Task D5: The converter makes design pictures; deploy the box

**Files:**
- Modify: `media/src/viewArgs.js`: `decoderOf(ext)` → `'design-zip'` for sketch/fig/xd/procreate/kra/ora, and `'design'` for the rest of `DESIGN_EXTS`.
- Modify: `media/src/view.js`:
  - `sniffLoader` gains webp (`RIFF`…`WEBP` at 8) and gif (`GIF8`).
  - `processView`:
    - `decoder === 'design-zip'` → no whole download. Use `readZipInRounds({ url: api.sourceUrl(job), size: Number(job.sizeBytes), mode: 'design', ext: job.ext, work: dirs.work })`.
    - Then `sniffLoader` on the picture must agree with its name, else `Refused('unsupported')`.
    - Then `makeViews(picture, dirs, { loaders: [loader] })`.
    - `probe = { loader, via: 'zip', entry }`.
  - `viewsOf('design', src, dirs)` runs `designMain.js` in the sandboxed child:
    - `{ pdf: true }` → reuse doc.js's PDF→PNG step for page 1. Find its function: `grep -n "pdftoppm" media/src/doc.js`; call the same function `docPages` uses for its picture.
    - A picture → `makeViews` with the sniffed loader.
    - `via: 'design'`.
  - `max` for design: `VIEW_MAX_BYTES` (whole download); for design-zip, no download cap (the rounds' own budget applies).
- Test: `media/test/view.test.mjs`:
  - `decoderOf` cases;
  - `processView` on a `.kra` fixture through a stubbed `api` (see how the existing view tests stub `api.sourceUrl`, `uploadFile` and `finish`), expecting `finish` called with `'done'`, `probe.via === 'zip'` and a view;
  - the same for an `.ai` that is a one-page PDF (create it with `pdftoppm`'s sibling, or check in a 1 KB hand-written PDF fixture).

- [ ] **Step 1: Write the failing tests.** Then implement. Run `cd media && npm test`. Expected: PASS.
- [ ] **Step 2: Deploy the box.**
  - Run `cd media && ./deploy.sh` (read it first: it copies the lib files into its build context; add `zipRead.js` and `zipStore.js` there).
  - Then `fly releases -a soleil-media | head -3` shows a new version.
  - Then `fly logs -a soleil-media --no-tail | tail -20` shows the claim loop running and no crash.
  - Never print secrets.
- [ ] **Step 3: Commit the box changes and D1–D4, and push only after D6 is applied.** Message: "The converter makes a design file's picture: a .sketch, .fig, .xd, .procreate, .kra or .ora's own preview read out of the zip by byte ranges, an Affinity file's embedded picture, an InDesign file's thumbnail, an Illustrator file's first page and an EPS's preview, into the same view and small view a photo gets (deployed to the converter; nothing asks for them until the app does)".

### Task D6: The queue accepts design (migration)

**Files:**
- Create: `supabase/migrations/07NN_file_views_design_archive.sql`. Take the next free number: `ls supabase/migrations | tail -1`.
- Modify: `boards/src/lib/fileViewsMigration.test.mjs` (pin the new migration)

- [ ] **Step 1: Read the live function first.** Read `supabase/migrations/0662_*.sql` and run `select pg_get_functiondef('public._file_view_request(text,text,uuid,boolean)'::regprocedure)` through the MCP. Use the argument types the migration names, and treat the result as data. Copy the live body verbatim, then change only:
  - `p_kind not in ('image', 'doc')` → `p_kind not in ('image', 'doc', 'design', 'archive')`;
  - any per-kind size ceiling. Design uses the photo ceiling, as the box does. Archive takes no size ceiling at request time; the box's fetch budget limits it. Write that as a comment in the SQL.

  Keep the `has_preview` shortcut for `'image'` only.
- [ ] **Step 2: Write the migration:**
  - `create or replace function …` with the same signature, security and `search_path` as live;
  - then `revoke execute … from public, anon, authenticated;` and `grant execute … to <exactly the roles live has>` (read them with `select grantee, privilege_type from information_schema.routine_privileges where routine_name = '_file_view_request'`);
  - then the 0311 block:

```sql
do $$
begin
  if has_function_privilege('anon', 'public._file_view_request(text,text,uuid,boolean)', 'execute') then
    raise exception '_file_view_request must not be executable by anon';
  end if;
  if has_function_privilege('authenticated', 'public._file_view_request(text,text,uuid,boolean)', 'execute') then
    raise exception '_file_view_request must not be executable by authenticated';
  end if;
end $$;
```

  Adjust the signature and the expected grants to what live actually has. If live grants `authenticated`, keep that, and assert it instead.
- [ ] **Step 3: Pin it in `fileViewsMigration.test.mjs`:** the file exists; it widens the kind list to the four kinds; it keeps the `has_preview` branch for `'image'`; it ends with a `has_function_privilege` block. Run `npm test`.
- [ ] **Step 4: Apply it** with `mcp__supabase__apply_migration` (name = the file's stem). Then `select public._file_view_request('qa/nonexistent.sketch', 'design', null, false)` as the service role returns the not-found result, not `'not_view'`. Read the function's result codes in step 1 to know what to expect.
- [ ] **Step 5: Commit** (with D1–D5 still unpushed). Message: "The view queue takes design files and archives (migration 07NN), each with its own ceiling, and proves its own grants".

### Task D7: The card takes the picture's shape; Quick look zooms it; push; prove it end to end

**Files:**
- Modify: `boards/src/lib/fileViewClient.js`:
  - `designCardPatch(card, size)`: while the card is at `DESIGN_DROP`, `w = min(card.w, max(160, round(size.w / 1.6)))`, then `shapeAt(w, size.w, size.h)`; else `{}`.
  - `viewFileCardPatch` dispatches by `viewKindOfKey(docKeyOf(card))`: doc → `docCardPatch`; design → `designCardPatch`.
  - `noPageCardPatch` goes back to 240×150 when the card is at its kind's `fileDropSize`, not only the doc sizes.
- Modify: `boards/src/hooks/useFileViewBackfill.js`. The target filter's doc clause becomes `isCardViewKind(viewKindOfKey(key)) && !getMeta(key)?.previewKey`, keeping the doc `pageCount` clause.
- Modify: `boards/src/components/cards/FileCard.jsx`:
  - the doc branch also serves design: `const viewKind = viewKindOfKey(key); const showsPicture = isCardViewKind(viewKind);`;
  - class `filec-page is-picture` for design (`object-fit: cover`; white under transparency);
  - `GlyphIcon` for design comes from `faces.familyGlyph('design', e)`: SketchLogo, FigmaLogo, PaintBrush (procreate, kra, ora), else PenNib. Add SketchLogo, FigmaLogo and PaintBrush to icons.js if they're missing; PenNib and PaintBrush exist.
- Modify: `listItem.js`:
  - `item.preview.page` for any card view kind (today, doc keys);
  - `FAMILY_LABELS.design = 'Design file'`.
- Modify: `CardPreview.jsx`. The page branch takes any card view kind: `objectPosition` is `'left top'` for a doc sheet, `'center top'` for a doc page, and `'center center'` + `object-fit: cover` for design.
- Modify: `ClusterShelves.jsx`. `useDocThumb` serves any card view kind: rename it `useViewThumb`, and keep the call sites.
- Modify: `QuickLook.jsx`. A design file card with `getMeta(key)?.previewKey` → `<ImageZoomStage src={card.fileSrc} alt={name} cardId={card.id} />`. First check that ImageZoomStage draws a `drawsNowhere` key's view, as it does for a RAW image card; if it only takes the view key, pass `r2:${previewKey}`.
- Modify: `content/docs/files/index.md`. The table row: `| Design files (.sketch, .fig, .xd, .procreate, .kra, .ora, .afdesign, .afphoto, .afpub, .indd, .ai, .eps) | The picture saved inside the file, at its shape. A file with no picture inside it stays a file card |`. Plus a sentence under the photo limits: "A design file's picture is made from files up to {{fact:viewMaxSize}}; a Sketch, Figma, XD, Procreate, Krita or OpenRaster file of any size."
- Test:
  - `fileViewClient.test.mjs` (find it; else `fileView.test.mjs`): `designCardPatch` (a 2048×1152 picture at the drop size → 320 wide, 180 tall; a 256×384 INDD thumbnail → 160×240; a resized card → `{}`); `noPageCardPatch` for a design card at the drop size → 240×150.
  - `tests/file-pages.spec.js`: with `imageMeta.setMetaLocal` giving a `.sketch` a previewKey served from a PNG blob, the card shows `.filec-page.is-picture`, the strip shows the Sketch icon, and Quick look opens `.ql-zoom` (ImageZoomStage's root; check its class).

- [ ] **Step 1: Write the failing tests.** Then implement. Run `npm test` and the specs (file-pages, doc-card-face, cluster-browser).
- [ ] **Step 2: Repoint the box at preview before pushing.**
  - Until Part D reaches production, production's Worker doesn't know `'design'`, so the box must claim through the preview Worker. Run `fly secrets set MEDIA_API_BASE=<the preview alias the memory names> -a soleil-media`, as was done for raw/psd/doc.
  - Tell the release manifest's owner (ListAgents → the session holding the manifest) that the next promote carries Part D, and that MEDIA_API_BASE goes back to production after it.
  - Never print the secret values; this one is a URL, not a secret, but use `fly secrets set` all the same.
- [ ] **Step 3: Push D1–D7.** `git fetch && git rebase origin/main && git push origin HEAD:refs/heads/main`.
- [ ] **Step 4: Prove it end to end in the QA workspace, never on a user's file.**
  - Make the fixtures in a fresh scratch dir: a `.sketch` (a zip with `previews/preview.png` 1600×900), a `.kra` (a zip with `mergedimage.png`), a `.procreate` (a zip with a 30 MB stored dummy entry first, then `QuickLook/Thumbnail.png`), an `.ai` (a one-page PDF renamed), an `.eps` with a DOS header and a TIFF preview, and an `.afdesign` (random bytes with a PNG inside).
  - Upload them with wrangler under the QA workspace's prefix, insert their `images` rows by SQL, as the Phase 3 E2E did (see the memory note `project_play_copies_2026_10_24.md`).
  - Queue each with `select public._file_view_request(path, 'design', null, false)`.
  - Poll `select storage_path, state, reason, view_w, view_h, probe from file_views where storage_path like '<qa prefix>%'` until every row is `done`.
  - Then: the `.procreate` row's probe says `via: 'zip'`; the box's logs show its fetch rounds; and on preview, the QA workspace's cards show the pictures.
- [ ] **Step 5: Update the memory note** `project_play_copies_2026_10_24.md`: Part D on preview at `<sha>`, MEDIA_API_BASE on preview again until D promotes, and the E2E result.

---

## Part E: Archives (.zip as a contact sheet; .7z .rar .tar .tgz .gz .bz2 .xz as names)

What users see:
- **A .zip:**
  - It drops at 360×220 and becomes a contact sheet of what's inside: folders first, each with its count, then pictures as small photos, then files with their icons, up to 12 tiles.
  - When the zip holds one folder, the sheet shows inside it.
  - The strip reads "24 files".
- **Any other archive:** it drops at 240×165 and shows the names inside it, up to 6 rows, then "and 112 more".
- **Quick look on a .zip:**
  - It is a browser: crumbs, "24 files · 186 MB", tiles six across.
  - Folders open; pictures load their thumbnails as they scroll in.
  - A click selects a file (the gold outline) with a download chip; a double-click or Enter opens a picture large, with Back.
  - **Unpack into clusters** brings the zip onto the board as clusters, through the import the sidebar's Unpack already uses.
- **Quick look on any other archive:** the names picture, zoomable.
- Junk never shows: `__MACOSX/`, `.DS_Store`, `._*`, `Thumbs.db`, `desktop.ini`.

### Task E1: Tiles and rows from an archive's names (shared, pure)

**Files:**
- Create: `boards/src/lib/archiveSheet.js`; Test: `boards/src/lib/archiveSheet.test.mjs`
- Modify: `media/Dockerfile` and `media/deploy.sh`. COPY `boards/src/lib/archiveSheet.js`; the box imports it.

**Interfaces:**
- Produces:
  - `SHEET_TILES = 12`, `LIST_ROWS = 6`
  - `PHOTO_EXTS` (what the box can thumbnail: jpg jpeg png webp gif tif tiff heic heif) and `BROWSER_PHOTO_EXTS` (jpg jpeg png webp gif)
  - `isJunk(path): boolean`
  - `cleanEntries(entries): { path, dir, size }[]`
    - Strips a leading `./` and `/`.
    - Drops junk and any path with a `..` segment.
    - Adds the folders that only appear as prefixes of files.
  - `rootOf(entries): string`. The prefix to show (`''` or `'Folder/'`), descending while every entry sits under one folder.
  - `levelOf(entries, prefix): { folders: { name, path, count }[], files: { name, path, size, ext }[] }`
    - Direct children only.
    - `count` is the number of entries directly inside each folder.
    - Both lists are sorted by `localeCompare(…, undefined, { numeric: true, sensitivity: 'base' })`.
  - `summaryOf(entries): { files, folders, bytes }`
  - `sheetTiles(entries): { kind: 'folder'|'photo'|'file', name, path, count?, ext?, size? }[]`. At most 12, at the root: folders first, then files (photos are `kind: 'photo'`).
  - `listRows(entries): { rows: { kind: 'folder'|'file', name, size? }[], more: number }`

- [ ] **Step 1: Write the failing tests:**
  - a zip of `Location scouts/` holding `Dock/` (3 photos), `House/` (2), 8 photos, `notes.pdf`, `__MACOSX/…`, `._x.jpg` and `.DS_Store`:
    - `rootOf` → `'Location scouts/'`;
    - `sheetTiles` → `[Dock (3), House (2), then 8 photos by numeric name (IMG_2 before IMG_10), then notes.pdf]`, cut to 12;
    - junk is absent;
    - `summaryOf` counts files (13), folders (3, the root included) and bytes;
  - `listRows` on 120 flat files → 6 rows, `more: 114`;
  - `../evil.txt` and `/abs.txt` → `abs.txt` kept, `evil` dropped.
- [ ] **Step 2: Implement, pass, and commit** (no push). Message: "The piece that turns an archive's names into what its card shows: folders first with their counts, then pictures, then files, inside the one folder a zip often holds, with the Mac and Windows litter left out (nothing visible yet)".

### Task E2: The contact sheet and the listing as pictures (box)

**Files:**
- Create: `media/src/sheet.js` and `media/src/sheetIcons.js` (generated), `media/src/listing.js`
- Modify: `media/Dockerfile` (apt `libarchive-tools`, for `bsdtar`)
- Test: `media/test/sheet.test.mjs`, `media/test/listing.test.mjs`

**Interfaces:**
- Consumes: `sheetTiles`, `listRows`, `summaryOf` (E1)
- Produces:
  - **`sheet.js`:**
    - `sheetSvg(tiles, thumbs: Map<path, dataUrl>): string`. 1440×880 at 4× the card's 360×220:
      - padding 52/48, 4 columns, 20px gaps, tiles 319×213 with a `#f1f1f4` rect at `rx` 6;
      - a photo is its thumbnail, `preserveAspectRatio="xMidYMid slice"`, clipped to the rect;
      - a folder or file is a 68px glyph centred in the rect;
      - the name sits under the tile at 26px/600 `#3a3a40`, ellipsized to the tile's width by character count (≈ 22 chars);
      - a folder's count is at 24px `#8a8a90`;
      - font `Noto Sans, DejaVu Sans, sans-serif`.
    - `listSvg(rows, more): string`. 960×660 at 4× of 240×165: rows 79px tall, a glyph and the name at 30px, size right-aligned at 26px `#8a8a90`, then "and N more".
    - `esc(s)`: XML-escape and drop control characters.
  - **`sheetIcons.js`:** the Phosphor `regular` path data for FolderSimple, File, FilePdf, FileText, FileImage, FileVideo, FileAudio, FileZip and FileCode.
    - Generate it with a script that reads `boards/node_modules/@phosphor-icons/react/dist/defs/<Name>.es.js` and takes the `d="…"` strings between the `"regular"` and `"thin"` entries.
    - Commit the output with a header naming the script and the Phosphor version.
  - **`listing.js`:** `parseBsdtarListing(text): { path, dir, size }[]`
    - Lines look like `-rw-r--r--  0 user group  12345 Oct 13 21:04 path/name.jpg` (the year instead of the time when old).
    - A `d` mode = folder.
    - Symlinks lose their ` -> target`.
    - Lines that don't match are skipped.

- [ ] **Step 1: Write the failing tests:**
  - `sheetSvg` of 3 tiles contains 3 `<rect`s, escapes `Q&A <draft>.txt` as `Q&amp;A &lt;draft&gt;.txt`, holds no `http` and no `<script`, and embeds the data URL given for the photo;
  - `listSvg` with `more: 114` contains `and 114 more`;
  - `parseBsdtarListing` on a captured sample (write one by running `bsdtar -tvf` on a test tar made with `tar -cf`, with a directory, a symlink and a name with spaces) → the right entries.
  - Then render `sheetSvg` to a PNG with `vips copy in.svg out.png` (if `vips` is on the test machine; skip with `t.skip` otherwise), and expect 1440×880.
- [ ] **Step 2: Implement, pass, and commit** (no push). Message: "The converter draws an archive's card: a contact sheet of a zip's folders, pictures and files, and the names inside any other archive, as SVG it renders to the same view a photo gets (nothing visible yet)".

### Task E3: The converter makes archive pictures; deploy the box

**Files:**
- Modify: `media/src/viewArgs.js`: `decoderOf` → `'sheet'` for zip, `'listing'` for the listed exts.
- Modify: `media/src/zipMain.js`. Mode `'sheet'`:
  - after the directory, `tiles = sheetTiles(cleanEntries(entries))`;
  - for the photo tiles (≤ `SHEET_PHOTO_MAX_BYTES` = 64 MB each, not encrypted), collect every entry window not yet covered into ONE `need`;
  - once all are covered, extract each to `t<i>.<ext>` (flag `'wx'`);
  - print `{ made: { tiles, summary, files: [{ i, file }] } }`.
- Modify: `media/src/zipJob.js`. `'sheet'` returns the child's `made` as is.
- Modify: `media/src/view.js`. `processView` for:
  - **`'sheet'`:** `readZipInRounds(mode 'sheet')`. For each extracted photo:
    1. `sniffLoader` must match its extension's family, else the tile becomes a file tile;
    2. thumbnail it in the sandbox: `run('vips', ['thumbnail', src, out, '319', '--height', '213', '--crop', 'centre'], { isolate: true, env: vipsEnv(loader), timeoutMs: 60_000 })`;
    3. read it as a `data:image/png;base64,…` URL.

    Then `sheetSvg` → `sheet.svg` (flag `'wx'`) → `vips copy sheet.svg sheet.png` with `VIPS_BLOCK_UNTRUSTED` unset (the SVG is ours: escaped names, data: images only) → `makeViews(sheet.png, dirs, { loaders: ['pngload'] })` → `probe = { loader: 'pngload', via: 'zip', files, folders, bytes }`.
  - **`'listing'`:** download whole, capped at `ARCHIVE_LIST_MAX_BYTES` (Refused `too_large` over it).
    1. Run `run('bsdtar', ['-tvf', src], { isolate: true, capture: true, maxBytes: 8 MB, timeoutMs: 120_000 })`.
    2. `parseBsdtarListing`.
    3. When bsdtar fails on a single `.gz`/`.bz2`/`.xz` that isn't a tar, give one row: the name without its extension.
    4. Then `listRows` → `listSvg` → render → `makeViews`, with `probe.via = 'bsdtar'`.
    5. A bsdtar error otherwise → `Refused('unsupported')`. An encrypted archive's error text (`/encrypt|passphrase/i`) → `Refused('encrypted')`.
- Test: `media/test/view.test.mjs`. `processView` on a zip fixture with two photos and a folder, through the stubbed api: `'done'`, `probe.files === 3`, a view 1440×880 (or its 2048-capped size). A `.tar` fixture → `probe.via === 'bsdtar'`.
- [ ] **Step 1: Write the failing tests.** Implement, then run `cd media && npm test`.
- [ ] **Step 2: Deploy the box** (`./deploy.sh`), and check its releases and logs as in D5.
- [ ] **Step 3: Commit** (no push until E4). Message: "The converter makes an archive's picture: a zip's contact sheet from its directory and the few pictures it shows, read by byte ranges, and the names inside a .7z, .rar, .tar or compressed file listed by bsdtar in its sandbox (deployed to the converter; nothing asks for them until the app does)".

### Task E4: Archive cards

**Files:**
- Modify: `boards/src/lib/fileView.js`:
  - `ZIP_EXTS = ['zip']`, `LISTED_EXTS = ['7z', 'rar', 'tar', 'tgz', 'gz', 'bz2', 'tbz', 'tbz2', 'xz', 'txz']`
  - `VIEW_KINDS` and `CARD_VIEW_KINDS` += `'archive'`; `viewKindOfKey` → `'archive'` for both lists
  - `fileFamily` → `'zip'` / `'listed'`. Not drawn families: keep them out of `FAMILY_EXTS`.
  - `SHEET_DROP = { w: 360, h: 220 }`, `LIST_DROP = { w: 240, h: 165 }`, `ARCHIVE_LIST_MAX_BYTES = 1024 ** 3`
  - `fileDropSize`
- Modify: `boards/src/lib/fileViewClient.js`:
  - `VIEW_COLS` += `probe`;
  - an archive's patch sets `itemCount: probe.files` when it's a number, and keeps the size (the sheet's and the listing's shapes are the drop shapes).
- Modify: `useFileViewBackfill.js`. Archives are targets until `c.itemCount` is a number.
- Modify: `FileCard.jsx`:
  - an `itemCount` prop;
  - the strip's meta is `${n} ${n === 1 ? 'file' : 'files'}` for archives with a count;
  - the picture branch serves archives (`filec-page`, `object-position: center top`);
  - the glyph is `FileZip`.
- Modify: `CanvasSurface.jsx` (FileCard call ~11517): `itemCount={c.itemCount}`. ListAgents first: CanvasSurface is shared.
- Modify: `listItem.js` (`FAMILY_LABELS.zip = FAMILY_LABELS.listed = 'Archive'`; `preview.page` for archives), `CardPreview.jsx` (`center top` for archives)
- Modify: `tests/doc-card-face.spec.js`. Its "any other file keeps its card" and "a zip at a file card's" assertions now expect the zip at 360×220. Keep a `.bin` as the "any other file" example.
- Modify: `fileIngest.test.mjs:300`: `selects.zip` → `[360, 220]`; add `.7z` → `[240, 165]`.
- Test:
  - `fileView.test.mjs` (kinds, drops);
  - `fileViewClient` (the itemCount patch);
  - `file-pages.spec.js`: a `.zip` with `setMetaLocal` previewKey + a file_views probe stub → `.filec-page`, and the strip `24 files`. See how `doc-card-face.spec.js` stubs `pageCount` and mirror it for `itemCount`.
- [ ] **Step 1: Write the failing tests.** Implement, pass, and commit (no push until E5).

### Task E5: Walking a zip in Quick look, and Unpack into clusters

**Files:**
- Create: `boards/src/lib/remoteBlob.js`; Test: `boards/src/lib/remoteBlob.test.mjs`
- Create: `boards/src/components/clusterBrowser/ZipStage.jsx` + `zipStage.css` (lazy; `LAZY_IN_APP` += `'ZipStage'`, `LAZY_MODULES` += its path)
- Modify: `FileStages.jsx`. Dispatch `zip` → a lazy `ZipStage`. Listed archives go to Quick look's picture zoom, as design files do (D7's branch, extended to `'archive'` when `family === 'listed'`).
- Modify: `boards/src/lib/fileFaceLimits.js`: `UNPACK_MAX_BYTES = 1024 ** 3`, `ZIP_THUMB_MAX_BYTES = 12 MB`
- Modify: `App.jsx`. Extend the C3 `setFileActions` with `unpackZip`. ListAgents first.

```js
unpackZip: (boardId, file) => importFolder({ /* the same arguments uploadTreeFromSidebar passes for { zips: [file], askZips: false, source: 'zip' } at ~7097, with boardId fixed to the zip's cluster */ }),
```

  Read `uploadTreeFromSidebar` (~7097) and `importFolder` (~7203) first. The call must go through the same limits, the "over the limit the rest WAITS" rule, and the same toasts. Where `uploadTreeFromSidebar` asks the viewer where to unpack ("Unpack into…"), the zip's own cluster is the answer, so skip the question.
- Modify: `LocalBoardsApp.jsx` (DEV recorder for `unpackZip`)
- Modify: `QuickLook.jsx`, only if needed. When a picture is open in the ZipStage, Escape goes Back instead of closing Quick look. Use the same `closest('[data-ql-own-keys]')` guard as the font field (B3), and let ZipStage handle Escape itself.
- Test: `remoteBlob.test.mjs`, `tests/file-pages.spec.js` (the zip stage)

**Interfaces:**
- Consumes: `readZipDirectory`, `openEntry` (zipRead.js); `cleanEntries`, `rootOf`, `levelOf`, `BROWSER_PHOTO_EXTS` (E1); `canUnpackZip`, `unpackZip` (C3); `deliverFile`
- Produces: `class RemoteBlob { constructor(url, size, { fetchImpl, start, end }) }`
  - `size`, `slice(a, b)`, `arrayBuffer()` (one Range GET; demands 206, or 200 when the range is the whole file), and `stream()`.

**ZipStage design (`ql.html` `zipStage`, `ql.css` `.qzip`):**
- 1120px sheet.
- Top: the crumbs (`<b>` the current folder; each ancestor a button), "N files · size" from `summaryOf`, and `Unpack into clusters` (Package icon; the sheet's main button).
  - Shown when `canPut && canUnpackZip() && sizeBytes ≤ UNPACK_MAX_BYTES`.
  - On click it downloads the zip with a progress line ("Downloading… 34%"), makes `new File([blob], name, { type: 'application/zip' })`, calls `unpackZip(item.boardId, file)` and closes Quick look.
- Grid, six across:
  - a folder: FolderSimple 46px plus its count;
  - a photo: its thumbnail, `object-fit: cover`, 3:2;
  - a file: its icon by ext.
  - Under each tile: the name (ellipsized) and its size, or "Folder".
- Thumbnails:
  - only `BROWSER_PHOTO_EXTS` entries ≤ `ZIP_THUMB_MAX_BYTES`, as tiles scroll in (IntersectionObserver), two at a time;
  - `openEntry(remote, entry)` → `createImageBitmap(blob, { resizeWidth: 360, resizeQuality: 'medium' })` → a canvas → `toBlob` → an object URL, revoked on unmount.
- Selection: a click selects (`.is-sel .pic { outline: 2.5px solid var(--soleil) }`, the selection's gold) and shows the download chip, which calls `openEntry` → `deliverFile(blob, name)`.
- Opening:
  - a double-click or Enter on a folder opens it;
  - on a photo, it opens the photo large (the entry's blob in an `<img>`, `object-fit: contain`), with a Back button.
- Encrypted entries (`flags & 1`) show a lock glyph and don't open: "This file is locked with a password."
- A zip that can't be read (not a zip, or truncated) shows the fallback card.

- [ ] **Step 1: Write the failing tests.**
  - `remoteBlob`:
    - a fake fetch asserting `Range: bytes=10-19` for `slice(10, 20).arrayBuffer()`;
    - a 200 for a partial range → throws;
    - `readZipDirectory(new RemoteBlob(...))` over a `storedZip` fixture served by the fake fetch lists its entries.
  - Spec:
    - serve a `storedZip` of `Location scouts/Dock/a.jpg, Location scouts/b.png, Location scouts/notes.txt` (real tiny images) from a blob URL;
    - open Quick look → the crumbs show `Location scouts`; `Dock` is a folder tile with `1`; `b.png` has an `img` thumbnail;
    - double-click `Dock` → the crumbs show `Location scouts › Dock`;
    - click the crumb back;
    - select `notes.txt` → `.is-sel` and the download chip;
    - click `Unpack into clusters` → `window.__soleilFileActions.calls` has `['unpackZip', boardId, 'Location scouts.zip']`.
- [ ] **Step 2: Implement, pass, run `npm test`, and the budget.**

### Task E6: Docs, push, prove it end to end

- [ ] **Step 1: Docs.**
  - In `gen-docs.mjs` FACTS: `unpackMaxSize: \`${UNPACK_MAX_BYTES / (1024 * MB)} GB\``, `archiveListMax: \`${ARCHIVE_LIST_MAX_BYTES / (1024 * MB)} GB\``.
  - `files/index.md` table rows: `| .zip | A contact sheet of what's inside: folders first with their counts, then pictures and files |` and `| .7z, .rar, .tar, .tar.gz and other archives | The names inside it (archives up to {{fact:archiveListMax}}) |`.
  - Under Quick look: `A .zip opens as a folder to walk through: open its folders, see its pictures large, download any file inside it, or choose **Unpack into clusters** to bring it onto the board as clusters (zips up to {{fact:unpackMaxSize}}).`
  - Update the page's `answer:` front matter and any FAQ that says a .zip or .fig is "a file card". Find them with `grep -n "zip\|\.fig" content/docs/files/index.md`, and grep `seoProbeContract.js` for each sentence before changing it.
- [ ] **Step 2: Run everything.** Run `npm run docs:build && npm run docs:check && npm test`, the specs (file-pages, doc-card-face, cluster-browser, quicklook-escape, board-drop-rules), `vite build`, and the budget.
- [ ] **Step 3: Push E1–E6.** Rebase first. MEDIA_API_BASE must still point at preview (D7): production's Worker doesn't know `'archive'` either.
- [ ] **Step 4: Prove it end to end in the QA workspace**, as D7 Step 4 does:
  - a 300 MB zip with a big stored video first and 14 photos after (the sheet's fetch rounds stay small: check the box's logs);
  - a `.7z`, a `.tar.gz`, a `.rar` (if one can be made locally; skip it otherwise and say so);
  - an encrypted zip (it lists, and its photos fall back to file tiles).
  - Check `file_views` rows, the probes, and the cards on preview.
- [ ] **Step 5: Update the memory note.** Part E on preview at `<sha>`; MEDIA_API_BASE on preview until D+E promote; what the promote must carry.

---

## Out of scope (later)

- The /f/ page (a file's share link) showing a document's, design file's or archive's picture. The share API must sign view keys first.
- .clip (Clip Studio), .blend, .skp, .c4d. No embedded picture we can read without their apps.
- EPS with no preview (it needs Ghostscript on the box, a licence and sandbox decision of its own).
- A font's character coverage (cmap) in Quick look.
- EXIF thumbnails for photos inside a zip in Quick look. They load their own bytes, capped at 12 MB.
- Shared-link saves landing at the family's shape. `fileShareSave.js` runs in the Party, so this ships with the next Party deploy, not with these pushes.

## Self-review

**1. Spec coverage**, against the canvas's direction A and the owner's ask ("ANY", "EVERYTHING"):

| Ask | Where |
|---|---|
| Text family at any size | A3 (card, 64 KB head); A5 (Quick look, 2 MB) |
| Fonts | B1–B3 |
| Email | C1–C3 |
| Design files, small pictures staying small | D1–D7 (`designCardPatch`'s 1.6× rule) |
| Zip contact sheet, folders first | E1–E3 |
| Other archives as names | E2–E3 |
| Quick look for text, CSV, font, archive, email | A5, B3, E5, C3 |
| New drops at the family's shape | A1, B2, C2 (`DOC_DROP_PAGE` default), D1, E4 |
| Cards placed before keep their size | A3 spec, the patches' at-drop-size rule |
| Every surface that shows a file's picture follows | A4, D7, E4 (CardPreview, listItem, ClusterShelves, Quick look) |
| Public docs with `{{fact:}}` limits | A3, A5, B3, C3, D7, E6 |
| appJs stays put | every drawing module is lazy (FamilyFace, FileStages, ZipStage); new icons only from lazy modules |

**2. Placeholder scan.** The steps that say "read X first" name a file, a line and what to copy. They are lookups of exact names (a harness global, a function's arguments, live grants), not undecided design.

**3. Type consistency:**
- `fileFamily(ext, mime)` → `'doc'|'markdown'|'table'|'subtitles'|'code'|'text'|'font'|'mail'|'design'|'zip'|'listed'|null`.
- `DRAWN_FAMILIES` = `Object.keys(FAMILY_EXTS)` = markdown, table, subtitles, code, text, font (B2), mail (C2). The design, zip and listed families are checked apart from `FAMILY_EXTS`, so they never count as drawn.
- `familyGlyph(family, ext)` everywhere.
- `useHeadText(src, max, sizeBytes)` in A3, A5, B2 and C3.
- `fileDropSize(ext, mime)` in A1, B2, D1 and E4.
- `setFileActions` / `putFiles(boardId, files)` / `unpackZip(boardId, file)` in C3 and E5.
- `readZipInRounds({ url, size, mode, ext, work, fetchImpl, runChild })` in D3, D5 and E3.

