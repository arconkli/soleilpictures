---
title: Shapes and Drawing — Soleil Clusters
metaDescription: Draw freehand on a Soleil Clusters canvas, add shapes with stroke and fill control, use the sketch pad overlay, or place a bounded art canvas card.
h1: Shapes and drawing
navLabel: Shapes and drawing
section: canvas
order: 4
updated: 2026-08-08
answer: Press D to draw freehand anywhere on a canvas. Shapes are proper cards — rectangle, ellipse, line, arrow, diamond, triangle, hexagon and star — with stroke, fill, width and dash controls. There is also a full-screen sketch pad for a bigger surface, and an art canvas card for a drawing that belongs to the board as a movable object.
faq:
  - q: What is the difference between free-draw and an art canvas?
    a: Free-draw strokes sit on the board's own drawing layer and do not move when you move cards. An art canvas is a card with its own bounded drawing surface, so it moves, resizes and can be grouped like anything else.
  - q: How do I erase just part of a stroke?
    a: You cannot. The eraser removes whole strokes. Annotating quickly is the use case, and partial erasing was consistently slower than redrawing.
  - q: Can I draw with a stylus on a tablet?
    a: Yes. Pointer input is handled the same for stylus, finger and mouse, and the canvas will not pan out from under you mid-stroke.
related:
  - /docs/canvas
  - /docs/canvas/arrows
  - /docs/canvas/cards
---

Four different things that all involve making marks, for four different
situations.

## Free-draw

Press `D`. Draw anywhere — over cards, between them, across the whole board.

Strokes live on the board's own drawing layer. They do **not** attach to a card,
so moving a card does not drag your annotation with it. This is the right
behaviour for circling three images and writing "these" beside them, and the
wrong behaviour if you wanted the mark to belong to one image — use an
[art canvas](#art-canvas) for that.

The **eraser** removes whole strokes rather than parts of them. **Clear all
drawings** in the canvas right-click menu wipes the layer.

## Shapes

From the rail's **+** menu → *Tools* → **Shape**.

Eight kinds: rectangle, ellipse, line, arrow, diamond, triangle, hexagon and
star. Each is a real card, so it moves, resizes, layers, groups and gets tagged
like anything else.

Per-shape controls: stroke colour, fill colour, stroke width, and solid or
dashed. Settings → **Defaults** sets what new shapes start with, so you are not
restyling every one.

Shapes are the tool for boxing off regions of a board, drawing a rough frame, or
building a simple diagram. For connecting two specific cards, use an
[arrow](/docs/canvas/arrows) instead — arrows anchor to cards and stay attached
when things move.

> **Note:** Shapes have no title text. To label one, put a [note](/docs/canvas/notes)
> on top of it, or wrap the area in a [group](/docs/canvas/groups), which does
> have a name.

## The sketch pad

The rail's **+** → *Tools* → **Draw** also offers a full-screen sketch pad: an
overlay covering the whole viewport, with the same stroke behaviour as inline
drawing but without having to fight for canvas space.

Useful for a quick diagram you want to think through at size before placing.

## Art canvas

An art canvas is a **card** with a drawing surface inside it. Unlike free-draw,
it has edges, and it behaves like every other card — move it, resize it, group
it, tag it, put it in a [grid](/docs/canvas/grids) cell.

Reach for it when the drawing is a thing on the board rather than an annotation
over the board.

## Colours

Everything here shares one [colour picker](/docs/canvas/palettes-and-color):
saturation-value pad, hue slider, hex field, presets, an eyedropper, and the
swatches from any [palette cards](/docs/canvas/palettes-and-color) on the board.

Recently used colours are remembered, so a board built in one palette stays in
that palette without effort.

## Tablets and styluses

Pointer handling treats stylus, finger and mouse the same. Drawing gestures are
guarded so the canvas will not start panning halfway through a stroke, which is
the failure that makes drawing on a touch device unusable.
