# Core concepts

> Soleil Clusters has four nested ideas. A workspace holds your clusters. A cluster is a board, which holds cards and can hold other clusters without limit. A card is a single thing on that board — an image, a note, a document, a file. Every cluster can be viewed as an infinite canvas or as a file list, and both views show the same contents.

_Source: https://clusters.soleilpictures.com/docs/concepts · Updated 2026-08-08_

Four ideas, nested inside each other. Once these are straight, the rest of the
product is discoverable.

## Workspace

A workspace is the outermost container. It holds clusters and it holds people.

Your personal workspace is created for you automatically — the first time you
sign in, and also the first time you create a board through the API without
naming a workspace. You never have to set one up.

You can belong to more than one workspace. The switcher at the top of the
sidebar moves between them, and separates ones you own from ones shared with
you.

## Cluster (board)

A cluster is the unit of work: a moodboard, a scene, a project, a shot list.

The interface calls it a **cluster**. The API, the database and the developer
pages in these docs call the same object a **board**. This is a naming change
that landed in the product before it landed in the code, and rather than pretend
otherwise, both words appear here — `cluster` when describing the interface,
`board` when describing an API payload.

Clusters nest without limit. A cluster inside a cluster is just a card on the
parent's canvas that happens to open into its own canvas. This is how a project
becomes a folder tree without anybody deciding to build a folder tree.

> **Note:** Nesting is cycle-safe. Dragging a cluster into one of its own
> descendants is refused rather than silently creating a loop.

## Card

A card is one thing on a board. Images, notes, links, documents, PDFs, video,
audio, colour palettes, shapes, grids, schedules, votes, and other clusters are
all cards.

Cards carry a position, a size and a stacking order, which is what makes the
canvas a canvas rather than a list. Everything else about a card depends on
what kind it is — see [Cards](/docs/canvas/cards).

The free Demo plan allows **50 cards** in total across every
cluster you create. Clusters themselves are unlimited, and so are collaborators.

## Two views of the same cluster

Every cluster has two views, and they are not two places:

- **Canvas** — the infinite surface. Position matters. This is where you arrange, connect, draw and compare.
- **List** — the same contents as a sortable, searchable file browser with table and gallery modes. This is where you find a specific thing.

Switching views does not move or convert anything. A cluster is one set of
contents with two ways to look at it, which is why the product describes every
cluster as also being a drive.

## What is not a container

Two things look like containers and are not:

**Groups** are a selection on a canvas given a name and an outline. They travel
together and can be commented on and tagged as a unit, but they do not have
their own inside — the cards remain cards on the same board.

**Tags** cut across everything. A tag is not a location; the same card can carry
several, and a tag's detail view gathers every board, group and card that
carries it from anywhere in the workspace.
