# Soleil Scout

Text photos, links and notes to a number; they land arranged on a Clusters
canvas. An account, workspace and board materialize behind a first-time sender —
no form, no password, no app.

## Why this is a separate service

It would be cheaper to run on the existing `soleil-boards` Worker, and an
earlier draft did. That doesn't work: `@spectrum-ts/imessage` depends on
`@grpc/grpc-js` + `nice-grpc` and imports `node:child_process`, `node:fs/promises`,
`node:os` and `node:path`. Photon's iMessage provider speaks gRPC and spawns
subprocesses, so no Cloudflare compat flag makes it run.

A Worker could have *received* Photon webhooks. It could never have *sent* a
reply, and a bot that can't reply isn't the product.

Running in Node also gets `heif2jpeg` for free, which matters more than it
sounds: iPhones send HEIC, and **Chrome and Firefox cannot render HEIC** — only
Safari can. Testing on a Mac in Safari will hide that bug completely.

## Layout

```
scout/src/
  index.js     entry — consumes Photon's async-iterator message stream
  batcher.js   per-conversation burst debounce
  pipeline.js  the ingest pipeline (see the ordering comment at the top)
  media.js     HEIC → JPEG, dimension probing, R2 upload, images row
  replies.js   everything the bot says
  config.js    env → the `env` object the shared modules expect
  dryrun.js    exercise the whole pipeline with no messaging provider
```

The canvas-writing logic is **not** here. It lives in `boards/src/lib/scout*.js`
and is shared with the Worker, so there is one implementation of the thing that
must not go wrong:

| module | role |
| --- | --- |
| `scoutIdentity.js` | handle → user, minting the shell account on first contact |
| `scoutIntent.js` | one LLM call for intent; deterministic fallback always |
| `scoutCards.js` | cards + contact-sheet layout |
| `scoutBoard.js` | **the triple write** |
| `scoutDb.js` | service-role Supabase, and the user session for the Yjs peer |

## The triple write

A browser client writes three places, so this must too. Doing fewer is data
loss, not a degraded experience:

1. **live PartyKit Y.Doc** — cards appear on an already-open canvas
2. **`board_state.doc`** — cold load, *and* its trigger (`recompute_image_refs`,
   migration 0127) is what populates `images.referenced_in_board_ids`. Skip it
   and the R2 orphan sweep eventually **deletes the user's photos**
3. **`card_index`** — search, home graph, and the demo-cap trigger

`card_index` is written **first** because it carries the cap enforcement — a
capped user is rejected before anything appears on their canvas.

## Running it

```sh
cp .env.example .env        # then fill it in
npm install
npm start
```

Deploy from the **repo root**, because the image needs `boards/`:

```sh
fly deploy --config scout/fly.toml --dockerfile scout/Dockerfile .
fly scale count 1 --config scout/fly.toml
```

Exactly one machine. Duplicate delivery is already safe (`scout_log_ingest` is a
unique constraint on `(platform, provider_message_id)`), but each process
debounces in its own memory — a burst split across two machines becomes two
layout passes and two replies for one dump of photos.

## Verifying without a provider

```sh
node src/dryrun.js +15555550123 "scene 4 diner, check power drops" a.heic b.jpg
```

Runs a synthetic burst through the real pipeline against real Supabase + R2,
then asserts that `board_state` decodes to the cards written, `card_index`
mirrors them, no two cards overlap, and — the one that matters most —
**every image references the board**, so the orphan sweep can't reclaim them.
That failure is invisible for 30 days, which is why it's a hard assertion.

Then open a converted HEIC card **in Chrome, not Safari**.

## Open questions for Photon

Unresolved at time of writing; the answers change the launch plan, not the code:

1. What counts as a "user" for the 10/100 tier limits — total, monthly active,
   or concurrent?
2. Can a **Pro** project send the first message to someone who submitted their
   own number on our site? Pricing lists cold outreach as a Business feature;
   the deliverability docs give 50 new conversations/line/day with no tier
   distinction.
3. Is SMS/RCS shipped? Pricing lists it as included, but there's no provider
   doc and their own FAQ asks when it's coming. If it isn't, v1 is Apple-only
   and the landing copy has to say so.
4. Do inbound photos arrive as original HEIC bytes at full resolution?
