---
title: Boards API — Soleil Clusters
metaDescription: Create, list, read, rename, reparent, delete and restore Soleil Clusters boards over REST. Field reference, filters, pagination and cycle-safe reparenting.
h1: Boards API
navLabel: Boards
section: developers
order: 3
updated: 2026-10-25
answer: Boards are what the app calls clusters. List them with GET /boards, filtered by workspace or parent and paginated, create with POST /boards, read one with GET /boards/:id, rename or reparent with PATCH, soft-delete with DELETE and put it back with POST to the restore endpoint. Reparenting is cycle-safe and refused rather than allowed to create a loop.
faq:
  - q: What is the difference between a board and a cluster?
    a: Nothing. The interface says cluster, the API says board. Same object.
  - q: How do I create a board at the top level?
    a: Omit parent_board_id. Omit workspace_id too and it goes in your personal workspace, which is created if it does not exist.
  - q: Can I undo a delete?
    a: Usually. DELETE is a soft delete and POST /boards/:id/restore puts it back, within the 30-day trash window. One case is refused: a deleted cluster stops counting against the card limit, so if the free space has been used since, restoring would take the account over its cap and the call answers 402 limit_reached saying by how much.
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

A board no longer takes a date. `scheduled_date`, `scheduled_end` and
`day_label` went when schedules were retired, and a `POST` or `PATCH` that sets
one is refused with `400 bad_request` rather than accepted and dropped.

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
| `deleted=1` | Only soft-deleted boards (the Trash), instead of live ones |
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

Each board carries the `url` that opens it in the app, or `null` for a deleted
board, which no link opens until it is restored. Follow `next_offset` until it
comes back `null`.

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
last `updated_at` you saw as the `since` for your next run. A cursor is safe to
put in a URL exactly as it arrives — its time is written in UTC with a `Z`, so
there is no `+` for a query string to turn into a space.

**The feed includes deletions.** Deleting a cluster bumps its `updated_at`, so a
board someone moved to the Trash comes through with `"deleted": true` — drop it
on your side. Restoring it brings it through again with `"deleted": false`. A
board purged from the Trash after 30 days is not reported; by then it has
already been in the feed as deleted.

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
      "depth": 0, "card_count": 0, "updated_at": "…", "deleted": false, "url": "https://…" },
    { "id": "9f1c…", "parent_board_id": "3b7e…", "name": "Costume",
      "depth": 1, "card_count": 42, "updated_at": "…", "deleted": false, "url": "https://…" }
  ] }
