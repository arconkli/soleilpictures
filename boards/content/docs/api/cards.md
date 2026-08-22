---
title: Cards API — Soleil Clusters
metaDescription: Add, read, update, move and delete Soleil Clusters cards over REST. Field reference, size limits, auto-placement and the delete-is-the-undo pattern.
h1: Cards API
navLabel: Cards
section: developers
order: 4
updated: 2026-08-10
answer: Read a board's cards with GET /boards/:id/cards, add up to {{fact:maxCardsPerCall}} at a time with POST, change one with PATCH, move a set with the move endpoint, and remove one with DELETE — which returns the whole card it deleted, so the response body is your undo. Eight card kinds are accepted and an unknown kind is rejected rather than silently coerced. Bulk PATCH and DELETE take a batch in one call.
faq:
  - q: What happens if I send an unrecognised kind?
    a: A 400 naming the kinds that are valid. It used to fall back to note silently, which produced boards full of notes that should have been links.
  - q: How do I add an image?
    a: Upload the bytes to /uploads first, then create a card with kind image and the image_key it returned.
  - q: What does live false mean in the response?
    a: The cards are saved, but a canvas someone already has open will not show them until it reloads. It is not a failure.
related:
  - /docs/api/boards
  - /docs/api/images
  - /docs/api/errors
---

## The card object

```json
{
  "id": "api-m8x2p1-7fq3ka",
  "kind": "note",
  "x": 120, "y": 340, "z": 3,
  "w": 280, "h": 180,
  "title": "Tone",
  "body": "Warm, low-key, practicals only",
  "url": null,
  "image_key": null,
  "alt": null,
  "color": null,
  "created_at": "2026-08-01T09:14:02.000Z",
  "updated_at": "2026-08-01T09:19:55.000Z"
}
```

Interior state the editor owns — grid layouts, adjustment settings,
collaborative document structure — is deliberately not exposed. An API caller
should not be able to write arbitrary internals into everyone's board.

## Kinds

The API accepts {{fact:apiCardKinds}}.

| Kind | Carries |
|---|---|
| `note` | `title`, `body`, `html` |
| `image` | `image_key`, `alt`, `body` as the caption |
| `link` | `url`, `title`, `body` |
| `doc` | `title`, `body`, `html` |
| `video` | `file_key`, optional `poster_key` |
| `audio` | `file_key`, `title`, `body` as a transcript |
| `pdf` | `file_key`, `file_name`, optional `image_key` for the page-1 still |
| `file` | `file_key`, `file_name`, `mime`, `ext`, `size_bytes` |

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
Grids, schedules, palettes and shapes are created in the app; you can read them
here, and `?include=raw` gives you their full contents.

## Writable fields

| Field | Type | Limit |
|---|---|---|
| `kind` | string | one of the eight above |
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
| `color` | string | 40 chars |
| `props`, `identifiers` | see [Identifiers and properties](/docs/api/metadata) | |
| `x`, `y` | number | rounded; omit for auto-placement |
| `w`, `h` | number | clamped to 40–4000; default 280 × 180 |
| `z` | number | stacking; higher is in front, fractional is fine |
| `rotation` | number | degrees, wrapped to −180…180 |
| `group_id` | string | a group from [`POST /boards/:id/groups`](/docs/api/arrange) |
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

`raw` exists because the card object above is a deliberately narrow projection,
and the app has kinds it does not describe — a grid carries its cells and
template, a palette its swatches, a schedule its rows. Those read back through
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

**Auto-placement.** Cards without `x`/`y` are placed in free space, so a batch
cannot land on top of existing content. Pass both to place one yourself.

### Laying cards out

Pass `layout` — `justified`, `masonry`, `grid`, `row` or `column` — to arrange
the whole batch as it lands instead of appending it in free space, and use
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
else is an ordinary partial patch.

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

Every removed card comes back in full, so the response is the undo.

## `PATCH /boards/:id/cards/:cardId`

A partial patch — only the fields you send change. No defaults are applied, so
patching `title` alone will not resize the card.

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
the full card comes back — `POST` it to the cards endpoint to restore it.

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
