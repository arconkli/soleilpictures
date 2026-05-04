# Soleil Boards — luxury polish & branding

**Date:** 2026-05-04
**Status:** Design approved, awaiting written-spec review
**Owner:** Andrew Conklin
**Scope:** Visual + UX polish across the entire Boards app, plus first-class Soleil Pictures branding. No backend / data / Tiptap-behavior changes.

---

## 1. Goal

Boards should feel like a luxury, premium product — simple and immediate to use, but capable of complex work. It should read as a **minimalist sibling** of `soleilpictures.com`: same studio's hand, but its own visual world tuned for working in. The marketing site stays cinematic; Boards stays restrained.

**Success criteria**
- A first-time user lands on the auth screen and immediately recognises this as a Soleil product.
- Every brand-bearing surface (auth, sidebar brand block, board grid, empty states) feels editorial and intentional, not placeholder.
- Working surfaces (canvas, doc editor body, list view) read as calm and unobtrusive — the chrome gets out of the way.
- The app reads as built by one team, not assembled — typography, spacing, motion, iconography are consistent everywhere.

## 2. Design decisions (locked)

| Decision | Choice |
|---|---|
| Relationship to marketing | **Completely separate visual world** — minimalist sibling, not a port |
| Theme | **Warm dark default** (light theme stays available, secondary) |
| Typography | **Aileron** (UI/body) + **Brandon Grotesque** (brand moments only). Loaded from existing Adobe Typekit kit. |
| Accent | **Monochrome chrome + single warm soleil-gold** (`#d4a04a`) for focus, selection, active state, the mark |
| Atmosphere | **Restrained atmospheric** — flat working surfaces, frosted glass on overlays, soleil glow on auth + brand block |
| Implementation approach | **Approach 2** — design tokens + chrome rebuild. Brand-bearing surfaces get rebuilt; working surfaces inherit tokens. |

## 3. Brand foundations (design tokens)

All tokens live in `src/styles.css` `:root` (warm-dark default) and `[data-theme='light']`.

### Palette — warm dark

| Token | Hex | Use |
|---|---|---|
| `--bg-0` | `#0a0908` | Page (deepest, slight warm shift from pure black) |
| `--bg-1` | `#111110` | Sidebar |
| `--bg-2` | `#15140f` | Canvas (warmer than sidebar — desk vs. wall) |
| `--bg-3` | `#1c1b18` | Card |
| `--bg-4` | `#252320` | Card emphasis / hover |
| `--bg-hov` | `#1a1916` | Row hover |
| `--bg-act` | `#211f1b` | Row active |
| `--line-1` | `#211f1c` | Subtle dividers |
| `--line-2` | `#2c2a26` | Card edge |
| `--line-3` | `#3a3732` | Emphasized edge |
| `--ink-0` | `#f5f1e8` | Primary text (warm cream, not pure white) |
| `--ink-1` | `#d5cfc1` | Secondary |
| `--ink-2` | `#8a857a` | Tertiary |
| `--ink-3` | `#5b574e` | Quaternary |
| `--ink-4` | `#3d3a34` | Disabled |
| `--soleil` | `#d4a04a` | Single warm accent — focus, selection, active dot, mark |
| `--soleil-soft` | `rgba(212,160,74,.14)` | Soft halo / selection bg |
| `--soleil-glow` | `0 0 24px rgba(212,160,74,.18)` | Atmospheric glow ring |

### Palette — light theme (secondary)

Same tokens, inverted bg/ink, soleil darkened to `#a37822` for contrast on cream.

| Token | Hex |
|---|---|
| `--bg-0` | `#f5f1e8` |
| `--bg-1` | `#faf7f0` |
| `--bg-2` | `#ede9df` |
| `--bg-3` | `#ffffff` |
| `--ink-0` | `#0a0908` |
| `--ink-1` | `#2c2a26` |
| `--ink-2` | `#6a6660` |
| `--soleil` | `#a37822` |

### Radius

```
--radius:    4px;   /* tight controls (buttons, inputs) */
--radius-md: 8px;   /* cards, menu items */
--radius-lg: 12px;  /* modals, drawers */
--radius-xl: 16px;  /* hero surfaces, board covers */
```

### Shadow

