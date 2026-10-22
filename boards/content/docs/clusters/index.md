---
title: Clusters and Nesting — Soleil Clusters
metaDescription: Create, nest, rename and organize clusters in Soleil Clusters. Unlimited nesting, cover images, thumbnails, moving boards and the sidebar tree.
h1: Clusters
navLabel: Overview
section: clusters
order: 0
updated: 2026-10-21
answer: A cluster is a board, and clusters nest inside each other without limit — which is how a project becomes a folder tree without anyone building one. There is no limit on how many clusters you make, and a cluster costs none of your cards: its card on the parent's canvas is free on every plan, and only what you put inside it counts. Each cluster gets an automatic thumbnail rendered from its actual contents, or a cover image you choose yourself.
faq:
  - q: Is there a limit on how many clusters I can make?
    a: No. A cluster sits on the canvas that holds it as a card, but that card is free — it does not count toward the free Demo plan's {{fact:demoCardLimit}} cards. Only what you put inside a cluster counts. Creator removes the card limit.
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

- **New cluster** on [Home](/docs/clusters/home-graph) — type a name, press Enter
- The **+** next to **Clusters** in the sidebar — name it right in the sidebar
- `⌘K` → "new project"

A new project opens on the same panel a first board does: paste or drag images
in from any tab, or drop a whole folder or zip.

## Importing folders and zips

Drag a folder from your computer onto a canvas and it becomes a cluster there,
named after the folder. Each folder inside it becomes a cluster nested inside
that one, the same shape your folders had, and every file goes to the
[Files](/docs/clusters/list-view) of the cluster it was in, under its own name
and with its own modified date. Nothing is laid out on a board for you: the
canvas of each new cluster holds only the clusters nested in it.

A zip comes in the same way. Drop one and you are asked first: **Unpack into
clusters** turns every folder in it into a cluster, or **Add as a zip file**
keeps it whole, as one file in Files. A Google Takeout or Google Drive export
that arrives in several parts becomes one tree when you drop all the parts at
once.

You can start an import from:

- a canvas — drop a folder or a zip, or **Add → Folder…**
- [Files](/docs/clusters/list-view) — drop a folder or a zip into the list
- a cluster in the sidebar — drop it onto the cluster's row
- the sidebar's **Upload** menu — **A folder…**, or **A zip or Google
  Takeout…**, which go into the cluster that is open, or one you pick

