---
title: Cards API — Soleil Clusters
metaDescription: Add, read, update, move and delete Soleil Clusters cards over REST. Field reference, size limits, auto-placement and the delete-is-the-undo pattern.
h1: Cards API
navLabel: Cards
section: developers
order: 4
updated: 2026-10-28
answer: Read a board's cards with GET /boards/:id/cards, add up to {{fact:maxCardsPerCall}} at a time with POST, change one with PATCH, move a set with the move endpoint, and remove one with DELETE — which returns the whole card it deleted, so the response body is your undo. An unknown kind is rejected rather than silently coerced. A note shows its title as its heading and is made as tall as its text, and a card names its section by name.
faq:
  - q: What happens if I send an unrecognised kind?
    a: A 400 naming the kinds that are valid. It used to fall back to note silently, which produced boards full of notes that should have been links.
  - q: How do I add an image?
    a: Upload the bytes to /uploads first, then create a card with kind image and the image_key it returned.
  - q: What does live false mean in the response?
    a: The cards are saved, but a canvas someone already has open will not show them until it reloads. It is not a failure.
  - q: How do I put cards in sections?
    a: Name the section on each card in group. The card goes in the board's group of that name, which is made with the cards when the board has none, and an optional groups list sets the sections' order and colours.
  - q: Why leave out w and h?
    a: A note left without them is made as tall as its text, and a palette wide enough to name every colour. A note given a height keeps it, and its text fades out where the card ends.
related:
  - /docs/api/boards
  - /docs/api/docs
  - /docs/api/images
  - /docs/api/errors
---

## The card object

```json
{
  "id": "api-m8x2p1-7fq3ka",
  "kind": "note",
  "x": 120, "y": 340, "z": 3,
  "w": 280, "h": 83,
  "title": "Tone",
  "body": "Warm, low-key, practicals only",
  "html": "<h2>Tone</h2><p>Warm, low-key, practicals only</p>",
  "url": null,
  "image_key": null,
  "alt": null,
  "color": "#f3ddaa",
  "created_at": "2026-08-01T09:14:02.000Z",
  "updated_at": "2026-08-01T09:19:55.000Z"
}
```

A card that is in the cluster but **not on its board** — taken off the board
with Remove from board, waiting in [Files](/docs/clusters/list-view) — carries
`"unplaced": true`. It's listed like any card and still has a position (where
it waits, below the board's content), but the canvas doesn't draw it. The field
is only present when it's true, and it can't be written through the API.

Interior state the editor owns — grid layouts, adjustment settings,
collaborative document structure — is deliberately not exposed. An API caller
should not be able to write arbitrary internals into everyone's board.

## Kinds

The API accepts {{fact:apiCardKinds}}.