```
--shadow-1:    0 1px 0 rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.25);
--shadow-2:    0 1px 0 rgba(0,0,0,.5), 0 8px 24px rgba(0,0,0,.32), 0 2px 6px rgba(0,0,0,.2);
--shadow-3:    0 12px 48px rgba(0,0,0,.45), 0 4px 12px rgba(0,0,0,.3);
--shadow-glow: 0 0 0 1px rgba(212,160,74,.32), 0 0 18px rgba(212,160,74,.14);
```

### Motion

Single curve, three durations. No bounces, no springs.

```
--ease:      cubic-bezier(0.2, 0.8, 0.2, 1);
--dur-fast:  120ms;  /* hovers, taps */
--dur-base:  200ms;  /* state changes, popovers */
--dur-slow:  320ms;  /* modals, auth transitions */
```

### Spacing scale

Multiples of 4: `4, 8, 12, 16, 20, 24, 32, 40, 56, 80`. Generous on chrome and editorial surfaces; current density preserved on dense controls (sidebar rows, doc toolbar buttons).

## 4. Typography system

### Loading

Add to `index.html` (replaces the current Inter `@import` in styles.css):

```html
<link rel="preconnect" href="https://use.typekit.net" crossorigin>
<link rel="stylesheet" href="https://use.typekit.net/qtd2rwk.css">
```

JetBrains Mono kept via Google Fonts — narrowed to one weight (500).

### Faces

- **Brandon Grotesque** — display only. Uppercase, letter-spaced, sparingly. Never below 14px. Never as body text.
- **Aileron** — everything else. UI, body, dense text, captions. Replaces Inter.
- **JetBrains Mono** — small system data only (timestamps, ids, keyboard shortcuts, code blocks). The current widespread mono treatment (sidebar sub-labels, breadcrumb separators, picker meta) is removed.

### Type scale

| Token | Size / line-height / weight | Use |
|---|---|---|
| `--type-display` | 56px / 1.05 / 700, **Brandon**, uppercase, 0.18em | Auth wordmark only |
| `--type-h1` | 32px / 1.15 / 700, **Brandon**, uppercase, 0.12em | Empty-state heroes, board grid title |
| `--type-h2` | 22px / 1.25 / 600 Aileron | Modal titles, board grid section heads |
| `--type-h3` | 16px / 1.3 / 600 Aileron | Sidebar group labels (sentence-case) |
| `--type-eyebrow` | 10px / 1 / 700, **Brandon**, uppercase, 0.18em | "WORKSPACE", "BOARDS", "PAGES", "RECENT" |
| `--type-body` | 14px / 1.5 / 400 Aileron | Default body, doc captions |
| `--type-ui` | 13px / 1.4 / 500 Aileron | Buttons, menu items, controls |
| `--type-ui-sm` | 12px / 1.4 / 500 Aileron | Dense rows, sidebar items |
| `--type-meta` | 11px / 1.4 / 400 Aileron, `--ink-2` | Timestamps, counts, supporting meta |
| `--type-mono` | 11px / 1.4 / 500 JetBrains Mono | Shortcuts, ids only |

### Tracking & weight rules

- Brandon uppercase: 0.12em (large) → 0.18em (small)
- Aileron headings ≥16px: `letter-spacing: -0.01em` (subtle tighten)
- Aileron body / UI: default tracking
- Aileron all-caps eyebrows: forbidden — use Brandon eyebrow instead
- Weight ladder: 400 / 500 / 600 / 700. Body 400, UI 500, headings 600, brand display 700.

### Numerics

`font-variant-numeric: tabular-nums` on any column of numbers — timestamps, counts, side-by-side data, presence stack overflow.

### Anti-aliasing

Keep `-webkit-font-smoothing: antialiased`. Remove `font-feature-settings: 'ss01','cv11'` (those are Inter-specific stylistic sets and apply incorrectly to Aileron).

## 5. Iconography & the Soleil mark

### Icon library

Adopt **Lucide** (`lucide-react`). One library for everything.

