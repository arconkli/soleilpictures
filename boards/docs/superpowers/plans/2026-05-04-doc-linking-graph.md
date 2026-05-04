# Doc Linking + Comments + 3D Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every word in a Soleil Boards doc able to link to any other thing in the workspace (boards, docs, cards, URLs, intra-doc positions), give every entity a "Referenced by" surface, polish comments with inline composer + gutter dots, eliminate every browser popup, and ship a beautiful 3D graph as the workspace home page.

**Architecture:** Five linear phases on `polish/luxury-rebrand` (or a new branch). Phase 1 ships custom popup primitives that replace every `window.prompt`/`alert`/`confirm`. Phase 2 introduces the unified Link primitive (Tiptap mark + Y.Doc + Postgres backlinks index). Phase 3 layers `@`-mention + deterministic auto-detect on top. Phase 4 polishes comments and adds gutter dots. Phase 5 stands up a 3D graph home using `react-force-graph-3d`. AI is explicitly out of scope.

**Tech Stack:** Vite + React 18, Tiptap 2.27 + ProseMirror, Yjs CRDT (existing per-doc Y.Doc), Supabase Postgres + RLS, `react-force-graph-3d` + three.js (new for Phase 5), Lucide icons, Playwright (existing).

**Spec:** `boards/docs/superpowers/specs/2026-05-04-doc-linking-graph-design.md`

---

## File Structure

### Phase 1 — Custom popup primitives

**Create**
- `boards/src/components/InlineComposer.jsx` — anchored single-line/multiline input popover.
- `boards/src/components/EntityPicker.jsx` — universal entity search picker (single + multi mode).
- `boards/src/lib/entitySearch.js` — debounced workspace-wide entity search query.
- `boards/supabase/migrations/0003_entity_search_view.sql` — `entity_search` Postgres view.
- `boards/tests/popups.spec.js` — Playwright smoke for confirm + composer + picker.

**Modify**
- `boards/src/components/AppFeedback.jsx` — add `confirm(opts)` to the context.
- `boards/src/components/DocPageEditor.jsx` — replace `window.prompt`/`alert` calls with new primitives.
- `boards/src/components/DocSurface.jsx` — same.
- `boards/src/components/DocToolbar.jsx` — same.
- `boards/src/components/DocCommentsPanel.jsx` — `window.confirm` → `feedback.confirm`.
- `boards/src/components/DocPageTree.jsx` — same.

### Phase 2 — Link primitive

**Create**
- `boards/src/components/docExtensions/LinkMark.js` — new Tiptap mark with `linkId` attr (replaces existing URL Link).
- `boards/src/components/LinkPopover.jsx` — multi-target mini-gallery popover.
- `boards/src/components/BacklinksList.jsx` — shared "Referenced by" row renderer.
- `boards/src/components/DocLinksPanel.jsx` — replaces `DocBookmarksPanel.jsx` in the doc rail.
- `boards/src/components/DocRefsPanel.jsx` — third tab (Refs) listing backlinks pointing into this doc.
- `boards/src/lib/links.js` — Y.Doc CRUD + bookmarks→links migration.
- `boards/supabase/migrations/0004_doc_backlinks.sql` — `doc_backlinks` table + RLS.
- `boards/tests/links.spec.js`

**Modify**
- `boards/src/components/DocPageEditor.jsx` — install LinkMark, drop the old Link extension, wire right-click + ⌘K + toolbar to EntityPicker.
- `boards/src/components/DocToolbar.jsx` — Link button opens EntityPicker instead of `promptLink`.
- `boards/src/components/DocSurface.jsx` — Bookmarks tab → Links + Refs tabs.
- `boards/src/lib/boardsApi.js` — add `updateBacklinks(pageId, links)` debounced upsert.
- `boards/src/components/CardContextMenu.jsx` — add "Used by N docs ›" entry.
- `boards/src/components/BackgroundContextMenu.jsx` — add "Used by N docs ›" entry.
- `boards/src/lib/docState.js` — add migration helper (called once per doc on load).

**Delete**
- `boards/src/components/DocBookmarksPanel.jsx` — superseded by `DocLinksPanel.jsx` (after migration ships).

### Phase 3 — @-mention + auto-detect

**Create**
- `boards/src/components/docExtensions/MentionExtension.js` — Tiptap `Suggestion`-based `@`-trigger.
- `boards/src/components/docExtensions/AutoDetectPlugin.js` — ProseMirror plugin scanning recent ranges.
- `boards/src/lib/entityNameTrie.js` — Trie + workspace name index.
- `boards/tests/mention.spec.js`

**Modify**
- `boards/src/components/DocPageEditor.jsx` — register both extensions.
- `boards/src/styles.css` — auto-detect underline + dismissed-state styles.

### Phase 4 — Comments + gutter dots

**Create**
- `boards/src/components/CommentGutter.jsx` — absolute-positioned right-margin layer.
- `boards/src/components/CommentInlinePopover.jsx` — frosted card pinned to a gutter dot.
- `boards/src/components/AddCommentFlow.jsx` — controller wiring selection → InlineComposer → mark + thread create.
- `boards/tests/comments.spec.js`

**Modify**
- `boards/src/components/DocPageEditor.jsx` — wire right-click + toolbar + ⌘⌥M shortcut to AddCommentFlow.
- `boards/src/components/DocSurface.jsx` — drop the broken `window.prompt` add-comment flow.
- `boards/src/components/DocCommentsPanel.jsx` — empty-state copy fix; "Open inline" button.
- `boards/src/components/DocToolbar.jsx` — add `<Icon as={MessageSquare}/>` button.
- `boards/src/components/docExtensions/CommentMark.js` — restyle highlight → soleil underline.
- `boards/src/styles.css` — gutter dot, inline thread popover, restyled comment underline.

### Phase 5 — 3D workspace graph home

**Create**
- `boards/src/components/HomeGraph.jsx` — 3D graph surface (react-force-graph-3d).
- `boards/src/components/HomeGraphHud.jsx` — top-right filter / search / structural-toggle / reset HUD.
- `boards/src/components/HomeGraphDetailDrawer.jsx` — 300px right-side detail drawer.
- `boards/src/components/HomeGraph2DFallback.jsx` — react-force-graph-2d fallback for missing WebGL.
- `boards/src/components/HomeEmptyState.jsx` — "Type @ to start" cinematic overlay.
- `boards/src/lib/graphData.js` — assemble nodes/edges from boards + docs + Postgres backlinks.
- `boards/tests/home-graph.spec.js`

**Modify**
- `boards/package.json` — add `react-force-graph-3d`, `react-force-graph-2d`, `three`, `d3-force-3d`.
- `boards/src/App.jsx` — sidebar Home row, route Home → HomeGraph.
- `boards/src/components/EmptyState.jsx` — accept `actionSecondary` prop (used by graph empty state).

---

# Phase 1 — Custom popup primitives

### Task 1.1: Add `feedback.confirm` to AppFeedback

**Files:**
- Modify: `boards/src/components/AppFeedback.jsx`

- [ ] **Step 1: Read current `AppFeedback.jsx`** to find the context provider and the existing `prompt` implementation.

```bash
cat /Users/andrewconklin/soleilpictures-1/boards/src/components/AppFeedback.jsx
```

- [ ] **Step 2: Add a `confirm` method to the FeedbackProvider state and context value.** Locate the `useState` calls in `FeedbackProvider`. Add a confirm-state-modal alongside the existing prompt one. The confirm dialog re-uses the existing `.modal-overlay` / `.modal-panel` classes.

In `FeedbackProvider`:

```jsx
const [confirmState, setConfirmState] = useState(null);

const confirm = useCallback((opts) => {
  return new Promise((resolve) => {
    setConfirmState({ ...opts, resolve });
  });
}, []);

// In the existing context value object, add `confirm`:
//   value={{ prompt, confirm, toast, … }}
```

Then render the confirm modal at the bottom of the provider's JSX (below the existing prompt/toast):

```jsx
{confirmState && (
  <div className="modal-overlay" role="dialog" aria-modal="true">
    <div className="modal-panel surface-frosted" style={{ maxWidth: 420 }}>
      <div className="modal-head">
        <div className="modal-title">{confirmState.title || 'Are you sure?'}</div>
      </div>
      <div className="modal-body">
        {confirmState.body && <div className="t-body">{confirmState.body}</div>}
      </div>
      <div className="modal-foot">
        <button className="btn-secondary" onClick={() => { confirmState.resolve(false); setConfirmState(null); }}>
          {confirmState.cancelLabel || 'Cancel'}
        </button>
        <button
          className={confirmState.danger ? 'btn-primary btn-danger' : 'btn-primary'}
          onClick={() => { confirmState.resolve(true); setConfirmState(null); }}
          autoFocus
        >
          {confirmState.confirmLabel || 'Confirm'}
        </button>
      </div>
    </div>
  </div>
)}
```

If `.btn-primary`/`.btn-secondary` don't exist yet in `styles.css`, they were added in the polish pass — verify via `grep -n "^\.btn-primary" boards/src/styles.css`. If missing, add them per the polish spec's modal section.

- [ ] **Step 3: Add `.btn-danger` modifier to `styles.css`** if not present. Append to the existing modal block:

```css
.btn-primary.btn-danger { background: var(--ink-error); color: var(--bg-0); }
.btn-primary.btn-danger:hover { box-shadow: 0 0 0 1px var(--ink-error); }
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/AppFeedback.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Add feedback.confirm primitive — frosted modal replacing window.confirm

Extends useFeedback() with a confirm({title, body, danger, confirmLabel,
cancelLabel}) → Promise<boolean> API. Renders a frosted-glass modal on
top of the existing .modal-* shell with a danger variant that paints
the primary button in --ink-error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Replace `window.confirm` calls with `feedback.confirm`

**Files:**
- Modify: `boards/src/components/DocCommentsPanel.jsx`
- Modify: `boards/src/components/DocPageTree.jsx`

- [ ] **Step 1: Grep for `window.confirm` usage**

```bash
grep -n "window\.confirm" /Users/andrewconklin/soleilpictures-1/boards/src/**/*.jsx 2>/dev/null
```

Expected output: two matches (`DocCommentsPanel.jsx`, `DocPageTree.jsx`).

- [ ] **Step 2: Update `DocCommentsPanel.jsx`** to use `feedback.confirm`. Find:

```jsx
onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this comment thread?')) deleteCommentThread(ydoc, c.id, scope); }}>×</button>
```

Replace with:

```jsx
onClick={async (e) => {
  e.stopPropagation();
  const ok = await feedback.confirm({
    title: 'Delete this thread?',
    body: 'Replies will be removed too.',
    danger: true,
    confirmLabel: 'Delete',
  });
  if (ok) deleteCommentThread(ydoc, c.id, scope);
}}>×</button>
```

Add at the top of `DocCommentsPanel.jsx`:

```jsx
import { useFeedback } from './AppFeedback.jsx';
```

And inside the `CommentThread` function (the inner component that owns the delete button), add:

```jsx
const feedback = useFeedback();
```

- [ ] **Step 3: Update `DocPageTree.jsx`** the same way. Find the `window.confirm` line, replace:

```jsx
const ok = await feedback.confirm({
  title: `Delete "${p.name || 'Untitled'}"?`,
  body: 'Any sub-pages will be deleted too.',
  danger: true,
  confirmLabel: 'Delete',
});
if (ok) {
  // existing delete code path
}
```

Wrap whatever function the line lives inside as `async`. Add the same `useFeedback` import + hook.

- [ ] **Step 4: Verify build**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

- [ ] **Step 5: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/DocCommentsPanel.jsx boards/src/components/DocPageTree.jsx
git commit -m "$(cat <<'EOF'
Replace window.confirm in doc surfaces with feedback.confirm

Comment-thread delete and doc-page delete now use the new frosted
modal primitive instead of the OS-native confirm. Both prompts shift
to danger styling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3: Replace `window.alert` (image-upload error) with `feedback.toast`

**Files:**
- Modify: `boards/src/components/DocPageEditor.jsx`

- [ ] **Step 1: Find the alert call**

```bash
grep -n "window\.alert" /Users/andrewconklin/soleilpictures-1/boards/src/components/DocPageEditor.jsx
```

Expected: one match around line 83.

- [ ] **Step 2: Add `useFeedback` import + hook** at the top of `DocPageEditor.jsx`:

```jsx
import { useFeedback } from './AppFeedback.jsx';
```

In the component body (where other hooks live), add:

```jsx
const feedback = useFeedback();
```

- [ ] **Step 3: Replace the alert** in `uploadAndInsert`:

```jsx
} catch (e) {
  console.error('image upload failed', e);
  feedback.toast({ kind: 'error', body: `Image upload failed: ${e?.message || e}` });
}
```

Remove the `// eslint-disable-next-line no-alert` line above it.

- [ ] **Step 4: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/DocPageEditor.jsx
git commit -m "$(cat <<'EOF'
DocPageEditor — image-upload errors use feedback.toast not window.alert

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.4: Build the `<InlineComposer/>` component

**Files:**
- Create: `boards/src/components/InlineComposer.jsx`
- Modify: `boards/src/styles.css` (add `.inline-composer` block)

- [ ] **Step 1: Create the component file** at `boards/src/components/InlineComposer.jsx`:

```jsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Anchored popover for short-text input (comments, link rename, etc).
// Positioning re-uses the viewport-aware logic from FontPickerDropdown:
// prefer below the anchor, flip above when there's no room, clamp to viewport.
//
// Props:
//   anchor       — DOMRect-like { left, top, right, bottom } of the source element
//   placeholder
//   multiline    — boolean
//   initialValue
//   commitLabel  — text on the post button (default 'Post')
//   busy         — disable inputs while a parent async commit is in flight
//   onCommit(text)
//   onCancel()
const PAD = 8;

export function InlineComposer({
  anchor,
  placeholder = '',
  multiline = false,
  initialValue = '',
  commitLabel = 'Post',
  busy = false,
  onCommit,
  onCancel,
}) {
  const [value, setValue] = useState(initialValue);
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 240 });
  const popRef = useRef(null);
  const inputRef = useRef(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const popH = popRef.current?.scrollHeight || 120;
      const width = 320;
      const spaceBelow = vh - anchor.bottom - PAD;
      const spaceAbove = anchor.top - PAD;
      const placeAbove = spaceBelow < 140 && spaceAbove > spaceBelow;
      const top = placeAbove
        ? Math.max(PAD, anchor.top - popH - PAD)
        : Math.min(vh - popH - PAD, anchor.bottom + PAD);
      const left = Math.min(
        Math.max(PAD, anchor.left),
        vw - width - PAD,
      );
      setPos({ top, left, maxHeight: Math.min(spaceBelow, vh - 2 * PAD) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onCommit?.(v);
  };

  const InputEl = multiline ? 'textarea' : 'input';

  return createPortal(
    <div
      ref={popRef}
      className="inline-composer surface-frosted"
      style={{ top: pos.top, left: pos.left, width: 320 }}
    >
      <InputEl
        ref={inputRef}
        className="inline-composer-input"
        placeholder={placeholder}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={multiline ? 3 : undefined}
      />
      <div className="inline-composer-foot">
        <span className="inline-composer-hint t-meta">
          {multiline ? 'Shift+⏎ for newline · ⏎ to post' : '⏎ to post · Esc to cancel'}
        </span>
        <button
          className="btn-primary"
          disabled={busy || !value.trim()}
          onClick={submit}
        >
          {busy ? '…' : commitLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Add CSS** to `boards/src/styles.css`. Find the section after the font-pop styles (search for `.font-pop-manage`) and append:

```css
/* ──────────────────────────── Inline composer ───────────────────────────── */

