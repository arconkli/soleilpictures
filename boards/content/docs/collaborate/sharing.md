---
title: Sharing and Public Links — Soleil Clusters
metaDescription: Share a Soleil Clusters board with a view-only public link that needs no account, set an expiry, include sub-clusters, or invite editors by email.
h1: Sharing and public links
navLabel: Sharing
section: collaborate
order: 1
updated: 2026-08-08
answer: A public link makes a cluster viewable by anyone with the URL, with no account and no sign-in. Links are always view-only, can be set to expire after 7 or 30 days, can include or exclude nested clusters, and can be marked as not indexable by search engines. Inviting by email is separate and is how you grant edit access.
faq:
  - q: Does someone need an account to open a shared link?
    a: No. A public link opens the board read-only for anyone, with no sign-in.
  - q: Can a public link be edited by whoever has it?
    a: Never. Public links are always view-only. Edit access is granted only by inviting a specific person or using a role-bearing invite link.
  - q: Will a shared board show up in Google?
    a: Only if you allow indexing, or publish it to Explore. By default shared boards carry a noindex instruction.
related:
  - /docs/collaborate
  - /docs/publish/explore
  - /docs/canvas/export
---

Two different mechanisms live behind the **Share** button, and mixing them up is
the main thing to avoid. The dialog leads with inviting people, because that is
the one that puts someone *inside* the cluster with you; the view-only link
follows it.

You can open it from the board header, from `⌘K` → "Share this cluster", or by
right-clicking any cluster in the sidebar and choosing **Share…** — the last of
these shares the cluster you right-clicked, not the one currently on screen.

## Public links — view only, no account

A public link is a URL anyone can open. No account, no sign-in, no request for
access. It is always **read-only**.

Options when you create one:

| Option | Choices |
|---|---|
| **Expiry** | Never · 7 days · 30 days |
| **Include sub-clusters** | Whether [nested clusters](/docs/clusters) can be opened too |
| **Allow indexing** | Whether search engines may index it — off by default |

With sub-clusters included, viewers can navigate into nested boards with
breadcrumbs. With it off, the link shows exactly one board.

Links can be **revoked** at any time from the same dialog.

> **Note:** By default a shared board tells search engines not to index it. It
> is reachable by anyone with the URL, but it will not turn up in a search
> unless you allow indexing or [publish it to Explore](/docs/publish/explore).

The board renders in a real canvas — viewers pan, zoom and open images at full
size. It is not a flattened image.

On a phone, a large board opens framed on its top-left corner at a size you can
actually read, rather than fitting the whole thing into an unreadable speck.
Pinch out to see everything; nothing is hidden, only the starting view differs.
Boards small enough to fit legibly still open showing all of themselves.

## Inviting people — this is how editing is granted

Separate from public links, and the only way anyone gets edit access.

- **By email** — name a person and a role of editor or viewer.
- **By invite link** — a URL carrying a role. Whoever opens it confirms and gets that access. Use when you do not have addresses.

Editors are **free on every plan**. See [Collaborating](/docs/collaborate).

## Quick copy

The board header has a one-click **copy view-only link** for the common case.
Boards you are viewing without edit rights show a clear VIEW ONLY badge, so
there is never ambiguity about whether your changes will stick.

## Link previews

A shared link unfurls properly in Slack, Messages and email — the board's own
name and a thumbnail of its actual contents, not a generic logo.

## Publishing instead

To make a board genuinely public and discoverable — listed in the directory and
indexable — see [Explore](/docs/publish/explore). That is a separate, reviewed
step, not something a share link does by accident.

## Sharing a file instead of a link

If the recipient needs a file rather than a live view, see
[Exporting a board](/docs/canvas/export). A link is usually better: it does not
go stale.