- 1.5px stroke, 16px or 18px box for UI, 20px in topbar, 24px+ in empty states.
- Filled icons forbidden (except the Soleil mark itself).
- Color via `currentColor`. Default `--ink-2`, hover `--ink-1`, active/selected `--soleil`.
- Replace ad-hoc text icons throughout: `+`, `▸`, mono `>` separators, `⌘`-glyph buttons → Lucide equivalents (Plus, ChevronRight, ChevronRight `›` U+203A for crumbs only, Command).

### The Soleil mark

Existing `SoleilMark` (12 rays + center dot) refined:

1. **Default stroke** drops from 1.2 → 1px; rays shorten ~5% so the mark reads as a luminous point at small sizes (16–20px). At 28px+ it gets the full ray length.
2. **Glow variant** (auth, sidebar brand block, empty-state hero):
   ```css
   filter: drop-shadow(0 0 12px rgba(212,160,74,.35));
   ```
   At ≤20px, no glow.

### Mark color rules

| Context | Color | Glow |
|---|---|---|
| Sidebar brand block | `--soleil` | yes |
| Auth wordmark (mark replaces O) | `--soleil` | strong (24px drop-shadow) |
| Loading spinner | `--ink-0` | no |
| Inline mark in body text | `--ink-0` | no |
| Avatar fallback (no user image) | gradient `--soleil` → `--ink-3` | no |
| Favicon | unchanged from existing `/favicon.png` |

### Wordmark

New component `<SoleilWordmark size="display" | "block" />`:
- **display** size: 56px, used on auth screen
- **block** size: 24px, used in sidebar brand area when expanded
- Brandon Grotesque 700, uppercase, 0.18em tracking
- The literal string is "S [O-as-mark] L E I L"
- The mark substitutes for the **O** — luminous O = sun
- Falls back to plain "SOLEIL" string if Brandon hasn't loaded yet

### Tint dots

`COVER_TINTS` rebalanced to the warm palette (used as 6px sidebar dots and as cover gradient bases):

```js
neutral: '#6b6760',
warm:    '#b88958',
cool:    '#6b8090',
sun:     '#d4a04a',
dusk:    '#9a6b88',
sand:    '#c9a577',
sea:     '#6b9088',
```

### Live cursor

Keeps current arrow shape. Fill = user's assigned color, stroke = `--bg-1`. Cursor name flag: Aileron 11/600, soleil-gold for self, user color for others, 4px radius, drop-shadow.

## 6. Surface specs

### Brand-bearing surfaces (full rebuild)

#### 6.1 Auth screen — `auth/AuthGate.jsx`

- Single column, vertically centered, max-width 420px.
- Top: `<SoleilWordmark size="display"/>` — Brandon 56px uppercase, mark-as-O glowing (24px soleil drop-shadow).
- Subtitle: `--type-eyebrow` "INTERNAL WORKSPACE · SOLEIL PICTURES" in `--ink-2`.
- Email input: 360px wide, `--bg-3` bg, `--line-2` border, `--radius`, 44px tall, Aileron 14px. Focus → `--shadow-glow`.
- Magic-link button: full-width 44px, `--ink-0` bg, `--bg-0` text, `--radius`, hover slight lift + `--shadow-1`.
- Below button: small Aileron 12 `--ink-3` "We'll email you a link to sign in."
- Background: `--bg-0` with a single soft 800px radial gradient behind wordmark (`radial-gradient(ellipse at center, rgba(212,160,74,.08) 0%, transparent 60%)`). No animation, no orb canvas.
- Bottom-edge legal eyebrow: `--type-meta` `--ink-3` "© Soleil Pictures · v{appVersion}".

#### 6.2 Sidebar — `App.jsx` `.sidebar`

- Width 240px (up from 224px), or 56px collapsed.
- **Brand block** (top, 56px tall, 16px padding):
  - Expanded: `<SoleilWordmark size="block"/>` left-aligned + collapse chevron right (Lucide PanelLeftClose, 16px, `--ink-3`).
  - Collapsed: glowing `<SoleilMark size={20}/>` centered + expand chevron on hover only.
