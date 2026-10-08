---
title: Data, Retention and Privacy — Soleil Clusters
metaDescription: Where Soleil Clusters stores your files, how long deleted things are kept, how sharing affects visibility, and how to get your data out or delete it.
h1: Data and privacy
navLabel: Data and privacy
section: account
order: 5
updated: 2026-10-07
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

## Abuse prevention

To stop one person running many throwaway accounts — the pattern behind
invitation spam — Clusters notes where requests come from: the network and the
browser of each signed-in session, once a day, and of each invitation, share
link and email you send to someone. Both are stored only as salted one-way
hashes, never as the address itself, along with the country.

- They are kept for {{fact:requestOriginRetentionDays}} days, and deleted with your account.
- Only Clusters staff can read them, and only to spot and stop abuse — for
  example, several new accounts appearing on one network in a day.
- If an account is held or banned for abuse, a summary of where it connected
  from, and which other accounts shared those networks, is kept with that
  decision.

## Error reporting

Errors are recorded first-party, in Clusters' own infrastructure, to fix
crashes. There is no Google Analytics and no third-party error monitoring
service in the app.

## When Clusters asks you a question

Clusters asks two questions, each **once per account**, and Send feedback is
there whenever you want it. Every one of them shows you what will be sent with
your answer before you send it.

### What brings you back today?

On a day you come back, Clusters may ask what brings you back today, offering a
short list of answers. Tapping one is the whole answer.

The list is fixed and always in this order: picking up where you left off,
adding material you have collected since, starting something new, looking back
through what you have got, showing it to someone. Alongside them sit *Nothing
in particular*, which is a real answer, and *Not now*, which is not.

After you tap, it asks **what best describes you** — filmmaker, photographer,
designer, artist or illustrator, student, or something else — and offers a
single follow-up in your own words. Both are optional: the first tap has already
been recorded either way. Your role is asked for once per account too.

- It is asked **once per account, ever**. Answering closes it permanently and
  that is recorded on the server, so it will not return if you clear your
  browser storage. Choosing *Not now* is remembered in this browser.
- It counts as asked only once it has actually been on your screen for a few
  seconds, so a question that appears as you are closing the tab does not use
  up your one time.
- It never appears on your first session, and it does not appear when you have
  arrived through someone else's share or invite link.

### What's holding you back?

If you are on the free plan and close an offer to upgrade — the upgrade screen,
or the dialog that appears when the files you drop will not fit — Clusters may ask, once,
what is holding you back: the free plan is enough for you, the price, putting a
card in for a trial, not being sure what you would get, just trying it out, or
something else. One tap answers it, and an optional line in your own words
follows.

It only appears after the offer was actually on your screen, and it is asked
**once per account**: answering it, choosing *Not now*, or leaving it on your
screen for a few seconds ends it for good, and that is recorded on the server,
so it will not come back on another device.

### Send feedback

**Send feedback** — the paper-plane button — is always there. Pick a topic
(something broke, missing a feature, confusing, slow, plans and pricing, I love
something, other) and send; words and a screenshot are both optional. The **OK
to email me about this** box starts unticked. Unless you tick it, nobody will
write to you about what you sent.

### What is sent with an answer

Each of these attaches a small record of where you were, printed under the
question before you send it — for example *canvas · 34 cards · Free · desktop*:

- the part of the app you were on, and the cluster's id
- how many cards you have and your card limit, and your plan
- the offer you had just closed, if any, and how you closed it
- your device type, operating system and browser, and the app's version
- the page's path — never its query string

Send feedback also sends, as it always has, the address of the page you were
on, your window size, your browser's user-agent string, and any screenshot you
attach.

- Whatever you type in an optional **free-text** follow-up is stored as
  **written text you chose to send**, readable by Clusters staff. It is not
  analysed automatically and is not shared with anyone outside Clusters. If it
  cannot be sent straight away it waits in your browser's own storage until it
  can, for at most a week.
- A tap is recorded as one of the fixed answers above, together with the length
  of anything you wrote — never its content.
- Nothing you type into your own clusters — card contents, notes, documents,
  search terms — is ever collected this way. Search is measured by shape only
  (how many results, whether any were opened), never by content.

If you would rather none of it had been asked, deleting your account removes it
along with everything else.

## Legal

The full policies:
[Privacy]({{fact:siteOrigin}}/legal/privacy) ·
[Terms]({{fact:siteOrigin}}/legal/terms) ·
[Cookies]({{fact:siteOrigin}}/legal/cookies).

Those documents govern; this page is a plain-language summary of how the product
behaves.