A phone's or a tablet's browser can't pick or drag a folder, so there you
choose a zip instead. To bring files over from Google Drive, Dropbox, OneDrive
or iCloud, see [Coming from another
tool](/docs/migrating#bringing-files-from-google-drive-dropbox-and-other-apps).

### While it runs

Before anything uploads, the import counts what you gave it. If all of it fits
your plan it starts at once; if not, you are asked first (see below). While it
runs, a tray in the corner shows how many files are in and roughly how long is
left, with **Pause** and **Cancel**, and folds into a small chip when you
minimize it. Uploads run in the open tab, so keep it open — on a phone, keep it
on screen. One import runs at a time; a second one you drop waits its turn.

If the page reloads or the tab closes part-way, the tray offers the stopped
import the next time you open the app: **Resume** where the browser kept the
folder (it asks to read it again first), or drop the same folder or zip on the
same cluster again — either way, files already in are skipped.

When it finishes, **Open** and the cluster's name takes you there, and **Remove this
import** moves every cluster it made to [Trash](/docs/clusters/trash-and-recovery),
with an undo. Files that couldn't be brought in are listed with the reason,
and **Try these again** retries them. A cluster made only of files gets a cover
from its first pictures.

### When it doesn't all fit

Each file is one [card](/docs/canvas/cards) and takes its size from your
[storage](/docs/files#storage). The clusters it makes cost nothing, as no
cluster does. When the whole import won't fit your plan, it says how much
would come in and how much would wait, and offers:

- **Bring … now** (or **Keep it waiting**, when nothing fits yet) — makes every cluster and fills them in folder order with
  what fits. The rest **waits** in the tray, and comes in by itself as soon as
  there is room — when you upgrade, add storage, delete files or empty the
  trash — for as long as the tab stays open. The cluster's Files says how many
  of its files are waiting for room.
- an upgrade, a trial or extra storage, where one would make room
- **Cancel**

Importing into someone else's workspace counts toward its owner's plan, and
what waits comes in once the owner has room.

### Putting files on the board

The canvas of an imported cluster offers to put its files on the board:
**Put them on the board** lays photos out in rows and anything else in a grid,
in one undo step, and **Choose in Files** lets you pick. One press places up to
{{fact:putOnBoardMax}} files; the rest stay in Files to place from there. Files
that are still uploading aren't placed until they finish. In Files, select
files and choose **Put on board** at any time — see [Not on
board](/docs/clusters/list-view#not-on-board).

### Limits

- One import reads up to **{{fact:importMaxFiles}} files**; files past that
  are left out. It makes up to **{{fact:importMaxClusters}} clusters**, and
  folders past that many, or nested more than **{{fact:importMaxDepth}}
  levels** deep, are merged into the cluster above rather than left out.
- A folder with more than **{{fact:importClusterFileCeiling}} files** is split
  into several clusters.
- A compressed file inside a zip is unpacked in the browser, up to
  **{{fact:importZipUnpackMax}}** a file — **{{fact:importZipUnpackLowMemory}}**
  on an iPhone, an iPad or another device with little memory. A bigger one is
  listed as too large to unpack; unzip it on your computer and drop the folder.
- The things a computer keeps in folders that are not yours to look at —
  `.DS_Store`, hidden files, app and project bundles such as a `.logicx`
  session or a Photos library — are left out, and so are files iCloud has not
  downloaded yet.

## Adding a cluster inside one

- **+ New cluster**, after the cluster's name at the top of the window — name
  it and press Enter. With nothing picked it goes beside what is already on
  the canvas and opens; with cards picked, they move into it and you stay
  where you are, with an undo
- The **Cluster** tool (the folder) on the left rail, or `C` — then click where
  it goes
- Double-click or right-click empty canvas → **Cluster** (or **Add → Cluster**),
  under your cursor
- On a phone, **New cluster** at the top of the sheet the **+** opens

There is no limit on how many clusters you make, and they cost none of your
[cards](/docs/canvas/cards): a cluster's card on its parent's canvas is free on
every plan. Only what is inside it counts toward the free Demo plan's
{{fact:demoCardLimit}}. A [linked cluster](#nesting) — a reference to a
cluster that lives elsewhere — counts as a card like any other.

## Making a cluster from cards you already have

Cards that belong together can move into a cluster of their own in one step,
and one undo puts them back and removes the cluster:

- Pick two or more cards, right-click → **New cluster from N cards**
- Right-click a card → **Move to cluster…** → **New cluster…** — there even when
  this is your only cluster
- Right-click a [group](/docs/canvas/groups) → **Turn into cluster…** — the
  group moves in whole, and the cluster takes its name
- In [Files](/docs/clusters/list-view), pick files and press **New cluster** on
  the selection bar

When Studio has gathered a pile of loose cards, it offers once, on a later
visit, to move them into a cluster: **Move them into a cluster** names one and
moves the pile; the × dismisses the offer for good on that device. And when
you paste or drop new things onto a board that already holds a pile from a few
hours ago, the toast may ask **New idea?** — **New cluster** gives them a cluster
of their own. Nothing moves until you ask.

## Nesting

A cluster inside a cluster appears as a card on the parent's canvas that opens
into its own canvas. There is no depth limit.

This is how structure emerges without anybody designing it: a film becomes
scenes, a scene becomes setups, a setup becomes a reference wall — each a real
board you can open, share and work on independently.

**Moving** a cluster: drag it in the sidebar tree (on a touch screen, hold the
row first — a swipe scrolls the list), drag it onto another
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

- **[Board](/docs/canvas)** — the infinite canvas, where position means something
- **[Files](/docs/clusters/list-view)** — a sortable, searchable file browser, as a grid or a list

A cluster's files are always listed in the [sidebar](/docs/clusters/sidebar); press `F`, or ⤢ there, to fill the screen with them. Switching
does not convert anything. Settings → **Card defaults** sets which view new
clusters open in.

## Finding clusters

- **[Home](/docs/clusters/home-graph)** lists your projects, newest work first,
  with the clusters you were last in under **Jump back in**
- **The [sidebar](/docs/clusters/sidebar) tree** opens on your projects, most recently worked on first,
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