- **Boards section** (group label + tree):
  - Label: `--type-eyebrow` "BOARDS" in `--ink-3`, padding 16px 16px 8px.
  - Rows: 30px tall, `--type-ui-sm`, 16px left padding.
  - Tree depth: 12px indent per level, no mono `▸` glyph — use Lucide ChevronRight 12px (rotates open/closed via `transform: rotate(90deg)` + `--dur-fast`).
  - Cover-tint dot: 6px, in left rail, between chevron and title.
  - Hover: `--bg-hov`. Active: `--soleil-soft` background + 2px left bar in `--soleil`.
  - Selected row text shifts to `--ink-0` (vs `--ink-1` resting).
- **Account block** (bottom, sticky, 56px tall):
  - Avatar (28px circle, soleil-gradient fallback) + name (Aileron 13/500 `--ink-1`) + workspace name (Aileron 11 `--ink-3`) stacked.
  - Click target = whole row. Click → workspace switcher popover (frosted, anchored above).

#### 6.3 Topbar — `App.jsx` `.topbar`

- Height 48px (current is cramped).
- Padding: 12px 20px.
- **Left:** breadcrumb chain.
  - Workspace name → board path → current view.
  - Aileron 13/500 `--ink-1` for active leaf, `--ink-2` for ancestors.
  - Separator `›` (U+203A) in `--ink-3`, Aileron (no mono).
  - Each crumb is a button with `--bg-hov` on hover, `--radius`.
- **Center:** view-switch pill — soft 2-state segmented control (`Canvas` / `List`), 28px tall, `--bg-3` bg, active state `--bg-4` + `--ink-0`, transition `--dur-base`.
- **Right cluster** (right-aligned, 8px gap):
  1. `<PresenceStack/>` (see below)
  2. Share button — Lucide Share2 + "Share" label, outline style, 32px tall
  3. "+" add menu — Lucide Plus, 32px square, `--bg-hov` on hover, opens popover
  4. Settings — Lucide Settings, 32px square
- All controls: 32px square (or 32px tall), `--radius`, `--ink-2` icon, hover → `--ink-1` + `--bg-hov`.

#### 6.4 Board grid — `BoardPicker.jsx` (modal grid view)

- Modal-presented, frosted backdrop.
- Title row: `--type-h1` Brandon "BOARDS" left, count + filter (Lucide Filter) right.
- 4-column responsive grid (3 / 2 / 1 at narrower widths), gap 24px.
- Each card:
  - 4:3 cover area (`--radius-md`), gradient from cover tint or first image card if present.
  - Below cover (16px padding): eyebrow workspace label (`--type-eyebrow` `--ink-3`), title (`--type-h3` Aileron), meta row (`--type-meta` "Edited 2h ago · 3 members").
  - Hover: `--shadow-2` lift, cover slight zoom (1.02 over `--dur-base`).
  - Keyboard focus: soleil-gold focus ring (`--shadow-glow`).
- Empty grid → `<EmptyState/>` (see 6.5).

#### 6.5 Empty states

Single reusable `<EmptyState icon title body action />` component:

- Vertical centered, max-width 360px.
- Icon: Lucide, 48px, `--ink-3`, optional soleil glow on the brand-bearing variants.
- Title: `--type-h1` Brandon `--ink-1`.
- Body: `--type-body` `--ink-2`, max 2 lines.
- Action: button in `--ink-0` bg / `--bg-0` text.

Specific instances:

| Surface | Icon | Title | Body | Action |
|---|---|---|---|---|
| Empty workspace | Lucide LayoutGrid | "No boards yet" | "Make your first board to start." | "+ New board" |
| Empty board (canvas) | Lucide MousePointer2 | "Empty canvas" | "Drop a card or use the + menu to start." | none (just hint) |
| Empty doc | (no empty state — let the editor render blank) |
| Empty list | Lucide List | "Empty list" | "Add an item to get started." | "+ New item" |
| Empty inbox | Lucide Inbox | "Inbox is clear" | "Drop files or paste links here." | none |

Note: empty doc surface deliberately has **no** placeholder — the user previously said placeholder text felt cheap.

#### 6.6 Sidebar account block / workspace switcher

Already specified in 6.2. Workspace switcher popover details:
- Frosted glass, anchored above the account block, 280px wide.
- Top: current workspace row with checkmark.
- Divider.
- Other workspaces (rows: avatar + name + member count `--type-meta`).
- Divider.
- Footer actions: "+ Create workspace", "Sign out".

### High-touch overlays

