---
title: The Canvas — Soleil Clusters
metaDescription: The infinite canvas in Soleil Clusters — tools, panning, zooming, selection, right-click menus, drawing, backgrounds and exporting.
h1: The canvas
navLabel: Overview
section: canvas
order: 0
updated: 2026-08-08
answer: Every cluster opens as an infinite canvas. You pan with Space or H, zoom with Cmd and plus or minus, and place cards anywhere. A tool rail runs down the left edge, right-clicking gives you a full menu wherever you clicked, and your zoom and pan position are remembered per cluster so reopening resumes where you left off.
faq:
  - q: How big is the canvas?
    a: There is no boundary. Cards can go anywhere, and Shift-1 fits everything you have made back on screen no matter how far it spread.
  - q: Can I change the background?
    a: Yes. Right-click the canvas and pick a background colour — seven presets plus a custom picker. The setting is per cluster.
  - q: Does the canvas work on a tablet?
    a: Yes. Touch gestures pan and zoom, long-press opens the context menu, and the tool rail adapts. Drawing works with a stylus or a finger.
related:
  - /docs/canvas/cards
  - /docs/keyboard-shortcuts
  - /docs/canvas/snapping-and-alignment
---

The canvas is the default view of every cluster. It is an unbounded surface —
position means something here, which is the whole point. Two images side by side
are being compared; an image with a note under it is being annotated.

If you want the same contents as a sortable file list instead, every cluster
also has a [list view](/docs/clusters/list-view).

## Moving around

| Action | How |
|---|---|
| Pan | Scroll, hold `Space` and drag, or press `H` for the pan tool |
| Zoom | `⌘+` / `⌘−`, pinch, or `⌘`-scroll |
| Reset zoom | `⌘0` |
| Fit everything | `⇧1` |
| Fit selection | `⇧2` |

Your position is saved per cluster. Close a board deep in a corner of the canvas
and it reopens there, not at the origin.

If scrolling to zoom is the habit you arrived with — it is how PureRef and Miro
work — **Settings → Display → Scroll wheel** swaps the two, so a plain scroll
zooms at the pointer and `⌘`, `Alt` or `Shift` pans. Pinching a trackpad zooms
in either setting. See [keyboard shortcuts](/docs/keyboard-shortcuts).

## The tool rail

Down the left edge:

- **Select / move** (`V`) — the default. Click to select, drag to move, drag on empty space to marquee-select.
- **Pan** (`H`) — grab the canvas itself.
- **Add image** — file picker. Dragging from your desktop is usually faster.
- **Add note** (`N`) — a [rich-text note](/docs/canvas/notes).
- **Add doc** — a [document card](/docs/documents).
- **Add cluster** — a nested board.
- **Add grid** (`G`) — a [grid](/docs/canvas/grids).
- **Arrow** (`A`) — [connect two things](/docs/canvas/arrows).

The **+** at the end of the rail opens the rest, grouped:

- *Tools* — Draw (`D`), Shape, Palette
- *Create* — File, Link, Schedule, Linked cluster
- *Annotate* — Comment, Vote

## Right-click

Right-clicking is the fastest path to almost everything, and the menu differs by
what is under the cursor.

**On empty canvas:** Add (Cards / Visual / Web / Annotate), Paste, Select all,
Background colour, Reset zoom, Export to PNG or PDF, and Clear all drawings.

**On a card:** everything specific to that card kind, plus the universal
operations — duplicate, delete, layer order, tag, comment, copy link.

**On a group:** rename, outline shape and colour, add to group, ungroup, group
comment, group tag.

**Inside text you are editing:** your browser's own menu, not ours. Right-clicking
mid-sentence in a [note](/docs/canvas/notes) is a text gesture, so you get Paste,
Copy, Look Up and Emoji & Symbols rather than card operations. Click away first
to get the card menu.

Panels that float above the canvas — the colour picker, image adjustments, grid
cell menus — swallow the right-click rather than passing it to the card behind
them. The exception is a text field inside one, which again defers to the
browser, so you can paste a hex code straight into the picker.

> **Tip:** Double-clicking empty canvas opens the add menu right at your cursor.
> On a long canvas this beats travelling to the rail and back.

## Selection

Click to select. Shift-click to add. Drag on empty canvas to marquee.

With several cards selected you can move them as one, align them, delete them
together, or press `⌘G` to make them a [group](/docs/canvas/groups) — which is a
selection that persists, gets a name, and can be commented on as a unit.

## Drawing

Press `D` for the freehand tool. Draw straight onto the canvas over and around
cards; strokes are their own layer, so they do not attach to a card and do not
move when you move one.

The eraser removes whole strokes rather than nibbling at them, which is what you
want when annotating in a hurry. **Clear all drawings** in the canvas right-click
menu removes them in one go.

For a bigger drawing surface, the **sketch pad** overlay covers the whole
viewport. For a drawing that belongs to the board as an object you can move and
resize, use an [art canvas card](/docs/canvas/shapes-and-drawing) instead.

## Background

Right-click → **Background colour**. Seven presets plus a custom picker, set per
cluster. Useful for separating a scratch board from a client-facing one at a
glance.

## Getting it out

Right-click → **Export** gives you the whole board as a PNG or a PDF. See
[Exporting a board](/docs/canvas/export) for what is included and what is not.

---

If you are building a specific kind of board, these walk through the whole
workflow: [mood board maker](/tools/mood-board-maker) ·
[reference board maker](/tools/reference-board-maker).
