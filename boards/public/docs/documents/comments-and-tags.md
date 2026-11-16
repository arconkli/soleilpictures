# Comments, tags and backlinks in documents

> Select text in a document and comment on it — the comment attaches to that range and shows as a dot in the right margin. Tags applied to a range underline the text and show in the left margin; clear mentions of your tags are underlined automatically and marked auto. The app also suggests entity names it notices, which you confirm or dismiss with a tick or a cross, and backlinks show everywhere the document is referenced from.

_Source: https://clusters.soleilpictures.com/docs/documents/comments-and-tags · Updated 2026-11-15_

Documents carry annotation in the margins, so the text stays clean and the
apparatus stays visible.

## Comments on a range

Select text and add a comment, from the toolbar or with `⌘⌥M`. A box opens
beside the words; `Enter` posts it. The comment anchors to that **range**, not
to a character position, so editing around it keeps it attached to the right
passage.

Commented text is tinted, with a dot in the **right margin**; a darker dot
means there is something in the thread you haven't read. Click the words, or
the dot, and the side panel opens on their thread, with the words turned gold
while it is open.

## Every comment in one place

**Comments** in the document's header opens the side panel on its comments:
every open thread in the document as a short row, in the order they come in
the text, with the words it is on, who started it and how much was said since.
Press a row and it opens into the whole conversation, with the box to reply
in; its quote takes you to its words, opening the page they are on.

In the open thread you can:

- **Reply** — `Enter` sends, `Shift+Enter` starts a new line. Words you typed
  and didn't send are kept for you in this browser.
- **Resolve** it. It moves to **Resolved** at the bottom of the panel, which
  opens on a press, and says who resolved it. **Reopen** brings it back, and so
  does a reply. A resolved thread's words read as plain text again; picking it
  in the panel still lights them.
- **Edit** a comment you wrote, from its **⋯** menu. It is marked *edited*.
- **Copy link** to a comment: the link opens the document's cluster, the
  document and this thread.
- **Delete** a comment or the whole thread.

Resolving and deleting show a toast with **Undo**. `Esc` puts you back in the
text.

Comments thread, resolve, and support `@` mentions that notify the person you
name. See [Comments](/docs/collaborate/comments) for the full model, which is
shared with the canvas and with notes, and
[Notifications](/docs/collaborate/notifications) for who is told about a new
comment, a reply or a resolve.

Because a text comment is part of the document, it follows edit access. A
viewer sees the dots and reads every thread, by clicking the words or in the
side panel; adding, replying to, resolving or deleting a comment needs edit
access. Among people who can edit, only the person who wrote a comment can
change its words.

## Tags on a range

A [tag](/docs/organize/tags) can apply to a passage rather than the whole
document: select the words, right-click and choose **Tag selection…**. Tagged
text is underlined, with dots in the **left margin**.

This is what lets a script's mention of a location connect to the reference wall
for that location — the tag's page lists this passage among everything else
carrying it.

Words that clearly refer to one of your tags are underlined on their own,
marked *auto*, in prose and in screenplay blocks alike. Right-click one to
remove it, which keeps that tag off the page. A tag you put on a word follows
the word as you edit around it, and stays on the page if the word goes.

## Suggested entities

As you write, names that look like entities — characters, locations,
organizations — are detected and offered in the margin with a tick and a cross.

**Nothing is applied until you accept it.** A suggested name is a suggestion;
it does not become a tag behind you.

Accepting one creates or links the entity, so the next occurrence anywhere is
recognised automatically.

Names are found without AI. With the workspace's AI suggestions on, the AI also
guesses what kind of name each one is; with them off (Settings → Workspace),
that guess is left out and no text is sent.

## Links and mentions

Type `@` to reference a cluster, document, card, tag or person. Mentions render
as links with hover previews and register as backlinks on the target.

URLs typed or pasted become links automatically.

See [Links and mentions](/docs/organize/links-and-mentions).

## Backlinks

The **Referenced by** panel lists everywhere this document is linked or
mentioned from — other documents, notes, cards, messages.

Backlinks are the reason mentioning things is worth the keystroke: a location's
entity page ends up listing the script scene, the reference board and the
message thread that all pointed at it, without anybody maintaining an index.

## Bookmarks

Not annotation but adjacent: bookmarks are durable anchors into specific places
in a document, listed under the page tree. They survive edits around them, so a
bookmark on "the end of act two" stays there as the act changes length.
