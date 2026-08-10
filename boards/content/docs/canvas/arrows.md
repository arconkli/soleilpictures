---
title: Arrows and Connections — Soleil Clusters
metaDescription: Connect cards with arrows in Soleil Clusters. Arrows anchor to cards, re-route as you move things, and carry labels, colours, thickness and head styles.
h1: Arrows
navLabel: Arrows
section: canvas
order: 5
updated: 2026-08-08
answer: Press A and drag from one card to another to connect them. Arrows anchor to the cards rather than to fixed points, so they re-route automatically when you move things. Each arrow carries its own colour, thickness, head style, dashed or solid line, curve style and an optional label.
faq:
  - q: Do arrows stay attached when I move a card?
    a: Yes. An arrow anchors to the card, not to a coordinate. Move either end and the arrow re-routes, picking the sides that give the cleanest path.
  - q: Can I draw an arrow that is not attached to anything?
    a: Yes. Drag from empty canvas to empty canvas for a free-floating arrow. It behaves like a shape.
  - q: Why do several arrows between the same two cards fan out?
    a: So they stay individually visible instead of overlapping into one thick line. The spread is automatic.
related:
  - /docs/canvas/shapes-and-drawing
  - /docs/canvas/groups
  - /docs/canvas
---

Arrows are for showing relationships: this shot follows that one, this reference
informed that frame, this note explains that image.

## Drawing one

Press `A`, then drag from the source to the target.

- **Card to card** — the arrow anchors to both and follows them.
- **Empty space to empty space** — a free-floating arrow, behaving like a shape.
- **Card to empty space** — anchored at one end only.

Press `Esc` or switch back to select (`V`) when you are done.

## Routing

Arrows anchor to cards, not to coordinates. When you move a card, the arrow
re-computes: it chooses which side of each card to leave from and arrive at, and
curves to avoid cutting through the middle of things.

Several arrows between the same pair fan out rather than stacking into one line,
so each stays individually selectable and visible.

You do not configure any of this. The point is that a board stays legible after
you rearrange it, which is the moment hand-placed connectors normally fall apart.

## Styling

Select an arrow and an inline toolbar appears:

| Control | Options |
|---|---|
| Colour | Full [picker](/docs/canvas/palettes-and-color), presets, board palette swatches |
| Thickness | Thin through heavy |
| Head style | Which ends carry a head, and its shape |
| Line | Solid or dashed |
| Curve | How much the path bends |
| Label | Text carried on the arrow itself |

A label rides the arrow, so it moves with the connection instead of drifting
away from it. Good for "then", "cut to", "same location".

## Deleting

Select and press `⌫`, or use the toolbar's delete. Deleting a card deletes the
arrows anchored to it — an arrow to nothing is not a thing worth keeping.

## When to use something else

- Grouping several cards that belong together — use a [group](/docs/canvas/groups).
- A rough circle or box drawn over a region — use [free-draw](/docs/canvas/shapes-and-drawing).
- A fixed sequence of frames in order — use a [grid](/docs/canvas/grids), which has a defined reading order.
