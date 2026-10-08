# Home

> Home shows your clusters — the ones you were last in, every cluster at the top of your workspace newest first, and New cluster — under the workspace they belong to; the top of the panel switches workspaces or starts a new one. It floats over your workspace drawn as a 3D relationship graph. The graph stays visible and usable around the panel; Explore universe puts the panel away so you can fly through it, and Clusters brings it back.

_Source: https://clusters.soleilpictures.com/docs/clusters/home-graph · Updated 2026-10-07_

**Home** is where your projects are. Open it from **Home** in the sidebar or the
**Clusters** logo in the top bar.

## Your workspace

The top of the panel names the workspace these projects belong to, and whether
it is your personal one, another of yours, or shared with you. Click it to
switch to any workspace you are in: Home stays open and shows that workspace's
projects. In the list, a workspace you own has a ⋯ menu with **Rename & icon…**
and **Delete workspace** — your personal workspace can be renamed but never
deleted — and one shared with you has **Leave workspace**. **New workspace**
beside the name starts a fresh one, with its own Studio, and opens it on Home.
In an account's first 72 hours it can own up to
4 workspaces; the limit lifts after that.

The same switcher sits at the top of the sidebar. Switching from there takes
you straight to the workspace's canvas instead.

## Your clusters

A panel shows three things:

- **Jump back in** — the clusters you were last in on this device, and when
  there are none, the ones you worked on most recently anywhere
- **Your clusters** — **Studio** and every cluster at the top of your workspace,
  newest work first, each with its thumbnail
- **New cluster** — type a name (or don't) and press Enter. The cluster is
  created at the top of your workspace and opens, ready for you to paste or drag
  images in

## The graph behind it

Behind the panel is the workspace seen as a graph: every cluster, document, card
and URL as a node, with edges for the relationships between them. It stays
visible and usable around the panel. **Explore universe** puts the panel away so
the whole graph is yours; **Clusters** brings the panel back.

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
- Browsing the contents of one cluster — [Files](/docs/clusters/list-view)
- Finding everything on a theme — [tags](/docs/organize/tags)
