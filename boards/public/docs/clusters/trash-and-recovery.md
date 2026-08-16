# Trash and recovery

> Deleting a cluster is a soft delete — it sits in the trash for 30 days and can be restored. Individual boards keep version snapshots you can look through and roll back to. If something goes badly wrong, workspace recovery rewinds every board in the workspace to a chosen moment, with a preview of exactly what would change before anything happens.

_Source: https://clusters.soleilpictures.com/docs/clusters/trash-and-recovery · Updated 2026-08-08_

Four layers, from smallest mistake to worst day.

## Undo

`⌘Z`. Per-session and per-board, covering your own edits.

It deliberately does **not** revert a collaborator's changes. In a shared board,
an undo that silently reversed someone else's work would be worse than no undo.
Deletions also show a toast with an undo button — and the toast only ever
undoes its own deletion: if you have done something else since, it says so
instead of reverting the wrong thing.

Documents have their own two histories: `⌘Z` while typing undoes text, and
`⌘Z` with the document open (but not typing) undoes structure — page deletes,
moves, renames. Deleting a page, its sub-pages and their comments is a single
undo step. Note text keeps its undo history even after you close and reopen
the note.

## Trash

Deleting a cluster is a **soft delete**. It goes to the workspace trash and
stays restorable for **30 days**, then is purged.

The trash is workspace-wide — open it from the sidebar or `⌘K` → "trash". From
there, **restore** puts a cluster back where it was, or **remove permanently**
if you are sure.

## Version history

Boards keep snapshots over time. You can list them, look through them, and roll
back to one. Open it from the clock icon in the toolbar, or `⌘K` → "Version
history".

Snapshots are written automatically while you work, before risky operations
(bulk deletes, pastes, cross-cluster drags), and before anything the API or an
AI agent deletes or moves — so an integration's mistake is recoverable from
the same list as a human one. Rows are grouped by work session; selecting one
previews what it contains before you commit.

Restoring always snapshots the **current** state first, so a restore is itself
restorable. A second tab lists name, colour, cover, view and shoot-day date
changes, each with a one-click revert — reverting a published day's date goes
through the same path as moving it, so the crew is notified.

This is the tool for "the board was right yesterday and is wrong now", including
when the change was someone else's.

## Workspace recovery

The heavy one, for when something has gone wrong across many boards at once — a
bad bulk operation, or an integration that misbehaved.

1. Pick a **target moment**
2. Review the **impact preview** — every board that would change, and how
3. Confirm

The preview step is the point. A rewind is atomic across the workspace, so
seeing exactly what it would do before it does it is not optional.

Open it from an alert banner, or from the workspace menu.

## Anomaly alerts

An unusual number of deletions in a short window raises an alert banner in the
workspace, unacknowledged until someone looks at it. The alert links straight
into recovery with that moment pre-selected as the target.

This exists because the failure mode that actually hurts is not a single wrong
delete — it is a bulk deletion nobody notices for three weeks, by which point
the 30-day trash window is closing.

## Files

Deleting a card does not immediately destroy the underlying file. Files remain
protected while any board still references them, and become eligible for
cleanup only after nothing does. Restoring a board within the trash window
restores its images intact.

See [Data and privacy](/docs/account/data-and-privacy) for retention and
deletion in full.
