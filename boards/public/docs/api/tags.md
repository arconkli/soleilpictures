# Tags API

> GET /workspaces/:id/tags lists a workspace's tags, each with how many things carry it, and GET /tags/:id lists everything carrying one tag, on every board. GET /boards/:id/tags shows the tags on one board, and POST /boards/:id/tags puts tags on its cards or takes them off, by name or by id, exactly as the Tag menu in the app does.

_Source: https://clusters.soleilpictures.com/docs/api/tags · Updated 2026-10-25_

A workspace's [tags](/docs/organize/tags) are read and applied here. Everything
runs as you, so the API does with a tag exactly what the app does.

## `GET /workspaces/:id/tags`

The workspace's tags, by name.

```json
{
  "workspace_id": "5b2e…",
  "tags": [
    { "id": "0c9a…", "name": "Diner", "color": null, "entity_type": "setting",
      "description": null, "items": 14, "created_at": "2026-09-30T18:02:11Z" }
  ],
  "limit": 100, "offset": 0, "has_more": false
}
```

`items` is how many things carry the tag, the number the sidebar shows (null
when it can't be counted just then). `color` is the one picked in the app, or
null for the colour it gives the tag from its name. `entity_type` is one of
`character`, `setting`, `organization`, `concept` (Topic, in the app) and
`thing`, or null.

| Parameter | |
|---|---|
| `name` | Just the tag of that name, in any case |
| `limit` | Tags per page: 100 by default, at most 500 |
| `offset` | Where the page starts |

## `GET /tags/:id`

Everything carrying a tag, on every board in its workspace, the most recently
tagged first: the tag's page, as data.

```json
{
  "tag": { "id": "0c9a…", "name": "Diner", "workspace_id": "5b2e…", "…": "…" },
  "items": [
    { "kind": "card", "card_kind": "image", "board_id": "9f1c…", "board_name": "Locations",
      "card_id": "c-3", "title": "Booth, night", "excerpt": null,
      "auto": false, "tagged_at": "2026-10-20T09:14:02Z", "url": "https://…" },
    { "kind": "doc_page", "board_id": "9f1c…", "card_id": "d-4", "page_id": "p-2",
      "title": "Opening", "excerpt": "INT. DINER — NIGHT…", "auto": true, "…": "…" }
  ],
  "has_more": false
}
```

Each item's `kind` is `card`, `group` (with `group_id` and `cards`, how many
cards it holds), `board` (a whole cluster), or `doc_page` (a page of a doc,
with `card_id` and `page_id`). `auto` marks what was tagged automatically
rather than by a person, and `url` opens it in the app. `limit` takes
100 by default, at most 500.

## `GET /boards/:id/tags`

The tags on one board, and what carries each.

```json
{
  "board_id": "9f1c…",
  "tags": [
    { "id": "0c9a…", "name": "Diner", "…": "…", "on_board": false,
      "cards": ["c-3", "c-7"], "groups": [], "pages": [{ "card_id": "d-4", "page_id": "p-2" }] }
  ],
  "url": "https://…"
}
```

`on_board` is true when the board itself carries the tag, and each list is in
the order things were tagged. A card deleted from the board keeps its tags in
case the delete is undone, and isn't listed; when the board can't be read just
then, a `note` says deleted cards may be.

## `POST /boards/:id/tags`

Puts tags on cards of this board and takes tags off them.

```json
{ "card_ids": ["c-3", "c-7"], "add": ["Diner", "night exterior"], "remove": ["0c9a…"] }
```

| Field | |
|---|---|
| `card_ids` | Required. Up to 200 cards on this board |
| `add` | Tags to put on them, up to 10: names, or ids from the lists above |
| `remove` | Tags to take off them, up to 10, the same way |

Send `add`, `remove`, or both. A name is matched in any case, and a leading `#`
is ignored. Each works as the **Tag…** menu does:

- **A name the workspace has no tag for** makes the tag, up to
  80 characters. As a tag made in the app does, it then also
  goes on whatever else in the workspace says its name, marked auto.
- **A deleted tag's name** brings that tag back with everything it was on, as
  recreating it in the app does.
- **Taking a tag off a card** keeps it off that card for good: automatic
  tagging never puts it back there. Putting it on again yourself lifts that.

```json
{
  "board_id": "9f1c…",
  "added": [
    { "id": "0c9a…", "name": "Diner", "…": "…", "created": false, "card_ids": ["c-7"] },
    { "id": "77d1…", "name": "night exterior", "…": "…", "created": true, "card_ids": ["c-3", "c-7"] }
  ],
  "removed": [{ "id": "3f2b…", "name": "Day", "…": "…", "card_ids": ["c-3"] }],
  "not_found": { "card_ids": [], "tags": [] },
  "url": "https://…"
}
```

Each tag's `card_ids` are the cards that changed: one that already had the tag,
or never had the one taken off, isn't listed, so sending the same call twice
changes nothing the second time. `created` marks a new tag and `revived: true`
one brought back. An id that isn't a tag of this workspace, or a tag to take off
that it doesn't have, is listed in `not_found.tags`, and a card that isn't on
the board in `not_found.card_ids`.

## Who can do what

Tags belong to a workspace. Its members read them; anyone who can edit the
workspace tags things in it, and anyone else gets `403`. Someone a board is
shared with sees no tags. A board you can't open, or none of the cards on it,
answers `404`. Tagging reads the board to find its cards: when it can't be
read just then, nothing is written and the answer is `503` `room_unavailable`,
so try again.
