# Soleil Scout

Text photos, clips, voice notes, PDFs, links and plain text to a number; they
land arranged on a Clusters canvas. An account, workspace and board materialize
behind a first-time sender — no form, no password, no app.

Voice notes are transcribed, so what you said is searchable. Photos keep their
capture time and, where the phone recorded it, their coordinates.

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
  index.js      entry — consumes Photon's async-iterator message stream
  batcher.js    per-conversation burst debounce
  pipeline.js   the ROUTER: what does this message mean
  ingest.js     the UPLOADER: what happens to the bytes once it means "ingest"
  media.js      HEIC → JPEG, EXIF, dimension probing, R2 upload, images row
  ffmpeg.js     video probe, poster frame, HEVC → H.264, audio down-convert
  transcribe.js voice note → text, via Workers AI
  filing.js     propose / confirm / undo a move between boards
  sheets.js     the pictures the bot texts back
  answers.js    curated replies to the questions people actually ask
  replies.js    everything else the bot says
  config.js     env → the `env` object the shared modules expect
  dryrun.js     exercise the whole pipeline with no messaging provider
```

`pipeline.js` and `ingest.js` were one file. They have genuinely different
reasons to change — one follows the conversation, the other follows the media
stack — and splitting them is what keeps either readable.

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

**Running it on a laptop against the LIVE line is the supported way to test it,
and the one thing that must not happen while you do is the invite queue
draining** — that texts real strangers from a development machine, and Photon
documents burst sending as a cause of line flagging. Scout has exactly one line.

```sh
SCOUT_INVITES_ENABLED=0 npm start
```

`ffmpeg` should be on the PATH. Without it the service still runs — video keeps
its original codec, gets no poster frame, and audio reports no duration — but
that is not what the deployed container does, so a clip you check locally is not
the clip your users get. The image installs it.

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
node src/dryrun.js +15555550123 "scene 4 diner" a.heic b.mov c.m4a d.pdf --file --voice
```

Runs a synthetic burst through the real pipeline against real Supabase + R2,
then asserts that `board_state` decodes to the cards written, `card_index`
mirrors them, every kind points at bytes it can actually load, no two cards
overlap, a portrait photo got a portrait card, the bot **said something**, and —
the one that matters most — **every file references the board**, so the orphan
sweep can't reclaim it. That failure is invisible for 30 days, which is why it
is a hard assertion, and `--file` re-checks it after a move, where two boards'
docs are rewritten and a card is briefly referenced by neither.

It writes to the real database. Use a number in the reserved `555-01xx` range
and delete the account afterwards.

The pure logic — what a short reply means, what "these" refers to, how a batch
is laid out — is covered by `npm test` from `boards/`, which needs no network.

Then open a converted HEIC card and a converted clip **in Chrome, not Safari**.
That is the check neither the harness nor a Mac can do for you.

## Open questions for Photon

Unresolved; the answers change the launch plan, not the code:

1. What counts as a "user" for the 10/100 tier limits — total, monthly active,
   or concurrent?
2. Can a **Pro** project send the first message to someone who submitted their
   own number on our site? Pricing lists cold outreach as a Business feature;
   the deliverability docs give 50 new conversations/line/day with no tier
   distinction. Until this is answered the invite queue cannot be trusted to
   drain, and `SCOUT_INVITES_ENABLED=0` is the safe default for any run that is
   not the deployed machine.
3. Do inbound photos arrive as original HEIC bytes at full resolution, **and do
   they keep their EXIF**? iOS strips location on some share paths. If it does,
   `shotAt`/`geo` quietly stop appearing — they are best-effort by construction,
   so nothing breaks, but the docs claim less than they should.

**Answered:** SMS/RCS is NOT shipped. The installed `@spectrum-ts` ships
providers for imessage, whatsapp-business, telegram, slack and terminal — there
is no SMS provider at all, so v1 is Apple-only and the landing copy says so.
WhatsApp Business is the nearest route to Android if that becomes the priority.
