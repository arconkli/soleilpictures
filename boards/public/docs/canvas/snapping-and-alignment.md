# Snapping and alignment

> As you drag a card, guides appear showing where it lines up with the cards around it, and it snaps to their edges, centres and spacing. Hold Alt while dragging to switch snapping off for that drag. Nothing needs enabling — the guides only appear while you are actually moving something.

_Source: https://clusters.soleilpictures.com/docs/canvas/snapping-and-alignment · Updated 2026-08-10_

Boards look better when things line up, and lining things up by hand is tedious.
Guides do it while you drag.

## What happens as you drag

Move a card and thin guide lines appear showing where it aligns with its
neighbours:

- **Edges** — left, right, top, bottom
- **Centres** — horizontal and vertical
- **Equal spacing** — when three or more cards are evenly distributed, the calipers show it

The card snaps to those positions as you approach them. Release and it lands
exactly aligned.

## Turning it off for one drag

Hold `Alt` while dragging. Snapping is suppressed for that drag only.

This is deliberately momentary rather than a persistent setting: the case for
disabling snapping is almost always "just this one card, just now", and a
setting you have to remember to turn back on is a setting that stays wrong.

## Aligning a selection

Select several cards and right-click. Under **Arrange** you get:

**Align** — Left, Center, Right, Top, Middle, Bottom. Every selected card moves
to that edge of the selection's own bounding box. Nothing is resized.

**Distribute** — Horizontally or Vertically. The two outermost cards stay put
and the ones between them are spread so the **gaps** are equal. Equal gaps
rather than equal centres, because with cards of different sizes equal centres
still looks uneven, which is the thing you were trying to fix. Needs at least
three cards — two have no gap between them to even out.

## Tidying up

**Arrange → Tidy up** repacks cards rather than nudging them:

| | |
|---|---|
| **Justified rows** | Rows of equal height with every picture at its true shape, flush on both edges. The best answer for photographs — there are no holes in it. |
| **Masonry columns** | Even columns, ordered by colour, so the board reads as a deliberate sweep rather than as the order things arrived. |
| **Grid** | One uniform cell for everything. Best when the cards are different *kinds* — an image beside a PDF beside an audio clip. |
| **Single row** / **Single column** | One line. |

With cards selected it tidies those; with nothing selected it tidies the whole
board. Either way the block stays where it already was and keeps clear of
anything it is not moving, so tidying part of a board cannot bury the rest. It
is one undo step.

Justified rows is the only one that resizes cards — fitting a row to a width is
a resize. The rest only move things.

The same layouts are available over the [API](/docs/api/arrange), so an
assistant can tidy a board too.

## Dropping a lot of files at once

Drop a folder of images onto the canvas and they arrive as a block centred on
where you dropped, laid out as justified rows, rather than in a line running off
the side of the screen.

## On a crowded board

Guides are culled to cards actually near the one you are moving. Without that,
a board with hundreds of cards would produce a screen full of lines and no
useful signal.

## Where snapping does not apply

- **[Free-draw](/docs/canvas/shapes-and-drawing) strokes** — freehand marks are freehand.
- **Inside a [grid](/docs/canvas/grids)** — cells are defined by dividers, and dragging a divider resizes rather than snapping.
- **[Schedule](/docs/canvas/schedule) slots** — a slot is a date, and dropping into it is exact by definition.
