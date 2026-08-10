---
title: Arranging a Board — Soleil Clusters API
metaDescription: Lay cards out automatically — justified rows, colour-ordered masonry or a uniform grid — or place them by hand with z-order, rotation and groups.
h1: Arrange
navLabel: Arrange
section: developers
order: 7
updated: 2026-08-10
answer: POST /boards/:id/arrange lays out cards that already exist, and any card write accepts a layout to arrange what it adds. The default, justified, fits rows flush on both edges at each picture's true aspect ratio. For placing things yourself, cards carry x, y, w, h, z, rotation, a group_id, and a section_header flag.
faq:
  - q: How do I make a dump of images look like a moodboard?
    a: Pass layout when you import or add them, or call POST /boards/:id/arrange afterwards. The default, justified, gives rows of equal height flush on both edges, with every picture at its real aspect ratio.
  - q: Can I see where things would land before moving anything?
    a: Yes. Pass dry_run and the response contains the computed positions with nothing written, so you can compare two layouts before touching a board.
  - q: Will arranging move my cards somewhere else on the canvas?
    a: No. The block is re-anchored on its own current top-left, and pushed clear of any cards it is not moving, so tidying part of a board cannot bury the rest.
  - q: How do I say that a set of cards belongs together?
    a: Create a group with POST /boards/:id/groups and pass its id as group_id on each card. A group draws a labelled outline round its cards and moves them as one.
related:
  - /docs/api/cards
  - /docs/api/import
  - /docs/canvas/cards
---

Placing cards is half of an API that works. The other half is that what lands
looks composed rather than spilled.

## Automatic

```sh
curl -X POST {{fact:siteOrigin}}/api/v1/boards/$BOARD/arrange \
  -H "Authorization: Bearer {{fact:tokenPrefix}}…" \
  -H "Content-Type: application/json" \
  -d '{ "layout": "justified" }'
```

Omit `card_ids` to arrange the whole board, or pass a subset to tidy part of it.
The same `layout` works on [adding cards](/docs/api/cards) and on
[import](/docs/api/import), so a batch can land arranged instead of needing a
second call.

### The layouts

{{fact:layoutAlgorithms}}

**`justified`** — the default. Rows of equal height, each picture at its true
aspect ratio, flush on **both** edges. There are no holes in it, which is why it
is the right answer for photographs.

```
┌────────┐┌───┐┌─────────┐
│        ││   ││         │
└────────┘└───┘└─────────┘
┌─────┐┌──────────┐┌─────┐
│     ││          ││     │
└─────┘└──────────┘└─────┘
```

**`masonry`** — columns of equal width, balanced by height, ordered by colour so
the board reads as a deliberate palette sweep rather than as arrival order.
Leaves a ragged bottom edge, which is the trade for never cropping anything.

**`grid`** — one uniform cell for everything, each card centred in its cell. The
right answer for *mixed kinds* — an image beside a PDF beside an audio clip —
where a shared cell reads as a clean matrix. For photographs of different shapes
it leaves a hole around every portrait, which is what `justified` fixes.

**`row`** and **`column`** — a single line, cross-axis centred.

### Knobs

| Field | Meaning |
|---|---|
| `gap` | Space between cards. Default 24. |
| `width` | The width the block is solved against. Omit it and a roughly square block is chosen from the number of items — a canvas has no edges, so there is no container to infer one from. |
| `row_height` | Target row height. `justified` only. |
| `columns` | Column cap. `grid` and `masonry` only. |
| `dry_run` | Compute everything, write nothing. |
| `card_ids` | Arrange a subset. At most {{fact:maxCardsPerArrange}} per call. |

Two things worth knowing. `justified` **resizes** cards — fitting a row to a
width is a resize, and it is the only layout that does. And a named layout
arranges the *whole* batch including cards that carried their own `x` and `y`:
"lay these out as rows" and "put this one at x=40" are contradictory, and the
one you asked for by name wins.

## By hand

Every card carries the full geometry:

| Field | Meaning |
|---|---|
| `x`, `y` | Position, in canvas units |
| `w`, `h` | Size |
| `z` | Stacking. Higher is in front; fractional values are fine |
| `rotation` | Degrees |
| `group_id` | Membership of a group |
| `section_header` | Render as a full-width heading |

`z` was readable but not writable until now — you could see which of two
overlapping cards was on top and had no way to swap them.

### Groups

A group is how a board says *these belong together*: a labelled outline round a
set of cards, which then move as one.

```sh
curl -X POST {{fact:siteOrigin}}/api/v1/boards/$BOARD/groups \
  -H "Authorization: Bearer {{fact:tokenPrefix}}…" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Costume — Act II", "shape": "box" }'
```

The full set:

| Endpoint | What it does |
|---|---|
| `GET /boards/:id/groups` | The groups on a board |
| `POST /boards/:id/groups` | Create one |
| `PATCH /boards/:id/groups/:groupId` | Rename or restyle it |
| `DELETE /boards/:id/groups/:groupId` | Ungroup — removes the group, never its cards |

Pass the returned `id` as `group_id` on any card. `shape` is `box` (one
rectangle round everything) or `hug` (following each card). Deleting a group
**ungroups**; it never deletes the cards — there is no undo on an HTTP call, and
a group holding forty cards must not be a way to lose forty cards.

### Section headings

A card with `section_header: true` becomes a full-width heading, and if the
board is [published](/docs/publish/explore) it renders as an `<h2>` in the article. Add
`sub` for a line underneath. This is what turns a wall of references into
something with a shape somebody else can read.
