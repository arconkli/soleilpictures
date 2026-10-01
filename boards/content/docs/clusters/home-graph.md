---
title: Home — Your Projects and Workspace Graph — Soleil Clusters
metaDescription: Home in Soleil Clusters shows your projects — where you left off, every project newest first, New project — over a 3D graph of your workspace.
h1: Home
navLabel: Home
section: clusters
order: 2
updated: 2026-10-01
answer: Home shows your projects — the clusters you were last in, every project newest first, and New project — on a panel floating over your workspace drawn as a 3D relationship graph. The graph stays visible and usable around the panel; Explore universe puts the panel away so you can fly through it, and Projects brings it back.
faq:
  - q: What is a project here?
    a: A cluster at the top of your workspace, beside Studio. New project on Home, the + next to Clusters in the sidebar, and ⌘K → "new project" all create one at the top and open it.
  - q: How do I see the whole graph?
    a: Press Explore universe on the panel. The panel slides away and the graph is yours to orbit and fly through; Projects brings the panel back. Clusters remembers which one you left on, per device.
  - q: What do the connections in the graph represent?
    a: Real relationships — nesting, links between documents, mentions, and shared URLs. The graph is derived from your content, not arranged by hand.
  - q: What if 3D is slow on my machine?
    a: A 2D fallback renders automatically. The graph and its interactions are the same. On a phone, Home shows the projects panel on its own.
related:
  - /docs/clusters
  - /docs/organize/links-and-mentions
  - /docs/organize/search
---

**Home** is where your projects are. Open it from **Home** in the sidebar or the
**Clusters** logo in the top bar.

## Your projects

A panel shows three things:

- **Jump back in** — the clusters you were last in on this device, and when
  there are none, the ones you worked on most recently anywhere
- **Your projects** — **Studio** and every cluster at the top of your workspace,
  newest work first, each with its thumbnail
- **New project** — type a name (or don't) and press Enter. The project is
  created at the top of your workspace and opens, ready for you to paste or drag
  images in

## The graph behind it

Behind the panel is the workspace seen as a graph: every cluster, document, card
and URL as a node, with edges for the relationships between them. It stays
visible and usable around the panel. **Explore universe** puts the panel away so
the whole graph is yours; **Projects** brings the panel back.

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
costs nothing on any other screen. The projects panel does not wait for it. On a
phone, Home is the panel alone, and the graph is never loaded.

## When to use something else

- Looking for one specific thing you can name — [`⌘K`](/docs/organize/search)
- Browsing the contents of one cluster — [list view](/docs/clusters/list-view)
- Finding everything on a theme — [tags](/docs/organize/tags)
