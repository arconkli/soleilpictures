# Soleil brand guide

This is the reference for everything Soleil makes: the film studio, its website, and every product it builds. It is written from the two things that already exist, Soleil Pictures and Soleil Clusters, and it says where each rule comes from so a later reader can tell a decision from an accident.

Read this page first. The other pages go deeper:

- [family.md](family.md): names, domains, structured data, and the checklist for a new product
- [marks.md](marks.md): the sun, the Clusters mark, wordmarks, icons, favicons, link cards
- [voice.md](voice.md): how Soleil writes
- [clusters.md](clusters.md): Soleil Clusters, the worked example of the product register
- [pictures.md](pictures.md): Soleil Pictures, the worked example of the studio register
- [drift.md](drift.md): where today's surfaces differ from this guide, and the fix for each

## What Soleil is

**Soleil Pictures** is a film and television studio. It is the company, the parent and the legal party behind everything here. Its site is soleilpictures.com, a static site whose files sit at the repo root (`index.html`, `style.css`, `script.js`).

The studio also makes software, first for its own productions and then for anyone who does the same kind of work. Each product carries the family name: **Soleil Clusters** (a creative workspace and moodboard, at clusters.soleilpictures.com, in `boards/`) is the first, and **Soleil Scout** (text a picture, it lands in Clusters) is the second. Inside its own interface a product drops the family name and is just Clusters or Scout. See [family.md](family.md).

"Soleil" on its own is the family name, never a product.

## The idea: the sun over a dark room

Everything Soleil makes starts from one picture: a dark room with one source of warm light in it. It is a cinema before the film starts, a grading suite, a night sky with the sun low on the edge of it.

The room is **night**, a near-black that is neutral rather than warm, so it never tints the work shown on it. The light is the **sun**, drawn in Soleil gold. The sun is rare, and because it is rare it means something: on the studio site it is the whole atmosphere; in a product it marks the one thing you have chosen or are about to do.

Everything else in the room is quiet, so the pictures, the films and the people's own work carry the colour.

## Principles

1. **Night first.** Every Soleil surface starts on night (`#0a0a0c`). Dark is the default, and light is a second theme a product may offer, not the other way round. (`boards/src/styles.css` `:root`; `supabase/functions/_shared/email/theme.ts`.)
2. **One sun.** Gold is the only warm colour in the chrome, and it is rare: the mark, what is selected or focused, and at most one action per view. If gold is decorating something, it is wrong. (`boards/src/styles.css`, the `--soleil` comments; repo `CLAUDE.md`.)
3. **The work carries the colour.** Chrome is greyscale ink on night. Posters, stills, references and notes bring every other colour. Nothing is laid over a picture that changes it: no grain, no tint. (`boards/src/styles.css`, the panel grain notes.)
4. **One hand, two registers.** The studio and the products share a ground, a sun, two typefaces and a grain. The studio is slow and atmospheric; a product is quick and quiet. Same hand, different rooms. (`boards/docs/superpowers/specs/2026-05-04-boards-luxury-polish-design.md`: "same studio's hand, but its own visual world".)
5. **Say what it does.** Plain words, present tense, no hype, no exclamation marks, no emoji. Say what Soleil does; never say nobody else does it. (`boards/src/lib/billingCopy.js`; [voice.md](voice.md).)
6. **Numbers come from code.** Any limit, price or count in public copy is read from the code that enforces it, never typed. (`boards/scripts/gen-docs.mjs`; `boards/src/lib/billingCopy.js`.)
7. **Each product is its own place.** A product has its own name and its own mark, drawn from the Soleil sun. It does not wear the studio's mark. (New in this guide; see [marks.md](marks.md).)

## Two registers

| | Studio register | Product register |
|---|---|---|
| Where | soleilpictures.com, posters, film pages, showcase pieces | Clusters, Scout, any tool people work in |
| Feel | Atmosphere: a slow sun on a night sky | Quiet: neutral chrome that gets out of the way |
| Gold | The sun orb (as `sunset-glow`) and the half-sun mark | State, focus, the mark, and one primary action per view |
| Chrome | White on glass, white focus rings, no gold | Ink on night, gold for state only |
| Type | Brandon caps, tracked wide, for the wordmark, titles and navigation | Aileron for the interface; Brandon for brand moments |
| Motion | A breath of about 42 seconds; letters that settle in | 80 to 320 ms on one curve |
| Light theme | None; always dark | Optional, from the Clusters light block |

