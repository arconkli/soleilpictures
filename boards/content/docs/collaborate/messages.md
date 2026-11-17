---
title: Messages — Soleil Clusters
metaDescription: Direct and group messages in Soleil Clusters. Message anyone you share a board with, drag attachments onto the canvas, deep-link to any message.
h1: Messages
navLabel: Messages
section: collaborate
order: 4
updated: 2026-11-17
answer: Messages holds your direct and group conversations with anyone you share a board with. Threads support attachments you can drag straight onto a canvas, @ mentions that link to real boards and cards, per-thread drafts, and unread counts that show in the browser tab title. Right-click any card or cluster and choose Send to… to send it as a preview card that opens it in the app.
faq:
  - q: Who can I message?
    a: Anyone you share at least one board with. There is no separate contact list to maintain. The one exception is Send to…: type an email address there and the card or cluster is shared with that person. An existing account gets it in Messages; anyone else gets an email invite.
  - q: Can I get a link to one specific message?
    a: Yes. Every message has a permalink that opens the thread scrolled to it.
  - q: What do the numbers in the tab title mean?
    a: Unread count. An @ prefix means at least one of them mentions you directly.
  - q: How do I send a card or cluster to someone?
    a: Right-click it and choose Send to…, pick people or type an email address, and press Send. It arrives in Messages as a preview card that opens the cluster with the card selected. If you can edit the cluster, anyone who could not open it yet gets view access.
related:
  - /docs/collaborate
  - /docs/collaborate/notifications
  - /docs/organize/links-and-mentions
---

Messaging exists so that the conversation about a board can happen next to the
board.

Open it from the sidebar or `⌘K` → "messages".

## Who you can message

**Anyone you share at least one board with.** Sharing is the address book —
there is no separate contact list to maintain, and no way to message someone you
have no working relationship with.

Click any collaborator's avatar to start a direct message with them.

