---
title: Tags and Entities — Soleil Clusters
metaDescription: Tag anything in Soleil Clusters — cards, groups, boards and passages of text. Entity types, automatic tagging, AI suggestions and emergent themes.
h1: Tags and entities
navLabel: Tags
section: organize
order: 0
updated: 2026-08-08
answer: A tag cuts across everything — apply one to a card, a group, a whole cluster or a passage of text, and the tag's detail view gathers every one of them from anywhere in the workspace. Tags can be typed as entities like character, setting, organization, concept or thing, and the app suggests tags automatically without ever applying one on its own.
faq:
  - q: Do tags move things?
    a: No. A tag is not a location. The same card can carry several tags and stays exactly where it is.
  - q: Does the AI tagger tag things without asking?
    a: No. It only ever suggests. Nothing is tagged until you accept a suggestion.
  - q: What is an entity type?
    a: A tag can be typed as a character, setting, organization, concept or thing. Typed tags get an appropriate colour and behaviour, and are what make hover previews and backlinks useful.
related:
  - /docs/organize/links-and-mentions
  - /docs/documents/comments-and-tags
  - /docs/organize/search
---

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
reference wall, a schedule entry and a message thread, and no folder structure
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

Two layers, neither of which applies a tag on its own.

**The matcher** recognises names you have already used. Write "Diner" in a note
after creating a Diner tag, and it is detected and offered.

**The AI tagger** goes further, suggesting tags for content it has not seen a
name for — including from image content. It is **on by default** and can be
switched off.

In both cases suggestion is the whole behaviour. Nothing is tagged until you
accept it. A workspace silently filling with tags nobody chose would be worse
than no tagging at all.

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
