# Board generator — seed SEO example boards

Authors real, great-looking Clusters boards from a JSON **recipe** and publishes
them as indexable `/c/<slug>` marketing pages (also listed on `/explore`, the
sitemap, and the image sitemap). This is the "do it now" way to populate the
public-board SEO surface without waiting for user uploads.

It reuses the app's exact data model — a Y.Doc snapshot in `board_state` plus the
`card_index` mirror the SEO RPCs read — so a generated board is indistinguishable
from a hand-built one, and it goes straight through the existing public-board
pipeline (`public_boards` → `/c/<slug>`).

## How it works

For each recipe:
1. Creates a `boards` row in the showcase workspace.
2. For every image card, fetches a license-safe photo (Unsplash / Pexels /
   Wikimedia), uploads the bytes to R2, and inserts an `images` row.
3. Masonry-lays-out the cards so the board looks composed.
4. Encodes the Y.Doc snapshot → `board_state.doc`, and mirrors cards → `card_index`.
5. Adds an image-attribution note.
6. Publishes `public_boards` (slug + SEO copy from the recipe) and pings IndexNow.

## Setup

```
cp scripts/.env.example scripts/.env    # then fill in the values
```

You need (see `.env.example` for the full list):
- **Supabase** URL + **service_role** key (bypasses RLS for the showcase writes).
- **R2 S3 credentials** — the same account id / bucket / access key / secret the
  Worker + `party/upload.ts` already use for `soleil-boards-images`.
- **`SEED_WORKSPACE_ID`** + **`SEED_USER_ID`** — a dedicated showcase workspace
  (owned by an admin account) so seeded boards don't clutter a real user.
- **Unsplash** + **Pexels** free API keys (Wikimedia needs none).

## Usage

```
# Validate a recipe offline (no network, no writes) — prints layout + would-be publish:
node scripts/seedBoard.mjs scripts/seed-recipes/world-cup-2026-moodboard.json --dry-run

# Build + publish for real:
node scripts/seedBoard.mjs scripts/seed-recipes/world-cup-2026-moodboard.json

# Build but leave unpublished (inspect in-app first):
node scripts/seedBoard.mjs scripts/seed-recipes/film-noir-look-book.json --no-publish
```

After publishing, the board is live at `https://<origin>/c/<slug>`, appears on
`/explore`, and is in `/sitemap.xml` + `/sitemap-images.xml`. Submit the sitemap
in Google Search Console and request indexing on the flagship URLs.

## Writing a recipe

See `seed-recipes/*.json`. Shape:

```jsonc
{
  "slug": "world-cup-2026-moodboard",   // ^[a-z0-9]+(?:-[a-z0-9]+)*$, <=80, not reserved
  "name": "World Cup 2026 — Visual Reference Board",
  "priority": 5,                          // higher sorts earlier on /explore
  "seo": {
    "title": "World Cup 2026 Mood Board", // <=60, keyword in title
    "description": "...",                  // 50-155 chars
    "body": "...",                         // >=40 unique words
    "keyword": "world cup 2026 mood board"
  },
  "cards": [
    { "id": "note-intro", "kind": "note", "span": "full", "fontFamily": "display",
      "html": "<p><b>Title</b></p>" },
    // An image card with a source is fetched from that provider. count > 1
    // expands into that many distinct photos from the same search.
    { "id": "img-a", "kind": "image",
      "source": { "provider": "unsplash", "query": "north american city skyline", "count": 3 } },
    { "id": "pal", "kind": "palette", "title": "Palette",
      "swatches": [ { "hex": "#0b7d3e", "name": "Pitch green" } ] }
  ]
}
```

Card kinds: `image` (with `source`), `note` (`html` + optional `bgColor`,
`fontFamily`), `palette` (`swatches:[{hex,name}]`). `span:"full"` makes a card
run the full board width (good for a title banner). Positions are auto-laid-out;
add explicit `x`/`y` to place a card manually.

## Quality bar

Public boards should have **≥3 images**, unique SEO copy, and a real color story.
The generator warns if a board has fewer than 3 images. Keep each board genuinely
useful and distinct — thin, near-duplicate pages get demoted by Google.

## Notes

- The `/api/public-img` route serves card images straight from R2, so images work
  on the public page as soon as they're uploaded (variants/blur backfill later via
  the daily cron). The OG image uses the first image (`og_image_key`); a composite
  board thumbnail is rendered later by the app's thumbnail backfill.
- Runs out-of-band against **prod** Supabase/R2 — it is not part of the build/deploy.

---

# Boards engine — boards made every day, shot in the real app

`scripts/engine/` makes finished example boards on its own and files them in
**Admin › Boards** with their marketing shots. Nothing it makes goes public by
itself: a board reaches a `/c/<slug>` page only through a normal land.

```
node scripts/engine/run.mjs --daily                 # the day's marketing board (skips if one was made in the last 20h)
node scripts/engine/run.mjs --page /tools/costume-design-mood-board
node scripts/engine/run.mjs --subject costume       # one board on a marketing subject
node scripts/engine/run.mjs --batch --spares 2      # every search page without a board, then spares
node scripts/engine/run.mjs --page /tools/storyboard-maker --dry-run   # no writes; shots stay in ENGINE_HOME/out
```

One board, step by step:

1. **Recipe** (`recipe.mjs`): Claude writes the board from the subject's brief
   (`subjects.mjs`): sections, notes, a palette, a script page, photo searches.
2. **Photos** (`photos.mjs`): Pexels and Unsplash only (free for ads, credits
   kept); every photo goes through `~/soleil-social`'s aicheck (detectors, then
   Claude looks). A photo used on another board, by id or by look, is never used again.
3. **Layout** (`build.mjs`): the app's own grid maker, so it reads like a board
   someone made.
4. **Check** (`check.mjs`): nothing overlaps, every photo real and licensed,
   notes readable on their colours. A failure means one redo, then it's dropped.
5. **Shots** (`shoot.mjs`): the real app, built from this checkout and staged
   signed in with a stubbed backend, photographed by Playwright: desktop light
   and dark, wide, board only (4K) light and dark, phone, 4:5, 1:1, card cut-outs
   and a zip. Claude grades the board-only shot; under the bar, one redo with its notes.
6. **Write** (`../lib/showcaseWrite.mjs`): a real board in the Showcase workspace,
   under its subject's cluster; shots to R2 under `showcase/<board id>/`, readable
   only through the signed links Admin › Boards gets (`worker-showcase.js`).

The first ten boards wait for a person's OK in Admin › Boards; after that they
go straight into the library. Every run is a `showcase_runs` row, and the tab
says so when the engine goes quiet.

**Every morning:** `node scripts/engine/install.mjs` makes its own checkout at
`~/soleil-engine` and a launchd job (`com.soleil.boards-engine`) that runs
`daily.sh` at 06:00: the checkout moves to the newest main, then `--daily`.
Log: `~/Library/Logs/boards-engine.log`. `--remove` takes the job out.

Needs `scripts/.env` (as above, plus `PEXELS_API_KEY`), `~/soleil-social`
(`SOLEIL_SOCIAL` to move it) and the `claude` CLI signed in. Work files live in
`ENGINE_HOME` (default `~/.boards-engine`).
