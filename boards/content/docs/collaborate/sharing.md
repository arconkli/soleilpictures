---
title: Sharing and Public Links — Soleil Clusters
metaDescription: Share a Soleil Clusters board with a view-only public link that needs no account, set an expiry, include sub-clusters, or invite editors by email.
h1: Sharing and public links
navLabel: Sharing
section: collaborate
order: 1
updated: 2026-10-27
answer: A public link makes a cluster viewable by anyone with the URL, with no account and no sign-in. Links are always view-only, include nested clusters by default, can be set to expire after 7 or 30 days, and can be marked as not indexable by search engines. Granting edit access is a separate choice — either an invite link that asks the recipient to sign in, or an emailed invitation to a named person.
faq:
  - q: Does someone need an account to open a shared link?
    a: No. A view link opens the board read-only for anyone, with no sign-in.
  - q: Can a public link be edited by whoever has it?
    a: Never. A view link is always read-only. Edit access comes from a separate kind of link that asks the recipient to sign in before it grants anything, or from inviting a named person by email.
  - q: Will a shared board show up in Google?
    a: Only if you allow indexing, or publish it to Explore. By default shared boards carry a noindex instruction.
  - q: Can I share just one file?
    a: Yes. Right-click a file and choose Share file…, or press Share in its full-screen view. The person you send it to sees only that file, with its player or viewer, and nothing else from the cluster.
  - q: Can I share one doc for someone else to edit?
    a: Yes. Press Share at the top of an open doc, or right-click it and choose Share doc…, then give them Can edit. They edit the doc itself, live, without seeing the rest of the cluster; editing needs them to sign in, and reading through a link does not.
  - q: Does the person I share a file with need an account?
    a: Not to view it, or to download it when downloading is allowed, if the file is shared with anyone who has the link. They sign in with a code sent to their email to comment, or to open a file shared only with people you added.
  - q: Where do I find files people have shared with me?
    a: In the Shared page — the Shared files row under Shared with me in the sidebar. Its With me tab lists every file shared with you, where you can open it in the app, save a copy into one of your clusters when downloading is allowed, or add a live shortcut to it on a cluster.
  - q: Can I stop someone downloading a shared file?
    a: Turning off Allow downloading removes the Download button and the original file from the page. It cannot stop someone saving what they can see, such as a screenshot or a screen recording.
related:
  - /docs/collaborate
  - /docs/publish/explore
  - /docs/canvas/export
---

The **Share** panel answers one question — who can open this cluster? — in the
order you decide it: the link first, under **Share a link**, then **Invite
people**, then **Who has access**, one list of the people who can open it.
Every row has the same shape: who on the left, what they can do on the right —
a dropdown wherever you can change it. **Copy link** sits right under **Anyone
with the link**, and anything more detailed about links is behind **Link
settings**, under it. **Done** sits at the bottom and stays put while
the rest scrolls.

You open it from **Share** in the board header (a round button on a phone),
from `⌘K` → "Share this cluster", or by
right-clicking any cluster in the sidebar and choosing **Share…** — the last of
these shares the cluster you right-clicked, not the one currently on screen.

## The link — what it grants

The link has its own row at the top: **Anyone with the link**. Its dropdown has
three answers:

| Setting | What the link does | Account needed |
|---|---|---|
| **Can view** | Anyone with the link opens the cluster read-only | No |
| **Can edit** | Recipient confirms, signs in, and joins as an editor | Yes |
| **No link** | Revokes every link on the cluster that you can revoke | — |

Choosing a setting that already has a link copies it straight away. **Copy
link**, right under it, copies it again any time, and makes the link the first
time. Switching between **Can view** and **Can edit** never revokes
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

