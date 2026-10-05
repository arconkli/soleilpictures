---
title: Clusters and Nesting — Soleil Clusters
metaDescription: Create, nest, rename and organize clusters in Soleil Clusters. Unlimited nesting, cover images, thumbnails, moving boards and the sidebar tree.
h1: Clusters
navLabel: Overview
section: clusters
order: 0
updated: 2026-10-02
answer: A cluster is a board, and clusters nest inside each other without limit — which is how a project becomes a folder tree without anyone building one. There is no separate limit on how many clusters you make, but each one sits on its parent's canvas as a card, so on the free plan it counts as one of your cards. Each cluster gets an automatic thumbnail rendered from its actual contents, or a cover image you choose yourself.
faq:
  - q: Is there a limit on how many clusters I can make?
    a: Not separately. Each cluster sits on the canvas that holds it as a card, and on the free Demo plan that card counts toward your {{fact:demoCardLimit}} cards, like any other. Creator removes the card limit.
  - q: How do I move a cluster somewhere else?
    a: Drag it in the sidebar tree, or drag it onto another cluster's card on a canvas. Moves are cycle-safe — you cannot make a cluster its own ancestor.
  - q: Where do deleted clusters go?
    a: To the trash, for 30 days, from which they can be restored. See Trash and recovery.
related:
  - /docs/clusters/list-view
  - /docs/concepts
  - /docs/clusters/trash-and-recovery
---

A cluster is the unit of work: a project, a scene, a pitch, a moodboard. The
code and the [API](/docs/api/boards) call the same object a **board**.

## Starting a project

A project is a cluster at the top of your workspace, beside **Studio** (the
cluster everything starts in). Three ways to start one, and all three put it at
the top and open it for you:

- **New project** on [Home](/docs/clusters/home-graph) — type a name, press Enter
- The **+** next to **Clusters** in the sidebar — name it right in the sidebar
- `⌘K` → "new project"

A new project opens on the same panel a first board does: paste or drag images
in from any tab, or drop a whole folder.

## Dropping a folder

Drag a folder from your desktop onto a canvas and it becomes a cluster there,
named after the folder. Each folder inside it becomes a cluster nested inside
that one, the same shape your folders had, and every file becomes a card in
the cluster it was in — photos laid out in rows, everything else in a grid,
each keeping its file name. **Add → Folder…** does the same from a picker, on a
desktop browser.

While it runs, a bar at the bottom of the screen counts the files and has a
**Cancel**: what has landed is kept, and nothing empty is left behind. When it
finishes, the message offers **Undo**, which takes every cluster it made back
to [Trash](/docs/clusters/trash-and-recovery).

- One drop reads up to **{{fact:folderMaxFiles}} files** and makes up to
  **{{fact:folderMaxClusters}} clusters**. Past either, the import is partial
  and says so.
- Folders nested more than **{{fact:folderMaxDepth}} levels** deep are merged
  into the deepest cluster rather than left out.
- The things a computer keeps in folders that are not yours to look at —
  `.DS_Store`, hidden files, app and project bundles such as a `.logicx`
  session or a Photos library — are left out, and so are files iCloud has not
  downloaded yet. The message counts them.
- On the free plan the folder is counted before anything uploads: one
  [card](/docs/canvas/cards) for each file and one for each cluster it becomes.
  If it will not all fit, you are asked first, and **Add what fits** takes
  whole folders in order rather than a scatter of half-filled ones.

Dropping a folder works on the canvas, on a desktop browser. A phone cannot
drag a folder, and list view takes files rather than folders.

## Adding a cluster inside one

- The **Add cluster** tool on any canvas creates a cluster nested inside the one
  you are in
- Right-click a canvas → Add → Cluster does the same, under your cursor

There is no separate limit on how many clusters you make. Each one sits on its
parent's canvas as a card, though, so on the free Demo plan every cluster counts
as one of your {{fact:demoCardLimit}} [cards](/docs/canvas/cards).

## Nesting

A cluster inside a cluster appears as a card on the parent's canvas that opens
into its own canvas. There is no depth limit.

This is how structure emerges without anybody designing it: a film becomes
scenes, a scene becomes setups, a setup becomes a reference wall — each a real
board you can open, share and work on independently.

**Moving** a cluster: drag it in the sidebar tree, drag it onto another
cluster's card on a canvas, or right-click it → **Move to cluster…**. Moves are
cycle-safe — dragging a cluster into one of its own descendants is refused
rather than creating a loop. Cards move the same way — see
[Cards](/docs/canvas/cards).

**Linked clusters** are different: a reference to a cluster that lives elsewhere,
placed on this canvas. The board itself does not move. Use it when something
belongs in two places.

## Side by side

Two clusters can be open at once, in a split view with a draggable divider.

- The **⧉ Pin alongside** button in the topbar
- `⌘K` → "Open split view"

Then pick the cluster for the right-hand side. Close it with the **×** at the
top-right of that pane, or the same topbar button.

**Each side navigates itself.** Opening a nested cluster on the right moves the
right side only — the left stays where it was. The same holds for what you drop,
link and edit: it lands on the side you did it on.

**One toolbar, and it follows you.** There is no second bar inside the split.
The breadcrumb at the top always describes the side you last clicked into, so it
is where you go to see where you are and to climb back a level; Back and Forward
move that side too, and the sidebar highlights that side's cluster. The active
side is outlined in gold.

Access is per side too. If the right pane is showing a cluster someone shared
with you as view-only, it is read-only there, exactly as it would be full screen.

The split — both clusters, both breadcrumbs, and the divider position — is
remembered, so a reload puts you back in it. It is a desktop feature; there is no
split on phones.

A [document docked beside the canvas](/docs/documents#opening) uses the same
right-hand pane, so opening one closes a cluster split, and vice versa.

## Thumbnails

Every cluster gets a thumbnail rendered from what is actually on it — a
miniature of the board, not a generic icon. It updates as the board changes.

To override it, right-click the cluster:

- **Cover colour** — a flat colour instead of a render
- **Upload custom thumbnail** — your own image, with a 16:9 crop and reposition step
- **Reset to auto thumbnail** — back to the generated render

A custom thumbnail is respected — editing the board afterwards will not
silently overwrite the image you chose.

## Views

Every cluster has two views of the same contents:

- **[Canvas](/docs/canvas)** — the infinite surface, where position means something
- **[List](/docs/clusters/list-view)** — a sortable, searchable file browser

Switching does not convert anything. Settings → **Card defaults** sets which view new
clusters open in.

## Finding clusters

- **[Home](/docs/clusters/home-graph)** lists your projects, newest work first,
  with the clusters you were last in under **Jump back in**
- **The sidebar tree** opens on your projects, most recently worked on first,
  and expands lazily, so a deep hierarchy stays fast
- **All clusters** at the bottom of the sidebar's list searches every cluster
  and opens the one you pick
- **[`⌘K`](/docs/organize/search)** searches cluster names alongside everything else
- **Shared with me** groups clusters other people have invited you to, by whose workspace they came from

## Deleting

Deleting a cluster is a **soft delete**. It goes to the trash and stays
restorable for 30 days. See
[Trash and recovery](/docs/clusters/trash-and-recovery), which also covers
version history and rolling a whole workspace back to a point in time.
