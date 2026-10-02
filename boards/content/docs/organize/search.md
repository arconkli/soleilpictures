---
title: Search and the Command Palette — Soleil Clusters
metaDescription: Cmd-K in Soleil Clusters searches clusters, cards, notes, docs and tags, and runs commands — share, invite, trash, theme, settings — from the keyboard.
h1: Search and the command palette
navLabel: Search
section: organize
order: 2
updated: 2026-10-02
answer: Press Cmd-K or forward slash to open the command palette. It searches cluster names, card titles and text, notes, document titles and tags, and it also runs commands — create a cluster, share this one, open messages, toggle the theme, open trash, sign out. It is the fastest route to almost anything in the app.
faq:
  - q: Does search look inside my notes and documents?
    a: Partly. The palette reads a card's title and the first {{fact:searchBodyChars}} characters of its text, so a short note is searched in full and a long one by its opening. A document is found by its title; the text on its pages is not searched from the palette, so inside a long document use Cmd-F instead.
  - q: Can I run actions from it?
    a: Yes. Type what you want to do rather than what you want to find. "share", "invite", "trash", "theme", "billing" all work.
  - q: Is there a shortcut other than Cmd-K?
    a: Forward slash opens it too, when you are not typing into something.
related:
  - /docs/keyboard-shortcuts
  - /docs/organize/tags
  - /docs/clusters/list-view
---

`⌘K`, or `/` when you are not typing into something.

## What it searches

- **Recents** — what you have had open
- **Clusters** — by name
- **Cards and notes** — by title, and by the first {{fact:searchBodyChars}} characters of their text
- **Files** — by the name the file was uploaded with, so a photo nobody captioned
  is found as `diner_ext_dusk_04.jpg` (photos and videos uploaded since names
  were kept; audio, PDFs and attachments always had theirs)
- **Tags**
- **Docs** — by title

The text on a document's pages is not searched from here. Inside a document,
`⌘F` finds it.

Results are grouped by kind, so a query matching a board and a note shows you
both, labelled.

## What it does

The palette also runs commands. Type the verb rather than the noun:

| Command | Effect |
|---|---|
| New project | A new cluster at the top of your workspace, opened |
| New note | A note on the current board |
| Go to Home | [Your projects](/docs/clusters/home-graph), over the relationship graph |
| Link a cluster onto canvas | Place a reference to another board |
| Open split view | [Two boards side by side](/docs/clusters#side-by-side) |
| Share this cluster | The [share dialog](/docs/collaborate/sharing) |
| Messages | The [messages drawer](/docs/collaborate/messages) |
| Toggle theme | Light / dark |
| Toggle sidebar | |
| Open trash | [Deleted clusters](/docs/clusters/trash-and-recovery) |
| Open settings | |
| Account and billing | [Plans](/docs/account/plans) |
| Invite friends | [Referrals](/docs/account/referrals) |
| Sign out | |

## Pickers

The same interface is reused wherever the app needs you to choose something — a
board to link, a destination to move to, a document to embed. If you know how to
use `⌘K`, you already know how to use those.

## When to use something else

- Browsing one cluster's contents by type, size or date — [list view](/docs/clusters/list-view)
- Everything on a theme, across the workspace — [tags](/docs/organize/tags)
- Seeing how things relate rather than finding one — [Home graph](/docs/clusters/home-graph)
- Inside one long document — `⌘F` [find and replace](/docs/documents)