Shared by both: the night ground, the sun, Brandon Grotesque and Aileron, the film grain, glass used sparingly, plain words, no emoji. A product may borrow one studio moment, a soft gold glow behind the mark on sign-in or in the brand block, and nothing more. (`--soleil-glow` in `boards/src/auth/signin-backdrop.css`; the 2026-05-04 spec.)

## Foundations

### Colour

These are the brand tokens. Their names are the same in `docs/brand/tokens.json` and in the Soleil design system.

| Token | Hex | What it is for |
|---|---|---|
| `night` | `#0a0a0c` | The Soleil ground: every page, the app canvas, the email page, the app splash. Clusters `--bg-0`. |
| `ink` | `#f5f5f7` | Primary text and the one white button on night. Clusters dark `--ink-0`, email `ink0` and `btn`. |
| `soleil` | `#ffa500` | Soleil gold. The marks, active and selected states, focus, one primary action. Clusters `--soleil`, which `boards/src/styles.css` calls the "Soleil Pictures brand gold". |
| `ink-on-soleil` | `#1a1205` | Text and icons on a gold fill. Clusters `--on-soleil`. |
| `sun-shade` | `#ef7300` | The shadow tone of the sun disc in a mark. `boards/src/lib/sunMark.js` `MARK_COLORS.shadow`. |
| `sun-cream` | `#fffaf0` | The highlight tone of the sun disc, and the orbit dashes on a dark ground. `MARK_COLORS.cream`. |
| `sunset-glow` | `#f96b06` | The studio's sun orb. Atmosphere only: never a flat fill, never text, never interface. Computed in `script.js` at the repo root (`ColorPalette`, hsl(25, 95%, 50%) through `hslToHex`), not stored as a literal. |

`soleil`, `sun-shade` and `sun-cream` together are the **three-tone sun**: a gold disc, a deeper shadow under a cream highlight. Every Soleil mark is drawn from it (see [marks.md](marks.md)).

**Gold may** appear on: the marks; active, selected and focused things; the one primary action in a view; a soft glow behind the mark on a brand moment such as sign-in; and one accent on a shared picture such as a link card, a poster or a slide.

**Gold never** appears on: resting icons, body text, links in running text, large fills, unread marks (those are inverse ink), secondary buttons, offers and badges, or anything in an email except the mark image itself. (`boards/src/styles.css` comments on `.btn-primary`, the Share panel and the trial pills; `boards/src/components/sidebar/clusterSidebar.css` header; `supabase/functions/_shared/email/theme.ts`.) The reason is the same everywhere: gold is how a person finds the one thing that matters on a screen, and it stops working the moment it decorates.

**Neutrals and status colours** come from Clusters: the `--bg-*`, `--line-*` and `--ink-*` ladders, `--danger`, `--ink-error` and `--msg-ok`, `--msg-info`, `--msg-warn`. They are listed in [clusters.md](clusters.md). The dark neutrals are cool and nearly grey on purpose: "Backgrounds and text stay neutral so the canvas doesn't read as warm-tinted" (`boards/src/styles.css` header).

**Light theme.** A product that offers a light theme uses the Clusters light block (`[data-theme='light']` in `boards/src/styles.css`): `#f5f5f7` ground, `#0a0a0c` ink, gold unchanged, gold fills still carry `ink-on-soleil`. Sign-in and the public pages stay dark whichever theme is chosen.

**Where gold goes, by place.** Where you are is gold (the current cluster). What time it is (today, now) is ink. (New in this guide.) A product may let people pick their own accent, as Clusters does; `soleil` stays the default and marks never follow it.

**Which button.** The in-app primary action is gold, one per view. An empty state's call to action is white. Everything else is neutral. The table is in [clusters.md](clusters.md#which-button).

**Data and categories.** Charts, categories and series take the eight section colours (`section-blue`, `section-clay`, `section-green`, `section-plum`, `section-teal`, `section-rose`, `section-moss`, `section-slate`) in that order. Gold marks only the selected series or bar, never a series colour. (New in this guide.) The values are in `docs/brand/tokens.json`.

