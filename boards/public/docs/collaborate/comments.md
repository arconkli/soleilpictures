# Comments

> A comment anchors to whatever it is about — a card, a group, an empty point on the canvas, the board as a whole, or a range of text inside a document. On the canvas each conversation is a small pin at the corner of its card, and the comments button lists them all. Comments thread, resolve, and support @ mentions that notify the person named. A switch in the comments list hides the pins, for you alone, when you want to see the board clean.

_Source: https://clusters.soleilpictures.com/docs/collaborate/comments · Updated 2026-11-15_

Comments attach to the thing they are about. This is the whole design: feedback
that lives in a sidebar, ordered by time, loses the connection to what it
referred to within a day.

## What you can comment on

| Anchor | Reads as |
|---|---|
| A **card** | "this image" |
| A **[group](/docs/canvas/groups)** | "this sequence" |
| An **empty point** | "something should go here" |
| The **board** | "the whole thing" |
| A **text range** in a [document](/docs/documents/comments-and-tags) or a note | "this sentence" |

Right-click a card, a group or the empty canvas and choose the comment item
(on a phone, touch and hold), or use the rail's **+** → *Annotate* →
**Comment** and click what it is about. A box opens right there, beside the
spot its pin will sit on.

A comment on the board as a whole has no place on the canvas, so it has no pin:
it shows in the comments list. Those come from the [API](/docs/api/comments) or
an assistant.

## Pins on the canvas

Each open conversation is a small pin with the face of whoever started it,
sitting at the top-right corner of its card or group, or on its point. Pins
stay the same size however far you zoom. Several conversations on one card
line up along its top edge.

- **A dot on a pin** means there is something in it you haven't read.
- **Zoomed out**, pins that would crowd each other gather into one pin with a
  number. Click it and the board zooms in until they come apart.
- **Point at a pin** to read how it begins, who wrote it and when, and how many
  replies it has.
- **Click a pin** to open the conversation in a card beside what it is about.
  The open pin and its card are ringed in gold.
- **Drag a pin that sits on a point** to move it, if you wrote it or can edit
  the board. A pin on a card or a group follows what it is on.

On a phone or an iPad, tap a pin and the conversation opens as a sheet from
the bottom of the screen. A new comment starts in the same sheet; see
[Mobile and tablet](/docs/account/mobile).

Delete a card and its comments go with it; restore the card and they come back.

## The comments list

The comments button at the top left of the board shows how many conversations
are open, with a dot when one is unread. Press it for the list:

| Tab | Holds |
|---|---|
| **Open** | Every open conversation on the board |
| **Resolved** | The ones that were resolved |
| **For you** | Open ones where you were mentioned or replied to |

Each row says what the comment is on, who wrote it, when, how it begins and
how much was said since. Point at a row to light its card; click it and the
board moves there and opens the conversation.

## Hiding them

At the bottom of the list is **Show comments on the canvas**. Turn it off and
the pins go, for you only: it changes what you see on this board in this
browser, and nothing for anyone else. The list keeps working while they are
hidden, and starting a new comment turns them back on. Use it when presenting
or when the feedback has piled up and you want to see the work.

## Threads

Open a conversation to read it and reply. `Enter` sends and `Shift+Enter`
starts a new line; on a phone or tablet keyboard, the return key sends, as the
send button does.

**Resolve** when the thing is dealt with. A resolved conversation leaves the
canvas and is kept under **Resolved** in the list, not deleted, so the record
of why something changed survives. It says who resolved it; **Reopen** brings
it back, and so does replying to it.

Each comment's **⋯** menu has:

- **Copy link** — a link that opens the board, goes to the card and opens the
  conversation at that comment. If the comment has since been deleted, the
  link opens the board and says the comment isn't there any more.
- **Edit** — on your own comments. An edited comment is marked *edited*.
- **Delete** — a conversation's own **⋯** has **Delete conversation**, which
  takes its replies with it.

Resolving and deleting each show a toast with **Undo**.

### Who can do what

| | Who |
|---|---|
| Start a comment, reply | Anyone who can open the board |
| Edit a comment's words | Only the person who wrote it |
| Resolve or reopen | Whoever started the conversation, and anyone who can edit the board |
| Delete | The person who wrote it, and anyone who can edit the board |

A reply to a resolved conversation reopens it. If it stays resolved, the reply
is still sent and a toast says who can reopen it.

### Words you haven't sent

Nothing you type is lost by clicking somewhere else. A comment you started and
left keeps a pin of its own where you began it, and pressing that pin brings
the words back; an unfinished reply waits in its conversation. Drafts are kept
in this browser, for you. `Esc` in a box with words in it asks **Discard this
comment?** first, with **Keep writing** as the way back; in an empty box it just
closes.

## Mentions

Type `@` in a comment to mention someone. On the canvas, in a document and in a
note, it offers the people who can see the board. The person you name is
told, under the bell and by toast, and by email when they are not in the app,
and the notice opens that comment. A reply tells everyone who has written in
the conversation, a new comment tells the person who made the cluster, and
resolving tells whoever started the conversation; nobody is told about their
own comment. See [Notifications](/docs/collaborate/notifications).

Comments on a [shared file](/docs/collaborate/sharing#comments) have no `@`:
the people there may be outside your workspace.

## On the words of a note or a document

Select words in a note or a document and comment on them. The words are tinted
while their conversation is open for discussion, turn gold while you have it
open, and read as plain text again once it is resolved. Click commented words
to open their conversation.

A note with comments has **Comments** in its right-click menu, with a number:
it lists the note's conversations, **Open** and **Resolved**. A document lists
its own in its side panel; see [comments in
documents](/docs/documents/comments-and-tags).

## Who can comment

On the canvas, anyone who can open the board, including viewers. Editing a card
is a different right from talking about it, and feedback is the point of sharing
a board with someone. Public links are the exception: they are anonymous, and
comments need an account.

A comment on a **text range** is different: it lives inside the text of the
document or note, so it follows edit access. A viewer can open those
conversations and read them, but adding, replying to, resolving or deleting one
needs edit access.

## From your own code, or an assistant

The [Comments API](/docs/api/comments) lists a board's threads, the ones inside
its documents included, and adds, resolves and deletes comments; its page says
who may do each. Connected over [MCP](/docs/mcp), an assistant can read the
feedback on a board, act on it, reply, resolve what it dealt with, and comment
on the words of a document.

## Comments versus votes

- A **comment** is a sentence: reasoning, a request, a decision, with a thread and a record.
- A **[vote](/docs/canvas/vote-cards)** is a count: which of these, quickly, with no discussion.

If you want to know *why*, use a comment.
