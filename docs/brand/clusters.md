# Soleil Clusters: the product register

Clusters is the first Soleil product and the worked example of the product register: night ground, ink chrome, gold for state, the pictures carrying the colour. Its tokens are the source a new product starts from. The app is `boards/`; its tokens live in `boards/src/styles.css`. Back to the [brand book](README.md).

## Themes

Dark is the default (`<html data-theme="dark">` in `boards/index.html`). A person's explicit choice wins, then their system setting, then dark (`applyThemeNow` in `boards/src/lib/theme.js`). Sign-in and public pages (`.public-dark`) stay dark whichever theme is chosen.

The dark neutrals are cool and nearly grey, so "the canvas doesn't read as warm-tinted" (the header of `boards/src/styles.css`). In light, the ladder inverts: `--bg-3` is the brightest surface and `--bg-0` the dimmest ground.

## Tokens

### Grounds, lines and ink

| Property | Dark (`:root`) | Light (`[data-theme='light']`) | Use |
|---|---|---|---|
| `--bg-0` | `#0a0a0c` | `#f5f5f7` | The ground: canvas, body. `night` in dark. |
| `--bg-1` | `#111114` | `#fafafc` | Floating rail, panels |
| `--bg-2` | `#16161a` | `#ededf0` | Toasts and inputs |
| `--bg-3` | `#1c1c20` | `#ffffff` | Menus and surface cards |
| `--bg-4` | `#26262a` | `#f0f0f3` | Raised chips |
| `--bg-hov` | `#1a1a1e` | `#ececef` | Hover |
| `--bg-act` | `#212126` | `#e4e4e8` | Active row or tool |
| `--line-1` | `#212126` | `#ececef` | Faint hairline |
| `--line-2` | `#2c2c32` | `#d8d8dc` | Default hairline |
| `--line-3` | `#3a3a40` | `#b8b8be` | Strong hairline |
| `--ink-0` | `#f5f5f7` | `#0a0a0c` | Primary text. `ink` in dark. |
| `--ink-1` | `#d0d0d4` | `#2c2c30` | Body text |
| `--ink-2` | `#888890` | `#6a6a70` | Secondary text, resting icons |
| `--ink-3` | `#5a5a60` | `#92929a` | Tertiary, empty-state icons, eyebrows |
| `--ink-4` | `#3a3a40` | `#b8b8be` | Disabled |

### Gold and status

| Property | Dark | Light | Use |
|---|---|---|---|
| `--soleil` | `#ffa500` | `#ffa500` | The accent: selection, focus, active, the one primary action |
| `--on-soleil` | `#1a1205` | `#1a1205` | Text and icons on gold |
| `--soleil-soft` | gold at .14 | gold at .10 | Tint behind an active row, a keyboard-active menu item |
| `--shadow-glow` | gold hairline and halo | same | The focus ring |
| `--danger` | `#e5484d` | `#cd2b31` | Destructive fills and badges |
| `--ink-error` | `#e08b8b` | `#b04a4a` | Error text |
| `--msg-ok` | `#2faf78` | `#1c9e6e` | Success |
| `--msg-info` | `#8ab4f8` | `#3b6fd4` | Information |
| `--msg-warn` | `#e0a33c` | `#b3781a` | Warning |

`--select` and `--accent` both point at `--soleil`. A person can pick another accent in Settings (`boards/src/components/settings/fields.jsx`); it rewrites `--soleil` and its companions, and flips `--on-soleil` to white if the accent is dark. Marks never follow it: they stay `soleil`.

### Where gold goes

Gold is reserved for active, selected and focused things and for one primary action per view (repo `CLAUDE.md`). In Clusters that means: the 3px bar on the current cluster in the sidebar, focus rings, the selection ring on cards, drop targets, `.btn-primary`, the keyboard-active menu row and the mark. It is not on resting icons, secondary buttons, the chosen option in the Share panel ("gold is the one action the panel is about to take"), trial or offer pills, unread counts (inverse ink) or email. Where you are is gold (the current cluster). What time it is (today, now) is ink. (New in this guide.) A product may let people pick their own accent, as Clusters does; `soleil` stays the default and marks never follow it. A section with no colour of its own is drawn in gold; the named section colours never use it ("Gold is moss, never the app's gold", `boards/src/lib/boardStyle.js`).

