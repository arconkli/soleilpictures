---
title: Presence and Live Collaboration — Soleil Clusters
metaDescription: See collaborators' cursors, selections and location in real time across Soleil Clusters. Workspace facepile, click to jump to someone, presence colours.
h1: Presence
navLabel: Presence
section: collaborate
order: 2
updated: 2026-08-08
answer: When several people are in a cluster you see each other's cursors, selections and text carets live. A facepile shows who is on the current board, and a workspace facepile shows who is anywhere in the workspace — clicking someone jumps you to whatever board they are on. Everyone has a stable colour that stays the same across sessions.
faq:
  - q: Can I see what someone is looking at without asking?
    a: Yes. Click their avatar in the workspace facepile and you jump to the board they are on.
  - q: Do presence colours change?
    a: No. Each person keeps a stable colour, and you can set your own in Settings under Profile.
  - q: What happens when a lot of people are on one board?
    a: Cursors are capped and culled so a busy board stays readable and fast rather than filling with labels.
related:
  - /docs/collaborate
  - /docs/collaborate/messages
  - /docs/account/settings
---

Presence answers "who else is here and what are they doing" without anyone
having to say.

## On a board

- **Live cursors**, each labelled with a name
- **Selection halos** — what someone has selected is outlined in their colour
- **Text carets** inside [notes](/docs/canvas/notes) and [documents](/docs/documents), so you can see where someone is typing before the words appear
- **A facepile** in the header, with the full roster on click

## Across the workspace

A second facepile shows everyone active anywhere in the workspace, not just on
your board.

**Click someone to jump to them** — you land on whatever board they are on. On a
call, this replaces "which board are you on, send me the link".

## Colours

Each person has a stable presence colour. It does not change between sessions,
so a colour becomes a person you recognise.

Set your own in **Settings → Profile**.

## At scale

On a busy board, cursors are capped and culled rather than all rendered — a
board with twenty people on it stays readable and stays fast.

Connections survive reconnects and token rotation, so a laptop lid closing and
reopening does not drop you out and duplicate you in the roster.

## What is real time

Effectively everything:

| Surface | Live |
|---|---|
| Moving, resizing, adding, deleting cards | ✓ |
| Typing in a [note](/docs/canvas/notes) | ✓, with carets |
| Writing in a [document](/docs/documents) | ✓, with carets |
| [Comments](/docs/collaborate/comments) and [votes](/docs/canvas/vote-cards) | ✓ |
| [List view](/docs/clusters/list-view) selections | ✓ |
| [Messages](/docs/collaborate/messages) | ✓ |

Concurrent edits merge. There is no locking and no last-write-wins overwrite —
two people editing the same note produce a note containing both edits.

## Working offline

Changes made while briefly disconnected are reconciled on reconnect. The status
in the header reports what has actually saved rather than assuming.
