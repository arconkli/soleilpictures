---
title: Search API — Soleil Clusters
metaDescription: Search Soleil Clusters boards and cards by text over REST. Query parameters, kind and workspace filters, pagination and result shape.
h1: Search API
navLabel: Search
section: developers
order: 9
updated: 2026-08-08
answer: GET /search finds boards and cards by text across everything your account can see. Pass q with at least two characters, optionally narrow to boards or cards with kind, scope to one workspace, and paginate with limit and offset. Results respect your permissions, so nothing you cannot open appears.
faq:
  - q: What does search look at?
    a: Board names, and card titles and text. It is the programmatic equivalent of the Cmd-K palette in the app.
  - q: Why does a one-character query fail?
    a: A single character matches most of a workspace and costs a full scan to say so. The minimum is two characters, and shorter queries get 400.
  - q: Can I search someone else's boards?
    a: Only ones shared with you. Search runs under your permissions like every other call.
related:
  - /docs/api
  - /docs/api/boards
  - /docs/organize/search
---

The programmatic equivalent of [`⌘K`](/docs/organize/search).

## `GET /search`

| Parameter | Meaning |
|---|---|
| `q` | The query. **Minimum two characters** — shorter gets `400`. |
| `kind` | `board` or `card`. Omit for both. |
| `workspace` | UUID, to scope to one workspace |
| `limit` | Page size, default {{fact:defaultPage}}, max {{fact:maxPage}} |
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
