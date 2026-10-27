---
title: Collaborating — Soleil Clusters
metaDescription: Invite editors and viewers to Soleil Clusters boards. Up to {{fact:editorLimit}} people edit free on Free and Creator, viewers are unlimited, and the owner's quota counts.
h1: Collaborating
navLabel: Overview
section: collaborate
order: 0
updated: 2026-10-17
answer: Invite people to a cluster as an editor or a viewer, by email or with a link. On Free and Creator, up to {{fact:editorLimit}} people can edit across everything an account owns, at no cost to them, and viewers are unlimited. Cards and storage always count against the cluster owner's quota, not the person who added them.
faq:
  - q: Do collaborators need to pay?
    a: No. On Free and Creator, up to {{fact:editorLimit}} people can edit and anyone can view, and none of them pays. Whoever owns the cluster pays for what it holds. A group with more than {{fact:editorLimit}} people who edit uses [Team](/docs/account/team), priced per seat.
  - q: Whose card allowance do collaborator uploads use?
    a: The owner's. If you add cards to someone else's cluster, they count against their limit, not yours.
  - q: Can a viewer comment?
    a: Yes, on the canvas. Viewers can read, comment and vote; they cannot add, move or change cards. Text comments inside a document need edit access — a viewer can read those threads but not add to them.
related:
  - /docs/collaborate/sharing
  - /docs/collaborate/presence
  - /docs/account/plans
---

Collaboration is free on Free and Creator: up to {{fact:editorLimit}} people can
edit across everything an account owns, and anyone can view. Inviting people is
how boards become useful. A group with more than {{fact:editorLimit}} people who
edit uses [Team](/docs/account/team), which is priced per seat.

## Roles

| Role | Can |
|---|---|
| **Owner** | Everything, including deleting the cluster and managing members and shares |
| **Co-owner** | Runs a workspace alongside its owner — invites and removes members, changes roles, manages every share and link, renames it — but cannot delete it, hand it over, or remove the owner |
| **Editor** | Add, change and remove content; comment; invite if permitted |
| **Viewer** | Open, read, [comment](/docs/collaborate/comments) on the canvas and [vote](/docs/canvas/vote-cards) — never change content, including a document's text comments |
| **Workspace member** | The same two levels, editor or viewer, granted for every cluster in the workspace at once |

Editors are **free on every plan**. A free-tier account can be an editor on any
cluster it is invited to, with no restriction on what it can do there.

## Whose quota

Always the **cluster owner's**. A co-owner is not the owner for this purpose:
what they add counts against the owner's allowance, like an editor's.

Cards added to someone else's cluster count against their
[card allowance](/docs/canvas/cards); files uploaded there use their
[storage](/docs/files). This is what makes free editors workable: the person who
owns the work pays for it, and inviting help costs nothing extra.

## Up to {{fact:editorLimit}} people who edit

On Free and Creator, an account can have up to {{fact:editorLimit}} people who
can edit, counted once each across every workspace it owns: the owner,
co-owners, editors, and invites to edit that haven't been answered yet. Viewers
never count.

When an account is full:

- **Can edit** is greyed out in the share panel, and people can still be
  invited to view.
- Someone who opens a link to edit joins as a viewer and is told why, and the
  owner hears about it.
- Anyone but the owner can ask the owner for a place.
- The owner sees everyone who holds a place in **Settings → Members**, and can
  make someone a viewer or cancel an invite to free one.

If an account ends up with more than {{fact:editorLimit}} — a workspace handed
over to it, for example — everyone keeps editing, and nobody new can be made an
editor until it is back at {{fact:editorLimit}} or fewer. Groups that need more
use [Team](/docs/account/team).

## Inviting

**Share** on any cluster opens the panel, with inviting at the top. Two
mechanisms:

- **By email** — name a person and a role. They get an invitation.
- **By link** — a URL carrying a role, which grants that access to whoever opens it and confirms.

Inviting someone who is new to Clusters also pays you both: they get bonus
cards and {{fact:referralBonusStorage}} of storage when they join, and you get
bonus cards and {{fact:referralBonusStorage}} once they get started. The panel
says what it's worth under the invite box, **Details** there has the rest, and
[Referrals](/docs/account/referrals) has the rules.

Also in the panel: current workspace members, existing per-board shares, and
[public links](/docs/collaborate/sharing) — which are a different thing, and
always view-only.

## Workspaces

Access can be granted at the [workspace](/docs/concepts) level instead of per
board, which is the right shape for a team that works together continuously
rather than on one project. To share a whole workspace, right-click it in the
workspace switcher — or use its **⋯** — and choose **Share workspace…**: the
share panel opens already set to invite people to every cluster in it.

A workspace has one owner, and can have any number of **co-owners**. The owner
or a co-owner makes someone a co-owner from **Settings → Members**. Co-owners
share the running of the workspace; deleting it and handing it to someone else
stay with the owner.

Clusters shared with you appear under **Shared with me** in the sidebar, grouped
by whose workspace they came from.

## What collaboration looks like in use

- **[Presence](/docs/collaborate/presence)** — live cursors, who is here, jump to where someone is
- **[Comments](/docs/collaborate/comments)** — anchored to a card, a group, a point, or a text range
- **[Messages](/docs/collaborate/messages)** — direct and group conversations with anyone you share a board with
- **[Notifications](/docs/collaborate/notifications)** — mentions, replies, invitations

Everything is real time. Two people can move cards on the same canvas, type in
the same [note](/docs/canvas/notes), or write in the same
[document](/docs/documents) at once, and edits merge rather than overwriting.

One common shape of this is a studio art team working from a single live
reference board — the [shared reference boards guide](/tools/shared-reference-board)
covers setting one up.

## Undoing someone else's change

`⌘Z` undoes **your own** edits only. To reverse a collaborator's work, use
version history or workspace recovery — see
[Trash and recovery](/docs/clusters/trash-and-recovery).
