# Grids

> A grid is a card divided into cells, and every cell holds any kind of content — an image, text, a link, a video, a file, even another cluster. The grid tool opens a Templates panel: pick a shape like storyboard, 2x2 or contact sheet, then click the canvas to place it, or apply it to a grid you already have. Cells split and merge by dragging the dividers.

_Source: https://clusters.soleilpictures.com/docs/canvas/grids · Updated 2026-08-26_

A grid is a card that is divided up. Every cell holds real content, and the
divisions are yours to move.

Press `G`, or use the tool rail.

## What a cell holds

Not just images. A cell takes an image, a piece of text, a link, a video, a
file, or a nested cluster. A storyboard panel can be the frame in one cell and
the action line in the cell beneath it.

Drop a file directly into a cell to fill it. Each cell has its own menu for
replacing, clearing, or — for images — the full set of
[photo controls](/docs/canvas/images).

## Building a layout

Grids are not fixed rows and columns. The structure is a tree of splits, which
is why an asymmetric storyboard layout is as easy as a regular one.

- **Drag a divider** to resize the cells either side of it.
- **Split a cell** to divide it further, horizontally or vertically.
- **Merge** adjacent cells back together.

Everything reflows around what you changed.

## Templates

The grid tool on the left rail opens the **Templates** panel rather than placing
one fixed shape. Each entry shows the shape it will make, drawn from the same
geometry the card itself uses — so the tile and the grid you get cannot drift
apart.

| Template | Layout |
|---|---|
| Storyboard · 1 top / 2 bottom | One wide panel on top, two beneath |
| Database row · 1 left / 3 stacked | One, then a column of three |
| 2 × 2 | Four equal cells |
| 3 across | Three columns |
| 4 across | Four columns |
| Contact sheet · 3 × 3 | Nine equal cells |
| Hero + 3 below | One large panel over a row of three |
| Side by side | Two columns |
| Stacked pair | Two rows |
| Single cell | One cell |

What clicking a template does depends on what is selected:

- **Nothing selected** — the next click on the canvas places a new grid in that
  shape.
- **A grid selected** — that grid is re-cut in place.

Re-cutting keeps your work. Cell content moves to the new cells in reading
order, so the first filled cell stays first. If the new shape has fewer cells
than you had filled, the leftovers are dropped and the Undo toast says how many.
Pressing **G** skips the panel and places the default storyboard immediately.

### Saving your own

Select a grid you like the shape of and choose **Save this grid as a template**
at the bottom of the panel. It saves the *shape* — the cells and their
proportions — and not what is in them, so a saved template is a skeleton you
fill in fresh each time.

Your templates appear under **My templates**, above the built-ins. Each one has
a **···** menu:

| Action | What it does |
|---|---|
| **Rename** | Changes the name in your library. |
| **Share with workspace** | Moves it to **Workspace**, where every member of the current workspace can use it. **Make private** moves it back. |
| **Copy share link** | Creates a link to the template. Anyone who opens it gets their own copy. |
| **Delete** | Removes it, with an Undo toast. |

A workspace template can be renamed and edited by any member, but only the
person who made it can create a share link for it.

### Share links

A share link points at the template's shape, nothing else — it carries no images,
no text, and nothing about the board it came from. Opening one shows the layout
and offers to add it to your own templates; whoever opens it gets a **copy** they
can rename or delete, and yours is unaffected. Deleting the template makes every
link to it stop working.

### The public gallery

**Publish to gallery** puts a template on [/templates](/templates), where anyone
can browse and use it. There is no review queue — it appears immediately — and
**Remove from gallery** takes it back down just as fast. A template needs at
least two cells to be published; a single-cell grid is a box, not a layout.

Publishing shares the shape and the name you gave it. It does not share the board
it came from, the images in it, or anything you wrote. Anyone who uses a
published template gets their own copy, so removing it later does not reach into
anybody's library and take it back.

Only the person who made a template can publish it. A workspace template can be
renamed and edited by any member, but publishing it is still the author's call.

**Generate matrix** builds an empty N×M grid at whatever size you name — the
fast path to a contact sheet larger than any template.

## Reading order

Cells have a defined order, which is what makes a grid different from a set of
images that happen to be arranged in rows. A storyboard reads in sequence, and
that sequence is what exports and what a reader follows.

## Grid families

A family is a **live link** between grids on one board: change the layout in one
and the change carries to the others — the mechanism that keeps a twelve-page
storyboard from drifting into twelve slightly different layouts. Right-click a
grid and choose **Share layout** to start one, **Unlink layout** to leave.

This is not the same thing as a template, though both are about shape. A
template is a saved shape you stamp out, and applying one is a one-time copy — 
the new grid owes nothing to the template afterwards. A family is an ongoing
subscription between grids that already exist. Applying a template to a grid
that belongs to a family re-cuts the whole family, because that is what
belonging to one means.

## Discovering grids

Put four or more images on a board and the app suggests a grid, once. That
suggestion is a [power reveal](/docs/canvas): it fires a single time, ever, and
never again.

## Grids versus schedules

They look similar and are not the same thing:

- A **grid** is a spatial layout. Cells mean position.
- A **[schedule](/docs/canvas/schedule)** is a calendar. Cells mean *dates* — real ones, with month, week, day and hour views.

If the cells represent time, you want a schedule.

---

Building a storyboard specifically? The
[storyboard maker](/tools/storyboard-maker) guide covers the whole workflow.