#### 6.7 Modals (workspace create, custom fonts, history, app feedback)

- Centered, max-width per modal (workspace create 420px, custom fonts 640px, history 720px).
- Frosted glass: `background: rgba(20,18,15,.72); backdrop-filter: blur(20px) saturate(1.2);` + `border: 1px solid rgba(255,255,255,.06)`.
- `--radius-lg`, `--shadow-3`.
- Header: title `--type-h2` left, close (Lucide X 16px) right, 16px padding, `border-bottom: 1px solid var(--line-1)`.
- Body: 20px padding, `--type-body`.
- Footer: 12px padding, right-aligned actions, primary button in `--ink-0` bg.
- Open: `--dur-slow` fade + 8px translate-y on the panel.

#### 6.8 Floating menus (color picker, slash menu, link picker, embed picker, export menu, context menus)

- Frosted glass, `--radius-md`, `--shadow-3`, max-width per menu.
- Items: 32px tall, 12px h-padding, Aileron 13/500, hover `--bg-hov`, keyboard-active `--soleil-soft` bg.
- Section dividers: 1px `--line-1`.
- Section labels: `--type-eyebrow` `--ink-3`.
- Color picker swatches: 24px squares, gap 6px, soleil-gold ring on selected. Recent colors row at top with `--type-eyebrow` "RECENT" label.

#### 6.9 Inbox panel + Tweaks panel

- Right-side drawer, 320px (inbox), 360px (tweaks), full height.
- `--bg-1` bg, `border-left: 1px solid var(--line-1)`.
- Header (48px, padding 12px 16px): eyebrow title + close (Lucide X 16px).
- Inbox items: card-style rows (6.10), 8px gap, scrollable.

#### 6.10 Tool options bar

- Floats above selected card(s).
- Frosted glass, `--radius-md`, `--shadow-2`, 8px padding.
- Controls: 26px square, Lucide icons (BoldIcon→Bold, etc.), grouped with 1px `--line-1` dividers.
- Tooltip on hover (Aileron 11px, `--ink-0` on `--bg-3`, `--radius`, 4px padding, soleil-gold underline on shortcut letters).
- Replace text labels throughout — icon-only with tooltips for hover discovery.

#### 6.11 Doc surface chrome

- **Doc toolbar:** 44px tall, frosted, sticky top.
  - Lucide icons throughout (Bold, Italic, Underline, Strikethrough, AlignLeft/Center/Right/Justify, List, ListOrdered, Quote, Code, Link, Bookmark, Search).
  - Font picker: collapses to label-only with Lucide ChevronDown. Dropdown opens as menu (6.8).
  - Heading picker: same treatment.
  - Color/highlight: square swatch with Lucide ChevronDown.
- **Page tree rail (left):** 240px, `--bg-1`, `border-right: 1px solid --line-1`.
  - Header: eyebrow "PAGES" + Lucide Plus (add page) + collapse chevron.
  - Rows: 28px tall, like sidebar.
- **Outline / Bookmarks / Comments rail (right):** 280px.
  - Tabs: pill segmented control (3-state) instead of underlined tabs, 28px tall, `--bg-3` bg.
- **Status footer:** 28px tall, `--bg-1`, `border-top: 1px solid --line-1`.
  - Left: word count + cursor pos in `--type-mono` `--ink-3`.
  - Right: save state in `--type-meta` `--ink-2` ("Saved", "Saving…", "Offline").
- **Doc card open/dock controls:** Lucide Maximize2 (full) / PanelRight (dock to side) / X (close), 28px square, top-right corner of the card, hidden until card-hover.

#### 6.12 Find/replace bar

- Slim 36px bar at top of editor (under doc toolbar), frosted, slides in from top over `--dur-base`.
- Aileron 13px input, soleil-gold match highlight in body.
- Match count in `--type-mono` "3 of 12".
- Prev/Next/Close as Lucide icons.

#### 6.13 Presence stack

- Avatars 24px, overlapping by 8px, max 4 visible.
- "+N" pill if more, soleil-gold border on the +N badge.
- Each avatar: 1.5px `--bg-1` border (so they stack visually).
- Hover any avatar → Aileron 11px tooltip with name.

### Working surfaces (token inheritance + light polish)

