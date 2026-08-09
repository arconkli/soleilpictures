---
title: Trash, Versions and Recovery — Soleil Clusters
metaDescription: Restore deleted clusters from a 30-day trash, roll a board back through version history, or rewind an entire workspace to a point in time.
h1: Trash and recovery
navLabel: Trash and recovery
section: clusters
order: 3
updated: 2026-08-08
answer: Deleting a cluster is a soft delete — it sits in the trash for 30 days and can be restored. Individual boards keep version snapshots you can look through and roll back to. If something goes badly wrong, workspace recovery rewinds every board in the workspace to a chosen moment, with a preview of exactly what would change before anything happens.
faq:
  - q: How long do I have to restore a deleted cluster?
    a: 30 days. After that it is purged permanently.
  - q: Can I undo a collaborator's changes?
    a: Cmd-Z only undoes your own edits. To reverse someone else's work, use version history on that board or workspace recovery.
  - q: What is the alert banner about?
    a: An unusual number of deletions in a short window raises an alert. It is there so a mass deletion gets noticed the same day rather than three weeks later.
related:
  - /docs/clusters
  - /docs/collaborate
  - /docs/account/data-and-privacy
---

Four layers, from smallest mistake to worst day.

## Undo

`⌘Z`. Per-session and per-board, covering your own edits.

It deliberately does **not** revert a collaborator's changes. In a shared board,
an undo that silently reversed someone else's work would be worse than no undo.
Deletions also show a toast with an undo button.

## Trash

Deleting a cluster is a **soft delete**. It goes to the workspace trash and
stays restorable for **30 days**, then is purged.

The trash is workspace-wide — open it from the sidebar or `⌘K` → "trash". From
there, **restore** puts a cluster back where it was, or **remove permanently**
if you are sure.

## Version history

Boards keep snapshots over time. You can list them, look through them, and roll
back to one.

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
