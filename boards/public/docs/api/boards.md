# Boards API

> Boards are what the app calls clusters. List them with GET /boards, filtered by workspace or parent and paginated, create with POST /boards, read one with GET /boards/:id, rename or reparent with PATCH, soft-delete with DELETE and put it back with POST to the restore endpoint. Reparenting is cycle-safe and refused rather than allowed to create a loop.

_Source: https://clusters.soleilpictures.com/docs/api/boards · Updated 2026-08-08_

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
| `limit` / `offset` | Page size (default 100, max 500) and start |

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