| Kind | Carries |
|---|---|
| `note` | `title` as its heading, `body`, `html`, `color` as its fill — see [Notes](#notes) |
| `image` | `image_key`, `alt`, `body` as the caption — see [Pictures](#pictures) |
| `link` | `url`, `title`, `body` |
| `doc` | `title`, `body`, `html` |
| `video` | `file_key`, optional `poster_key` |
| `audio` | `file_key`, `title`, `body` as a transcript |
| `pdf` | `file_key`, `file_name`, optional `image_key` for the page-1 still |
| `file` | `file_key`, `file_name`, `mime`, `ext`, `size_bytes` |
| `palette` | `title`, `swatches` — see [Palettes](#palettes) |

`video` and `file` exist because [multipart upload](/docs/api/images) accepts
ProRes, MXF, DPX and camera raw — so without them you could upload a two-terabyte
camera master and then have no way to put it on a board. An upload you cannot
place is not an upload.

`audio` and `pdf` exist for the narrower version of the same problem: the canvas
creates both when you drop a file on it, and the API refused both — so a kind you
could make by dragging could not be made through the API. Soleil Scout creates
them too, from a texted voice note or PDF.

An `audio` card's `body` is its **transcript** where one exists, which is what
makes a spoken note findable through [search](/docs/api/search) rather than
something you have to play to identify.

An unrecognised `kind` gets a `400` naming the valid ones. It is **not**
coerced — silently turning an unknown kind into a note produced boards full of
notes that were meant to be links.

This is still narrower than [what the canvas supports](/docs/canvas/cards).
Grids and shapes are created in the app; you can read them
here, and `?include=raw` gives you their full contents.

## Notes

A note shows its `html`. Send a `title` and a `body` instead and the note is
written the way the app writes one: the title as its heading and the body as
its text, where a line starting `- `, `* ` or `• ` is a bullet, `1. ` a
numbered item, `[ ] ` or `[x] ` a checkbox and `#` or `##` a heading, and
`**bold**`, `*italic*` and `[text](https://…)` are what they say. Everything
else is text, exactly as sent. `title` and `body` are kept as you sent them:
they are what search and every read return.

Send your own `html` and it is used as it is, under your `title` as a heading
when it doesn't open with one.

**Sized to its text.** Leave `h` out and a note is as tall as its text at its
width — {{fact:noteWidth}}px unless you give `w`, or {{fact:noteWideWidth}}px
when the text needs the room — from {{fact:noteMinHeight}} to
{{fact:noteMaxHeight}}px, the tallest a note grows in the app. A note whose text
runs past that comes back named in `warnings`: on the board its end fades out,
and long writing reads better as a [doc](/docs/api/docs).

**Colour.** A note's `color` is its fill, a hex colour such as `#f3ddaa` or one
of the [named colours](#named-colours), and its text turns dark or light to read
on it. Anything else is a `400`. A note made without a `color`, in a section
that has one, takes the section's colour lightened (its tint), so the sections
read apart at a glance — but not on a board where pictures lead (at least
{{fact:autoLeadShare}} of its cards pictures, and some sections words: their
colours carry it), and not on a board of one section. Send `"color": null` or
`""` to keep a note plain, or to take a note's colour off with an update; over
[MCP](/docs/mcp), where a null means a value wasn't given, `""`. Other kinds keep
`color` as given.

**Changing one.** A new `title` or `body` on a note the API wrote is written
into it the same way, and its height follows unless you send `h`. A note that
has since been edited in the app keeps the text it has there, and a note
resized by hand keeps its size. A note the API made before notes worked this
way is brought up to date the next time its board is
[arranged](/docs/api/arrange).

## Palettes

A `palette` card is a row of colours, each a hex and, if you like, a name:

```json
{ "kind": "palette", "title": "Tokyo noir, 1974",
  "swatches": [ { "hex": "#0b1d2a", "name": "Night" },
                { "hex": "#c8102e", "name": "Lantern" }, "#e9c46a" ] }
```

Up to {{fact:paletteSwatchesMax}} swatches; a plain hex string is a swatch with
no name. Left without `w` and `h`, the card is made wide enough for every swatch
to show its name over its hex. It reads back with `swatches`, each with a `name`
only where one was given.

## Pictures

An `image` made from an `image_key` with no `w` and `h` takes the picture's own
shape: {{fact:noteWidth}}px wide, as a note is, or {{fact:pictureMaxHeight}}px
tall and narrower when the picture is tall, so it shows whole rather than
cropped.

## Writable fields

| Field | Type | Limit |
|---|---|---|
| `kind` | string | one of the kinds above |
| `title` | string | {{fact:cardTitleMax}} chars |
| `body` | string | {{fact:cardBodyMax}} chars |
| `html` | string | {{fact:cardHtmlMax}} chars |
| `url` | string | {{fact:cardUrlMax}} chars |
| `image_key` | string | {{fact:cardImageKeyMax}} chars — from [`POST /uploads`](/docs/api/images) |
| `file_key` | string | {{fact:cardImageKeyMax}} chars — for `video`, `audio`, `pdf` and `file` |
| `poster_key` | string | {{fact:cardImageKeyMax}} chars — a still for a `video` |
| `file_name` | string | 300 chars — the displayed name of a `pdf` or `file` |
| `mime` | string | 200 chars |
| `ext` | string | 20 chars |
| `size_bytes` | number | rounded |
| `alt` | string | 300 chars — image description |
| `color` | string | 40 chars — on a `note`, its fill: a hex colour or a [named colour](#named-colours) |
| `swatches` | array | a `palette`'s colours, up to {{fact:paletteSwatchesMax}} |
| `props`, `identifiers` | see [Identifiers and properties](/docs/api/metadata) | |
| `x`, `y` | number | rounded; omit for auto-placement |
| `w`, `h` | number | clamped to 40–4000; omit them and a note is sized to its text, a palette to its swatches, anything else 280 × 180 |
| `z` | number | stacking; higher is in front, fractional is fine |
| `rotation` | number | degrees, wrapped to −180…180 |
| `group` | string | {{fact:sectionNameMax}} chars — the [section](#sections) the card belongs in, by name |
| `group_id` | string | a group on this board, by id — anything else is a `400` |
| `section_header` | boolean | render as a full-width heading |
| `sub` | string | 300 chars — the line under a section heading |

Anything else in the payload is ignored. A client-supplied `id` is ignored — the
server generates one.

## `GET /boards/:id/cards`

Paginated with `limit` and `offset` — default {{fact:defaultPage}}, maximum
{{fact:maxPage}}.

```json
{ "board_id": "9f1c…", "cards": [ … ], "limit": 100, "offset": 0,
  "has_more": false, "next_offset": null }
```

Follow `next_offset` until it is `null`. Do not assume one page is the whole
board.

### `?source=index` — for large boards

The default reads the **live** board, so a card a collaborator added seconds ago
is already there. The cost is that it loads the whole board to answer: `limit`
and `offset` are applied afterwards, so paging a large board re-reads it once
per page, and `total` is only knowable by reading all of it. Fine for a hundred
cards; wasteful for a hundred thousand.

`?source=index` reads the row-per-card mirror instead, paged by `cursor`:

```json
{ "board_id": "9f1c…", "source": "index",
  "cards": [ { "id": "…", "kind": "image", "title": null, "x": 120, "y": 340,
               "image_key": "…", "updated_at": "2026-08-08T12:00:00Z" } ],
  "limit": 100, "has_more": true, "next_cursor": "api-m8x2p1-7fq3ka" }
```

Pass `next_cursor` back as `cursor`. Use this to **verify what exists** — after
a bulk import, say. It is a projection, not the card: enough to reconcile, not
enough to rebuild one. Fetch without `source` for the real thing.

Add `since=<ISO>` and it becomes a change feed, ordered by `updated_at` instead
of by id, with a cursor that carries both. That is the cheap way to ask "what
moved on this board since I last looked" without reading the board.

### `?include=`

| Value | Adds |
|---|---|
| `props` | The card's [properties](/docs/api/metadata) |
| `identifiers` | Its [foreign identifiers](/docs/api/metadata) |
| `raw` | The card exactly as the canvas stores it |
| `groups` | The board's [groups](/docs/api/arrange), as `groups` beside the cards, read in the same pass (not with `source=index`) |

`raw` exists because the card object above is a deliberately narrow projection,
and the app has kinds it does not describe — a grid carries its cells and
template and a palette its swatches. Those read back through
the projection with their interiors missing, which for anyone taking a backup is
data loss that looks like success.

`raw` is the card's **internal** shape: field names in it are not part of this
API's contract and can change with the app. Use it to preserve or reconstruct,
not to build logic on. [`/export`](/docs/api/export) includes it always.

A misspelled `include` is a `400` rather than a silent omission.

## `POST /boards/:id/cards`

Either shape works:

```json
{ "cards": [ { "kind": "note", "title": "Tone" } ] }
```

```json
{ "kind": "note", "title": "Tone" }
```

Up to **{{fact:maxCardsPerCall}}** cards per call; more gets `400`.

**Auto-placement.** Cards without `x`/`y` are placed for you, so a batch cannot
land on top of existing content. Pass both to place one yourself. On an empty
board, and for groups the board doesn't have cards in yet, cards are laid out as
[`auto`](/docs/api/arrange#the-layouts) lays them out: the groups as columns, as
blocks or with the pictures leading, whichever suits them, each with room for its
outline and name, in the order sent, under whatever is already
there, so tidying the board afterwards moves nothing. New cards for a group that
already has cards on the board go under those cards, or beside them, when there
is room there. Cards in no group, added to a board that has cards, go in the
free space beside them.

**`warnings`.** A card that landed but won't look as asked — a note too long to
show whole — is named in `warnings`, a list of sentences beside `cards`. The
cards are saved either way.

### Sections

Name a card's section in `group` and it goes in the board's group of that name,
made with the cards when the board has none — there is no need to make the group
first and copy its id onto every card. Names match whatever their case. An
optional `groups` list, up to {{fact:sectionsPerCall}}, sets the order the
sections are laid out in and the outline colour of any it makes, a hex or one of
the [named colours](#named-colours):

```json
{ "groups": [ { "name": "The canon", "color": "#3f7ab5" }, { "name": "To watch" } ],
  "cards": [
    { "kind": "note", "title": "Marty Supreme (2025)", "body": "9.75 / 10", "group": "The canon" },
    { "kind": "note", "title": "Heat (1995)", "group": "To watch" }
  ] }
```

The answer lists the sections the call named in `groups`, each with its `id` and
`"created": true` on one it made. A section made without a colour takes the next
named colour no section on the board wears yet, rather than the app's gold,
which marks what is selected; a section that already exists keeps its colour.
`group_id` still works and must name a group on the board; a card can't carry
both. Naming a section reads the board, as leaving out coordinates does.

### Named colours

There are {{fact:sectionColourCount}} colours a section's outline or a note's
fill can be given by name, in any case. A section takes the outline colour; a
note takes the tint, light enough for dark text in both themes. They are also
the colours a section takes when given none, in this order. A plain colour word
is the named colour nearest it, with or without `light` or `dark` before it, so
`red` is `rose` and `yellow` is `moss`:

{{fact:sectionColourTable}}

### Laying cards out

Pass `layout` — `auto`, `justified`, `masonry`, `grid`, `row` or `column` — to
arrange the whole batch as it lands instead of appending it in free space
(`auto` lays each section out as a block of its own), and use
[`POST /boards/:id/arrange`](/docs/api/arrange) to lay out cards that already
exist. A named layout arranges everything you sent, including cards that
carried their own `x` and `y`.

## Pass coordinates when you are importing

Placing cards for you means reading the whole board first, to know what to place
them around. That is the right default — but it means the call costs more the
more the board already holds.

**A batch where every card carries its own `x` and `y` skips that read**, and
costs the same on an empty board as on one with a hundred thousand cards. If you
are importing a library, you already know your layout, so send it:

```json
{ "cards": [
  { "kind": "image", "image_key": "…", "x": 0,   "y": 0,   "w": 300, "h": 200 },
  { "kind": "image", "image_key": "…", "x": 320, "y": 0,   "w": 300, "h": 200 }
] }
```

All or nothing: one card missing coordinates puts the whole batch on the
read-the-board path.

**`live`.** `true` means open canvases received the change immediately. `false`
means it is saved but a canvas someone already has open needs a reload. Never
treat `false` as failure.

### Adding the same cards twice

Give each card an `identifiers` array and pass `"on_conflict": "identifier"`,
and a card already carrying one is **updated in place** rather than added again:

```json
{ "on_conflict": "identifier",
  "cards": [
    { "kind": "image", "image_key": "…", "x": 0, "y": 0,
      "identifiers": [{ "scope": "shotgrid", "value": "Asset:12345" }] }
  ] }
```

The response carries `created` and `updated` counts. Run your importer twice
over three million assets and you get three million cards, not six. See
[Identifiers and properties](/docs/api/metadata).

Every card write also accepts `props` and `identifiers` directly, whether or not
you are upserting.

## `PATCH /boards/:id/cards` — many at once

```json
{ "cards": [
  { "id": "api-m8x2p1-7fq3ka", "title": "Approved" },
  { "id": "api-m8x2p1-9wq2lb", "props": { "status": "final" } }
] }
```

Up to {{fact:maxCardsPerCall}} per call. Each entry needs an `id`; everything
else is an ordinary partial patch. `group` moves a card into a
[section](#sections) by name (an empty one takes it out), and `groups` works as
it does when adding.

The board is opened **once** for the whole batch, which is the difference
between a five-hundred-card update taking a second and taking a minute — patching
one at a time opens, syncs, commits and closes each time.

Ids that were not on the board come back in `not_found` rather than being
silently skipped, because a bulk write that quietly does nothing for part of its
input is worse than one that fails.

## `DELETE /boards/:id/cards` — many at once

```json
{ "card_ids": ["api-m8x2p1-7fq3ka", "api-m8x2p1-9wq2lb"] }
```

Sent as a JSON body on `DELETE`, which is unusual but deliberate: a thousand
card ids do not fit in a query string, and making a destructive call look like a
`POST` would mislead every proxy, log and permission check between you and it.

Every removed card comes back, so the response is the undo — with the same
exceptions as the single delete below.

## `GET /boards/:id/cards/:cardId`

One card, as the list gives it, and `url`, the link that opens the board with
the card picked. `?include=` works as it does on the list.

```json
{ "board_id": "9f1c…", "card": { "id": "c-12", "kind": "note", … },
  "url": "https://clusters.soleilpictures.com/?to=c:9f1c…:c-12" }
```

## Doc cards

A doc card's pages are read and written as Markdown on routes of their own: see
the [Docs API](/docs/api/docs). `POST /boards/:id/docs` makes a doc with its
pages already in it.

## `PATCH /boards/:id/cards/:cardId`

A partial patch — only the fields you send change, and nothing gets a default.
The one thing that follows on its own is a note's text and height, as
[Notes](#notes) describes: a new `title` or `body` on a note the API wrote is
written into it, and its height follows unless you send `h`.

```sh
curl -X PATCH "$SOLEIL_API/boards/$BOARD/cards/$CARD" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Tone — revised","x":400}'
```

## `POST /boards/:id/cards/move`

```json
{ "to_board_id": "…", "card_ids": ["api-…", "api-…"] }
```

Write access is checked on **both** boards. Returns
`{ "moved": 2, "cards": [ … ], "live": true }`.

Moving cards to a board that **someone else owns** counts them against that
owner's [card allowance](#card-caps), the same as creating them there. If they
don't fit, nothing moves and the call returns `402 limit_reached`.

## `DELETE /boards/:id/cards/:cardId`

Requires the `delete` scope — see
[Authentication](/docs/api/authentication).

```json
{
  "deleted": true,
  "card": { …the entire card… },
  "restore_with": "POST /api/v1/boards/:id/cards"
}
```

**The response body is the undo.** There is no undo toast on an HTTP call, so
the card comes back — `POST` it to the cards endpoint to restore it. It returns
with a new id, and its identifiers and properties are not restored with it, so
send those again in the same `POST` if you use them.

Some cards cannot come back this way: any card kind this API does not create
(grids, cluster cards and the like), a palette set to hide its labels, and docs
written in the app, whose pages are stored apart from the card. A delete that removes any of them lists their ids in
`not_restorable`, with a `recover` sentence. They are not lost: every delete
saves the board to its Version history first, and they can be restored from
there in the app.

```ts
const { card } = await soleil(`/boards/${board}/cards/${id}`, { method: "DELETE" });
// …later, if that turns out to have been wrong:
await soleil(`/boards/${board}/cards`, { method: "POST", body: JSON.stringify(card) });
```

## Images

Two requests: upload the bytes, then create the card. See
[Images API](/docs/api/images).

## Card caps

Card creation is subject to the account's [card allowance](/docs/canvas/cards) —
**{{fact:demoCardLimit}}** on the free plan, counted against the **board
owner**. Exceeding it returns `402 limit_reached`, not `403`. See
[Errors](/docs/api/errors).
