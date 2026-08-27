# Shapes and drawing

> Press D to draw freehand anywhere on a canvas. Four brushes — pen, marker, highlighter and pencil — and a stylus's pressure varies the line. Shapes are proper cards — rectangle, ellipse, line, arrow, diamond, triangle, hexagon and star — with stroke, fill, width and dash controls. There is also a full-screen sketch pad with layers and storyboard frame formats, and an art canvas card for a drawing that belongs to the board as a movable object.

_Source: https://clusters.soleilpictures.com/docs/canvas/shapes-and-drawing · Updated 2026-08-27_

Four different things that all involve making marks, for four different
situations.

## Free-draw

Press `D`. On a phone or tablet the draw tool is on the rail itself, and in the
add sheet. Draw anywhere — over cards, between them, across the whole board.

Strokes live on the board's own drawing layer. They do **not** attach to a card,
so moving a card does not drag your annotation with it. This is the right
behaviour for circling three images and writing "these" beside them, and the
wrong behaviour if you wanted the mark to belong to one image — use an
[art canvas](#art-canvas) for that.

Line thickness is what you see in the picker at the moment you draw, whatever
the zoom, and the stroke then scales with the board like everything else.

### Brushes

| Brush | Draws |
|---|---|
| **Pen** | Tapers with pressure. The default. |
| **Marker** | Constant width, flat ends. |
| **Highlighter** | Wide and translucent, multiplied over what is underneath so text stays readable through it. |
| **Pencil** | Softer, tapers less. |

Each is previewed in the picker as the stroke it actually draws.

### The eraser

Drag it across a stroke and the stroke is **cut** where you crossed it — the
surviving pieces stay. You can rub out the middle of a line without losing its
ends. The eraser has its own size, separate from the pen's, and a ring shows how
wide it is as you go. A swipe over empty space does nothing at all, so it costs
no undo step.

**Clear all drawings** in the canvas right-click menu wipes the whole layer.

### Lasso

Switch the brush to **Lasso** and circle some strokes to select them. A stroke
is taken when *most* of it falls inside the loop. Clusters hands you to the
select tool with them selected, so you can move, scale, recolour or delete the
group straight away — deleting shows an undo toast like everything else.

On a touch device the lasso is the only way to select strokes: a one-finger drag
with the select tool pans the board, so the rubber-band marquee is mouse and
stylus only.

## Shapes

From the rail's **+** menu → *Tools* → **Shape**.

Eight kinds: rectangle, ellipse, line, arrow, diamond, triangle, hexagon and
star. Each is a real card, so it moves, resizes, layers, groups and gets tagged
like anything else.

Per-shape controls: stroke colour, fill colour, stroke width, and solid or
dashed. Settings → **Card defaults** sets what new shapes start with, so you are not
restyling every one.

Shapes are the tool for boxing off regions of a board, drawing a rough frame, or
building a simple diagram. For connecting two specific cards, use an
[arrow](/docs/canvas/arrows) instead — arrows anchor to cards and stay attached
when things move.

> **Note:** Shapes have no title text. To label one, put a [note](/docs/canvas/notes)
> on top of it, or wrap the area in a [group](/docs/canvas/groups), which does
> have a name.

## The sketch pad

**Canvas** in the draw options opens a full-screen sketch pad: an overlay
covering the whole viewport, with the same brushes and pressure as inline
drawing but without having to fight for canvas space. It is where to do real
drawing rather than annotation. Pressing **Add to canvas** places the result as
an [art canvas](#art-canvas) card.

### Frame formats

A new sketch starts as a **16:9** frame, because drawing out shots for a shot
list is what people mostly open it to do. **2.39:1**, **4:3**, **1:1** and
**9:16** are alongside it. The format is offered while the frame is still empty —
nothing rescales, so changing it later would crop what you had drawn.

### Layers

Up to eight. Block a shot out loosely on one, ink over the top on another, then
hide the rough. Each layer can be shown, hidden, reordered or deleted, and
drawing and erasing act on the layer you have selected. Adding, hiding,
reordering and deleting are all undoable.

A sketch that only ever used one layer is stored exactly as it was before layers
existed, and an art canvas drawn before them opens as "Layer 1" with its
drawing intact.

### Undo and keys

The pad has its own undo — `⌘Z` / `⌘⇧Z`, plus toolbar buttons — covering pen
strokes, eraser passes, bucket fills, Clear and every layer change. While the
pad is open, keys apply to the sketch only; nothing you press can affect the
board behind it. The whole session lands on the board as a single undo step.

### On a phone or tablet

The pad goes edge to edge. The brushes, colours, sizes, layers and frame formats
move into a sheet behind the chip showing your current colour and width, and
**Add** and **close** stay put while the tools scroll. **Pinch to zoom** into
the frame and drag with two fingers to move around — a percentage chip in the
corner resets it in one tap.

## Art canvas

An art canvas is a **card** with a drawing surface inside it. Unlike free-draw,
it has edges, and it behaves like every other card — move it, resize it, group
it, tag it, put it in a [grid](/docs/canvas/grids) cell.

Drawing or erasing on an art canvas is one `⌘Z` step per line or erase pass;
editing one in the sketch pad saves the whole session as a single step.

Reach for it when the drawing is a thing on the board rather than an annotation
over the board.

## Colours

Everything here shares one [colour picker](/docs/canvas/palettes-and-color):
saturation-value pad, hue slider, hex field, presets, an eyedropper, and the
swatches from any [palette cards](/docs/canvas/palettes-and-color) on the board.

Recently used colours are remembered, so a board built in one palette stays in
that palette without effort.

## Tablets and styluses

A stylus is the best way to draw here. Pressure varies the width of the line,
and the pen's sampling is built for a high-frequency stylus rather than fighting
it.

**Once Clusters has seen a stylus on a device, your finger switches to panning
and only the stylus draws.** This is what makes palm rejection work: a palm
landing on the glass before the tip would otherwise win the race and own the
stroke. It is the same behaviour as Procreate, GoodNotes and Freeform, it is
announced the first time it happens, and there is a **Draw with finger** toggle
in the draw options if you want both to mark.

Flipping a pen over to its eraser end erases, and the barrel button does too.

Two fingers always mean pinch-zoom, never a stroke — starting a pinch part-way
through a line discards that line rather than smearing it across the board as
the canvas moves underneath.
