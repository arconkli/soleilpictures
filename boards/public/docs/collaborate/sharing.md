# Sharing and public links

> A public link makes a cluster viewable by anyone with the URL, with no account and no sign-in. Links are always view-only, include nested clusters by default, can be set to expire after 7 or 30 days, and can be marked as not indexable by search engines. Granting edit access is a separate choice — either an invite link that asks the recipient to sign in, or an emailed invitation to a named person.

_Source: https://clusters.soleilpictures.com/docs/collaborate/sharing · Updated 2026-08-28_

The **Share** panel answers one question — who can open this cluster? — and
everything in it hangs off that answer. It opens on one button and one picker;
the rest is behind **Link settings**.

You open it from **Share** in the board header, from `⌘K` → "Share this
cluster", or by right-clicking any cluster in the sidebar and choosing
**Share…** — the last of these shares the cluster you right-clicked, not the one
currently on screen.

## General access — the link, and what it grants

One picker, three answers:

| Setting | What the link does | Account needed |
|---|---|---|
| **Anyone with the link · can view** | Opens the cluster read-only | No |
| **Anyone with the link · can edit** | Recipient confirms, signs in, and joins as an editor | Yes |
| **Only invited people** | Revokes every link on the cluster | — |

Choosing one hands you the link straight away; the button beside the picker
copies it again any time. Switching between **can view** and **can edit** never
revokes anything — a link you have already sent someone keeps working, and the
panel tells you it is still live. Only **Only invited people** revokes, and it
asks first.

An edit link is not an editable public link. It grants nothing on its own: the
person who opens it sees a preview and an explicit **Join** step, and access is
created when they sign in and take it.

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

The board renders in a real canvas — viewers pan, zoom and open images at full
size. It is not a flattened image.

On a phone, a large board opens framed on its top-left corner at a size you can
actually read, rather than fitting the whole thing into an unreadable speck.
Pinch out to see everything; nothing is hidden, only the starting view differs.
Boards small enough to fit legibly still open showing all of themselves.

## Inviting specific people

Use this when you have addresses and want named people rather than whoever holds
a URL. Enter one address or several separated by commas, pick **Can edit** or
**Can view**, and send. If they do not have an account yet they get an invitation
and the access is waiting for them when they sign up.

Workspace owners get a third choice, **Whole workspace** — that grants every
cluster in the workspace, not just this one, so only the owner can hand it out.

Editors are **free on every plan**. See [Collaborating](/docs/collaborate).

## People with access

One list, covering everyone: workspace members, people added to this cluster
alone, and invitations still waiting on a signup. Each row says what that person
can do and how far it reaches. Owners can change a role, remove access, or
transfer the workspace from here.

## Getting a link fast

Two presses, and the second one is already under your cursor: **Share** opens
the panel focused on **Create link & copy**, so `Share` then `Enter` puts a
view-only link on your clipboard. Creating it also refreshes the preview image
the link will unfurl with.

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
