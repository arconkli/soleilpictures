# Drift

Where today's surfaces differ from this guide. Each entry says what differs, where, what the guide says, and the fix. Nothing here has been fixed yet; this page is the list to work from. When an entry is fixed, delete it in the same commit. Back to the [brand book](README.md).

Entries marked **Open** are places the guide has not ruled; they need a decision before a fix.

## Colour

### 1. The studio's half-sun is a lighter gold

- **What:** both studio sun files are drawn in `#ffae42`, a lighter, yellower amber than `soleil`. The studio site has no named brand colour at all.
- **Where:** `assets/soleilpictures_favicon.png`, `assets/soleil_pictures_favicon.png` (the favicon, link image and structured-data `logo` on `index.html`, `about-us.html` and `projects.html` at the repo root).
- **Guide:** marks are drawn in `soleil` (`#ffa500`).
- **Fix:** redraw both from one SVG source in `soleil`; export the favicon sizes from it.

### 2. Studio near-blacks

- **What:** the studio page ground is `#0a0a0f`; its `theme-color` is `#000000`. Neither is night, and they differ from each other.
- **Where:** `style.css` at the repo root (`html` background); `<meta name="theme-color">` in every page at the repo root.
- **Guide:** the ground is `night` (`#0a0a0c`), and the browser's theme colour matches the ground.
- **Fix:** set both to `#0a0a0c`.

### 3. Clusters' theme colour and boot ground are warm

- **What:** the browser theme colour, both web manifests' `theme_color`, and the server-rendered fallback page use the old warm ground `#0a0908`; the fallback's text is a warm `#e8e4dc`. The manifests' `background_color` is already night.
- **Where:** `boards/index.html` (`theme-color` and `#seo-fallback`), `boards/public/manifest.webmanifest`, `boards/public/admin.webmanifest`.
- **Guide:** `night` for the ground and the theme colour; `ink` for text.
- **Fix:** change the four values to `#0a0a0c` and `#f5f5f7`.

### 4. Link card grounds are warm

- **What:** the plain card is on `#0a0908`; the newer cards use a radial from `#1d130a` to `#0a0809`; `boards/public/og/share-fallback.jpg` is `#0a0809` at the corner. Subline greys are warm.
- **Where:** `boards/scripts/generate-og.mjs`, `boards/public/og/`.
- **Guide:** night ground; a soft gold glow is allowed as atmosphere, so the newer card's warm centre may stay if it fades to night.
- **Fix:** end every gradient on `#0a0a0c`, set the plain card's ground to night, regenerate, bump `?v=`.

### 5. Gold used as decoration on link cards

- **What:** the plain card uses gold for a dot, the domain and a bar along the bottom edge: three accents.
- **Where:** `boards/scripts/generate-og.mjs` (`boards/public/og/default.png`).
- **Guide:** one gold accent per shared picture.
- **Fix:** keep one (the eyebrow or the dot); set the domain in quiet ink; drop the bar.

### 6. Gold on text

- **What:** server-rendered fallback pages set links and eyebrows in gold, and the sign-in page sets its credential line, "Made by a film studio, for creative professionals.", in gold beside the gold sign-in button.
- **Where:** `boards/src/worker.js` (an inline gold, `#ffa500`, on the fallback links); `boards/src/auth/signin-backdrop.css` (`.sb-trust`, also used on the Scout page).
- **Guide:** gold never on links in running text or on a line of copy; one gold action per view.
- **Fix:** ink links with an underline; the credential line in `--ink-2`; gold only on the one action, if any.

### 7. Text on gold that is not ink-on-soleil

- **What:** on sign-in, the backdrop's play button sets `#1a1a1a` on gold, and the sign-in button's hover is a lighter gold, `#ffb224`.
- **Where:** `boards/src/auth/signin-backdrop.css` (`.sb-ac-play`, `.sb-frost .auth-btn:hover`).
- **Guide:** text on gold is `ink-on-soleil` (`#1a1205`); gold is one value.
- **Fix:** use `var(--on-soleil)`; express hover as a ring or glow, as `.btn-primary` does.

### 8. A warm frosted surface

- **What:** `.surface-frosted` is a warm brown tint (`rgba(20,18,15,.72)`) in a chrome that is otherwise cool.
- **Where:** `boards/src/styles.css`.
- **Guide:** neutrals are cool and nearly grey.
- **Fix:** move to `--sbf-glass`, or to the `.modal` neutral.

### 9. Text below 4.5:1

