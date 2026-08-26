---
title: Data, Retention and Privacy — Soleil Clusters
metaDescription: Where Soleil Clusters stores your files, how long deleted things are kept, how sharing affects visibility, and how to get your data out or delete it.
h1: Data and privacy
navLabel: Data and privacy
section: account
order: 5
updated: 2026-08-26
answer: Boards are private by default and only reachable by people you invite. Files live in private storage and are served through signed URLs that expire, never from a public bucket. Deleted clusters are recoverable for 30 days, then purged. Everything you put in can be exported or read back out through the API.
faq:
  - q: How do I delete my account?
    a: Settings then Profile, at the foot of the tab. It shows what will happen first — clusters removed, and which shared workspaces pass to which collaborator — and asks you to type your email to confirm. There is no undo and no grace period.
  - q: Are my boards private by default?
    a: Yes. A new cluster is visible only to you until you invite someone or create a public link.
  - q: Can someone guess the URL of my image?
    a: No. Files are in private storage and served through signed URLs that expire. There is no public bucket to enumerate.
  - q: How do I get all my data out?
    a: Export boards and documents, download original files, or read everything programmatically through the REST API.
related:
  - /docs/collaborate/sharing
  - /docs/clusters/trash-and-recovery
  - /docs/api
---

## Who can see a board

Private by default. A new cluster is visible only to you until you do one of
two things:

- **[Invite someone](/docs/collaborate)** — a named person, as editor or viewer
- **[Create a public link](/docs/collaborate/sharing)** — view-only, and by default carrying a noindex instruction so search engines skip it

Making a board genuinely public and discoverable is a separate, reviewed step —
see [Explore](/docs/publish/explore). Nothing becomes public by accident.

## Where files live

In private object storage, served back through **signed URLs that expire**.
There is no public bucket and nothing is reachable by guessing a path.

Uploads go from your browser straight to storage. A file referenced by a board
is protected from cleanup for as long as the board references it.

## Retention

| Thing | Kept |
|---|---|
| Deleted cluster | 30 days in the [trash](/docs/clusters/trash-and-recovery), then purged |
| Board version snapshots | For rollback and workspace recovery |
| Files no longer referenced by any board | Eligible for cleanup after a grace period |
| Resolved [comments](/docs/collaborate/comments) | Archived, not deleted |

Restoring a cluster within the trash window restores its images with it.

## Getting your data out

Nothing is trapped:

- **[Board export](/docs/canvas/export)** — PNG or PDF
- **[Document export](/docs/documents/export)** — PDF, Markdown, HTML, and `.fdx` / Fountain for [screenplays](/docs/documents/screenplay)
- **Original files** — downloadable exactly as uploaded
- **[REST API](/docs/api)** — read every board and card programmatically

## Deleting your account

**Settings → Profile → Delete account.** Before it asks you to confirm, it
tells you what will actually happen to *your* account — how many clusters go,
and what becomes of anything you share:

- **Workspaces only you are in** are deleted, with every cluster, card,
  comment, tag and uploaded file in them.
- **Workspaces you created that other people are in** are *not* deleted.
  Ownership passes to the longest-standing other member, who is named on the
  confirmation screen. Their work is never destroyed by your leaving.
- **Workspaces you were only a member of** simply lose you.
- **Comments, tags and votes you left on other people's clusters** stay where
  they are, with your name removed — deleting them would take away context that
  belongs to someone else.
- Any **subscription is canceled** as part of the deletion, so nothing bills a
  removed account.
- Your **analytics and error records are anonymised**, not merely unlinked: the
  session identifier is dropped too, so the rows cannot be tied back to you.

Confirmation is typing your own email address. There is no grace period and no
undo — once it completes, support cannot restore the account, and the address
is free to sign up again from scratch.

## Accounts and access

Sign-in is a one-time emailed code. There is no password to be reused or
leaked.

[API tokens](/docs/api/authentication) are stored only as a hash — the value is
shown once and cannot be recovered. A token acts as you, reaching exactly what
your account reaches under the same access rules the app uses, and can be
revoked at any time with immediate effect.

## Error reporting

Errors are recorded first-party, in Clusters' own infrastructure, to fix
crashes. There is no Google Analytics and no third-party error monitoring
service in the app.

## Legal

The full policies:
[Privacy]({{fact:siteOrigin}}/legal/privacy) ·
[Terms]({{fact:siteOrigin}}/legal/terms) ·
[Cookies]({{fact:siteOrigin}}/legal/cookies).

Those documents govern; this page is a plain-language summary of how the product
behaves.
