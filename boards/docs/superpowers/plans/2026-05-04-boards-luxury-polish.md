# Boards Luxury Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the warm-dark Soleil Pictures luxury polish from the design spec across the entire Boards app — new design tokens, Aileron + Brandon Grotesque, Lucide icons, soleil-gold accent, frosted overlays — without changing any backend, Yjs, or Tiptap behavior.

**Architecture:** All work happens in `boards/`. Phase A rewrites design tokens in `src/styles.css` and adds two shared components (`SoleilWordmark`, `EmptyState`). Phases B–D rebuild brand-bearing surfaces and apply token inheritance to working surfaces, file by file. Phase E threads motion tokens through existing transitions. Phase F is a final visual / keyboard / theme audit.

**Tech Stack:** Vite + React 18, CSS custom properties, Adobe Typekit (existing kit `qtd2rwk`), `lucide-react` (new), Playwright (existing) for verification.

**Spec:** `boards/docs/superpowers/specs/2026-05-04-boards-luxury-polish-design.md`

---

## File Structure

**New files**
- `boards/src/components/SoleilWordmark.jsx` — Brandon-Grotesque wordmark with mark-as-O (sizes: `display`, `block`).
- `boards/src/components/EmptyState.jsx` — shared empty-state shell (icon + Brandon title + body + optional action).
- `boards/src/components/Icon.jsx` — thin wrapper around `lucide-react` with the project's default sizing/stroke/color rules.
- `boards/src/lib/icons.js` — central re-exports of every Lucide icon used (so swapping later is trivial).
- `boards/tests/polish-smoke.spec.js` — adds Playwright assertions for new brand surfaces.

**Modified files (in order touched)**
- `boards/package.json` — add `lucide-react`.
- `boards/index.html` — Typekit link, refined `theme-color`.
- `boards/src/styles.css` — top of file: token rewrite, type-utility classes, motion tokens, frosted-glass and empty-state base. Per-surface sections updated phase by phase.
- `boards/src/components/primitives.jsx` — refine `SoleilMark`, refresh `COVER_TINTS`.
- `boards/src/auth/AuthGate.jsx` — `SignIn` + `SplashLoading` rebuild.
- `boards/src/App.jsx` — sidebar brand block / boards tree / account block + topbar (~lines 820–960).
- `boards/src/components/BoardPicker.jsx` — editorial board grid.
- `boards/src/components/InboxPanel.jsx` — drawer treatment.
- `boards/src/components/TweaksPanel.jsx` — drawer treatment.
- `boards/src/components/ToolOptionsBar.jsx` — Lucide icons + tooltips.
- `boards/src/components/ColorPicker.jsx` — frosted glass + soleil swatch ring.
- `boards/src/components/CustomFontsModal.jsx`, `HistoryModal.jsx`, `AppFeedback.jsx`, `BackgroundContextMenu.jsx`, `CardContextMenu.jsx`, `DocBoardEmbedPicker.jsx`, `DocLinkPicker.jsx`, `DocSlashMenu.jsx`, `DocExportMenu.jsx` — inherit modal / menu base classes.
- `boards/src/components/DocToolbar.jsx`, `DocSurface.jsx`, `DocPageTree.jsx`, `DocOutlinePanel.jsx`, `DocBookmarksPanel.jsx`, `DocCommentsPanel.jsx`, `DocStatusFooter.jsx`, `DocCard.jsx`, `DocFindReplace.jsx`, `DocPageEditor.jsx` — chrome refresh.
- `boards/src/components/CanvasSurface.jsx`, `cards.jsx`, `ListSurface.jsx`, `BoardThumbnail.jsx` — token inheritance + selection ring.
- `boards/src/components/PresenceStack.jsx`, `primitives.jsx` (LiveCursor) — new style.

---

# Phase A — Brand foundations

### Task A1: Install lucide-react + add Typekit + theme-color

**Files:**
- Modify: `boards/package.json`
- Modify: `boards/index.html`

- [ ] **Step 1: Install lucide-react**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards
npm install lucide-react@^0.460.0
```

Expected: package added to `dependencies`.

- [ ] **Step 2: Update `index.html`** — add Typekit preconnect + stylesheet, change `theme-color` to warm-dark.

Replace the `<head>` block of `boards/index.html` with:

```html
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#0a0908" />
  <title>Soleil — Boards</title>
  <meta name="description" content="Soleil Boards — internal project management workspace for Soleil Pictures." />
  <meta name="robots" content="noindex, nofollow" />

  <link rel="preconnect" href="https://use.typekit.net" crossorigin />
  <link rel="stylesheet" href="https://use.typekit.net/qtd2rwk.css" />

  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="canonical" href="https://boards.soleilpictures.com/" />
</head>
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

Expected: build succeeds, no new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/package.json boards/package-lock.json boards/index.html
git commit -m "$(cat <<'EOF'
Add lucide-react and Typekit for Boards polish

Adds lucide-react for the unified icon set and the Soleil Adobe Typekit
stylesheet (kit qtd2rwk — same as soleilpictures.com) to load Aileron
and Brandon Grotesque. Bumps theme-color to the new warm-dark page bg.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Rewrite design tokens in styles.css

**Files:**
- Modify: `boards/src/styles.css` (lines 1–80)

- [ ] **Step 1: Replace the token block at the top of styles.css**

Find the existing `@import` line and the `:root` + `[data-theme='light']` blocks (currently lines 1–70). Replace them with the block below. Keep everything after line 70 (the `html, body, #root` block onward) unchanged for now — later tasks will edit specific sections.

Open `boards/src/styles.css` and replace lines 1 through 68 (inclusive of the closing `}` of the `[data-theme='light']` block) with:

```css
/* Soleil Boards — luxury polish (warm dark default, light secondary) */

@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500&display=swap');

* { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  /* warm dark (default) */
  --bg-0:    #0a0908;
  --bg-1:    #111110;
  --bg-2:    #15140f;
  --bg-3:    #1c1b18;
  --bg-4:    #252320;
  --bg-hov:  #1a1916;
  --bg-act:  #211f1b;

  --line-1:  #211f1c;
  --line-2:  #2c2a26;
  --line-3:  #3a3732;

  --ink-0:   #f5f1e8;
  --ink-1:   #d5cfc1;
  --ink-2:   #8a857a;
  --ink-3:   #5b574e;
  --ink-4:   #3d3a34;

  --soleil:        #d4a04a;
  --soleil-soft:   rgba(212,160,74,.14);
  --soleil-glow:   0 0 24px rgba(212,160,74,.18);

  --accent:  var(--soleil);

  --radius:    4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  --grid-line: rgba(245,241,232,.025);
  --grid-dot:  rgba(245,241,232,.05);

  --font-sans: aileron, -apple-system, system-ui, sans-serif;
  --font-display: brandon-grotesque, Impact, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --shadow-1:    0 1px 0 rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.25);
  --shadow-2:    0 1px 0 rgba(0,0,0,.5), 0 8px 24px rgba(0,0,0,.32), 0 2px 6px rgba(0,0,0,.2);
  --shadow-3:    0 12px 48px rgba(0,0,0,.45), 0 4px 12px rgba(0,0,0,.3);
  --shadow-glow: 0 0 0 1px rgba(212,160,74,.32), 0 0 18px rgba(212,160,74,.14);

  --ease:     cubic-bezier(0.2, 0.8, 0.2, 1);
  --dur-fast: 120ms;
  --dur-base: 200ms;
  --dur-slow: 320ms;
}

[data-theme='light'] {
  --bg-0:   #f5f1e8;
  --bg-1:   #faf7f0;
  --bg-2:   #ede9df;
  --bg-3:   #ffffff;
  --bg-4:   #f5f2eb;
  --bg-hov: #f0ece4;
  --bg-act: #e8e4dc;

  --line-1: #ece8e0;
  --line-2: #d8d4cc;
  --line-3: #b9b5ad;

  --ink-0:  #0a0908;
  --ink-1:  #2c2a26;
  --ink-2:  #6a6660;
  --ink-3:  #92908a;
  --ink-4:  #b8b5af;

  --soleil:      #a37822;
  --soleil-soft: rgba(163,120,34,.10);

  --grid-line: rgba(10,9,8,.04);
  --grid-dot:  rgba(10,9,8,.07);

  --shadow-1:    0 1px 0 rgba(0,0,0,.04), 0 2px 8px rgba(0,0,0,.05);
  --shadow-2:    0 1px 0 rgba(0,0,0,.05), 0 8px 22px rgba(0,0,0,.08);
  --shadow-3:    0 12px 40px rgba(0,0,0,.10), 0 4px 12px rgba(0,0,0,.06);
  --shadow-glow: 0 0 0 1px rgba(163,120,34,.32), 0 0 18px rgba(163,120,34,.14);
}
```

- [ ] **Step 2: Update the `body` block (around line 72)** — drop Inter-specific stylistic sets.

Find:
```css
body {
  font-family: var(--font-sans);
  font-size: 13px;
  font-feature-settings: 'ss01','cv11';
```

Replace those lines with:

```css
body {
  font-family: var(--font-sans);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
```

- [ ] **Step 3: Verify build + dev server starts cleanly**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

Expected: build succeeds. The visible app should immediately read warmer (cream text on warm-dark) and Aileron should be active where Inter was. Brandon will only be visible on surfaces that explicitly use it (later tasks).

- [ ] **Step 4: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/styles.css
git commit -m "$(cat <<'EOF'
Rewrite Boards design tokens to warm-dark luxury palette

Replaces the gray IDE palette with the warm-dark token system from the
polish spec: cream inks, soleil-gold accent, multi-layer soft shadows,
new radius scale (4/8/12/16), motion tokens, and an inverted warm
light theme. Switches font stack to Aileron (UI) + Brandon Grotesque
(display) + JetBrains Mono (system data only). Drops Inter-specific
font-feature-settings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Add type utility classes + frosted-glass / surface base classes

**Files:**
- Modify: `boards/src/styles.css` (insert after the `body` block, before the existing `.app` rule)

- [ ] **Step 1: Insert the new utility-class block**

Locate the `body { … }` block. Immediately after its closing brace, add the following CSS block. (If a block of same content is already there from a prior partial edit, replace it instead of duplicating.)