Sending a card or cluster to an email address shares that cluster with them
first; see [Sending a card or cluster](#sending-a-card-or-cluster).

## Threads

Direct and group conversations in one list, ordered by recency.

- **A message's actions** — point at a message and click the **⋯** beside it, or right-click it: react, reply, copy its text or a link to it, pin it, and edit or delete your own
- **Press and hold** — on a phone or tablet, hold a message for the same actions. Hold a conversation in the list to hide it or leave
- **Attachments** — photos, files, links, cards and clusters sit under the words as cards, the way they look on a board. A cluster shows its cover, where it lives and how many cards it holds, and clicking it opens the cluster. Drag any of them from a thread straight onto a canvas to make it a card
- **Markdown and auto-links** — formatting is rendered, URLs unfurl
- **[Mentions](/docs/organize/links-and-mentions)** — `@` a person, board, document or card; boards and cards become navigable links, and a cluster's link shows its cover
- **Drafts** — a half-written message waits in its conversation, with its attachments and the message it replies to, when you switch conversations, close Messages or reload the page
- **Replies** — answer one message in particular: it's quoted at the top of your reply, and clicking the quote takes you to it
- **Edits and deletes** — your own messages; a deleted message goes at once, with Undo on the notice that follows
- **Pins** — once a conversation has pinned messages, the pin count at its top opens them in a list: each one takes you to its message, and **Unpin** takes it off
- **Seen** — in a direct message, “Seen” appears under your latest message once the other person has read it
- **Here now** — in a direct message, under the other person's name while they have the workspace open
- **Permalinks** — a link to one specific message, which opens the thread scrolled to it

## Writing

- **Enter** sends and **Shift+Enter** starts a new line; **⌘/Ctrl+Enter** sends too
- On a phone or tablet the return key starts a new line, and the **Send** button sends
- The box grows as you write, then scrolls once it's tall
- Attach files with the **+** at the start of the box, by pasting, or by dropping them on the box. Each shows as its own chip while it uploads, and you can keep typing; **Send** waits until they're all in, and one that fails says so, with **Retry**
- **Edit** opens your message in this same box, under an **Editing your message** line, and the same keys apply: **Enter** saves (on a phone or tablet, the ✓ does) and **Esc** cancels. Whatever you'd started writing waits until you're done
- A message that can't be sent stays in the conversation marked **Not sent**, with **Try again** and **Delete**

## Sending a card or cluster

Right-click a card or a cluster and choose **Send to…** to send it to people in
Messages. It's on any card on the canvas, on several selected cards at once
(up to {{fact:sendMaxCards}}; the menu's title shows how many), on a cluster's card, and on
a cluster in the sidebar. On a phone or tablet, use a card's **⋯** menu, or hold
a cluster in the sidebar.

- **Who's listed** — your recent conversations first, groups included, then everyone you can message. Search by name, or type a whole email address to send it to someone who isn't listed
- **Picking** — up to {{fact:sendMaxPeople}} at once: people, groups and email addresses together. Each person gets it in your direct conversation with them, and a group gets one message
- **A message** — anything you write goes with it, as the message's words
- **Access** — anyone you picked who can't open the cluster yet gets view access when you press **Send**, and the line beside **Send** names them before you do. Someone without an account gets an email invitation, and the cluster is waiting for them when they sign up. In a group, each member who needs it gets view access
- **If you can only view it** — you can still send it, but you can't let anyone in: the line beside **Send** names whoever won't be able to open it, and only people who can edit the cluster can send it to a new email address

Giving someone access counts toward your daily invitations, as it does from the
[share panel](/docs/collaborate/sharing#inviting-people). Past the limit, the
people you picked still get the message but can't open the cluster yet, an email
address gets nothing, and the notice after **Send** says so.

With a keyboard, `↑` and `↓` move through the list, `Enter` or `Space` picks,
`⌘/Ctrl+Enter` sends and `Esc` closes.

### What arrives

A preview card, the same whoever sent it:

- **On top**, what it is: the picture, the start of a note, a palette's colours, the first few of several cards, or four of a cluster's pictures and how many cards it holds
- **Below**, its name and where it lives — "Card · Night shoot", "3 cards · Night shoot", "Cluster in Soleil" — and **Open**
- **Open** goes straight to the cluster in the app with the card, or the cards, centred and selected, even when the cluster was shared with you a moment ago or lives in another of your workspaces
- **No access** — someone who can't open the cluster, or whose cluster is in the Trash, sees "You can't open Night shoot." in place of its pictures, and no **Open**

A message with no words reads "Sent a card: Alley, neon" in the list of
conversations, and in the notice and the notification that announce it.

## Keyboard

With a keyboard, a conversation opens with the box you type in ready.

| Key | What it does |
|---|---|
| `Enter` · `Shift+Enter` | Send · start a new line |
| `↑` in an empty box | Edit your last message, up to {{fact:messageEditWindowMin}} minutes after you sent it |
| `⌘F` / `Ctrl+F` | Search the conversation |
| `Esc` | Close what's on top — a menu, an edit, the reply, the search — then the panel, unless there's something typed in the box |

Click anywhere in the conversation outside the box, and these move through it:

| Key | What it does |
|---|---|
| `J` · `K` | Next · previous message |
| `R` | Reply to that message |
| `E` | Edit it, if it's yours |

## Unread

Unread counts appear on the sidebar and in the **browser tab title** — `(3)` for
unread, `(@2)` when at least one mentions you directly, so you notice from
another tab.

A conversation counts as read once its newest message has been on your screen,
not just because it's open. A **New** line marks where you left off, and when
more has arrived than fits, the conversation opens at that line rather than
the bottom. Scrolled up in a long one, you stay where you are when something new
arrives, and a button takes you back down to the latest.

## Messages versus comments

The distinction worth keeping:

- A **[comment](/docs/collaborate/comments)** is attached to a thing on a board and stays with it. It is a record.
- A **message** is a conversation with a person. It is correspondence.

Feedback on a specific image belongs in a comment, where whoever opens that
board next will find it. Coordination belongs in a message.
