# Search API

> GET /search finds boards and cards by text across everything your account can see. Pass q with at least two characters, optionally narrow to boards or cards with kind, scope to one workspace, and paginate with limit and offset. Results respect your permissions, so nothing you cannot open appears.

_Source: https://clusters.soleilpictures.com/docs/api/search · Updated 2026-08-08_

The programmatic equivalent of [`⌘K`](/docs/organize/search).

## `GET /search`

| Parameter | Meaning |
|---|---|
| `q` | The query. **Minimum two characters** — shorter gets `400`. |
| `kind` | `board` or `card`. Omit for both. |
| `workspace` | UUID, to scope to one workspace |
| `limit` | Page size, default 100, max 500 |
| `offset` | Where to start |

```sh
curl -s "$SOLEIL_API/search?q=diner&kind=card&limit=20" \
  -H "Authorization: Bearer $SOLEIL_TOKEN"
```

## Results

Boards and cards come back in separate lists, each carrying enough to act on
without a second lookup — a card result includes its `board_id`, so you can
`PATCH` it straight away.

Everything runs **under your permissions**. Boards you cannot open do not
appear, and there is no mode that searches beyond what your account can see.

## Notes for agents

- **Two characters minimum.** A one-character query is rejected rather than scanning a workspace to return everything.
- **Narrow with `kind`** when you know what you are after; it halves the work.
- **Paginate.** The result set is capped per page like every list endpoint — follow `next_offset` rather than assuming one page is everything.
- **Search then act.** The usual loop is `GET /search` to find a card, then [`PATCH /boards/:id/cards/:cardId`](/docs/api/cards) to change it.