```css
/* ─────────────────────────── Type utilities ─────────────────────────────── */

.t-display { font-family: var(--font-display); font-weight: 700; font-size: 56px; line-height: 1.05; text-transform: uppercase; letter-spacing: 0.18em; color: var(--ink-0); }
.t-h1      { font-family: var(--font-display); font-weight: 700; font-size: 32px; line-height: 1.15; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-0); }
.t-h2      { font-family: var(--font-sans); font-weight: 600; font-size: 22px; line-height: 1.25; letter-spacing: -0.01em; color: var(--ink-0); }
.t-h3      { font-family: var(--font-sans); font-weight: 600; font-size: 16px; line-height: 1.30; letter-spacing: -0.01em; color: var(--ink-0); }
.t-eyebrow { font-family: var(--font-display); font-weight: 700; font-size: 10px; line-height: 1; text-transform: uppercase; letter-spacing: 0.18em; color: var(--ink-3); }
.t-body    { font-family: var(--font-sans); font-weight: 400; font-size: 14px; line-height: 1.5; color: var(--ink-1); }
.t-ui      { font-family: var(--font-sans); font-weight: 500; font-size: 13px; line-height: 1.4; color: var(--ink-1); }
.t-ui-sm   { font-family: var(--font-sans); font-weight: 500; font-size: 12px; line-height: 1.4; color: var(--ink-1); }
.t-meta    { font-family: var(--font-sans); font-weight: 400; font-size: 11px; line-height: 1.4; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.t-mono    { font-family: var(--font-mono); font-weight: 500; font-size: 11px; line-height: 1.4; color: var(--ink-2); font-variant-numeric: tabular-nums; }

/* ───────────────────────── Surface base classes ─────────────────────────── */

.surface-frosted {
  background: rgba(20, 18, 15, 0.72);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-3);
}
[data-theme='light'] .surface-frosted {
  background: rgba(255, 252, 246, 0.78);
  border-color: rgba(10, 9, 8, 0.06);
}

.surface-card {
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-1);
}

.surface-glow-ring {
  box-shadow: var(--shadow-glow);
  outline: none;
}

/* ─────────────────────────── Motion defaults ────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: var(--dur-fast) !important;
    animation-duration: var(--dur-fast) !important;
    transform: none !important;
  }
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

Expected: succeeds. (Utility classes won't be used until later tasks.)

- [ ] **Step 3: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/styles.css
git commit -m "$(cat <<'EOF'
Add type-scale and surface-base utility classes

Adds .t-display through .t-mono utility classes for the new type scale,
plus .surface-frosted / .surface-card / .surface-glow-ring shared base
classes used by upcoming overlay rebuilds. Adds prefers-reduced-motion
fallback that drops transforms and clamps durations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Refine SoleilMark, refresh COVER_TINTS, add SoleilWordmark + Icon helper

**Files:**
- Modify: `boards/src/components/primitives.jsx`
- Create: `boards/src/components/SoleilWordmark.jsx`
- Create: `boards/src/components/Icon.jsx`
- Create: `boards/src/lib/icons.js`

- [ ] **Step 1: Refine `SoleilMark` and rebalance `COVER_TINTS` in `primitives.jsx`**

In `boards/src/components/primitives.jsx`, replace the existing `SoleilMark` function (lines 53–68) with:

```jsx
export function SoleilMark({ size = 18, color = 'currentColor', glow = false }) {
  const rays = 12;
  const filter = glow && size > 20
    ? 'drop-shadow(0 0 12px rgba(212,160,74,.35))'
    : undefined;
  // At small sizes (<= 20px) the rays read as noise — shorten them slightly
  // and drop stroke weight to 1px so the mark reads as a luminous point.
  const stroke = 1;
  const innerR = size <= 20 ? 5.0 : 5.5;
  const outerR = size <= 20 ? 9.2 : 10;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', filter }}>
      <circle cx="12" cy="12" r="2.6" fill={color} />
      {Array.from({ length: rays }).map((_, i) => {
        const a = (i / rays) * Math.PI * 2;
        const x1 = 12 + Math.cos(a) * innerR;
        const y1 = 12 + Math.sin(a) * innerR;
        const x2 = 12 + Math.cos(a) * outerR;
        const y2 = 12 + Math.sin(a) * outerR;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={stroke} strokeLinecap="round" />;
      })}
    </svg>
  );
}
```

In the same file, replace the `COVER_TINTS` object (lines 71–79) with:

```jsx
export const COVER_TINTS = {
  neutral: '#6b6760',
  warm:    '#b88958',
  cool:    '#6b8090',
  sun:     '#d4a04a',
  dusk:    '#9a6b88',
  sand:    '#c9a577',
  sea:     '#6b9088',
};
```

- [ ] **Step 2: Create `SoleilWordmark` component**

Create `boards/src/components/SoleilWordmark.jsx`:

```jsx
import { SoleilMark } from './primitives.jsx';

// Soleil wordmark — Brandon Grotesque uppercase, mark substituted for the O.
//   size="display"  → 56px (auth screen)
//   size="block"    → 24px (sidebar brand area)
export function SoleilWordmark({ size = 'display', color = 'var(--ink-0)' }) {
  const isDisplay = size === 'display';
  const fontSize = isDisplay ? 56 : 24;
  const tracking = isDisplay ? '0.18em' : '0.16em';
  const markSize = isDisplay ? 52 : 22;
  const gap = isDisplay ? 10 : 4;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize,
        textTransform: 'uppercase',
        letterSpacing: tracking,
        color,
        lineHeight: 1,
      }}
    >
      <span>S</span>
      <SoleilMark size={markSize} color="var(--soleil)" glow />
      <span>LEIL</span>
    </div>
  );
}
```

- [ ] **Step 3: Create the Lucide icon central exports**

Create `boards/src/lib/icons.js`:

```js
// Central re-exports of every Lucide icon used in Boards. Adding a new
// icon? Add it here so swapping libraries later only touches this file.
export {
  Plus,
  Minus,
  X,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  Maximize2,
  Minimize2,
  Search,
  Filter,
  Settings,
  Share2,
  Inbox,
  LayoutGrid,
  List,
  MousePointer2,
  GripVertical,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  ListOrdered,
  Quote,
  Code,
  Link,
  Bookmark,
  Image,
  Type,
  Palette,
  StickyNote,
  Calendar,
  MessageSquare,
  Trash2,
  Copy,
  Undo,
  Redo,
  Loader2,
  Folder,
  FolderOpen,
  FileText,
  MoreHorizontal,
} from 'lucide-react';
```

- [ ] **Step 4: Create the `Icon` wrapper for consistent sizing**

Create `boards/src/components/Icon.jsx`:

```jsx
// Thin wrapper around lucide-react icons enforcing the project defaults:
//   1.5px stroke, currentColor, displayed as a block.
//   <Icon as={Plus} size={16} />
export function Icon({ as: Component, size = 16, strokeWidth = 1.5, ...rest }) {
  return <Component size={size} strokeWidth={strokeWidth} style={{ display: 'block' }} {...rest} />;
}
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

Expected: build succeeds. SoleilMark used by sidebar/auth still renders (will look slightly different — thinner stroke).

- [ ] **Step 6: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/primitives.jsx boards/src/components/SoleilWordmark.jsx boards/src/components/Icon.jsx boards/src/lib/icons.js
git commit -m "$(cat <<'EOF'
Refine SoleilMark, add SoleilWordmark + Icon wrapper

Drops mark stroke to 1px and shortens rays at small sizes so it reads
as a luminous point. Adds glow prop using a drop-shadow filter for
brand-bearing surfaces. Rebalances COVER_TINTS to the warm palette.
Adds <SoleilWordmark/> (Brandon-Grotesque, mark-as-O) and a thin
<Icon as={LucideX}/> wrapper plus a central icon-export module.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase B — Brand-bearing surfaces

### Task B1: Auth screen rebuild

**Files:**
- Modify: `boards/src/auth/AuthGate.jsx` (the `SignIn` and `SplashLoading` functions, lines 126–193)
- Modify: `boards/src/styles.css` (auth section — find the existing `.auth-screen` block and replace)
- Modify: `boards/tests/boards-smoke.spec.js` (update one assertion that no longer matches)

- [ ] **Step 1: Replace `SignIn` and `SplashLoading` in `AuthGate.jsx`**

In `boards/src/auth/AuthGate.jsx`, replace the entire `SignIn` function (lines 126–183) and the `SplashLoading` function (lines 185–193) with:

```jsx
function SignIn() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div className="auth-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-card">
        <SoleilWordmark size="display" />
        <div className="auth-eyebrow t-eyebrow">INTERNAL WORKSPACE · SOLEIL PICTURES</div>

        {sent ? (
          <div className="auth-sent">
            <div className="auth-sent-title t-h3">Check your inbox</div>
            <div className="auth-sent-sub t-body">We sent a magic link to <b>{email}</b>.</div>
            <button className="auth-link" onClick={() => { setSent(false); setEmail(''); }}>
              Use a different email
            </button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <input
              className="auth-input"
              type="email"
              autoFocus
              required
              placeholder="you@soleilpictures.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            <button className="auth-btn" type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send magic link'}
            </button>
            {error && <div className="auth-error t-meta">{error}</div>}
            <div className="auth-hint t-meta">We'll email you a link to sign in.</div>
          </form>
        )}

        <div className="auth-foot t-meta">© Soleil Pictures</div>
      </div>
    </div>
  );
}

function SplashLoading() {
  return (
    <div className="auth-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-loading">
        <SoleilMark size={32} color="var(--soleil)" glow />
      </div>
    </div>
  );
}
```

Also update the import at the top of `AuthGate.jsx` (currently line 9) from:

```jsx
import { SoleilMark } from '../components/primitives.jsx';
```

to:

```jsx
import { SoleilMark } from '../components/primitives.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
```

- [ ] **Step 2: Replace the auth CSS section in `styles.css`**

Find the existing `.auth-screen` related rules in `styles.css` (search for `.auth-screen`). Replace the entire auth styling block — every selector starting with `.auth-` — with:

```css
/* ──────────────────────────────── Auth ──────────────────────────────────── */

.auth-screen {
  position: fixed;
  inset: 0;
  background: var(--bg-0);
  display: grid;
  place-items: center;
  overflow: hidden;
}
.auth-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 800px 600px at 50% 45%, rgba(212,160,74,.10) 0%, transparent 60%);
  pointer-events: none;
}
.auth-card {
  position: relative;
  width: 100%;
  max-width: 420px;
  padding: 40px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  text-align: center;
}
.auth-eyebrow { color: var(--ink-2); }
.auth-form { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 360px; align-items: stretch; }
.auth-input {
  height: 44px;
  padding: 0 14px;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  color: var(--ink-0);
  font: 500 14px/1.4 var(--font-sans);
  outline: none;
  transition: box-shadow var(--dur-base) var(--ease), border-color var(--dur-base) var(--ease);
}
.auth-input::placeholder { color: var(--ink-3); }
.auth-input:focus { border-color: transparent; box-shadow: var(--shadow-glow); }
.auth-input:disabled { opacity: 0.6; }
.auth-btn {
  height: 44px;
  background: var(--ink-0);
  color: var(--bg-0);
  border: 0;
  border-radius: var(--radius);
  font: 600 14px/1 var(--font-sans);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-base) var(--ease), opacity var(--dur-fast) var(--ease);
}
.auth-btn:hover:not(:disabled) { box-shadow: var(--shadow-1); transform: translateY(-1px); }
.auth-btn:active:not(:disabled) { transform: translateY(0) scale(0.99); }
.auth-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.auth-error { color: #e08b8b; }
.auth-hint  { color: var(--ink-3); }
.auth-foot  { position: absolute; bottom: 24px; left: 0; right: 0; color: var(--ink-3); }
.auth-link  { background: transparent; border: 0; color: var(--soleil); cursor: pointer; font: 500 13px/1 var(--font-sans); padding: 8px 12px; }
.auth-link:hover { text-decoration: underline; }
.auth-sent  { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.auth-sent-title { color: var(--ink-0); }
.auth-sent-sub   { color: var(--ink-1); }
.auth-loading { display: grid; place-items: center; }
```

- [ ] **Step 3: Update the existing Playwright assertion that referenced "Soleil Boards"**

Open `boards/tests/boards-smoke.spec.js`. Replace this line (in the first `test`):

```js
await expect(page.getByText('Soleil Boards')).toBeVisible();
```

with:

```js
await expect(page.locator('.auth-eyebrow')).toContainText('SOLEIL PICTURES');
```

And in the second test (stale-link), do the same replacement.

- [ ] **Step 4: Add new Playwright smoke checks for the auth rebuild**

Create `boards/tests/polish-smoke.spec.js`:

```js
import { expect, test } from '@playwright/test';

test('auth screen shows the Soleil wordmark with glowing mark', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.auth-screen')).toBeVisible();
  await expect(page.locator('.auth-glow')).toBeVisible();
  // Wordmark renders S + mark + LEIL — assert the literal text spans
  await expect(page.locator('.auth-card')).toContainText(/S\s*LEIL|SLEIL/);
  await expect(page.locator('.auth-eyebrow')).toContainText('SOLEIL PICTURES');
  await expect(page.getByPlaceholder('you@soleilpictures.com')).toBeVisible();
});

test('auth input gains a soleil glow ring on focus', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder('you@soleilpictures.com');
  await input.focus();
  const shadow = await input.evaluate(el => getComputedStyle(el).boxShadow);
  expect(shadow).toContain('rgb(212, 160, 74)');
});
```

- [ ] **Step 5: Run Playwright tests**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npx playwright test
```

Expected: all four smoke tests + the two new polish tests pass. (If Playwright reports the auth-screen test gives `.auth-screen` not visible, the build cache may be stale — run `npm run build` first then re-run.)

- [ ] **Step 6: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/auth/AuthGate.jsx boards/src/styles.css boards/tests/boards-smoke.spec.js boards/tests/polish-smoke.spec.js
git commit -m "$(cat <<'EOF'
Rebuild auth screen with Soleil wordmark and glow

Replaces the small-mark + plain-title auth header with the Brandon-
Grotesque <SoleilWordmark/> and a soft 800px radial soleil-gold glow
behind it. Refreshes input focus to use the soleil glow ring, button
to use cream-on-warm-dark, and hint copy. Splash loading uses the
glowing mark. Adds polish-smoke tests asserting the new chrome.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Sidebar restructure

**Files:**
- Modify: `boards/src/App.jsx` (sidebar block, ~lines 833–927)
- Modify: `boards/src/local/LocalBoardsApp.jsx` (mirror sidebar; analogous block around line 480)
- Modify: `boards/src/styles.css` (sidebar `.sidebar`, `.sb-*` rules)

- [ ] **Step 1: Replace the sidebar JSX in `App.jsx`**

In `boards/src/App.jsx`, replace the `<aside className="sidebar">…</aside>` block (lines 833–927) with:

```jsx
      <aside className="sidebar">
        <div className="sb-brand">
          {tweak.compactSidebar ? (
            <SoleilMark size={22} color="var(--soleil)" glow />
          ) : (
            <SoleilWordmark size="block" />
          )}
          <button
            className="sb-collapse"
            onClick={() => setTweak('compactSidebar', !tweak.compactSidebar)}
            title={tweak.compactSidebar ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon as={tweak.compactSidebar ? PanelLeftOpen : PanelLeftClose} size={16} />
          </button>
        </div>

        {!tweak.compactSidebar && (
          <>
            <div className="sb-group">
              <div className="sb-group-label t-eyebrow">WORKSPACES</div>
              <button className="sb-group-add" onClick={addNewWorkspace} title="New workspace">
                <Icon as={Plus} size={14} />
              </button>
            </div>
            {(workspaces || []).map(w => {
              const isMine = w.id === personalWorkspaceId;
              const isActive = w.id === workspace.id;
              return (
                <div key={w.id}
                     className={`sb-row ${isActive ? 'active' : ''}`}
                     onClick={() => onSwitchWorkspace(w.id)}
                     title={isMine ? 'Personal workspace' : 'Shared with me'}>
                  <span className="sb-dot" style={{ background: isMine ? 'var(--soleil)' : 'var(--ink-3)' }} />
                  <span className="sb-row-label">{w.name}</span>
                  {!isMine && <span className="sb-shared-tag t-meta">SHARED</span>}
                </div>
              );
            })}

            <div className="sb-group">
              <div className="sb-group-label t-eyebrow">CURRENT</div>
            </div>
            <div className={`sb-row ${currentId === rootBoard.id ? 'active' : ''}`}
                 onClick={() => setStack([rootBoard.id])}>
              <Icon as={LayoutGrid} size={14} />
              <span className="sb-row-label">{rootBoard.name}</span>
            </div>
            <div className={`sb-row ${tweak.showInbox ? 'active' : ''}`}
                 onClick={() => setTweak('showInbox', !tweak.showInbox)}
                 title={tweak.showInbox ? 'Hide inbox' : 'Show inbox'}>
              <Icon as={InboxIcon} size={14} />
              <span className="sb-row-label">Inbox</span>
              <span className="sb-row-count t-meta">{inbox.items.length}</span>
            </div>
            <div className="sb-row" onClick={() => setPickerOpen(true)}>
              <Icon as={Search} size={14} />
              <span className="sb-row-label">Search boards</span>
            </div>

            <div className="sb-group">
              <div className="sb-group-label t-eyebrow">STACK</div>
            </div>
            {stack.map((id, i) => {
              const c = crumbs[i];
              return (
                <div key={`${id}-${i}`}
                     className={`sb-row sb-row-tree ${i === stack.length - 1 ? 'active' : ''}`}
                     style={{ paddingLeft: 16 + i * 12 }}
                     onClick={() => goTo(i)}>
                  <span className="sb-dot" style={{ background: 'var(--ink-3)' }} />
                  <span className="sb-row-label">{c.name}</span>
                </div>
              );
            })}
            {childBoards.map(b => (
              <div key={b.id}
                   className="sb-row sb-row-tree"
                   style={{ paddingLeft: 16 + stack.length * 12 }}
                   draggable
                   onDragStart={(e) => {
                     e.dataTransfer.setData(BOARD_REF_MIME, JSON.stringify({ boardId: b.id, name: b.name }));
                     e.dataTransfer.effectAllowed = 'copy';
                   }}
                   onClick={() => openBoard(b.id)}
                   title="Click to open · drag onto a canvas to embed">
                <span className="sb-dot" style={{ background: 'var(--ink-3)' }} />
                <span className="sb-row-label">{b.name}</span>
              </div>
            ))}
          </>
        )}

        <div className="sb-foot">
          <Avatar name={user.email || 'You'} color="var(--soleil)" size={28} />
          {!tweak.compactSidebar && (
            <div className="sb-me">
              <div className="sb-me-name" title={user.email}>{user.email?.split('@')[0] || 'You'}</div>
              <div className="sb-me-org t-meta">{workspace.name}</div>
            </div>
          )}
        </div>
      </aside>
```

Then update the imports at the top of `App.jsx` (around line 11 — wherever the existing `import { Avatar, SoleilMark } from './components/primitives.jsx';` is) to:

```jsx
import { Avatar, SoleilMark } from './components/primitives.jsx';
import { SoleilWordmark } from './components/SoleilWordmark.jsx';
import { Icon } from './components/Icon.jsx';
import { Plus, PanelLeftClose, PanelLeftOpen, Search, LayoutGrid, Inbox as InboxIcon } from './lib/icons.js';
```

- [ ] **Step 2: Replace the sidebar CSS in `styles.css`**

Find the existing `.sidebar`, `.sb-brand*`, `.sb-section*`, `.sb-item*`, `.sb-board*`, `.sb-tree`, `.sb-foot`, `.sb-me*`, `.sb-shared-tag` rules. Replace the whole sidebar section with:

```css
/* ─────────────────────────────── Sidebar ────────────────────────────────── */

.app { grid-template-columns: 240px 1fr; }
.app.sb-collapsed { grid-template-columns: 56px 1fr; }

.sidebar {
  background: var(--bg-1);
  border-right: 1px solid var(--line-1);
  display: flex;
  flex-direction: column;
  padding: 14px 8px 10px;
  gap: 1px;
  overflow-y: auto;
}

.sb-brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 16px;
  gap: 8px;
}
.sb-collapse {
  background: transparent;
  border: 0;
  color: var(--ink-3);
  width: 28px; height: 28px;
  border-radius: var(--radius);
  display: grid; place-items: center;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.sb-collapse:hover { color: var(--ink-1); background: var(--bg-hov); }
.sb-collapsed .sb-brand { justify-content: center; padding: 6px 0 16px; flex-direction: column; }
.sb-collapsed .sb-collapse { width: 28px; height: 28px; }

.sb-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 12px 6px;
}
.sb-group-label { letter-spacing: 0.18em; }
.sb-group-add {
  background: transparent;
  border: 0;
  color: var(--ink-3);
  width: 22px; height: 22px;
  border-radius: var(--radius);
  display: grid; place-items: center;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.sb-group-add:hover { color: var(--ink-1); background: var(--bg-hov); }

.sb-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius);
  color: var(--ink-1);
  font: 500 12px/1.4 var(--font-sans);
  cursor: pointer;
  position: relative;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
  user-select: none;
}
.sb-row:hover { background: var(--bg-hov); color: var(--ink-0); }
.sb-row.active {
  background: var(--soleil-soft);
  color: var(--ink-0);
}
.sb-row.active::before {
  content: '';
  position: absolute;
  left: 0; top: 6px; bottom: 6px;
  width: 2px;
  background: var(--soleil);
  border-radius: 1px;
}
.sb-row-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-row-count { color: var(--ink-3); }
.sb-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.sb-shared-tag {
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-3);
  color: var(--ink-3);
  letter-spacing: 0.12em;
}