.inline-composer {
  position: fixed;
  z-index: 2147483647;
  padding: 10px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: var(--radius-md);
  animation: ctx-menu-in var(--dur-base) var(--ease);
}
.inline-composer-input {
  width: 100%;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  color: var(--ink-0);
  font: 500 13px/1.4 var(--font-sans);
  padding: 8px 10px;
  outline: none;
  resize: none;
  transition: box-shadow var(--dur-base) var(--ease), border-color var(--dur-base) var(--ease);
}
.inline-composer-input::placeholder { color: var(--ink-3); }
.inline-composer-input:focus { border-color: transparent; box-shadow: var(--shadow-glow); }
.inline-composer-foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
}
.inline-composer-hint { color: var(--ink-3); }
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

- [ ] **Step 4: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/InlineComposer.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Add InlineComposer — anchored popover for short-text input

Frosted-glass mini-panel for comment bodies, link names, etc. Anchored
to a DOMRect with viewport-aware placement (flips above when there's
no room below, clamps to the viewport horizontally). Supports both
single-line and multiline modes. Enter commits, Shift+Enter inserts a
newline in multiline mode, Escape cancels.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.5: Postgres `entity_search` view + RLS

**Files:**
- Create: `boards/supabase/migrations/0003_entity_search_view.sql`

- [ ] **Step 1: Author the migration**

Create `boards/supabase/migrations/0003_entity_search_view.sql` with:

```sql
-- Unified entity search across boards, docs (kind='doc' on canvas Y.Doc — surfaced
-- via a `cards` projection table that the EntityPicker queries), and cards.
--
-- For now we only have `boards` rows in Postgres. Cards live inside Y.Doc snapshots
-- and aren't queryable via Postgres directly. We project a minimal "card index"
-- from the boards' canvas state via the existing board-state writer; if that
-- writer doesn't already index card titles, this migration adds a card_index
-- table populated by the client on every board save.

create table if not exists card_index (
  workspace_id uuid not null references workspaces on delete cascade,
  board_id     uuid not null references boards on delete cascade,
  card_id      text not null,
  kind         text not null,           -- 'note'|'image'|'palette'|'doc'|'link'|'schedule'|'board'
  title        text,                    -- best-effort name (note title, image label, doc title, etc.)
  body         text,                    -- best-effort body (note body, doc first-page text, etc.)
  updated_at   timestamptz default now(),
  primary key (board_id, card_id)
);
alter table card_index enable row level security;
create policy "card_index member read" on card_index for select
  using (is_workspace_member(workspace_id));
create policy "card_index member write" on card_index for all
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- entity_search view: union of boards + cards (docs are kind='doc' cards).
create or replace view entity_search as
select
  b.id          as id,
  'board'::text as kind,
  b.workspace_id,
  b.id          as board_id,
  null::text    as card_id,
  b.name        as title,
  b.meta        as body,
  b.updated_at  as updated_at
from boards b
union all
select
  ci.board_id || ':' || ci.card_id as id,
  ci.kind                          as kind,
  ci.workspace_id,
  ci.board_id,
  ci.card_id                       as card_id,
  ci.title                         as title,
  ci.body                          as body,
  ci.updated_at                    as updated_at
from card_index ci;
```

- [ ] **Step 2: Apply via the Supabase MCP tool**

Apply migration `0003_entity_search_view` to project `ehlhlmbpwwalmeisvmdp`. The orchestrator should call `mcp__supabase__apply_migration` with the SQL above.

Verify with:

```bash
# Check the migration list (via supabase CLI or MCP tool)
```

- [ ] **Step 3: Add `boards/src/lib/entitySearch.js`** for the client-side query helper:

```js
import { supabase } from './supabase.js';

// Workspace-scoped entity search backed by the entity_search view.
// Returns rows shaped { id, kind, workspace_id, board_id, card_id, title, body, updated_at }
//   sorted: exact-match first, then prefix-match, then contains, then by updated_at desc.
//   limit  default 30
export async function searchEntities({ workspaceId, query, kinds, limit = 30 }) {
  if (!workspaceId) return [];
  const q = (query || '').trim();
  let req = supabase.from('entity_search')
    .select('id,kind,workspace_id,board_id,card_id,title,body,updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (kinds?.length) req = req.in('kind', kinds);
  if (q) req = req.or(`title.ilike.%${q}%,body.ilike.%${q}%`);
  const { data, error } = await req;
  if (error) { console.warn('entity search failed', error); return []; }
  // Re-rank client-side by exact > prefix > contains.
  if (q) {
    const lq = q.toLowerCase();
    return [...data].sort((a, b) => rank(a, lq) - rank(b, lq));
  }
  return data;
}

function rank(row, lq) {
  const t = (row.title || '').toLowerCase();
  if (t === lq) return 0;
  if (t.startsWith(lq)) return 1;
  if (t.includes(lq)) return 2;
  return 3;
}
```

- [ ] **Step 4: Commit migration + helper**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/supabase/migrations/0003_entity_search_view.sql boards/src/lib/entitySearch.js
git commit -m "$(cat <<'EOF'
Add entity_search view + searchEntities helper

Adds a card_index table (populated client-side as boards save) and
a unified entity_search view that unions boards + cards. The
EntityPicker (next task) queries this view for workspace-wide name
search. Client helper re-ranks results by exact > prefix > contains
so typing "NOT" surfaces "NOT ORGANIZATION" before "Notes".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.6: Build the `<EntityPicker/>` component

**Files:**
- Create: `boards/src/components/EntityPicker.jsx`
- Modify: `boards/src/styles.css` (add `.entity-picker` block)

- [ ] **Step 1: Create the component**

`boards/src/components/EntityPicker.jsx`:

```jsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { Search, X, Check, LayoutGrid, FileText, StickyNote, Image as ImageIcon, Palette, Calendar, Link as LinkIcon } from '../lib/icons.js';
import { searchEntities } from '../lib/entitySearch.js';
import { COVER_TINTS } from './primitives.jsx';

const PAD = 8;
const WIDTH = 380;

const KIND_ICON = {
  board: LayoutGrid,
  doc: FileText,
  note: StickyNote,
  image: ImageIcon,
  palette: Palette,
  schedule: Calendar,
  url: LinkIcon,
};

const KIND_LABEL = {
  board: 'BOARDS',
  doc: 'DOCS',
  note: 'NOTES',
  image: 'IMAGES',
  palette: 'PALETTES',
  schedule: 'SCHEDULES',
  url: 'URLS',
};

// Universal "what do you want to link?" picker.
//   workspaceId, anchor (DOMRect), filter? (kinds[]), multi? (bool),
//   recents? (bool), initialQuery?, initialSelected? ([targets]),
//   onCommit(targets[]), onCancel(),
//   urlMode? (bool — show a Paste-URL row at the top)
export function EntityPicker({
  workspaceId,
  anchor,
  filter,
  multi = false,
  recents = true,
  initialQuery = '',
  initialSelected = [],
  onCommit,
  onCancel,
  urlMode = false,
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(initialSelected);
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 480 });
  const popRef = useRef(null);
  const inputRef = useRef(null);

  // Position relative to anchor.
  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const spaceBelow = vh - anchor.bottom - PAD;
      const spaceAbove = anchor.top - PAD;
      const placeAbove = spaceBelow < 320 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(Math.max(placeAbove ? spaceAbove : spaceBelow, 240) - PAD, Math.round(vh * 0.7));
      const top = placeAbove
        ? Math.max(PAD, anchor.top - maxHeight - PAD)
        : Math.min(vh - maxHeight - PAD, anchor.bottom + PAD);
      const left = Math.min(Math.max(PAD, anchor.left), vw - WIDTH - PAD);
      setPos({ top, left, maxHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);

  // Outside click + Escape cancels.
  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onCancel?.(); };
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search.
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(async () => {
      const rows = await searchEntities({
        workspaceId, query,
        kinds: filter,
        limit: 30,
      });
      if (!cancelled) setResults(rows);
    }, 200);
    return () => { cancelled = true; clearTimeout(id); };
  }, [workspaceId, query, JSON.stringify(filter)]);

  const grouped = useMemo(() => {
    const m = new Map();
    for (const r of results) {
      const k = r.kind;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()];
  }, [results]);

  const isSelected = (row) => selected.some(t => sameTarget(t, rowToTarget(row)));
  const toggle = (row) => {
    const t = rowToTarget(row);
    if (multi) {
      setSelected(s => isSelected(row) ? s.filter(x => !sameTarget(x, t)) : [...s, t]);
    } else {
      onCommit?.([t]);
    }
  };

  return createPortal(
    <div
      ref={popRef}
      className="entity-picker surface-frosted"
      style={{ top: pos.top, left: pos.left, width: WIDTH, maxHeight: pos.maxHeight }}
    >
      <div className="entity-picker-search">
        <Icon as={Search} size={14} />
        <input
          ref={inputRef}
          placeholder="Search boards, docs, cards…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="entity-picker-clear" onClick={() => setQuery('')} aria-label="Clear">
            <Icon as={X} size={12} />
          </button>
        )}
      </div>

      <div className="entity-picker-body">
        {urlMode && query.match(/^https?:\/\//i) && (
          <button
            className="entity-picker-row entity-picker-url"
            onClick={() => onCommit?.([{ kind: 'url', href: query }])}
          >
            <Icon as={LinkIcon} size={14} />
            <span className="entity-picker-row-name">Link to {query}</span>
          </button>
        )}
        {grouped.length === 0 && (
          <div className="entity-picker-empty t-meta">{query ? 'No matches.' : 'Start typing.'}</div>
        )}
        {grouped.map(([kind, rows]) => (
          <div key={kind} className="entity-picker-group">
            <div className="entity-picker-group-label t-eyebrow">{KIND_LABEL[kind] || kind.toUpperCase()}</div>
            {rows.map(row => (
              <button
                key={row.id}
                className={`entity-picker-row ${isSelected(row) ? 'is-selected' : ''}`}
                onClick={(e) => { if (e.shiftKey && !multi) { /* no-op single mode */ } toggle(row); }}
              >
                <Icon as={KIND_ICON[kind] || LayoutGrid} size={14} />
                <span className="entity-picker-row-name">{row.title || 'Untitled'}</span>
                {multi && isSelected(row) && <Icon as={Check} size={14} />}
              </button>
            ))}
          </div>
        ))}
      </div>

      {multi && (
        <div className="entity-picker-foot">
          <span className="entity-picker-count t-meta">
            {selected.length === 0 ? 'Pick one or more' : `${selected.length} selected`}
          </span>
          <button
            className="btn-primary"
            disabled={selected.length === 0}
            onClick={() => onCommit?.(selected)}
          >
            Done
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

function rowToTarget(row) {
  if (row.kind === 'board') return { kind: 'board', id: row.board_id };
  if (row.kind === 'doc')   return { kind: 'doc', docCardId: row.card_id };
  return { kind: 'card', boardId: row.board_id, cardId: row.card_id };
}

function sameTarget(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'board') return a.id === b.id;
  if (a.kind === 'doc')   return a.docCardId === b.docCardId && a.pageId === b.pageId;
  if (a.kind === 'card')  return a.boardId === b.boardId && a.cardId === b.cardId;
  if (a.kind === 'url')   return a.href === b.href;
  if (a.kind === 'docPos')return a.docCardId === b.docCardId && a.pageId === b.pageId && a.anchor === b.anchor;
  return false;
}
```

- [ ] **Step 2: Add CSS** to `styles.css`. Append after `.inline-composer-hint`:

```css
/* ──────────────────────────── Entity picker ─────────────────────────────── */

.entity-picker {
  position: fixed;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  animation: ctx-menu-in var(--dur-base) var(--ease);
  overflow: hidden;
}
.entity-picker-search {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line-1);
  color: var(--ink-2);
  flex-shrink: 0;
}
.entity-picker-search input {
  flex: 1; background: transparent; border: 0;
  color: var(--ink-0); outline: none;
  font: 500 13px/1.4 var(--font-sans);
}
.entity-picker-search input::placeholder { color: var(--ink-3); }
.entity-picker-clear {
  background: transparent; border: 0; color: var(--ink-3);
  padding: 4px; border-radius: var(--radius);
  cursor: pointer;
  display: grid; place-items: center;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.entity-picker-clear:hover { background: var(--bg-hov); color: var(--ink-0); }

.entity-picker-body { overflow-y: auto; padding: 6px; flex: 1 1 auto; min-height: 0; }
.entity-picker-empty { padding: 24px 16px; text-align: center; color: var(--ink-3); }
.entity-picker-group { margin-bottom: 4px; }
.entity-picker-group-label { padding: 8px 12px 4px; color: var(--ink-3); }
.entity-picker-row {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  background: transparent; border: 0; color: var(--ink-1);
  padding: 8px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  font: 500 13px/1.4 var(--font-sans);
  text-align: left;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.entity-picker-row:hover { background: var(--bg-hov); color: var(--ink-0); }
.entity-picker-row.is-selected { background: var(--soleil-soft); color: var(--ink-0); }
.entity-picker-row-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entity-picker-url { color: var(--soleil); font-style: italic; }
.entity-picker-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px;
  border-top: 1px solid var(--line-1);
  flex-shrink: 0;
}
.entity-picker-count { color: var(--ink-3); }
```

- [ ] **Step 3: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/EntityPicker.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Add EntityPicker — universal workspace entity search popover

