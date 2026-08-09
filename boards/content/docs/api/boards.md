---
title: Boards API — Soleil Clusters
metaDescription: Create, list, read, rename, reparent, delete and restore Soleil Clusters boards over REST. Field reference, filters, pagination and cycle-safe reparenting.
h1: Boards API
navLabel: Boards
section: developers
order: 3
updated: 2026-08-08
answer: Boards are what the app calls clusters. List them with GET /boards, filtered by workspace or parent and paginated, create with POST /boards, read one with GET /boards/:id, rename or reparent with PATCH, soft-delete with DELETE and put it back with POST to the restore endpoint. Reparenting is cycle-safe and refused rather than allowed to create a loop.
faq:
  - q: What is the difference between a board and a cluster?
    a: Nothing. The interface says cluster, the API says board. Same object.
  - q: How do I create a board at the top level?
    a: Omit parent_board_id. Omit workspace_id too and it goes in your personal workspace, which is created if it does not exist.
  - q: Can I undo a delete?
    a: Yes. DELETE is a soft delete and POST /boards/:id/restore puts it back.
related:
  - /docs/api/cards
  - /docs/api/search
  - /docs/clusters
---

A board is what the interface calls a [cluster](/docs/concepts). Same object,
two words.

## The board object

```json
{
  "id": "9f1c…",
  "name": "Scene 4 — Diner",
  "workspace_id": "3b7e…",
  "parent_board_id": null,
  "view": "canvas",
  "created_at": "2026-08-01T09:12:44.000Z",
  "updated_at": "2026-08-03T14:02:10.000Z"
}
```

| Field | Notes |
|---|---|
| `id` | UUID |
| `name` | Up to 200 characters; trimmed |
| `workspace_id` | UUID |
| `parent_board_id` | UUID, or `null` at the top level |
| `view` | `"canvas"` or `"list"` |

## `GET /workspaces`

```json
{ "workspaces": [ { "id": "…", "name": "Personal", "created_at": "…" } ] }
```

## `GET /boards`

| Query | Effect |
|---|---|
| `workspace=<uuid>` | Only boards in that workspace |
| `parent=<uuid>` | Only children of that board |
| `parent=root` | Only top-level boards |
| `deleted=` | Include soft-deleted boards |
| `since=<ISO>` | Only boards changed at or after that time — see below |
| `cursor=` | Continue a `since` walk |
| `include=` | `props`, `identifiers` — see [Identifiers and properties](/docs/api/metadata) |
| `limit` / `offset` | Page size (default {{fact:defaultPage}}, max {{fact:maxPage}}) and start |

```sh
curl "$SOLEIL_API/boards?parent=root&limit=50" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

```json
{ "boards": [ … ], "limit": 50, "offset": 0, "has_more": true, "next_offset": 50 }
```

Follow `next_offset` until it comes back `null`.

### Asking what changed

Pass `since` and the listing becomes a **change feed**: ordered by `updated_at`
rather than `created_at`, and paged by cursor rather than offset.

```sh
curl "$SOLEIL_API/boards?workspace=$WS&since=2026-08-09T00:00:00Z" \
  -H "Authorization: Bearer $SOLEIL_TOKEN"
```

```json
{ "boards": [ … ], "limit": 100, "has_more": true,
  "next_cursor": "2026-08-09T12:00:00Z|3b7e…" }
```

Pass `next_cursor` back as `cursor` until `has_more` is false, then keep the
last `updated_at` you saw as the `since` for your next run.

Offset paging is wrong for this and cursor paging is right, for a specific
reason: rows are being written while you walk, so offsets shift under you and a
page boundary both skips and repeats. The cursor carries a board id alongside
the timestamp because two boards touched in the same transaction share a
timestamp exactly, and a timestamp alone would drop whichever came second.

## `GET /boards/tree`

The hierarchy in one call, rather than one call per level.

```sh
curl "$SOLEIL_API/boards/tree?root=$BOARD&depth=6" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