.sb-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 8px 4px;
  border-top: 1px solid var(--line-1);
}
.sb-me { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.sb-me-name { font: 500 13px/1.4 var(--font-sans); color: var(--ink-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sb-me-org  { color: var(--ink-3); }

.sb-collapsed .sb-group,
.sb-collapsed .sb-row,
.sb-collapsed .sb-me { display: none; }
.sb-collapsed .sb-foot { justify-content: center; padding: 12px 0 4px; }
```

- [ ] **Step 3: Mirror the JSX changes in `LocalBoardsApp.jsx`**

`boards/src/local/LocalBoardsApp.jsx` has the same brand block at line 483 (`<div className="sb-brand-mark">…`). Mirror Step 1 there: replace its `<aside className="sidebar">…</aside>` block with the same JSX (using local component scope). The full replacement is the same structurally — substitute `tweak`/`workspace`/etc. references for whatever the local file uses. Apply minimal diff: just the brand block + sidebar group/row class names + import additions for `SoleilWordmark`, `Icon`, and the icon set.

If the file's structure deviates substantially (e.g., no workspace switcher), only update the brand block + group labels + use the new `.sb-row` class on items that exist. Skip cleanly.

- [ ] **Step 4: Verify build + dev server**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

Expected: build succeeds with no missing-import errors.

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npx playwright test boards-smoke.spec.js
```

Expected: existing local-QA tests still pass (sidebar still renders the workspace and inbox rows; collapse toggle still works).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/App.jsx boards/src/local/LocalBoardsApp.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Restructure sidebar with brand block, eyebrows, and soleil rows

Replaces the .sb-item / .sb-board / .sb-tree / .sb-section system with
a single .sb-row + .sb-group + .sb-dot vocabulary. Brand block uses
<SoleilWordmark/> when expanded and the glowing mark when collapsed.
Group labels use Brandon-Grotesque eyebrow styling. Active row gets
soleil-soft fill + 2px soleil left bar. Account block padded to 28px
avatar with soleil gradient fallback color.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: Topbar refresh

**Files:**
- Modify: `boards/src/App.jsx` (topbar block, ~lines 929–1000)
- Modify: `boards/src/styles.css` (topbar `.topbar`, `.tb-*`, `.crumbs` rules)

- [ ] **Step 1: Inspect the existing topbar**

Read `boards/src/App.jsx` lines 929 through ~1010 to identify the full topbar structure (the `<div className="topbar">` block). Note all the buttons and their handlers — the JSX rebuild below preserves every existing handler / `onClick`, only replacing the visual structure.

- [ ] **Step 2: Replace the topbar JSX**

Replace the entire `<div className="topbar">…</div>` block with the following structure. This preserves every handler (collapse toggle, breadcrumb navigation, view toggle, share, add menu, settings, theme, presence) — re-bind each handler to the new element.

```jsx
<div className="topbar">
  <div className="tb-left">
    <button className="tb-icon" onClick={() => setTweak('compactSidebar', !tweak.compactSidebar)} title="Collapse sidebar">
      <Icon as={tweak.compactSidebar ? PanelLeftOpen : PanelLeftClose} size={16} />
    </button>
    <div className="crumbs">
      {crumbs.map((c, i) => (
        <React.Fragment key={`${c.id}-${i}`}>
          {i > 0 && <span className="crumb-sep" aria-hidden="true">›</span>}
          <span className={`crumb ${i === crumbs.length - 1 ? 'here' : 'clk'}`} onClick={() => goTo(i)}>{c.name}</span>
        </React.Fragment>
      ))}
    </div>
  </div>

  <div className="tb-center">
    <div className="view-pill">
      <button
        className={`view-pill-btn ${currentBoard.view !== 'list' ? 'on' : ''}`}
        onClick={() => setView('canvas')}
      >Canvas</button>
      <button
        className={`view-pill-btn ${currentBoard.view === 'list' ? 'on' : ''}`}
        onClick={() => setView('list')}
      >List</button>
    </div>
  </div>

  <div className="tb-right">
    <PresenceStack awareness={awareness} self={user} />
    <button className="tb-btn" onClick={onShare} title="Share">
      <Icon as={Share2} size={14} /> <span className="tb-btn-label">Share</span>
    </button>
    <button className="tb-icon" onClick={() => setAddMenuOpen(true)} title="Add card">
      <Icon as={Plus} size={16} />
    </button>
    <button className="tb-icon" onClick={() => setTweak('showTweaks', true)} title="Settings">
      <Icon as={Settings} size={16} />
    </button>
  </div>
</div>
```

If your existing topbar wires extra handlers (theme toggle, history, feedback) that don't appear above, append them to `tb-right` before the settings button using the same `tb-icon` pattern. Look for the existing `title="Toggle theme"`, `title="History"`, `title="Feedback"` buttons in the original code and re-add them with Lucide icons (Sun/Moon, History, MessageSquare from `lib/icons.js`).

Add `Settings, Share2, PanelLeftClose, PanelLeftOpen, Plus` to the existing icon imports at the top of `App.jsx` (already added in B2 except `Settings`, `Share2`).

- [ ] **Step 3: Replace the topbar CSS**

In `styles.css`, find the existing `.topbar`, `.tb-btn`, `.crumbs`, `.crumbs .sep`, `.crumb` rules and replace with:

```css
/* ─────────────────────────────── Topbar ─────────────────────────────────── */

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--line-1);
  flex-shrink: 0;
  gap: 12px;
}
.tb-left, .tb-right { display: flex; align-items: center; gap: 6px; }
.tb-center { flex: 1; display: flex; justify-content: center; }

.tb-icon, .tb-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  background: transparent;
  border: 0;
  color: var(--ink-2);
  border-radius: var(--radius);
  cursor: pointer;
  font: 500 13px/1 var(--font-sans);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.tb-icon { padding: 0; width: 32px; justify-content: center; }
.tb-icon:hover, .tb-btn:hover { color: var(--ink-0); background: var(--bg-hov); }
.tb-btn-label { font: 500 13px/1 var(--font-sans); }

.crumbs { display: flex; align-items: center; gap: 6px; min-width: 0; }
.crumb {
  font: 500 13px/1 var(--font-sans);
  color: var(--ink-2);
  padding: 6px 8px;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crumb:hover { background: var(--bg-hov); color: var(--ink-0); }
.crumb.here { color: var(--ink-0); cursor: default; }
.crumb.here:hover { background: transparent; }
.crumb-sep { color: var(--ink-3); font: 400 14px/1 var(--font-sans); }

.view-pill {
  display: inline-flex;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 2px;
  gap: 0;
}
.view-pill-btn {
  background: transparent;
  border: 0;
  color: var(--ink-2);
  padding: 4px 14px;
  border-radius: 999px;
  font: 500 12px/1 var(--font-sans);
  cursor: pointer;
  transition: background var(--dur-base) var(--ease), color var(--dur-base) var(--ease);
}
.view-pill-btn.on { background: var(--bg-4); color: var(--ink-0); }
.view-pill-btn:not(.on):hover { color: var(--ink-1); }
```

- [ ] **Step 4: Verify build + tests**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build && npx playwright test boards-smoke.spec.js
```

Expected: build passes; the existing local-QA test that calls `getByRole('button', { name: 'List' })` still passes (the view pill renders a literal `List` button).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/App.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Refresh topbar with view pill, breadcrumb, and Lucide icons

Replaces the cramped 1-row topbar with a 48px three-zone layout:
left (collapse + crumbs), center (Canvas/List view pill), right
(presence + share + add + settings). Crumb separator switches from
mono / to Aileron ›. All icons swap to Lucide via the Icon wrapper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: Board grid editorial layout

**Files:**
- Modify: `boards/src/components/BoardPicker.jsx`
- Modify: `boards/src/styles.css` (BoardPicker `.picker-*` section)

- [ ] **Step 1: Read the existing BoardPicker structure**

```bash
cat /Users/andrewconklin/soleilpictures-1/boards/src/components/BoardPicker.jsx
```

Note the prop signature, board list source, and click handlers. The rebuild below preserves the prop shape — only the rendered structure changes.

- [ ] **Step 2: Replace `BoardPicker.jsx` body**

Replace the entire return / rendering section (everything after the prop destructure and any pre-render `useMemo`s) with the editorial grid below. Keep imports and prop destructure intact; add `SoleilMark`, `EmptyState`, `Filter`, `Icon` imports.

```jsx
// Top of file — add to existing imports:
import { Icon } from './Icon.jsx';
import { Filter, Search, X } from '../lib/icons.js';
import { COVER_TINTS } from './primitives.jsx';

// …existing prop destructure + state…

  // Replace the main return with this editorial layout:
  return (
    <div className="picker-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="picker-panel surface-frosted">
        <div className="picker-head">
          <div>
            <div className="t-h1">BOARDS</div>
            <div className="picker-meta t-meta">{boards.length} board{boards.length === 1 ? '' : 's'}</div>
          </div>
          <div className="picker-tools">
            <div className="picker-search">
              <Icon as={Search} size={14} />
              <input
                type="text"
                placeholder="Search boards"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
            <button className="tb-icon" onClick={onClose} title="Close"><Icon as={X} size={16} /></button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="picker-empty"><div className="t-meta">No boards match.</div></div>
        ) : (
          <div className="picker-grid">
            {filtered.map(b => {
              const tintHex = COVER_TINTS[b.cover] || COVER_TINTS.neutral;
              return (
                <button key={b.id} className="picker-card" onClick={() => onPick(b.id)}>
                  <div
                    className="picker-cover"
                    style={{ background: `linear-gradient(135deg, ${tintHex}, color-mix(in oklab, ${tintHex} 40%, var(--bg-2)))` }}
                  />
                  <div className="picker-info">
                    <div className="t-eyebrow picker-eyebrow">{b.workspaceName || 'WORKSPACE'}</div>
                    <div className="picker-title t-h3">{b.name}</div>
                    <div className="picker-card-meta t-meta">{b.metaLine || 'Edited recently'}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
```

If the existing component already maintains a `query`, `filtered`, and `boards` shape, reuse them; otherwise add a small `useMemo` over the boards list and a `query` state.

- [ ] **Step 3: Replace BoardPicker CSS**

In `styles.css`, find any existing `.picker-*` rules and replace with:

```css
/* ──────────────────────────── Board picker ──────────────────────────────── */

.picker-modal {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(2px);
  display: grid; place-items: center;
  padding: 32px;
  animation: pickerFade var(--dur-slow) var(--ease);
}
@keyframes pickerFade { from { opacity: 0; } to { opacity: 1; } }
.picker-panel {
  width: 100%;
  max-width: 1100px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.picker-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 28px 28px 16px;
  border-bottom: 1px solid var(--line-1);
  gap: 16px;
}
.picker-meta { margin-top: 6px; }
.picker-tools { display: flex; align-items: center; gap: 8px; }
.picker-search {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 32px;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  color: var(--ink-2);
  transition: box-shadow var(--dur-base) var(--ease), border-color var(--dur-base) var(--ease);
}
.picker-search:focus-within { border-color: transparent; box-shadow: var(--shadow-glow); }
.picker-search input {
  background: transparent;
  border: 0; outline: none;
  color: var(--ink-0);
  font: 500 13px/1 var(--font-sans);
  width: 220px;
}
.picker-search input::placeholder { color: var(--ink-3); }
.picker-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 24px;
  padding: 24px 28px 28px;
  overflow-y: auto;
}
@media (max-width: 1080px) { .picker-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 820px)  { .picker-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px)  { .picker-grid { grid-template-columns: 1fr; } }
.picker-card {
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  transition: transform var(--dur-base) var(--ease);
}
.picker-card:hover { transform: translateY(-2px); }
.picker-card:focus-visible { outline: none; box-shadow: var(--shadow-glow); }
.picker-cover {
  aspect-ratio: 4 / 3;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-2);
  box-shadow: var(--shadow-1);
  transition: box-shadow var(--dur-base) var(--ease);
}
.picker-card:hover .picker-cover { box-shadow: var(--shadow-2); }
.picker-info { padding: 12px 4px 0; display: flex; flex-direction: column; gap: 4px; }
.picker-eyebrow { color: var(--ink-3); }
.picker-title { color: var(--ink-0); }
.picker-card-meta { color: var(--ink-2); }
.picker-empty { padding: 60px 28px; display: grid; place-items: center; }
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

Expected: succeeds. (No automated test for BoardPicker; visual verification only — open the dev server, click "Search boards" in the sidebar.)

- [ ] **Step 5: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/BoardPicker.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Rebuild BoardPicker as an editorial 4-column grid

Replaces the row-list picker with a frosted-glass modal containing a
Brandon-Grotesque BOARDS title, a soleil-glow search input, and a
4 / 3 / 2 / 1 responsive grid of cards. Each card has a 4:3 cover
gradient driven by COVER_TINTS, an eyebrow workspace label, an
Aileron 16/600 title, and a meta line. Hover lifts the card.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B5: Empty states component + apply across surfaces

**Files:**
- Create: `boards/src/components/EmptyState.jsx`
- Modify: `boards/src/styles.css` (add `.empty-state` block)
- Modify: `boards/src/components/InboxPanel.jsx` (use empty state)
- Modify: `boards/src/components/ListSurface.jsx` (use empty state)
- Modify: `boards/src/components/CanvasSurface.jsx` (replace placeholder hint with empty state)

- [ ] **Step 1: Create the EmptyState component**

```jsx
// boards/src/components/EmptyState.jsx
import { Icon } from './Icon.jsx';

export function EmptyState({ icon, title, body, action, glow = false }) {
  return (
    <div className="empty-state">
      {icon && (
        <div className="empty-icon" style={glow ? { filter: 'drop-shadow(0 0 16px rgba(212,160,74,.30))', color: 'var(--soleil)' } : undefined}>
          <Icon as={icon} size={48} />
        </div>
      )}
      {title && <div className="empty-title t-h1">{title}</div>}
      {body && <div className="empty-body t-body">{body}</div>}
      {action && (
        <button className="empty-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS block**

In `styles.css`, append after the `.picker-*` block:

```css
/* ─────────────────────────── Empty states ───────────────────────────────── */

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  max-width: 360px;
  margin: 0 auto;
  padding: 40px 24px;
  color: var(--ink-2);
}
.empty-icon { color: var(--ink-3); }
.empty-title { color: var(--ink-1); }
.empty-body { color: var(--ink-2); }
.empty-action {
  margin-top: 8px;
  height: 36px;
  padding: 0 16px;
  background: var(--ink-0);
  color: var(--bg-0);
  border: 0;
  border-radius: var(--radius);
  font: 600 13px/1 var(--font-sans);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-base) var(--ease);
}
.empty-action:hover { box-shadow: var(--shadow-1); transform: translateY(-1px); }
```

- [ ] **Step 3: Use in InboxPanel for the empty state**

Open `boards/src/components/InboxPanel.jsx`. Find the place where it renders when `inbox.items.length === 0` (search for `length === 0` or look for the placeholder text). Replace whatever it currently renders for the empty case with:

```jsx
{inbox.items.length === 0 ? (
  <EmptyState icon={InboxIcon} title="Inbox is clear" body="Drop files or paste links here." />
) : (
  /* existing items rendering */
)}
```

Add to the imports at the top of `InboxPanel.jsx`:

```jsx
import { EmptyState } from './EmptyState.jsx';
import { Inbox as InboxIcon } from '../lib/icons.js';
```

- [ ] **Step 4: Use in ListSurface for an empty list**

Open `boards/src/components/ListSurface.jsx`. Find where it handles "no items" and replace with:

```jsx
import { EmptyState } from './EmptyState.jsx';
import { List } from '../lib/icons.js';

// …in the component body:
{items.length === 0 && (
  <EmptyState icon={List} title="Empty list" body="Add an item to get started." />
)}
```

If the file's data shape uses different variable names, substitute accordingly — the goal is one `<EmptyState/>` instead of inline placeholder JSX.

- [ ] **Step 5: Verify build + tests**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build && npx playwright test
```

Expected: passes. Existing inbox empty-state assertion (`page.locator('.inbox-title')`) still passes because `.inbox-title` is unchanged in the panel header.

- [ ] **Step 6: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/EmptyState.jsx boards/src/styles.css boards/src/components/InboxPanel.jsx boards/src/components/ListSurface.jsx
git commit -m "$(cat <<'EOF'
Add shared EmptyState component and apply to inbox + list

Adds a single <EmptyState icon title body action glow/> with Brandon
Grotesque title, Aileron body, and an optional cream-on-dark action
button. Replaces inline empty-state JSX in InboxPanel and ListSurface
so every empty surface reads as intentional, not placeholder text.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase C — Overlays & doc chrome

### Task C1: Modal frosted-glass treatment

**Files:**
- Modify: `boards/src/styles.css` (modal section — add shared `.modal-*` classes)
- Modify: `boards/src/components/CustomFontsModal.jsx`, `HistoryModal.jsx`, `AppFeedback.jsx` (apply classes)

- [ ] **Step 1: Add shared modal CSS**

Append to `styles.css`:

```css
/* ──────────────────────────────── Modals ────────────────────────────────── */

.modal-overlay {
  position: fixed; inset: 0; z-index: 220;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(2px);
  display: grid; place-items: center;
  padding: 32px;
  animation: modalFade var(--dur-slow) var(--ease);
}
@keyframes modalFade { from { opacity: 0; } to { opacity: 1; } }

.modal-panel {
  /* inherits .surface-frosted */
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalRise var(--dur-slow) var(--ease);
}
@keyframes modalRise { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line-1);
}
.modal-title { font: 600 16px/1.3 var(--font-sans); color: var(--ink-0); letter-spacing: -0.01em; }
.modal-close {
  width: 28px; height: 28px;
  background: transparent; border: 0;
  color: var(--ink-2);
  border-radius: var(--radius);
  display: grid; place-items: center;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.modal-close:hover { background: var(--bg-hov); color: var(--ink-0); }

.modal-body { padding: 20px; overflow-y: auto; }
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--line-1);
}

.btn-primary {
  height: 32px;
  padding: 0 14px;
  background: var(--ink-0);
  color: var(--bg-0);
  border: 0;
  border-radius: var(--radius);
  font: 600 13px/1 var(--font-sans);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-base) var(--ease);
}
.btn-primary:hover { box-shadow: var(--shadow-1); transform: translateY(-1px); }
.btn-secondary {
  height: 32px;
  padding: 0 14px;
  background: var(--bg-3);
  color: var(--ink-1);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  font: 500 13px/1 var(--font-sans);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.btn-secondary:hover { background: var(--bg-hov); color: var(--ink-0); }
```

- [ ] **Step 2: Apply classes to CustomFontsModal, HistoryModal, AppFeedback**

For each of these three files, locate the outer modal container and replace:
- the outer overlay `<div>` with `<div className="modal-overlay">`
- the inner panel `<div>` with `<div className="modal-panel surface-frosted">`
- the header `<div>` with `<div className="modal-head">` containing a `<div className="modal-title">{title}</div>` and `<button className="modal-close">` using `<Icon as={X} size={16}/>`
- the body with `<div className="modal-body">`
- the footer (if any) with `<div className="modal-foot">` and primary/secondary buttons using `.btn-primary` / `.btn-secondary`

Each modal's specific contents (font picker rows, history entries, feedback form) stay unchanged — only the shell is rebuilt.

For each file, add at the top:

```jsx
import { Icon } from './Icon.jsx';
import { X } from '../lib/icons.js';
```

- [ ] **Step 3: Build + verify each modal opens**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

Expected: all three files compile.

- [ ] **Step 4: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/styles.css boards/src/components/CustomFontsModal.jsx boards/src/components/HistoryModal.jsx boards/src/components/AppFeedback.jsx
git commit -m "$(cat <<'EOF'
Frosted-glass modal shell for fonts / history / feedback

Adds shared .modal-overlay / .modal-panel / .modal-head / .modal-body
/ .modal-foot classes built on .surface-frosted. Modals slide in 8px
+ fade over --dur-slow. Adds .btn-primary (cream on warm-dark) and
.btn-secondary (outline) used across modal footers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C2: Floating menus (color picker + slash menu + link/embed/export pickers + context menus)

**Files:**
- Modify: `boards/src/styles.css` (add `.menu-*` shared classes)
- Modify: `boards/src/components/ColorPicker.jsx` (frosted + soleil ring)
- Modify: `boards/src/components/DocSlashMenu.jsx`
- Modify: `boards/src/components/DocLinkPicker.jsx`
- Modify: `boards/src/components/DocBoardEmbedPicker.jsx`
- Modify: `boards/src/components/DocExportMenu.jsx`
- Modify: `boards/src/components/CardContextMenu.jsx`
- Modify: `boards/src/components/BackgroundContextMenu.jsx`

- [ ] **Step 1: Add shared menu CSS**

Append to `styles.css`:

```css
/* ────────────────────────── Floating menus ──────────────────────────────── */

.menu {
  /* Use with .surface-frosted on the same element */
  min-width: 200px;
  max-width: 320px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-radius: var(--radius-md);
  animation: menuRise var(--dur-base) var(--ease);
}
@keyframes menuRise { from { transform: translateY(4px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.menu-section-label {
  /* Use with .t-eyebrow */
  padding: 10px 12px 4px;
  color: var(--ink-3);
}

.menu-divider {
  height: 1px;
  background: var(--line-1);
  margin: 4px 0;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--radius);
  background: transparent;
  border: 0;
  color: var(--ink-1);
  font: 500 13px/1 var(--font-sans);
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.menu-item:hover, .menu-item.kbd-active { background: var(--bg-hov); color: var(--ink-0); }
.menu-item.kbd-active { background: var(--soleil-soft); }
.menu-item-shortcut { margin-left: auto; color: var(--ink-3); font-family: var(--font-mono); font-size: 11px; }

/* Color picker swatches */
.swatch {
  width: 24px; height: 24px;
  border-radius: var(--radius);
  border: 1px solid rgba(255,255,255,0.10);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
  padding: 0;
}
.swatch:hover { transform: scale(1.08); }
.swatch.selected { box-shadow: 0 0 0 2px var(--soleil), 0 0 0 4px var(--soleil-soft); }
```

- [ ] **Step 2: Update ColorPicker container + swatches**

Open `boards/src/components/ColorPicker.jsx`. Find the outer container `<div>` (the one rendered into a portal). Replace its `className` with `"menu surface-frosted"` and ensure the inline style does not also set `background` / `border` (let the class handle it). Find the swatch elements (likely existing class like `.swatch`) and ensure each renders as `<button className={selected ? 'swatch selected' : 'swatch'} style={{ background: color }} />`. Ensure section labels above sub-groups (RECENT, PALETTE, CUSTOM) use `<div className="t-eyebrow menu-section-label">RECENT</div>`.

- [ ] **Step 3: Update DocSlashMenu, DocLinkPicker, DocBoardEmbedPicker, DocExportMenu, CardContextMenu, BackgroundContextMenu**

For each: replace the outer container's `className` with `"menu surface-frosted"` and replace each menu row with `<button className={isActive ? 'menu-item kbd-active' : 'menu-item'} onClick={…}>`. Use `<Icon as={…} size={14}/>` for each row's leading icon. Use `<span className="menu-item-shortcut">⌘K</span>` for trailing shortcut hints. Use `<div className="t-eyebrow menu-section-label">SECTION</div>` for group labels.

For each file add at top:
```jsx
import { Icon } from './Icon.jsx';
```
plus the specific Lucide icons that file uses from `../lib/icons.js`.

- [ ] **Step 4: Build + verify**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

Expected: succeeds. Open dev server (`npm run dev`); manually open the slash menu (type `/` in a doc) and right-click on a card to verify the frosted treatment.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/styles.css boards/src/components/ColorPicker.jsx boards/src/components/DocSlashMenu.jsx boards/src/components/DocLinkPicker.jsx boards/src/components/DocBoardEmbedPicker.jsx boards/src/components/DocExportMenu.jsx boards/src/components/CardContextMenu.jsx boards/src/components/BackgroundContextMenu.jsx
git commit -m "$(cat <<'EOF'
Unify floating menus on .menu + .surface-frosted

Adds shared .menu / .menu-item / .menu-divider / .menu-section-label
classes applied to color picker, slash menu, link/embed/export pickers,
and context menus. Color picker swatch gets soleil-gold double-ring
on selection. Keyboard-active items get soleil-soft background.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C3: Inbox + Tweaks panel drawers

**Files:**
- Modify: `boards/src/components/InboxPanel.jsx`
- Modify: `boards/src/components/TweaksPanel.jsx`
- Modify: `boards/src/styles.css` (`.drawer-*` + `.inbox-*` + `.tweaks-*` sections)

- [ ] **Step 1: Add shared drawer CSS**

Append to `styles.css`:

```css
/* ──────────────────────────── Drawers ───────────────────────────────────── */

.drawer {
  position: fixed;
  top: 0; bottom: 0; right: 0;
  background: var(--bg-1);
  border-left: 1px solid var(--line-1);
  display: flex; flex-direction: column;
  z-index: 80;
  box-shadow: var(--shadow-2);
  animation: drawerSlide var(--dur-base) var(--ease);
}
@keyframes drawerSlide { from { transform: translateX(8px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
.drawer.w-inbox  { width: 320px; }
.drawer.w-tweaks { width: 360px; }

.drawer-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line-1);
  flex-shrink: 0;
}
.drawer-title { /* use .t-eyebrow */ color: var(--ink-1); }
.drawer-body { flex: 1; overflow-y: auto; padding: 12px 12px 16px; display: flex; flex-direction: column; gap: 6px; }
```

- [ ] **Step 2: Apply to InboxPanel**

In `boards/src/components/InboxPanel.jsx`, replace the outer `<div>` and header with:

```jsx
<div className="drawer w-inbox">
  <div className="drawer-head">
    <div className="t-eyebrow drawer-title">INBOX</div>
    <button className="modal-close" onClick={onClose}><Icon as={X} size={16} /></button>
  </div>
  <div className="drawer-body">
    {/* existing items rendering, or <EmptyState …/> */}
  </div>
</div>
```

(Keep the existing `.inbox-title` class only if a Playwright test depends on it — Step 4 verifies. If you remove `.inbox-title`, also update the test in `boards-smoke.spec.js`.)

Looking at the existing test (`page.locator('.inbox-title', { hasText: 'Inbox' })`), keep `.inbox-title` as a hidden marker:

```jsx
<div className="t-eyebrow drawer-title inbox-title">INBOX</div>
```

- [ ] **Step 3: Apply to TweaksPanel**

Same pattern — outer `<div className="drawer w-tweaks">`, header eyebrow + close, body. Existing tweaks contents stay unchanged.

- [ ] **Step 4: Verify**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build && npx playwright test
```

Expected: passes (the inbox-title selector still finds the row).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/styles.css boards/src/components/InboxPanel.jsx boards/src/components/TweaksPanel.jsx
git commit -m "$(cat <<'EOF'
Refine inbox and tweaks panels as side drawers

Adds shared .drawer / .drawer-head / .drawer-body classes. Both
panels slide in 8px + fade over --dur-base. Headers use eyebrow type
+ shared .modal-close. Inbox stays width 320, tweaks 360.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C4: Tool options bar with Lucide icons + tooltips

**Files:**
- Modify: `boards/src/components/ToolOptionsBar.jsx`
- Modify: `boards/src/styles.css` (`.tool-options-*` rules)

- [ ] **Step 1: Inspect existing structure**

```bash
grep -n "className=" /Users/andrewconklin/soleilpictures-1/boards/src/components/ToolOptionsBar.jsx | head -40
```

Note every existing button + its handler.

- [ ] **Step 2: Replace each text-labeled button with `<Icon as={…} size={14}/>` + `title` tooltip**

In `ToolOptionsBar.jsx`, for every formatting button (Bold, Italic, Align Left, etc.) replace the visible text with the Lucide icon, keep the `title` attribute for the native tooltip, and apply class `"tool-btn"`.

Add at top:
```jsx
import { Icon } from './Icon.jsx';
import { Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered, Quote, Link, Bookmark, Search, Type, Palette } from '../lib/icons.js';
```

- [ ] **Step 3: Add CSS**

Append to `styles.css`:

```css
/* ─────────────────────── Tool options bar ───────────────────────────────── */

.tool-options {
  position: absolute;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 6px;
  border-radius: var(--radius-md);
  /* combine with .surface-frosted */
}
.tool-btn {
  width: 26px; height: 26px;
  display: grid; place-items: center;
  background: transparent;
  border: 0;
  color: var(--ink-2);
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.tool-btn:hover { background: var(--bg-hov); color: var(--ink-0); }
.tool-btn.on    { background: var(--soleil-soft); color: var(--ink-0); }
.tool-divider { width: 1px; height: 18px; background: var(--line-1); margin: 0 4px; }
```

Ensure the outer container has both classes: `<div className="tool-options surface-frosted">`.

- [ ] **Step 4: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/ToolOptionsBar.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Tool options bar — Lucide icons, frosted glass, tooltips

Replaces text labels with Lucide icons inside 26px square buttons
arranged on a frosted-glass bar with thin dividers. Active state
uses soleil-soft background. Native title= tooltips remain so users
can hover-discover.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C5: Doc toolbar refresh

**Files:**
- Modify: `boards/src/components/DocToolbar.jsx`
- Modify: `boards/src/styles.css` (`.doc-toolbar` + `.doc-toolbar-*`)

- [ ] **Step 1: Replace text/SVG icons with Lucide via Icon wrapper**

In `boards/src/components/DocToolbar.jsx`:
- Replace each formatting button's visible icon with `<Icon as={LucideName} size={16} />`.
- Wrap groups (text format, alignment, lists, insert) in `<div className="doc-toolbar-group">…</div>` separated by `<span className="doc-toolbar-divider"/>`.
- Font picker: collapse the inline label to `<span className="doc-toolbar-pill">{currentFont} <Icon as={ChevronDown} size={12}/></span>`.
- Heading picker: same pattern.
- Color/highlight: `<button className="doc-toolbar-color" style={{ background: currentColor }} />` + `<Icon as={ChevronDown} size={12}/>`.

Add imports:
```jsx
import { Icon } from './Icon.jsx';
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Code, Link, Bookmark, Search,
  ChevronDown, Undo, Redo,
} from '../lib/icons.js';
```

- [ ] **Step 2: Replace doc-toolbar CSS**

In `styles.css`, find the existing `.doc-toolbar*` block and replace with:

```css
/* ─────────────────────────── Doc toolbar ────────────────────────────────── */

.doc-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 44px;
  padding: 0 12px;
  background: rgba(20,18,15,.78);
  backdrop-filter: blur(20px) saturate(1.2);
  border-bottom: 1px solid var(--line-1);
  position: sticky; top: 0; z-index: 40;
  flex-shrink: 0;
}
[data-theme='light'] .doc-toolbar { background: rgba(255,252,246,.82); }
.doc-toolbar-group { display: inline-flex; align-items: center; gap: 2px; }
.doc-toolbar-divider { width: 1px; height: 20px; background: var(--line-1); margin: 0 4px; }
.doc-toolbar .tool-btn { width: 28px; height: 28px; }
.doc-toolbar-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius);
  background: transparent;
  border: 0;
  color: var(--ink-1);
  font: 500 12px/1 var(--font-sans);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.doc-toolbar-pill:hover { background: var(--bg-hov); }
.doc-toolbar-color {
  display: inline-flex;
  align-items: center; justify-content: center;
  width: 22px; height: 22px;
  border-radius: var(--radius);
  border: 1px solid var(--line-2);
  cursor: pointer;
}
```

- [ ] **Step 3: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/DocToolbar.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Doc toolbar — Lucide icons, frosted, font/heading pills

Switches every doc toolbar button to Lucide icons (1.5px stroke,
16px). Groups format/align/list/insert behind thin dividers. Font
and heading pickers collapse to label + chevron pills. Color and
highlight buttons render as small swatches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C6: Doc page tree + outline / bookmarks / comments rails

**Files:**
- Modify: `boards/src/components/DocSurface.jsx` (rail layout, tabs)
- Modify: `boards/src/components/DocPageTree.jsx`
- Modify: `boards/src/components/DocOutlinePanel.jsx`, `DocBookmarksPanel.jsx`, `DocCommentsPanel.jsx`
- Modify: `boards/src/styles.css` (`.doc-rail-*`, `.doc-tabs`, `.doc-tree-*`)

- [ ] **Step 1: Replace doc rail / tabs CSS**

Find the existing `.doc-tree-head`, `.doc-tabs`, `.doc-rail-toggle` rules in `styles.css` and replace the doc-rail section with:

```css
/* ─────────────────────────── Doc rails & tabs ───────────────────────────── */

.doc-rail-left  { width: 240px; background: var(--bg-1); border-right: 1px solid var(--line-1); display: flex; flex-direction: column; flex-shrink: 0; position: relative; }
.doc-rail-right { width: 280px; background: var(--bg-1); border-left:  1px solid var(--line-1); display: flex; flex-direction: column; flex-shrink: 0; position: relative; }

.doc-tree-head, .doc-rail-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 8px;
  border-bottom: 1px solid var(--line-1);
  flex-shrink: 0;
  gap: 8px;
}
.doc-rail-label { /* use .t-eyebrow */ color: var(--ink-3); }
.doc-rail-add {
  width: 22px; height: 22px;
  background: transparent; border: 0;
  color: var(--ink-3);
  border-radius: var(--radius);
  display: grid; place-items: center;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.doc-rail-add:hover { color: var(--ink-1); background: var(--bg-hov); }

/* Pill segmented tabs replace the underlined tabs */
.doc-tabs {
  display: inline-flex;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 2px;
  margin: 12px 16px;
  flex-shrink: 0;
  align-self: flex-start;
}
.doc-tab {
  background: transparent;
  border: 0;
  color: var(--ink-2);
  padding: 4px 12px;
  border-radius: 999px;
  font: 500 11px/1 var(--font-sans);
  cursor: pointer;
  transition: background var(--dur-base) var(--ease), color var(--dur-base) var(--ease);
}
.doc-tab.on { background: var(--bg-4); color: var(--ink-0); }
.doc-tab:not(.on):hover { color: var(--ink-1); }

.doc-tree-body, .doc-rail-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 8px 16px;
  display: flex; flex-direction: column; gap: 1px;
}

/* Page tree rows — same vocabulary as sidebar */
.doc-page-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius);
  color: var(--ink-1);
  font: 500 12px/1.4 var(--font-sans);
  cursor: pointer;
  position: relative;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
  user-select: none;
}
.doc-page-row:hover { background: var(--bg-hov); color: var(--ink-0); }
.doc-page-row.active { background: var(--soleil-soft); color: var(--ink-0); }
.doc-page-row.active::before {
  content: ''; position: absolute; left: 0; top: 5px; bottom: 5px;
  width: 2px; background: var(--soleil); border-radius: 1px;
}

