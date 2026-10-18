---
title: Sharing and Public Links — Soleil Clusters
metaDescription: Share a Soleil Clusters board with a view-only public link that needs no account, set an expiry, include sub-clusters, or invite editors by email.
h1: Sharing and public links
navLabel: Sharing
section: collaborate
order: 1
updated: 2026-10-17
answer: A public link makes a cluster viewable by anyone with the URL, with no account and no sign-in. Links are always view-only, include nested clusters by default, can be set to expire after 7 or 30 days, and can be marked as not indexable by search engines. Granting edit access is a separate choice — either an invite link that asks the recipient to sign in, or an emailed invitation to a named person.
faq:
  - q: Does someone need an account to open a shared link?
    a: No. A view link opens the board read-only for anyone, with no sign-in.
  - q: Can a public link be edited by whoever has it?
    a: Never. A view link is always read-only. Edit access comes from a separate kind of link that asks the recipient to sign in before it grants anything, or from inviting a named person by email.
  - q: Will a shared board show up in Google?
    a: Only if you allow indexing, or publish it to Explore. By default shared boards carry a noindex instruction.
related:
  - /docs/collaborate
  - /docs/publish/explore
  - /docs/canvas/export
---

The **Share** panel answers one question — who can open this cluster? — in the
order you decide it: **Invite people** by email first, then **People with
access**, then **Link access** for anyone else. **Copy link** and **Done** sit at
the bottom and stay put while the rest scrolls; anything more detailed about
links is behind **Link settings**.

You open it from **Share** — the filled button in the board header, a filled
round button on a phone — from `⌘K` → "Share this cluster", or by
right-clicking any cluster in the sidebar and choosing **Share…** — the last of
these shares the cluster you right-clicked, not the one currently on screen.

## Link access — the link, and what it grants

One picker, three answers:

| Setting | What the link does | Account needed |
|---|---|---|
| **Anyone with the link can view** | Opens the cluster read-only | No |
| **Anyone with the link can edit** | Recipient confirms, signs in, and joins as an editor | Yes |
| **Only people with access** | Revokes every link on the cluster that you can revoke | — |

Choosing a setting that already has a link copies it straight away. **Copy
link** at the bottom of the panel copies it again any time, and makes the link
the first time. Switching between **can view** and **can edit** never revokes
anything — a link you have already sent someone keeps working, and the panel
tells you it is still live. Only **Only people with access** revokes, and it
asks first.

Owners and co-owners can revoke any link on the cluster. An editor can revoke
the links they made themselves, so when an editor picks **Only people with access**
their own links are revoked and the panel says how many links other people made
are still live. Those stay until the person who made them, the owner or a
co-owner revokes them.

An edit link is not an editable public link. It grants nothing on its own: the
person who opens it sees a preview and an explicit **Join** step, and access is
created when they sign in and take it.

### What "view" includes

Read-only means nobody can change the cluster. It does **not** mean the files
stay behind glass: anyone who opens the link can download the images, audio,
video, PDFs and attachments on it, at full quality and under their original
names (for images and videos, the ones uploaded since names were kept). That is what makes a link worth sending — a sample pack or a stills
selects is only useful if the other person can take it away.

Treat the link itself as the access control. If the contents should not leave,
do not put them behind a public link.

## Link settings

Everything that qualifies a link lives in one disclosure under the picker.

| Option | Choices |
|---|---|
| **Expiry** | Never · 7 days · 30 days (view links default to never, edit links to 30 days) |
| **Include sub-clusters** | Whether [nested clusters](/docs/clusters) open too — **on by default** |
| **Allow indexing** | Whether search engines may index it — off by default |

With sub-clusters included, viewers navigate into nested boards with
breadcrumbs. With it off, the link shows exactly one board.

The same disclosure lists every link currently live on the cluster, with what
each one grants, how many people have joined through it, when it expires, and
buttons to copy or **revoke** it.

> **Note:** By default a shared board tells search engines not to index it. It
> is reachable by anyone with the URL, but it will not turn up in a search
> unless you allow indexing or [publish it to Explore](/docs/publish/explore).
> Allowing indexing opens up once an account is {{fact:newAccountHours}} hours old.