**Contrast.** Text people need to read meets 4.5:1; large text and icons meet 3:1. On every Clusters ground, `--ink-0`, `--ink-1` and `--ink-2` pass for text in both themes. `--ink-3` (about 2.5 to 3.1) is for icons and decoration only, never for text people need to read, and `--ink-4` is only for disabled things. In the light theme `--msg-ok`, `--msg-warn` and `--msg-info` are below 4.5 as text, so they colour an icon and the words stay ink. `--on-soleil` on `--soleil` is 9.4:1. The email greys pass (the footer `ink3` is 4.8:1 on the card). On the studio site, white text stays at .5 alpha or above for anything read; .4 is 3.8:1. Where today's surfaces fall short, see [drift.md](drift.md).

### Type

| Face | Use | Source |
|---|---|---|
| Brandon Grotesque | Wordmarks, display heads, eyebrows. Always capitals, tracked wide. Never body text. | Adobe Fonts kit `qtd2rwk`, on both sites |
| Aileron | Everything people read and use: interface, body, captions | The same kit |
| JetBrains Mono 500 | Small system data only: shortcuts, ids, codes | `boards/src/styles.css` `--font-mono` |
| Courier Prime | Screenplays (Cousine for a Greek or Cyrillic screenplay PDF) | `boards/public/fonts/` |
| System sans | Email, where web fonts do not load reliably | `supabase/functions/_shared/email/theme.ts` `SANS` |

Brandon caps are tracked by place: `.t-display` .18em, `.t-h1` .12em and `.t-eyebrow` .18em (`boards/src/styles.css`), the sidebar wordmark .16em (`boards/src/components/SoleilWordmark.jsx`), the email wordmark .2em, and the studio wordmark 1rem, much wider, because it stands alone on the page. A new product's wordmark uses .18em at display size (new in this guide). Aileron is never set in tracked capitals: use a Brandon eyebrow instead. The product type scale is the Clusters `.t-*` set, listed in [clusters.md](clusters.md).

Interface text is 13px (`body` and `.t-ui`); text people read at length is 14px (`.t-body`).

**Stand-ins.** Only where Adobe Fonts cannot load, such as decks and designs Claude makes, use Aileron's own CC0 files (Fontsource @fontsource/aileron 5.3.0) and Jost from Google Fonts in place of Brandon. Aileron 500 is in the Adobe kit but not in Fontsource's CC0 files, so a stand-in's 500 falls to 400. Never ship a stand-in in a product or on the studio site.

### Marks

The studio's mark is the **half-sun**: a sun rising from a flat base with a crown of curved rays. Clusters' mark is **three suns on a dashed orbit** that together form a C. Wordmarks are typed in Brandon capitals, never drawn. A new product gets its own mark drawn from the three-tone sun. Full rules, clear space, minimum sizes and don'ts are in [marks.md](marks.md).

### Texture: the grain

Soleil surfaces carry one fine, still film grain at one strength: `--grain-o` `.03` on dark and `.027` on light, from a seamless tile (`boards/src/assets/grain/grain-1x.webp`, made by `boards/scripts/grain/gen-grain.py`), painted at straight opacity with no blend mode. It lies on grounds, bars, menus, dialogs, toasts and pages. It never lies on content (cards, pictures, tables, documents), never on email, and it turns off in Clusters' Capture Mode. A new product copies the tile files from `boards/src/assets/grain/`. It holds still: grain that moves reads as noise and costs the compositor. (`boards/src/styles.css`, the panel grain block; the still grain landed in commit 76eee91b.)

### Materials

- **Glass, sparingly.** A floating island is glass (`--sbf-glass`), an inset hairline (`--sbf-glass-line`) and one small shadow (`--sbf-glass-shadow`, `0 1px 1px`), and nothing softer. (`boards/src/components/sidebar/clusterSidebar.css` header.)
- **Menus are solid** (`--bg-3`): they open over photos, and glass would let the art run through the text. (`boards/src/styles.css` `.ctx-menu`.)
- **Scrims** behind a dialog are a near-black scrim at .45 on dark and .28 on light (`.modal-bg` and `[data-theme='light'] .modal-bg` in `boards/src/styles.css`).
- **Radii** are `--radius` 4, `--radius-sm` 6, `--radius-md` 8, `--radius-lg` 12, `--radius-xl` 16. Pills are fully round.
- **Shadows** are `--shadow-1`, `--shadow-2`, `--shadow-3`, each with its own light version.
- The studio register uses white-alpha glass instead: a round glass pill for navigation, white hairlines, white focus rings (`style.css` at the repo root).