/* Hide rail toggles into top corners with proper gutter */
.doc-rail-toggle {
  position: absolute;
  top: 10px;
  width: 22px; height: 22px;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  color: var(--ink-2);
  border-radius: var(--radius);
  display: grid; place-items: center;
  cursor: pointer;
  z-index: 10;
}
.doc-rail-left  .doc-rail-toggle { right: -11px; }
.doc-rail-right .doc-rail-toggle { left:  -11px; }
.doc-rail-toggle:hover { color: var(--ink-0); background: var(--bg-hov); }
```

- [ ] **Step 2: Update DocPageTree to use the new row class + Lucide icons**

In `DocPageTree.jsx`, change each rendered page row to:

```jsx
<div className={isActive ? 'doc-page-row active' : 'doc-page-row'} onClick={…}>
  <Icon as={hasChildren ? (isOpen ? ChevronDown : ChevronRight) : FileText} size={12} />
  <span className="sb-row-label">{page.title || 'Untitled'}</span>
</div>
```

Header (the existing `.doc-tree-head`):

```jsx
<div className="doc-tree-head">
  <span className="t-eyebrow doc-rail-label">PAGES</span>
  <button className="doc-rail-add" onClick={addPage} title="Add page"><Icon as={Plus} size={14}/></button>
</div>
```

Add at top:
```jsx
import { Icon } from './Icon.jsx';
import { ChevronDown, ChevronRight, FileText, Plus } from '../lib/icons.js';
```

- [ ] **Step 3: Update DocSurface tabs**

In `DocSurface.jsx`, replace the existing tab markup with:

```jsx
<div className="doc-tabs">
  <button className={tab === 'outline'   ? 'doc-tab on' : 'doc-tab'} onClick={() => setTab('outline')}>Outline</button>
  <button className={tab === 'bookmarks' ? 'doc-tab on' : 'doc-tab'} onClick={() => setTab('bookmarks')}>Bookmarks</button>
  <button className={tab === 'comments'  ? 'doc-tab on' : 'doc-tab'} onClick={() => setTab('comments')}>Comments</button>
