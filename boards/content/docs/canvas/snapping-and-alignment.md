---
title: Snapping and Alignment Guides — Soleil Clusters
metaDescription: Alignment guides and snapping on the Soleil Clusters canvas. Cards snap to each other's edges and centres as you drag; hold Alt to bypass.
h1: Snapping and alignment
navLabel: Snapping and alignment
section: canvas
order: 11
updated: 2026-08-08
answer: As you drag a card, guides appear showing where it lines up with the cards around it, and it snaps to their edges, centres and spacing. Hold Alt while dragging to switch snapping off for that drag. Nothing needs enabling — the guides only appear while you are actually moving something.
faq:
  - q: How do I place something deliberately off-grid?
    a: Hold Alt while dragging. Snapping is suppressed for that drag only, so you do not have to remember to switch it back on.
  - q: Does snapping work with many cards on screen?
    a: Yes. Candidate guides are culled to what is actually near the card you are moving, so a board with hundreds of cards does not turn into a screen full of lines.
  - q: Can I align a selection all at once?
    a: Yes. Select several cards and use the alignment options in the right-click menu.
related:
  - /docs/canvas
  - /docs/canvas/cards
  - /docs/canvas/groups
---

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

Select several cards and use the alignment options in the right-click menu to
align or distribute them all at once, rather than dragging each one into place.

## On a crowded board

Guides are culled to cards actually near the one you are moving. Without that,
a board with hundreds of cards would produce a screen full of lines and no
useful signal.

## Where snapping does not apply

- **[Free-draw](/docs/canvas/shapes-and-drawing) strokes** — freehand marks are freehand.
- **Inside a [grid](/docs/canvas/grids)** — cells are defined by dividers, and dragging a divider resizes rather than snapping.
- **[Schedule](/docs/canvas/schedule) slots** — a slot is a date, and dropping into it is exact by definition.
