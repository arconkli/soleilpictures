# Tags and entities

> A tag cuts across everything — put one on a card, a whole cluster or a passage of a document, and the tag's page gathers all of them from anywhere in the workspace. Tags can be typed as a character, setting, organization, topic or thing. A tag is applied on its own only where its exact name appears; beyond that the AI suggests tags and underlines clear mentions in documents, everything it does is marked auto, and the workspace owner can turn it off.

_Source: https://clusters.soleilpictures.com/docs/organize/tags · Updated 2026-10-25_

Tags are the cross-cutting layer. Clusters give you hierarchy; tags give you
everything that does not fit a hierarchy.

## Tagging

- A **[card](/docs/canvas/cards)** — right-click it and choose **Tag…**. The
  picker suggests as you type, and `Enter` creates a tag that does not exist
  yet.
- A **[group](/docs/canvas/groups)**, as a unit — right-click its label and
  choose **Tag group…**.
- A whole **[cluster](/docs/clusters)** — right-click an empty part of it and
  choose **Tag this cluster…**, or drag a tag from the sidebar onto it.
- A **passage of text** — in a [document](/docs/documents/comments-and-tags),
  select the words, right-click and choose **Tag selection…**; a name the app
  has noticed can also become a tag right where it appears.

An item can carry several tags. A tag is **not a location**. Tagging moves
nothing.

## The tag page

Open a tag from the sidebar, from a tag chip, or from its hover card, and you
get everything carrying it, from anywhere in the workspace — clusters, then
groups, then cards — and the document pages it is on. A tagged group or
cluster shows what is inside it. Its header counts both: "12 tagged · 40
inside" is twelve things carrying the tag (the number the sidebar shows) and
forty more inside the tagged clusters and groups.

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
| **Topic** | Themes, ideas, looks |
| **Thing** | Objects, props, assets |

The type shows on a tag's hover card and its page, the sidebar groups tags by
it, and it drives the hover previews and backlinks in
[links and mentions](/docs/organize/links-and-mentions).

## Automatic tagging

Automatic tagging works from **text** — card titles, notes, documents, and the
names of groups and clusters. It never looks at what an image shows, and it
only uses tags you have already made, so a workspace with no tags gets none.

- **An exact name match is applied**, marked *auto*. Make a Diner tag, and a
  note that mentions the diner picks it up, as does a group called "Diner
  stills". Creating a tag applies it straight away to what already says its
  name.
- **In documents, clear mentions are underlined**, marked *auto*: the AI
  underlines words that clearly refer to one of your tags, even when they are
  not its exact name.
- **Anything looser is only suggested.** The AI compares what a card says with
  your tags, and a close one waits on the tag's page until you accept or
  dismiss it.

The AI reads up to 2,000,000 characters per account a day,
counting the instructions sent along with your text, more than a normal day's
work needs. Past that, it pauses until the next day.

The owner or a co-owner can turn **AI suggestions** off in **Settings →
Workspace**. Then no card or document text goes to a model: there are no
suggestions or underlines, and exact-name matches and the tags you add work as
before.

Nothing applied automatically is hidden. Open the tag, press **Manage** and
filter to **Auto** to see everything it picked up on its own. Right-click any
item for **Confirm tag** or **Remove tag** — removing also keeps that tag off
that item for good, so it is never applied there again. In a document, removing
a tag keeps it off that page.

## Removing, deleting and merging — all reversible

Removing a tag from one item shows an undo toast; undoing also lifts the
"don't suggest this again" that a removal writes, so the matcher behaves as
if the removal never happened.

Deleting a tag removes it everywhere, but softly: the tag and every one of
its applications stay recoverable for **30 days** — from the undo toast, or
by recreating a tag with the same name, which revives the old one intact.

Merging one tag into another can also be undone from its toast: applications
move back, and the merged-away tag returns. Anything you had taken the merged
tag off stays off under the tag it merged into.

## Finding by tag

- The **sidebar** lists workspace tags, grouped by type; the arrow keys walk
  them and `Enter` opens one
- **[`⌘K`](/docs/organize/search)** finds tags by name, and `#` with a tag's
  name lists everything carrying it
- The **tag page** is the full browse

Scripts and AI assistants read and apply tags the same way, through the
[Tags API](/docs/api/tags) and the [MCP server](/docs/mcp).
