---
title: Clusters and Nesting — Soleil Clusters
metaDescription: Create, nest, rename and organize clusters in Soleil Clusters. Unlimited nesting, cover images, thumbnails, moving boards and the sidebar tree.
h1: Clusters
navLabel: Overview
section: clusters
order: 0
updated: 2026-08-08
answer: A cluster is a board, and clusters nest inside each other without limit — which is how a project becomes a folder tree without anyone building one. Clusters are never capped on any plan. Each one gets an automatic thumbnail rendered from its actual contents, or a cover image you choose yourself.
faq:
  - q: Is there a limit on how many clusters I can make?
    a: No. Clusters are unlimited on every plan, including free. Only cards are capped, at {{fact:demoCardLimit}} on the free Demo plan.
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

## Creating one

- **New cluster** in the sidebar
- `⌘K` → "create cluster"
- The **Add cluster** tool on any canvas, which creates it nested inside the current one
- Right-click a canvas → Add → Cluster

Clusters are **unlimited on every plan**, including free. Only
[cards](/docs/canvas/cards) are capped.

## Nesting

A cluster inside a cluster appears as a card on the parent's canvas that opens
into its own canvas. There is no depth limit.

This is how structure emerges without anybody designing it: a film becomes
scenes, a scene becomes setups, a setup becomes a reference wall — each a real
board you can open, share and work on independently.

**Moving** a cluster: drag it in the sidebar tree, or drag it onto another
cluster's card on a canvas. Moves are cycle-safe — dragging a cluster into one
of its own descendants is refused rather than creating a loop.

**Linked clusters** are different: a reference to a cluster that lives elsewhere,
placed on this canvas. The board itself does not move. Use it when something
belongs in two places.

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

Switching does not convert anything. Settings → **Defaults** sets which view new
clusters open in.

## Finding clusters

- **The sidebar tree** expands lazily, so a deep hierarchy stays fast
- **[`⌘K`](/docs/organize/search)** searches cluster names alongside everything else
- **Recents** surfaces what you have had open
- **[Home](/docs/clusters/home-graph)** shows the whole workspace as a relationship graph
- **Shared with me** groups clusters other people have invited you to, by whose workspace they came from

## Deleting

Deleting a cluster is a **soft delete**. It goes to the trash and stays
restorable for 30 days. See
[Trash and recovery](/docs/clusters/trash-and-recovery), which also covers
version history and rolling a whole workspace back to a point in time.
