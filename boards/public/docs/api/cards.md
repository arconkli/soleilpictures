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

## `POST /boards/:id/cards`

Either shape works:

```json
{ "cards": [ { "kind": "note", "title": "Tone" } ] }
```

```json
{ "kind": "note", "title": "Tone" }
```

Up to **100** cards per call; more gets `400`.

**Auto-placement.** Cards without `x`/`y` are placed in free space, so a batch
cannot land on top of existing content. Pass both to place one yourself.

**`live`.** `true` means open canvases received the change immediately. `false`
means it is saved but a canvas someone already has open needs a reload. Never
treat `false` as failure.

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
