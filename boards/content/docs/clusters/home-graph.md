---
title: Home Graph — Soleil Clusters
metaDescription: The Home view in Soleil Clusters shows your whole workspace as a 3D relationship graph of clusters, documents, cards and links you can fly through.
h1: Home graph
navLabel: Home graph
section: clusters
order: 2
updated: 2026-08-08
answer: Home shows your workspace as a relationship graph rather than a list — clusters, documents, cards and URLs as connected nodes you can orbit and fly through. Hover a node to preview it, right-click to open, and use the detail drawer for what connects to what. A 2D view is used automatically where 3D would not perform.
faq:
  - q: What do the connections represent?
    a: Real relationships — nesting, links between documents, mentions, and shared URLs. The graph is derived from your content, not arranged by hand.
  - q: Is this just decorative?
    a: It is genuinely useful on a large workspace, where a tree hides the fact that two projects reference the same material. On a small workspace the sidebar is faster.
  - q: What if 3D is slow on my machine?
    a: A 2D fallback renders automatically. The graph and its interactions are the same.
related:
  - /docs/clusters
  - /docs/organize/links-and-mentions
  - /docs/organize/search
---

**Home** is the workspace seen as a graph: every cluster, document, card and URL
as a node, with edges for the relationships between them.

## Why a graph

A sidebar tree shows containment and nothing else. It cannot show that two
unrelated projects both reference the same location, or that one document is
mentioned from six places.

The graph shows those. On a workspace with real history it surfaces connections
you did not know were there.

On a small workspace, the sidebar is faster and there is no shame in using it.

## Moving around

Orbit, zoom and fly through with the mouse or trackpad. Nodes cluster by
relatedness, so things that belong together end up near each other without being
arranged.

- **Hover** a node to preview it — the underlying board also starts loading, so opening it is instant
- **Right-click** to open
- **Detail drawer** shows what a node connects to, and why

The HUD filters what is shown by type, which matters once the graph is dense.

## What the edges mean

Edges are derived from your content, not drawn by hand:

- **Nesting** — a cluster inside a cluster
- **[Links and mentions](/docs/organize/links-and-mentions)** — an `@` mention, a document linking to a board
- **Shared URLs** — two boards referencing the same external page
- **Documents** and the boards they are embedded in

## 2D fallback

The 3D view needs a capable GPU. Where that is not available — some laptops,
most tablets — a 2D graph renders instead automatically, with the same nodes,
edges and interactions.

## Performance

The graph is a heavy piece of code and is loaded only when you open Home, so it
costs nothing on any other screen.

## When to use something else

- Looking for one specific thing you can name — [`⌘K`](/docs/organize/search)
- Browsing the contents of one cluster — [list view](/docs/clusters/list-view)
- Finding everything on a theme — [tags](/docs/organize/tags)