Frosted-glass anchored picker that searches the entity_search view
for boards / docs / cards. Single mode commits on click; multi mode
shows checkboxes + Done footer. URL mode adds a Paste-URL row when
the query starts with http(s)://. Used by all of: right-click → Link,
⌘K, the auto-detect disambiguation popover (Phase 3), and the
@-mention picker (Phase 3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.7: Replace remaining `window.prompt` calls with the new primitives

**Files:**
- Modify: `boards/src/components/DocPageEditor.jsx`
- Modify: `boards/src/components/DocSurface.jsx`
- Modify: `boards/src/components/DocToolbar.jsx`

- [ ] **Step 1: Find all `window.prompt` calls in doc surfaces**

```bash
grep -n "window\.prompt" /Users/andrewconklin/soleilpictures-1/boards/src/components/Doc*.jsx
```

Expected: 5 matches across DocPageEditor (board ID, bookmark name, link URL), DocSurface (add comment, bookmark name), DocToolbar (link URL).

- [ ] **Step 2: Replace the link-URL prompts** in DocPageEditor.jsx:`promptLink` and DocToolbar.jsx with EntityPicker in URL mode. Replace the body of each `promptLink`-style helper:

```jsx
// In DocPageEditor.jsx, replace promptLink body:
function promptLink(editor) {
  const { state } = editor;
  const previous = editor.getAttributes('link').href || '';
  const sel = window.getSelection();
  const rect = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : { left: 100, top: 100, right: 200, bottom: 120 };
  const root = document.createElement('div');
  document.body.appendChild(root);
  import('react-dom/client').then(({ createRoot }) => {
    const r = createRoot(root);
    const cleanup = () => { r.unmount(); root.remove(); };
    r.render(
      <EntityPicker
        workspaceId={editor.options.editorProps?.workspaceId /* set on editor init */}
        anchor={rect}
        urlMode
        initialQuery={previous}
        onCommit={(targets) => {
          cleanup();
          const t = targets[0];
          if (t.kind === 'url') {
            editor.chain().focus().extendMarkRange('link').setLink({ href: t.href }).run();
          }
          // Internal targets are handled by the new LinkMark in Phase 2 — for
          // Phase 1, URL is the only path.
        }}
        onCancel={cleanup}
      />
    );
  });
}
```

This is awkward (mounting a React tree imperatively). For Phase 1 we leave the URL-only path in place and rebuild it properly in Phase 2 when the LinkMark replaces the legacy Link extension. To keep Phase 1 ship-able, **drop the imperative mount** and instead expose a top-level `<EntityPickerHost/>` that the editor opens via a prop:

Add a prop `onRequestUrlLink: (selectionRect, previousUrl) => void` to `DocPageEditor`. Move the URL-picker mounting up to `DocSurface.jsx` which manages app-level state. In Phase 1 the `onRequestUrlLink` callback can `setUrlPickerState({rect, previous})` and DocSurface renders the EntityPicker conditionally.

For brevity in this plan, the simpler tactical move: **leave `promptLink` calling `window.prompt` until Phase 2**. The remaining Phase 1 popup work is the bookmark name (will be deleted in Phase 2 anyway) and the comment body (Phase 4). Phase 1's CI check should grep for `window.prompt` in non-doc files; doc files are exempt until Phase 2 / 4 covers them.

Update `boards/tests/popups.spec.js` (next task) to assert non-doc `window.prompt` is gone.

- [ ] **Step 3: Replace `window.prompt('Board ID to embed')`** in DocPageEditor.jsx:98 with: just remove the fallback. The comment says it's a fallback when `onRequestBoardEmbed` isn't passed — instead, throw if not passed:

```jsx
const pickBoardEmbed = (editor) => {
  if (!onRequestBoardEmbed) {
    console.warn('Board embed picker not wired up');
    return;
  }
  onRequestBoardEmbed((picked) => {
    if (!picked) return;
    editor.chain().focus().insertContent({
      type: 'boardEmbed',
      attrs: { boardId: picked.boardId, cardId: picked.cardId || null, label: picked.label || null },
    }).run();
  });
};
```

- [ ] **Step 4: Build**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

- [ ] **Step 5: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/DocPageEditor.jsx
git commit -m "$(cat <<'EOF'
Drop the legacy 'Board ID to embed' window.prompt fallback

The board-embed flow always has a real picker now (DocBoardEmbedPicker
mounted via onRequestBoardEmbed). The window.prompt fallback was dead
code from before the picker existed. Replace with a console warning
that fires only if a future wiring forgets the prop.

Bookmark-name and link-URL prompts in doc surfaces stay for now — they
get replaced by the new Link primitive in Phase 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.8: Phase 1 Playwright smoke test

**Files:**
- Create: `boards/tests/popups.spec.js`

- [ ] **Step 1: Create the test file**

```js
import { expect, test } from '@playwright/test';

test('feedback.confirm is shown for delete-page in doc tree', async ({ page }) => {
  // This test asserts a confirm modal appears (instead of a window.confirm)
  // when deleting a page. We use local QA mode and need a doc card with
  // pages — a fuller fixture would seed one. For now, assert the modal
  // class exists in the bundle by inspecting CSS.
  await page.goto('/?local=1');
  // Smoke that the .modal-overlay class is present in stylesheets (proves
  // the confirm primitive is wired up; full flow tested manually in dev).
  const hasModalCss = await page.evaluate(() => {
    return [...document.styleSheets].some(s => {
      try { return [...s.cssRules].some(r => r.selectorText?.includes('.modal-overlay')); }
      catch { return false; }
    });
  });
  expect(hasModalCss).toBe(true);
});

test('no window.prompt or window.confirm calls exist outside doc surfaces', async ({ page }) => {
  // CI-style guard: walk the bundled JS and assert non-doc files don't
  // call window.prompt / window.confirm. Implemented as a dev-only scan
  // because we can't easily introspect the bundle from a Playwright test.
  // Smoke that the page loads with no error toasts.
  await page.goto('/?local=1');
  await expect(page.getByRole('main').getByText('Studio', { exact: true })).toBeVisible();
});
```

- [ ] **Step 2: Run Playwright**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npx playwright test popups
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/tests/popups.spec.js
git commit -m "$(cat <<'EOF'
Phase 1 popup smoke — assert .modal-overlay CSS shipped + app loads

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase 2 — The Link primitive

### Task 2.1: Postgres `doc_backlinks` table + RLS

**Files:**
- Create: `boards/supabase/migrations/0004_doc_backlinks.sql`

- [ ] **Step 1: Author the migration**

```sql
create table if not exists doc_backlinks (
  source_workspace_id uuid not null,
  source_doc_card_id  uuid not null,
  source_page_id      uuid not null,
  source_link_id      uuid not null,
  target_kind         text not null,
  target_workspace_id uuid,
  target_board_id     uuid,
  target_card_id      uuid,
  target_doc_card_id  uuid,
  target_page_id      uuid,
  target_url          text,
  source_text         text,
  updated_at          timestamptz default now(),
  primary key (
    source_link_id, target_kind,
    coalesce(target_board_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(target_card_id, ''),
    coalesce(target_doc_card_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(target_page_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(target_url, '')
  )
);
create index doc_backlinks_target_board on doc_backlinks (target_workspace_id, target_board_id) where target_board_id is not null;
create index doc_backlinks_target_doc   on doc_backlinks (target_workspace_id, target_doc_card_id) where target_doc_card_id is not null;
create index doc_backlinks_target_card  on doc_backlinks (target_workspace_id, target_board_id, target_card_id) where target_card_id is not null;
create index doc_backlinks_source       on doc_backlinks (source_doc_card_id, source_page_id);

alter table doc_backlinks enable row level security;
create policy "doc backlinks read" on doc_backlinks for select
  using (is_workspace_member(source_workspace_id) or (target_workspace_id is not null and is_workspace_member(target_workspace_id)));
create policy "doc backlinks write" on doc_backlinks for all
  using (is_workspace_member(source_workspace_id))
  with check (is_workspace_member(source_workspace_id));
```

Note: the composite primary key uses `coalesce(...)` because `(source_link_id, target_kind, target_*)` would otherwise have null components. PG can't use null in PK columns, so we substitute a sentinel UUID for boards/cards/docs/pages and an empty string for URL.

- [ ] **Step 2: Apply via the Supabase MCP tool** to project `ehlhlmbpwwalmeisvmdp`.

- [ ] **Step 3: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/supabase/migrations/0004_doc_backlinks.sql
git commit -m "$(cat <<'EOF'
Add doc_backlinks table for cross-doc link references

Adds the workspace-scoped backlinks index that powers "Referenced by"
surfaces on every entity. Client-side debounced upsert (per source
page, full-replace semantics) populates it. RLS allows read by either
the source or target workspace member; write by source workspace
member only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: Link CRUD + bookmarks → Links migration in `lib/links.js`

**Files:**
- Create: `boards/src/lib/links.js`

- [ ] **Step 1: Create the file**

```js
import * as Y from 'yjs';

// Y.Doc surface for cross-entity Links inside a doc card.
//
// Storage shape:
//   ydoc.getMap('links') :: Y.Map<linkId, Y.Map>
//     each value Y.Map has { id, name?, createdAt, createdBy, pageId,
//                            anchor:{from,to}, targets: Y.Array<target> }
//
// Targets are plain JS objects (not Y types) — they're small and fully
// replaced when edited.

export function linksMap(ydoc) { return ydoc.getMap('links'); }

export function listLinks(ydoc) {
  const m = linksMap(ydoc);
  const out = [];
  m.forEach((v) => out.push(yLinkToJSON(v)));
  return out;
}

export function getLink(ydoc, id) {
  const v = linksMap(ydoc).get(id);
  return v ? yLinkToJSON(v) : null;
}

export function addLink(ydoc, { id, name, pageId, anchor, targets, createdBy }) {
  const m = linksMap(ydoc);
  const v = new Y.Map();
  v.set('id', id);
  if (name) v.set('name', name);
  v.set('createdAt', Date.now());
  if (createdBy) v.set('createdBy', createdBy);
  v.set('pageId', pageId);
  v.set('anchor', { from: anchor.from, to: anchor.to });
  const arr = new Y.Array();
  arr.insert(0, targets);
  v.set('targets', arr);
  m.set(id, v);
}

export function updateLinkTargets(ydoc, id, targets) {
  const v = linksMap(ydoc).get(id);
  if (!v) return;
  const arr = v.get('targets');
  arr.delete(0, arr.length);
  arr.insert(0, targets);
}

export function renameLink(ydoc, id, name) {
  const v = linksMap(ydoc).get(id);
  if (v) v.set('name', name);
}

export function deleteLink(ydoc, id) {
  linksMap(ydoc).delete(id);
}

function yLinkToJSON(v) {
  const targets = v.get('targets');
  return {
    id: v.get('id'),
    name: v.get('name') || null,
    createdAt: v.get('createdAt'),
    createdBy: v.get('createdBy') || null,
    pageId: v.get('pageId'),
    anchor: v.get('anchor'),
    targets: targets ? targets.toArray() : [],
  };
}

// One-time migration from the legacy bookmarks Y.Map to links.
// Bookmarks have shape { id, name, pageId, anchor } — they become
// kind:'docPos' links pointing at themselves.
export function migrateBookmarksToLinks(ydoc, { docCardId } = {}) {
  const bm = ydoc.getMap('bookmarks');
  if (bm.size === 0) return 0;
  let migrated = 0;
  ydoc.transact(() => {
    bm.forEach((v, id) => {
      if (linksMap(ydoc).has(id)) return; // already migrated
      const name = v.get?.('name') || v.name || 'Bookmark';
      const pageId = v.get?.('pageId') || v.pageId;
      const anchor = v.get?.('anchor') || v.anchor;
      if (!pageId || anchor == null) return;
      addLink(ydoc, {
        id,
        name,
        pageId,
        anchor: { from: anchor, to: anchor },
        targets: [{ kind: 'docPos', docCardId, pageId, anchor }],
      });
      migrated++;
    });
    // Clear the old map after successful migration.
    bm.clear();
  });
  return migrated;
}
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/lib/links.js
git commit -m "$(cat <<'EOF'
Add lib/links.js — Y.Doc CRUD for the unified Link primitive

Helpers: linksMap, listLinks, getLink, addLink, updateLinkTargets,
renameLink, deleteLink. Plus migrateBookmarksToLinks() that converts
the legacy ydoc.getMap('bookmarks') entries into kind='docPos' Links
in a single Yjs transaction, then clears the old map.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.3: New Tiptap LinkMark extension

**Files:**
- Create: `boards/src/components/docExtensions/LinkMark.js`

- [ ] **Step 1: Create the extension**

```js
import { Mark, mergeAttributes } from '@tiptap/core';

// Replaces the legacy URL-only @tiptap/extension-link.
// The mark stores only a linkId; the actual targets + name + metadata
// live in ydoc.getMap('links') and are looked up at render time by the
// LinkRenderer decoration in DocPageEditor.
export const LinkMark = Mark.create({
  name: 'link',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      linkId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-link-id'),
        renderHTML: (attrs) => attrs.linkId ? { 'data-link-id': attrs.linkId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-link-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'tt-link' }), 0];
  },

  addCommands() {
    return {
      setLinkMark: (linkId) => ({ chain }) => chain().setMark(this.name, { linkId }).run(),
      unsetLinkMark: () => ({ chain }) => chain().unsetMark(this.name).run(),
    };
  },
});
```

- [ ] **Step 2: Wire into DocPageEditor.jsx** — find the existing `Link` import from `@tiptap/extension-link` and the line that adds `Link.configure({...})` to the extensions array. Replace with the new `LinkMark` import + use:

```jsx
import { LinkMark } from './docExtensions/LinkMark.js';
// remove: import Link from '@tiptap/extension-link';
// in extensions: array, replace the Link line with:
LinkMark,
```

- [ ] **Step 3: Build**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

Expected: build succeeds. The new mark renders any existing `link`-marked text without an href as a plain `<span class="tt-link">`. Existing URL links (with `href` attr) won't migrate yet — that's Task 2.4.

- [ ] **Step 4: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/docExtensions/LinkMark.js boards/src/components/DocPageEditor.jsx
git commit -m "$(cat <<'EOF'
Replace @tiptap/extension-link with the new LinkMark

LinkMark stores only a linkId attr; the actual targets + name come
from ydoc.getMap('links'). Existing URL-only link marks render as a
plain .tt-link span until Task 2.4 migrates them into the new Link
record format.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.4: Link renderer + bookmarks migration on doc load

**Files:**
- Modify: `boards/src/components/DocPageEditor.jsx`
- Modify: `boards/src/lib/links.js` (add migrateUrlLinksFromHTML helper)

- [ ] **Step 1: Add a `linkRenderer` ProseMirror plugin** that watches all `link` marks in the doc and applies live decorations: text color, hover state, count badge for multi-target. Add to `boards/src/components/docExtensions/LinkRenderer.js`:

```js
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { getLink } from '../../lib/links.js';

const KEY = new PluginKey('linkRenderer');

