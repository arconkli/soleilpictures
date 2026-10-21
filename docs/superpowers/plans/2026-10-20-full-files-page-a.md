# Full Files page, direction A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build direction A, the owner's pick of 2026-10-20. The full Files page (⤢ / F) becomes the sidebar's Files card grown full screen, and its List layout is C's classic Finder table. All of it sits behind a new hold, `filesPageLookAllowed()`, that stays closed on production.

**Architecture:**
- **One look switch.** `FilesLookContext` is `'sb'` or `null`. App provides `'sb'` when the files sidebar is on and `filesPageLookAllowed()` says yes; the QA harness provides it too.
- **Who branches on it.** ListSurface, the browser parts and Quick look read it and branch. Without the look, production's DOM stays identical: `data-look` is undefined, and fragments and shared element constants keep the markup the same.
- **Pure logic is unit-tested:** `lib/filesView.js`, `lib/iconWeight.js` and two `lib/sidebarLayout.js` helpers.
- **Styles** live in a new `components/clusterBrowser/filesPage.css` scoped under `[data-look='sb']`.
- **One Files list at a time.** The sidebar's Files card folds to a bar while the page is open. The fold is shown, never stored.

**Tech Stack:** React 18 + Vite, plain CSS (no nesting), `node:test`, Playwright.

## Global Constraints

- **The repo is public.** No business metrics, revenue figures or user counts in commit messages or committed files.
- **Pushing `main` deploys a PREVIEW, not production.** Never promote without the owner's explicit "ship it".
- **Commit by pathspec, only your own files and hunks.** Never sweep or autostash others' work.
  - Files that already carry other sessions' uncommitted edits: `boards/src/App.jsx`, `boards/src/lib/appHost.js`, `boards/src/components/sidebar/clusterSidebar.css`, `boards/src/local/SidebarQaHarness.jsx`, `boards/tests/sidebar-files.spec.js`.
  - In those, stage only my hunks: build a filtered patch and `git apply --cached` it.
- **The hold.** `filesPageLookAllowed()` is DEV opt-in only (`localStorage soleil.dev.filesPageLook = '1'`) until Task 13. Task 13 opens it on the preview host, so no half-built A ever shows on preview. Production stays closed throughout.
- **Production unchanged.** Every A branch reads `useFilesLook() === 'sb'`. `data-look={sb ? look : undefined}`. With the look null, the DOM is the same (fragments, the same element constants).
- **Only App and the harness decide the look.** No hold is ever called inside ListSurface, QuickLook or `components/clusterBrowser/*`.
- **Gold** (`--soleil`) marks only active, selection, focus and drop. **Deleting shows an undo toast.**
- **CSS rules:** no nesting, no `*/` inside a comment, and every `var()` declared somewhere (`cssTokens.test`).
- **Hit areas** are ≥40px on coarse pointers.
- **Keys don't change:** F, ⌘K, ⌘\, Space, ⌘I, Esc, ←/→/↑/↓, ⌘A, F2, ⇧F10.
- **No new public surface:** no route, `/api/v1`, MCP tool, card kind, Settings tab or shortcut. `docsite.test` must stay green without `docs:accept`.
- **Subagents** run at effort medium, with Sonnet `verifier`/`implementer` for mechanical steps. Use few agents. No /loop.
- **Playwright:** desktop-chrome is Win32 (Mod = Ctrl). Use a free `PW_PORT` (`lsof -i :<port>` first). Never run Playwright while editing app files.
- **Commit messages** use the repo's style: one long prose subject saying what changed for people, ending "(preview only)". They end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Source pins that must stay true:**
  - `tests/sidebar-files.spec.js` ~715-722: `shrinkToSidebar`, and `aria-label={dockControls.shrinkLabel || 'Beside board'}` in the non-sb branch.
  - `tests/import-entry-wiring*`: the ListSurface `handleDrop` slice.
  - `src/lib/moveFailure.test.mjs`: the `moveCardsTo` slice.
  - `fileShareWiring.test` / `docShareWiring.test`: the share lines in Quick look and ListSurface.
  - `tests/undo-redo.spec.js` ~134/360.
  - `filesDock.test`: `.ft-grid.is-panel`.

## Deviations from the approved plan (`~/.claude/plans/ok-now-that-we-nifty-blanket.md`)

1. **A has its own hold, `filesPageLookAllowed()`** (release coordinator, 2026-10-21). sidebarFiles flips for Thursday's 10-22 promote with today's page, and A waits for the owner to see it on preview. That means a `featureEvents.js` entry, which the approved plan said wasn't needed.
2. **The page's title is the cluster name ⌄, which opens ClusterSwitch.** It has no Recent/Starred tabs. This follows the mockup critic's fix: tabs used as a title read as a tab.
3. **The page's "All files ⌄" menu has Show + Sort, plus a tile Size row in Grid. No Group by:** Grid groups by shelf, and List is flat.
4. **⤢ carries no search or chip from the card.** The card is folded while the page is open, so there is nothing to carry. A shelf's ⤢ still sends its buckets, as today.
5. **Star on the page and the shared file-menu order are deferred.** Neither is in A's stills; they are noted for the release slice.
6. **The selection bar moves into the head in A** (Drive, Dropbox). Production keeps its bottom bar.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/appHost.js` (modify) | `filesPageLookAllowed()` + `featureFlags()` entry |
| `src/lib/featureEvents.js` (modify) | `filesPageLook` events entry |
| `src/components/clusterBrowser/filesLook.js` (new) | `FilesLookContext`, `useFilesLook()` |
| `src/lib/iconWeight.js` + test (new) | `shownWeight(weight, floor)` |
| `src/components/Icon.jsx` (modify) | `IconWeightContext`, applies the floor |
| `src/lib/filesPageLook.test.mjs` (new) | source pins: hold, App-only decision, no data-look without the look |
| `src/lib/filesView.js` + test (new) | the card's menu ↔ the page's sort/filter, shelves, screen order, arrow steps |
| `src/lib/sidebarLayout.js` (+ test) (modify) | `shownLayout`, `keepStoredFold` |
| `src/components/sidebar/FilesShowMenu.jsx` (new) | the "All files ⌄" menu, extracted from ClusterSidebar |
| `src/components/sidebar/ClusterSidebar.jsx` (modify) | uses FilesShowMenu; `foldedFor="page"` bar + ⌘\ |
| `src/components/sidebar/clusterSidebar.css` (modify) | the page-fold bar; the meter kept |
| `src/components/clusterBrowser/FilesPageHead.jsx` (new) | `FilesPageHead` (title ⌄, meta, Download all, Shrink, trail) + `FilesPageTools` |
| `src/components/clusterBrowser/FilesShelves.jsx` (new) | Grid: Clusters shelf + shelves (`FilesShelfHead`) |
| `src/components/clusterBrowser/filesPage.css` (new) | every A rule |
| `src/components/sidebar/ClusterSwitch.jsx` (modify) | optional `width` |
| `src/components/clusterBrowser/ClusterTable.jsx` (modify) | `variant="classic"`, `leadRows`, `bare`, zebra |
| `src/components/clusterBrowser/ClusterRow.jsx` (modify) | `classic` / `bare` cells |
| `src/components/clusterBrowser/FolderTiles.jsx` (modify) | `FolderRow`; `countLabel` exported |
| `src/components/clusterBrowser/JustifiedGallery.jsx` (modify) | `gap`, `captionH`, `rowHeight`; `captionless` to tiles |
| `src/components/clusterBrowser/ClusterTile.jsx` (modify) | captionless marks: off, duration, pending |
| `src/components/clusterBrowser/QuickLook.jsx` (modify) | look + icon floor; islands |
| `src/components/ListSurface.jsx` (modify) | look branches: head, selbar in head, drop line, shelves, classic List, Info card class |
| `src/lib/icons.js` (modify) | `DownloadSimple, UploadSimple, FolderSimple, FolderSimplePlus, LinkSimple` |
| `src/App.jsx` (modify) | look provider; page fold wiring; ⌘K; `is-files-page` |
| `src/local/SidebarQaHarness.jsx` (modify) | `FILES_LOOK` (`&look=today`), page fold |
| `tests/sidebar-files-page.spec.js` (modify) | runs on `&look=today` |
| `tests/sidebar-files-page-a.spec.js` (new) | A's behaviour |
| `tests/touch/touch-targets.spec.js` (modify) | a "files page" entry |

---

### Task 1: The hold, the look switch and the icon floor

**Files:**
- Modify: `boards/src/lib/appHost.js` (new hold after `touchPassAllowed`; `featureFlags()`)
- Modify: `boards/src/lib/featureEvents.js` (entry after `sidebarFiles`)
- Create: `boards/src/components/clusterBrowser/filesLook.js`
- Create: `boards/src/lib/iconWeight.js`, `boards/src/lib/iconWeight.test.mjs`
- Modify: `boards/src/components/Icon.jsx`
- Modify: `boards/src/components/ListSurface.jsx` (provider + `data-look` on `.list-wrap`)
- Modify: `boards/src/components/clusterBrowser/QuickLook.jsx` (provider + `data-look` on `.ql`)
- Modify: `boards/src/App.jsx` (import, `filesLook`, provider inside `<AppTrieProvider>`)
- Modify: `boards/src/local/SidebarQaHarness.jsx` (`FILES_LOOK`, provider)
- Modify: `boards/tests/sidebar-files-page.spec.js` (`&look=today` in its URL helper)
- Create: `boards/src/lib/filesPageLook.test.mjs`

**Interfaces:**
- Produces: `filesPageLookAllowed(): boolean`.
- Produces: `FILES_PAGE_LOOK_DEV_FLAG = 'soleil.dev.filesPageLook'`.
- Produces: `FilesLookContext` (React context, default `null`) and `useFilesLook(): 'sb' | null`.
- Produces: `shownWeight(weight: string, floor: string | null): string`.
- Produces: `IconWeightContext` (React context, default `null`).
- In ListSurface/QuickLook: `const look = useFilesLook(); const sb = look === 'sb'` (ListSurface also requires `!isPanel`).

- [ ] **Step 1: Write the failing tests**

```js path=boards/src/lib/iconWeight.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownWeight } from './iconWeight.js';

test('no floor leaves every weight as chosen', () => {
  for (const w of ['thin', 'light', 'regular', 'bold', 'fill', 'duotone']) assert.equal(shownWeight(w, null), w);
});

test('a regular floor lifts thin and light only', () => {
  assert.equal(shownWeight('thin', 'regular'), 'regular');
  assert.equal(shownWeight('light', 'regular'), 'regular');
  for (const w of ['regular', 'bold', 'fill', 'duotone']) assert.equal(shownWeight(w, 'regular'), w);
});

test('a floor never lowers a weight', () => {
  assert.equal(shownWeight('regular', 'light'), 'regular');
  assert.equal(shownWeight('light', 'thin'), 'light');
  assert.equal(shownWeight('thin', 'light'), 'light');
});
```

```js path=boards/src/lib/filesPageLook.test.mjs
// filesPageLook.test.mjs — direction A's look for the full Files page stays
// behind its own hold, App alone decides it, and production's page carries
// none of it.
//
//   node --test src/lib/filesPageLook.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..');
const read = (p) => readFileSync(path.join(src, p), 'utf8');

