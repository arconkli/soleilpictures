# Tags and entities

> A tag cuts across everything — apply one to a card, a group, a whole cluster or a passage of text, and the tag's detail view gathers every one of them from anywhere in the workspace. Tags can be typed as entities like character, setting, organization, concept or thing. Automatic tagging reads text, never pictures, and marks what it applies as auto until you confirm it.

_Source: https://clusters.soleilpictures.com/docs/organize/tags · Updated 2026-10-02_

Tags are the cross-cutting layer. Clusters give you hierarchy; tags give you
everything that does not fit a hierarchy.

## Tagging

Right-click almost anything → tag. You can tag:

- A **[card](/docs/canvas/cards)**
- A **[group](/docs/canvas/groups)** — as a unit, not card by card
- A whole **[cluster](/docs/clusters)**
- A **passage of text** in a [document](/docs/documents/comments-and-tags)

The picker suggests as you type, and `Enter` creates a tag that does not exist
yet. Multi-select is supported — most things carry more than one.

A tag is **not a location**. Tagging moves nothing.

## The tag detail view

Open a tag from the sidebar and you get everything carrying it, from anywhere in
the workspace, arranged hierarchically — boards, then groups, then cards.

This is the payoff. "Show me everything about the diner" spans a script scene, a
reference wall, a group of location photos and a note, and no folder structure
could have anticipated that grouping.

## Entity types

A tag can be typed:

| Type | For |
|---|---|
| **Character** | People in the work |
| **Setting** | Locations |
| **Organization** | Companies, departments, crews |
| **Concept** | Themes, ideas, looks |
| **Thing** | Objects, props, assets |

Typed tags get an appropriate colour and drive the hover previews and backlinks
in [links and mentions](/docs/organize/links-and-mentions).

## Automatic tagging

Automatic tagging works from **text** — card titles, notes, and the names of
groups and clusters. It never looks at what an image shows, and it only uses
tags you have already made, so a workspace with no tags gets none.

- **A close match is applied**, marked *auto*. Make a Diner tag, and a note about
  the diner can pick it up on its own.
- **A looser match is only suggested.** It waits on the tag until you accept or
  dismiss it.

Nothing applied automatically is hidden. Open the tag and switch its filter to
**Auto** to see everything it picked up on its own; right-click any item to
**confirm** it, **remove** it, or choose **Don't suggest again**, which keeps
that tag off that item for good.

## Emergent themes

Beyond individual suggestions, the app looks for clusters of related content and
proposes a name for the theme it found — material that clearly belongs together
but that nobody had a word for yet.

Accepting one creates the tag and applies it to the group that suggested it.

## Propagation and backfill

Creating a tag offers to apply it to existing content that matches, so a tag
created late is not empty.

A tag applied to a [group](/docs/canvas/groups) propagates to what is in it,
and in documents a tag on a paragraph can cascade to related passages.

## Removing, deleting and merging — all reversible

Removing a tag from one item shows an undo toast; undoing also lifts the
"don't suggest this again" that a removal writes, so the matcher behaves as
if the removal never happened.

Deleting a tag removes it everywhere, but softly: the tag and every one of
its applications stay recoverable for **30 days** — from the undo toast, or
by recreating a tag with the same name, which revives the old one intact.

Merging one tag into another can also be undone from its toast: applications
move back, and the merged-away tag returns.

## Finding by tag

- The **sidebar** lists workspace tags
- **[`⌘K`](/docs/organize/search)** searches tags alongside everything else
- The **tag detail view** is the full hierarchical browse