</div>
```

Each panel below the tabs gets `<div className="doc-rail-body">` wrapping its content.

- [ ] **Step 4: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/DocSurface.jsx boards/src/components/DocPageTree.jsx boards/src/components/DocOutlinePanel.jsx boards/src/components/DocBookmarksPanel.jsx boards/src/components/DocCommentsPanel.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Doc rails + pill tabs with sidebar-style row vocabulary

Page tree adopts .doc-page-row with soleil-active state mirroring the
sidebar. Outline / Bookmarks / Comments switch from underlined tabs
to a pill segmented control. Rails get proper eyebrow PAGES headers
and a ChevronRight rotation on collapsible items.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C7: Doc status footer, doc card open/dock controls, find/replace

**Files:**
- Modify: `boards/src/components/DocStatusFooter.jsx`
- Modify: `boards/src/components/DocCard.jsx` (the chrome buttons in fullscreen / dock modes)
- Modify: `boards/src/components/DocFindReplace.jsx`
- Modify: `boards/src/styles.css` (`.doc-foot`, `.doc-card-controls`, `.doc-find`)

- [ ] **Step 1: Status footer**

In `DocStatusFooter.jsx`, replace the rendered structure with:

```jsx
<div className="doc-foot">
  <div className="doc-foot-left t-mono">{wordCount} words · {lineCol}</div>
  <div className="doc-foot-right t-meta">{saveLabel}</div>
