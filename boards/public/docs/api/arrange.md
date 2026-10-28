# Arrange

> POST /boards/:id/arrange lays out cards that already exist and is how to tidy a board. The default, auto, lays each section out as its own block, notes in columns at their own size and pictures in rows at their true shape, sets the sections out near a screen's shape, and brings notes the API made earlier up to date. justified, masonry, grid, row and column are there by name; by hand, cards carry x, y, w, h, z, rotation and a group.

_Source: https://clusters.soleilpictures.com/docs/api/arrange · Updated 2026-10-27_

Placing cards is half of an API that works. The other half is that what lands
looks composed rather than spilled.

## Automatic

```sh
curl -X POST https://clusters.soleilpictures.com/api/v1/boards/$BOARD/arrange \
  -H "Authorization: Bearer undefined…" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Omit `card_ids` to arrange the whole board, or pass a subset to tidy part of it.
Cards that aren't on the board (`"unplaced": true`) are left alone and take no
room in the layout.
The same `layout` works on [adding cards](/docs/api/cards) and on
[import](/docs/api/import), so a batch can land arranged instead of needing a
second call.

### The layouts

`auto` · `column` · `grid` · `justified` · `masonry` · `row`

**`auto`** — the default. A board reads as its sections
([groups](/docs/canvas/groups)), so each is laid out as a block of its own:
pictures (images and videos) in rows across the block, flush on both edges and
each at its true shape, under the section's palette if it has one; anything
else in columns, each card at its own size, a picture at the column's width and
a palette or a wide card across the top. The blocks are then set out in rows,
in order, at the width that brings the whole board nearest 16:10
with its rows about as wide as each other. Cards in no section make one block
more.

```
┌ CANON ──────────┐  ┌ JOURNAL ─────────────────┐
│ ┌─────┐ ┌─────┐ │  │ ┌─────┐ ┌─────┐ ┌─────┐  │
│ │     │ │     │ │  │ │     │ │     │ │     │  │
│ └─────┘ │     │ │  │ └─────┘ └─────┘ └─────┘  │
│ ┌─────┐ └─────┘ │  └──────────────────────────┘
│ └─────┘         │
└─────────────────┘
```

Cards are taken in reading order — top to bottom, each row left to right —
unless `order` names the ones that come first, and a column fills in that same
order, so arranging a board `auto` arranged moves nothing.

**Notes brought up to date.** Any arrange brings a note the API made before
notes showed their `title` and `color` up to date: its title becomes its
heading, its colour its fill, and its height its text's (see
[Notes](/docs/api/cards#notes)). Only a note nobody has opened or resized in
the app is touched, and one edited while the arrange runs keeps what was
written there and is only moved. `repaired` counts them.

**`justified`** — rows of equal height, each picture at its true aspect ratio,
flush on **both** edges. There are no holes in it, which is why it is the right
answer for photographs.

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

**Groups stay together.** With every layout, cards in a
[group](/docs/canvas/groups) are laid out a group at a time, each group as its
own block with room for its outline and name; with the named ones the blocks
are set out side by side (in one line for `row` and `column`). Cards in no group
make one block more. Arranging a board that is already arranged moves nothing:
`auto` and `justified` size each image from its own pixels, so a picture shows
whole rather than cropped to the card it was given, and comes out the same size
the next time.

### Knobs

| Field | Meaning |
|---|---|
| `order` | Card ids to put first, in this order; the rest follow in reading order. |
| `gap` | Space between cards. Default 24. |
| `width` | The width the block is solved against, not `auto`. Omit it and a roughly square block is chosen from the number of items — a canvas has no edges, so there is no container to infer one from. |
| `row_height` | Target row height. `justified` only. |
| `columns` | Column cap. `grid` and `masonry` only. |
| `dry_run` | Compute everything, write nothing. |
| `card_ids` | Arrange a subset. At most 1000 per call. |

`auto` chooses its own widths, so it takes only `order` and `gap`.

The answer:

| Field | Meaning |
|---|---|
| `layout` | The layout used |
| `arranged` | How many cards were laid out |
| `repaired` | Notes the API made earlier, brought up to date |
| `sections` | How many sections the cards laid out are in |
| `bounds` | `x`, `y`, `w` and `h` of the cards laid out |
| `not_found` | Ids in `card_ids` that aren't on the board |
| `cards` | Those cards, as they now are |

Two things worth knowing. `auto` and `justified` **resize** pictures — fitting
a row to a width is a resize — and `auto` stretches a palette to its section's
width; the other layouts only move cards. And a layout named on a
[card write](/docs/api/cards) arranges the *whole* batch including cards that
carried their own `x` and `y`: "lay these out as rows" and "put this one at
x=40" are contradictory, and the one you asked for by name wins.

## By hand

Every card carries the full geometry:

| Field | Meaning |
|---|---|
| `x`, `y` | Position, in canvas units |
| `w`, `h` | Size |
| `z` | Stacking. Higher is in front; fractional values are fine |
| `rotation` | Degrees |
| `group` | Membership of a group, by its name — made if the board has none |
| `group_id` | Membership of a group, by its id |
| `section_header` | Render as a full-width heading |

`z` was readable but not writable until now — you could see which of two
overlapping cards was on top and had no way to swap them.

### Groups

A group is how a board says *these belong together*: a labelled outline round a
set of cards, which then move as one.

```sh
curl -X POST https://clusters.soleilpictures.com/api/v1/boards/$BOARD/groups \
  -H "Authorization: Bearer undefined…" \
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

Pass the returned `id` as `group_id` on any card — or skip this step, and name
the group in a card's `group`: the board's group of that name is used, or made
with the cards (see [Sections](/docs/api/cards#sections)). `shape` is `box` (one
rectangle round everything) or `hug` (following each card). Deleting a group
**ungroups**; it never deletes the cards — there is no undo on an HTTP call, and
a group holding forty cards must not be a way to lose forty cards.

### Section headings

A card with `section_header: true` becomes a full-width heading, and if the
board is [published](/docs/publish/explore) it renders as an `<h2>` in the article. Add
`sub` for a line underneath. This is what turns a wall of references into
something with a shape somebody else can read.