#### 6.14 Canvas

- Background `--bg-2` (warmer than sidebar, reads as desk surface).
- Grid: switch from grid lines to **dots only** — `--grid-dot` 1px dots on a 24px grid. Calmer, more paper-like.
- Selection marquee: 1px `--soleil` border + `--soleil-soft` fill.
- Snap guides: 1px `--soleil` lines, 60% opacity.

#### 6.15 Cards on canvas (note, image, board-link, palette, schedule, link)

- Inherit token bg (`--bg-3`), border (`--line-2`), radius (`--radius-md`).
- Resting shadow `--shadow-1`, selected `--shadow-2` + `--soleil` 1px ring (1px halo + 1px border via `box-shadow: 0 0 0 1px var(--soleil), 0 0 0 4px var(--soleil-soft)`).
- Note (post-it) yellow stays as a deliberate paper-divergent — it's brand-intentional.
- Card titles: Aileron 13/600 `--ink-0`. Card meta: `--type-meta`.
- Image cards: round to `--radius-md` matching card edge, no internal padding.

#### 6.16 List view — `ListSurface.jsx`

- Same row treatment as sidebar tree (28-30px rows, dot tint, hover/active states).
- Eyebrow group labels.
- Drag-handle (Lucide GripVertical) on row hover.

#### 6.17 Doc page editor body

- Page background: `#faf7f0` (warm cream) instead of pure white. Less Word-doc, more paper.
- Page edges: `--shadow-2` to lift off canvas.
- 8.5×11 letter proportions preserved.
- Body type: Aileron 14/1.6 `#1a1612` (warm near-black).
- Headings: Aileron tightening per type scale, weights 600/700.

#### 6.18 Board thumbnails

- Inherit cover-tint gradients.
- 4:3 ratio, `--radius-md`, `--shadow-1`.
- Render up to 6 child cards as miniature stickers.

#### 6.19 Live cursors

Specified in 5 (Iconography).

## 7. Motion & micro-interactions