### Section and note colours

Sections and notes have eight named colours: blue, clay, green, plum, teal, rose, moss and slate, each a `tone` for the outline and a `tint` for a note's fill (`SECTION_COLOURS` in `boards/src/lib/boardStyle.js`). These belong to people's work, not to the chrome, and they are the same in both themes. They are also the data palette: charts, categories and series take them in this order, and gold marks only the selected series or bar (new in this guide). The tones are the `section-*` colour tokens in `docs/brand/tokens.json`.

## Type

`--font-sans` is Aileron, `--font-display` is Brandon Grotesque, `--font-mono` is JetBrains Mono at 500. `body` sets 13px in `--ink-1` with tabular figures, so interface text is 13px (`.t-ui`); text people read at length, `.t-body`, is 14px. Aileron 500 is in the Adobe kit but not in Fontsource's CC0 files, so a stand-in's 500 falls to 400. The scale is the `.t-*` set in `boards/src/styles.css`:

| Class | Face | Weight | Size / line | Case |
|---|---|---|---|---|
| `.t-display` | Brandon | 700 | 56 / 1.05 | Capitals, .18em |
| `.t-h1` | Brandon | 700 | 32 / 1.15 | Capitals, .12em |
| `.t-h2` | Aileron | 600 | 22 / 1.25 | Sentence, -.01em |
| `.t-h3` | Aileron | 600 | 16 / 1.30 | Sentence, -.01em |
| `.t-eyebrow` | Brandon | 700 | 10 / 1 | Capitals, .18em, `--ink-3` |
| `.t-body` | Aileron | 400 | 14 / 1.5 | Sentence |
| `.t-ui` | Aileron | 500 | 13 / 1.4 | Sentence |
| `.t-ui-sm` | Aileron | 500 | 12 / 1.4 | Sentence |
| `.t-meta` | Aileron | 400 | 11 / 1.4 | Tabular, `--ink-2` |
| `.t-mono` | Mono | 500 | 11 / 1.4 | Tabular |

Most headings in the app are `.t-h2` and `.t-h3`: Brandon is kept for brand moments, eyebrows and the wordmark. Prose documents use a serif body under Aileron headings (`boards/src/lib/docTypography.js`); screenplays use Courier Prime, with Cousine fetched for a Greek or Cyrillic PDF (`boards/src/lib/scriptFontPlan.js`). Menus stay left to right; people's own text takes its own direction.

## Grain

One fine, still grain at one strength: `--grain-o` `.03` dark, `.027` light, from `boards/src/assets/grain/grain-1x.webp` and its 2x twin at `--grain-size` 192px. The tile carries no strength of its own and is drawn at straight opacity, because blend modes "annihilate greyscale grain on near-black grounds". It lies on the canvas ground, bars, the sidebar, menus, dialogs, toasts and pages. Content is never grained: cards, pictures, tables, documents, "wherever they appear". A new product copies the tile files from `boards/src/assets/grain/`. Capture Mode, the app's screenshot mode, turns the grain off (`body[data-capture-freeze='1']`). (`boards/src/styles.css`, panel grain.)

## Glass and surfaces

The current look (`body[data-sb-files]`) floats the sidebar as two glass cards, 8px from the window edge and 8px apart (`boards/src/components/sidebar/clusterSidebar.css`). One line per surface:

- **Island** (a sidebar card): glass, `--sbf-glass` (`--bg-1` at 88%; token `glass`), an inset `--sbf-glass-line` hairline and `--sbf-glass-shadow`, `0 1px 1px`, "and nothing softer".
- **Toast**: nearly solid `--sbf-solid` (`--bg-1` at 96%; token `glass-solid`), blurred 14px, 12px radius, a hairline and a lift, top right under the right island (`boards/src/components/feedbackLook.css`).
- **Notices and the command bar**: the same `--sbf-solid` (`boards/src/components/smallThingsLook.css`, `boards/src/components/commandPaletteLook.css`).
- **Menu**: solid `--bg-3` with a hairline, 8px radius and 32px rows, because it opens over photos.
- **Dialog**: the confirm and prompt dialogs are opaque, `--bg-1` in dark and a near-white in light, with an inset hairline and a 14px radius ("glass over the dimmed, blurred room came out the room's own tone"). Behind it a scrim, black at .45 on dark and near-black at .28 on light.