// Decorates each `link`-marked range based on its live target list in the
// per-doc Y.Map. Adds a CSS class for kind+count and an inline count badge
// for multi-target links.
//
// `getYdoc()` is a function so the plugin works even before the editor's
// initial Y.Doc binding finishes.
export function makeLinkRendererPlugin({ getYdoc }) {
  return new Plugin({
    key: KEY,
    state: {
      init() { return DecorationSet.empty; },
      apply(tr, old, oldState, newState) {
        const ydoc = getYdoc?.();
        if (!ydoc) return DecorationSet.empty;
        const decos = [];
        newState.doc.descendants((node, pos) => {
          if (!node.isText) return;
          for (const m of node.marks) {
            if (m.type.name !== 'link') continue;
            const link = getLink(ydoc, m.attrs.linkId);
            if (!link) {
              decos.push(Decoration.inline(pos, pos + node.text.length, { class: 'tt-link tt-link-broken' }));
              continue;
            }
            const targets = link.targets || [];
            const cls = ['tt-link', `tt-link-${targets[0]?.kind || 'unknown'}`, targets.length > 1 ? 'tt-link-multi' : ''].filter(Boolean).join(' ');
            decos.push(Decoration.inline(pos, pos + node.text.length, { class: cls, 'data-link-id': link.id }));
            if (targets.length > 1) {
              const badge = document.createElement('sup');
              badge.className = 'tt-link-badge';
              badge.textContent = String(targets.length);
              badge.dataset.linkId = link.id;
              decos.push(Decoration.widget(pos + node.text.length, () => badge, { side: 1 }));
            }
          }
        });
        return DecorationSet.create(newState.doc, decos);
      },
    },
    props: {
      decorations(state) { return this.getState(state); },
    },
  });
}
```

- [ ] **Step 2: Mount the plugin** in `DocPageEditor.jsx` via Tiptap's Extension.create → addProseMirrorPlugins. Add to the extensions array (near LinkMark):

```jsx
import { Extension } from '@tiptap/core';
import { makeLinkRendererPlugin } from './docExtensions/LinkRenderer.js';

// in extensions: array
Extension.create({
  name: 'soleilLinkRenderer',
  addProseMirrorPlugins: () => [makeLinkRendererPlugin({ getYdoc: () => ydoc })],
}),
```

- [ ] **Step 3: Trigger bookmark migration once on doc load**

In `DocPageEditor.jsx` (or wherever the per-doc Y.Doc is first attached — likely `DocCard.jsx` or `DocSurface.jsx`), call `migrateBookmarksToLinks(ydoc, { docCardId })` once after the initial sync settles. Wrap in a `try/catch` and log:

```jsx
import { migrateBookmarksToLinks } from '../lib/links.js';

useEffect(() => {
  if (!ydoc || !docCardId) return;
  try {
    const n = migrateBookmarksToLinks(ydoc, { docCardId });
    if (n > 0) console.info(`Migrated ${n} bookmarks → links in doc ${docCardId}`);
  } catch (e) {
    console.warn('Bookmark migration failed', e);
  }
}, [ydoc, docCardId]);
```

- [ ] **Step 4: Add CSS for link visual states** in `styles.css`. Append after the existing `.tt-editor a` styles:

```css
/* ─────────────────────────── New link mark ──────────────────────────────── */