- **Hovers:** `--dur-fast` (120ms) on color, bg, shadow.
- **State changes** (selection, focus): `--dur-base` (200ms).
- **Modals, drawers, auth transitions:** `--dur-slow` (320ms), with translate-y of 8px.
- **Easing:** always `--ease`. No bouncy springs.
- **Page-level:** route changes between board / list / doc views fade body content over `--dur-base`; chrome doesn't flash.
- **Selection ring:** appears via opacity (no scale pulse).
- **Hover-lift on board cards:** `transform: translateY(-2px)` + `--shadow-2`.
- **Dropdown opens:** opacity + 4px translate-y, `--dur-base`.
- **Button press:** scale 0.98 over 60ms, returns over 120ms.
- **Loading states:** Lucide Loader2 with `animation: spin 800ms linear infinite`. Soleil-gold for primary loaders, `--ink-3` for ambient.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` disables transforms; transitions reduced to opacity-only at `--dur-fast`.

## 8. Implementation strategy

Phased so each phase ships independently and the app stays usable throughout.

### Phase A — Brand foundations (1 day)

- Update `index.html` with Typekit link + warm `theme-color`.
- Rewrite `:root` and `[data-theme='light']` token blocks in `src/styles.css`.
- Replace `--font-sans` everywhere → `Aileron, system-ui, sans-serif`.
- Add `--type-*` custom properties + helper utility classes (`.t-display`, `.t-h1`, `.t-eyebrow`, `.t-body`, `.t-ui`, `.t-meta`, `.t-mono`).
- Update `COVER_TINTS` in `primitives.jsx` with warm palette.
- Refine `SoleilMark` (1px stroke, slightly shorter rays, glow filter as a prop).
- Add `<SoleilWordmark/>` component.
- Install `lucide-react`.

**Verify:** app loads, every existing surface still functions, type/colors visibly shift without layout breakage.

### Phase B — Brand-bearing surfaces (2 days)

In order:
1. **Auth screen** (6.1) — most isolated, biggest brand impact.
2. **Sidebar** (6.2) — restructure brand block + account block + group labels.
3. **Topbar** (6.3) — breadcrumb, view-switch pill, right-cluster.
4. **Board grid** (6.4) — editorial layout in `BoardPicker`.
5. **Empty states** (6.5) — extract `<EmptyState/>` and use across app.

**Verify:** screenshot each surface against an internal "before" snapshot. All flows still work end-to-end.

### Phase C — Overlays & doc chrome (2 days)

1. **Modals** (6.7) — frosted glass treatment, header/footer/body rules.
2. **Floating menus** (6.8) — single shared menu component.
3. **Inbox + Tweaks panels** (6.9).
4. **Tool options bar** (6.10) — Lucide icons + tooltips.
5. **Doc surface chrome** (6.11) — toolbar / rails / footer / open-dock controls.
6. **Find/replace** (6.12).
7. **Presence stack** (6.13).

**Verify:** every overlay opens with `--shadow-3` + frosted blur, closes cleanly, keyboard nav works.

### Phase D — Working-surface inheritance (1 day)

1. Canvas dot-grid (6.14).
2. Cards on canvas (6.15) — selection rings, shadows.
3. List view (6.16).
4. Doc page editor body cream paper (6.17).
5. Board thumbnails (6.18).

**Verify:** existing canvas drag-drop, doc editing, list interactions all unchanged. Visual reads as warm-dark luxury.

### Phase E — Motion + micro-interactions (0.5 day)

- Apply `--ease` and `--dur-*` tokens across all transitions in `styles.css`.
- Add hover-lift on board cards.
- Add prefers-reduced-motion fallback block.

**Verify:** open/close animations land with consistent timing; reduced-motion users see no transforms.

### Phase F — QA + polish pass (0.5 day)

- Visual audit at three viewport widths (1440, 1024, 768).
- Light theme audit.
- Keyboard-only navigation pass.
- Verify no accidental Inter / mono leakage.

## 9. Out of scope

- Backend, RLS, Yjs adapter — no changes.
- Tiptap editor extensions and behavior — no changes.
- Realtime sync logic — no changes.
- New features (no new card kinds, no new doc primitives, no new collaboration mechanics).
- Mobile layout (Boards is desktop-first; mobile reflow is its own future project).

## 10. Risks & open questions

- **Adobe Typekit availability:** if `use.typekit.net/qtd2rwk.css` ever fails to load, we degrade to system fonts. Aileron fallback chain: `Aileron, -apple-system, system-ui, sans-serif`. Brandon fallback: `'Brandon Grotesque', Impact, sans-serif`. Acceptable degradation.
- **Lucide bundle size:** `lucide-react` is ~600KB unminified but tree-shakes per-icon. With ~40 icons used we're under 25KB minified. Acceptable.
- **Light theme:** kept as second-class. Risk: tokens drift over time and light theme breaks unnoticed. Mitigation: Phase F audits both.
- **Soleil-gold contrast:** `#d4a04a` against `--bg-2` warm-dark passes WCAG AA for non-text use (focus rings, indicators). For text use we'd need to darken — this spec uses it only for non-text surfaces, so it's fine.
- **Note (post-it) yellow** stays bright against the warm-dark canvas. This is intentional — it's the paper-on-desk metaphor. If it reads as garish in practice, swap to a slightly muted yellow (`#e8c878`) in Phase D.

## 11. Verification (full app smoke)

After Phase F, the following should all be true:

1. Sign in via magic link → wordmark glows, form is calm and centered, type is Aileron throughout.
2. Land in workspace → sidebar reads as branded, brand block has glowing mark.
3. Open board grid → editorial layout, Brandon header, hover-lift works.
4. Open a board → topbar pill view-switch, breadcrumb separators are `›` not `>`, presence stack stacked properly.
5. Open color picker → frosted glass, soleil-gold focus on selected swatch.
6. Open a doc card → cream paper, refined toolbar, status footer in mono.
7. Trigger find/replace → slim bar slides in, soleil match highlight.
8. Pin a board alongside → split chrome inherits new tokens.
9. Right-click a card → context menu is frosted with Lucide icons.
10. Empty inbox → calm empty state, no placeholder noise.
11. Toggle light theme → palette inverts cleanly, soleil darkens to `#a37822`, no contrast breaks.
12. Tab-navigate the sidebar → focus rings glow soleil.
13. Reduced-motion preference → no transforms; opacity transitions only.