test('the hold needs the files sidebar and is closed on production', () => {
  const host = read('lib/appHost.js');
  const body = host.match(/export function filesPageLookAllowed\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(body, /if \(!sidebarFilesAllowed\(\)\) return false;/);
  assert.match(body, /if \(!import\.meta\.env\.DEV\) return false;/);
  assert.match(host, /^\s*filesPageLook: filesPageLookAllowed,$/m);
});

test('App alone decides the look, from the hold', () => {
  const app = read('App.jsx');
  assert.match(app, /const filesLook = filesSidebar && filesPageLookAllowed\(\) \? 'sb' : null;/);
  assert.match(app, /<FilesLookContext\.Provider value=\{filesLook\}>/);
});

test('nothing under App asks a hold for the look', () => {
  const files = ['components/ListSurface.jsx',
    ...readdirSync(path.join(src, 'components/clusterBrowser')).filter((f) => /\.jsx?$/.test(f)).map((f) => `components/clusterBrowser/${f}`)];
  for (const f of files) assert.doesNotMatch(read(f), /filesPageLookAllowed|sidebarFilesAllowed/, `${f} reads a hold`);
});

test('without the look the page and Quick look carry no data-look', () => {
  assert.match(read('components/ListSurface.jsx'), /data-look=\{sb \? look : undefined\}/);
  assert.match(read('components/clusterBrowser/QuickLook.jsx'), /data-look=\{sb \? look : undefined\}/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd boards && node --test src/lib/iconWeight.test.mjs src/lib/filesPageLook.test.mjs`
Expected: FAIL (`Cannot find module './iconWeight.js'`, and the source matches fail).

- [ ] **Step 3: Implement**

```js path=boards/src/lib/iconWeight.js
// The weight an icon is drawn at, given a floor its surroundings ask for.
// Phosphor's thin and light read as hairlines beside the files sidebar's
// regular icons; a surface in the sidebar's look (the full Files page and
// Quick look, direction A) lifts them to its floor and leaves every weight
// chosen on purpose (regular, bold, fill, duotone) alone. A floor only lifts.
const ORDER = ['thin', 'light', 'regular'];

export function shownWeight(weight, floor) {
  const w = ORDER.indexOf(weight);
  const f = ORDER.indexOf(floor);
  return w >= 0 && f > w ? floor : weight;
}
```

```js path=boards/src/components/clusterBrowser/filesLook.js
import { createContext, useContext } from 'react';

// Which look the full Files page wears. 'sb' is direction A (the owner's
// pick, 2026-10-20): the sidebar's Files card grown full screen — its head,
// shelves, a classic table for List, a glass Info card, and Quick look's bar
// in islands; styles in filesPage.css under [data-look='sb']. null is the
// page production has. App provides it (the files sidebar on and
// filesPageLookAllowed()), the QA harness too; ListSurface, the browser's
// parts and Quick look only read it, so nothing below App asks a hold, and
// Quick look follows through its portal.
export const FilesLookContext = createContext(null);

export function useFilesLook() {
  return useContext(FilesLookContext);
}
```

In `appHost.js`, after `touchPassAllowed()`:

```js
// ---------------------------------------------------------------------------
// The full Files page's new look
//
// The ⤢ / F page as the sidebar's Files card grown full screen (the owner's
// pick "A", 2026-10-20, with List as a classic Finder table): its head,
// shelves, table, Info card and Quick look's bar, and the sidebar's Files
// card folding to its bar while the page is open. The files sidebar ships
// first with today's page, so this waits behind its own hold until the owner
// has seen it. Opt-in on dev with localStorage soleil.dev.filesPageLook = '1'
// (its spec runs on the QA harness, which picks the look itself). Nothing in
// ListSurface or Quick look asks it: App reads it and hands the look down
// (components/clusterBrowser/filesLook.js).
export const FILES_PAGE_LOOK_DEV_FLAG = 'soleil.dev.filesPageLook';
export function filesPageLookAllowed() {
  if (!sidebarFilesAllowed()) return false;
  if (!import.meta.env.DEV) return false;
  try { return window.localStorage.getItem(FILES_PAGE_LOOK_DEV_FLAG) === '1'; } catch (_) { return false; }
}
```

In `featureFlags()`, after `sidebarFiles: sidebarFilesAllowed,`, add `filesPageLook: filesPageLookAllowed,`.

In `featureEvents.js`, after the `sidebarFiles` entry:

```js
  // The full Files page as the sidebar's Files card grown full screen.
  filesPageLook: {
    exposure: [EV.LIST_BROWSER_VIEW],
    action: [EV.FILES_DOCK, EV.LIST_ADD_FILES],
    outcome: [EV.LIST_ADD_FILES, EV.VIEW_MODE_SWITCH],
    failure: [],
  },
```

`Icon.jsx`: keep its comment lines. Add the context and apply the floor:

```jsx
import { createContext, useContext } from 'react';
import { shownWeight } from '../lib/iconWeight.js';

// A floor for the icons inside: a surface in the files sidebar's look gives
// 'regular' (lib/iconWeight.js). Unset everywhere else, so nothing changes.
export const IconWeightContext = createContext(null);

export function Icon({ as: Component, size = 16, weight = 'thin', strokeWidth, ...rest }) {
  const floor = useContext(IconWeightContext);
  return <Component size={size} weight={shownWeight(weight, floor)} style={{ display: 'block' }} {...rest} />;
}
```

(First check that `Icon` is never called as a plain function: `grep -rn "[^<]Icon(" boards/src --include=*.jsx | grep -v "function Icon"` must print nothing.)

`ListSurface.jsx`:
- Import `useFilesLook` from `./clusterBrowser/filesLook.js`, and `IconWeightContext` with `Icon` from `./Icon.jsx`.
- After `const isPanel = mode === 'panel';` add:
  ```js
  // Direction A's look (clusterBrowser/filesLook.js): App decides it; the
  // panel beside the board never wears it.
  const look = useFilesLook();
  const sb = look === 'sb' && !isPanel;
  ```
- Wrap the returned `.list-wrap` in `<IconWeightContext.Provider value={sb ? 'regular' : null}>`.
- Add `data-look={sb ? look : undefined}` to the `.list-wrap` div.

`QuickLook.jsx`:
- Import `useFilesLook` from `./filesLook.js` and `IconWeightContext` from `../Icon.jsx`.
- At the top of the component body: `const look = useFilesLook(); const sb = look === 'sb';`.
- Wrap the portaled `.ql` in `<IconWeightContext.Provider value={sb ? 'regular' : null}>`.
- Add `data-look={sb ? look : undefined}` on `.ql`.
- The hooks must sit before the `if (!item) return null;` early return.

`App.jsx`:
- Add `filesPageLookAllowed` to the appHost import.
- `import { FilesLookContext } from './components/clusterBrowser/filesLook.js';`
- Right after `const filesSidebar = sidebarFilesAllowed();` add:
  ```js
  // The full Files page in the files sidebar's look (direction A; its own hold,
  // preview only): read once here and handed down (clusterBrowser/filesLook.js).
  const filesLook = filesSidebar && filesPageLookAllowed() ? 'sb' : null;
  ```
- Add `<FilesLookContext.Provider value={filesLook}>` right after `<AppTrieProvider workspaceId={workspace.id}>`, and `</FilesLookContext.Provider>` right before `</AppTrieProvider>`.

`SidebarQaHarness.jsx`:
- Import `FilesLookContext`.
- After the `SURFACE` const:
  ```js
  // The Files page wears direction A's look, as App gives it once its hold is
  // open (clusterBrowser/filesLook.js); &look=today shows the page production
  // has (tests/sidebar-files-page.spec.js runs on it).
  const FILES_LOOK = QS.get('look') === 'today' ? null : 'sb';
  ```
- Wrap the harness's `.app` div (the whole element) in `<FilesLookContext.Provider value={FILES_LOOK}>…</FilesLookContext.Provider>`.

`tests/sidebar-files-page.spec.js`: in its URL helper, append `&look=today` to every harness URL it builds. Then `grep -n "surface=files" boards/tests -r` and add `&look=today` to any other spec that asserts today's page classes (`.cb-pagehead`, `.list-section-files`, `.cbt`).

- [ ] **Step 4: Run the tests**

Run: `cd boards && node --test src/lib/iconWeight.test.mjs src/lib/filesPageLook.test.mjs src/lib/featureEvents.test.mjs src/lib/sessionContext.test.mjs && npm test`
Expected: PASS, including docsite (no surface change).

- [ ] **Step 5: Commit (my hunks only in appHost.js, App.jsx, SidebarQaHarness.jsx) and push**

The pathspec covers the new files plus `Icon.jsx`, `ListSurface.jsx`, `QuickLook.jsx`, `featureEvents.js` and the spec. For the three mixed files, filter `git diff -U1 -- <file>` to my hunks and `git apply --cached --recount`. Message: "The full Files page's new look (direction A, the owner's pick) gets its own hold, filesPageLookAllowed(): …(preview only)". Then `git push origin main`; follow the memory's merge-tree recipe if origin moved.

---

### Task 2: `lib/filesView.js` — one vocabulary for the card and the page

**Files:**
- Create: `boards/src/lib/filesView.js`
- Create: `boards/src/lib/filesView.test.mjs`

**Interfaces:**
- Consumes: `SHELVES, SHELF_BUCKETS, FILTER_CHIPS, shelfOf` (`lib/sidebarShelves.js`); `gridNeighbor` (`lib/justifiedGrid.js`).
- Produces:
  - `SORT_TO_PAGE`, `SORT_LABELS`
  - `sidebarSortOf(key, dir) → 'newest'|'name'|'size'|'canvas'|null`
  - `sortLabelOf(key, dir) → string`
  - `chipToFilter(chip) → { buckets: string[], unplacedOnly: boolean }`
  - `filterToChip(buckets, unplacedOnly) → chip id | null`
  - `chipCountsOf(items, { placement }) → { all, unplaced, [shelfId]: n }`
  - `pageChipsOf(counts, chip) → [{ id, label }]`
  - `chipLabelOf(chip) → string`
  - `sectionsOf(items) → [{ id, label, items, count, layout: 'grid'|'rows', minor }]`
  - `shelfClosed(section, { chip, query, opened }) → boolean`
  - `shelfFoldable(section, { chip, query }) → boolean`
  - `screenOrderOf(sections, { closed, expandedGroups }) → item[]`
  - `navStep(parts, id, arrow) → id | null`

- [ ] **Step 1: Write the failing test**

```js path=boards/src/lib/filesView.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SORT_TO_PAGE, sidebarSortOf, sortLabelOf, chipToFilter, filterToChip, chipCountsOf, pageChipsOf,
  chipLabelOf, sectionsOf, shelfClosed, shelfFoldable, screenOrderOf, navStep,
} from './filesView.js';
import { SORTS } from './sidebarSort.js';
import { FILTER_CHIPS, SHELF_BUCKETS } from './sidebarShelves.js';

const it = (id, kind, extra = {}) => ({ id, kind, name: id, ...extra });
const ids = (xs) => xs.map((x) => x.id);

test('every sidebar sort has a page sort, and maps back', () => {
  for (const s of SORTS) {
    const p = SORT_TO_PAGE[s];
    assert.ok(p, s);
    assert.equal(sidebarSortOf(p.key, p.dir), s);
  }
  assert.equal(sidebarSortOf('type', 'asc'), null);
  assert.equal(sidebarSortOf('name', 'desc'), null);
});

test('a sort the menu has no item for says what its column says', () => {
  assert.equal(sortLabelOf('created', 'desc'), 'Newest first');
  assert.equal(sortLabelOf('board', 'asc'), 'Canvas order');
  assert.equal(sortLabelOf('type', 'asc'), 'Kind ↑');
  assert.equal(sortLabelOf('updated', 'desc'), 'Modified ↓');
  assert.equal(sortLabelOf('bpm', 'asc'), 'Tempo ↑');
});

test('chips and the page filter map both ways', () => {
  for (const c of FILTER_CHIPS) {
    const f = chipToFilter(c.id);
    assert.equal(filterToChip(f.buckets, f.unplacedOnly), c.id, c.id);
  }
  assert.deepEqual(chipToFilter('more'), { buckets: [...SHELF_BUCKETS.more], unplacedOnly: false });
  assert.equal(filterToChip(SHELF_BUCKETS.more, false), 'more');
  assert.equal(filterToChip(new Set(['file', 'doc', 'pdf']), false), 'files');
  assert.equal(filterToChip(['image', 'pdf'], false), null);
  assert.equal(filterToChip(['image'], true), null);
});

test('chip counts follow the shelves; Not on board only where placement shows', () => {
  const items = [it('a', 'image', { unplaced: true }), it('b', 'image'), it('c', 'pdf'), it('d', 'grid', { unplaced: true }), it('e', 'note')];
  assert.deepEqual(chipCountsOf(items), { all: 5, unplaced: 2, photos: 2, files: 1, more: 1, writing: 1 });
  assert.equal(chipCountsOf(items, { placement: false }).unplaced, 0);
});

test('the menu offers chips with something behind them, and the one in force', () => {
  assert.deepEqual(ids(pageChipsOf({ all: 3, photos: 2, files: 1, unplaced: 0 }, 'all')), ['all', 'photos', 'files']);
  assert.deepEqual(ids(pageChipsOf({ all: 3, photos: 3 }, 'video')), ['all', 'photos', 'video']);
  assert.deepEqual(ids(pageChipsOf({ all: 2, more: 2, unplaced: 1 }, 'more')), ['all', 'more', 'unplaced']);
  assert.equal(chipLabelOf('all'), 'All files');
  assert.equal(chipLabelOf('writing'), 'Notes');
  assert.equal(chipLabelOf('more'), 'Other');
  assert.equal(chipLabelOf(null), 'Filtered');
});

test('sections: the card shelves in order, photos and video as a grid, families on Other', () => {
  const fam = { id: 'grp:t', isGroup: true, count: 3, members: [it('g1', 'grid'), it('g2', 'grid'), it('g3', 'grid')] };
  const s = sectionsOf([it('n', 'note'), it('v', 'video'), fam, it('p', 'image'), it('f', 'pdf'), it('l', 'link')]);
  assert.deepEqual(ids(s), ['photos', 'video', 'files', 'writing', 'links', 'more']);
  assert.deepEqual(s.map((x) => x.layout), ['grid', 'grid', 'rows', 'rows', 'rows', 'rows']);
  assert.deepEqual(s.map((x) => x.minor), [false, false, false, true, true, true]);
  assert.deepEqual(s.map((x) => x.label), ['Photos', 'Video', 'Files', 'Notes', 'Links', 'Other']);
  assert.equal(s.find((x) => x.id === 'more').count, 3);
  assert.deepEqual(sectionsOf([]), []);
});

test('a minor shelf starts closed until opened, searched or filtered to', () => {
  const [notes] = sectionsOf([it('n', 'note')]);
  const [photos] = sectionsOf([it('p', 'image')]);
  assert.equal(shelfClosed(photos), false);
  assert.equal(shelfClosed(notes), true);
  assert.equal(shelfClosed(notes, { opened: new Set(['writing']) }), false);
  assert.equal(shelfClosed(notes, { query: 'x' }), false);
  assert.equal(shelfClosed(notes, { chip: 'unplaced' }), false);
  assert.equal(shelfFoldable(notes), true);
  assert.equal(shelfFoldable(notes, { query: 'x' }), false);
  assert.equal(shelfFoldable(photos), false);
});

test('screen order: shelf by shelf, closed ones skipped, open families inlined', () => {
  const fam = { id: 'grp:t', isGroup: true, count: 2, members: [it('g1', 'grid'), it('g2', 'grid')] };
  const s = sectionsOf([it('p', 'image'), it('n', 'note'), fam]);
  assert.deepEqual(ids(screenOrderOf(s)), ['p', 'n', 'grp:t']);
  assert.deepEqual(ids(screenOrderOf(s, { closed: new Set(['writing']), expandedGroups: new Set(['grp:t']) })), ['p', 'grp:t', 'g1', 'g2']);
});

test('the arrows cross from shelf to shelf', () => {
  // Photos in two rows (a b c / d e), then a shelf of rows (x y).
  const tiles = [
    { row: 0, x: 0, w: 100 }, { row: 0, x: 110, w: 100 }, { row: 0, x: 220, w: 100 },
    { row: 1, x: 0, w: 160 }, { row: 1, x: 170, w: 160 },
  ];
  const parts = [{ layout: 'grid', ids: ['a', 'b', 'c', 'd', 'e'], tiles }, { layout: 'rows', ids: ['x', 'y'] }];
  assert.equal(navStep(parts, null, 'down'), 'a');
  assert.equal(navStep(parts, null, 'up'), 'y');
  assert.equal(navStep(parts, 'a', 'right'), 'b');
  assert.equal(navStep(parts, 'b', 'down'), 'd');
  assert.equal(navStep(parts, 'e', 'right'), 'x');
  assert.equal(navStep(parts, 'd', 'down'), 'x');
  assert.equal(navStep(parts, 'x', 'up'), 'e');
  assert.equal(navStep(parts, 'x', 'left'), 'x');
  assert.equal(navStep(parts, 'x', 'down'), 'y');
  assert.equal(navStep(parts, 'y', 'down'), 'y');
  assert.equal(navStep(parts, 'a', 'up'), 'a');
  assert.equal(navStep([], 'a', 'down'), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd boards && node --test src/lib/filesView.test.mjs`
Expected: FAIL (`Cannot find module './filesView.js'`).

- [ ] **Step 3: Implement**

```js path=boards/src/lib/filesView.js
// The full Files page in the files sidebar's look (direction A; the look is
// components/clusterBrowser/filesLook.js), as one vocabulary with the
// sidebar's Files card. Pure, so the page's menu, shelves and keyboard are
// tested here:
//   - the menu is the card's "All files ⌄" (Show, Sort) over the page's own
//     sort keys and type filters, both ways, so the button says what the
//     card's says;
//   - the shelves are the card's (lib/sidebarShelves.js): photos and video in
//     a justified grid, the rest in rows, the minor ones closed as the card
//     closes them;
//   - the keyboard walks one order across every shelf on screen, the arrows
//     stepping from one shelf's last tile to the next shelf's first.

import { SHELVES, SHELF_BUCKETS, FILTER_CHIPS, shelfOf } from './sidebarShelves.js';
import { gridNeighbor } from './justifiedGrid.js';

// The card's sorts, as the page sorts (lib/listItem.js sortItems).
export const SORT_TO_PAGE = Object.freeze({
  newest: Object.freeze({ key: 'created', dir: 'desc' }),
  name: Object.freeze({ key: 'name', dir: 'asc' }),
  size: Object.freeze({ key: 'size', dir: 'desc' }),
  canvas: Object.freeze({ key: 'board', dir: 'asc' }),
});
export const SORT_LABELS = Object.freeze({ newest: 'Newest first', name: 'Name', size: 'Size', canvas: 'Canvas order' });

// The card's sort a page sort is, or null for one the menu has no item for
// (a column head's: Kind, Modified, the audio columns, a reversed one).
export function sidebarSortOf(key, dir) {
  for (const [id, s] of Object.entries(SORT_TO_PAGE)) if (s.key === key && s.dir === dir) return id;
  return null;
}

// What a sort is called: the menu's word, else what its column says, with
// the way it runs.
const COLUMN_WORDS = {
  name: 'Name', type: 'Kind', size: 'Size', created: 'Added', updated: 'Modified', board: 'Canvas order',
  duration: 'Length', bpm: 'Tempo', key: 'Key', format: 'Format',
};
export function sortLabelOf(key, dir) {
  const id = sidebarSortOf(key, dir);
  if (id) return SORT_LABELS[id];
  return `${COLUMN_WORDS[key] || 'Custom'} ${dir === 'asc' ? '↑' : '↓'}`;
}

// A chip as the page filters: its shelf's type buckets, or Not on board.
export function chipToFilter(chip) {
  if (chip === 'unplaced') return { buckets: [], unplacedOnly: true };
  return { buckets: [...(SHELF_BUCKETS[chip] || [])], unplacedOnly: false };
}

// The chip a page filter is; null for a mix no chip names (buckets that
// aren't one shelf's, or a shelf and Not on board together).
export function filterToChip(buckets, unplacedOnly) {
  const set = new Set(buckets || []);
  if (!set.size) return unplacedOnly ? 'unplaced' : 'all';
  if (unplacedOnly) return null;
  for (const [id, list] of Object.entries(SHELF_BUCKETS)) {
    if (list.length === set.size && list.every((b) => set.has(b))) return id;
  }
  return null;
}

// What each chip would show, as the card counts its own: a shelf's count,
// Not on board over every shelf (only where the page marks placement), and
// All for everything.
export function chipCountsOf(items, { placement = true } = {}) {
  const out = { all: 0, unplaced: 0 };
  for (const it of items || []) {
    const shelf = shelfOf(it.kind);
    if (!shelf) continue;
    out.all += 1;
    out[shelf] = (out[shelf] || 0) + 1;
    if (placement && it.unplaced) out.unplaced += 1;
  }
  return out;
}

// The chips the menu offers: All, each with something behind it, and the one
// in force. The card has no chip for Other (its shelf only opens), but a
// shelf's ⤢ can filter the page to it, so it's offered while it filters.
export function pageChipsOf(counts, chip) {
  const out = FILTER_CHIPS.filter((c) => c.id === 'all' || c.id === chip || (counts?.[c.id] || 0) > 0);
  if (chip === 'more') {
    const at = out.findIndex((c) => c.id === 'unplaced');
    out.splice(at < 0 ? out.length : at, 0, { id: 'more', label: 'Other' });
  }
  return out;
}

export function chipLabelOf(chip) {
  if (chip == null) return 'Filtered';
  if (chip === 'all') return 'All files';
  if (chip === 'more') return 'Other';
  return FILTER_CHIPS.find((c) => c.id === chip)?.label || 'All files';
}

// The page's shelves over what it shows, in the card's order: photos and
// video in a justified grid, the rest in rows. A grid family is one entry on
// Other and counts its grids. Empty shelves aren't returned.
const GRID_SHELVES = new Set(['photos', 'video']);
export function sectionsOf(items) {
  const by = new Map(SHELVES.map((s) => [s.id, []]));
  for (const it of items || []) {
    const shelf = it.isGroup ? 'more' : shelfOf(it.kind);
    if (shelf && by.has(shelf)) by.get(shelf).push(it);
  }
  const out = [];
  for (const s of SHELVES) {
    const list = by.get(s.id);
    if (!list.length) continue;
    out.push({
      id: s.id, label: s.label, items: list,
      count: list.reduce((n, it) => n + (it.isGroup ? (it.count || 0) : 1), 0),
      layout: GRID_SHELVES.has(s.id) ? 'grid' : 'rows',
      minor: s.layout === 'fold',
    });
  }
  return out;
}

// Notes, Links and Other start closed, as the card's do, until opened this
// session, or while the search or a chip is looking for what's on them.
const looking = ({ chip = 'all', query = '' } = {}) => !!(query || '').trim() || (chip != null && chip !== 'all');
export function shelfClosed(section, opts = {}) {
  if (!section?.minor || looking(opts)) return false;
  return !opts.opened?.has?.(section.id);
}
export function shelfFoldable(section, opts = {}) {
  return !!section?.minor && !looking(opts);
}

// Every row and tile on screen in the order drawn: shelf by shelf, closed
// shelves skipped, an open grid family's members after it.
export function screenOrderOf(sections, { closed = null, expandedGroups = null } = {}) {
  const out = [];
  for (const s of sections || []) {
    if (closed?.has?.(s.id)) continue;
    for (const it of s.items) {
      out.push(it);
      if (it.isGroup && expandedGroups?.has?.(it.id)) out.push(...(it.members || []));
    }
  }
  return out;
}

// Where an arrow key goes from `id` over the shelves on screen. `parts` is
// one entry per open shelf, in screen order: { layout: 'grid', ids, tiles }
// (the gallery's laid-out tiles, lib/justifiedGrid.js) or { layout: 'rows',
// ids }. In a grid ←/→ walk the order and ↑/↓ go to the nearest tile in the
// next row; in rows only ↑/↓ move. Past a shelf's edge the step goes on to
// the next shelf's first (↓, →) or back to the one before's last (↑, ←).
// No cursor yet: the first thing (↓, →) or the last (↑, ←). Null when there's
// nothing at all; the same id where it can't move.
export function navStep(parts, id, arrow) {
  const list = (parts || []).filter((p) => p?.ids?.length);
  if (!list.length) return null;
  const forward = arrow === 'down' || arrow === 'right';
  const pi = id == null ? -1 : list.findIndex((p) => p.ids.includes(id));
  if (pi < 0) {
    const end = forward ? list[0] : list[list.length - 1];
    return forward ? end.ids[0] : end.ids[end.ids.length - 1];
  }
  const part = list[pi];
  const i = part.ids.indexOf(id);
  if (part.layout === 'grid' && part.tiles?.length === part.ids.length) {
    const j = gridNeighbor(part.tiles, i, arrow);
    if (j !== i) return part.ids[j];
  } else if (arrow === 'down' || arrow === 'up') {
    const j = i + (forward ? 1 : -1);
    if (j >= 0 && j < part.ids.length) return part.ids[j];
  } else {
    return id;
  }
  const next = list[pi + (forward ? 1 : -1)];
  if (!next) return id;
  return forward ? next.ids[0] : next.ids[next.ids.length - 1];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd boards && node --test src/lib/filesView.test.mjs`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit and push**

```bash
git add boards/src/lib/filesView.js boards/src/lib/filesView.test.mjs
git commit -m "…(preview only)" -- boards/src/lib/filesView.js boards/src/lib/filesView.test.mjs
git push origin main
```

---

### Task 3: One Files at a time — the sidebar's card folds while the page is open

**Files:**
- Modify: `boards/src/lib/sidebarLayout.js` (two helpers after `withFilesHidden`)
- Modify: `boards/src/lib/sidebarLayout.test.mjs` (import + tests)
- Modify: `boards/src/components/sidebar/ClusterSidebar.jsx` (props `foldedFor`, `onShrinkPage`; bar; ⌘\; focus)
- Modify: `boards/src/components/sidebar/clusterSidebar.css` (meter kept on a page fold; the bar's note + Shrink)
- Modify: `boards/src/App.jsx` (`pageFilesId`, shown layout, wrapper, ⌘K, `is-files-page`, ClusterSidebar props)
- Modify: `boards/src/local/SidebarQaHarness.jsx` (the same, for `surface=files`)
- Create: `boards/tests/sidebar-files-page-a.spec.js`

**Interfaces:**
- Consumes: `FILES_LOOK` (harness) and `filesLook` (App) from Task 1.
- Produces:
  - `shownLayout(stored, { pageOpen }) → layout`
  - `keepStoredFold(stored, next) → layout`
  - ClusterSidebar props `foldedFor: 'page' | null` and `onShrinkPage: (via) => void`
  - `.app.is-files-page` while the page shows
  - the fold bar `.sbf-files-bar.is-page` (text "Files", "full screen", "Shrink"); its card has `.sbf-card.is-files.is-folded.is-page-fold`
  - FILES_DOCK vias `'sidebar_fold'` and `'sidebar_key'`; the ⌘K run uses `'palette'`.

- [ ] **Step 1: Write the failing tests**

In `sidebarLayout.test.mjs`, add `shownLayout, keepStoredFold` to the import, and:

```js
test('the full Files page folds the files card in what shows, never in what is kept', () => {
  const stored = sanitizeLayout({ filesHidden: false });
  assert.equal(shownLayout(stored, { pageOpen: false }), stored);
  const shown = shownLayout(stored, { pageOpen: true });
  assert.equal(shown.filesHidden, true);
  assert.equal(stored.filesHidden, false);
  // A handle dragged while the page is open hands back the shown layout,
  // folded and resized: the size is kept, the fold is the stored one.
  const dragged = { ...shown, stack: { ...shown.stack, tw: shown.stack.tw + 40 } };
  const kept = keepStoredFold(stored, dragged);
  assert.equal(kept.filesHidden, false);
  assert.equal(kept.stack.tw, sanitizeLayout(dragged).stack.tw);
  assert.equal(keepStoredFold(sanitizeLayout({ filesHidden: true }), dragged).filesHidden, true);
});
```

Create the A spec (more tests are appended by later tasks):

```js path=boards/tests/sidebar-files-page-a.spec.js
// The full Files page in direction A's look on the sidebar QA harness
// (?sidebarqa=1&surface=files; the harness gives the page A's look unless
// &look=today). Run: npx playwright test tests/sidebar-files-page-a.spec.js --project=desktop-chrome
import { test, expect } from '@playwright/test';

const page_ = (extra = '') => `/?sidebarqa=1&surface=files${extra}`;
async function open(page, extra = '') {
  await page.goto(page_(extra));
  await page.locator('[data-sidebarqa-ready]').waitFor();
  await page.locator('.list-wrap').first().waitFor();
}
async function drag(page, id, dx, dy, { steps = 8 } = {}) {
  const b = await page.locator(`[data-handle="${id}"]`).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
  await page.mouse.up();
}

test.describe('one Files at a time', () => {
  test('the sidebar card folds to its bar while the page is open, its meter kept', async ({ page }) => {
    await open(page);
    const card = page.locator('.sbf-card.is-files');
    await expect(card).toHaveClass(/is-page-fold/);
    const bar = page.locator('.sbf-files-bar.is-page');
    await expect(bar).toContainText('Files');
    await expect(bar).toContainText('full screen');
    await expect(bar).toContainText('Shrink');
    await expect(page.locator('.sbf-card.is-files > .sbf-files')).toBeHidden();
    await expect(page.locator('.sbf-meter')).toBeVisible();
    await expect(page.locator('.list-wrap')).toHaveAttribute('data-look', 'sb');
    await expect(page.locator('.app')).toHaveClass(/is-files-page/);
  });

  test('Shrink in the bar goes back to the board, the card open', async ({ page }) => {
    await open(page);
    await page.locator('.sbf-files-bar.is-page').click();
    await expect(page.locator('[data-sidebarqa-surface="board"]')).toBeVisible();
    await expect(page.locator('.sbf-card.is-files > .sbf-files')).toBeVisible();
    await expect(page.locator('.app')).not.toHaveClass(/is-files-page/);
  });

  test('Shrink opens the card even when it was hidden before', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('soleil.ui.sidebarLayout', JSON.stringify({ filesHidden: true })));
    await open(page);
    await page.locator('.sbf-files-bar.is-page').click();
    await expect(page.locator('.sbf-card.is-files > .sbf-files')).toBeVisible();
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('soleil.ui.sidebarLayout') || '{}'));
    expect(kept.filesHidden).toBe(false);
  });

  test('a handle dragged while the page is open never keeps the fold', async ({ page }) => {
    await open(page);
    await drag(page, 'treeRight', 30, 0);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('soleil.ui.sidebarLayout') || '{}'));
    expect(kept.filesHidden).not.toBe(true);
  });

  test('⌘\\ (Ctrl here) shrinks the page back into the sidebar', async ({ page }) => {
    await open(page);
    await page.locator('.list-wrap').click({ position: { x: 600, y: 600 } });
    await page.keyboard.press('Control+Backslash');
    await expect(page.locator('[data-sidebarqa-surface="board"]')).toBeVisible();
    await expect(page.locator('.sbf-card.is-files > .sbf-files')).toBeVisible();
  });

  test('&look=today keeps the page and the card as production has them', async ({ page }) => {
    await open(page, '&look=today');
    await expect(page.locator('.sbf-card.is-files')).not.toHaveClass(/is-folded/);
    await expect(page.locator('.list-wrap')).not.toHaveAttribute('data-look', /.+/);
    await expect(page.locator('.app')).not.toHaveClass(/is-files-page/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd boards && node --test src/lib/sidebarLayout.test.mjs` → FAIL (`shownLayout` is not exported).

Run: `PW_PORT=<free> npx playwright test tests/sidebar-files-page-a.spec.js --project=desktop-chrome` → FAIL (no `.is-page-fold`).

- [ ] **Step 3: Implement**

`sidebarLayout.js`, after `withFilesHidden`:

```js
// The full Files page in the files sidebar's look folds the files card to its
// bar while it's open, so the files are listed once. The fold is shown, never
// kept: the sidebar is handed the stored layout folded, and a handle dragged
// meanwhile keeps the stored layout's own filesHidden, so closing the page
// brings the card back as it was.
export function shownLayout(stored, { pageOpen = false } = {}) {
  return pageOpen ? withFilesHidden(stored, true) : stored;
}
export function keepStoredFold(stored, next) {
  return { ...sanitizeLayout(next), filesHidden: !!stored?.filesHidden };
}
```

`ClusterSidebar.jsx`:
- Props, after `onLayout`:
  ```js
  foldedFor = null,       // 'page': folded because the full Files page shows these files (App, direction A)
  onShrinkPage = null,    // (via) => void — that page's way back into the sidebar
  ```
- After `const folded = …`: `const pageFold = folded && foldedFor === 'page';`
- Set `live.current = { layout, onLayout, pageFold, onShrinkPage };`.
- In the ⌘\ listener, after `e.preventDefault();`:
  ```js
  // Folded by the page: ⌘\ is its way back (the card opens with it).
  if (live.current.pageFold) { live.current.onShrinkPage?.('sidebar_key'); return; }
  ```
- In the focus `useLayoutEffect` keyed on `[folded]`, after the `focusAfter` reset:
  ```js
  // Folded by the full Files page (⤢, F): focus stays with the page, never
  // pulled onto the bar.
  if (pageFold) { focusInFiles.current = false; return; }
  ```
- The bar:
  ```jsx
  {folded && (pageFold ? (
    <button type="button" className="sbf-files-bar is-page" ref={showRef}
            aria-label="Shrink Files back into the sidebar" title="Shrink Files back into the sidebar (F)"
            onClick={() => onShrinkPage?.('sidebar_fold')}>
      <span className="sbf-files-heading-label">Files</span>
      <span className="sbf-files-note">full screen</span>
      <span className="sbf-files-show is-shrink" aria-hidden="true"><Icon as={ArrowsInSimple} size={12} weight="regular" />Shrink</span>
    </button>
  ) : (
    /* the existing Show bar, unchanged */
  ))}
  ```
- Card class: `sbf-card is-files${folded ? ' is-folded' : ''}${pageFold ? ' is-page-fold' : ''}`.
- Import `ArrowsInSimple`.

`clusterSidebar.css`:
- Change the fold rule's meter line to `.sbf-card.is-files.is-folded:not(.is-page-fold) > .sbf-meter { display: none; }`.
- After the `.sbf-files-bar:hover .sbf-files-show` rule, add:
  ```css
  /* Folded by the full Files page (direction A, preview only): the bar says
     where the files are and offers the way back; the meter stays under it. */
  .sbf-files-note { margin-right: auto; margin-left: 8px; color: var(--ink-1); font: 500 12px/1 var(--font-sans); }
  .sbf-files-show.is-shrink { gap: 6px; padding: 0 10px 0 8px; }
  ```

`App.jsx`:
- Import `shownLayout, keepStoredFold` from `./lib/sidebarLayout.js`.
- After `onSidebarLayout`:
  ```js
  // Direction A (preview only): while the full Files page shows this cluster,
  // the sidebar's Files card folds to its bar, so the files are listed once.
  // Shown, never kept (lib/sidebarLayout.js shownLayout / keepStoredFold).
  const pageFilesId = filesLook && !mobileShell && currentSurface === 'board' && mainFilesMode === 'full' ? currentId : null;
  const shownSidebarLayout = useMemo(() => shownLayout(sidebarLayout, { pageOpen: !!pageFilesId }), [sidebarLayout, pageFilesId]);
  const onShownSidebarLayout = useCallback((next, opts) => {
    onSidebarLayout(pageFilesId ? keepStoredFold(sidebarLayout, next) : next, opts);
  }, [onSidebarLayout, pageFilesId, sidebarLayout]);
  // The fold bar's Shrink, ⌘\ and ⌘K while the page is open: back to the
  // board, and the files back in the sidebar even if they were hidden.
  const shrinkPageToSidebar = (via) => {
    applyFilesEvent('board', via);
    if (sidebarLayout.filesHidden) onSidebarLayout(withFilesHidden(sidebarLayout, false), { commit: true });
  };
  ```
- `.app` className: append `${pageFilesId ? ' is-files-page' : ''}`.
- The `--sb-w` style: use `sidebarFootprint(shownSidebarLayout, …)`.
- ClusterSidebar: `layout={shownSidebarLayout}`, `onLayout={mobileShell ? null : onShownSidebarLayout}`, `foldedFor={pageFilesId ? 'page' : null}`, `onShrinkPage={shrinkPageToSidebar}`.
- ⌘K `sidebar-files`:
  - label: `pageFilesId || sidebarLayout.filesHidden ? 'Show files in the sidebar' : 'Hide files in the sidebar'`
  - available: `filesSidebar && !mobileShell && (sidebarOpen || !!sidebarLayout.filesHidden || !!pageFilesId)`
  - first line of `run`: `if (pageFilesId) { shrinkPageToSidebar('palette'); if (!sidebarOpen) setSidebarOpen(true); return; }`
  - If the command list is memoized, add `pageFilesId` to its deps. If it reads handlers through refs, read `shrinkPageToSidebar` the same way.

`SidebarQaHarness.jsx`:
- Import `shownLayout, keepStoredFold, withFilesHidden`.
- After `onLayout`:
  ```js
  // App's fold for the Files page in direction A: shown, never kept.
  const pageFold = !!FILES_LOOK && !mobileShell && surface === 'files';
  const shown = useMemo(() => shownLayout(layout, { pageOpen: pageFold }), [layout, pageFold]);
  const onShownLayout = (next, opts) => onLayout(pageFold ? keepStoredFold(layoutRef.current, next) : next, opts);
  const shrinkPage = (via) => {
    say(`shrink ${via}`);
    setSurface('board');
    if (layoutRef.current.filesHidden) onLayout(withFilesHidden(layoutRef.current, false), { commit: true });
  };
  ```
- Pass `layout={shown}`, `onLayout={mobileShell ? null : onShownLayout}`, `foldedFor={pageFold ? 'page' : null}` and `onShrinkPage={shrinkPage}` to ClusterSidebar.
- `--sb-w` uses `shown`.
- `.app` className gets `${pageFold ? ' is-files-page' : ''}`.
- The harness's own Files-page Shrink (`FilesPageQa onBack`) stays as it is.

- [ ] **Step 4: Run the tests**

Run: `cd boards && node --test src/lib/sidebarLayout.test.mjs && npm test`
Expected: PASS.

Then hand a `verifier` (Sonnet, medium) this run, with nothing being edited meanwhile:

`PW_PORT=<free> npx playwright test tests/sidebar-files-page-a.spec.js tests/sidebar-files.spec.js tests/sidebar-files-page.spec.js --project=desktop-chrome`

Expected: all green.

- [ ] **Step 5: Commit (my hunks in App.jsx, clusterSidebar.css, SidebarQaHarness.jsx) and push**

---

### Task 4: One menu — FilesShowMenu extracted from the sidebar

**Files:**
- Create: `boards/src/components/sidebar/FilesShowMenu.jsx`
- Modify: `boards/src/components/sidebar/ClusterSidebar.jsx`: remove `placeMenu`, the menu state and effects, `closeMenu` / `onMenuKeyDown` and the inline JSX. Remove `setMenuOpen(false)` from the fold effect (`hidden={folded}` covers it). Use `<FilesShowMenu>`. Import `SORT_LABELS` from `lib/filesView.js` in place of the local constant.

**Interfaces:**
- Produces: `FilesShowMenu({ label, on, title, sections, extra, ariaLabel = 'Show, sort and group', align = 'right' | 'left', hidden })`.
  - `sections`: `[{ id, label, items: [{ key, label, count?, checked, onPick, keepOpen? }] }]`.
- Produces: `placeMenu(btn, menu, align)`.
- The markup and class names are identical to today's (`.sbf-filter`, `.sbf-filter-btn`, `.sbf-menu`, `.sbf-menu-label`, `.sbf-menu-sep`, `.sbf-menu-item`, `.sbf-menu-count`), so the sidebar specs guard it.

- [ ] **Step 1: Confirm the specs that guard the menu are green before the change**

Run (verifier): `PW_PORT=<free> npx playwright test tests/sidebar-files.spec.js -g "menu|All files|sort|group|chip" --project=desktop-chrome` and record the pass count.

- [ ] **Step 2: Create the component**

```jsx path=boards/src/components/sidebar/FilesShowMenu.jsx
// "All files ⌄": what a list of files shows and how it's sorted, in one menu
// (it replaced a row of chips and a ⇅ button). The sidebar's Files card and
// the full Files page in the sidebar's look (direction A) both open it, so
// the two say the same words: Show, then Sort, then what the surface adds
// (the card's Group by; the page's tile Size, passed as `extra`). Portaled
// and fixed, so no overflow (the divider can make the card short) cuts it off.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon.jsx';
import { ChevronDown } from '../../lib/icons.js';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';

// Where the menu opens: under its button when it fits, else over it; fitting
// neither, it slides up the window until it all shows (over its button, as
// menus do), and scrolls only in a window shorter than itself. Its right edge
// is the button's, or with align 'left' its left edge is, kept in the window.
export function placeMenu(btn, menu, align = 'right') {
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  const vh = window.innerHeight;
  const want = menu ? menu.scrollHeight : 0;
  const x = align === 'left'
    ? { left: Math.max(8, Math.min(r.left, window.innerWidth - (menu?.offsetWidth || 0) - 8)) }
    : { right: Math.max(8, window.innerWidth - r.right) };
  const below = vh - r.bottom - 12;
  const above = r.top - 12;
  if (want <= below) return { ...x, top: r.bottom + 4, maxHeight: below };
  if (want <= above) return { ...x, bottom: vh - r.top + 4, maxHeight: above };
  const room = vh - 16;
  return { ...x, top: Math.max(8, vh - 8 - Math.min(want, room)), maxHeight: room };
}

export function FilesShowMenu({
  label, on = false, title, sections, extra = null,
  ariaLabel = 'Show, sort and group', align = 'right', hidden = false,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  // Opened from the keyboard (a click with no pointer), the item in force shows
  // it has focus; opened with a pointer, focus goes there quietly.
  const byKey = useRef(false);
  // The menu itself is portaled out of the wrapper: a click in it isn't outside.
  useDismissOnOutside(wrapRef, open, () => setOpen(false), { ignore: '.sbf-menu' });
  // Folded or hidden by its surface: no menu left open over nothing.
  useEffect(() => { if (hidden) setOpen(false); }, [hidden]);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = (e) => {
      const t = e?.target;
      if (t instanceof Node && popRef.current?.contains(t)) return;   // scrolling the menu itself
      setPos(placeMenu(btnRef.current, popRef.current, align));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);
  // Once it's placed (hidden until then, and hidden can't take focus), focus
  // goes into the menu, on the item in force, so ↑/↓, Tab and Esc work there.
  const placed = !!pos;
  useEffect(() => {
    if (!open || !placed) return;
    const pop = popRef.current;
    (pop?.querySelector('[aria-checked="true"]') || pop?.querySelector('[role^="menuitem"]'))
      ?.focus({ preventScroll: true, focusVisible: byKey.current });
  }, [open, placed]);
  // A choice closes the menu and hands focus back to its button, as Esc does.
  const close = () => { setOpen(false); btnRef.current?.focus({ preventScroll: true }); };
  const onMenuKeyDown = (e) => {
    if (e.key === 'Tab') { e.preventDefault(); close(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = [...(popRef.current?.querySelectorAll('[role^="menuitem"]') || [])];
    const i = items.indexOf(document.activeElement);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[j]?.focus();
  };
  return (
    <div className="sbf-filter" ref={wrapRef}
         onKeyDown={(e) => {
           if (e.key !== 'Escape' || !open) return;
           e.preventDefault();
           e.stopPropagation();
           setOpen(false);
           btnRef.current?.focus();
         }}>
      <button type="button" ref={btnRef}
              className={`sbf-filter-btn${on ? ' is-on' : ''}${open ? ' is-open' : ''}`}
              aria-haspopup="menu" aria-expanded={open} title={title}
              onClick={(e) => { byKey.current = e.detail === 0; setOpen((o) => !o); }}>
        {label}<span className="sbf-filter-caret" aria-hidden="true"><Icon as={ChevronDown} size={10} weight="regular" /></span>
      </button>
      {open && createPortal(
        <div className="sbf-menu" role="menu" aria-label={ariaLabel} ref={popRef}
             style={pos || { top: 0, right: 0, visibility: 'hidden' }}
             onKeyDown={onMenuKeyDown}>
          {sections.map((s, k) => (
            <Fragment key={s.id}>
              {k > 0 && <div className="sbf-menu-sep" role="separator" />}
              <div className="sbf-menu-label">{s.label}</div>
              {s.items.map((it) => (
                <button type="button" key={it.key} role="menuitemradio" aria-checked={!!it.checked}
                        className={`sbf-menu-item${it.checked ? ' is-on' : ''}`}
                        onClick={() => { it.onPick(); if (!it.keepOpen) close(); }}>
                  {it.label}
                  {(it.count || 0) > 0 && <span className="sbf-menu-count">{it.count}</span>}
                </button>
              ))}
            </Fragment>
          ))}
          {extra}
        </div>,
        document.body,
      )}
    </div>
  );
}
```

- [ ] **Step 3: Use it in the sidebar**

Replace the `.sbf-filter` block in ClusterSidebar with:

```jsx
<FilesShowMenu
  label={chipLabel} on={chip !== 'all'} hidden={folded}
  title={`Showing ${chipLabel.toLowerCase()} · sorted by ${SORT_LABELS[prefs.sort].toLowerCase()} · grouped by ${GROUP_LABELS[prefs.groupBy].toLowerCase()}`}
  sections={[
    { id: 'show', label: 'Show', items: chips.map((c) => ({
      key: c.id, label: c.id === 'all' ? 'All files' : c.label, count: chipCounts[c.id] || 0,
      checked: chip === c.id, onPick: () => setChip(c.id) })) },
    { id: 'sort', label: 'Sort', items: SORTS.map((so) => ({
      key: so, label: SORT_LABELS[so], checked: prefs.sort === so, onPick: () => setPref('sort', so) })) },
    { id: 'group', label: 'Group by', items: Object.keys(GROUP_LABELS).map((g) => ({
      key: g, label: GROUP_LABELS[g], checked: prefs.groupBy === g, onPick: () => setPref('groupBy', g) })) },
  ]} />
```

Then delete what's left of the old menu:
- `placeMenu` and the local `SORT_LABELS`.
- `menuOpen`/`setMenuOpen`, `menuRef`, `filterBtnRef`, `menuPopRef`, `menuPos`, `menuByKey`, `closeMenu`, `onMenuKeyDown`, and their `useDismissOnOutside` / `useLayoutEffect` / `useEffect`.
- `setMenuOpen(false)` in the fold effect.

Check what else uses them first: `grep -n "menuOpen\|setMenuOpen\|menuRef\|filterBtnRef\|menuPopRef\|menuPos\|menuByKey\|closeMenu\|onMenuKeyDown\|placeMenu" boards/src/components/sidebar/ClusterSidebar.jsx`. Keep any import still used elsewhere (`createPortal`, `useDismissOnOutside`, `useLayoutEffect`).

- [ ] **Step 4: Run**

Run: `cd boards && npm test`, then (verifier) `PW_PORT=<free> npx playwright test tests/sidebar-files.spec.js tests/mobile/sidebar-files.spec.js --project=desktop-chrome --project=mobile-chrome` (use the project names in `playwright.config`).
Expected: the same pass count as Step 1, all green.

- [ ] **Step 5: Commit and push** (ClusterSidebar.jsx and the new file only).

---

### Task 5: The sheet on the ground (filesPage.css)

**Files:**
- Create: `boards/src/components/clusterBrowser/filesPage.css`
- Modify: `boards/src/components/ListSurface.jsx` (`import './clusterBrowser/filesPage.css';`)
- Modify: `boards/src/components/clusterBrowser/QuickLook.jsx` (`import './filesPage.css';`)

**Interfaces:**
- Consumes: `.list-wrap[data-look='sb']` (Task 1) and `.app.is-files-page` (Task 3).
- Produces: `--fp-dot2`. Inside the sheet, `--files-floor` is `var(--bg-1)` and `--files-gutter` is `16px`. Later tasks append rules to this file.

- [ ] **Step 1: Measure the chain before writing a rule**

Run the harness (`npm run dev`, free port), open `/?sidebarqa=1&surface=files`, and read these in the console:
- the computed `background-color` and the box `top` of each of `.main`, `.split-wrap`, `.split-pane`, `.surface-wrap`, `.fdl-files` and `.list-wrap`;
- `getComputedStyle(document.querySelector('.app')).getPropertyValue('--chrome-band')`.

Two things decide the rules:
- Which elements paint an opaque background over the ground. Those go transparent under `.is-files-page`.
- Whether `.fdl-files` already starts under the band. If its top is the band's bottom, the sheet's top margin is 2px. If its top is 0, it is `calc(var(--chrome-band) + 2px)`.

- [ ] **Step 2: Write the file (the measured transparent list replaces the guess below if it differs)**

```css path=boards/src/components/clusterBrowser/filesPage.css
/* The full Files page in the files sidebar's look (direction A, the owner's
   pick of 2026-10-20; preview only, behind filesPageLookAllowed()): the
   sidebar's Files card grown full screen. A calm sheet on the board's ground
   holds the files (Apple's HIG keeps glass out of the content layer); its
   head carries the cluster's name and the card's own controls; photos and
   video lie in a justified grid on the card's shelves, the rest in rows;
   List is a classic Finder table. Every rule is under [data-look='sb'],
   which ListSurface and Quick look set only with that look (filesLook.js),
   or under .is-files-page, which App sets only then, so the page production
   has matches nothing here. */

/* ── The ground ──────────────────────────────────────────────────────────── */
/* While the page is open the board's ground runs on behind the sidebar and
   around the sheet, as Home's does (clustersHome.css). */
.app.sb-files.is-files-page {
  --fp-dot2: rgba(245, 245, 247, .085);
  background-color: var(--bg-0);
  background-image:
    radial-gradient(circle at 1px 1px, var(--fp-dot2) 1.25px, transparent 1.75px),
    radial-gradient(circle at 1px 1px, var(--grid-dot) 1px, transparent 1.5px),
    linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: 80px 80px, 20px 20px, 80px 80px, 80px 80px;
}
[data-theme='light'] .app.sb-files.is-files-page { --fp-dot2: rgba(10, 10, 12, .11); }
/* What lies between the window and the sheet lets the ground through. */
.app.sb-files.is-files-page .main,
.app.sb-files.is-files-page .split-wrap,
.app.sb-files.is-files-page .split-pane,
.app.sb-files.is-files-page .surface-wrap:not(.is-canvas),
.app.sb-files.is-files-page .fdl-files { background: transparent; }

/* ── The sheet ───────────────────────────────────────────────────────────── */
/* The list's own scroller, inset as the sidebar's cards are (8px), with
   their radius and hairline. Opaque: the files sit on it, not on glass. The
   hairline is an outline, drawn over what scrolls under it. */
.list-wrap[data-look='sb'] {
  --files-floor: var(--bg-1);
  --files-gutter: 16px;
  /* The sheet's top edge in the Files area: 2px under the band (measured in
     Step 1; calc(var(--chrome-band) + 2px) if .fdl-files starts under it).
     Info's card (Task 10) lines up with it. */
  --fp-top: 2px;
  margin: var(--fp-top) 8px 8px;
  padding: 0 16px;
  border-radius: 12px;
  background-color: var(--bg-1);
  background-image: none;
  box-shadow: var(--sbf-glass-shadow);
  outline: 1px solid var(--sbf-glass-line);
  outline-offset: -1px;
}
.list-wrap[data-look='sb'] > .list-inner { max-width: none; padding: 0 0 28px; }
/* Files dragged over the page: the sheet ringed in gold (a drop target is an
   active place) and the line under the head says what a drop does; the
   frame production draws over the whole surface stands down. */
.list-wrap[data-look='sb'].is-drop-target { outline: 2px solid var(--soleil); outline-offset: -2px; }
.fdl-files:has(.list-wrap[data-look='sb'].is-drop-target)::after { display: none; }

/* ── A phone ─────────────────────────────────────────────────────────────── */
/* The sheet is the screen, between App's top bar and its bottom bar, as the
   board is. */
.app.sb-files:not(.is-floating-chrome) .list-wrap[data-look='sb'] {
  margin: 0; padding: 0 12px; border-radius: 0; box-shadow: none; outline: 0;
}
```

- [ ] **Step 3: Import it**

Add `import './clusterBrowser/filesPage.css';` after ListSurface's other imports, and `import './filesPage.css';` in QuickLook.jsx.

- [ ] **Step 4: Check**

Run `cd boards && npm test` (cssTokens, stylesheetNesting).

Screenshot the harness at 1440×900 against `r14/out/A-grid.jpg`. The sheet should sit 8px from the sidebar's right edge, 8px from the window's right and bottom, and 2px under the band, with dots in the gaps. Fix the measured transparent list and margin if needed.

Run (verifier) `tests/sidebar-files-page.spec.js` (`look=today`). Expected: green, because nothing above matches without the look.

- [ ] **Step 5: Commit and push**

---

### Task 6: The head — title ⌄, words, the card's controls, the selection bar and the drop line

**Files:**
- Modify: `boards/src/lib/icons.js` (exports `DownloadSimple, UploadSimple, FolderSimple, FolderSimplePlus, LinkSimple`)
- Modify: `boards/src/components/sidebar/ClusterSwitch.jsx` (optional `width`)
- Create: `boards/src/components/clusterBrowser/FilesPageHead.jsx`
- Modify: `boards/src/components/ListSurface.jsx`:
  - imports;
  - `phoneShell`;
  - A's default sort;
  - the page menu;
  - the selbar as element constants (two orders, one DOM in production);
  - the drop-line const;
  - the sb head;
  - `sb` in the head-measure and sentinel effect deps
- Modify: `boards/src/components/clusterBrowser/filesPage.css` (append)
- Modify: `boards/tests/sidebar-files-page-a.spec.js` (append)

**Interfaces:**
- Consumes:
  - `FilesShowMenu` (Task 4)
  - `SORT_TO_PAGE, SORT_LABELS, sidebarSortOf, sortLabelOf, chipToFilter, filterToChip, chipCountsOf, pageChipsOf, chipLabelOf` (Task 2)
- Produces:
  - `FilesPageHead({ board, boards, phone, meta, download: { label, busy, onClick } | null, shrink: { label, title, onClick } | null, trail, onOpenBoard })`
  - `FilesPageTools({ query, onQuery, searchRef, placeholder, menu, found, faces, viewMode, onViewMode, upsell, onAddFiles })`
  - In ListSurface: `pageChip`, `chipCounts`, `pickChip(id)`, `setPageSort({ key, dir })`, `selbarJsx`, `dropLine`.
  - `ClusterSwitch` takes `width` (px). With it, the list is `Math.min(vw - 16, width)` wide.

- [ ] **Step 1: Write the failing spec tests (append)**

```js
test.describe('the head', () => {
  test('the title is the cluster, and pressing it opens the cluster switch', async ({ page }) => {
    await open(page);
    const title = page.locator('.fp-title-btn');
    await expect(title).toContainText('Feature film');
    await expect(page.locator('.fp-meta')).toContainText('files');
    await title.click();
    const sw = page.locator('.sbf-switch');
    await expect(sw).toBeVisible();
    await sw.getByText('Locations', { exact: true }).click();
    await expect(page.locator('.fp-title-btn')).toContainText('Locations');
  });

  test('Shrink is a word at the right and goes back to the board', async ({ page }) => {
    await open(page);
    const shrink = page.getByRole('button', { name: 'Shrink back to the sidebar' });
    await expect(shrink).toContainText('Shrink');
    await shrink.click();
    await expect(page.locator('[data-sidebarqa-surface="board"]')).toBeVisible();
  });

  test('the card controls: search, All files with Show/Sort/Size, Grid | List, Add files', async ({ page }) => {
    await open(page);
    const search = page.locator('.fp-search input');
    await expect(search).toHaveAttribute('placeholder', 'Search Feature film');
    await search.fill('still-01');
    await expect(page.locator('.fp-found')).toContainText(/of \d+/);
    await search.fill('');
    await page.locator('.fp-tools .sbf-filter-btn').click();
    const menu = page.getByRole('menu', { name: 'Show and sort' });
    await expect(menu.locator('.sbf-menu-label')).toHaveText(['Show', 'Sort']);
    await expect(menu.getByRole('menuitemradio', { name: 'Large' })).toBeVisible();
    await menu.getByRole('menuitemradio', { name: /^Photos/ }).click();
    await expect(page.locator('.fp-tools .sbf-filter-btn')).toContainText('Photos');
    await expect(page.locator('.fp-tools .sbf-filter-btn')).toHaveClass(/is-on/);
    await page.getByRole('radio', { name: 'List' }).click();
    await expect(page.locator('.ct-table.is-classic')).toBeVisible();
    await expect(page.locator('.fp-add')).toContainText('Add files');
  });

  test('a selection turns the controls into what to do with it, Delete with an undo', async ({ page }) => {
    await open(page);
    await page.locator('[data-item-id="film-img-3"]').click();
    await page.locator('[data-item-id="film-img-5"]').click({ modifiers: ['Control'] });
    const bar = page.locator('.fp-head > .list-selbar');
    await expect(bar).toBeVisible();
    await expect(page.locator('.fp-tools')).toHaveCount(0);
    await expect(bar.locator('.list-selbar-count')).toHaveText('2 selected');
    const del = bar.getByRole('button', { name: 'Delete' });
    await expect(del).toHaveClass(/is-danger/);
    await del.click();
    await expect(page.locator('[data-item-id="film-img-3"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('[data-item-id="film-img-3"]')).toHaveCount(1);
  });

  test('files dragged over the page: the line says what a drop does', async ({ page }) => {
    await open(page);
    const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['x'], 'a.jpg', { type: 'image/jpeg' })); return d; });
    await page.locator('.list-wrap').dispatchEvent('dragenter', { dataTransfer: dt });
    await page.locator('.list-wrap').dispatchEvent('dragover', { dataTransfer: dt });
    await expect(page.locator('.fp-drop')).toContainText('Drop to add to Feature film');
    await expect(page.locator('.list-wrap')).toHaveClass(/is-drop-target/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run (verifier): `PW_PORT=<free> npx playwright test tests/sidebar-files-page-a.spec.js -g "the head" --project=desktop-chrome`
Expected: FAIL (no `.fp-title-btn`).

- [ ] **Step 3: Icons, ClusterSwitch `width`, FilesPageHead**

- `icons.js`: export `DownloadSimple, UploadSimple, FolderSimple, FolderSimplePlus, LinkSimple` from Phosphor, in the file's own style (check how `ArrowsInSimple` is exported).
- `ClusterSwitch.jsx`:
  - `placeSwitch(tabs, card, want, fixedWidth = null)`; when `fixedWidth` is set, `width = Math.min(vw - 16, fixedWidth)`.
  - Add the prop `width = null,  // a fixed width (the Files page's title), else the card's` and pass it in `place()`.

```jsx path=boards/src/components/clusterBrowser/FilesPageHead.jsx
// The full Files page's head in the files sidebar's look (direction A; the
// look is filesLook.js): the sidebar's Files card grown full screen. The
// cluster's name is the title, and pressing it opens the card's cluster
// switch (ClusterSwitch); a line says what's in it; Download all and Shrink
// are words at the right. Under it sit the card's own controls: the search
// line, "All files ⌄" (FilesShowMenu), who's here, Grid | List as the card's
// segmented tabs and Add files as its raised chip. A selection turns that
// line into what to do with it, and files dragged over the page into what a
// drop does (ListSurface renders those in its place).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon.jsx';
import { Avatar } from '../primitives.jsx';
import { Search, X, ChevronDown, ArrowsInSimple, DownloadSimple, Plus } from '../../lib/icons.js';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { ClusterSwitch } from '../sidebar/ClusterSwitch.jsx';
import { FilesShowMenu } from '../sidebar/FilesShowMenu.jsx';
import { PathBar } from './PathBar.jsx';

// The top of the tree the switch lists: the cluster's oldest ancestor here.
function rootOf(boards, id) {
  let cur = boards?.[id];
  let guard = 0;
  while (cur?.parent_board_id && boards[cur.parent_board_id] && guard++ < 100) cur = boards[cur.parent_board_id];
  return cur?.id || id;
}

export function FilesPageHead({ board, boards, phone = false, meta = '', download = null, shrink = null, trail = null, onOpenBoard }) {
  // The cluster switch: opened by the title, fading as it closes (110ms, as
  // the card's), focus back on the title.
  const titleRef = useRef(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchClosing, setSwitchClosing] = useState(false);
  const timer = useRef(0);
  const openRef = useRef(false);
  openRef.current = switchOpen;
  useEffect(() => () => clearTimeout(timer.current), []);
  const dropSwitch = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = 0;
    setSwitchClosing(false);
    setSwitchOpen(false);
  }, []);
  const closeSwitch = useCallback(() => {
    if (!openRef.current || timer.current) return;
    const done = () => { timer.current = 0; setSwitchClosing(false); setSwitchOpen(false); titleRef.current?.focus({ preventScroll: true }); };
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    setSwitchClosing(true);
    timer.current = setTimeout(done, 110);
  }, []);
  const open = switchOpen && !switchClosing;
  useDismissOnOutside(titleRef, open, closeSwitch, { ignore: '.sbf-switch' });
  // Another cluster on the page: the switch goes at once.
  useEffect(() => { dropSwitch(); }, [board?.id, dropSwitch]);
  const list = useMemo(
    () => Object.values(boards || {}).filter((b) => b && b.workspace_id === board?.workspace_id && !b.deleted_at),
    [boards, board?.workspace_id]);
  const name = board?.name || 'Untitled cluster';
  return (
    <>
      <div className="fp-titlebar">
        <h1 className="fp-title">
          <button type="button" ref={titleRef} className={`fp-title-btn${open ? ' is-open' : ''}`}
                  aria-haspopup="dialog" aria-expanded={open}
                  title={`${name} · press to see another cluster’s files`}
                  onClick={() => { if (open) closeSwitch(); else { dropSwitch(); setSwitchOpen(true); } }}>
            <span className="fp-title-name">{name}</span>
            <span className="fp-title-caret" aria-hidden="true"><Icon as={ChevronDown} size={14} weight="regular" /></span>
          </button>
        </h1>
        {meta && <span className="fp-meta">{meta}</span>}
        <span className="fp-spacer" />
        {download && (
          <button type="button" className="fp-word fp-dl" onClick={download.onClick} disabled={download.busy}>
            <Icon as={DownloadSimple} size={15} weight="regular" /><span className="fp-word-label">{download.label}</span>
          </button>
        )}
        {shrink && (
          <button type="button" className="fp-word fp-shrink" onClick={shrink.onClick}
                  aria-label={shrink.label} title={shrink.title || shrink.label}>
            <Icon as={ArrowsInSimple} size={15} weight="regular" /><span className="fp-word-label" aria-hidden="true">Shrink</span>
          </button>
        )}
      </div>
      {trail && <div className="fp-trail"><PathBar {...trail} /></div>}
      {switchOpen && createPortal(
        <ClusterSwitch list={list} rootId={rootOf(boards, board?.id)} shownId={board?.id} boardId={null}
                       sheet={phone} focusList={phone} closing={switchClosing}
                       tabsRef={titleRef} cardRef={null} width={320}
                       onPick={(id) => { closeSwitch(); if (id && id !== board?.id) onOpenBoard?.(id); }}
                       onClose={closeSwitch} />,
        document.body,
      )}
    </>
  );
}

// Who's here, once each (the toolbar's facepile, in the card's sizes).
function people(faces) {
  const out = [];
  const seen = new Set();
  for (const p of faces || []) {
    const u = p?.user || p;
    if (!u?.id || seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  return out;
}

export function FilesPageTools({
  query, onQuery, searchRef, placeholder, menu, found = '', faces = null,
  viewMode, onViewMode, upsell = null, onAddFiles = null,
}) {
  const here = people(faces);
  return (
    <div className="fp-tools">
      <div className="sbf-search fp-search">
        <Icon as={Search} size={14} weight="regular" />
        <input ref={searchRef} type="search" value={query} placeholder={placeholder} aria-label={placeholder}
               onChange={(e) => onQuery(e.target.value)}
               onKeyDown={(e) => {
                 if (e.key !== 'Escape') return;
                 e.preventDefault();
                 e.stopPropagation();
                 if (query) onQuery(''); else e.currentTarget.blur();
               }} />
        {query && (
          <button type="button" className="sbf-search-clear" aria-label="Clear"
                  onClick={() => { onQuery(''); searchRef?.current?.focus(); }}>
            <Icon as={X} size={12} weight="regular" />
          </button>
        )}
      </div>
      <FilesShowMenu {...menu} align="left" />
      {found && <span className="fp-found" aria-live="polite">{found}</span>}
      <span className="fp-spacer" />
      {here.length > 0 && (
        <div className="fp-faces" title={`${here.length} here`}>
          {here.slice(0, 4).map((u) => <Avatar key={u.id} name={u.name} color={u.color} size={22} ring />)}
          {here.length > 4 && <span className="fp-face-more">+{here.length - 4}</span>}
        </div>
      )}
      <div className="sbf-tabs fp-seg" role="radiogroup" aria-label="Layout">
        {[['gallery', 'Grid'], ['table', 'List']].map(([id, label]) => (
          <button type="button" key={id} role="radio" aria-checked={viewMode === id}
                  className={`sbf-tab${viewMode === id ? ' is-on' : ''}`} onClick={() => onViewMode(id)}>
            <span className="sbf-tab-label">{label}</span>
          </button>
        ))}
      </div>
      {upsell}
      {onAddFiles && (
        <button type="button" className="sbf-upload fp-add" onClick={onAddFiles}>
          <Icon as={Plus} size={14} weight="regular" /><span className="fp-add-label">Add files</span>
        </button>
      )}
    </div>
  );
}
```

Before relying on them, check the old toolbar's search box (`searchBox` in ClusterBrowserToolbar.jsx) for keys this one must keep. Port any it has, such as Enter behaviour or ⌘F focus, into `FilesPageTools`.

- [ ] **Step 4: Wire ListSurface**

1. Imports:
   - `FilesPageHead, FilesPageTools` from `./clusterBrowser/FilesPageHead.jsx`
   - from `../lib/filesView.js`: `SORT_TO_PAGE, SORT_LABELS, sidebarSortOf, sortLabelOf, chipToFilter, filterToChip, chipCountsOf, pageChipsOf, chipLabelOf`
   - `SORTS` from `../lib/sidebarSort.js`
   - `shellOf` from `../lib/deviceShell.js`
   - icons `DownloadSimple, UploadSimple, FolderSimplePlus` (with `Trash2` already there).
2. Phone: replace `const { isTouch } = useBreakpoint();` with
   ```js
   const bp = useBreakpoint();
   const { isTouch } = bp;
   const phoneShell = shellOf(bp).mobileShell;
   ```
3. A's default sort, the card's (Newest first):
   ```js
   // Direction A sorts as the sidebar's card does until someone picks a sort:
   // newest first. Production keeps board order.
   const SORT0 = sb ? SORT_TO_PAGE.newest : { key: 'board', dir: 'asc' };
   const [sortKey, setSortKey] = useState(prefs0.sortKey || SORT0.key);
   const [sortDir, setSortDir] = useState(prefs0.sortKey ? (prefs0.sortDir || 'desc') : SORT0.dir);
   ```
   The audio-mode reset effect sets `SORT0.key`/`SORT0.dir` in place of `'board'`/`'asc'`.
4. The page's menu, after `availableBuckets`:
   ```js
   // Direction A's "All files ⌄" (FilesShowMenu): the card's chips and sorts
   // over this page's filters and sort keys (lib/filesView.js).
   const pageChip = filterToChip(filters, unplacedOnly);
   const chipCounts = useMemo(() => chipCountsOf(items, { placement: markUnplaced }), [items, markUnplaced]);
   const pickChip = (id) => { const f = chipToFilter(id); setFilters(new Set(f.buckets)); setUnplacedOnly(f.unplacedOnly); };
   ```
   - `markUnplaced` must be declared before this; move the block below it if needed.
   - `setPageSort({ key, dir })` mirrors `onSort`: it sets both states, calls `writeBrowserPrefs({ sortKey: key, sortDir: dir })`, and logs as `onSort` logs (read `onSort` first and copy its event call, if any).
5. The selection bar: rewrite the JSX at the end of `.list-inner` as element constants plus `selbarJsx`.
   - Production keeps today's order: count, Download, Put, Move, Copy, New cluster, Delete, Info, Done/Clear, hint.
   - sb uses: Done/Clear, count, `<span className="list-selbar-sep" aria-hidden="true" />`, Download, Put, Move, Copy, New cluster, Delete (`is-danger`), `<span className="list-selbar-spacer" />`, hint, Info.
   - In sb, icons are `DownloadSimple` and `FolderSimplePlus`; production's stay as they are.
   - Render `{!sb && selbarJsx}` where it is today, and `selbarJsx` inside the sb head.
6. The drop line: extract the `dropBanner` ternary from `toolbarJsx` into `const dropLine = …` (same strings) and pass `dropBanner={dropLine}`.
7. The sb head, right after `{isPanel && …lp-head…}`:
   ```jsx
   {sb && <div className="lp-sentinel" ref={headSentinelRef} aria-hidden="true" />}
   {sb && (
     <div className={`fp-head${headStuck ? ' is-stuck' : ''}`} ref={lpHeadRef}>
       <FilesPageHead board={board} boards={boards} phone={phoneShell}
         meta={phoneShell ? '' : pageMeta}
         download={canDownloadAll && !phoneShell ? {
           label: zipping ? 'Preparing…' : narrowed ? `Download ${downloadableVisible.length}` : 'Download all',
           busy: zipping, onClick: downloadAll } : null}
         shrink={dockControls?.canShrink && dockControls?.onShrink ? {
           label: dockControls.shrinkLabel || 'Beside board', title: dockControls.shrinkTitle, onClick: dockControls.onShrink } : null}
         trail={fullPathBar?.canBack ? fullPathBar : null}
         onOpenBoard={onOpenBoard} />
       {selbarJsx || (dropLine ? (
         <div className="fp-drop-line">
           <div className={`fp-drop${dropLine.blocked ? ' is-blocked' : ''}`} role="status">
             <Icon as={UploadSimple} size={15} weight="regular" />{dropLine.text}
           </div>
         </div>
       ) : otherCards.length > 0 ? (
         <FilesPageTools query={query} onQuery={setQuery} searchRef={searchRef}
           placeholder={`Search ${board?.name || 'this cluster'}`}
           menu={pageMenu}
           found={loading ? '' : narrowed ? `${visibleItems.length} of ${otherCards.length}` : (packSummary || '')}
           faces={phoneShell ? null : facePeers}
           viewMode={viewMode} onViewMode={onViewMode}
           upsell={showStorageUpsell && onStorageUpsell ? upsellJsx : null}
           onAddFiles={canEdit ? openAddPicker : null} />
       ) : null)}
     </div>
   )}
   ```
   - `pageMenu` is `{ label, on, title, ariaLabel: 'Show and sort', sections, extra }`, where:
     ```js
     const pageSort = sidebarSortOf(sortKey, sortDir);
     const sortWords = pageSort ? SORT_LABELS[pageSort] : sortLabelOf(sortKey, sortDir);
     const menuLabel = chipLabelOf(pageChip);
     // label: menuLabel; on: pageChip !== 'all';
     // title, the sidebar's own wording without its group:
     //   `Showing ${menuLabel.toLowerCase()} · sorted by ${sortWords.toLowerCase()}`
     ```
     and the sections are:
     - Show: `pageChipsOf(chipCounts, pageChip)`, labelled 'All files' for `all`, with counts, `checked: pageChip === c.id`, `onPick: () => pickChip(c.id)`.
     - Sort: the four `SORTS` with `checked: sidebarSortOf(sortKey, sortDir) === so` and `onPick: () => setPageSort(SORT_TO_PAGE[so])`. When `sidebarSortOf` is null, add one checked item: `{ key: 'custom', label: sortLabelOf(sortKey, sortDir), checked: true, onPick: () => {} }`.
     - `extra` in Grid: a separator, then a Size row with three `menuitemradio` buttons. They are aria-labelled Small / Medium / Large, show `S M L`, use `onTileSize(k)`, and leave the menu open. Markup: `<div className="sbf-menu-row fp-size-row" role="group" aria-label="Tile size"><span className="sbf-menu-row-label">Size</span><div className="sbf-tabs">…</div></div>`.
   - `upsellJsx` is the same storage upsell the old toolbar showed. Read `showUpsell` in ClusterBrowserToolbar and render its element here with the same class and `onUpsell` handler (the `EV.LIST_UPSELL_CTA` log stays).
8. In sb, don't render the old head: `!isPanel && !sb &&` on the `cb-pagehead` header, its sentinel and the `cb-head` toolbar.
9. Add `sb` to the deps of the head-measure and sentinel effects. In sb they must run even when `filesBlockShown` is false.
10. The keyboard guard: `document.querySelector('.ctx-menu, .cbt-menu, .sbf-menu, .sbf-switch')`.

Append to `filesPage.css`:

```css
/* ── The head ────────────────────────────────────────────────────────────── */
/* Sticky in the sheet's scroller: the title line, then the card's controls,
   or the selection's actions, or what a drop does. An edge once something
   has scrolled under it. */
.list-wrap[data-look='sb'] .fp-head {
  position: sticky; top: 0; z-index: 9;
  margin: 0 -16px;
  background: var(--bg-1);
  border-bottom: 1px solid transparent;
  transition: border-color var(--dur-base) var(--ease);
}
.list-wrap[data-look='sb'] .fp-head.is-stuck { border-bottom-color: var(--line-1); }
.fp-titlebar {
  display: flex; align-items: center; gap: 12px; min-width: 0;
  height: 48px; box-sizing: border-box; padding: 10px 10px 0 12px;
}
.fp-title { display: flex; min-width: 0; margin: 0; }
.fp-title-btn {
  display: inline-flex; align-items: center; gap: 6px; min-width: 0; height: 32px; padding: 0 6px 0 4px;
  border: 0; border-radius: 8px; background: transparent; cursor: pointer; text-align: left;
  color: var(--ink-0); font: 600 20px/1 var(--font-sans); letter-spacing: -0.01em;
  transition: background-color var(--dur-fast) var(--ease);
}
.fp-title-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-title-caret { flex: none; display: grid; place-items: center; width: 20px; height: 20px; color: var(--ink-2); }
.fp-title-btn:hover { background: var(--bg-hov); }
.fp-title-btn.is-open { background: var(--sbf-chip); box-shadow: var(--sbf-chip-shadow); }
.fp-title-btn:focus-visible { outline: 2px solid var(--soleil); outline-offset: -2px; }
.fp-meta {
  min-width: 0; margin-left: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--ink-2); font: 400 12px/1 var(--font-sans); font-variant-numeric: tabular-nums;
}
.fp-spacer { flex: 1 1 auto; min-width: 8px; }
/* Words for actions, as the sidebar's: ink, a quiet icon before them. */
.fp-word {
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px;
  border: 0; border-radius: 7px; background: transparent; cursor: pointer; white-space: nowrap;
  color: var(--ink-1); font: 500 13px/1 var(--font-sans);
  transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.fp-word svg { flex: none; color: var(--ink-2); }
.fp-word:hover:not(:disabled) { background: var(--bg-hov); color: var(--ink-0); }
.fp-word:disabled { opacity: .55; cursor: default; }
.fp-word:focus-visible { outline: 2px solid var(--soleil); outline-offset: -2px; }
.fp-titlebar > .fp-word:last-child { margin-right: -4px; }
.fp-trail { padding: 0 12px 2px; }

/* The card's controls, at the page's size. */
.fp-tools {
  display: flex; align-items: center; gap: 6px; min-width: 0;
  height: 50px; box-sizing: border-box; padding: 8px 10px 10px 12px;
}
.fp-search { flex: 0 1 340px; min-width: 140px; }
.fp-search input { font-weight: 400; }
.fp-found {
  margin-left: 4px; white-space: nowrap;
  color: var(--ink-2); font: 400 12px/1 var(--font-sans); font-variant-numeric: tabular-nums;
}
.fp-faces { display: inline-flex; align-items: center; margin-right: 6px; }
.fp-faces > * + * { margin-left: -5px; }
.fp-face-more { margin-left: 4px; color: var(--ink-2); font: 500 11px/1 var(--font-sans); }
.fp-seg { flex: 0 0 auto; margin-right: 2px; }
.fp-seg .sbf-tab { flex: 0 0 auto; padding: 0 12px; }
.fp-add { margin-left: 0; height: 30px; padding: 0 12px 0 10px; font-size: 12.5px; }
/* The menu's one-line Size (Grid). */
.sbf-menu .fp-size-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 34px; padding: 0 4px 0 28px; flex-shrink: 0; }
.fp-size-row .sbf-menu-row-label { color: var(--ink-1); font: 500 13px/1 var(--font-sans); }
.fp-size-row .sbf-tabs { flex: none; }
.fp-size-row .sbf-tab { flex: none; height: 24px; padding: 0 10px; font-size: 11.5px; }

/* A selection: the same bar production floats at the foot, set in the head
   in the controls' place (Drive, Dropbox), on the card's track. */
.fp-head > .list-selbar {
  position: static; width: auto; max-width: none;
  height: 40px; box-sizing: border-box; margin: 2px 10px 8px 12px; padding: 0 4px; gap: 2px;
  border: 0; border-radius: 9px; background: var(--sbf-track); box-shadow: none;
  animation: none; color: var(--ink-1); font-size: 13px;
}
.fp-head > .list-selbar::after { display: none; }
.fp-head .list-selbar-count {
  padding: 0 6px 0 4px; margin: 0; border: 0;
  color: var(--ink-0); font: 600 13px/1 var(--font-sans);
}
.fp-head .list-selbar-sep { flex: none; width: 1px; height: 18px; margin: 0 4px; background: var(--line-2); }
.fp-head .list-selbar-spacer { flex: 1 1 auto; min-width: 8px; }
.fp-head .list-selbar-act {
  height: 30px; margin: 0; padding: 0 10px; gap: 6px; border: 0; border-radius: 7px;
  color: var(--ink-1); font: 500 13px/1 var(--font-sans);
}
.fp-head .list-selbar-act svg { color: var(--ink-2); }
.fp-head .list-selbar-act:hover:not(:disabled) { background: var(--bg-hov); color: var(--ink-0); }
.fp-head .list-selbar-act.is-on { background: var(--sbf-chip); box-shadow: var(--sbf-chip-shadow); color: var(--ink-0); }
.fp-head .list-selbar-act.is-danger { color: #ff8a80; }
.fp-head .list-selbar-act.is-danger svg { color: currentColor; }
[data-theme='light'] .fp-head .list-selbar-act.is-danger { color: #c62828; }
.fp-head .list-selbar-clear { width: 30px; padding: 0; justify-content: center; }
.fp-head .list-selbar-hint { margin: 0 8px 0 0; padding: 0; color: var(--ink-2); font: 400 12px/1 var(--font-sans); }
.fp-head .list-selbar-hint kbd { padding: 0; border: 0; background: none; color: var(--ink-1); font: 500 11px/1 var(--font-sans); }

/* Files dragged over: what a drop does, in the controls' place. */
.fp-drop-line { display: flex; align-items: center; height: 50px; box-sizing: border-box; padding: 8px 10px 10px 12px; }
.fp-drop {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 12px;
  border: 1px dashed color-mix(in srgb, var(--soleil) 60%, transparent); border-radius: 8px;
  background: var(--soleil-soft); color: var(--ink-0); font: 500 13px/1 var(--font-sans);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fp-drop svg { flex: none; color: var(--soleil); }
.fp-drop.is-blocked { border-color: var(--line-2); background: var(--sbf-track); color: var(--ink-1); }
.fp-drop.is-blocked svg { color: var(--ink-2); }
```

- [ ] **Step 5: Run**

Run: `cd boards && npm test`
Expected: green. The source pin `aria-label={dockControls.shrinkLabel || 'Beside board'}` is still in the non-sb header.

Then (verifier): `tests/sidebar-files-page-a.spec.js`, `tests/sidebar-files-page.spec.js` and `tests/sidebar-files.spec.js` on desktop-chrome. Expected: green.

Screenshot against `A-grid.jpg` and `A-select.jpg`, and match spacing by eye: title 20/600, the meta's baseline, the words' 30px, the 340px search, the seg and the chip.

- [ ] **Step 6: Commit and push**

---

### Task 7: Grid — the card's shelves, grown

**Files:**
- Create: `boards/src/components/clusterBrowser/FilesShelves.jsx`
- Modify: `boards/src/components/clusterBrowser/JustifiedGallery.jsx`:
  - props `gap = GALLERY_GAP`, `captionH = CAPTION_H` and `rowHeight = null`, passed to `layoutGallery` (import `GALLERY_GAP`, `CAPTION_H`);
  - `captionless={captionH === 0}` to `ClusterTile`.
- Modify: `boards/src/components/clusterBrowser/ClusterTable.jsx` (the `bare` prop: no header, `is-bare` class)
- Modify: `boards/src/components/clusterBrowser/ClusterRow.jsx` (the `bare` prop; shared with Task 8's `classic`)
- Modify: `boards/src/components/ListSurface.jsx`:
  - `sections`, `openedShelves`, `closedShelves`, `shelfGrid`;
  - `navItems` / `pickOrder`;
  - `shelfNavRef` + `onShelfLayout`;
  - arrows via `navStep`;
  - the sb body branch with `FilesShelves`;
  - the Clusters shelf.
- Modify: `boards/src/components/clusterBrowser/filesPage.css` (append)
- Modify: `boards/tests/sidebar-files-page-a.spec.js` (append)

**Interfaces:**
- Consumes: `sectionsOf, shelfClosed, shelfFoldable, screenOrderOf, navStep` (Task 2).
- Produces:
  - `FilesShelfHead({ id, label, count, closed, foldable, onToggle, first })`
  - `FilesShelves({ folders, sections, closedShelves, foldable, onToggle, galleryProps, tableProps, tileSize, onShelfLayout })`
  - `ClusterTable` / `ClusterRow` `bare` prop
  - `JustifiedGallery` `gap` / `captionH` / `rowHeight`

- [ ] **Step 1: Write the failing spec tests (append)**

```js
test.describe('Grid: the shelves', () => {
  test('clusters first, then the shelves in the card order; minor shelves closed until opened', async ({ page }) => {
    await open(page);
    const heads = page.locator('.fp-shelf');
    await expect(heads.first()).toContainText('Clusters');
    await expect(page.locator('.fp-cls .ft')).toHaveCount(3);
    const order = await heads.evaluateAll((els) => els.map((e) => e.getAttribute('data-shelf')));
    expect(order).toEqual(['clusters', 'photos', 'video', 'audio', 'files', 'writing', 'links', 'more']);
    await expect(page.locator('.fp-shelf[data-shelf="writing"]')).toHaveClass(/is-closed/);
    await expect(page.locator('[data-item-id="film-note-0"]')).toHaveCount(0);
    await page.locator('.fp-shelf[data-shelf="writing"] .sbf-shelf-toggle').click();
    await expect(page.locator('[data-item-id="film-note-0"]')).toHaveCount(1);
  });

  test('photos and video are captionless justified tiles; the rest are rows', async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-item-id="film-img-3"]')).toHaveClass(/is-captionless/);
    await expect(page.locator('[data-item-id="film-img-3"] .ct-tile-meta')).toHaveCount(0);
    await expect(page.locator('[data-item-id="film-aud-0"]')).toHaveClass(/ct-row/);
  });

  test('the arrows walk from the last photo into the video shelf', async ({ page }) => {
    await open(page);
    const ids = await page.locator('.fp-shelf[data-shelf="photos"] + .ct-jg [data-item-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')));
    await page.locator(`[data-item-id="${ids[ids.length - 1]}"]`).click();
    await page.keyboard.press('ArrowRight');
    const active = await page.locator('.ct-tile.is-active, .ct-row.is-active').first().getAttribute('data-item-id');
    const video = await page.locator('.fp-shelf[data-shelf="video"] + .ct-jg [data-item-id]').first().getAttribute('data-item-id');
    expect(active).toBe(video);
  });

  test('a search shows every shelf with a hit, minor ones open', async ({ page }) => {
    await open(page);
    await page.locator('.fp-search input').fill('Call sheet');
    await expect(page.locator('[data-item-id="film-note-0"]')).toHaveCount(1);
    await expect(page.locator('.fp-shelf[data-shelf="writing"]')).not.toHaveClass(/is-closed/);
  });
});
```

- [ ] **Step 2: Run to verify they fail** (verifier, `-g "Grid: the shelves"`).

- [ ] **Step 3: Implement**

```jsx path=boards/src/components/clusterBrowser/FilesShelves.jsx
// The full Files page's Grid in the files sidebar's look (direction A): the
// card's shelves, grown. Clusters first (this one's sub-clusters and the
// clusters linked into it, as cards with their covers), then the files shelf
// by shelf (lib/filesView.js): photos and video in a justified grid without
// captions (the picture is the name; Info and Quick look carry it), the rest
// as rows with columns. Notes, links and the rest start closed, as the
// card's do, until opened.

import { useRef } from 'react';
import { Icon } from '../Icon.jsx';
import { ChevronRight } from '../../lib/icons.js';
import { TILE_SIZES, DEFAULT_TILE_SIZE } from '../../lib/justifiedGrid.js';
import { JustifiedGallery } from './JustifiedGallery.jsx';
import { ClusterTable } from './ClusterTable.jsx';

// A shelf's heading, as the card's (.sbf-shelf): its name and count, and a
// caret when it opens and closes.
export function FilesShelfHead({ id, label, count, closed = false, foldable = false, onToggle = null, first = false }) {
  const body = (
    <>
      {label} <span className="sbf-shelf-count">{count}</span>
      {foldable && <span className="sbf-shelf-caret" aria-hidden="true"><Icon as={ChevronRight} size={10} weight="regular" /></span>}
    </>
  );
  return (
    <div className={`sbf-shelf fp-shelf${closed ? ' is-closed' : ''}${first ? ' is-first' : ''}`} data-shelf={id}>
      {foldable ? (
        <button type="button" className="sbf-shelf-toggle" aria-expanded={!closed} onClick={onToggle}>{body}</button>
      ) : (
        <h2 className="sbf-shelf-toggle is-static">{body}</h2>
      )}
    </div>
  );
}

// Video lies a little lower than photos (the card's shapes are wider).
const VIDEO_ROW = 0.82;

export function FilesShelves({
  folders = null,           // { count, nodes } — the Clusters shelf, or null
  sections, closedShelves, foldable, onToggle,
  galleryProps, tableProps, tileSize = DEFAULT_TILE_SIZE,
  onShelfLayout,            // (shelfId, { tiles, ids }) => void, for the arrows
}) {
  // One layout callback per shelf, kept, so the gallery's effect doesn't
  // see a new one every render.
  const fns = useRef(new Map());
  const layoutFor = (id) => {
    let f = fns.current.get(id);
    if (!f) { f = (nav) => onShelfLayout?.(id, nav); fns.current.set(id, f); }
    return f;
  };
  const rowH = TILE_SIZES[tileSize] || TILE_SIZES[DEFAULT_TILE_SIZE];
  let first = true;
  const head = (props) => { const h = <FilesShelfHead {...props} first={first} />; first = false; return h; };
  return (
    <>
      {folders && folders.count > 0 && (
        <>
          {head({ id: 'clusters', label: 'Clusters', count: folders.count })}
          <div className="fp-cls">{folders.nodes}</div>
        </>
      )}
      {sections.map((s) => {
        const closed = closedShelves.has(s.id);
        const h = head({ id: s.id, label: s.label, count: s.count, closed, foldable: foldable(s), onToggle: () => onToggle(s.id) });
        if (closed) return <div key={s.id}>{h}</div>;
        return (
          <div key={s.id}>
            {h}
            {s.layout === 'grid' ? (
              <JustifiedGallery {...galleryProps} items={s.items} tileSize={tileSize}
                gap={8} captionH={0} rowHeight={s.id === 'video' ? Math.round(rowH * VIDEO_ROW) : rowH}
                onLayout={layoutFor(s.id)} />
            ) : (
              <ClusterTable {...tableProps} items={s.items} bare />
            )}
          </div>
        );
      })}
    </>
  );
}
```

The specs use `.fp-shelf[data-shelf="photos"] + .ct-jg`. A wrapping `<div>` per shelf keeps the heading and its gallery as siblings, so that selector holds.

`JustifiedGallery`: in `layoutGallery(entries, { width, rowHeight: rowHeight ?? (TILE_SIZES[tileSize] || …), gap, captionH })`, add `rowHeight, gap, captionH` to the memo deps, and pass `captionless={captionH === 0}` to `ClusterTile`. For now ClusterTile accepts and ignores `captionless` (Task 9 draws it); in this task only the class goes on: `${captionless ? ' is-captionless' : ''}`, and when captionless the `.ct-tile-meta` isn't rendered unless renaming.

`ClusterTable`: the `bare = false` prop.
- When true, the `.ct-head` isn't rendered and the table class gets ` is-bare`.
- Rows pass `bare` to `ClusterRow`.
- `rowIndex` math is unchanged (aria-rowcount stays rows + 1 only when it isn't bare: when bare, `aria-rowcount={virtual ? rows.length : undefined}` and the first row is index 1).

`ClusterRow` `bare` prop (Task 8 adds `classic`; both share the status cell):
- Name pills (`ct-onboard`) are not rendered when `bare || classic`.
- The `.ct-sub` lines are hidden by CSS.
- The type cell is `item.typeLabel`.
- The size cell, when bare:
  ```js
  const sizeText = bare
    ? ((item.kind === 'audio' || item.kind === 'video') && Number.isFinite(item.durationSec) ? formatDuration(item.durationSec)
      : Number.isFinite(item.sizeBytes) && item.sizeBytes > 0 ? humanSize(item.sizeBytes)
      : item.kind === 'link' ? (item.sub || '') : '')
    : …today's…;
  ```
- The presence cell, when `bare || classic`:
  ```jsx
  {peer ? (<><Avatar name={peer.user.name} color={peer.user.color} size={18} ring /><span className="ct-status">{(peer.user.name || '').split(/\s+/)[0] || 'Someone'} has it selected</span></>)
   : markUnplaced && item.unplaced ? (<><span className="ct-stored" aria-hidden="true" /><span className="ct-status">Not on board</span></>)
   : onBoard ? <span className="ct-status">On board</span> : null}
  {canDownload && !peer && …today's .ct-dl…}
  ```
- Production (neither prop) renders exactly today's cells.

`ListSurface` (sb only):

```js
// ── Direction A's shelves (lib/filesView.js) ─────────────────────────────
const shelfGrid = sb && viewMode === 'gallery';
const sections = useMemo(() => (shelfGrid ? sectionsOf(displayItems) : []), [shelfGrid, displayItems]);
// Notes, Links and Other opened this session (they start closed).
const [openedShelves, setOpenedShelves] = useState(() => new Set());
const closedShelves = useMemo(
  () => new Set(sections.filter((s) => shelfClosed(s, { chip: pageChip, query, opened: openedShelves })).map((s) => s.id)),
  [sections, pageChip, query, openedShelves]);
const toggleShelf = useCallback((id) => setOpenedShelves((prev) => {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}), []);
const shelfNavRef = useRef(new Map());
const onShelfLayout = useCallback((id, nav) => { shelfNavRef.current.set(id, nav); }, []);
```

- `navItems`: `if (shelfGrid) return screenOrderOf(sections, { closed: closedShelves, expandedGroups });`, with the deps updated. That puts Quick look, the tab stop and Space in shelf order.
- `pickOrder` (after `navItems`) is `const pickOrder = shelfGrid ? navItems.filter((it) => !it.isGroup) : visibleItems;`. It is used by the ranged click in `onTileClick` and by ⌘A, in place of `visibleItems`.
- The arrows in the keyboard handler:
  ```js
  if (shelfGrid) {
    const parts = sections.filter((s) => !closedShelves.has(s.id)).map((s) => {
      const nav = shelfNavRef.current.get(s.id);
      return s.layout === 'grid' && nav
        ? { layout: 'grid', ids: nav.ids, tiles: nav.tiles }
        : { layout: 'rows', ids: screenOrderOf([s], { expandedGroups }).map((it) => it.id) };
    });
    const next = navStep(parts, activeId, arrow);
    if (next == null || next === activeId) return;
    e.preventDefault();
    setActiveId(next);
    return;
  }
  ```
  The deps gain `shelfGrid, sections, closedShelves, expandedGroups, pickOrder`.
- Space on an audio row in A's Grid auditions, as the table does: `if (it.kind === 'audio' && (isTable || shelfGrid))`.

The sb body replaces `{filesBlockShown && (<div className="cluster-browser">…)}` with a branch:
- Production keeps `{!sb && filesBlockShown && (…today's…)}`.
- `detailJsx` is extracted as a const shared by both branches.

```jsx
{sb && (
  <div className="cluster-browser">
    <div className={`cb-split ${detailTarget ? 'has-detail' : ''}`}>
      <div className="cb-main"
           onDragStart={filesDraggable ? onFilesDragStart : undefined}
           onDragEnd={filesDraggable ? onFilesDragEnd : undefined}>
        {viewMode === 'gallery' && shownFolders.length > 0 && !visibleItems.length && (
          <FilesShelves folders={folderShelf} sections={[]} closedShelves={closedShelves}
            foldable={() => false} onToggle={toggleShelf} galleryProps={galleryProps} tableProps={tableProps} />
        )}
        {visibleItems.length > 0 && (viewMode === 'gallery' ? (
          <FilesShelves folders={folderShelf} sections={sections} closedShelves={closedShelves}
            foldable={(s) => shelfFoldable(s, { chip: pageChip, query })} onToggle={toggleShelf}
            galleryProps={galleryProps} tableProps={tableProps} tileSize={tileSize} onShelfLayout={onShelfLayout} />
        ) : (
          /* Task 8: the classic table */ null
        ))}
        {/* Task 10: empty, no match and loading states; In sub-clusters */}
      </div>
      {detailJsx}
    </div>
  </div>
)}
```

The folders and their shelf:

```js
// The clusters in this one (and linked into it), first: by name on a search,
// gone while a chip filters to a kind of file.
const shownFolders = useMemo(() => {
  if (!sb || pageChip !== 'all') return [];
  const q = query.trim().toLowerCase();
  const all = [...subBoards.map((b) => ({ kind: 'sub', b, name: b.name || '' })),
    ...linkedCards.map((c) => ({ kind: 'link', c, name: boards[c.target]?.name || c.name || '' }))];
  return q ? all.filter((f) => f.name.toLowerCase().includes(q)) : all;
}, [sb, pageChip, query, subBoards, linkedCards, boards]);
const folderShelf = { count: shownFolders.length, nodes: shownFolders.map((f) => (f.kind === 'sub' ? renderSubFolder(f.b) : renderLinkedFolder(f.c))) };
```

- `galleryProps` holds the props today's `<JustifiedGallery>` gets, without `items` and `tileSize`. `onLayout` is set per shelf, and `onGalleryLayout` stays for production.
- `tableProps` holds today's `<ClusterTable>` props without `items`.
- Both are built as objects once per render.
- In sb, the old folder sections (`!isPanel && subBoards.length > 0`, `linkedCards.length > 0`) are not rendered: guard them with `!sb`. `renderSubFolder` / `renderLinkedFolder` pass `peers` in full mode (unchanged).

Append to `filesPage.css`:

```css
/* ── Grid: the card's shelves, grown ─────────────────────────────────────── */
.list-wrap[data-look='sb'] .fp-shelf { height: 36px; padding: 0 4px 0 2px; }
.list-wrap[data-look='sb'] .fp-shelf.is-first { height: 30px; }
.list-wrap[data-look='sb'] .fp-shelf .sbf-shelf-toggle { flex: 0 1 auto; margin: 0; }
.list-wrap[data-look='sb'] .fp-shelf .sbf-shelf-caret { opacity: 1; }
.list-wrap[data-look='sb'] .fp-cls,
.list-wrap[data-look='sb'] .cb-main .ct-jg,
.list-wrap[data-look='sb'] .ct-table.is-bare { margin-bottom: 6px; }
/* Clusters in this one: cards with their covers. */
.fp-cls { display: flex; flex-wrap: wrap; gap: 8px; }
.list-wrap[data-look='sb'] .fp-cls .ft {
  width: 236px; height: 56px; box-sizing: border-box; padding: 0 12px 0 8px; gap: 10px;
  border: 0; border-radius: 10px; box-shadow: none;
  background: color-mix(in srgb, var(--ink-0) 4%, transparent);
}
[data-theme='light'] .list-wrap[data-look='sb'] .fp-cls .ft { background: rgba(10, 10, 12, .035); }
.list-wrap[data-look='sb'] .fp-cls .ft:hover { background: color-mix(in srgb, var(--ink-0) 7%, transparent); }
.list-wrap[data-look='sb'] .fp-cls .ft-cover { width: 40px; height: 40px; border-radius: 7px; }
.list-wrap[data-look='sb'] .fp-cls .ft-name { color: var(--ink-0); font: 500 13px/1.2 var(--font-sans); }
.list-wrap[data-look='sb'] .fp-cls .ft-meta { color: var(--ink-2); font: 400 12px/1.2 var(--font-sans); font-variant-numeric: tabular-nums; }
.list-wrap[data-look='sb'] .fp-cls .ft.is-selected {
  background: var(--bg-act); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--soleil) 55%, transparent);
}
.list-wrap[data-look='sb'] .fp-cls .ft.is-drop-target { box-shadow: inset 0 0 0 2px var(--soleil); }
/* Rows on a shelf: no box, no header, the columns of the classic table. */
.list-wrap[data-look='sb'] .ct-table { border: 0; border-radius: 0; background: transparent; overflow: visible; }
.list-wrap[data-look='sb'] .ct-table.is-bare .ct-row {
  grid-template-columns: minmax(0, 1fr) 120px 96px 96px 190px; column-gap: 12px;
  height: 36px; padding: 0 8px 0 4px; border: 0; border-radius: 6px; contain-intrinsic-size: auto 36px;
}
.list-wrap[data-look='sb'] .ct-table.is-bare .ct-thumb { width: 28px; height: 28px; border-radius: 5px; }
.list-wrap[data-look='sb'] .ct-sub { display: none; }
.list-wrap[data-look='sb'] .ct-row .ct-name { color: var(--ink-1); font: 500 13px/1.2 var(--font-sans); }
.list-wrap[data-look='sb'] .ct-cell.ct-c-type,
.list-wrap[data-look='sb'] .ct-cell.ct-c-size,
.list-wrap[data-look='sb'] .ct-cell.ct-c-date { color: var(--ink-2); font: 400 12px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
.list-wrap[data-look='sb'] .ct-cell.ct-c-presence {
  display: flex; align-items: center; gap: 7px; min-width: 0; overflow: hidden;
  color: var(--ink-2); font: 400 12px/1 var(--font-sans); white-space: nowrap;
}
.ct-status { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ct-stored { flex: none; width: 7px; height: 7px; border-radius: 50%; box-sizing: border-box; border: 1.5px solid var(--ink-3); }
.list-wrap[data-look='sb'] .ct-row.is-selected,
.list-wrap[data-look='sb'] .ct-row.is-selected + .ct-row.is-selected {
  background: var(--bg-act); border-bottom-color: transparent;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--soleil) 55%, transparent);
}
```

- [ ] **Step 4: Run**

Run `npm test`, then (verifier) the A spec plus the old page spec. Screenshot against `A-grid.jpg` and `A-rest.jpg` (scroll to the Video shelf).

- [ ] **Step 5: Commit and push**

---

### Task 8: List — the classic Finder table

**Files:**
- Modify: `boards/src/components/clusterBrowser/ClusterTable.jsx` (`variant`, `leadRows`, zebra)
- Modify: `boards/src/components/clusterBrowser/ClusterRow.jsx` (`classic`, `zebra`)
- Modify: `boards/src/components/clusterBrowser/FolderTiles.jsx` (`FolderRow`, `countLabel` exported)
- Modify: `boards/src/components/ListSurface.jsx` (the sb table branch; folder rows)
- Modify: `boards/src/components/clusterBrowser/filesPage.css` (append)
- Modify: `boards/tests/sidebar-files-page-a.spec.js` (append)

**Interfaces:**
- Consumes: `bare` and the shared status cell (Task 7).
- Produces:
  - `ClusterTable({ …, variant: 'classic' | null, leadRows: ReactNode[] | null })`
  - `ClusterRow({ …, classic, zebra })`
  - `FolderRow({ board, name, linked, missing, peers, selected, dropTarget, springing, rename, checks, zebra, audioMode, dateKey, ...divProps })`

- [ ] **Step 1: Write the failing spec tests (append)**

```js
test.describe('List: the classic table', () => {
  test('clusters first, then every file, newest first, sortable heads', async ({ page }) => {
    await open(page);
    await page.getByRole('radio', { name: 'List' }).click();
    const table = page.locator('.ct-table.is-classic');
    await expect(table.locator('.ct-head .ct-th')).toHaveText([/Name/, /Kind/, /Size/, /Added/]);
    const rows = table.locator('.ct-row');
    await expect(rows.nth(0)).toHaveClass(/ct-folder-row/);
    await expect(rows.nth(0)).toContainText('Locations');
    await expect(rows.nth(0)).toContainText('Cluster');
    await expect(rows.nth(2)).toContainText('Linked cluster');
    await expect(rows.nth(3)).not.toHaveClass(/ct-folder-row/);
    await expect(table.locator('.ct-row.is-zebra').first()).toBeVisible();
    await expect(table.locator('[data-item-id="film-img-2"]')).toContainText('has it selected');
    await expect(table.locator('[data-item-id="film-wait-0"]')).toContainText('Not on board');
    await table.locator('.ct-th', { hasText: 'Name' }).click();
    await expect(page.locator('.fp-tools .sbf-filter-btn')).toHaveAttribute('title', /sorted by name/);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

`ClusterTable`:
- Props: `variant = null` (`'classic'`: the Finder table) and `leadRows = null` (rows drawn before the files: Clusters).
- `const classic = variant === 'classic';`
- Class: ``ct-table${virtual ? ' is-windowed' : ''}${classic ? ' is-classic' : ''}${bare ? ' is-bare' : ''}``.
- The header says `Kind` instead of `Type` when classic: `th('ct-c-type', 'type', classic ? 'Kind' : 'Type')`.
- Before `.ct-body`: `{leadRows?.length ? <div className="ct-lead" role="rowgroup">{leadRows}</div> : null}`.
- Zebra by absolute place, so windowing can't shift it: `const zebraAt = (i) => classic && ((leadRows?.length || 0) + i) % 2 === 1;`, passing `zebra={zebraAt(i)}` to `ClusterRow` and `GroupRow` (GroupRow gets ` is-zebra` in its class).
- `classic` goes to `ClusterRow`.

`ClusterRow`:
- `classic = false` and `zebra = false` props; class gets `${zebra ? ' is-zebra' : ''}`.
- The status cell from Task 7 applies when `bare || classic`.
- When classic, the size cell is the file's size only: `Number.isFinite(item.sizeBytes) && item.sizeBytes > 0 ? humanSize(item.sizeBytes) : ''`. Never a length.

`FolderTiles.jsx`: `export function countLabel`, plus (imports `FolderSimple, LinkSimple` from icons and `relativeTimeShort`):

```jsx
// A cluster as a row of the classic List (the full Files page, direction A):
// first in the table, as folders are in Finder. Kind says Cluster or Linked
// cluster, Size how much is in it, and the last column who's in it now.
// Interaction is the caller's, as for FolderTile.
export const FolderRow = memo(function FolderRow({
  board, name, linked = false, missing = false, peers = null, selected = false, dropTarget = false,
  springing = false, rename = null, checks = false, zebra = false, audioMode = false, dateKey = 'created',
  className = '', ...divProps
}) {
  const people = [];
  const seen = new Set();
  for (const p of peers || []) {
    const u = p?.user || p;
    if (!u?.id || seen.has(u.id)) continue;
    seen.add(u.id);
    people.push(u);
  }
  const label = name || board?.name || (linked ? 'Linked cluster' : 'Untitled cluster');
  const when = dateKey === 'created' ? board?.created_at : (board?.updated_at || board?.created_at);
  const first = people[0] ? ((people[0].name || '').split(/\s+/)[0] || 'Someone') : null;
  const kind = linked ? 'Linked cluster' : 'Cluster';
  return (
    <div {...divProps} role="row"
         draggable={rename ? undefined : divProps.draggable}
         className={`ct-row ct-folder-row${selected ? ' is-selected' : ''}${dropTarget ? ' is-drop-target' : ''}${springing ? ' is-springing' : ''}${zebra ? ' is-zebra' : ''}${className ? ` ${className}` : ''}`}
         title={label}>
      <div role="cell" className="ct-cell ct-c-name">
        {checks && <span className="row-check" aria-hidden="true"><Icon as={Check} size={11} weight="bold" /></span>}
        <div className="ct-thumb ct-folder-glyph"><Icon as={FolderSimple} size={14} weight="regular" /></div>
        <div className="ct-name-wrap">
          {rename
            ? <InlineRename value={label} onCommit={rename.onCommit} onCancel={rename.onCancel} label="Cluster name" className="ct-row-rename" />
            : <div className="ct-name">{label}</div>}
        </div>
        {linked && <span className="ct-folder-link" role="img" aria-label="Linked cluster" title="Linked cluster"><Icon as={LinkSimple} size={12} weight="regular" /></span>}
      </div>
      {audioMode ? (
        <>
          <div role="cell" className="ct-cell ct-c-dur" />
          <div role="cell" className="ct-cell ct-c-bpm" />
          <div role="cell" className="ct-cell ct-c-key" />
          <div role="cell" className="ct-cell ct-c-fmt">{kind}</div>
        </>
      ) : (
        <>
          <div role="cell" className="ct-cell ct-c-type">{kind}</div>
          <div role="cell" className="ct-cell ct-c-size">{missing ? 'Not available' : countLabel(board?.card_count)}</div>
        </>
      )}
      <div role="cell" className="ct-cell ct-c-date">{when ? relativeTimeShort(when) : ''}</div>
      <div role="cell" className="ct-cell ct-c-presence">
        {first && (
          <>
            <Avatar name={people[0].name} color={people[0].color} size={18} ring />
            <span className="ct-status">{first} is in it</span>
          </>
        )}
      </div>
    </div>
  );
});
```

`ListSurface`:
- Folder rows for List, from `shownFolders` (Task 7):
  - sub-clusters use `FolderRow` with the props `renderSubFolder` gives `FolderTile`;
  - linked ones those of `renderLinkedFolder`;
  - plus `audioMode`, `dateKey={sortKey === 'created' ? 'created' : 'updated'}`, and `zebra={i % 2 === 1}` by index.
- The sb table branch: `<ClusterTable {...tableProps} items={displayItems} variant="classic" leadRows={folderRows} />`.
- In sb List with no files but folders, the table still renders with only its lead rows: change `visibleItems.length > 0 &&` to `(visibleItems.length > 0 || (viewMode === 'table' && shownFolders.length > 0)) &&`.

Append to `filesPage.css`:

```css
/* ── List: the classic table (C's) ───────────────────────────────────────── */
/* One flat list, folders first, dense, every head sortable, a faint zebra. */
.list-wrap[data-look='sb'] .ct-table.is-classic .ct-head,
.list-wrap[data-look='sb'] .ct-table.is-classic .ct-row {
  grid-template-columns: minmax(0, 1fr) 120px 96px 104px 190px; column-gap: 12px;
}
.list-wrap[data-look='sb'] .ct-table.is-classic[data-cols='audio'] .ct-head,
.list-wrap[data-look='sb'] .ct-table.is-classic[data-cols='audio'] .ct-row {
  grid-template-columns: minmax(0, 1fr) 64px 56px 72px 72px 104px 190px;
}
.list-wrap[data-look='sb'] .ct-table.is-classic .ct-head {
  position: sticky; top: var(--lp-head-h, 98px); z-index: 3;
  height: 30px; box-sizing: border-box; margin: 0 -16px; padding: 0 24px;
  background: var(--bg-1); border-bottom: 1px solid var(--line-1);
}
.list-wrap[data-look='sb'] .ct-table.is-classic .ct-th {
  padding: 0; color: var(--sbf-quiet);
  font: 600 10.5px/1 var(--font-sans); letter-spacing: .08em; text-transform: uppercase;
}
.list-wrap[data-look='sb'] .ct-table.is-classic .ct-th:hover,
.list-wrap[data-look='sb'] .ct-table.is-classic .ct-th.is-sorted { color: var(--ink-1); }
.list-wrap[data-look='sb'] .ct-table.is-classic .ct-lead,
.list-wrap[data-look='sb'] .ct-table.is-classic .ct-body { padding-top: 0; }
.list-wrap[data-look='sb'] .ct-table.is-classic .ct-lead { margin-top: 4px; }
.list-wrap[data-look='sb'] .ct-table.is-classic .ct-row {
  height: 32px; padding: 0 8px; border: 0; border-radius: 6px; contain-intrinsic-size: auto 32px;
}
.list-wrap[data-look='sb'] .ct-table.is-classic .ct-row.is-zebra { background: color-mix(in srgb, var(--ink-0) 2.2%, transparent); }
.list-wrap[data-look='sb'] .ct-table.is-classic .ct-thumb { width: 22px; height: 22px; border-radius: 4px; }
.ct-folder-glyph { display: grid; place-items: center; background: color-mix(in srgb, var(--ink-0) 6%, transparent); color: var(--ink-1); }
.ct-folder-link { flex: none; display: grid; place-items: center; color: var(--ink-2); }
/* Narrower, the table gives up its columns from the right. */
@container cbmain (max-width: 760px) {
  .list-wrap[data-look='sb'] .ct-table.is-classic .ct-head,
  .list-wrap[data-look='sb'] .ct-table.is-classic .ct-row,
  .list-wrap[data-look='sb'] .ct-table.is-bare .ct-row { grid-template-columns: minmax(0, 1fr) 110px 84px 96px 0; }
  .list-wrap[data-look='sb'] .ct-c-presence { visibility: hidden; }
}
@container cbmain (max-width: 520px) {
  .list-wrap[data-look='sb'] .ct-table.is-classic .ct-head,
  .list-wrap[data-look='sb'] .ct-table.is-classic .ct-row,
  .list-wrap[data-look='sb'] .ct-table.is-bare .ct-row { grid-template-columns: minmax(0, 1fr) 0 72px 84px 0; }
  .list-wrap[data-look='sb'] .ct-c-type { visibility: hidden; }
}
```

(The existing ladder at the end of the `.ct-*` section of styles.css hides columns with `display: none` at its own widths. Check that the two don't fight: open the harness at 900px and 600px wide in List and in Grid's rows. If they do, give the A ladder the same selectors with `display` restored.)

- [ ] **Step 4: Run** `npm test`, then (verifier) the A spec and the old page spec. Screenshot against `A-list.jpg` and `A-list-select.jpg`.

- [ ] **Step 5: Commit and push**

---

### Task 9: Tiles — the picture is the name

**Files:**
- Modify: `boards/src/components/clusterBrowser/ClusterTile.jsx` (draw `captionless`; Task 7 only put the class on)
- Modify: `boards/src/components/clusterBrowser/filesPage.css` (append)
- Modify: `boards/tests/sidebar-files-page-a.spec.js` (append)

**Interfaces:**
- Consumes: `captionless` from JustifiedGallery (Task 7). `formatDuration` comes from `lib/loopMeta.js`, the one ClusterRow uses. `Play` comes from `lib/icons.js`.
- Produces: in captionless mode, `.ct-tile.is-captionless` (plus `is-renaming`), `.ct-tile-off > i`, `.ct-tile-dur` and `.ct-tile-pend`.

- [ ] **Step 1: Write the failing spec tests (append)**

```js
test.describe('Grid: the tiles', () => {
  test('marks on the picture: not on board, a video length, an upload, a peer', async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-item-id="film-wait-0"] .ct-tile-off')).toHaveAttribute('aria-label', 'Not on board');
    await expect(page.locator('[data-item-id="film-img-3"] .ct-tile-off')).toHaveCount(0);
    await expect(page.locator('[data-item-id="film-vid-0"] .ct-tile-dur')).toHaveText('0:42');
    await expect(page.locator('[data-item-id="film-up-0"] .ct-tile-pend')).toHaveText('Uploading…');
    await expect(page.locator('[data-item-id="film-img-2"]')).toHaveClass(/is-peer/);
    await expect(page.locator('[data-item-id="film-img-3"]')).toHaveAttribute('title', /film-still-003/);
  });

  test('a selected tile: a gold ring outside the picture and a white check', async ({ page }) => {
    await open(page);
    const tile = page.locator('[data-item-id="film-img-3"]');
    await tile.click();
    await expect(tile).toHaveClass(/is-selected/);
    const ring = await tile.locator('.ct-tile-preview').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(ring).toBe('solid');
    const check = await tile.locator('.ct-tile-check').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(check).toBe('rgb(255, 255, 255)');
  });

  test('F2 renames in place over the picture', async ({ page }) => {
    await open(page);
    await page.locator('[data-item-id="film-img-3"]').click();
    await page.keyboard.press('F2');
    const tile = page.locator('[data-item-id="film-img-3"]');
    await expect(tile).toHaveClass(/is-renaming/);
    await expect(tile.locator('.ct-tile-rename')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tile).not.toHaveClass(/is-renaming/);
  });
});
```

(The video's fixture length is 42s, so it reads `0:42`. Use whatever `formatDuration(42)` from `lib/loopMeta.js` returns if it formats differently. The spec pins the helper's output, not a new format.)

- [ ] **Step 2: Run to verify they fail** (verifier, `-g "Grid: the tiles"`)

- [ ] **Step 3: Implement**

In `ClusterTile.jsx`:
- Imports: add `Play` to the icons import, and `import { formatDuration } from '../../lib/loopMeta.js';`.
- Add the prop `captionless = false,   // direction A's grid: no caption, the picture is the name (filesLook.js)`.
- Rewrite the flag comment to read:

```js
  // Where the file stands with the board. Under a caption, a mark by the name
  // — never on the picture: once most tiles carry it, anything on the art
  // repeats across the whole grid. Dashed: in the cluster, not on its board.
  // Solid: a copy is on this board (seen while browsing another cluster).
  // Without a caption (direction A) there is no name to sit by, so "not on
  // board" is a small ring in the picture's corner, the sidebar's mark; the
  // "a copy is on board" dot is left to Info there.
```

Then:

```js
  const off = captionless && markUnplaced && item.unplaced;
  const dur = captionless && item.kind === 'video' && Number.isFinite(item.durationSec) && item.durationSec > 0
    ? formatDuration(item.durationSec) : null;
```

- Class: append `${captionless ? ' is-captionless' : ''}${captionless && rename ? ' is-renaming' : ''}`.
- Root: add `title={captionless && !rename ? item.name : undefined}`.
- Inside `.ct-tile-preview`, after the spinner:

```jsx
        {captionless && item.pending && <span className="ct-tile-pend">Uploading…</span>}
        {off && <span className="ct-tile-off" role="img" aria-label="Not on board" title="Not on board — in this cluster, not placed on its board"><i /></span>}
        {dur && <span className="ct-tile-dur"><Icon as={Play} size={9} weight="fill" />{dur}</span>}
```

- The meta: `{(!captionless || rename) && (<div className="ct-tile-meta">…today's…</div>)}`.
- In captionless mode the flag isn't drawn: `{flag && !rename && !captionless && …}`.

Append to `filesPage.css`:

```css
/* ── Tiles: the picture is the name ──────────────────────────────────────── */
.list-wrap[data-look='sb'] .ct-jg .ct-tile-preview { border-radius: 6px; }
.list-wrap[data-look='sb'] .ct-jg .ct-tile-preview::before { box-shadow: inset 0 0 0 1px var(--sbf-thumb-line); }
/* Selected: a gold ring just outside the picture, and the check turns white. */
.list-wrap[data-look='sb'] .ct-jg .ct-tile.is-selected .ct-tile-preview {
  outline: 1.5px solid color-mix(in srgb, var(--soleil) 80%, transparent); outline-offset: 2px;
}
.list-wrap[data-look='sb'] .ct-tile.is-selected .ct-tile-check {
  background: #fff; border-color: #fff; color: #0a0a0c; box-shadow: 0 1px 3px rgba(0, 0, 0, .35);
}
.list-wrap[data-look='sb'] .ct-tile-check { width: 22px; height: 22px; }
/* Not on board: the sidebar's hollow ring, on a dark disc so it reads on any picture. */
.ct-tile-off {
  position: absolute; top: 7px; right: 7px; z-index: 2;
  width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(10, 10, 12, .55);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  pointer-events: none;
}
.ct-tile-off > i {
  display: block; width: 8px; height: 8px; box-sizing: border-box; border-radius: 50%;
  border: 1.5px solid rgba(245, 245, 247, .92);
}
/* The download button sits where the ring is; with the ring, it steps left. */
.list-wrap[data-look='sb'] .ct-tile-preview:has(.ct-tile-off) .ct-tile-dl { right: 33px; }
/* A video's length, bottom left, as Photos shows it. */
.ct-tile-dur {
  position: absolute; left: 7px; bottom: 7px; z-index: 2;
  display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px 0 6px;
  border-radius: 6px; background: rgba(10, 10, 12, .62); color: #f5f5f7;
  font: 600 11px/1 var(--font-sans); font-variant-numeric: tabular-nums; pointer-events: none;
}
/* An upload on its way: the word on the paper, under the spinner. */
.ct-tile-pend {
  position: absolute; left: 0; right: 0; top: calc(50% + 18px);
  color: var(--ink-2); font: 400 12px/1 var(--font-sans); text-align: center; pointer-events: none;
}
.list-wrap[data-look='sb'] .ct-jg .ct-tile.is-pending .ct-tile-preview::after { display: none; }
/* Who has it selected: their colour round the picture, their face in the corner. */
.list-wrap[data-look='sb'] .ct-jg .ct-tile.is-peer .ct-tile-preview { outline: 2px solid var(--peer-color); outline-offset: 2px; }
.list-wrap[data-look='sb'] .ct-tile-peers { right: 7px; bottom: 7px; }
/* Renaming without a caption: the field lies over the foot of the picture. */
.list-wrap[data-look='sb'] .ct-tile.is-renaming .ct-tile-meta {
  position: absolute; left: 6px; right: 6px; bottom: 6px; z-index: 3;
  padding: 4px 6px; border-radius: 7px; background: var(--bg-1); box-shadow: var(--sbf-chip-shadow);
}
```

(Before writing these, read JustifiedGallery and check that it positions each tile itself, with `position: absolute` in the tile's style or `.ct-jg .ct-tile`. The rename overlay needs the tile to be its containing block. If it isn't, add `position: relative` to `.list-wrap[data-look='sb'] .ct-tile.is-captionless`.)

- [ ] **Step 4: Run** `npm test`. Then (verifier) the A spec, the old page spec, and `tests/files-visual-sweep.spec.js` under `?local=1`: production tiles must be unchanged. Screenshot the grid against `A-grid.jpg` and `A-info.jpg` (the selected tile, the peer tile, the not-on-board rings).

- [ ] **Step 5: Commit and push**

---

### Task 10: Info as a card beside the sheet; empty, no-match, loading; In sub-clusters

**Files:**
- Modify: `boards/src/components/ListSurface.jsx`:
  - `has-info` on `.list-wrap` in sb;
  - in sb, the old "Empty cluster" block is not rendered;
  - the sb branch's states and its "In sub-clusters" shelf.
- Modify: `boards/src/components/clusterBrowser/filesPage.css` (append)
- Modify: `boards/tests/sidebar-files-page-a.spec.js` (append)

**Interfaces:**
- Consumes:
  - `FilesShelfHead` (Task 7) and `detailJsx` (Task 7)
  - the sheet's top margin as measured in Task 5, which Task 5 sets as `--fp-top` on `.list-wrap[data-look='sb']`: `2px`, or `calc(var(--chrome-band) + 2px)`
- Produces: `.fp-empty`, `.fp-nomatch`, `.fp-loading`, `.fp-desc`. In sb, `.list-wrap.has-info`.

- [ ] **Step 1: Write the failing spec tests (append)**

```js
test.describe('Info and the states', () => {
  test('Info is a card beside the sheet, which makes room for it', async ({ page }) => {
    await open(page);
    const sheet = page.locator('.list-wrap');
    const before = await sheet.boundingBox();
    await page.locator('[data-item-id="film-img-4"]').click();
    await page.keyboard.press('Control+i');
    const card = page.locator('.list-wrap .cb-detail');
    await expect(card).toBeVisible();
    await expect(card.locator('.cbd-title')).toContainText('film-still-004');
    const after = await sheet.boundingBox();
    const box = await card.boundingBox();
    const vw = page.viewportSize().width;
    expect(Math.round(vw - (box.x + box.width))).toBe(8);
    expect(Math.round(box.width)).toBe(340);
    expect(Math.round(box.x - (after.x + after.width))).toBe(8);
    expect(Math.round(box.y)).toBe(Math.round(after.y));
    expect(after.width).toBeLessThan(before.width);
    await page.locator('.list-wrap').evaluate((el) => el.scrollBy(0, 600));
    const moved = await card.boundingBox();
    expect(Math.round(moved.y)).toBe(Math.round(box.y));
  });

  test('a cluster with no files: its clusters, then what to do', async ({ page }) => {
    await open(page, '&empty=1');
    await expect(page.locator('.fp-tools')).toHaveCount(0);
    await expect(page.locator('.fp-empty-title')).toHaveText('No files in Feature film');
    await expect(page.locator('.fp-empty .fp-add')).toContainText('Add files');
    await expect(page.locator('.fp-cls .ft')).toHaveCount(3);
  });

  test('a search with no hits says so and clears', async ({ page }) => {
    await open(page);
    await page.locator('.fp-search input').fill('zzzz-nothing');
    await expect(page.locator('.fp-nomatch')).toContainText('No files match.');
    await page.locator('.fp-nomatch').getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('.fp-search input')).toHaveValue('');
    await expect(page.locator('[data-item-id="film-img-3"]')).toHaveCount(1);
  });
});
```

(`open(page, extra)` appends `extra` to the harness URL. Task 3's `open()` takes the optional second argument. If it doesn't, add it there: `async function open(page, extra = '')`. With `&empty=1` the harness empties the open cluster, as Task 0 built it. If the empty fixture also drops the folders, change the `.fp-cls .ft` count to what the fixture keeps.)

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

`ListSurface`:
- The `.list-wrap` className gains `${sb && detailTarget && !phoneShell ? ' has-info' : ''}`.
- The old block becomes `{!isPanel && !sb && clusterEmpty && (…today's "Empty cluster"…)}`.
- In the sb branch, replace the `{/* Task 10 … */}` marker with:

```jsx
{visibleItems.length === 0 && (loading ? (
  <div className="fp-loading" role="status">Loading files…</div>
) : query || filters.size || unplacedOnly ? (
  descHits.length === 0 && shownFolders.length === 0 ? (
    <div className="fp-nomatch">
      <span>No files match.</span>
      <button type="button" className="fp-word" onClick={() => { setQuery(''); onClearFilters(); }}>Clear filters</button>
    </div>
  ) : null
) : (
  <div className={`fp-empty${canEdit ? '' : ' is-readonly'}`}>
    <span className="fp-empty-ico" aria-hidden="true"><Icon as={UploadSimple} size={20} weight="regular" /></span>
    <div className="fp-empty-title">No files in {board?.name || 'this cluster'}</div>
    <div className="fp-empty-sub">
      {canEdit ? 'Drop files here or add them. They wait in Files until you put them on the board.'
        : browsingFrom ? `Open ${board?.name || 'it'} to add files.` : 'Nothing here yet.'}
    </div>
    {canEdit ? (
      <div className="fp-empty-acts">
        <button type="button" className="sbf-upload fp-add" onClick={openAddPicker}>
          <Icon as={Plus} size={14} weight="regular" /><span className="fp-add-label">Add files</span>
        </button>
        {!shownFolders.length && mutators.addNewBoard && (
          <button type="button" className="fp-word" onClick={() => mutators.addNewBoard(null, { via: 'files_empty' })}>New cluster</button>
        )}
        {!shownFolders.length && onOpenPicker && (
          <button type="button" className="fp-word" onClick={onOpenPicker}>Link a cluster</button>
        )}
      </div>
    ) : browsingFrom && dockControls?.onExpand ? (
      <button type="button" className="fp-word" onClick={dockControls.onExpand}>Open {board?.name || 'cluster'}</button>
    ) : null}
  </div>
))}
{descHits.length > 0 && (
  <>
    <FilesShelfHead id="desc" label="In sub-clusters" count={descHits.length} />
    <div className="fp-desc">
      {descHits.map((h) => (
        <button key={`${h.boardId}:${h.id}`} type="button" className="fp-desc-row" onClick={() => onOpenBoard(h.boardId)}>
          <span className="fp-desc-name">{h.name}</span>
          <span className="fp-desc-where">{h.clusterName}</span>
        </button>
      ))}
    </div>
  </>
)}
```

- Import `FilesShelfHead` with `FilesShelves`.
- Task 7 already guards the empty-with-folders gallery case.
- In List with no files, the classic table shows only its folder rows, so `fp-empty` follows it. That is the same order as Grid: clusters, then what to do.

Append to `filesPage.css`:

```css
/* ── Info: a card beside the sheet ───────────────────────────────────────── */
/* Fixed to the Files area (.fdl-files is a size container, so it holds fixed
   boxes and the sheet's overflow doesn't clip them): it stays put while the
   sheet scrolls, the ground shows round it, and the sheet makes room. */
.list-wrap[data-look='sb'].has-info { margin-right: 356px; }
.list-wrap[data-look='sb'] .cb-detail.surface-frosted {
  position: fixed; top: var(--fp-top, 2px); right: 8px; bottom: auto; left: auto; z-index: 5;
  width: 340px; min-width: 0; max-height: calc(100% - var(--fp-top, 2px) - 8px);
  border: 0; border-radius: 12px;
  background: var(--sbf-glass);
  -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2);
  box-shadow: var(--sbf-glass-shadow);
  outline: 1px solid var(--sbf-glass-line); outline-offset: -1px;
}
.list-wrap[data-look='sb'] .cbd-head { padding: 14px 10px 10px 16px; border-bottom: 0; }
.list-wrap[data-look='sb'] .cbd-title { font: 600 14px/1.3 var(--font-sans); }
.list-wrap[data-look='sb'] .cbd-sub { font: 400 12px/1.3 var(--font-sans); color: var(--ink-2); }
.list-wrap[data-look='sb'] .cbd-body { padding: 2px 16px 14px; }
.list-wrap[data-look='sb'] .cbd-preview { border: 0; border-radius: 8px; background: var(--sbf-track); }
.list-wrap[data-look='sb'] .cbd-section-label,
.list-wrap[data-look='sb'] .cbd-members-label {
  color: var(--sbf-quiet); font: 600 10.5px/1 var(--font-sans); letter-spacing: .08em; text-transform: uppercase;
}
.list-wrap[data-look='sb'] .cbd-section + .cbd-section { border-top-color: var(--sbf-glass-line); }
.list-wrap[data-look='sb'] .cbd-actions { padding: 10px 12px; border-top: 1px solid var(--sbf-glass-line); }
.list-wrap[data-look='sb'] .cbd-act.is-primary { background: var(--sbf-chip); box-shadow: var(--sbf-chip-shadow); border-color: transparent; color: var(--ink-0); }
.list-wrap[data-look='sb'] .cbd-act-danger { color: #ff8a80; }
[data-theme='light'] .list-wrap[data-look='sb'] .cbd-act-danger { color: #c62828; }

/* ── No files, no hits, still loading ────────────────────────────────────── */
.fp-empty { display: flex; flex-direction: column; align-items: center; padding: 72px 16px; text-align: center; }
.fp-empty-ico {
  display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 14px;
  border-radius: 12px; background: var(--sbf-count); color: var(--ink-1);
}
.fp-empty-title { color: var(--ink-0); font: 600 15px/1.3 var(--font-sans); }
.fp-empty-sub { max-width: 38ch; margin: 6px 0 18px; color: var(--ink-2); font: 400 13px/1.5 var(--font-sans); }
.fp-empty-acts { display: flex; align-items: center; gap: 8px; }
.fp-empty .fp-add { margin: 0; }
.fp-nomatch { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 56px 16px; color: var(--ink-2); font: 400 13px/1 var(--font-sans); }
.fp-loading { padding: 56px 16px; text-align: center; color: var(--ink-2); font: 400 13px/1 var(--font-sans); }
/* Hits in clusters below this one: open them, don't select them. */
.fp-desc { display: flex; flex-direction: column; margin-bottom: 6px; }
.fp-desc-row {
  display: flex; align-items: center; gap: 12px; height: 36px; padding: 0 8px 0 4px;
  border: 0; border-radius: 6px; background: transparent; cursor: pointer; text-align: left;
}
.fp-desc-row:hover { background: var(--bg-hov); }
.fp-desc-row:focus-visible { outline: 2px solid var(--soleil); outline-offset: -2px; }
.fp-desc-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-1); font: 500 13px/1 var(--font-sans); }
.fp-desc-where { flex: none; color: var(--ink-2); font: 400 12px/1 var(--font-sans); }
```

Task 5 adds `--fp-top: 2px;` to the sheet rule, or the measured `calc(var(--chrome-band) + 2px)`, and uses `margin: var(--fp-top) 8px 8px`. If Task 5 shipped a literal, change it there in this task.

- [ ] **Step 4: Run** `npm test`. Then (verifier) the A spec, the old page spec, and `tests/info.spec.js` under `?local=1`. Screenshot against `A-info.jpg` and `A-empty.jpg`.

- [ ] **Step 5: Commit and push**

---

### Task 11: Quick look — the stage stays dark, its bar becomes two islands

**Files:**
- Modify: `boards/src/components/clusterBrowser/QuickLook.jsx` (in sb, the actions and ✕ go in a `.ql-acts` island; production's DOM is unchanged)
- Modify: `boards/src/components/clusterBrowser/filesPage.css` (append)
- Modify: `boards/tests/sidebar-files-page-a.spec.js` (append)

**Interfaces:**
- Consumes: `sb` in QuickLook (Task 1: `const look = useFilesLook(); const sb = look === 'sb';`).
- Produces: `.ql[data-look='sb'] .ql-acts`, `.ql-acts-sep`.

- [ ] **Step 1: Write the failing spec tests (append)**

```js
test.describe('Quick look', () => {
  test('Space opens it over a blurred page; the title and the actions are islands', async ({ page }) => {
    await open(page);
    await page.locator('[data-item-id="film-img-5"]').click();
    await page.keyboard.press('Space');
    const ql = page.locator('.ql[data-look="sb"]');
    await expect(ql).toBeVisible();
    await expect(ql.locator('.ql-title .ql-name')).toContainText('film-still-005');
    const acts = ql.locator('.ql-acts');
    await expect(acts.locator('.ql-btn')).toContainText(['Show on board', 'Download', 'Info']);
    await expect(acts.locator('.ql-x')).toBeVisible();
    const blur = await ql.evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(blur).toContain('blur');
    await page.keyboard.press('ArrowRight');
    await expect(ql.locator('.ql-name')).not.toContainText('film-still-005');
    await page.keyboard.press('Escape');
    await expect(ql).toHaveCount(0);
  });
});
```

(Which file follows film-still-005 depends on the shelf order from Task 7's `navItems`. The test only checks that the name changed.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

`QuickLook.jsx`: pull the action buttons, from `onShowOnBoard` through the Info toggle, into `const acts = (<>…</>)` and the ✕ into `const close = (…)`, unchanged. Then:

```jsx
      <div className="ql-bar">
        <div className="ql-title">…unchanged…</div>
        {sb ? (
          <div className="ql-acts">{acts}<span className="ql-acts-sep" aria-hidden="true" />{close}</div>
        ) : (<>{acts}{close}</>)}
      </div>
```

Before writing the CSS, read `.ql-btn` and `.ql-nav` in styles.css (~24037–24058) and `FileShareButton variant="ql"` (it must render a `.ql-btn` to sit in the island). Also check whether `body` carries `data-sb-files` with the look on. The island colours below don't depend on it: they are declared inside `.ql`, whose own dark tokens hold in both themes.

Append to `filesPage.css`:

```css
/* ── Quick look (direction A) ────────────────────────────────────────────── */
/* Still a dark room in both themes (its own tokens, styles.css), now over
   the page, blurred, rather than a black slab; the bar's two halves float as
   islands, the chrome's material, with words and regular icons. */
.ql[data-look='sb'] {
  background: color-mix(in srgb, #08080a 82%, transparent);
  -webkit-backdrop-filter: blur(24px) saturate(1.1); backdrop-filter: blur(24px) saturate(1.1);
}
.ql[data-look='sb'] .ql-bar {
  position: absolute; top: 8px; left: 8px; right: 8px; z-index: 3;
  height: 36px; padding: 0; gap: 8px; justify-content: space-between;
  pointer-events: none;
}
.ql[data-look='sb'] .ql-title,
.ql[data-look='sb'] .ql-acts {
  pointer-events: auto; box-sizing: border-box; height: 36px;
  display: flex; align-items: center;
  border: 1px solid var(--line-1); border-radius: 10px;
  background: color-mix(in oklab, var(--bg-1) 86%, transparent);
  -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35);
}
.ql[data-look='sb'] .ql-title { flex: 0 1 auto; min-width: 0; max-width: 46%; flex-direction: row; align-items: center; gap: 10px; padding: 0 12px; }
.ql[data-look='sb'] .ql-name { font: 600 13px/1 var(--font-sans); }
.ql[data-look='sb'] .ql-meta { flex: none; color: var(--ink-2); font: 400 12px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
.ql[data-look='sb'] .ql-acts { flex: none; gap: 2px; padding: 0 3px; }
.ql[data-look='sb'] .ql-btn {
  height: 28px; padding: 0 9px; gap: 6px; border: 0; border-radius: 7px; background: transparent;
  color: var(--ink-1); font: 500 13px/1 var(--font-sans);
}
.ql[data-look='sb'] .ql-btn svg { color: var(--ink-2); }
.ql[data-look='sb'] .ql-btn:hover { background: rgba(255, 255, 255, .08); color: var(--ink-0); }
.ql[data-look='sb'] .ql-btn:hover svg { color: var(--ink-1); }
.ql[data-look='sb'] .ql-btn.is-on { background: var(--bg-4); color: var(--ink-0); }
.ql[data-look='sb'] .ql-acts-sep { flex: none; width: 1px; height: 18px; margin: 0 4px; background: var(--line-2); }
.ql[data-look='sb'] .ql-x { width: 28px; padding: 0; justify-content: center; }
/* The stage under the islands; the arrows are glass circles at its edges. */
.ql[data-look='sb'] .ql-body { padding: 56px 12px 12px; }
.ql[data-look='sb'] .ql-nav {
  align-self: center; flex: none; width: 40px; height: 40px; padding: 0; border-radius: 50%;
  border: 1px solid var(--line-1); background: color-mix(in oklab, var(--bg-1) 86%, transparent);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); color: var(--ink-1);
}
.ql[data-look='sb'] .ql-nav:hover { background: var(--bg-4); color: var(--ink-0); }
.ql[data-look='sb'] .lightbox-stage img,
.ql[data-look='sb'] .ql-video { border-radius: 8px; }
/* Info inside Quick look: the card beside the stage, in the islands' glass. */
.ql[data-look='sb'] .cb-detail.is-inline {
  align-self: flex-start; max-height: 100%; border: 1px solid var(--line-1); border-radius: 12px;
  background: color-mix(in oklab, var(--bg-1) 86%, transparent);
  -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2);
}
@media (max-width: 720px) {
  .ql[data-look='sb'] .ql-btn { width: 32px; padding: 0; justify-content: center; }
  .ql[data-look='sb'] .ql-title { max-width: 40%; }
  .ql[data-look='sb'] .ql-meta { display: none; }
  .ql[data-look='sb'] .ql-nav { position: absolute; top: 50%; transform: translateY(-50%); }
}
@media (pointer: coarse) {
  .ql[data-look='sb'] .ql-bar, .ql[data-look='sb'] .ql-title, .ql[data-look='sb'] .ql-acts { height: 48px; }
  .ql[data-look='sb'] .ql-btn { height: 44px; min-width: 44px; }
  .ql[data-look='sb'] .ql-nav { width: 44px; height: 44px; }
  .ql[data-look='sb'] .ql-body { padding-top: 68px; }
}
```

- [ ] **Step 4: Run** `npm test` (fileShareWiring pins Quick look's share line, which must stay intact). Then (verifier) the A spec, `tests/quicklook-escape.spec.js` and `tests/files-panel.spec.js` under `?local=1`. Screenshot against `A-ql.jpg`. Also screenshot Quick look in light theme (`&theme=light`, or set it in the harness): it must still be the dark room.

- [ ] **Step 5: Commit and push**

---

### Task 12: Phones and touch

**Files:**
- Modify: `boards/src/components/clusterBrowser/filesPage.css` (append)
- Modify: `boards/src/components/ListSurface.jsx` (on phones, a Layout row in the page menu)
- Modify: `boards/tests/touch/touch-targets.spec.js` (a PAGES entry)
- Modify: `boards/tests/sidebar-files-page-a.spec.js` (append, phone project)

**Interfaces:**
- Consumes: `phoneShell` (Task 6) and the `pageMenu.extra` slot (Task 6).

The phone still (`A-phone.jpg`) has:
- **Title line:** the title ⌄ at 18px, with ⤡ as an icon at the right. No meta, no Download.
- **Tools line:** search (flexible) and "All files ⌄" only. Grid | List moves into the menu as a Layout row. Who's here and the count are hidden.
- **Add files:** the chip is kept only if the bottom bar's + doesn't add files on the Files page. Check this: open the phone harness and press the bottom bar's + on `surface=files`, or read what `MobileNav`'s + does in App. If + opens the add-files picker for this cluster, hide `.fp-add` on phones. If it doesn't, keep the chip as an icon-only 36px square.

- [ ] **Step 1: Write the failing spec tests**

Append, run on `mobile-chrome` (check the project names in playwright.config):

```js
test.describe('a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone only');
  test('the sheet is the screen; the title, search and All files; Grid | List in the menu', async ({ page }) => {
    await open(page);
    const sheet = await page.locator('.list-wrap').boundingBox();
    expect(Math.round(sheet.x)).toBe(0);
    expect(Math.round(sheet.width)).toBe(page.viewportSize().width);
    await expect(page.locator('.fp-title-btn')).toBeVisible();
    await expect(page.locator('.fp-meta')).toHaveCount(0);
    await expect(page.locator('.fp-seg')).toBeHidden();
    await page.locator('.fp-tools .sbf-filter-btn').click();
    await page.getByRole('menuitemradio', { name: 'List' }).click();
    await expect(page.locator('.ct-table.is-classic')).toBeVisible();
  });
});
```

touch-targets.spec, in `PAGES`:
`{ name: 'files page', url: '/?sidebarqa=1&surface=files&drawer=0', ready: '[data-sidebarqa-ready]' }`
Match the entries' real shape. Read the file first; if PAGES entries have other fields, mirror them.

- [ ] **Step 2: Run to verify they fail** (verifier, `--project=mobile-chrome -g "a phone"`, and touch-targets on the five touch projects).

- [ ] **Step 3: Implement**

ListSurface: in `pageMenu.extra`, on phones, a Layout row before the Size row. Markup:
`<div className="sbf-menu-row fp-size-row" role="group" aria-label="Layout"><span className="sbf-menu-row-label">Layout</span><div className="sbf-tabs">` holding two `menuitemradio` buttons, Grid and List, with `aria-checked={viewMode === id}` and `onClick={() => onViewMode(id)}`. Pass `viewMode={phoneShell ? null : viewMode}` to FilesPageTools, so the seg isn't rendered when null: guard `{viewMode && (<div className="sbf-tabs fp-seg" …>)}` in FilesPageTools.

Append to `filesPage.css`:

```css
/* ── A phone: the sheet is the screen ────────────────────────────────────── */
.app.sb-files:not(.is-floating-chrome) .list-wrap[data-look='sb'] .fp-head { margin: 0 -12px; }
.app.sb-files:not(.is-floating-chrome) .fp-titlebar { height: 52px; padding: 12px 4px 0 8px; }
.app.sb-files:not(.is-floating-chrome) .fp-title-btn { height: 36px; font-size: 18px; }
.app.sb-files:not(.is-floating-chrome) .fp-shrink { width: 40px; height: 40px; padding: 0; justify-content: center; }
.app.sb-files:not(.is-floating-chrome) .fp-shrink .fp-word-label { display: none; }
.app.sb-files:not(.is-floating-chrome) .fp-tools { height: 56px; padding: 8px 8px 10px; }
.app.sb-files:not(.is-floating-chrome) .fp-search { flex: 1 1 auto; min-width: 0; height: 36px; }
.app.sb-files:not(.is-floating-chrome) .fp-found,
.app.sb-files:not(.is-floating-chrome) .fp-tools > .fp-spacer { display: none; }
.app.sb-files:not(.is-floating-chrome) .fp-add { width: 36px; height: 36px; padding: 0; justify-content: center; }
.app.sb-files:not(.is-floating-chrome) .fp-tools .fp-add-label { display: none; }
.app.sb-files:not(.is-floating-chrome) .fp-head > .list-selbar { margin: 2px 8px 8px; overflow-x: auto; scrollbar-width: none; }
.app.sb-files:not(.is-floating-chrome) .fp-head .list-selbar-hint { display: none; }
.app.sb-files:not(.is-floating-chrome) .fp-cls { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin: 0 -12px 6px; padding: 0 12px; }
.app.sb-files:not(.is-floating-chrome) .fp-cls .ft { flex: none; width: 220px; }
/* Info on a phone: a card over the foot of the sheet (above App's bottom bar,
   which sits outside .fdl-files), not beside it. */
.app.sb-files:not(.is-floating-chrome) .list-wrap[data-look='sb'] .cb-detail.surface-frosted {
  top: auto; left: 8px; right: 8px; bottom: 8px; width: auto; max-height: 70%;
}

/* ── Fingers: 40px and up ────────────────────────────────────────────────── */
@media (hover: none) and (pointer: coarse) {
  .list-wrap[data-look='sb'] .fp-word,
  .list-wrap[data-look='sb'] .fp-title-btn,
  .list-wrap[data-look='sb'] .fp-seg .sbf-tab,
  .list-wrap[data-look='sb'] .fp-add,
  .list-wrap[data-look='sb'] .fp-tools .sbf-filter-btn,
  .list-wrap[data-look='sb'] .fp-head .list-selbar-act,
  .list-wrap[data-look='sb'] .fp-desc-row { min-height: 40px; }
  .list-wrap[data-look='sb'] .fp-head .list-selbar-clear { width: 40px; }
  .list-wrap[data-look='sb'] .fp-head > .list-selbar { height: 48px; }
  .list-wrap[data-look='sb'] .fp-search { height: 40px; }
  .list-wrap[data-look='sb'] .fp-tools { height: 60px; }
  .list-wrap[data-look='sb'] .fp-shelf .sbf-shelf-toggle { min-height: 40px; align-items: center; padding-bottom: 0; }
  .list-wrap[data-look='sb'] .ct-table.is-classic .ct-row,
  .list-wrap[data-look='sb'] .ct-table.is-bare .ct-row { height: 44px; contain-intrinsic-size: auto 44px; }
  .list-wrap[data-look='sb'] .ct-table.is-classic .ct-th { min-height: 40px; }
  .list-wrap[data-look='sb'] .ct-table.is-classic .ct-head { height: 40px; }
  .list-wrap[data-look='sb'] .ct-tile-check { width: 28px; height: 28px; }
}
```

(The size row's tabs in the menu are 24px. On coarse pointers the menu's own coarse rules in clusterSidebar.css grow menu rows; give `.fp-size-row .sbf-tab` `min-height: 40px` in the same block if touch-targets flags it.)

- [ ] **Step 4: Run** `npm test`. Then (verifier) the A spec on mobile-chrome, touch-targets on the five touch projects, and `tests/mobile/sidebar-files.spec.js`. Screenshot at 390×844 against `A-phone.jpg`.

- [ ] **Step 5: Commit and push**

---

### Task 13: Open on preview, verify everything, ship to preview, hand over

**Files:**
- Modify: `boards/src/lib/appHost.js` (`filesPageLookAllowed` opens on the preview host)
- Modify: `boards/src/lib/filesPageLook.test.mjs` (assert the preview line)
- Memory: `project_files_page_rework_2026_10_20.md`, `project_sidebar_files_2026_10_18.md`, `project_next_release_manifest_2026_10_20.md`

- [ ] **Step 1: Open the hold on preview**

In `filesPageLookAllowed()`, after the `sidebarFilesAllowed()` line, add the same preview-host check `sidebarFilesAllowed()` itself uses. Read it and reuse its helper (for example `if (onPreviewHost()) return true;`). Production stays closed: the body is not `return true;`. The test gains:

```js
test('the look opens on the preview host and nowhere else in a build', () => {
  const body = holdBody('filesPageLookAllowed');
  assert.match(body, /PreviewHost\(\)\) return true;/);
  assert.doesNotMatch(body.trim(), /^return true;$/);
});
```

Use the real helper's name in the regex; `holdBody` is the test's own reader from Task 1.

- [ ] **Step 2: Run everything**

- `cd boards && npm test`, then `npm run docs:check` (main session).
- Verifier, on desktop-chrome unless noted, on a free `PW_PORT`, one run at a time, with no edits while it runs:
  1. `tests/sidebar-files-page-a.spec.js` (desktop-chrome, then mobile-chrome)
  2. `tests/sidebar-files-page.spec.js` (production look via `&look=today`)
  3. the sidebar suites: `tests/sidebar-files.spec.js`, `tests/sidebar-home-messages.spec.js`, `tests/mobile/sidebar-files.spec.js`, `tests/tablet/sidebar-side.spec.js`
  4. the `?local=1` Files suites, proof that production is unchanged: `cluster-browser`, `list-view-layout`, `list-windowed`, `files-panel`, `files-dock`, `files-audit`, `files-visual-sweep`, `files-unplaced`, `info`, `quicklook-escape`, `board-drop-rules`, `media-info`, `audio-loops`, `versions`, `touch/files-touch`
  5. `tests/touch/touch-targets.spec.js` on the five touch projects
  6. `tests/whats-new.spec.js` and `tests/canvas-ground.spec.js`, because the fold and the ground share the sidebar
- Any failure comes back to the main session for diagnosis. Rerun a flake once and record it if it is in the known-flaky list. Otherwise fix it.

- [ ] **Step 3: Build check**

Run (verifier):
```sh
cd boards && test -f .env.local && npx vite build --outDir "$SCRATCH/dist-a" --emptyOutDir
ls -l "$SCRATCH/dist-a/assets" | grep -i appshell
grep -l "sidebarqa-ready\|SidebarQaHarness" -r "$SCRATCH/dist-a/assets"
grep -l "fp-titlebar" "$SCRATCH/dist-a/assets"/*.css
```
(`$SCRATCH` is the session scratchpad. Building there leaves the repo's `dist/` alone. `.env.local` must exist in `boards/`, or the signed-in app is dead-code-eliminated, as CLAUDE.md warns.)

Expected:
- the build succeeds;
- AppShell is about its usual size (~500KB);
- the harness grep finds nothing;
- `fp-titlebar` is in a CSS bundle.

- [ ] **Step 4: Side by side**

Screenshot the harness against each still at 1440×900, dark:
- `A-grid`, `A-rest`, `A-list`, `A-list-select`, `A-select`, `A-menu`, `A-find`, `A-info`, `A-empty`, `A-drop`, `A-ql`
- `A-light` (light theme)
- `A-phone` (390×844)

Fix every visible difference in spacing, weight and colour that the stills settle. Note any deliberate departure in the handover.

- [ ] **Step 5: Commit and push**

Commit only my own hunks, by pathspec. Use the merge-tree recipe if origin moved.

- [ ] **Step 6: Memory and handover**

- Update `project_files_page_rework_2026_10_20.md` with:
  - Phase 3 built behind `filesPageLook` (open on preview, closed in production);
  - what the owner should try;
  - the stills;
  - the spec names.
- Update `project_sidebar_files_2026_10_18.md`: the page has its own look hold, and the sidebar's card folds while it is open.
- Update the release manifest:
  - `filesPageLook` flips in a later promote, after the owner has seen A on preview;
  - the docs slice must add `content/docs/clusters/list-view.md` lines (the card folds while the page is open; Shrink and ⌘\ from the fold bar; the classic List; Info beside the page) when it flips.
- Message the release coordinator: A is on preview behind `filesPageLookAllowed()`, the commit range, and that nothing of it reaches Thursday's cut while the hold is closed in production.
- Tell the owner in one short message that A is ready to look at on preview, and what to try.