### Icons

Phosphor (the @phosphor-icons/react package), regular weight, 16px, in `currentColor`. The `Icon` wrapper defaults to thin, which is drift (see [drift.md](drift.md)); `boards/src/lib/iconWeight.js` lifts thin and light to regular wherever a surface sets a floor (`IconWeightContext`: the canvas, documents, lists, toolbars, menus and floating chrome), and leaves weights chosen on purpose (regular, bold, fill, duotone) alone. Resting icons are `--ink-2`; hover and active are `--ink-0` on `--bg-hov` or `--bg-act`. Gold only when the thing is active. The fill weight is kept for a few deliberate cases, such as the sparkle on a notice. No emoji as icons; where an emoji once carried meaning it became an ink icon with a label. (`boards/src/components/Icon.jsx`; repo `CLAUDE.md`.)

### Motion

- **Product:** one curve, `--ease` `cubic-bezier(0.2, 0.8, 0.2, 1)`, and four durations: `--dur-quick` 80ms (presses), `--dur-fast` 120ms (hovers), `--dur-base` 200ms (state changes, menus), `--dur-slow` 320ms (dialogs). No bounce. Under reduced motion, durations clamp to `--dur-fast` and entrances become opacity only. (`boards/src/styles.css`.)
- **Studio:** the sun and the wordmark glow share one slow breath of about 42 seconds; the wordmark's letters settle in over .75s, each 35ms after the last. Reduced motion stops both and shows the sun still. (`script.js`, `style.css` at the repo root.)

### Imagery

The work carries the colour. Each film keeps its own grade: the studio's posters share no palette, and they should not. Pictures are shown whole, with no grain and no tint over them. When Soleil needs sample content, it uses the studio's own films (the Clusters link card is built from them; `boards/scripts/generate-og.mjs`). Over a busy picture, any text sits on a scrim.

### Email

Every Soleil product sends the same email look, called Darkroom inside the code and never named to readers: always dark, 560px wide, a `#121215` card on a `#0a0a0c` page, the product's mark on top, one white button (`#f5f5f7` with `#0a0a0c` text), system fonts, no gold, no emoji, and the footer "<Name> by Soleil Pictures · <domain>". The look lives in `supabase/functions/_shared/email/theme.ts`; the sign-in email `supabase/templates/magic_link.html` is generated by `boards/scripts/gen-magic-link.mjs`, never edited by hand. Details in [clusters.md](clusters.md).

### Print and PDF

White paper, ink text, the light-ground mark, no grain, and the endorsement line at the foot. (New in this guide.)

## Using this guide

- **Starting a new product:** follow the numbered checklist in [family.md](family.md), then draw the mark with [marks.md](marks.md).
- **A deck, a design or a page Claude makes:** use the Soleil design system in Claude, which is built from this folder and `docs/brand/tokens.json`. Studio work takes the studio register; product work takes the product register.
- **A case the guide does not cover:** ask what the room would do. Night first, one sun, the work carries the colour, say what it does.
- **When the code changes:** the brand guide test (`boards/src/lib/brandGuide.test.mjs`) pins the tokens in `docs/brand/tokens.json` to their sources and checks that every colour and path in these pages is real. If it goes red, change the guide and the code together, or record the difference in [drift.md](drift.md). Do not quietly change a canon value to make the test pass.

## Sources

- Clusters tokens: `boards/src/styles.css` (`:root` and `[data-theme='light']`), `boards/src/components/sidebar/clusterSidebar.css`
- Marks: `boards/src/lib/sunMark.js`, `boards/public/clusters-logo-dark.png`, `boards/public/clusters-logo-light.png`, `assets/soleilpictures_favicon.png`, `assets/soleil_pictures_favicon.png`
- Email: `supabase/functions/_shared/email/theme.ts`, `supabase/functions/_shared/email/templates.ts`
- Studio site: `index.html`, `style.css`, `script.js` at the repo root
- Structured data: `boards/index.html`, `index.html`, `boards/src/lib/brandJsonLd.test.mjs`
- Words: `boards/src/lib/billingCopy.js`, `boards/src/lib/undoToast.js`, `boards/content/docs/`
- Founding look spec: `boards/docs/superpowers/specs/2026-05-04-boards-luxury-polish-design.md` (its warmer gold and warm ground were later replaced by the values above)