The canvas ground is depth dots with very faint lines (`boards/src/lib/canvasGround.js`). Disabled is `--disabled-opacity` .4. The two toast rules that still disagree are in [drift.md](drift.md).

### Which button

| Where | Button | Selector |
|---|---|---|
| In-app primary action, one per view | Gold, `--on-soleil` text | `.btn-primary` |
| The answer in a confirm dialog (current look) | Ink, `--bg-0` text | `.btn-primary` inside `.feedback-dialog` |
| Empty-state call to action | White: `--ink-0` with `--bg-0` text | `.empty-action` |
| Sign-in | Gold, `--on-soleil` text | `.sb-frost .auth-btn` (`boards/src/auth/signin-backdrop.css`) |
| A landing page's main call to action | Gold | `.seo-cta-primary` (`boards/src/pages/seoLanding.css`) |
| Email | The one white button | `btn` in the Darkroom table below |
| Everything else | Neutral secondary | `.btn-secondary` |

Buttons are 4px radius.

## Icons

Phosphor through `boards/src/components/Icon.jsx` (size 16 by default), `currentColor`, regular weight (16px regular is the sidebar standard). The wrapper's own default is thin, which is drift; `boards/src/lib/iconWeight.js` lifts thin and light to regular wherever a surface sets a floor (`IconWeightContext`), and leaves weights chosen on purpose alone. Rest `--ink-2`, hover and active `--ink-0` over `--bg-hov` or `--bg-act`. Empty-state icons `--ink-3`. Status icons take the `--msg-*` colours. The fill weight is for the sparkle on notices and for unread or selected marks.

## Motion

`--ease` `cubic-bezier(0.2, 0.8, 0.2, 1)` with `--dur-quick` 80ms, `--dur-fast` 120ms, `--dur-base` 200ms, `--dur-slow` 320ms. Dialogs rise 8px and scale from .985 over `--dur-slow`; menus rise 4px over `--dur-base`; toasts slide 12px. Wheel zoom glides for 160ms. Under reduced motion, durations clamp to `--dur-fast`, loops run once, and dialogs fade only.

## Email: Darkroom

Every Clusters email wears one look, the `T` object in `supabase/functions/_shared/email/theme.ts`:

| Key | Hex | Use |
|---|---|---|
| `page` | `#0a0a0c` | Page |
| `card` | `#121215` | The card |
| `cardLine` | `#222227` | Card hairline |
| `panel` | `#1a1a1e` | Code tile, quotes |
| `line` | `#2a2a30` | Picture border |
| `ink0` | `#f5f5f7` | Headings |
| `ink1` | `#d0d0d4` | Body |
| `ink2` | `#a0a0a8` | Eyebrow, small print |
| `ink3` | `#80808a` | Footer |
| `btn` / `btnInk` | `#f5f5f7` / `#0a0a0c` | The one button |

Email greys `ink2` and `ink3` are lighter than the app's `--ink-2` and `--ink-3`, for reading in a mail client. It is always dark (`color-scheme: dark only`), 560px wide, with a 16px card radius and an 8px button radius. The 84px mark on night (`boards/public/email/mark-dark-84.png`) sits at 28px beside "CLUSTERS". System fonts only. No gold, except inside the mark image. The footer is "Clusters by Soleil Pictures · clusters.soleilpictures.com". The sign-in email is generated from the same look by `boards/scripts/gen-magic-link.mjs`; `boards/src/lib/emailLook.test.mjs` guards it.

## App icons and splash

- Web: transparent mark icons from 48 to 512px in `boards/public/icons/`, made by `boards/scripts/generate-favicons.mjs` from `boards/assets/icon-only.png`.
- iOS: the mark full bleed on night, the model for every platform.
- Splash: night, the mark small and centred; Capacitor's splash colour is `#0a0a0c` in both modes and its spinner `soleil` (`boards/capacitor.config.ts`).
- PWA: `boards/public/manifest.webmanifest`, name "Soleil Clusters", short name "Clusters", `background_color` night.

What does not match yet (theme colour, Android ground, iOS splash, light-tab favicon) is in [drift.md](drift.md).
