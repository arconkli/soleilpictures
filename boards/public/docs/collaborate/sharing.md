# Sharing and public links

> A public link makes a cluster viewable by anyone with the URL, with no account and no sign-in. Links are always view-only, include nested clusters by default, can be set to expire after 7 or 30 days, and can be marked as not indexable by search engines. Granting edit access is a separate choice — either an invite link that asks the recipient to sign in, or an emailed invitation to a named person.

_Source: https://clusters.soleilpictures.com/docs/collaborate/sharing · Updated 2026-10-21_

The **Share** panel answers one question — who can open this cluster? — in the
order you decide it: the invite box first, then **Who has access**, one list of
everyone who can open it, ending with **Anyone with the link**. Every row has
the same shape: who on the left, what they can do on the right — a dropdown
wherever you can change it. **Copy link** and **Done** sit at the bottom and stay put while the
rest scrolls; anything more detailed about links is behind **Link settings**.

You open it from **Share** in the board header (a round button on a phone),
from `⌘K` → "Share this cluster", or by
right-clicking any cluster in the sidebar and choosing **Share…** — the last of
these shares the cluster you right-clicked, not the one currently on screen.

## The link — what it grants

The last row of **Who has access** is the link. Its dropdown has three answers:

| Setting | What the link does | Account needed |
|---|---|---|
| **Can view** | Anyone with the link opens the cluster read-only | No |
| **Can edit** | Recipient confirms, signs in, and joins as an editor | Yes |
| **No link** | Revokes every link on the cluster that you can revoke | — |

Choosing a setting that already has a link copies it straight away. **Copy
link** at the bottom of the panel copies it again any time, and makes the link
the first time. Switching between **Can view** and **Can edit** never revokes
anything — a link you have already sent someone keeps working, and the row
tells you it is still live. Only **No link** revokes, and it asks first.

Owners and co-owners can revoke any link on the cluster. An editor can revoke
the links they made themselves, so when an editor picks **No link**
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
> Allowing indexing opens up once an account is 72 hours old.

The board renders in a real canvas — viewers pan, zoom and open images at full
size. It is not a flattened image.

On a phone, a large board opens framed on its top-left corner at a size you can
actually read, rather than fitting the whole thing into an unreadable speck.
Pinch out to see everything; nothing is hidden, only the starting view differs.
Boards small enough to fit legibly still open showing all of themselves.

## Inviting people

Use this when you have addresses and want named people rather than whoever holds
a URL. Enter one address or several separated by commas, choose what they get —
**Can edit** or **Can view** — and how far it reaches — **This cluster** or
**Whole workspace** — and press **Invite**. The line under the box says exactly
what that means, by name: that they can edit this cluster and its
sub-clusters, say, or every cluster in the workspace. If they do not have an
account yet they get an invitation and the access is waiting for them when they
sign up.

### Inviting someone new

The panel says, under the invite box, what an invitation is worth; **Details**
says the rest. Someone who
joins Clusters through your invitation starts with
25 extra cards and 0.5GB of
storage, and you get 25 bonus cards and
0.5GB as soon as they have opened the app and placed
their first card — whichever role you invited them as, to one cluster or to the
whole workspace. A new account that joins through one of your edit links counts
the same way. Inviting someone who already has an account shares the cluster
just as well but earns no reward. Once anyone has joined through you,
**Details** also shows how many, and what you have earned. The limits are on
[Referrals](/docs/account/referrals).

Each account can send 20 invitations a day, or
5 on its first day. Sharing a cluster with someone who
already has an account counts, because they get an email too. Inviting the same
address to the same cluster again does not, and neither does changing someone's
role: neither sends anything. Past the limit, nothing is sent and the share
panel tells you when you can send more. For a bigger audience, a link reaches
everyone at once.

Accounts that reach the same inbox share one allowance: an address with a
`+tag`, or a Gmail address written with extra dots, counts as the address
itself.

One address receives at most 3 invitation emails
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

Only workspace owners and co-owners get the **Whole workspace** choice — it
grants every cluster in the workspace, not just this one. Everyone else invites
to **this cluster**, and the panel says so. **Share workspace…** in a
workspace's right-click or **⋯** menu opens the panel with **Whole workspace**
already picked.

Editors are **free on every plan**. See [Collaborating](/docs/collaborate).

## Who has access

One list, covering everyone: workspace members, people added to this cluster
alone, people who reach it through a parent cluster's share, invitations still
waiting on a signup, and the link. The right-hand side of each row says what
that person can do: a bare **Can edit** or **Can view** means this cluster
(and its sub-clusters), while workspace members read **Workspace · can edit**
or **Workspace · can view**.

