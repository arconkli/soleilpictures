# Cards API

> Read a board's cards with GET /boards/:id/cards, add up to 100 at a time with POST, change one with PATCH, move a set with the move endpoint, and remove one with DELETE — which returns the whole card it deleted, so the response body is your undo. Four card kinds are accepted and an unknown kind is rejected rather than silently coerced.

_Source: https://clusters.soleilpictures.com/docs/api/cards · Updated 2026-08-08_

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

The API accepts `doc`, `image`, `link`, `note`.

An unrecognised `kind` gets a `400` naming the valid ones. It is **not**
coerced — silently turning an unknown kind into a note produced boards full of
notes that were meant to be links.

This is narrower than [what the canvas supports](/docs/canvas/cards). Grids,
schedules, palettes and shapes are created in the app.

## Writable fields

| Field | Type | Limit |
|---|---|---|
| `kind` | string | one of the four above |
| `title` | string | 300 chars |
| `body` | string | 20000 chars |
| `html` | string | 40000 chars |
| `url` | string | 2000 chars |
| `image_key` | string | 500 chars — from [`POST /uploads`](/docs/api/images) |
| `alt` | string | 300 chars — image description |
| `color` | string | 40 chars |
| `x`, `y` | number | rounded; omit for auto-placement |
| `w`, `h` | number | clamped to 40–4000; default 280 × 180 |

Anything else in the payload is ignored. A client-supplied `id` is ignored — the
server generates one.

## `GET /boards/:id/cards`

Paginated with `limit` and `offset` — default 100, maximum
500.

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

Up to **1000** cards per call; more gets `400`.

**Auto-placement.** Cards without `x`/`y` are placed in free space, so a batch
cannot land on top of existing content. Pass both to place one yourself.

### Pass coordinates when you are importing

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
**100** on the free plan, counted against the **board
owner**. Exceeding it returns `402 limit_reached`, not `403`. See
[Errors](/docs/api/errors).