An AI assistant you have [connected](/docs/mcp) can do the same two things
with `share_board` and `unshare_board`: hand back the cluster's view link, or
revoke it. It gets the link that already exists when there is one, and a link it
makes shows just that one board unless it asks for the nested ones too. Scripts
use [the same endpoint](/docs/api/boards#sharing-by-link-boards-id-share-link).

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
{{fact:referralFriendCards}} extra cards and {{fact:referralBonusStorage}} of
storage, and you get {{fact:referralRewardCards}} bonus cards and
{{fact:referralBonusStorage}} as soon as they have opened the app and placed
their first card — whichever role you invited them as, to one cluster or to the
whole workspace. A new account that joins through one of your edit links counts
the same way. Inviting someone who already has an account shares the cluster
just as well but earns no reward. Once anyone has joined through you,
**Details** also shows how many, and what you have earned. The limits are on
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

Only workspace owners and co-owners get the **Whole workspace** choice — it
grants every cluster in the workspace, not just this one. Everyone else invites
to **this cluster**, and the panel says so. **Share workspace…** in a
workspace's right-click or **⋯** menu opens the panel with **Whole workspace**
already picked.

Editors are **free on every plan**. See [Collaborating](/docs/collaborate).

## Inviting a whole workspace

A new workspace's [setup](/docs/getting-started#1-sign-in) offers one link that
brings people into the **whole workspace**, every cluster and file in it, as
editors. It is the setup's invite step, and the one time it asks again, that
make it: **Copy link** on a computer, **Share invite link** on a phone. A phone
with no share sheet copies the link instead and says **Copied**; where the
browser won't copy at all, the link itself is shown, selected, to copy by hand.
Only the workspace's owner or a co-owner can make one. Making it sends nothing
to anyone.

| | A link lasts | It lets in |
|---|---|---|
| An account | {{fact:workspaceLinkDays}} days | up to {{fact:workspaceLinkUses}} people |
| An account in its first {{fact:newAccountHours}} hours | {{fact:workspaceLinkNewDays}} days | up to {{fact:workspaceLinkNewUses}} people |

The line under the link says what that one does, from the link itself: who it
lets in, for how long, and how many more people. Asking again for the same
workspace gives back the link that is still live rather than a new one. An
account makes at most {{fact:workspaceLinksPerDay}} links a day, or
{{fact:workspaceLinksNewPerDay}} in its first {{fact:newAccountHours}} hours;
past that, invite by email.

### Opening one

Signed out, the sign-in screen names the workspace and, if they have set one,
the first name of the person who sent it — never an address. Once they sign in
or sign up, they are in. Someone already signed in sees **Join as editor** or
**Not now** first, and someone already in the workspace is offered **Open** it
instead. A link that has expired, been used up or stopped working says so and
asks them to get a new one from whoever sent it.

A link stops working while the account that made it is under review or no
longer the workspace's owner or a co-owner, and comes back if that changes. A
link passed around far more widely than a team turns itself off for good; the
people it already let in stay. There is no button to turn a link off yet: it
ends when it expires or is used up. To take someone back out, remove them under
**Who has access**.

When someone joins, you see "*Name* joined *your workspace* — say hi." with a
**Message** button, or, if you are not in the app, an email — the **Invite
accepted** one in [Notifications](/docs/collaborate/notifications). A new
account that joins through your link within
{{fact:referralLinkJoinDays}} days of signing up counts as your
[referral](/docs/account/referrals), as on an edit link.

## Who has access

One list of the people who can open it: workspace members, people added to
this cluster alone, people who reach it through a parent cluster's share, and
invitations still waiting on a signup. The link has its own row at the top of
the panel. The right-hand side of each row says what that person can do: a
bare **Can edit** or **Can view** means this cluster (and its sub-clusters),
while workspace members read **Workspace · can edit**
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
The previous owner's webhooks and API service accounts are turned off, and the
notice says so. To have someone run it while your plan keeps covering it, make
them a co-owner instead — the transfer dialog offers that.

When someone is removed from a workspace, or leaves it, what they set up there
goes with them: the links and invitations they made stop working, the files
and docs they shared from it stop reaching people, they leave its
conversations, and the webhooks and API service accounts they created are
turned off. A link also stops working as soon as the person who made it can no
longer edit the cluster, so unsharing a cluster from someone, or making them a
viewer, ends their links too. People who already joined through one of those
links keep what they were given.

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
| **Add people by email** | Each person gets an email with the link, as **Can view** or **Can comment** — up to {{fact:fileSharePeoplePerCall}} people at a time |
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
{{fact:fileCommentMaxChars}} characters each.

- On **video and audio**, a comment is pinned to the moment the player was at,
  and pressing its time jumps there. Unpin it for a comment about the whole file.
- On a **PDF**, a comment is pinned to the page.
- A comment takes **replies**, one level deep.
- Anyone who can edit the cluster can **Resolve** or **Delete** any comment;
  everyone can delete their own. Deleting has an undo.

One person can post up to {{fact:fileCommentBurst}} comments every
{{fact:fileCommentBurstMinutes}} minutes on a file.

The person who shared the file is told about every comment — a toast when they
are in the app, and an email when they are not: at most one email per file every
{{fact:fileCommentEmailMinutes}} minutes, and only while **Comment replies** is
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
{{fact:fileShareRiskyNewAccountHours}} hours old does not open them at all.

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
- Up to {{fact:docRoomMaxPeople}} people can have one doc open through its
  link at once. A single change larger than {{fact:docRoomFrameMaxMB}} MB is
  refused, and once a doc is larger than {{fact:docRoomGuestDocMaxMB}} MB the
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
- its row in the list under the bell at the top right of the board (on a
  phone, in the top bar before **Share**), which keeps every notification until
  you read it; see [Notifications](/docs/collaborate/notifications)
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
