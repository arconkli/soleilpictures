---
title: Grids — Soleil Clusters
metaDescription: Grid cards in Soleil Clusters split into resizable cells holding any content — storyboards, contact sheets, comparisons. Templates and generated matrices.
h1: Grids
navLabel: Grids
section: canvas
order: 7
updated: 2026-08-27
answer: A grid is a card divided into cells, and every cell holds any kind of content — an image, text, a link, a video, a file, even another cluster. The grid tool opens a Templates panel: pick a shape like storyboard, 2x2 or contact sheet, then click the canvas to place it, or apply it to a grid you already have. Cells split and merge by dragging the dividers.
faq:
  - q: What can go in a grid cell?
    a: Images, text, links, videos, files and nested clusters. A cell is not restricted to pictures.
  - q: How do I change the layout after I have made it?
    a: Drag the dividers between cells. Cells split and merge as you go, and the rest of the grid reflows around what you changed.
  - q: Can I change a grid's shape without losing what is in it?
    a: Yes. Select the grid, open the Templates panel and pick a new shape. Cell content moves across in reading order, and if the new shape has fewer cells than you had filled, the ones with nowhere to go are named in an Undo toast.
  - q: Can several grids share a layout?
    a: Yes, but that is a separate feature. A template is a saved shape you stamp out; a grid family is a live link between grids on one board, where changing one reflows the rest.
related:
  - /docs/canvas/cards
  - /docs/canvas/images
  - /docs/canvas/schedule
---

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

The grid tool on the left rail arms the placer and opens the **Templates** panel
at the same time, so you can click straight through it for the default or pick a
shape first. Each entry shows the shape it will make, drawn from the same
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

Picking the grid tool arms it *and* opens the panel, so you can ignore the panel
entirely and click the canvas for the default storyboard. What clicking a
template does depends on what is selected:

- **Nothing selected** — the next click on the canvas places a new grid in that
  shape instead of the default.
- **A grid selected** — that grid is re-cut in place.

Type in the **search** box to filter by name — across the defaults and anything
you have saved — then press **Enter** to take the top match, or use the **arrow
keys** to move through the grid. Press **Escape** once to close the panel, twice to put the
tool away.

Re-cutting keeps your work. Cell content moves to the new cells in reading
order, so the first filled cell stays first. If the new shape has fewer cells
than you had filled, the leftovers are dropped and the Undo toast says how many.
Pressing **G** skips the panel and places the default storyboard immediately.

### Saving your own

Right-click a grid you like the shape of and choose **Save as template** — or
select it and use **Save this grid as a template** at the bottom of the panel.
Either way it saves the *shape*, the cells and their proportions, and not what
is in them: a saved template is a skeleton you fill in fresh each time.

### Labelling the boxes

While saving, you can give each box a label — "WIDE SHOT", "ACTION", "DIALOGUE".
The dialog shows the shape with every box numbered, and hovering a field lights
the box it belongs to, so you always know which one you are naming. Labels are
optional, including all of them.

A label is **guidance, not content**. It shows in grey inside an empty box and
disappears the moment there is anything in that box — you never have to select
it and delete it. Clear the box later and the label comes back. Because it is
never really in the cell, a labelled-but-empty box counts as empty everywhere it
matters: it adds nothing to your card count and nothing to an export.

### Sections

The panel groups templates by where they came from, nearest to you first:

| Section | What is in it |
|---|---|
| **Yours** | Templates you saved. |
| **Workspace** | Shared with everyone in the current workspace. |
| **Downloaded** | Copies you took from a share link or the public gallery. |
| **Defaults** | The layouts that ship with Clusters. |

Click any heading to fold that section away — useful once you have your own and
the defaults are mostly in the way. A folded heading still shows how many are
inside it, and the panel remembers what you folded. Search always looks inside
folded sections, so a match is never hidden behind a closed heading.

Your templates appear under **Yours**. Each one has a **···** menu:

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