```json
{ "root": "3b7e…", "count": 214,
  "boards": [
    { "id": "3b7e…", "parent_board_id": null, "name": "THE FALL",
      "depth": 0, "card_count": 0, "updated_at": "…", "deleted": false },
    { "id": "9f1c…", "parent_board_id": "3b7e…", "name": "Costume",
      "depth": 1, "card_count": 42, "updated_at": "…", "deleted": false }
  ] }
```

Pass `root` (a board id) or `workspace`, and optionally `depth` (default 10,
maximum 20). Results are flat with a `depth` and a `parent_board_id`, so you can
rebuild the tree in whatever shape you need without the response nesting for
you.

A show's structure — title, department, sequence, shot — is the first thing any
integration walks, and `?parent=` costs a request per node.

## `POST /boards`

```json
{
  "name": "Scene 4 — Diner",
  "workspace_id": "optional uuid",
  "parent_board_id": "optional uuid",
  "view": "canvas"
}
```

Only `name` is required.

- No `workspace_id` → your personal workspace, created if needed.
- No `parent_board_id` → top level.
- `view` is `"canvas"` unless you pass exactly `"list"`.

Returns `201` with `{ "board": … }`.

### Creating many at once

Pass a `boards` array instead, up to {{fact:maxBoardsPerCall}} per call:

```json
{
  "workspace_id": "optional uuid — the default for every entry",
  "boards": [
    { "name": "Scene 4 — Diner", "parent_board_id": "…" },
    { "name": "Scene 5 — Motel",  "parent_board_id": "…" }
  ]
}
```

Returns `201` with `{ "boards": [ … ], "created": 2 }`.

This matters when you are importing an existing library, because a large one is
a **tree** — a board per scene, reel or shoot — so the first thing an import
does is create thousands of boards. One request each is the slowest possible way
to do that; this is two inserts however many you pass.

Every entry is validated before anything is written, so a bad entry at index 900
is a clean `400` rather than 900 boards and an error. The whole batch is one
insert as you, so a workspace you cannot write refuses the batch rather than
half-applying it.

### Creating the same boards twice

Give each board an `identifiers` array and pass `"on_conflict": "identifier"`,
and a board already carrying one of those identifiers is **updated instead of
created again** — with its id unchanged:

```json
{
  "on_conflict": "identifier",
  "boards": [
    { "name": "SEQ 0100",
      "identifiers": [{ "scope": "shotgrid", "value": "Sequence:88" }] }
  ]
}
```

The response adds `updated`, and each board carries `created: true|false`. This
is what makes an import re-runnable — see
[Identifiers and properties](/docs/api/metadata).

## `GET /boards/:id`

`{ "board": … }`, or `404` — which is also what you get for a board that exists
but is not yours. The API never confirms the existence of something you cannot
see.

## `PATCH /boards/:id`

Every field optional:

```json
{ "name": "Scene 4 — Diner (rev)", "view": "list", "parent_board_id": "…" }
```

Reparenting is **cycle-safe**: moving a board into one of its own descendants is
refused with `409 conflict`, not allowed to create a loop.
`parent_board_id: null` moves it to the top level.

## `DELETE /boards/:id`

A **soft delete**, requiring the `delete` scope. The board goes to the
[trash](/docs/clusters/trash-and-recovery) and stays restorable for 30 days.

```json
{ "deleted": true, "board": { … }, "restorable": true }
```

Descendants are deliberately not touched — deleting a parent does not cascade.

## `POST /boards/:id/restore`

Puts a soft-deleted board back. Find deleted boards with `GET /boards?deleted=`.

## Worked example

```sh
# A project with two scenes under it
PROJECT=$(curl -s -X POST "$SOLEIL_API/boards" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"name":"Feature — Act One"}' | jq -r .board.id)

for scene in "Scene 3 — Motel" "Scene 4 — Diner"; do
  curl -s -X POST "$SOLEIL_API/boards" \
    -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
    -H "Idempotency-Key: $(uuidgen)" \
    -d "{\"name\":\"$scene\",\"parent_board_id\":\"$PROJECT\"}"
done

curl -s "$SOLEIL_API/boards?parent=$PROJECT" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

Next: [Cards API](/docs/api/cards) · [Images](/docs/api/images) ·
[Search](/docs/api/search).
