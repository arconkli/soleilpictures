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
| `limit` / `offset` | Page size (default {{fact:defaultPage}}, max {{fact:maxPage}}) and start |

```sh
curl "$SOLEIL_API/boards?parent=root&limit=50" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

```json
{ "boards": [ … ], "limit": 50, "offset": 0, "has_more": true, "next_offset": 50 }
```

Follow `next_offset` until it comes back `null`.

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
