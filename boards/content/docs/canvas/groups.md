---
title: Groups — Soleil Clusters
metaDescription: Group cards on a Soleil Clusters canvas. Named, outlined selections that move as one and can be commented on, tagged and coloured as a unit.
h1: Groups
navLabel: Groups
section: canvas
order: 6
updated: 2026-08-08
answer: Select several cards and press Cmd-G to make a group. A group has a name and a visible outline, moves as one object, and can be commented on and tagged as a unit. It is not a container — the cards stay on the same board, they are just marked as belonging together.
faq:
  - q: Is a group the same as a nested cluster?
    a: No. A group is a labelled selection on the same canvas — the cards never leave. A nested cluster is a separate board that opens into its own canvas. Use a group to say "these belong together", a cluster to say "this is its own thing".
  - q: Can a card be in two groups?
    a: No. A card belongs to at most one group. Overlapping membership made selection ambiguous in every case we tried.
  - q: What happens to the cards if I ungroup?
    a: Nothing. They stay exactly where they are and keep everything else about them. Only the grouping is removed.
related:
  - /docs/canvas/cards
  - /docs/collaborate/comments
  - /docs/organize/tags
---

A group says "these belong together" without moving anything anywhere.

Select several cards and press `⌘G`. You get a named, outlined region that
travels as one object.

## Groups are not containers

This is the distinction worth being clear about:

- A **group** marks cards on the current canvas as related. They remain cards on that canvas.
- A **nested [cluster](/docs/clusters)** is a different board. Its contents are somewhere else and you open into them.

Use a group for the four frames that make up one beat. Use a nested cluster for
a whole scene that deserves its own surface.

## What a group has

**A name.** Shown on the outline. Searchable in `⌘K`.

**An outline** whose shape and colour you set from the right-click menu — useful
for colour-coding sections of a big board at a glance.

**Group operations**, all in the right-click menu:

| Action | Effect |
|---|---|
| Rename | Change the label |
| Outline shape / colour | Restyle the boundary |
| Add to group | Pull another card in |
| Ungroup | Remove the grouping; cards stay put |
| Group comment | A [comment](/docs/collaborate/comments) anchored to the whole group |
| Group tag | A [tag](/docs/organize/tags) applied to the group as a unit |
| Group info | What is inside it |

## Moving and selecting

Dragging any member moves the whole group. To move one card out, drag it clear
of the outline — it leaves the group.

Clicking selects the group. Click again on a specific card to select just that
card inside it.

## Comments and tags on a group

Both attach to the group rather than to any one card. A comment on a group reads
as being about the set — "this sequence runs long" — which is usually what
someone reviewing a board wants to say.

A tag on a group means the [tag's detail view](/docs/organize/tags) lists the
group as a unit, rather than listing eight cards individually.

## When the canvas gets crowded

Grouping is the main tool for keeping a large board readable. The app notices
when a board's root canvas is getting crowded and will suggest it once — that
prompt is the [power reveal](/docs/canvas) for groups, and it appears a single
time, ever.
