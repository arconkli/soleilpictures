---
title: Cards — Soleil Clusters
metaDescription: Every card type in Soleil Clusters — images, notes, links, documents, PDFs, video, audio, palettes, shapes, grids, schedules, votes and nested clusters.
h1: Cards
navLabel: Cards
section: canvas
order: 1
updated: 2026-08-08
answer: A card is one thing on a board. Soleil Clusters has around fifteen kinds — image, note, link, document, PDF, file, video, audio, colour palette, shape, art canvas, grid, schedule, vote and nested cluster. Every card shares the same position, size, layer and selection behaviour, so what you learn on one applies to all of them.
faq:
  - q: How do I change what kind a card is?
    a: You do not convert cards between kinds. Create the kind you want and move the content across. The one exception is dropping a file, which picks the right kind for you automatically.
  - q: Is there a limit on cards?
    a: The free Demo plan allows {{fact:demoCardLimit}} cards across every cluster you create. Creator removes the limit. Clusters themselves are never capped.
  - q: What happens if I delete a card by accident?
    a: Cmd-Z undoes it. Deletions also show an undo toast. Deleting a whole cluster is a soft delete that stays in the trash for 30 days.
related:
  - /docs/canvas
  - /docs/canvas/images
  - /docs/files
---

Everything on a canvas is a card. They differ in what they hold and nothing
else — position, size, stacking order, selection, grouping, tagging, commenting
and duplication work identically on all of them.

## Every kind

| Card | What it holds |
|---|---|
| **Image** | A picture, with [non-destructive adjustments](/docs/canvas/images) |
| **Note** | [Rich text](/docs/canvas/notes) — checklists, mentions, formatting |
| **Link** | A URL, unfurled into a real preview with title and thumbnail |
| **Doc** | A whole [multi-page document](/docs/documents) |
| **PDF** | Page one as a thumbnail, opening into a [full viewer](/docs/files/pdf) |
| **File** | [Any other file](/docs/files) — type icon, size, download |
| **Video** | An inline player |
| **Audio** | A waveform player with cover art |
| **Palette** | A set of [colours](/docs/canvas/palettes-and-color) you can pull from |
| **Shape** | [Rectangle, ellipse, line, arrow, diamond, triangle, hexagon, star](/docs/canvas/shapes-and-drawing) |
| **Art canvas** | A bounded drawing surface that lives as a card |
| **Grid** | A [split-cell layout](/docs/canvas/grids) — storyboards, contact sheets |
| **Schedule** | A [real-date calendar](/docs/canvas/schedule) you can drop things into |
| **Vote** | An [up/down poll](/docs/canvas/vote-cards) anchored anywhere |
| **Cluster** | A [nested board](/docs/clusters), opening into its own canvas |
| **Linked cluster** | A reference to a cluster that lives elsewhere |

## Adding one

Four ways, in rough order of speed:

1. **Drag a file in** from your desktop. The type is detected and the right card kind is created — see [Files and media](/docs/files).
2. **Paste.** A URL becomes a link card, an image in your clipboard becomes an image card, text becomes a note.
3. **Double-click empty canvas** for an add menu at your cursor.
4. **The tool rail** or its **+** menu.

Cards you add without specifying a position are placed in free space, so a batch
of twelve images arranges rather than stacking on top of what is already there.

## What every card does

**Move** by dragging. **Resize** from the corners. Hold `Alt` while dragging to
ignore [snapping](/docs/canvas/snapping-and-alignment).

**Layer order** — `[` and `]` send backward and forward. Also in the right-click
menu.

**Duplicate** — `⌘D`.

**Delete** — `⌫`. A toast offers undo; `⌘Z` also works.

**Group** — select several and press `⌘G`. See [Groups](/docs/canvas/groups).

**Tag** — right-click → tag. See [Tags](/docs/organize/tags).

**Comment** — right-click → comment, which anchors a bubble to that card. See
[Comments](/docs/collaborate/comments).

**Copy link** — a deep link that opens the board with that card selected. Useful
in a message or a doc.

## Titles

Most cards have a title. Double-click it to edit. Titles are searchable in
`⌘K` and they are what shows in [list view](/docs/clusters/list-view), so a card
called "Untitled" is a card you will not find later.

> **Note:** Shape cards are the exception — they have no title. If you need a
> labelled shape, put a note on top of it or use a [group](/docs/canvas/groups),
> which does have a name.

## The card limit

The free Demo plan allows **{{fact:demoCardLimit}} cards** in total across every
cluster you create. Cards on clusters someone else owns do not count against
you — if you are invited as an editor, you are spending their allowance, not
yours.

{{fact:planName}} removes the limit entirely. See [Plans](/docs/account/plans).

## Cards through the API

The [REST API](/docs/api/cards) exposes a deliberately narrower card model than
the canvas: {{fact:apiCardKinds}}. An API caller can set position, size, title,
body, HTML, URL, image key and colour, and nothing else — interior state that
belongs to the editor is not writable from outside.