- **What:** Clusters sets `.t-eyebrow`, placeholders and some quiet labels in `--ink-3`, below 4.5:1 (2.5 to 2.9 on dark grounds, 2.6 to 3.1 on light). The light-theme `--msg-ok` (3.1), `--msg-warn` (3.4) and `--msg-info` (4.4) are used as text in places, and `--danger` on `--bg-3` is 4.3. The studio's hint text goes down to .4 white (3.8).
- **Where:** `boards/src/styles.css`, `style.css` at the repo root.
- **Guide:** text people read meets 4.5:1 (see Contrast in the [brand book](README.md)).
- **Fix:** move the text to `--ink-2`, or darken the light status colours until they pass; check each against 4.5:1.

## Marks and icons

### 10. iOS splash is the stock placeholder

- **What:** the three iOS splash images are Capacitor's placeholder, a light blue X on white, not the Clusters mark on night.
- **Where:** `boards/ios/App/App/Assets.xcassets/Splash.imageset/`.
- **Guide:** splash is night with the mark small and centred, as `boards/assets/splash-dark.png` already is.
- **Fix:** generate the iOS splash from `boards/assets/splash-dark.png`. (Whether iOS shows it, given the splash hides only after the app mounts, is unverified.)

### 11. Three app-icon grounds

- **What:** iOS is the mark full bleed on night. Android's adaptive background PNG is gold (`#ffa500`) while its colour resource says `#ffffff`. The Apple touch icon, the sign-in mark and the MCP logo sit on charcoal `#282828`. Web icons are transparent and marked `maskable`, which a transparent, unpadded mark is not safe for (unverified).
- **Where:** `boards/android/app/src/main/res/` (the `ic_launcher_background` PNGs and colour resource), `boards/assets/icon-background.png`, `boards/public/apple-touch-icon.png`, `boards/public/signin-logo-mark.webp`, `mcp/logo-400.png`, `boards/public/manifest.webmanifest`.
- **Guide:** the mark full bleed on night, from one source, everywhere.
- **Fix:** one night background for Android (PNG and colour resource), regenerate the touch icon and MCP logo on night, add padded maskable icons.

### 12. Light-tab favicon

- **What:** the favicon is a transparent mark with cream dashes; on a light browser tab the orbit disappears and only the suns show.
- **Where:** `boards/public/favicon.png`, `boards/public/favicon.ico`.
- **Guide:** a favicon holds on both light and dark tabs.
- **Fix:** add a light-scheme favicon with charcoal dashes, or put the mark on a small night tile.

### 13. The Clusters mark has no master SVG

- **What:** the mark exists only as PNGs; the vector in `boards/src/lib/sunMark.js` is a fitted copy that differs slightly.
- **Where:** `boards/public/clusters-logo-dark.png`, `boards/public/clusters-logo-light.png`, `boards/src/lib/sunMark.js`.
- **Guide:** every mark is kept as an SVG source.
- **Fix:** promote the fitted vector, once checked against the PNG, to the source and generate the PNGs from it.

### 14. Studio icon files

- **What:** the studio favicon is a 4321px PNG used directly as favicon and link image, on a `summary` card. There is no ICO file, touch icon, SVG or 1200x630 studio card. The outline sun file is unused.
- **Where:** `assets/soleilpictures_favicon.png`, `assets/soleil_pictures_favicon.png`, `index.html` at the repo root.
- **Guide:** proper favicon sizes; a link card on night with the typed wordmark.
- **Fix:** with entry 1, export favicon sizes and make a studio link card.

### 15. Stale icon README

- **What:** the icon README calls the icon "the Soleil sun mark"; the files are the Clusters mark.
- **Where:** `boards/assets/README.md`.
- **Fix:** rename it the Clusters mark and link [marks.md](marks.md).

### 16. Icon weight default

- **What:** the `Icon` wrapper defaults to `thin`. Surfaces that set a floor (`IconWeightContext`: the canvas, documents, lists, toolbars, menus, floating chrome and Quick look) lift thin and light to regular through `shownWeight`; an icon drawn outside them, with no weight given, is thin.
- **Where:** `boards/src/components/Icon.jsx`, `boards/src/lib/iconWeight.js`.
- **Guide:** Phosphor regular.
- **Fix:** default to `regular`.

### 17. Link card wordmark

- **What:** the plain card sets "Soleil Clusters" in a system neo-grotesque; the newer cards set "CLUSTERS" in Brandon capitals.
- **Where:** `boards/scripts/generate-og.mjs`, `boards/public/og/default.png`.
- **Guide:** wordmarks are Brandon capitals.
- **Fix:** move the plain card to the newer design.

## Texture, type and motion

### 18. Studio grain moves

