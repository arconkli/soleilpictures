# Clusters

> A cluster is a board, and clusters nest inside each other without limit — which is how a project becomes a folder tree without anyone building one. Clusters are never capped on any plan. Each one gets an automatic thumbnail rendered from its actual contents, or a cover image you choose yourself.

_Source: https://clusters.soleilpictures.com/docs/clusters · Updated 2026-08-08_

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

## Side by side

Two clusters can be open at once, in a split view with a draggable divider.

- The **⧉ Pin alongside** button in the topbar
- `⌘K` → "Open split view"

Then pick the cluster for the right-hand side. Close it with the **×** in the
right pane's bar, or the same topbar button.

**Each side navigates itself.** Opening a nested cluster on the right moves the
right side only — the left stays where it was — and each side keeps its own
breadcrumb trail to climb back out. The same holds for what you drop, link and
edit: it lands on the side you did it on.

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