</div>
```

CSS append to `styles.css`:

```css
/* ─────────────────────────── Doc status footer ──────────────────────────── */

.doc-foot {
  display: flex; align-items: center; justify-content: space-between;
  height: 28px;
  padding: 0 14px;
  background: var(--bg-1);
  border-top: 1px solid var(--line-1);
  flex-shrink: 0;
}
.doc-foot-left  { color: var(--ink-3); }
.doc-foot-right { color: var(--ink-2); }
```

- [ ] **Step 2: DocCard open/dock controls**

In `DocCard.jsx`, find the buttons that switch between `closed/full/side` modes and the close button. Replace each with:

```jsx
<button className="doc-card-ctrl" onClick={() => setMode('full')}  title="Fullscreen"><Icon as={Maximize2}  size={14}/></button>
<button className="doc-card-ctrl" onClick={() => setMode('side')}  title="Dock right"><Icon as={PanelRight} size={14}/></button>
<button className="doc-card-ctrl" onClick={() => setMode('closed')} title="Close"   ><Icon as={X}          size={14}/></button>
```

Wrap in `<div className="doc-card-controls">…</div>`.

CSS append:

```css
/* ─────────────────────────── Doc card chrome ────────────────────────────── */

.doc-card-controls {
  position: absolute;
  top: 8px; right: 8px;
  display: inline-flex;
  gap: 2px;
  padding: 4px;
  border-radius: var(--radius);
  background: rgba(20,18,15,.55);
  backdrop-filter: blur(10px);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
  z-index: 5;
}
.doc-card:hover .doc-card-controls,
.doc-card-controls:focus-within { opacity: 1; }
.doc-card-ctrl {
  width: 26px; height: 26px;
  display: grid; place-items: center;
  background: transparent;
  border: 0;
  color: var(--ink-1);
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.doc-card-ctrl:hover { background: var(--bg-hov); color: var(--ink-0); }
```

Imports for DocCard:
```jsx
import { Icon } from './Icon.jsx';
import { Maximize2, PanelRight, X } from '../lib/icons.js';
```

- [ ] **Step 3: Find/replace bar**

In `DocFindReplace.jsx`, replace the outer container with:

```jsx
<div className="doc-find surface-frosted">
  <div className="doc-find-input">
    <Icon as={Search} size={14} />
    <input value={q} onChange={…} placeholder="Find" />
    <span className="t-mono doc-find-count">{matchIndex + 1} of {matchCount}</span>
  </div>
  <button className="tool-btn" onClick={prev} title="Previous"><Icon as={ChevronUp} size={14}/></button>
  <button className="tool-btn" onClick={next} title="Next"><Icon as={ChevronDown} size={14}/></button>
  <button className="tool-btn" onClick={onClose} title="Close"><Icon as={X} size={14}/></button>
</div>
```

CSS append:

```css
/* ─────────────────────────── Doc find/replace ───────────────────────────── */

.doc-find {
  position: absolute;
  top: 12px; right: 12px;
  z-index: 50;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px;
  border-radius: var(--radius-md);
  animation: menuRise var(--dur-base) var(--ease);
}
.doc-find-input {
  display: inline-flex; align-items: center; gap: 8px;
  height: 28px;
  padding: 0 10px;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
}
.doc-find-input input {
  background: transparent;
  border: 0; outline: none;
  color: var(--ink-0);
  font: 500 13px/1 var(--font-sans);
  width: 200px;
}
.doc-find-count { color: var(--ink-3); margin-left: 8px; }

/* Match highlight inside the editor */
.doc-find-match { background: var(--soleil-soft); border-bottom: 1px solid var(--soleil); }
.doc-find-match.active { background: var(--soleil); color: var(--bg-0); }
```

- [ ] **Step 4: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/DocStatusFooter.jsx boards/src/components/DocCard.jsx boards/src/components/DocFindReplace.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Doc footer, card controls, and find/replace polish

Status footer: 28px slim bar with mono word-count and Aileron save
state. Doc-card open/dock/close controls live in a frosted hover-
revealed cluster top-right with Lucide icons. Find/replace becomes
a slim frosted bar with soleil match highlighting.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C8: Presence stack + live cursors

**Files:**
- Modify: `boards/src/components/PresenceStack.jsx`
- Modify: `boards/src/components/primitives.jsx` (`LiveCursor`)
- Modify: `boards/src/styles.css` (`.presence-*`, `.cursor*`)

- [ ] **Step 1: Replace PresenceStack body**

```jsx
// boards/src/components/PresenceStack.jsx
import { Avatar } from './primitives.jsx';

export function PresenceStack({ awareness, self, max = 4 }) {
  const states = awareness ? Array.from(awareness.getStates().values()) : [];
  const others = states.filter(s => s?.user && s.user.id !== self?.id);
  const visible = others.slice(0, max);
  const overflow = Math.max(0, others.length - max);

  return (
    <div className="presence-stack">
      {visible.map((s, i) => (
        <div className="presence-avatar" style={{ zIndex: max - i, marginLeft: i === 0 ? 0 : -8 }} title={s.user.name} key={s.user.id}>
          <Avatar name={s.user.name} color={s.user.color} size={24} />
        </div>
      ))}
      {overflow > 0 && (
        <div className="presence-more" title={`${overflow} more`} style={{ marginLeft: -8 }}>+{overflow}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Refresh LiveCursor in primitives.jsx**

Replace the existing `LiveCursor` with:

```jsx
export function LiveCursor({ x, y, name, color }) {
  return (
    <div className="cursor" style={{ transform: `translate(${x}px, ${y}px)` }}>
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none" style={{ filter: `drop-shadow(0 1px 2px rgba(0,0,0,.5))` }}>
        <path d="M2 2 L2 15 L5.5 12 L8 17.5 L10 16.5 L7.5 11 L13 11 Z"
              fill={color} stroke="var(--bg-1)" strokeWidth="1" strokeLinejoin="round" />
      </svg>
      <span className="cursor-flag" style={{ background: color }}>{name}</span>
    </div>
  );
}
```

- [ ] **Step 3: CSS**

Append:

```css
/* ─────────────────────────── Presence + cursors ─────────────────────────── */

.presence-stack { display: inline-flex; align-items: center; }
.presence-avatar {
  border-radius: 50%;
  border: 1.5px solid var(--bg-1);
  width: 24px; height: 24px;
  overflow: hidden;
  display: grid; place-items: center;
  background: var(--bg-3);
}
.presence-more {
  width: 24px; height: 24px;
  border-radius: 50%;
  border: 1.5px solid var(--bg-1);
  background: var(--bg-3);
  color: var(--ink-1);
  font: 500 10px/1 var(--font-sans);
  display: grid; place-items: center;
}

.cursor { position: absolute; pointer-events: none; left: 0; top: 0; z-index: 1000; transition: transform var(--dur-fast) linear; }
.cursor-flag {
  display: inline-block;
  margin-left: 12px; margin-top: -4px;
  padding: 2px 6px;
  font: 600 11px/1.2 var(--font-sans);
  color: var(--bg-0);
  border-radius: var(--radius);
  box-shadow: 0 2px 8px rgba(0,0,0,.4);
}
```

- [ ] **Step 4: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/PresenceStack.jsx boards/src/components/primitives.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Presence stack + live cursor refresh

Stacks remote users as 24px avatars overlapping by 8px with a 1.5px
warm-dark border, max 4 + a +N pill. LiveCursor stroke now matches
the warm-dark sidebar tone, and the name flag uses Aileron 11/600.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase D — Working surfaces

### Task D1: Canvas dot grid + selection ring

**Files:**
- Modify: `boards/src/styles.css` (`.canvas-wrap`, `.canvas-grid`, `.marquee`, `.snap-guide`)

- [ ] **Step 1: Replace the canvas grid CSS**

Find the existing `.canvas-wrap` and grid background rules. Replace:

```css
/* ─────────────────────────────── Canvas ─────────────────────────────────── */

.canvas-wrap {
  position: relative;
  width: 100%; height: 100%;
  background-color: var(--bg-2);
  background-image: radial-gradient(circle at 1px 1px, var(--grid-dot) 1px, transparent 1px);
  background-size: 24px 24px;
  overflow: hidden;
}

.marquee {
  position: absolute;
  border: 1px solid var(--soleil);
  background: var(--soleil-soft);
  border-radius: 2px;
  pointer-events: none;
}

.snap-guide {
  position: absolute;
  background: var(--soleil);
  opacity: 0.6;
  pointer-events: none;
}
.snap-guide.h { height: 1px; }
.snap-guide.v { width: 1px; }
```

(If the existing rules use different selectors for snap guides or marquee, update those names instead — the goal is to swap to soleil-gold for selection visuals.)

- [ ] **Step 2: Build + verify visually**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

Open dev server, drop a card on the canvas — confirm dot grid + soleil marquee.

- [ ] **Step 3: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/styles.css
git commit -m "$(cat <<'EOF'
Canvas — warm-dark dot grid and soleil marquee/snap

Switches the canvas background from grid lines to a 24px radial-dot
pattern reading as paper. Selection marquee and snap guides use
soleil-gold instead of the previous neutral signal color.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D2: Cards on canvas — selection ring + token shadows

**Files:**
- Modify: `boards/src/styles.css` (`.card`, `.card.selected`, per-card-kind blocks)

- [ ] **Step 1: Replace the base `.card` styling**

Find the `.card` rule and any `.card.selected` rule. Replace with:

```css
/* ─────────────────────────────── Cards ──────────────────────────────────── */

.card {
  position: absolute;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-1);
  color: var(--ink-1);
  font: 400 13px/1.4 var(--font-sans);
  transition: box-shadow var(--dur-base) var(--ease), transform var(--dur-base) var(--ease);
  overflow: hidden;
}
.card:hover { box-shadow: var(--shadow-2); }
.card.selected {
  box-shadow:
    0 0 0 1px var(--soleil),
    0 0 0 4px var(--soleil-soft),
    var(--shadow-2);
}
.card-title { font: 600 13px/1.4 var(--font-sans); color: var(--ink-0); }
```

For the note (post-it) card, keep its `background: #fde68a; color: #1a1300;` overrides — the post-it yellow is intentional brand-divergent paper.

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/styles.css
git commit -m "$(cat <<'EOF'
Card resting/selected shadows with soleil double-ring

Cards inherit warm-dark tokens with --shadow-1 resting and --shadow-2
on hover. Selected state uses a 1px soleil ring + 4px soft halo for
a luminous selection cue. Post-it (note) card keeps its yellow
override as intentional paper-on-desk language.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D3: List view rows

**Files:**
- Modify: `boards/src/components/ListSurface.jsx`
- Modify: `boards/src/styles.css` (`.list-*` rules)

- [ ] **Step 1: Apply sidebar-row vocabulary**

In `ListSurface.jsx`, replace the existing row JSX with:

```jsx
<div className={isActive ? 'list-row active' : 'list-row'} onClick={…}>
  <Icon as={GripVertical} size={12} className="list-grip" />
  <span className="sb-dot" style={{ background: COVER_TINTS[item.tint] || COVER_TINTS.neutral }} />
  <span className="sb-row-label">{item.title}</span>
  <span className="t-meta">{item.metaLine}</span>
</div>
```

Add imports:
```jsx
import { Icon } from './Icon.jsx';
import { GripVertical } from '../lib/icons.js';
import { COVER_TINTS } from './primitives.jsx';
```

- [ ] **Step 2: CSS**

Append:

```css
/* ─────────────────────────────── List view ──────────────────────────────── */

.list-surface { padding: 24px 32px; display: flex; flex-direction: column; gap: 1px; }
.list-row {
  display: flex; align-items: center; gap: 10px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--radius);
  color: var(--ink-1);
  font: 500 13px/1.4 var(--font-sans);
  cursor: pointer;
  position: relative;
  transition: background var(--dur-fast) var(--ease);
}
.list-row:hover { background: var(--bg-hov); color: var(--ink-0); }
.list-row.active { background: var(--soleil-soft); color: var(--ink-0); }
.list-row .list-grip { color: var(--ink-3); opacity: 0; transition: opacity var(--dur-fast) var(--ease); }
.list-row:hover .list-grip { opacity: 1; }
```

- [ ] **Step 3: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/ListSurface.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
List surface rows mirror sidebar vocabulary

List view now uses the same 32px row + soleil active state + dot
tint grammar as the sidebar. Drag handle (GripVertical) appears on
row hover only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D4: Doc page editor body — cream paper

**Files:**
- Modify: `boards/src/styles.css` (`.doc-page`, `.doc-page-paper`, `.ProseMirror` if needed)

- [ ] **Step 1: Update doc page CSS**

Find the existing `.doc-page` / `.doc-page-paper` / page edge rules. Replace the page styling block with:

```css
/* ─────────────────────────── Doc page (paper) ───────────────────────────── */

.doc-page-paper {
  width: 8.5in;
  min-height: 11in;
  background: #faf7f0;
  color: #1a1612;
  border-radius: 4px;
  box-shadow: var(--shadow-2);
  padding: 1in 1in;
  margin: 32px auto;
  font: 400 14px/1.6 var(--font-sans);
}
[data-theme='light'] .doc-page-paper {
  background: #ffffff;
  box-shadow: var(--shadow-1);
}
.doc-page-paper .ProseMirror { outline: none; min-height: calc(11in - 2in); }
.doc-page-paper h1 { font: 700 28px/1.2 var(--font-sans); letter-spacing: -0.01em; margin: 16px 0 12px; color: #0a0807; }
.doc-page-paper h2 { font: 700 22px/1.25 var(--font-sans); letter-spacing: -0.01em; margin: 14px 0 10px; color: #0a0807; }
.doc-page-paper h3 { font: 600 18px/1.3 var(--font-sans); margin: 12px 0 8px; color: #0a0807; }
.doc-page-paper p  { margin: 8px 0; }
.doc-page-paper a  { color: var(--soleil); text-decoration: underline; text-underline-offset: 2px; }
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/styles.css
git commit -m "$(cat <<'EOF'
Doc page paper — warm cream, Aileron typography

Doc page background shifts from pure white to #faf7f0 (warm cream)
to feel like paper instead of a Word doc. Body type is Aileron
14/1.6, headings tighten to -0.01em letter-spacing. Links use
soleil-gold with offset underline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D5: Board thumbnails

**Files:**
- Modify: `boards/src/components/BoardThumbnail.jsx`
- Modify: `boards/src/styles.css` (`.board-thumb-*`)

- [ ] **Step 1: Inspect existing**

```bash
cat /Users/andrewconklin/soleilpictures-1/boards/src/components/BoardThumbnail.jsx
```

- [ ] **Step 2: Apply token treatment**

Update the rendered root element to use `.surface-card` class plus a `.board-thumb` wrapper that applies the cover gradient:

```jsx
import { COVER_TINTS } from './primitives.jsx';

// at the root return:
<div className="board-thumb">
  <div
    className="board-thumb-cover"
    style={{ background: `linear-gradient(135deg, ${COVER_TINTS[cover] || COVER_TINTS.neutral}, color-mix(in oklab, ${COVER_TINTS[cover] || COVER_TINTS.neutral} 40%, var(--bg-2)))` }}
  >
    {/* existing miniature card stickers */}
  </div>
</div>
```

CSS append:

```css
/* ─────────────────────────── Board thumbnails ───────────────────────────── */

.board-thumb { aspect-ratio: 4 / 3; border-radius: var(--radius-md); overflow: hidden; box-shadow: var(--shadow-1); border: 1px solid var(--line-2); }
.board-thumb-cover { width: 100%; height: 100%; position: relative; }
```

- [ ] **Step 3: Build + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build
```

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/components/BoardThumbnail.jsx boards/src/styles.css
git commit -m "$(cat <<'EOF'
Board thumbnails — 4:3 cover gradient + soft shadow

Wraps thumbnails in .surface-card-style chrome with a 135° cover
gradient driven by COVER_TINTS, --shadow-1 resting, and 4:3 ratio
matching the editorial board grid.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase E — Motion threading

### Task E1: Apply motion tokens to remaining transitions

**Files:**
- Modify: `boards/src/styles.css` (find any remaining hard-coded `transition: 0.2s ease` or similar)

- [ ] **Step 1: Audit remaining transitions**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards
grep -nE "transition: ?[0-9]+(\.[0-9]+)?(s|ms)" src/styles.css | head -40
```

For each match, rewrite the duration as `var(--dur-fast)` (≤120ms), `var(--dur-base)` (~200ms), or `var(--dur-slow)` (≥320ms), and the easing as `var(--ease)`.

- [ ] **Step 2: Verify build + tests still pass**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npm run build && npx playwright test
```

- [ ] **Step 3: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/styles.css
git commit -m "$(cat <<'EOF'
Thread --ease and --dur-* tokens through legacy transitions

Replaces ad-hoc transition durations and easings throughout styles.css
with the motion token system so all motion stays consistent and
respects the prefers-reduced-motion fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase F — QA pass

### Task F1: Visual audit at 3 widths + light theme

**Files:**
- Add: `boards/tests/polish-smoke.spec.js` (extend with viewport screenshots)

- [ ] **Step 1: Append viewport regression tests**

In `boards/tests/polish-smoke.spec.js`, append:

```js
import { devices } from '@playwright/test';

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop',  width: 1024, height: 720 },
  { name: 'narrow',  width: 768,  height: 720 },
];

for (const vp of viewports) {
  test(`local QA renders cleanly at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/?local=1');
    await expect(page.getByRole('main').getByText('Studio', { exact: true })).toBeVisible();
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('.canvas-wrap')).toBeVisible();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
}

test('light theme inverts cleanly with no console errors', async ({ page }) => {
  await page.goto('/?local=1');
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.getByTitle('Toggle theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run the suite**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npx playwright test
```

Expected: all polish + smoke tests pass at all three widths and after light-theme toggle.

- [ ] **Step 3: Commit**

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/tests/polish-smoke.spec.js
git commit -m "$(cat <<'EOF'
Add viewport + light-theme regression smoke tests

Asserts that sidebar/topbar/canvas render and no pageerror or
console errors fire at 1440 / 1024 / 768 widths and after toggling
the theme to light.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task F2: Keyboard navigation pass

**Files:**
- Modify: `boards/src/styles.css` (add a global focus-visible rule)
- Add: `boards/tests/polish-smoke.spec.js` (one keyboard-focus assertion)

- [ ] **Step 1: Add a global focus-visible rule**

Append to `styles.css`:

```css
/* ───────────────────────────── Focus rings ──────────────────────────────── */

:where(button, a, input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])):focus-visible {
  outline: none;
  box-shadow: var(--shadow-glow);
  border-radius: var(--radius);
}
```

- [ ] **Step 2: Add Playwright assertion**

Append to `boards/tests/polish-smoke.spec.js`:

```js
test('keyboard focus on sidebar collapse button shows soleil glow', async ({ page }) => {
  await page.goto('/?local=1');
  await page.locator('.sb-collapse').focus();
  const shadow = await page.locator('.sb-collapse').evaluate(el => getComputedStyle(el).boxShadow);
  expect(shadow).toContain('rgb(212, 160, 74)');
});
```

- [ ] **Step 3: Run + commit**

```bash
cd /Users/andrewconklin/soleilpictures-1/boards && npx playwright test
```

```bash
cd /Users/andrewconklin/soleilpictures-1
git add boards/src/styles.css boards/tests/polish-smoke.spec.js
git commit -m "$(cat <<'EOF'
Global :focus-visible soleil glow ring + assertion

Adds a single :focus-visible rule that paints the soleil glow ring
on any keyboard-focused interactive element. Asserts via Playwright
that focusing the sidebar collapse button shows the soleil colour
in box-shadow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Plan Self-Review

After all tasks above, verify against the spec sections:

- §3 Tokens → Task A2 ✔
- §4 Type system → Task A2 (font-family) + Task A3 (utility classes) ✔
- §5 Iconography + Soleil mark → Task A4 ✔
- §6.1 Auth → Task B1 ✔
- §6.2 Sidebar → Task B2 ✔
- §6.3 Topbar → Task B3 ✔
- §6.4 Board grid → Task B4 ✔
- §6.5 Empty states → Task B5 ✔
- §6.6 Account block → Task B2 (sb-foot) ✔
- §6.7 Modals → Task C1 ✔
- §6.8 Floating menus → Task C2 ✔
- §6.9 Inbox + tweaks panels → Task C3 ✔
- §6.10 Tool options bar → Task C4 ✔
- §6.11 Doc surface chrome → Tasks C5–C7 ✔
- §6.12 Find/replace → Task C7 ✔
- §6.13 Presence stack → Task C8 ✔
- §6.14 Canvas dot grid → Task D1 ✔
- §6.15 Cards on canvas → Task D2 ✔
- §6.16 List view → Task D3 ✔
- §6.17 Doc page paper → Task D4 ✔
- §6.18 Board thumbnails → Task D5 ✔
- §6.19 Live cursors → Task C8 (LiveCursor refresh) ✔
- §7 Motion → Tasks A2 (tokens) + E1 (thread through CSS) + A3 (reduced-motion) ✔
- §8 Implementation strategy phases → mirrored as plan phases A–F ✔
- §11 Verification → covered by polish-smoke + boards-smoke tests after F1/F2 ✔