The board renders in a real canvas — viewers pan, zoom and open images at full
size. It is not a flattened image.

On a phone, a large board opens framed on its top-left corner at a size you can
actually read, rather than fitting the whole thing into an unreadable speck.
Pinch out to see everything; nothing is hidden, only the starting view differs.
Boards small enough to fit legibly still open showing all of themselves.

## Inviting people

Use this when you have addresses and want named people rather than whoever holds
a URL. Enter one address or several separated by commas, pick **Can edit** or
**Can view**, and press **Invite**. The line under the box says what the role you
picked lets them do. If they do not have an account yet they get an invitation
and the access is waiting for them when they sign up.

### Inviting someone new

The panel says, under the invite box, what an invitation is worth. Someone who
joins Clusters through your invitation starts with
{{fact:referralFriendCards}} extra cards and {{fact:referralBonusStorage}} of
storage, and you get {{fact:referralRewardCards}} bonus cards and
{{fact:referralBonusStorage}} as soon as they have opened the app and placed
their first card — whichever role you invited them as, to one cluster or to the
whole workspace. A new account that joins through one of your edit links counts
the same way. Inviting someone who already has an account shares the cluster
just as well but earns no reward. Once anyone has joined through you, the panel
also shows how many, and what you have earned. The limits are on
[Referrals](/docs/account/referrals).

Each account can send {{fact:inviteDailyLimit}} invitations a day, or
{{fact:inviteFirstDayLimit}} on its first day. Sharing a cluster with someone who
already has an account counts, because they get an email too. Inviting the same
address to the same cluster again does not, and neither does changing someone's
role: neither sends anything. Past the limit, nothing is sent and the share
panel tells you when you can send more. For a bigger audience, a link reaches
everyone at once.

Accounts that reach the same inbox share one allowance: an address with a
`+tag`, or a Gmail address written with extra dots, counts as the address
itself.

One address receives at most {{fact:inviteRecipientDailyCap}} invitation emails
a day, from every sender combined. Past that the access is still granted; only
the email is skipped, so the person finds the cluster waiting when they next
sign in.

Invitation emails are also watched across all of Clusters, not only per
account. If an unusual number go out at once, or an account looks like it is
sending in bulk, the emails are held for review instead of sent. An account
under review sees "sharing is paused on this account while we review unusual
activity" in the share panel; everything else about it, including its own
clusters, works as before. While the review runs, the invitations it already
sent can't be accepted, and if the account is less than a week old its share
links pause too. All of it works again, and held invitations are sent, if the
review clears it.

Workspace owners and co-owners also get **Whole workspace · can edit** and
**Whole workspace · can view** — those grant every cluster in the workspace, not
just this one, so only they can hand them out. **Share workspace…** in a
workspace's right-click or **⋯** menu opens the panel with **Whole workspace ·
can edit** already picked.

Editors are **free on every plan**. See [Collaborating](/docs/collaborate).

## People with access

One list, covering everyone: workspace members, people added to this cluster
alone, people who reach it through a parent cluster's share, and invitations
still waiting on a signup. Each row says what that person can do and how far it
reaches. Someone who has access because a parent was shared with them is listed
as **via** that parent; their access is changed or removed from the parent's
Share panel, so their row here has no controls. Owners and co-owners can change a role or
remove access from here; only the owner can transfer the workspace. A transfer
hands over the plan too: the workspace's cards, files and storage count against
the new owner's plan from then on, and they get a notice with their own numbers.
To have someone run it while your plan keeps covering it, make them a co-owner
instead — the transfer dialog offers that.

## Getting a link fast

Two presses, and the second one is already under your cursor: **Share** opens
the panel focused on **Copy link** (it reads **Create link & copy** until the
cluster has a link), so `Share` then `Enter` puts a view-only link on your
clipboard. Creating it also refreshes the preview image the link will unfurl
with.

Boards you are viewing without edit rights show a clear VIEW ONLY badge, so
there is never ambiguity about whether your changes will stick. You cannot mint
a link on one, but you can still open **Share** to see who has access.

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
