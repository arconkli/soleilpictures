# Soleil Boards — doc linking, comments, and the workspace graph

**Date:** 2026-05-04
**Status:** Design approved, awaiting written-spec review
**Owner:** Andrew Conklin
**Builds on:** `2026-05-04-boards-luxury-polish-design.md` (visual tokens, frosted overlays, Soleil branding) — already shipped on `polish/luxury-rebrand`.

---

## 1. Goal

Make the Boards docs feel like the connective tissue of the workspace. Every meaningful word in a doc should be able to point at any other thing — a board, a card, a doc page, a URL, even multiple of those at once — and the things that get linked to should know they were linked. The home page becomes a beautiful 3D constellation of these connections. No browser dialogs anywhere along the way.

**Success criteria**

- Any text in any doc can be linked to one or many entities in the workspace, via right-click, ⌘K, or by typing the entity's name.
- Every entity (board, doc, card) shows a "Referenced by" surface listing every Link that points at it, with the surrounding sentence as context.
- Comments are added inline (no `window.prompt`), are visually findable from the page margin, and can be expanded inline next to the text.
- The workspace home page is a 3D node graph that reads as cinematic and intentional, navigable to any entity in the workspace.
- Zero `window.prompt` / `window.confirm` / `window.alert` remain in the codebase.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Bookmarks | Replaced by **Links** — text → 1+ targets, anywhere in workspace + URLs + intra-doc positions |
| Backlinks | Yes — every entity surfaces a "Referenced by" list |
| Linking UX | Right-click + ⌘K + `@`-mention syntax + deterministic auto-detect on typed phrases |
| Multi-target | Single → inline navigation. Multi → frosted mini-gallery popover with each target's preview |
| AI | **Out of scope** for this spec — deterministic name-matching only; AI is a future spec |
| Comments | Polish + Notion-style gutter dots in the page margin, inline composer entry |
| Home graph | Default = explicit-link nodes only; toggle to add structural edges; **3D**; prioritize beauty over information density |
| Browser popups | All eliminated — replaced by inline composers, custom confirm primitive, and toast notifications |
| Right-click | Entry point for the new linking + commenting flows; existing custom doc context menu gets wired through |

## 3. Conceptual model

The whole feature centers on one new primitive: **the Link.**

```
Link {
  id           — uuid
  sourceText   — the text in the doc this Link wraps
  sourcePage   — { workspaceId, docCardId, pageId, range:[from,to] }
  targets      — Target[]   (1 or many)
}

Target =
  | { kind: 'board',   id }
  | { kind: 'card',    boardId, cardId }
  | { kind: 'doc',     docCardId, pageId? }
  | { kind: 'docPos',  docCardId, pageId, anchor }    // intra-doc jumps
  | { kind: 'url',     href }
```

Every UI surface is a different *view* of this shared primitive:

- **Right-rail "Links" tab** — every Link in the current doc, grouped by page.
- **"Referenced by" backlinks** — query: every Link whose targets include `this entity`.
- **Workspace 3D graph** — query: every Link in the workspace, rendered as nodes + edges.
- **`@`-mention** — UI for *creating* a Link with one keystroke.
- **Auto-detect underline** — UI for *suggesting* a Link based on name match.

**Migration:** existing bookmarks (intra-doc anchors with names) become Links of kind `docPos`, keeping their IDs so existing references stay intact. The existing URL `link` mark becomes Links of kind `url`. The old `ydoc.getMap('bookmarks')` is deleted after a successful one-time migration.

## 4. Data model & storage

### Per-doc Y.Doc additions

```
ydoc.getMap('links')       — Y.Map<linkId, Y.Map>   — all Links anchored in this doc
ydoc.getMap('linkIndex')   — Y.Map<entityKey, Set>  — local "this doc references X" cache
```

A `link` value is a Y.Map with:

```
{
  id, name?, createdAt, createdBy,
  pageId,                   // which page in this doc
  anchor: { from, to },     // ProseMirror positions (drift-tolerant)
  targets: Y.Array<target>  // [{kind, …}, {kind, …}, …]
}
```

### Inline rendering — Tiptap mark

A new `link` mark replaces the existing URL-only `Link` extension. Single attribute: `linkId`. The mark renderer (a Tiptap nodeView) reads the matching record from `ydoc.getMap('links')` and styles itself based on target count and kind. Edits to a Link's targets sync automatically because the mark just stores the id.

### Workspace-scoped backlinks index — Postgres

The Postgres table is the source of truth for cross-doc queries (so opening a board can show its backlinks even if the source doc isn't loaded). Migration:

```sql
create table doc_backlinks (
  source_workspace_id uuid not null,
  source_doc_card_id  uuid not null,
  source_page_id      uuid not null,
  source_link_id      uuid not null,
  target_kind         text not null,       -- 'board'|'card'|'doc'|'docPos'|'url'
  target_workspace_id uuid,
  target_board_id     uuid,
  target_card_id      uuid,
  target_doc_card_id  uuid,
  target_page_id      uuid,
  target_url          text,
  source_text         text,                -- snippet for backlink display
  updated_at          timestamptz default now(),
  primary key (source_link_id, target_kind, target_board_id, target_card_id, target_doc_card_id, target_page_id, target_url)
);
create index doc_backlinks_target_board on doc_backlinks (target_workspace_id, target_board_id) where target_board_id is not null;
create index doc_backlinks_target_doc   on doc_backlinks (target_workspace_id, target_doc_card_id) where target_doc_card_id is not null;
create index doc_backlinks_target_card  on doc_backlinks (target_workspace_id, target_board_id, target_card_id) where target_card_id is not null;

alter table doc_backlinks enable row level security;
create policy "doc backlinks read by workspace members" on doc_backlinks for select
  using (is_workspace_member(source_workspace_id) or is_workspace_member(target_workspace_id));
create policy "doc backlinks write by workspace members" on doc_backlinks for all
  using (is_workspace_member(source_workspace_id))
  with check (is_workspace_member(source_workspace_id));
```

Each doc, on debounced save (~2s after last edit), upserts its current Links into this table — full-replace semantics for `(source_doc_card_id, source_page_id)` so deletes propagate.

### Comments

Existing `tt-comment` mark + `ydoc.getMap('comments')` Y.Map stay as-is. Migration is the *entry composer* and the new *gutter dot* layer; data shape unchanged.

### Yjs sync

All link data is per-doc-card so it rides on the existing realtime channel — no new transport. The Postgres backlinks table is updated **client-side** by whichever client triggers the doc-save (debounced 2s after last edit, full-replace upsert per `(source_doc_card_id, source_page_id)` via a new `boardsApi.updateBacklinks(pageId, links[])` helper). RLS on `doc_backlinks` ensures only workspace members can write. Edge-function ownership is a future optimization once write contention becomes measurable.

## 5. Custom popup primitives (Phase 1)

Three new UI pieces, each replacing browser-native dialogs.

### 5.1 `feedback.confirm({title, body, danger?, confirmLabel, cancelLabel})`

Extends the existing `useFeedback` API in `AppFeedback.jsx`. Frosted-glass modal using the existing `.modal-overlay` / `.modal-panel` classes. Returns `Promise<boolean>`. Replaces every `window.confirm()` in the codebase. The danger variant renders the confirm button in `--ink-error` instead of `--ink-0`.

### 5.2 `<InlineComposer/>`

Anchored popover for short-text input (comments, link rename, bookmark name). Positioned via `getBoundingClientRect()` of an anchor element with viewport-aware placement (reuse the logic from `FontPickerDropdown`).

```jsx
<InlineComposer
  anchor={selectionRect}
  placeholder="Comment, then ⏎ to post"
  multiline
  initialValue=""
  onCommit={(text) => …}
  onCancel={() => …}
  busy={…}
/>
```

`.surface-frosted` mini-panel + Aileron 13px input + soleil-glow focus ring + a "post" button. Escape cancels; Enter commits (Shift+Enter newline if `multiline`).

### 5.3 `<EntityPicker/>`

The single primitive behind: right-click → "Link to…", ⌘K, the disambiguation popover, and the `@`-mention popover.

```jsx
<EntityPicker
  workspaceId
  query                       // controlled
  onQueryChange
  filter? = ['board','card','doc','url']
  multi? = false              // false → single click commits, true → checkboxes + Done
  recents? = true             // pin recent picks at top
  onCommit={(targets) => …}
  onCancel={() => …}
/>
```

Render: `.surface-frosted` panel + soleil-glow search input + results grouped by entity type with Brandon eyebrow labels (BOARDS, DOCS, CARDS, RECENT). Each result row: name + cover-tint dot + breadcrumb context ("Strategy / Q3"). Single mode commits + closes on click. Multi mode shows checkboxes and a "Done · 3 selected" footer button.

The result list is built from a workspace-wide search hitting Postgres via existing `boardsApi`, debounced 200ms per keystroke. Phase 1 adds a lightweight `entity_search` view (`boards UNION docs UNION cards`) so we don't pay 3 round-trips per keystroke.

### 5.4 Browser popup elimination map

| Old call | Replacement |
|---|---|
| `window.alert('Image upload failed: …')` (`DocPageEditor.jsx:83`) | `feedback.toast({ kind: 'error', body: … })` |
| `window.prompt('Bookmark name', …)` (`DocPageEditor.jsx:121`, `DocSurface.jsx:202`) | `<InlineComposer/>` next to the selection |
| `window.prompt('URL', previous)` (`DocPageEditor.jsx:347`, `DocToolbar.jsx:257`) | `<EntityPicker/>` (or its URL-mode variant) |
| `window.prompt('Add a comment')` (`DocSurface.jsx:82`) | `<InlineComposer multiline/>` (Phase 4) |
| `window.prompt('Board ID to embed')` (`DocPageEditor.jsx:98`) | `<EntityPicker filter={['board']}/>` |
| `window.confirm('Delete this comment thread?')` (`DocCommentsPanel.jsx:109`) | `feedback.confirm({ danger: true, … })` |
| `window.confirm('Delete "..." and any sub-pages?')` (`DocPageTree.jsx:53`) | `feedback.confirm({ danger: true, … })` |

After Phase 1, a CI grep gates that no `window.prompt`, `window.alert`, or `window.confirm` references remain in `boards/src/`.

## 6. The Link primitive + manual creation (Phase 2)

### 6.1 New Tiptap `link` mark

Replaces the URL-only `Link` extension from `@tiptap/extension-link`. Single attribute: `linkId`.

The mark's `renderHTML` produces `<span class="tt-link" data-link-id={id}>`. A React companion (mounted at editor level) decorates these spans on every transaction, querying `ydoc.getMap('links')` for the live target list and applying the right visual treatment:

| Targets | Render |
|---|---|
| 1, kind `url` | `text-decoration: underline; color: var(--ink-1);` hover → `var(--soleil)`. `target="_blank"`. |
| 1, internal | `color: var(--soleil); text-decoration: underline; text-underline-offset: 3px;` Click navigates. |
| 2+ | Same underline + a small `³` badge inline (`<sup>` styled as a soleil-soft pill). Click → mini-gallery popover. |

Hover any link → soleil-soft halo + tooltip showing target name(s) + a tiny `↗` icon.

### 6.2 Multi-target mini-gallery popover

When the count badge is clicked, a frosted-glass popover opens beneath the link. Inside: a 3-column grid of preview tiles, one per target. Each tile uses the entity's *native preview*:

- **Board** — its cover gradient + title + breadcrumb + member dots
- **Card** — the card's actual rendered preview at thumbnail scale (palette swatches, image thumb, note excerpt, doc first-page text — same renderers used in `BoardThumbnail.jsx` today)
- **Doc page** — first-page text snippet + page name
- **URL** — favicon (via Google's favicon service `https://www.google.com/s2/favicons?domain=…&sz=32`) + title + hostname

Click any tile → navigate. Esc / outside-click → close. Tiles are draggable onto the canvas via the existing `INBOX_MIME` drag protocol.

### 6.3 Manual link creation flows

Three entry points all converge on `<EntityPicker/>`:

1. **Select text → right-click → "Link to…"** — opens picker. Multi mode is reachable via shift-click in the picker.
2. **Select text → ⌘K** — same, keyboard.
3. **Select text → toolbar Link button** (Lucide Link icon, already there) — same.

If the existing selection already has a Link mark, the picker opens pre-populated with that link's targets and the commit button reads "Update". A "Remove link" button appears in the popover footer.

For URL-only quick-link: the picker has a top-of-list "Paste URL" row. If the clipboard contains a URL, it pre-fills.

### 6.4 Backlinks panel — per entity

Every entity gets a "Referenced by" surface, rendered per context:

- **Board / canvas** — appears in the canvas's right-click context menu under "Used by N docs ›"; click opens an inline popover listing source docs with the surrounding sentence.
- **Card on canvas** — same pattern, in the card's right-click menu.
- **Doc card** — appears in the right-rail as a new third tab "Refs" alongside Outline / Comments. Lists every source.
- **Doc page** — same as doc card, scoped to the active page.

All "Referenced by" rows use the same shape:

```
[source-doc title · page name]
"…the surrounding sentence with the linked text bolded."
[author dot] last edited 2h ago
```

Click a row → opens the source doc + scrolls to the link.

### 6.5 Right-rail "Links" tab

Replaces the old "Bookmarks" tab in the doc rails. Lists every Link in the current doc grouped by page. Each row: source text + small icon for target type + first target's name (with `+N more` if multi). Click → scroll to source. Hover → mini preview of target.

## 7. `@`-mention + auto-detect (Phase 3)

### 7.1 `@`-trigger inline picker

Built on Tiptap's existing `Suggestion` extension (already used for `/`-slash). When the user types `@`, an `<EntityPicker filter={['board','doc','card']}/>` opens at the caret. Each character narrows the list. Enter / click commits — the `@text` becomes a single-target Link to the picked entity. Escape cancels and leaves the literal text "@whatever" alone.

Multi mode: `Shift+Enter` or `Shift+Click` switches to checkbox mode; `Done` commits as a multi-target Link.

### 7.2 Deterministic auto-detect

A new ProseMirror plugin watches the doc for typed phrases that match an entity name in the workspace.

**Index** — workspace entity names (boards, docs, cards) load into a Trie keyed by lowercase normalized text, kept fresh by subscribing to the workspace entity list. Renames update the Trie.

**Scan** — on each transaction, the plugin walks only the modified ranges (not the whole doc) and finds longest-matching name spans inside the user's recently typed text. Matches must end at a word boundary.

**Decoration** — for each match, a `widget` decoration draws a faint dotted soleil-gold underline (`text-decoration: underline dotted rgba(212,160,74,.5)`) beneath the phrase + a tiny ghost label `(↵ link)` at the line end (rendered as a CSS `::after` on the line's last text node container).

**Confirmation** — `Enter` or `Tab` while caret is inside / immediately after a matched phrase commits the auto-link via the same flow as `@`-mention. Any other typing dismisses the underline.

**Disambiguation** — if the matched phrase has multiple matches, the picker (`<EntityPicker multi/>`) slides in beneath the underline with the candidates pre-listed. Enter alone commits the highlighted single match; "Select all + Done" commits multi.

**Persistence of dismissal** — once dismissed (by typing past), the same phrase isn't re-suggested in the same paragraph for 30 seconds.

### 7.3 Edge cases

- Inside an existing Link mark — auto-detect skips the span.
- Inside code blocks / inline code — skip.
- Match contains `@` — treat as already-mentioned, skip.
- Workspace entity gets renamed after a Link exists — the Link still works (it stores entity IDs, not names); the *displayed* source text in the doc isn't auto-renamed.
- Workspace entity gets deleted — the Link mark renders in `--ink-3` with strikethrough; click → `feedback.confirm` "This board no longer exists. Remove link?"

### 7.4 Visual states

| State | Treatment |
|---|---|
| Auto-detect candidate (1 match) | dotted soleil underline + ghost `(↵ link)` at line end |
| Auto-detect candidate (multi-match) | same underline + tiny soleil dot indicator on the line |
| Committed Link | solid soleil underline (Section 6.1) |
| Dismissed | nothing — underline disappears, suppressed for 30s in this paragraph |

## 8. Comments rework + gutter dots (Phase 4)

### 8.1 New entry points (BubbleMenu was removed in the polish pass)

- Select text → right-click → **Add comment** (already in `DocEditorContextMenu`; rewire onclick).
- Select text → toolbar `<Icon as={MessageSquare}/>` button (new — beside the existing Bookmark/Link buttons).
- `⌘⌥M` shortcut while text is selected.

All three open the new inline composer.

### 8.2 Inline composer

Uses `<InlineComposer multiline/>` from Section 5.2, anchored to the right edge of the selection. 320px frosted card. The first commit creates a `tt-comment` mark on the selection (existing extension — no change) + a thread record in `ydoc.getMap('comments')` (existing schema — no change). Author/color come from awareness state.

### 8.3 Gutter dots

A new layer rendered absolutely-positioned over the right margin of `.doc-editor-wrap` (between page edge and the right doc-rail). For each comment thread anchored on the page:

- Draw an 8px soleil-gold dot at the vertical position of `editor.view.coordsAtPos(commentRange.from)`.
- Adjacent dots on the same line stack into a small badge (`²`, `³`).
- Click → open **inline thread popover** (frosted card pinned to the dot, showing thread body + replies + reply input + resolve/delete buttons). Same data and same actions as the side panel.
- Hover → soleil-soft halo + tooltip "2 replies · 5d ago".

Resolved threads render as a hollow soleil-ring instead of a filled dot. Toggleable in the side panel and inline popover.

### 8.4 Visual treatment of commented text

The existing `tt-comment` mark renders as a yellow highlight today. Refresh to a faint soleil-gold underline (`text-decoration: underline; text-decoration-color: rgba(212,160,74,.4); text-decoration-thickness: 1px`) so it doesn't fight the new Link underline (which is solid soleil). On hover, underline darkens to full soleil + the matching gutter dot pulses once.

If text spans both a Link AND a comment: Link wins on color (solid soleil); the comment manifests only as the gutter dot.

### 8.5 Delete + resolve

- Delete uses `feedback.confirm({ danger: true, title: 'Delete this thread?' })`.
- Resolve toggles via the existing `resolveComment` mutator. Resolved threads disappear from the gutter unless "Show resolved" is on in the side panel.

### 8.6 Side panel updates

- Empty-state copy: "Press the 💬 in the bubble menu to comment" → "Select text and right-click → Add comment".
- Each thread card gets a small "Open inline" button that scrolls + opens the inline popover.
- @-mentions in comment bodies are NOT in this phase (deferred to a notifications spec).

## 9. The 3D workspace graph home (Phase 5)

### 9.1 The surface

A new top-level surface — the workspace's home. Sidebar gets a new "Home" row at the very top with a glowing soleil dot. Click → graph view fills the main pane (sidebar + topbar persist). The graph is what you see when you sign in. Current "open last-active board" behavior moves to a "Recent" row beneath Home.

### 9.2 Tech choice

`react-force-graph-3d` (built on three.js + d3-force-3d). MIT-licensed, ~30KB gzipped + three.js (~150KB). Battle-tested for this use case. We focus on visual styling rather than rebuilding physics.

```bash
npm install react-force-graph-3d three d3-force-3d
```

### 9.3 Visual treatment

- **Background** — deep warm-dark `#0a0908` with a subtle three.js starfield of ~400 ambient soleil-warm dust particles drifting at <1% opacity.
- **Camera** — orbit-style. Drag rotates around the workspace centroid; scroll zooms; right-drag pans. Auto-rotate at 0.05°/s when idle for >5s. Click any node halts auto-rotate + eases camera to that node's neighborhood.
- **Lighting** — one warm soleil-gold key light at top-front + a dim cool fill from the back. Bloom post-processing for the luminous feel.
- **Nodes** — spheres, 8–24px radius (more references = larger). Color by entity type:
  - Board → `#d4a04a` (soleil-gold)
  - Doc → `#e8d4a8` (warm cream)
  - Card → `#6b8090` (cool slate)
  - URL → `#5b574e` (ink-3)
  - Hovered → bright cream + soleil-glow shader
- **Labels** — entity name in Brandon Grotesque, billboard-rendered (always faces camera). Visible only above a zoom threshold.
- **Edges** — curved Bézier tubes, 1.5px thick, `--soleil` at 25% opacity. Brighter highlight when either endpoint is hovered. Multi-target Links draw N edges from the source. Structural-edges (when toggled on) render in `--ink-3` at 15% opacity to distinguish from semantic Links.

### 9.4 Interactions

- **Hover node** — soleil glow + label fades in + tooltip card showing entity meta + "12 references".
- **Click node** — camera eases to it (1.2s ease-out), then a 300px slide-in detail drawer (right-side, frosted glass) shows the entity's "Referenced by" list.
- **Double-click node** — navigate to the entity (closes graph, opens canvas/doc).
- **Drag a node** — sticks where dropped (manual layout overrides physics for that node).

### 9.5 Top-right HUD

Floating frosted-glass control strip:
- Filter chips (Boards / Docs / Cards / URLs) — toggle node types in/out.
- "Structural edges" toggle (the option C decision — adds board↔card and doc↔page edges).
- Search input — typing a name pulses the matching node and centers the camera on it.
- Reset view button (Lucide RotateCcw).

### 9.6 Empty / first-time state

When the workspace has no Links yet, the graph shows just the entity nodes drifting gently apart with a cinematic centered Brandon overlay: *"Connect your boards and docs to see your workspace come alive"* + a "Try it: open a doc and type @" CTA. As soon as the first Link exists, the message fades.

### 9.7 Performance

- Frame target: 60fps with up to 500 nodes / 2000 edges. Beyond that, switch to a 2D fallback automatically.
- Node + edge geometries are instanced (single draw call per type).
- Position cache persisted to localStorage so reopening the graph snaps back to where you left it instead of re-running physics.
- WebGL availability check at mount — if missing, render a 2D fallback (`react-force-graph-2d`) with the same controls.

## 10. Phased implementation order

Each phase ships independently and is usable on its own.

| Phase | Scope | Approx duration |
|---|---|---|
| **1** | Custom popup primitives — `feedback.confirm`, `<InlineComposer/>`, `<EntityPicker/>`. Replace every `window.prompt`/`alert`/`confirm` in the codebase. Add `entity_search` Postgres view + RLS. | 1.5 days |
| **2** | The Link primitive — new Tiptap mark, manual link creation via right-click + ⌘K + toolbar, multi-target picker, mini-gallery popover, backlinks Postgres table + client-side debounced upsert via `boardsApi.updateBacklinks`, Refs tab on doc rail, "Used by" entries on board/card right-click menus. Migration of existing bookmarks → Links of kind `docPos`. | 4 days |
| **3** | `@`-mention via Tiptap Suggestion extension + the deterministic auto-detect ProseMirror plugin + Trie-based name index. Disambiguation popover for multi-match. | 2 days |
| **4** | Comments rework — inline composer (replaces `window.prompt`), gutter dot layer with inline thread popover, comment underline restyle, side-panel copy fixes, custom delete confirm. | 2 days |
| **5** | 3D workspace graph home — sidebar Home row, graph surface, force-directed render with Soleil styling, HUD controls, detail drawer, 2D fallback. | 3 days |

**Total: ~12.5 days.** Each phase boundary ships a usable improvement.

## 11. Out of scope (explicit deferrals)

- **AI / LLM-assisted linking** — fuzzy matches, plural handling, semantic suggestions. Future spec; the deterministic auto-detect from Phase 3 covers ~80% of the value.
- **Notifications** — `@person` mentions in comments, "you were referenced in X" pings. Needs its own notifications subsystem.
- **Mobile graph view** — the 3D graph is desktop-only in this spec. Mobile shows a 2D list-style fallback.
- **Cross-workspace links** — Links can only target entities inside the same workspace. Cross-workspace is a future feature.
- **Link analytics** — most-linked entities, dead links, etc. Future.

## 12. Risks & open questions

- **Postgres backlinks consistency** — if a doc edits race with the debounced backlinks upsert, briefly stale data is possible. Mitigation: every upsert is a full replace for that `(source_doc_card_id, source_page_id)` so eventual consistency holds. If staleness becomes visible (e.g. a deleted Link still showing as a backlink), drop in an edge function that owns the upsert from doc updates.
- **Trie size** — for huge workspaces with 10k+ entity names, the Trie eats memory. Mitigation: scope the index to the active workspace + lazy-load on demand. If still problematic, switch to `flexsearch` or `fuse.js` and accept the perf trade-off.
- **3D graph performance with many Links** — 500-node target may be optimistic for some workspaces. Mitigation: 2D fallback above the threshold + node clustering as a v1.5 enhancement.
- **`@`-mention conflict with existing `@-handle` syntax** — none currently exists; we own the `@` glyph. Future "@person" notifications would need to share the trigger with a person/entity disambiguator inside the picker.
- **Drift-tolerant anchors after big edits** — ProseMirror positions can drift past document end. Existing `DocBookmarksPanel` already clamps; new Link mark inherits this via Tiptap mark mapping (positions auto-update when ranges before them change). Edge case: deleting the entire range removes the mark cleanly via Tiptap's mark logic.

## 13. End-to-end verification

After Phase 5, all of the following must be true on a fresh workspace:

1. Sign in → land on the 3D graph (empty state with "type @ to start" CTA).
2. Open a doc card from the sidebar → existing doc surface loads, with the right-rail showing Outline / Refs / Comments tabs (no Bookmarks tab).
3. Type a sentence containing the literal name of a board in the workspace → faint soleil underline appears under that phrase + `(↵ link)` ghost label.
4. Press Enter → underline becomes solid soleil; the right-rail "Links" tab now shows that Link.
5. Right-click some other text → "Link to…" → picker opens → search → pick 3 boards via shift-click → "Done · 3 selected" → multi-target Link with `³` badge.
6. Click the `³` badge → mini-gallery opens with 3 board covers as preview tiles.
7. Open one of the linked boards → its right-click context menu now shows "Used by 1 doc ›" → click → see the source doc + the surrounding sentence.
8. Select text in the doc → toolbar 💬 → inline composer opens → type comment → Enter → soleil gutter dot appears in the page margin.
9. Click the gutter dot → inline thread popover opens with reply input.
10. Right-click the comment in the side panel → Delete → custom confirm modal (no `window.confirm`).
11. `grep -rE "window\\.(prompt|alert|confirm)" boards/src/` returns zero matches.
12. Navigate to the home graph → see your boards + docs as nodes, edges connecting the docs to the boards they link to. Click a node → camera eases to it. Toggle "Structural edges" → board↔card edges fade in.
13. With light theme on, repeat the smoke at viewport widths 1440, 1024, 768.