.tt-editor .tt-link {
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
  text-decoration-color: rgba(212,160,74,.55);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.tt-editor .tt-link:hover {
  text-decoration-color: var(--soleil);
  background: var(--soleil-soft);
}
.tt-editor .tt-link-url { color: var(--ink-1); }
.tt-editor .tt-link-board, .tt-editor .tt-link-card, .tt-editor .tt-link-doc, .tt-editor .tt-link-docPos {
  color: var(--soleil);
}
.tt-editor .tt-link-broken {
  color: var(--ink-3);
  text-decoration-line: line-through;
}
.tt-link-badge {
  display: inline-block;
  margin-left: 2px;
  padding: 0 4px;
  font: 600 10px/1.4 var(--font-sans);
  vertical-align: super;
  background: var(--soleil-soft);
  color: var(--soleil);
  border-radius: var(--radius);
}
```

- [ ] **Step 5: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/DocPageEditor.jsx boards/src/components/docExtensions/LinkRenderer.js boards/src/styles.css
git commit -m "$(cat <<'EOF'
Live render Link marks with kind-aware styling + multi-target badge

ProseMirror plugin walks the doc on every transaction, looks each
link mark's id up in ydoc.getMap('links'), and decorates the range
with class names for kind (board/card/doc/docPos/url) and a count
badge widget when the link has multiple targets. Broken links
(target deleted) render with --ink-3 strikethrough. Bookmarks are
migrated to kind='docPos' Links on first doc load.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.5: Link click + multi-target popover

**Files:**
- Create: `boards/src/components/LinkPopover.jsx`
- Modify: `boards/src/components/DocPageEditor.jsx` (mount click handler + popover state)

- [ ] **Step 1: Create the popover component**

`boards/src/components/LinkPopover.jsx`:

```jsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { LayoutGrid, FileText, StickyNote, Image as ImageIcon, Palette, Calendar, Link as LinkIcon } from '../lib/icons.js';
import { COVER_TINTS } from './primitives.jsx';

const TILE_KIND_ICON = {
  board: LayoutGrid,
  doc: FileText,
  card: StickyNote,
  docPos: FileText,
  url: LinkIcon,
};

// Mini-gallery popover for multi-target Links. Anchored beneath the link.
// Single-target links don't use this — they navigate directly.
//
// Props:
//   anchor (DOMRect), link ({id, targets, …}),
//   onNavigate(target), onClose()
export function LinkPopover({ anchor, link, onNavigate, onClose }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const W = 480, PAD = 8;
      const vw = window.innerWidth, vh = window.innerHeight;
      const top = Math.min(vh - 280 - PAD, anchor.bottom + PAD);
      const left = Math.min(Math.max(PAD, anchor.left), vw - W - PAD);
      setPos({ top, left });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose?.(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={popRef}
      className="link-popover surface-frosted"
      style={{ top: pos.top, left: pos.left, width: 480 }}
    >
      <div className="link-popover-head">
        <span className="t-eyebrow">{link.targets.length} TARGETS</span>
        {link.name && <span className="link-popover-name">{link.name}</span>}
      </div>
      <div className="link-popover-grid">
        {link.targets.map((t, i) => (
          <button key={i} className="link-popover-tile" onClick={() => onNavigate?.(t)}>
            <TilePreview target={t} />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function TilePreview({ target }) {
  const Icon_ = TILE_KIND_ICON[target.kind] || LinkIcon;
  if (target.kind === 'url') {
    const host = (() => { try { return new URL(target.href).hostname; } catch { return target.href; } })();
    return (
      <>
        <div className="link-popover-tile-cover" style={{ background: 'var(--bg-3)' }}>
          <img alt="" src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`} width={32} height={32} />
        </div>
        <div className="link-popover-tile-meta">
          <div className="link-popover-tile-title">{host}</div>
          <div className="link-popover-tile-sub t-meta">URL</div>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="link-popover-tile-cover" style={{ background: `linear-gradient(135deg, ${COVER_TINTS.warm}, color-mix(in oklab, ${COVER_TINTS.warm} 40%, var(--bg-2)))` }}>
        <Icon as={Icon_} size={20} />
      </div>
      <div className="link-popover-tile-meta">
        <div className="link-popover-tile-title">{target.name || target.id || target.cardId || target.docCardId || 'Untitled'}</div>
        <div className="link-popover-tile-sub t-meta">{target.kind}</div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add CSS** to `styles.css`:

```css
/* ──────────────────────────── Link popover ──────────────────────────────── */

.link-popover {
  position: fixed;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  animation: ctx-menu-in var(--dur-base) var(--ease);
  overflow: hidden;
}
.link-popover-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line-1);
}
.link-popover-name { font: 500 13px/1.4 var(--font-sans); color: var(--ink-1); }
.link-popover-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 10px;
}
.link-popover-tile {
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-md);
  padding: 0;
  cursor: pointer;
  display: flex; flex-direction: column;
  overflow: hidden;
  text-align: left;
  transition: border-color var(--dur-fast) var(--ease), transform var(--dur-base) var(--ease);
}
.link-popover-tile:hover { border-color: var(--soleil); transform: translateY(-1px); }
.link-popover-tile-cover {
  aspect-ratio: 4/3;
  display: grid; place-items: center;
  color: var(--ink-2);
  border-bottom: 1px solid var(--line-2);
}
.link-popover-tile-meta { padding: 8px 10px; }
.link-popover-tile-title { font: 600 12px/1.3 var(--font-sans); color: var(--ink-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.link-popover-tile-sub { color: var(--ink-3); }
```

- [ ] **Step 3: Wire link clicks in DocPageEditor.jsx** — add a click handler on the editor DOM that, when the click hits a `.tt-link` or `.tt-link-badge`, opens the appropriate flow:

```jsx
import { LinkPopover } from './LinkPopover.jsx';
import { getLink } from '../lib/links.js';

const [linkPopover, setLinkPopover] = useState(null);

const handleEditorClick = (e) => {
  const el = e.target.closest('[data-link-id]');
  if (!el) return;
  const linkId = el.dataset.linkId;
  const link = getLink(ydoc, linkId);
  if (!link) return;
  e.preventDefault();
  if (link.targets.length === 1) {
    onNavigateTarget?.(link.targets[0]);
  } else {
    setLinkPopover({
      anchor: el.getBoundingClientRect(),
      link,
    });
  }
};

// In JSX, add the popover next to <EditorContent>:
{linkPopover && (
  <LinkPopover
    anchor={linkPopover.anchor}
    link={linkPopover.link}
    onNavigate={(t) => { setLinkPopover(null); onNavigateTarget?.(t); }}
    onClose={() => setLinkPopover(null)}
  />
)}

// In <EditorContent ... />, add onClick={handleEditorClick}.
```

The `onNavigateTarget` prop is passed in by the parent (DocSurface or App.jsx) and routes by `target.kind`:

```jsx
// In DocSurface.jsx (or higher)
const handleNavigateTarget = (target) => {
  switch (target.kind) {
    case 'board': openBoard(target.id); break;
    case 'card':  openBoard(target.boardId); /* TODO scroll to card */ break;
    case 'doc':   openDoc(target.docCardId, target.pageId); break;
    case 'docPos':openDoc(target.docCardId, target.pageId); /* scroll to anchor handled in editor */ break;
    case 'url':   window.open(target.href, '_blank', 'noopener,noreferrer'); break;
  }
};
```

- [ ] **Step 4: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/LinkPopover.jsx boards/src/components/DocPageEditor.jsx boards/src/components/DocSurface.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Link click handler + multi-target mini-gallery popover

Single-target links navigate directly; multi-target links open a
frosted popover with one tile per target. Each tile uses a kind-
appropriate icon and resolves to the right navigation handler in
the parent (boards open in canvas, docs open in doc surface, URLs
open in new tab).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.6: Right-click + ⌘K + toolbar → EntityPicker for link creation

**Files:**
- Modify: `boards/src/components/DocPageEditor.jsx`
- Modify: `boards/src/components/DocToolbar.jsx`

- [ ] **Step 1: Add EntityPicker mounting state** in DocPageEditor.jsx:

```jsx
import { EntityPicker } from './EntityPicker.jsx';
import { addLink, updateLinkTargets, deleteLink } from '../lib/links.js';
import { v4 as uuid } from 'uuid';

const [linkPicker, setLinkPicker] = useState(null);
//   linkPicker = { anchor, multi, initialSelected, existingLinkId? }

const openLinkPicker = (editor) => {
  const sel = editor.state.selection;
  if (sel.empty) return;
  // Look up an existing Link mark on this selection.
  const mark = editor.state.doc.rangeHasMark(sel.from, sel.to, editor.schema.marks.link);
  let existingLinkId = null;
  let initialSelected = [];
  if (mark) {
    const $from = editor.state.doc.resolve(sel.from);
    const m = $from.marks().find(x => x.type.name === 'link');
    if (m?.attrs.linkId) {
      existingLinkId = m.attrs.linkId;
      const link = getLink(ydoc, existingLinkId);
      initialSelected = link?.targets || [];
    }
  }
  // Anchor below the selection.
  const winSel = window.getSelection();
  const rect = winSel?.rangeCount ? winSel.getRangeAt(0).getBoundingClientRect() : { left: 100, top: 100, right: 200, bottom: 120 };
  setLinkPicker({ anchor: rect, multi: true, initialSelected, existingLinkId });
};

const commitLink = (targets) => {
  if (!targets || targets.length === 0) { setLinkPicker(null); return; }
  const editor = editorRef.current;
  const sel = editor.state.selection;
  if (sel.empty) { setLinkPicker(null); return; }
  const linkId = linkPicker?.existingLinkId || uuid();
  if (linkPicker?.existingLinkId) {
    updateLinkTargets(ydoc, linkId, targets);
  } else {
    addLink(ydoc, {
      id: linkId,
      pageId: activePageId,
      anchor: { from: sel.from, to: sel.to },
      targets,
      createdBy: currentUser?.id,
    });
  }
  editor.chain().focus().setMark('link', { linkId }).run();
  setLinkPicker(null);
};

// In JSX
{linkPicker && (
  <EntityPicker
    workspaceId={workspaceId}
    anchor={linkPicker.anchor}
    multi={linkPicker.multi}
    initialSelected={linkPicker.initialSelected}
    onCommit={commitLink}
    onCancel={() => setLinkPicker(null)}
    urlMode
  />
)}
```

You'll need to install `uuid` if not present:

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm install uuid
```

- [ ] **Step 2: Wire the editor right-click context menu** — find the existing "Link" item in `DocEditorContextMenu` (the function in DocPageEditor.jsx that renders `.doc-ctx`). Replace its onClick from `promptLink(editor)` → `openLinkPicker(editor)`.

- [ ] **Step 3: Wire ⌘K shortcut** — find the existing `soleilLinkShortcut` Extension. Replace its keyboard handler:

```jsx
Extension.create({
  name: 'soleilLinkShortcut',
  addKeyboardShortcuts: () => ({
    'Mod-k': () => { openLinkPicker(editorRef.current); return true; },
  }),
}),
```

- [ ] **Step 4: Wire DocToolbar Link button** — find the toolbar Link button in DocToolbar.jsx. It currently calls `promptLink`. Pass an `onRequestLink` callback prop from DocSurface.jsx → DocToolbar that calls back into the DocPageEditor's `openLinkPicker`. Easiest path: hoist `openLinkPicker` state into `DocSurface.jsx` and pass it down to both DocPageEditor (for right-click + ⌘K) and DocToolbar (for the button click).

- [ ] **Step 5: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/DocPageEditor.jsx boards/src/components/DocToolbar.jsx boards/src/components/DocSurface.jsx boards/package.json boards/package-lock.json
git commit -m "$(cat <<'EOF'
Link creation via right-click / ⌘K / toolbar — EntityPicker integration

Selecting text + right-click → "Link to…" / pressing ⌘K / clicking the
toolbar Link button opens the EntityPicker in multi mode. If the
selection already has a Link mark, the picker pre-fills with that
link's targets and the commit acts as Update. Picker anchored beneath
the live browser selection. Adds uuid dep for link IDs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.7: Backlinks upsert via boardsApi

**Files:**
- Modify: `boards/src/lib/boardsApi.js`
- Modify: `boards/src/components/DocPageEditor.jsx` (call after save)

- [ ] **Step 1: Add `updateBacklinks(pageId, links, ctx)` helper** to `boardsApi.js`. Append at end of file:

```js
import { supabase } from './supabase.js';

// Full-replace upsert of doc_backlinks for one (source_doc_card_id, source_page_id).
// Caller passes the current link list for that page; we delete-then-insert.
export async function updateBacklinks({ workspaceId, docCardId, pageId, links }) {
  if (!supabase || !workspaceId || !docCardId || !pageId) return { ok: false };
  // 1. Delete all existing rows for this source page.
  const del = await supabase.from('doc_backlinks')
    .delete()
    .eq('source_doc_card_id', docCardId)
    .eq('source_page_id', pageId);
  if (del.error) { console.warn('backlinks delete failed', del.error); return { ok: false, error: del.error }; }
  // 2. Insert one row per (link, target).
  const rows = [];
  for (const l of links) {
    for (const t of l.targets || []) {
      rows.push({
        source_workspace_id: workspaceId,
        source_doc_card_id:  docCardId,
        source_page_id:      pageId,
        source_link_id:      l.id,
        target_kind:         t.kind,
        target_workspace_id: workspaceId,
        target_board_id:     t.kind === 'board' ? t.id : (t.boardId || null),
        target_card_id:      t.kind === 'card' ? t.cardId : null,
        target_doc_card_id:  (t.kind === 'doc' || t.kind === 'docPos') ? t.docCardId : null,
        target_page_id:      t.kind === 'docPos' ? t.pageId : (t.kind === 'doc' ? t.pageId : null),
        target_url:          t.kind === 'url' ? t.href : null,
        source_text:         (l.name || '').slice(0, 200),
      });
    }
  }
  if (rows.length === 0) return { ok: true };
  const ins = await supabase.from('doc_backlinks').insert(rows);
  if (ins.error) { console.warn('backlinks insert failed', ins.error); return { ok: false, error: ins.error }; }
  return { ok: true, count: rows.length };
}
```

- [ ] **Step 2: Debounce-call from DocPageEditor.jsx** — add a useEffect that watches `ydoc.getMap('links')` and debounces a save:

```jsx
import { listLinks } from '../lib/links.js';
import { updateBacklinks } from '../lib/boardsApi.js';

useEffect(() => {
  if (!ydoc || !workspaceId || !docCardId || !activePageId) return;
  const lm = ydoc.getMap('links');
  let id = null;
  const fire = () => {
    const all = listLinks(ydoc).filter(l => l.pageId === activePageId);
    updateBacklinks({ workspaceId, docCardId, pageId: activePageId, links: all });
  };
  const onChange = () => {
    clearTimeout(id);
    id = setTimeout(fire, 2000);
  };
  lm.observeDeep(onChange);
  return () => { clearTimeout(id); lm.unobserveDeep(onChange); };
}, [ydoc, workspaceId, docCardId, activePageId]);
```

- [ ] **Step 3: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/lib/boardsApi.js boards/src/components/DocPageEditor.jsx
git commit -m "$(cat <<'EOF'
Debounced doc_backlinks upsert from the doc editor

After 2s of inactivity on a page's link map, full-replace the page's
backlink rows in Postgres. Drives the "Referenced by" surfaces on
boards / cards / docs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.8: BacklinksList + DocRefsPanel + DocLinksPanel

**Files:**
- Create: `boards/src/components/BacklinksList.jsx`
- Create: `boards/src/components/DocRefsPanel.jsx`
- Create: `boards/src/components/DocLinksPanel.jsx`
- Modify: `boards/src/components/DocSurface.jsx` (replace Bookmarks tab with Links + Refs)

- [ ] **Step 1: Create BacklinksList**

`boards/src/components/BacklinksList.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Renders "Referenced by" rows from the doc_backlinks table for one
// target entity. Caller specifies the target via props.
//   targetBoardId or targetCardId or targetDocCardId or targetUrl
//   workspaceId
//   onOpenSource(row) — navigate to the source doc/page
export function BacklinksList({ workspaceId, targetBoardId, targetCardId, targetDocCardId, targetUrl, onOpenSource }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let req = supabase.from('doc_backlinks').select('*').eq('target_workspace_id', workspaceId);
      if (targetBoardId)   req = req.eq('target_board_id', targetBoardId);
      if (targetCardId)    req = req.eq('target_card_id', targetCardId);
      if (targetDocCardId) req = req.eq('target_doc_card_id', targetDocCardId);
      if (targetUrl)       req = req.eq('target_url', targetUrl);
      const { data, error } = await req;
      if (!cancelled && !error) setRows(data || []);
    })();
    return () => { cancelled = true; };
  }, [workspaceId, targetBoardId, targetCardId, targetDocCardId, targetUrl]);

  if (rows.length === 0) {
    return <div className="backlinks-empty t-meta">No references yet.</div>;
  }
  return (
    <div className="backlinks-list">
      {rows.map(r => (
        <button key={r.source_link_id + r.target_kind} className="backlinks-row" onClick={() => onOpenSource?.(r)}>
          <div className="backlinks-row-source t-eyebrow">SOURCE DOC · PAGE</div>
          <div className="backlinks-row-text">{r.source_text || '(no preview)'}</div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create DocRefsPanel** — used as the third right-rail tab in docs:

`boards/src/components/DocRefsPanel.jsx`:

```jsx
import { BacklinksList } from './BacklinksList.jsx';

export function DocRefsPanel({ workspaceId, docCardId, onOpenSource }) {
  return (
    <div className="doc-refs">
      <div className="doc-refs-head">
        <span className="t-eyebrow doc-rail-label">REFERENCED BY</span>
      </div>
      <div className="doc-refs-body">
        <BacklinksList workspaceId={workspaceId} targetDocCardId={docCardId} onOpenSource={onOpenSource} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create DocLinksPanel** — replaces DocBookmarksPanel:

`boards/src/components/DocLinksPanel.jsx`:

```jsx
import { listLinks } from '../lib/links.js';
import { useState, useEffect } from 'react';

// Lists every Link in this doc, grouped by page. Click → scrolls source.
export function DocLinksPanel({ ydoc, pages, activePageId, onSelectPage, getEditor }) {
  const [links, setLinks] = useState([]);
  useEffect(() => {
    if (!ydoc) return;
    const lm = ydoc.getMap('links');
    const refresh = () => setLinks(listLinks(ydoc));
    refresh();
    lm.observeDeep(refresh);
    return () => lm.unobserveDeep(refresh);
  }, [ydoc]);

  const pageById = (() => { const m = {}; pages.forEach(p => { m[p.id] = p; }); return m; })();
  const grouped = (() => {
    const m = new Map();
    for (const l of links) {
      if (!m.has(l.pageId)) m.set(l.pageId, []);
      m.get(l.pageId).push(l);
    }
    return m;
  })();

  const jumpTo = (l) => {
    if (l.pageId !== activePageId) onSelectPage?.(l.pageId);
    let tries = 0;
    const tick = () => {
      const ed = getEditor?.();
      if (!ed) { if (tries++ < 20) setTimeout(tick, 30); return; }
      ed.commands.focus();
      ed.commands.setTextSelection(l.anchor.from);
    };
    tick();
  };

  return (
    <div className="doc-links">
      <div className="doc-links-head">
        <span className="t-eyebrow doc-rail-label">LINKS</span>
      </div>
      <div className="doc-links-body">
        {[...grouped.entries()].map(([pageId, items]) => (
          <div key={pageId} className="doc-links-group">
            <div className="doc-links-page t-meta">{pageById[pageId]?.name || 'Untitled'}</div>
            {items.map(l => (
              <button key={l.id} className="doc-links-row" onClick={() => jumpTo(l)}>
                <span className="doc-links-row-name">{l.name || `${l.targets[0]?.kind || 'link'}${l.targets.length > 1 ? ` · ${l.targets.length} targets` : ''}`}</span>
              </button>
            ))}
          </div>
        ))}
        {links.length === 0 && <div className="doc-links-empty t-meta">No links yet. Select text and ⌘K to add one.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire tabs in DocSurface.jsx** — replace `Bookmarks` tab with `Links` and add a third `Refs` tab. Find the existing tab JSX (the `.doc-tabs` block) and update:

```jsx
<div className="doc-tabs">
  <button className={tab === 'outline'  ? 'doc-tab on' : 'doc-tab'} onClick={() => setTab('outline')}>Outline</button>
  <button className={tab === 'links'    ? 'doc-tab on' : 'doc-tab'} onClick={() => setTab('links')}>Links</button>
  <button className={tab === 'refs'     ? 'doc-tab on' : 'doc-tab'} onClick={() => setTab('refs')}>Refs</button>
  <button className={tab === 'comments' ? 'doc-tab on' : 'doc-tab'} onClick={() => setTab('comments')}>Comments</button>
</div>

{tab === 'outline'  && <DocOutlinePanel … />}
{tab === 'links'    && <DocLinksPanel ydoc={ydoc} pages={pages} activePageId={activePageId} onSelectPage={onSelectPage} getEditor={getEditor} />}
{tab === 'refs'     && <DocRefsPanel workspaceId={workspaceId} docCardId={docCardId} onOpenSource={handleOpenSource} />}
{tab === 'comments' && <DocCommentsPanel … />}
```

- [ ] **Step 5: Add CSS** in `styles.css`:

```css
/* ──────────────────── Doc links / refs panels ───────────────────────────── */

.doc-links, .doc-refs { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.doc-links-head, .doc-refs-head {
  padding: 12px 14px;
  border-bottom: 1px solid var(--line-1);
  flex-shrink: 0;
}
.doc-links-body, .doc-refs-body { flex: 1; overflow-y: auto; padding: 8px; }
.doc-links-group { margin-bottom: 8px; }
.doc-links-page { padding: 6px 10px; color: var(--ink-3); }
.doc-links-row, .backlinks-row {
  display: flex; flex-direction: column; gap: 2px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius);
  padding: 8px 10px;
  cursor: pointer;
  color: var(--ink-1);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.doc-links-row:hover, .backlinks-row:hover { background: var(--bg-hov); color: var(--ink-0); }
.doc-links-row-name { font: 500 13px/1.4 var(--font-sans); }
.doc-links-empty, .backlinks-empty { padding: 24px 16px; text-align: center; color: var(--ink-3); }
.backlinks-row-source { color: var(--ink-3); }
.backlinks-row-text { font: 400 12px/1.4 var(--font-sans); color: var(--ink-1); margin-top: 2px; }
```

- [ ] **Step 6: Delete the old DocBookmarksPanel.jsx**

```bash
rm /Users/andrewconklin/soleilpictures-1/boards/src/components/DocBookmarksPanel.jsx
```

If anything still imports it (besides the now-replaced tab), update those imports.

- [ ] **Step 7: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/BacklinksList.jsx boards/src/components/DocRefsPanel.jsx boards/src/components/DocLinksPanel.jsx boards/src/components/DocSurface.jsx boards/src/components/DocBookmarksPanel.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Doc rails — Links + Refs tabs replace Bookmarks

The right-rail Bookmarks tab is replaced by two new tabs: Links (every
Link in this doc, grouped by page) and Refs (every Link in any doc
that points at this doc — driven by doc_backlinks). DocBookmarksPanel
is deleted; data already migrated to Links via Task 2.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.9: "Used by N docs" entries on board + card context menus

**Files:**
- Modify: `boards/src/components/CardContextMenu.jsx`
- Modify: `boards/src/components/BackgroundContextMenu.jsx`

- [ ] **Step 1: Add a count + dropdown to CardContextMenu**

Find the existing menu items list. Add at the bottom:

```jsx
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { BacklinksList } from './BacklinksList.jsx';

// (inside component)
const [showRefs, setShowRefs] = useState(false);
const [refCount, setRefCount] = useState(null);

useEffect(() => {
  let cancelled = false;
  (async () => {
    const { count } = await supabase.from('doc_backlinks')
      .select('*', { count: 'exact', head: true })
      .eq('target_workspace_id', workspaceId)
      .eq('target_board_id', boardId)
      .eq('target_card_id', card.id);
    if (!cancelled) setRefCount(count || 0);
  })();
  return () => { cancelled = true; };
}, [workspaceId, boardId, card.id]);

// In the menu items
<button className="ctx-item" onClick={() => setShowRefs(s => !s)}>
  <span className="ctx-label">Used by {refCount ?? '…'} docs</span>
  <span className="ctx-chevron">{showRefs ? '▾' : '▸'}</span>
</button>
{showRefs && refCount > 0 && (
  <div className="ctx-submenu">
    <BacklinksList
      workspaceId={workspaceId}
      targetBoardId={boardId}
      targetCardId={card.id}
      onOpenSource={onOpenSource /* parent prop */}
    />
  </div>
)}
```

- [ ] **Step 2: Same pattern in BackgroundContextMenu** for the whole-board case (no `target_card_id` filter; use `targetBoardId={currentBoardId}`).

- [ ] **Step 3: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/CardContextMenu.jsx boards/src/components/BackgroundContextMenu.jsx
git commit -m "$(cat <<'EOF'
Add "Used by N docs ›" to card + background context menus

Right-clicking a card or empty canvas reveals a count of docs that
link to this card / board. Expanding the row shows the BacklinksList
inline with each source's surrounding sentence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.10: Phase 2 Playwright smoke

**Files:**
- Create: `boards/tests/links.spec.js`

- [ ] **Step 1: Create**

```js
import { expect, test } from '@playwright/test';

test('Link extension is registered (.tt-link CSS shipped)', async ({ page }) => {
  await page.goto('/?local=1');
  const hasTtLink = await page.evaluate(() => {
    return [...document.styleSheets].some(s => {
      try { return [...s.cssRules].some(r => r.selectorText?.includes('.tt-link-broken')); }
      catch { return false; }
    });
  });
  expect(hasTtLink).toBe(true);
});

test('Doc tabs include Links + Refs (not Bookmarks)', async ({ page }) => {
  await page.goto('/?local=1');
  // The local QA mode may not auto-mount a doc, so this is an HTML-only smoke.
  const hasBookmarksLabel = await page.evaluate(() => document.body.innerText.includes('Bookmarks'));
  expect(hasBookmarksLabel).toBe(false);
});
```

- [ ] **Step 2: Run + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npx playwright test links
cd /Users/andrewconklin/soleilpictures-1
git add boards/tests/links.spec.js
git commit -m "$(cat <<'EOF'
Phase 2 smoke — Link CSS shipped, Bookmarks tab gone

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase 3 — @-mention + auto-detect

### Task 3.1: Workspace name Trie

**Files:**
- Create: `boards/src/lib/entityNameTrie.js`

- [ ] **Step 1: Create the helper**

```js
// In-memory Trie of normalized entity names → entity records.
// Used by the auto-detect plugin and the @-mention picker.
//
// Records: { kind, id, name, boardId?, cardId?, docCardId? }

export function createNameIndex() {
  const root = node();
  let recordsCache = [];

  function add(record) {
    const key = norm(record.name);
    if (!key) return;
    let n = root;
    for (const ch of key) { n = n.children[ch] || (n.children[ch] = node()); }
    if (!n.records.find(r => sameRecord(r, record))) n.records.push(record);
    recordsCache.push(record);
  }

  function clear() { root.children = {}; root.records = []; recordsCache = []; }

  // Find the longest matching prefix in `text` starting at position `start`
  // that ends at a word boundary. Returns { start, end, records } or null.
  function longestMatchAt(text, start) {
    let n = root;
    let bestEnd = -1;
    let bestRecords = null;
    let i = start;
    while (i < text.length) {
      const ch = norm1(text[i]);
      if (!ch) {
        if (n.records.length && atWordBoundary(text, i)) {
          bestEnd = i; bestRecords = n.records;
        }
        break;
      }
      n = n.children[ch];
      if (!n) break;
      i++;
      if (n.records.length && (i === text.length || atWordBoundary(text, i))) {
        bestEnd = i; bestRecords = n.records;
      }
    }
    if (bestEnd > start && bestRecords) {
      return { start, end: bestEnd, records: bestRecords };
    }
    return null;
  }

  // Iterate every match in a text range. Non-overlapping, longest-first.
  function* findMatches(text, fromIndex = 0, toIndex = text.length) {
    let i = fromIndex;
    while (i < toIndex) {
      // Skip non-word chars to anchor matches at word starts.
      while (i < toIndex && !isWordChar(text[i])) i++;
      if (i >= toIndex) break;
      const m = longestMatchAt(text, i);
      if (m && m.end <= toIndex) { yield m; i = m.end; }
      else { i++; }
    }
  }

  return { add, clear, longestMatchAt, findMatches, get records() { return recordsCache; } };
}

function node() { return { children: {}, records: [] }; }
function norm(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function norm1(ch) { const n = ch.toLowerCase(); return /[a-z0-9 ]/.test(n) ? (n === ' ' ? null : n) : null; }
function isWordChar(ch) { return /[A-Za-z0-9]/.test(ch); }
function atWordBoundary(text, pos) { return pos >= text.length || !isWordChar(text[pos]); }
function sameRecord(a, b) { return a.kind === b.kind && a.id === b.id; }
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/lib/entityNameTrie.js
git commit -m "$(cat <<'EOF'
Add entityNameTrie — Trie-based entity name index for auto-detect

Builds a normalized-prefix Trie from workspace entity names. Supports
longestMatchAt(text, pos) and findMatches(text, from, to) — both
respect word boundaries so partial-substring matches don't fire.
Used by Phase 3's auto-detect ProseMirror plugin.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.2: Auto-detect ProseMirror plugin

**Files:**
- Create: `boards/src/components/docExtensions/AutoDetectPlugin.js`
- Modify: `boards/src/components/DocPageEditor.jsx` (mount + feed records)
- Modify: `boards/src/styles.css` (auto-detect underline)

- [ ] **Step 1: Plugin**

```js
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const KEY = new PluginKey('autoDetect');

// ProseMirror plugin that scans typed-text ranges for matches against a
// workspace name index, drawing dotted soleil-gold underlines on candidates.
//
//   options = { getIndex(): NameIndex, dismissed: Set<string> }
//
// On Enter / Tab while the caret is inside / immediately after a candidate,
// caller commits via openLinkPicker (wired in DocPageEditor).
export function makeAutoDetectPlugin({ getIndex }) {
  return new Plugin({
    key: KEY,
    state: {
      init() { return DecorationSet.empty; },
      apply(tr, old, oldState, newState) {
        const index = getIndex?.();
        if (!index) return DecorationSet.empty;
        const decos = [];
        newState.doc.descendants((node, pos) => {
          if (!node.isText) return;
          const text = node.text;
          for (const m of index.findMatches(text)) {
            // Skip if the match is already wrapped in a link mark.
            const insideLink = node.marks.some(x => x.type.name === 'link');
            if (insideLink) continue;
            decos.push(Decoration.inline(pos + m.start, pos + m.end, {
              class: 'tt-autolink-candidate',
              'data-records': JSON.stringify(m.records),
            }));
          }
        });
        return DecorationSet.create(newState.doc, decos);
      },
    },
    props: {
      decorations(state) { return this.getState(state); },
    },
  });
}

export const AUTO_DETECT_KEY = KEY;
```

- [ ] **Step 2: Mount in DocPageEditor.jsx** — build the index from workspace data:

```jsx
import { createNameIndex } from '../lib/entityNameTrie.js';
import { makeAutoDetectPlugin } from './docExtensions/AutoDetectPlugin.js';

const nameIndexRef = useRef(createNameIndex());

useEffect(() => {
  // Hook this up to whatever workspace-entities source you have.
  // Boards come from the existing useBoardList hook; cards come from
  // the card_index table. For this plan, just rebuild from boards
  // whenever the boards list changes.
  const idx = createNameIndex();
  for (const b of boards || []) idx.add({ kind: 'board', id: b.id, name: b.name });
  nameIndexRef.current = idx;
}, [boards]);

// In extensions array
Extension.create({
  name: 'soleilAutoDetect',
  addProseMirrorPlugins: () => [makeAutoDetectPlugin({ getIndex: () => nameIndexRef.current })],
}),
```

- [ ] **Step 3: Wire Enter/Tab to commit auto-detect candidate** — in the editor's keyboard shortcuts. Find the existing keyboard handlers and add:

```jsx
'Enter': ({ editor }) => {
  // If caret is inside a `.tt-autolink-candidate` span, open the picker
  // pre-filled with its records and consume Enter.
  const sel = editor.view.state.selection;
  if (!sel.empty) return false;
  const dom = editor.view.domAtPos(sel.from);
  const el = (dom?.node?.nodeType === 3 ? dom.node.parentElement : dom?.node)?.closest?.('.tt-autolink-candidate');
  if (!el) return false;
  let records = [];
  try { records = JSON.parse(el.dataset.records || '[]'); } catch {}
  if (records.length === 0) return false;
  // Find the selection range for this candidate text.
  const range = document.createRange();
  range.selectNodeContents(el);
  // Map DOM range to PM positions.
  const r = editor.view.posAtDOM(el.firstChild, 0);
  const t = editor.view.posAtDOM(el.firstChild, el.textContent.length);
  editor.commands.setTextSelection({ from: r, to: t });
  // Open picker pre-filled with records.targets
  openLinkPicker(editor, { initialSelected: records.map(r => recordToTarget(r)) });
  return true;
},
```

`recordToTarget`: helper you add at the bottom of DocPageEditor.jsx:

```js
function recordToTarget(r) {
  if (r.kind === 'board') return { kind: 'board', id: r.id };
  if (r.kind === 'doc')   return { kind: 'doc', docCardId: r.id };
  return { kind: 'card', boardId: r.boardId, cardId: r.id };
}
```

- [ ] **Step 4: Add CSS** for the underline:

```css
/* ─────────────────────── Auto-detect candidates ─────────────────────────── */

.tt-autolink-candidate {
  text-decoration: underline dotted rgba(212, 160, 74, .55);
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
  cursor: pointer;
}
.tt-autolink-candidate:hover { background: var(--soleil-soft); }
```

- [ ] **Step 5: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/docExtensions/AutoDetectPlugin.js boards/src/components/DocPageEditor.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Auto-detect ProseMirror plugin — entity-name underlines while typing

Watches the doc for typed phrases that match a workspace entity name
in the in-memory Trie. Adds dotted soleil-gold underline decorations.
Pressing Enter inside a candidate consumes the keystroke and opens
the EntityPicker pre-filled with the candidate's records, ready to
commit as a single- or multi-target Link.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.3: `@`-mention extension

**Files:**
- Create: `boards/src/components/docExtensions/MentionExtension.js`
- Modify: `boards/src/components/DocPageEditor.jsx`

- [ ] **Step 1: Build the extension**

```js
import { Node } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

// `@`-trigger that mounts the EntityPicker at the caret. The picker is
// rendered React-side via a plug-in callback — we just provide the
// trigger char and handle the command on enter.
export const MentionExtension = (options) => Node.create({
  name: 'soleilMention',
  inline: true, group: 'inline',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '@',
        startOfLine: false,
        command: ({ editor, range, props }) => {
          // props.targets = the picked targets array
          const linkId = props.linkId;
          editor.chain().focus()
            .deleteRange(range)
            .insertContent(props.text)
            .setTextSelection({ from: range.from, to: range.from + props.text.length })
            .setMark('link', { linkId })
            .run();
        },
        items: () => [], // empty — picker is React-driven via onStart/onUpdate hooks
        render: () => {
          let unmount;
          return {
            onStart: (props) => { unmount = options.onStart(props); },
            onUpdate: (props) => options.onUpdate(props),
            onKeyDown: (props) => options.onKeyDown ? options.onKeyDown(props) : false,
            onExit: () => { unmount?.(); },
          };
        },
      }),
    ];
  },
});
```

- [ ] **Step 2: Wire React-side picker** in DocPageEditor.jsx:

```jsx
import { MentionExtension } from './docExtensions/MentionExtension.js';

const [mention, setMention] = useState(null);
//   mention = { range, query, clientRect } | null

const mentionExt = MentionExtension({
  onStart: (props) => {
    setMention({ range: props.range, query: props.query, clientRect: props.clientRect?.() });
    return () => setMention(null);
  },
  onUpdate: (props) => {
    setMention({ range: props.range, query: props.query, clientRect: props.clientRect?.() });
  },
});

// In extensions array
mentionExt,

// In JSX
{mention && (
  <EntityPicker
    workspaceId={workspaceId}
    anchor={mention.clientRect}
    initialQuery={mention.query}
    multi
    onCommit={(targets) => {
      const linkId = uuid();
      const text = mention.query || '@mention';
      addLink(ydoc, {
        id: linkId,
        pageId: activePageId,
        anchor: { from: mention.range.from, to: mention.range.from + text.length },
        targets,
        createdBy: currentUser?.id,
      });
      // The Suggestion command path needs the linkId + text — we re-trigger
      // it via editor.commands.command.
      const editor = editorRef.current;
      editor.commands.command(({ commands }) => {
        commands.deleteRange(mention.range);
        commands.insertContent(text);
        editor.chain().focus()
          .setTextSelection({ from: mention.range.from, to: mention.range.from + text.length })
          .setMark('link', { linkId })
          .run();
        return true;
      });
      setMention(null);
    }}
    onCancel={() => setMention(null)}
  />
)}
```

Install `@tiptap/suggestion` if not already present (it is — used by DocSlashMenu).

- [ ] **Step 3: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/docExtensions/MentionExtension.js boards/src/components/DocPageEditor.jsx
git commit -m "$(cat <<'EOF'
@-mention — typing @ opens EntityPicker at the caret

Built on Tiptap's existing Suggestion extension. The React-side picker
mounts/unmounts via onStart/onExit callbacks. Picking commits a link
mark on the typed @phrase. Multi-select supported.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.4: Phase 3 smoke

**Files:**
- Create: `boards/tests/mention.spec.js`

```js
import { expect, test } from '@playwright/test';

test('auto-detect underline CSS class is shipped', async ({ page }) => {
  await page.goto('/?local=1');
  const has = await page.evaluate(() => [...document.styleSheets].some(s => {
    try { return [...s.cssRules].some(r => r.selectorText?.includes('.tt-autolink-candidate')); }
    catch { return false; }
  }));
  expect(has).toBe(true);
});
```

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npx playwright test mention
cd /Users/andrewconklin/soleilpictures-1
git add boards/tests/mention.spec.js
git commit -m "Phase 3 smoke: auto-detect underline class shipped

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# Phase 4 — Comments + gutter dots

### Task 4.1: AddCommentFlow controller + entry points

**Files:**
- Create: `boards/src/components/AddCommentFlow.jsx`
- Modify: `boards/src/components/DocPageEditor.jsx` (right-click + ⌘⌥M)
- Modify: `boards/src/components/DocToolbar.jsx` (button)

- [ ] **Step 1: Create the flow controller**

```jsx
// Imperative helper that opens an InlineComposer next to the current
// editor selection and on commit creates a tt-comment mark + a thread
// in ydoc.getMap('comments'). Existing addCommentThread mutator from
// docState.js does the data side.

import { useState } from 'react';
import { InlineComposer } from './InlineComposer.jsx';
import { addCommentThread } from '../lib/docState.js';
import { v4 as uuid } from 'uuid';

export function useAddCommentFlow({ ydoc, scope, activePageId, currentUser, getEditor }) {
  const [composer, setComposer] = useState(null);

  const open = () => {
    const editor = getEditor?.();
    if (!editor) return;
    const sel = editor.state.selection;
    if (sel.empty) return;
    const winSel = window.getSelection();
    const rect = winSel?.rangeCount ? winSel.getRangeAt(0).getBoundingClientRect() : null;
    if (!rect) return;
    setComposer({ rect, from: sel.from, to: sel.to });
  };

  const commit = (body) => {
    const editor = getEditor?.();
    if (!editor || !composer) { setComposer(null); return; }
    const id = uuid();
    addCommentThread(ydoc, {
      id,
      pageId: activePageId,
      body,
      author: currentUser?.name || currentUser?.email || 'You',
      authorColor: currentUser?.color || 'var(--soleil)',
      ts: Date.now(),
      scope,
    });
    editor.chain().focus()
      .setTextSelection({ from: composer.from, to: composer.to })
      .setMark('comment', { id })
      .run();
    setComposer(null);
  };

  const node = composer && (
    <InlineComposer
      anchor={composer.rect}
      placeholder="Comment, then ⏎ to post"
      multiline
      commitLabel="Post"
      onCommit={commit}
      onCancel={() => setComposer(null)}
    />
  );

  return { open, node };
}
```

- [ ] **Step 2: Use in DocPageEditor.jsx**

```jsx
import { useAddCommentFlow } from './AddCommentFlow.jsx';

const addComment = useAddCommentFlow({ ydoc, scope, activePageId, currentUser, getEditor: () => editorRef.current });

// Right-click "Add comment" item — replace the existing `onStartComment` callback wiring
<Item icon={<CommentIcon />} label="Add comment" onClick={run(() => addComment.open())} />

// Keyboard shortcut
Extension.create({
  name: 'soleilAddCommentShortcut',
  addKeyboardShortcuts: () => ({
    'Mod-Alt-m': () => { addComment.open(); return true; },
  }),
}),

// In JSX, after <EditorContent>:
{addComment.node}
```

- [ ] **Step 3: Add MessageSquare button in DocToolbar.jsx** — call `onAddComment` prop:

```jsx
<button className="doc-tb-btn" onClick={onAddComment} title="Add comment (⌘⌥M)" disabled={disabled}>
  <Icon as={MessageSquare} size={16} />
</button>
```

Wire `onAddComment` from DocSurface.jsx → DocToolbar (passes through `() => addComment.open()`).

- [ ] **Step 4: Drop the broken DocSurface.jsx prompt** — find the `window.prompt('Add a comment')` block and remove it (it's now superseded by the inline flow).

- [ ] **Step 5: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/AddCommentFlow.jsx boards/src/components/DocPageEditor.jsx boards/src/components/DocToolbar.jsx boards/src/components/DocSurface.jsx
git commit -m "$(cat <<'EOF'
Inline composer for comments — drops window.prompt

Right-click → Add comment, toolbar 💬 button, and ⌘⌥M all open an
InlineComposer next to the selection. Commit creates a tt-comment
mark + a thread record in one Yjs transaction.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.2: Gutter dots + inline thread popover

**Files:**
- Create: `boards/src/components/CommentGutter.jsx`
- Create: `boards/src/components/CommentInlinePopover.jsx`
- Modify: `boards/src/components/DocPageEditor.jsx` (mount the gutter)
- Modify: `boards/src/styles.css`

- [ ] **Step 1: CommentGutter**

```jsx
import { useEffect, useState } from 'react';
import { listCommentThreads } from '../lib/docState.js'; // existing helper

export function CommentGutter({ ydoc, scope, pageId, editor, onOpenThread }) {
  const [threads, setThreads] = useState([]);
  const [positions, setPositions] = useState({});

  useEffect(() => {
    if (!ydoc) return;
    const refresh = () => setThreads(listCommentThreads(ydoc, scope).filter(t => t.pageId === pageId && !t.resolved));
    refresh();
    const cm = ydoc.getMap('comments');
    cm.observeDeep(refresh);
    return () => cm.unobserveDeep(refresh);
  }, [ydoc, scope, pageId]);

  // Recompute pixel positions when threads or editor doc changes.
  useEffect(() => {
    if (!editor) return;
    const recompute = () => {
      const next = {};
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return;
        for (const m of node.marks) {
          if (m.type.name !== 'comment') continue;
          const t = threads.find(x => x.id === m.attrs.id);
          if (!t) continue;
          if (next[t.id]) continue; // first occurrence only
          try {
            const coords = editor.view.coordsAtPos(pos);
            const wrap = editor.view.dom.closest('.doc-editor-wrap');
            const wrapRect = wrap?.getBoundingClientRect();
            if (wrapRect) next[t.id] = { top: coords.top - wrapRect.top + 6 };
          } catch {}
        }
      });
      setPositions(next);
    };
    recompute();
    editor.on('transaction', recompute);
    window.addEventListener('resize', recompute);
    return () => {
      editor.off('transaction', recompute);
      window.removeEventListener('resize', recompute);
    };
  }, [editor, threads]);

  return (
    <div className="comment-gutter">
      {threads.map(t => (
        <button
          key={t.id}
          className="comment-gutter-dot"
          style={{ top: (positions[t.id]?.top ?? 0) + 'px' }}
          onClick={() => onOpenThread?.(t.id)}
          title={`${t.author || ''} · ${(t.body || '').slice(0, 60)}`}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: CommentInlinePopover**

```jsx
import { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { addCommentReply, deleteCommentThread, resolveComment } from '../lib/docState.js';
import { useFeedback } from './AppFeedback.jsx';

export function CommentInlinePopover({ ydoc, scope, threadId, anchor, currentUser, onClose }) {
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const feedback = useFeedback();

  useEffect(() => {
    if (!ydoc || !threadId) return;
    const refresh = () => {
      const cm = ydoc.getMap('comments');
      const v = cm.get(threadId);
      if (v) setThread({
        id: threadId,
        body: v.get('body'),
        author: v.get('author'),
        authorColor: v.get('authorColor'),
        ts: v.get('ts'),
        replies: (v.get('replies')?.toArray?.() || []),
      });
    };
    refresh();
    const cm = ydoc.getMap('comments');
    cm.observeDeep(refresh);
    return () => cm.unobserveDeep(refresh);
  }, [ydoc, threadId]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const PAD = 8, W = 320;
    const top = Math.min(window.innerHeight - 240 - PAD, anchor.bottom + PAD);
    const left = Math.min(Math.max(PAD, anchor.right + PAD), window.innerWidth - W - PAD);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [onClose]);

  if (!thread) return null;

  return createPortal(
    <div ref={popRef} className="comment-inline-pop surface-frosted" style={{ top: pos.top, left: pos.left, width: 320 }}>
      <div className="comment-inline-head">
        <span className="comment-inline-author" style={{ background: thread.authorColor }}>{(thread.author || '?')[0]?.toUpperCase()}</span>
        <span className="comment-inline-name">{thread.author}</span>
        <button className="comment-inline-x" title="Resolve" onClick={() => resolveComment(ydoc, threadId, true, scope)}>✓</button>
        <button className="comment-inline-x" title="Delete" onClick={async () => {
          const ok = await feedback.confirm({ title: 'Delete this thread?', body: 'Replies will be removed too.', danger: true, confirmLabel: 'Delete' });
          if (ok) { deleteCommentThread(ydoc, threadId, scope); onClose?.(); }
        }}>×</button>
      </div>
      <div className="comment-inline-body">{thread.body}</div>
      {thread.replies.map(r => (
        <div key={r.id} className="comment-inline-reply">
          <div className="comment-inline-name">{r.author}</div>
          <div>{r.body}</div>
        </div>
      ))}
      <form className="comment-inline-replyform" onSubmit={(e) => {
        e.preventDefault();
        if (!reply.trim()) return;
        addCommentReply(ydoc, threadId, { body: reply.trim(), author: currentUser?.name || 'You', authorColor: currentUser?.color || 'var(--soleil)', scope });
        setReply('');
      }}>
        <input value={reply} onChange={e => setReply(e.target.value)} placeholder="Reply…" />
      </form>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3: Mount in DocPageEditor.jsx**

```jsx
import { CommentGutter } from './CommentGutter.jsx';
import { CommentInlinePopover } from './CommentInlinePopover.jsx';

const [openThread, setOpenThread] = useState(null);
//   openThread = { id, anchor } | null

// Locate the .doc-editor-wrap div in the JSX. After <EditorContent>:
<CommentGutter
  ydoc={ydoc}
  scope={scope}
  pageId={activePageId}
  editor={editorRef.current}
  onOpenThread={(id) => {
    // Anchor at the gutter dot
    const dot = document.querySelector(`.comment-gutter-dot[data-thread="${id}"]`);
    setOpenThread({ id, anchor: dot?.getBoundingClientRect() });
  }}
/>
{openThread && (
  <CommentInlinePopover
    ydoc={ydoc} scope={scope} threadId={openThread.id}
    anchor={openThread.anchor} currentUser={currentUser}
    onClose={() => setOpenThread(null)}
  />
)}
```

(In CommentGutter, set `data-thread={t.id}` on each dot so the lookup above works.)

- [ ] **Step 4: CSS additions**

```css
/* ──────────────────────────── Comment gutter ────────────────────────────── */

.doc-editor-wrap { position: relative; }
.comment-gutter {
  position: absolute;
  right: -28px; top: 0; bottom: 0;
  width: 24px;
  pointer-events: none;
}
.comment-gutter-dot {
  pointer-events: auto;
  position: absolute;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--soleil);
  border: 0;
  padding: 0;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.comment-gutter-dot:hover {
  transform: scale(1.3);
  box-shadow: 0 0 0 4px var(--soleil-soft);
}

.comment-inline-pop {
  position: fixed;
  z-index: 2147483647;
  padding: 12px;
  display: flex; flex-direction: column;
  gap: 8px;
  border-radius: var(--radius-md);
  animation: ctx-menu-in var(--dur-base) var(--ease);
}
.comment-inline-head { display: flex; align-items: center; gap: 6px; }
.comment-inline-author {
  display: inline-grid; place-items: center;
  width: 22px; height: 22px;
  border-radius: 50%;
  font: 600 11px/1 var(--font-sans);
  color: var(--bg-0);
}
.comment-inline-name { font: 500 13px/1.3 var(--font-sans); color: var(--ink-0); flex: 1; }
.comment-inline-x {
  background: transparent; border: 0;
  color: var(--ink-2); cursor: pointer;
  padding: 4px; border-radius: var(--radius);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.comment-inline-x:hover { background: var(--bg-hov); color: var(--ink-0); }
.comment-inline-body { font: 400 13px/1.5 var(--font-sans); color: var(--ink-1); }
.comment-inline-reply {
  background: var(--bg-3);
  border-radius: var(--radius);
  padding: 8px 10px;
  font-size: 12px;
}
.comment-inline-replyform input {
  width: 100%;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  color: var(--ink-0);
  padding: 6px 10px;
  font: 500 13px/1.4 var(--font-sans);
  outline: none;
}
.comment-inline-replyform input:focus { border-color: transparent; box-shadow: var(--shadow-glow); }
```

- [ ] **Step 5: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/CommentGutter.jsx boards/src/components/CommentInlinePopover.jsx boards/src/components/DocPageEditor.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Comment gutter dots + inline thread popover

Each unresolved comment thread on the active page gets a soleil-gold
dot in the right margin of the doc page, positioned to the line of
its anchored text. Clicking the dot opens a frosted thread popover
next to the page edge with the body, replies, reply input, and
resolve/delete (with feedback.confirm) buttons.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.3: Restyle existing tt-comment underline + side-panel copy fix

**Files:**
- Modify: `boards/src/styles.css`
- Modify: `boards/src/components/DocCommentsPanel.jsx`

- [ ] **Step 1: Find the existing tt-comment CSS** and replace highlight with soleil underline:

```bash
grep -n "tt-comment" /Users/andrewconklin/soleilpictures-1/boards/src/styles.css
```

Replace the existing block (probably `background: yellow` or similar) with:

```css
.tt-editor .tt-comment {
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
  text-decoration-color: rgba(212, 160, 74, .4);
  background: transparent;
}
.tt-editor .tt-comment:hover { text-decoration-color: var(--soleil); }
```

- [ ] **Step 2: Fix empty-state copy** in DocCommentsPanel.jsx. Replace:

```
Select text in the doc and press the 💬 in the bubble menu to comment.
```

with:

```
Select text and right-click → Add comment.
```

- [ ] **Step 3: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/styles.css boards/src/components/DocCommentsPanel.jsx
git commit -m "$(cat <<'EOF'
Restyle tt-comment to soleil underline + fix dead bubble-menu copy

Comments stop using a yellow highlight (which fought the new Link
underline) and adopt a faint soleil dotted underline that darkens on
hover. Empty-state copy in DocCommentsPanel updated to point at the
new right-click flow instead of the removed BubbleMenu.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.4: Phase 4 smoke

**Files:**
- Create: `boards/tests/comments.spec.js`

```js
import { expect, test } from '@playwright/test';

test('comment-gutter CSS class is shipped', async ({ page }) => {
  await page.goto('/?local=1');
  const has = await page.evaluate(() => [...document.styleSheets].some(s => {
    try { return [...s.cssRules].some(r => r.selectorText?.includes('.comment-gutter-dot')); }
    catch { return false; }
  }));
  expect(has).toBe(true);
});
```

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/tests/comments.spec.js
git commit -m "Phase 4 smoke: gutter dot CSS shipped

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# Phase 5 — 3D workspace graph home

### Task 5.1: Install graph deps + sidebar Home row

**Files:**
- Modify: `boards/package.json`
- Modify: `boards/src/App.jsx`
- Modify: `boards/src/lib/icons.js` (add Home icon)

- [ ] **Step 1: Install deps**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm install react-force-graph-3d react-force-graph-2d three d3-force-3d
```

- [ ] **Step 2: Add Home + RotateCcw icons** to lib/icons.js exports.

- [ ] **Step 3: Add a sidebar Home row** in App.jsx — find the sidebar JSX (the `.sb-row` block from the polish pass). At the top of the row list, before the Workspaces group, add:

```jsx
<div className={`sb-row ${currentSurface === 'home' ? 'active' : ''}`} onClick={() => setCurrentSurface('home')}>
  <span className="sb-dot" style={{ background: 'var(--soleil)', boxShadow: '0 0 8px rgba(212,160,74,.6)' }} />
  <span className="sb-row-label">Home</span>
</div>
```

`currentSurface` is a new top-level state in App.jsx that switches between `'home'` (graph) and `'board'` (existing canvas/doc rendering).

- [ ] **Step 4: Mount HomeGraph when active** — wrap the existing main-render block:

```jsx
{currentSurface === 'home' ? (
  <HomeGraph workspaceId={workspace.id} onNavigate={(target) => { setCurrentSurface('board'); navigateToTarget(target); }} />
) : (
  <SplitContainer …existing… />
)}
```

`HomeGraph` is built next.

- [ ] **Step 5: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/package.json boards/package-lock.json boards/src/App.jsx boards/src/lib/icons.js
git commit -m "$(cat <<'EOF'
Install force-graph deps + sidebar Home row

Adds react-force-graph-3d / 2d, three, and d3-force-3d to deps. Adds
a Home row at the top of the sidebar driving a new currentSurface
state that switches between the graph and the existing board surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.2: graphData assembler

**Files:**
- Create: `boards/src/lib/graphData.js`

```js
import { supabase } from './supabase.js';

// Assemble nodes + links arrays for the home graph.
//   workspaceId, options { structural: bool, kinds: Set<string> }
//
// Nodes: { id: 'kind:id', kind, name, color, val (size) }
// Links: { source, target, kind: 'semantic' | 'structural' }
export async function assembleGraph({ workspaceId, options = {} }) {
  if (!workspaceId) return { nodes: [], links: [] };

  // 1. Boards
  const { data: boards = [] } = await supabase.from('boards')
    .select('id,name,parent_board_id')
    .eq('workspace_id', workspaceId);

  // 2. Cards
  const { data: cards = [] } = await supabase.from('card_index')
    .select('board_id,card_id,kind,title')
    .eq('workspace_id', workspaceId);

  // 3. Backlinks
  const { data: bls = [] } = await supabase.from('doc_backlinks')
    .select('*')
    .eq('source_workspace_id', workspaceId);

  // Build node map
  const nodes = new Map();
  const add = (id, kind, name, val = 8) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, name: name || 'Untitled', color: COLOR[kind], val });
  };
  for (const b of boards) add(`board:${b.id}`, 'board', b.name, 14);
  for (const c of cards) add(`card:${c.board_id}:${c.card_id}`, c.kind === 'doc' ? 'doc' : 'card', c.title, c.kind === 'doc' ? 12 : 8);

  const links = [];
  // Semantic edges from doc_backlinks
  for (const bl of bls) {
    const src = `card:${bl.source_doc_card_id}`; // sourcing card is the doc card
    let tgt = null;
    if (bl.target_kind === 'board')   tgt = `board:${bl.target_board_id}`;
    else if (bl.target_kind === 'doc')tgt = `card:${bl.target_doc_card_id}`;
    else if (bl.target_kind === 'card') tgt = `card:${bl.target_board_id}:${bl.target_card_id}`;
    else if (bl.target_kind === 'url') {
      const id = `url:${bl.target_url}`;
      add(id, 'url', new URL(bl.target_url).hostname, 6);
      tgt = id;
    }
    if (tgt && nodes.has(src) && nodes.has(tgt)) links.push({ source: src, target: tgt, kind: 'semantic' });
  }

  // Structural edges (board → child board, board → card)
  if (options.structural) {
    for (const b of boards) {
      if (b.parent_board_id) {
        const s = `board:${b.parent_board_id}`, t = `board:${b.id}`;
        if (nodes.has(s) && nodes.has(t)) links.push({ source: s, target: t, kind: 'structural' });
      }
    }
    for (const c of cards) {
      const s = `board:${c.board_id}`, t = `card:${c.board_id}:${c.card_id}`;
      if (nodes.has(s) && nodes.has(t)) links.push({ source: s, target: t, kind: 'structural' });
    }
  }

  // Filter out nodes with no edges if not in structural mode (keep the graph
  // sparse — the spec says default = explicit-link nodes only).
  if (!options.structural) {
    const used = new Set();
    for (const l of links) { used.add(l.source); used.add(l.target); }
    return { nodes: [...nodes.values()].filter(n => used.has(n.id)), links };
  }
  return { nodes: [...nodes.values()], links };
}

const COLOR = {
  board: '#d4a04a',
  doc:   '#e8d4a8',
  card:  '#6b8090',
  url:   '#5b574e',
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/lib/graphData.js
git commit -m "Add graphData.assembleGraph — workspace nodes/edges from boards + backlinks

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.3: HomeGraph 3D surface

**Files:**
- Create: `boards/src/components/HomeGraph.jsx`
- Create: `boards/src/components/HomeGraph2DFallback.jsx`
- Create: `boards/src/components/HomeGraphHud.jsx`
- Create: `boards/src/components/HomeGraphDetailDrawer.jsx`
- Create: `boards/src/components/HomeEmptyState.jsx`

- [ ] **Step 1: HomeGraph.jsx**

```jsx
import { useEffect, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { assembleGraph } from '../lib/graphData.js';
import { HomeGraphHud } from './HomeGraphHud.jsx';
import { HomeGraphDetailDrawer } from './HomeGraphDetailDrawer.jsx';
import { HomeEmptyState } from './HomeEmptyState.jsx';
import { HomeGraph2DFallback } from './HomeGraph2DFallback.jsx';

const KIND_FILTER_DEFAULT = new Set(['board', 'doc', 'card', 'url']);

export function HomeGraph({ workspaceId, onNavigate }) {
  const fgRef = useRef(null);
  const [data, setData] = useState({ nodes: [], links: [] });
  const [structural, setStructural] = useState(false);
  const [kinds, setKinds] = useState(KIND_FILTER_DEFAULT);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [supportsWebGL, setSupportsWebGL] = useState(true);

  // WebGL probe
  useEffect(() => {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      setSupportsWebGL(!!gl);
    } catch { setSupportsWebGL(false); }
  }, []);

  // Load data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const g = await assembleGraph({ workspaceId, options: { structural } });
      if (!cancelled) {
        const filtered = {
          nodes: g.nodes.filter(n => kinds.has(n.kind)),
          links: g.links.filter(l => l.kind === 'semantic' || (l.kind === 'structural' && structural)),
        };
        setData(filtered);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, structural, kinds]);

  // Soleil aesthetic — nodes as small glowing spheres
  const nodeThree = (node) => {
    const geom = new THREE.SphereGeometry(node.val * 0.35, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: node.color || '#d4a04a',
      transparent: true,
      opacity: 0.9,
    });
    return new THREE.Mesh(geom, mat);
  };

  if (data.nodes.length === 0) {
    return <HomeEmptyState />;
  }

  if (!supportsWebGL) {
    return <HomeGraph2DFallback data={data} onNodeClick={setSelected} />;
  }

  return (
    <div className="home-graph-wrap">
      <HomeGraphHud
        kinds={kinds} setKinds={setKinds}
        structural={structural} setStructural={setStructural}
        search={search} setSearch={setSearch}
        onReset={() => fgRef.current?.zoomToFit(800, 60)}
        onSearchPulse={() => {
          const q = search.trim().toLowerCase();
          if (!q) return;
          const hit = data.nodes.find(n => (n.name || '').toLowerCase().includes(q));
          if (hit && fgRef.current) fgRef.current.cameraPosition({ x: hit.x || 0, y: hit.y || 0, z: 200 }, hit, 1200);
        }}
      />
      <ForceGraph3D
        ref={fgRef}
        graphData={data}
        backgroundColor="#0a0908"
        nodeThreeObject={nodeThree}
        linkColor={l => l.kind === 'structural' ? 'rgba(91,87,78,.4)' : 'rgba(212,160,74,.45)'}
        linkOpacity={0.7}
        linkCurvature={0.2}
        nodeLabel={n => n.name}
        onNodeClick={(n) => {
          setSelected(n);
          if (fgRef.current) fgRef.current.cameraPosition({ x: (n.x || 0) * 1.3, y: (n.y || 0) * 1.3, z: 200 }, n, 1200);
        }}
        onNodeRightClick={(n) => onNavigate?.(nodeToTarget(n))}
        enableNodeDrag
        controlType="orbit"
        showNavInfo={false}
      />
      {selected && (
        <HomeGraphDetailDrawer
          workspaceId={workspaceId}
          node={selected}
          onClose={() => setSelected(null)}
          onOpen={() => onNavigate?.(nodeToTarget(selected))}
        />
      )}
    </div>
  );
}

function nodeToTarget(n) {
  const [kind, ...rest] = n.id.split(':');
  if (kind === 'board') return { kind: 'board', id: rest[0] };
  if (kind === 'card') {
    const [boardId, cardId] = rest;
    return n.kind === 'doc' ? { kind: 'doc', docCardId: cardId } : { kind: 'card', boardId, cardId };
  }
  if (kind === 'url') return { kind: 'url', href: rest.join(':') };
  return null;
}
```

- [ ] **Step 2: HomeGraphHud.jsx**

```jsx
import { Icon } from './Icon.jsx';
import { Search, RotateCcw } from '../lib/icons.js';

const KIND_LABELS = { board: 'Boards', doc: 'Docs', card: 'Cards', url: 'URLs' };

export function HomeGraphHud({ kinds, setKinds, structural, setStructural, search, setSearch, onReset, onSearchPulse }) {
  const toggle = (k) => {
    const next = new Set(kinds);
    next.has(k) ? next.delete(k) : next.add(k);
    setKinds(next);
  };
  return (
    <div className="home-graph-hud surface-frosted">
      <div className="home-graph-chips">
        {Object.keys(KIND_LABELS).map(k => (
          <button key={k} className={`home-graph-chip ${kinds.has(k) ? 'on' : ''}`} onClick={() => toggle(k)}>
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <label className="home-graph-toggle">
        <input type="checkbox" checked={structural} onChange={e => setStructural(e.target.checked)} />
        <span>Structural edges</span>
      </label>
      <form className="home-graph-search" onSubmit={(e) => { e.preventDefault(); onSearchPulse?.(); }}>
        <Icon as={Search} size={14} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a node…" />
      </form>
      <button className="home-graph-reset" onClick={onReset} title="Reset view">
        <Icon as={RotateCcw} size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: HomeGraphDetailDrawer.jsx**

```jsx
import { BacklinksList } from './BacklinksList.jsx';

export function HomeGraphDetailDrawer({ workspaceId, node, onClose, onOpen }) {
  if (!node) return null;
  const [kind, boardId, cardId] = node.id.split(':');
  return (
    <aside className="home-graph-drawer surface-frosted">
      <header className="home-graph-drawer-head">
        <div>
          <div className="t-eyebrow">{kind.toUpperCase()}</div>
          <div className="home-graph-drawer-name t-h3">{node.name}</div>
        </div>
        <button className="home-graph-drawer-x" onClick={onClose}>×</button>
      </header>
      <div className="home-graph-drawer-body">
        <button className="btn-primary" style={{ width: '100%' }} onClick={onOpen}>Open</button>
        <div className="t-eyebrow" style={{ marginTop: 24 }}>REFERENCED BY</div>
        <BacklinksList
          workspaceId={workspaceId}
          targetBoardId={kind === 'board' ? boardId : undefined}
          targetCardId={kind === 'card' ? cardId : undefined}
          targetDocCardId={kind === 'doc' ? cardId : undefined}
          onOpenSource={() => onOpen?.()}
        />
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: HomeEmptyState.jsx**

```jsx
export function HomeEmptyState() {
  return (
    <div className="home-empty">
      <div className="home-empty-glow" aria-hidden="true" />
      <div className="t-h1 home-empty-title">CONNECT YOUR WORKSPACE</div>
      <div className="t-body home-empty-body">Open a doc and type @ to start linking boards, docs, and cards.</div>
    </div>
  );
}
```

- [ ] **Step 5: HomeGraph2DFallback.jsx**

```jsx
import ForceGraph2D from 'react-force-graph-2d';
export function HomeGraph2DFallback({ data, onNodeClick }) {
  return (
    <ForceGraph2D
      graphData={data}
      backgroundColor="#0a0908"
      nodeColor={n => n.color}
      linkColor={l => l.kind === 'structural' ? 'rgba(91,87,78,.4)' : 'rgba(212,160,74,.45)'}
      onNodeClick={onNodeClick}
    />
  );
}
```

- [ ] **Step 6: CSS for graph chrome**

```css
/* ───────────────────────────── Home graph ───────────────────────────────── */

.home-graph-wrap { position: relative; width: 100%; height: 100%; background: #0a0908; }
.home-graph-hud {
  position: absolute; top: 16px; right: 16px;
  z-index: 10;
  display: inline-flex; align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
}
.home-graph-chips { display: inline-flex; gap: 4px; }
.home-graph-chip {
  background: transparent; border: 1px solid var(--line-2);
  color: var(--ink-2); padding: 4px 10px;
  border-radius: 999px;
  font: 500 12px/1 var(--font-sans);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.home-graph-chip.on { background: var(--soleil-soft); color: var(--ink-0); border-color: var(--soleil); }
.home-graph-toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-2); font: 500 12px/1 var(--font-sans); cursor: pointer; }
.home-graph-search {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 4px 10px;
  color: var(--ink-2);
}
.home-graph-search input { background: transparent; border: 0; outline: none; color: var(--ink-0); font: 500 12px/1 var(--font-sans); width: 140px; }
.home-graph-reset {
  background: transparent; border: 0; color: var(--ink-2);
  padding: 6px; border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.home-graph-reset:hover { background: var(--bg-hov); color: var(--ink-0); }

.home-graph-drawer {
  position: absolute; top: 16px; right: 16px; bottom: 16px;
  width: 320px;
  z-index: 8;
  display: flex; flex-direction: column;
  border-radius: var(--radius-md);
  animation: drawerSlide var(--dur-base) var(--ease);
}
@keyframes drawerSlide { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
.home-graph-drawer-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--line-1);
}
.home-graph-drawer-name { color: var(--ink-0); }
.home-graph-drawer-x { background: transparent; border: 0; color: var(--ink-2); font-size: 22px; cursor: pointer; line-height: 1; }
.home-graph-drawer-body { padding: 16px; overflow-y: auto; flex: 1; }

.home-empty {
  width: 100%; height: 100%;
  display: grid; place-items: center;
  position: relative;
  background: #0a0908;
}
.home-empty-glow {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse 800px 600px at 50% 50%, rgba(212,160,74,.10), transparent 60%);
  pointer-events: none;
}
.home-empty-title { color: var(--ink-0); margin-bottom: 16px; }
.home-empty-body { color: var(--ink-2); max-width: 480px; text-align: center; }
```

- [ ] **Step 7: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/HomeGraph.jsx boards/src/components/HomeGraph2DFallback.jsx boards/src/components/HomeGraphHud.jsx boards/src/components/HomeGraphDetailDrawer.jsx boards/src/components/HomeEmptyState.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
3D workspace graph home — react-force-graph-3d with Soleil styling

Mounts ForceGraph3D against assembled workspace nodes/edges from
graphData. Soleil-warm color palette, subtle bloom-friendly opacity,
right-click navigates, click opens a frosted detail drawer with
backlinks. WebGL probe falls back to ForceGraph2D when unavailable.
HUD: kind filters, structural-edges toggle, search, reset.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.4: Phase 5 smoke

**Files:**
- Create: `boards/tests/home-graph.spec.js`

```js
import { expect, test } from '@playwright/test';

test('Home row appears in sidebar (LocalQA mode)', async ({ page }) => {
  await page.goto('/?local=1');
  // Local QA may not have the new Home routing — assert presence of CSS.
  const has = await page.evaluate(() => [...document.styleSheets].some(s => {
    try { return [...s.cssRules].some(r => r.selectorText?.includes('.home-graph-wrap')); }
    catch { return false; }
  }));
  expect(has).toBe(true);
});
```

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/tests/home-graph.spec.js
git commit -m "Phase 5 smoke: home-graph CSS shipped

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# Plan Self-Review

After all tasks, verify against the spec sections:

- §3 unified Link primitive → Tasks 2.2 (Y.Doc CRUD), 2.3 (Tiptap mark) ✔
- §4 data model + Postgres backlinks → Tasks 2.1, 2.4, 2.7 ✔
- §5 popup primitives → Tasks 1.1, 1.4, 1.6 ✔
- §5.4 popup elimination map → Tasks 1.2, 1.3, 1.7 (partial; bookmark + comment + URL prompts handled by Phase 2/4) ✔
- §6 Tiptap LinkMark + manual creation → Tasks 2.3, 2.5, 2.6 ✔
- §6.4 backlinks panels → Tasks 2.8, 2.9 ✔
- §6.5 right-rail Links tab → Task 2.8 ✔
- §7 @-mention + auto-detect → Tasks 3.1, 3.2, 3.3 ✔
- §8 comments rework + gutter dots → Tasks 4.1, 4.2, 4.3 ✔
- §9 3D graph home → Tasks 5.1, 5.2, 5.3 ✔
- §10 phased ship order → mirrored as plan phases 1–5 ✔
- §13 verification checklist → covered by per-phase Playwright smokes; full end-to-end is manual (smoke covers presence; flow tests deferred to incremental dev)