- **What:** the studio's grain is an animated GIF on the home, about and projects pages only; detail and viewer pages have none. Its relative path breaks on nested URLs.
- **Where:** `assets/grain.gif`, `.grain-bg` in `style.css` at the repo root.
- **Guide:** one still grain wherever the ground shows.
- **Fix:** use the Clusters tile (`boards/src/assets/grain/grain-1x.webp` and its 2x) at `.03`, with a root-relative path, on every page.

### 19. Grain comment

- **What:** the light-mode comment says grain "reads a touch stronger", but the value is lower (`.027`), as commit 76eee91b intends.
- **Where:** `boards/src/styles.css`, `--grain-o` in `[data-theme='light']`.
- **Fix:** correct the comment.

### 20. Studio type leftovers

- **What:** a fallback face ("Alfarn") that loads nowhere, a preconnect to a Google Fonts host that serves nothing, Aileron hard-coded without a fallback in one rule, and a later `.content h2` rule that overrides the About headings.
- **Where:** `style.css`, `index.html` at the repo root.
- **Fix:** remove the dead names and preconnect; add fallbacks; resolve the duplicate rule.

### 21. Studio wordmark markup

- **What:** detail pages set the name in a `<p>`, so the letter entrance does not run.
- **Where:** the two film detail pages at the repo root.
- **Fix:** use the same `<h1>` and class as the home page.

### 22. Studio motion without reduced motion

- **What:** the scroll hint bounce, carousel dots, About rows and chevrons still animate under reduced motion.
- **Where:** `style.css` at the repo root.
- **Guide:** reduced motion stops loops and keeps only opacity changes.
- **Fix:** add them to the reduced-motion block.

### 23. Two toast definitions

- **What:** the base toast is solid `--bg-2`; the chosen look is glass. Two rules to reconcile.
- **Where:** `boards/src/styles.css`, `boards/src/components/feedbackLook.css`.
- **Fix:** keep one, the chosen look.

### 24. Mono weights

- **What:** JetBrains Mono loads at 500 only from Google Fonts; document code asks for other weights, which are synthesised.
- **Where:** `boards/src/styles.css`, `boards/src/lib/docTypography.js`.
- **Fix:** use 500 only, or self-host the weights in use.

## Words and names

### 25. Board in public copy

- **What:** people-facing copy says board for the object: the sign-in scenes ("Share a board with one link", "Jump between boards"), a home fact note ("ask for a board"), the nudge "boards get good at 3+", the join email's "Open board", and lifecycle notes ("your board").
- **Where:** `boards/src/auth/SignInBackdrop.jsx`, `boards/src/lib/homeFactNotes.js`, `supabase/functions/_shared/email/templates.ts`.
- **Guide:** inside the product and its email, cluster. See [voice.md](voice.md#cluster-and-board).
- **Fix:** change those strings to cluster. Leave "mood board" and "reference board" on search pages.

### 26. Studio self-description

- **What:** the studio describes itself three ways, two of them as "a rising production company … pushing the boundaries of filmmaking".
- **Where:** `index.html`, `about-us.html` at the repo root.
- **Guide:** describe, don't claim.
- **Fix:** one plain sentence, the same in meta, link text and structured data.

### 27. Studio structured data

- **What:** the studio node has no `sameAs`, its `logo` is a plain string (Clusters' is an `ImageObject`), and its `url` has no trailing slash where Clusters' does.
- **Where:** `index.html` at the repo root.
- **Fix:** match the Clusters form; add `sameAs` only for profiles the owner confirms. Extend `boards/src/lib/brandJsonLd.test.mjs`.

### 28. Studio chrome varies by page

- **What:** the navigation differs page to page; the PDF viewer pages leave `<nav>` unclosed and have no wordmark or grain; one detail page is titled after the wrong film; statuses disagree between detail pages and Projects.
- **Where:** the HTML pages at the repo root.
- **Fix:** one navigation and one page frame for every studio page.

### 29. Open: lowercase name in lifecycle email

- **What:** lifecycle notes write "clusters" lowercase as the product name ("talk soon, the clusters team").
- **Where:** `supabase/functions/_shared/email/templates.ts`.
- **Open:** the lowercase note is a deliberate register; the guide has not ruled whether names keep their capital inside it.

### 30. Open: smaller word choices

- The free plan is called both Free and Demo (`boards/src/lib/billingCopy.js`, `boards/content/docs/`).
- Settings paths use both → and › (`boards/public/changelog.md`, `boards/content/docs/`).
- Feature names vary in case: Capture Mode and Capture mode; Quick look and Quick Look.
- Errors mix "Couldn't" (straight and curly apostrophes) with "Could not".