```

Pass `root` (a board id) or `workspace`, and optionally `depth` (default 10,
maximum 20). Results are flat with a `depth` and a `parent_board_id`, so you can
rebuild the tree in whatever shape you need without the response nesting for
you. Each board's `url` opens it in the app.

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

Returns `201` with `{ "board": …, "url": … }`, where `url` opens the new board in the app.

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

Returns `201` with `{ "boards": [ … ], "created": 2 }`, each board with the `url` that opens it.

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

An update changes `name` and `view`. A matched board stays where it is unless
the entry names a `parent_board_id`, in which case it is moved there the same
way `POST /boards/move` moves it (`409` if that move is refused). A matched
board in the Trash is renamed but not moved, and comes back with
`"deleted": true`; restoring it in the app puts it back in place. A matched
board you cannot edit is a `403`, and the boards the batch created keep their
identifiers, so running it again finds them instead of creating them twice.

## `GET /boards/:id`

`{ "board": …, "capacity": …, "url": … }`, where `url` opens the board in the
app — or `404`, which is also what you get for a board that exists but is not
yours. The API never confirms the existence of something you cannot see.

## `GET /boards/:id/canvas`

The board as it is drawn: where every card sits and how big it is, what each
one shows at a glance, the groups round them, and for each picture an address
that works without signing in for {{fact:signedImageLife}}. It is what the MCP
server's `show_board` hands the [inline view](/docs/mcp) that draws a board in a
chat, and it serves anything else that draws a board somewhere other than
Clusters.

```sh
curl "https://clusters.soleilpictures.com/api/v1/boards/$BOARD/canvas" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "board": { "id": "…", "name": "Tokyo noir, 1974", "url": "https://clusters.soleilpictures.com/?to=b:…",
             "card_count": 33 },
  "bounds": { "x": 0, "y": 0, "w": 2400, "h": 1160 },
  "cards": [
    { "id": "c-81", "kind": "image", "x": 0, "y": 0, "w": 240, "h": 160, "z": 1, "group_id": "g1",
      "title": "Streets 1",
      "picture": { "url": "https://clusters.soleilpictures.com/api/img/…", "width": 640, "height": 427,
                   "tone": "#1d2b44" } },
    { "id": "n1", "kind": "note", "x": 1240, "y": 640, "w": 260, "h": 100,
      "text": "Sodium vapour, never daylight.", "color": "#fff3c4" },
    { "id": "p1", "kind": "palette", "x": 820, "y": 640, "w": 360, "h": 120,
      "swatches": [{ "hex": "#e8a33d", "name": "Sodium" }] }
  ],
  "groups": [{ "id": "g1", "x": 0, "y": 0, "w": 760, "h": 540, "name": "Streets" }],
  "picture_count": 26,
  "hidden": 0,
  "expires_at": "2026-10-27T13:00:00.000Z"
}
```

Cards come in the order they stack, each with its box in board units and what
reads at a glance: a title, the start of its text (up to
{{fact:canvasTextMax}} characters), a note's colours, a palette's swatches, a
link's domain. Colours are plain hex. A cluster's card carries its name and its
thumbnail.

A picture is an image, a video's poster frame, a link's preview or a cluster's
thumbnail, at its smaller rendition (the original only when it is small), and
`tone` is its average colour, to draw before it arrives. Only pictures your own
read of the board can see get an address, at most {{fact:canvasMaxPictures}};
the rest are drawn in their tone. An address works for anyone who has it until
`expires_at`, so a picture deleted meanwhile stays reachable until then; ask
again for fresh ones.

The first {{fact:canvasMaxCards}} cards in reading order are drawn, and
`hidden` counts the rest.

## `PATCH /boards/:id`

Every field optional:

```json
{ "name": "Scene 4 — Diner (rev)", "view": "list", "parent_board_id": "…" }
```

Reparenting is **cycle-safe**: moving a board into one of its own descendants is
refused with `409 conflict`, not allowed to create a loop.
`parent_board_id: null` moves it to the top level.

Renaming needs edit rights on the workspace. A board you can see but not edit —
as a viewer, or through a share of that one board — answers `403 forbidden`
rather than `200` with the name unchanged.

## `DELETE /boards/:id`

A **soft delete**, requiring the `delete` scope. The board goes to the
[trash](/docs/clusters/trash-and-recovery) and stays restorable for 30 days.

```json
{ "deleted": true, "board": { … }, "restorable": true }
```

Deleting a board takes the boards inside it to the trash with it, as one batch,
so nothing is left orphaned under a trashed parent. `POST /boards/:id/restore`
brings the whole batch back, nested as it was. Restoring a board whose parent is
still in the trash puts it under its nearest ancestor that isn't, or at the top
level.

## `POST /boards/move` — restructure in one call

```json
{ "board_ids": ["3b7e…", "9f1c…"], "parent_board_id": "a2c4…" }
```

Pass `"parent_board_id": null` to move boards to the top level. Up to
{{fact:maxBoardsPerCall}} at a time.

Reparenting always goes through the app's own move path — the only thing that
checks for cycles, because a board made its own ancestor detaches that whole
subtree from every view there is. Anything it refuses comes back in `skipped`
with a named reason (`cycle`, `cross-workspace`, `no-write`, `same-parent`,
`missing`, `self`) rather than as one opaque failure for the batch.

## `DELETE /boards` — many at once

```json
{ "board_ids": ["3b7e…", "9f1c…"] }
```

Soft, and restorable one at a time, exactly like the single delete. Sent as a
JSON body on `DELETE` so a destructive call stays a `DELETE`.

## `POST /boards/:id/restore`

Puts a soft-deleted board back, and answers with
`{ "restored": true, "board": …, "url": … }`, where `url` opens it in the app.
Find deleted boards with `GET /boards?deleted=1`.

Restoring a board that is already live is a no-op, so a retry is safe.

**This call can be refused.** A deleted cluster stops counting against the card
limit the moment it is deleted, so the room it held is immediately usable. The
other side of that is that a restore has to fit: if the space has been used
since, putting the cluster back would take the account over its limit, and the
call answers `402 limit_reached` with a message naming the number it would
reach. Free some room or upgrade, then retry. Nothing is lost in the meantime —
the 30-day trash window is the only clock running.

## Sharing by link — `/boards/:id/share-link`

A board's [view-only link](/docs/collaborate/sharing): anyone with it opens the
board without signing in, and nobody can change anything through it.

```sh
curl -X POST "$SOLEIL_API/boards/$BOARD/share-link" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" -d '{}'
```

```json
{
  "board_id": "…",
  "created": true,
  "link": { "url": "https://clusters.soleilpictures.com/share/…", "include_subboards": false,
            "expires_at": null, "created_at": "…", "created_by_you": true }
}
```

| Call | Does |
|---|---|
| `POST` | Returns a live view link the board already has, `200` and `"created": false`; makes one only when none fits, `201`. With `include_subboards`, only a link of that kind fits. A link made here shows just this board unless `include_subboards` is `true` |
| `GET` | The board's live view links, newest first |
| `DELETE` | Revokes every live view link you may revoke. `still_shared` counts the links someone else made, which stay live until they or an owner of the workspace revoke them |

Asking twice never makes a second link, so a retry is safe. Invite links, which
grant editing once someone signs in, are never returned or revoked here. Only
someone who may manage the board's links (an owner, a co-owner or an editor)
gets an answer; anyone else gets `403`. `DELETE` here needs only the `write`
scope: taking a link back undoes a write and destroys nothing anyone made.

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