That right-hand side is also the row's one control. For someone on this cluster
alone it changes their level, moves them to the **Whole workspace** (owners and
co-owners, for someone not already in it), or removes their access — with an
undo. For a workspace member,
owners and co-owners can change their level, make them a co-owner or remove
them from the workspace; only the owner can make someone else the owner. An
invitation still waiting on a signup can be revoked from its row. Someone who
has access because a parent was shared with them is listed as **via** that
parent; their access is changed or removed from the parent's Share panel, so
their row here only says what they can do. A transfer
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

## Sharing a single file

A cluster link shares everything on the cluster. To send one video, one PDF or
one mix and nothing else, share the file on its own: the person you send it to
opens a page with just that file, and never sees the cluster it sits in.

**Share file…** is wherever the file is:

- right-click the file on the canvas
- right-click its row in [Files](/docs/clusters/list-view), or open the row's menu
- the file's menu in the sidebar
- **Quick look** in Files
- the **Share** button in any full-screen view — the video player, the image
  viewer, the PDF viewer

Images, video, audio, PDFs and other files can all be shared this way. You need
to be able to edit the cluster the file is in. A doc is shared to read or edit
together instead: see [Sharing a doc](#sharing-a-doc).

### The dialog

| Part | What it does |
|---|---|
| **Add people by email** | Each person gets an email with the link, as **Can view** or **Can comment** — up to 20 people at a time |
| **People with access** | Everyone you added; change their role or **Remove** them, with an undo |
| **General access** | **Only people added**, or **Anyone with the link**, which then has its own role: **Can view** or **Can comment** |
| **Allow downloading** | Whether people you share it with get a **Download** button for the original file |
| **Copy link** | Copies the file's link |

The link is the file's own page. Open it yourself and anyone who can edit the
cluster sees **Manage sharing** at the top, which opens the same dialog.

### What the other person sees

Only the file: its name, who shared it, and the player or viewer for it — a
video plays, a PDF pages, an image opens full size. Nothing else from the
cluster or the workspace is on the page or reachable from it.

Nobody needs an account to view a file shared with **Anyone with the link**, or
to download it when downloading is allowed. A file shared with **Only people
added** asks them to sign in as the address you added. To comment, they sign in
with a code sent to their email, and land back on the same file.

### Comments

Anyone with **Can comment** can leave comments beside the file, up to
2,000 characters each.

- On **video and audio**, a comment is pinned to the moment the player was at,
  and pressing its time jumps there. Unpin it for a comment about the whole file.
- On a **PDF**, a comment is pinned to the page.
- A comment takes **replies**, one level deep.
- Anyone who can edit the cluster can **Resolve** or **Delete** any comment;
  everyone can delete their own. Deleting has an undo.

One person can post up to 20 comments every
10 minutes on a file.

The person who shared the file is told about every comment — a toast when they
are in the app, and an email when they are not: at most one email per file every
30 minutes, and only while **Comment replies** is
on in [Notifications](/docs/collaborate/notifications). Someone whose comment gets a
reply is told in the app too.

### When the file changes

- **A new version** shows on the same link. Comments made on an older version
  stay, labelled **on an earlier version**.
- **Moving the file** to another cluster in the same workspace keeps the link
  working; it follows the file.
- **Deleting the file**, or moving it to another workspace, ends the link.

### Stopping sharing

Remove a person, or switch **General access** back to **Only people added**,
and new opens are refused at once. A page someone already has open notices
within a few minutes and stops showing the file.

### What it cannot do

**Allow downloading** off hides the **Download** button and stops the page
handing out the original file. It cannot stop someone saving what they can see
— a screenshot, a screen recording, the video as it plays. If the file must not
leave, do not share it.

Program and script files — an `.exe`, a `.dmg`, a shell script, an `.html` page
and the like — never play or preview on a shared page. They are download-only,
behind a warning that a file like this can run programs on a computer. A link
to **Anyone with the link** set by an account less than
72 hours old does not open them at all.

File links are never indexed by search engines, whatever the setting on the
cluster.

Sharing a file is free on every plan. The file stays where it is and counts
toward its owner's [storage](/docs/files#storage) exactly as before; sharing it
makes no copy.

To send a copy instead of a live page, see
[Exporting a board](/docs/canvas/export).

## Sharing a doc

A [doc](/docs/documents) can be shared on its own too, to read or to edit
together, live. The person you send it to opens a page with just that doc —
they never see the cluster it sits in — and what they type lands in the doc
itself, which stays in its cluster. Nothing is copied or moved.

**Share doc…** is in three places, for anyone who can edit the cluster:

- the **Share** button at the top of an open doc, docked or full screen
- right-click the doc on the canvas
- the doc's row menu in the [list view](/docs/clusters/list-view)

### Who can view, who can edit

The dialog is the same as a file's, with **Can view** and **Can edit** in place
of comment roles:

| Part | What it does |
|---|---|
| **Add people by email** | Each person gets an email with the link. They join as **Can edit** unless you pick **Can view** |
| **General access** | **Only people added**, or **Anyone with the link**: **Can view**, or **Can edit**, which still asks them to sign in before they can type |
| **Allow exporting** | Whether the people who can edit it also get **Export** in the doc's toolbar |

Whatever the dialog says, anyone who can edit the cluster can always open and
manage the doc, and anyone who can only view the cluster can read it.

- **Can view** reads the doc as it is written, live. A reader sees no comment
  threads and has no toolbar.
- **Can edit** types, formats, adds pages, comments, replies and resolves,
  all landing in the doc in its cluster as they happen.
- **Anyone with the link** opens it with no account. On a link that can edit,
  someone signed out reads it with a **Sign in to edit** button, and lands back
  on the same doc once they have signed in with a code sent to their email.
- **Only people added** asks each person to sign in as the address you added.

### What the other person sees

The doc's name, **Editing** or **View only**, and the doc, with its pages and
images. Everyone in it sees everyone else's cursor: people from the cluster
see the others' names marked **(guest)**. If they are signed in, **Open in
Clusters** at the top opens it inside the app.

Someone editing through a link is a guest in the doc, so a few things stay
with the people in its cluster:

- They cannot add images or files, embed a cluster, or link to anything in the
  workspace. A paste keeps its text and formatting and drops the rest; a link
  that is not a web or email address is dropped.
- They can start a comment, reply to any comment, and resolve or reopen one.
  They can delete only a comment they started, and cannot rewrite one once
  it is posted.
- **Export** ([formats](/docs/documents/export)) is there only when **Allow
  exporting** is on. It cannot stop someone copying what they can read,
  or taking a screenshot.
- Up to 50 people can have one doc open through its
  link at once. A single change larger than 1 MB is
  refused, and once a doc is larger than 25 MB the
  people outside its cluster can read it but not edit it.

### When the doc changes

- **Moving the doc** to another cluster in the same workspace keeps the link
  working. **Deleting it**, or moving it to another workspace, ends the link.
- **Restoring a version** of the cluster rolls the shared doc back too. Anyone
  reading or editing it through the link is moved onto the restored doc in a
  moment.
- **Removing someone**, or changing what they can do, applies within seconds,
  including to a doc they already have open.

Like a file, sharing a doc is free on every plan, and its link is never indexed
by search engines.

## Files shared with you

A file or doc someone shares with you opens inside Clusters, over whatever you
were doing, with the same player, viewer or doc as its page. You get there from:

- **Open** on the toast that tells you a file was shared with you, while you
  are in the app
- the **Shared files** row under **Shared with me** in the sidebar, which
  appears once anything has been shared with you or by you, with a count of
  the ones you haven't opened yet
- **Open in Clusters** at the top of a file's page, when you open the link
  while signed in

### The Shared page

**Shared files** opens the Shared page, with two tabs.

**With me** lists the files and docs people added you to, and the ones you
opened from a link while signed in. Each row shows who shared it and when; a dot marks one
you haven't opened yet. Click a row to open the file, or use its **⋯** menu:

| Option | What it does |
|---|---|
| **Open** | Opens the file in the app |
| **Save a copy…** | Copies the file into one of your clusters — only when downloading is allowed |
| **Add shortcut…** | Puts a live shortcut to the file on one of your clusters |
| **Remove from Shared with me** | Takes it off your list, with an undo. It changes nothing for the person who shared it |

**By me** lists what you have shared that is still shared, with the cluster
each file is in and who can open it. Click a row to open its sharing dialog, or
use its **⋯** menu: **Manage sharing…**, **Copy link**, or **Stop sharing**,
which turns the link off and removes everyone you added, at once. Stopping
has an undo that brings back the link and exactly the people it removed, and
emails nobody again.

### Save a copy

**Add to cluster** → **Save a copy** in the viewer, or **Save a copy…** on the
Shared page, asks which of your clusters to put it in, then copies the original
file there. The copy is yours: it lands in that cluster's
[Files](/docs/clusters/list-view), stays even if the person stops sharing, and
counts toward that cluster's cards and [storage](/docs/files#storage) like an
upload. It
is offered only when the person who shared it allows downloading, and only
for files: a doc shared with you has no **Save a copy**.

### Shortcuts

**Add to cluster** → **Add shortcut**, or **Add shortcut…** on the Shared page,
puts a card on one of your clusters that opens the shared file or doc instead
of copying it. It stays in sync with theirs — a new version they upload shows on
it — and it uses no storage, though it counts as a card. Double-click it, or
choose **Open** from its menu, to open the file in the app.

A shortcut carries no copy of the file and nothing that names it: it shows the
file only to someone who can open it. Anyone else sees **Shared file**, and if
the person stops sharing it reads **No longer shared**, with a **Remove**
button. On a [public link](#the-link-what-it-grants) a shortcut opens nothing.
