---
title: Comments API — Read, Add and Resolve Comments — Soleil Clusters
metaDescription: List every comment thread on a Soleil Clusters board over REST, docs included, and add, reply, resolve, delete or restore comments.
h1: Comments API
navLabel: Comments
section: developers
order: 4.6
updated: 2026-10-25
answer: GET /boards/:id/comments lists a board's comment threads in one list, the ones on the canvas and the ones inside its docs and notes, each with its replies and who wrote what. POST adds a comment on a card, a group, a spot, the whole board or words in a doc, or a reply in any thread. PATCH resolves or reopens threads, and DELETE removes your own comment.
faq:
  - q: Who can comment, resolve or delete over the API?
    a: The same people as in the app. Anyone who can open a board can comment on it. A thread's author, or anyone who can edit the board, can resolve it. Only a comment's author can delete it.
  - q: Can I reply to a comment inside a doc?
    a: Yes, if you can edit the board, as in the app. You can also resolve threads there, and start one on words in a doc by quoting them.
  - q: Is the person I reply to told?
    a: A reply can email the author of the thread, as a reply made in the app does, when they are away and haven't turned reply emails off.
  - q: Can an AI assistant read and answer comments?
    a: Yes. The MCP server's list_comments, add_comment and resolve_comments tools are these endpoints, so an assistant can read the feedback on a board, act on it, resolve what it dealt with, and comment on a doc's words.
related:
  - /docs/collaborate/comments
  - /docs/api/docs
  - /docs/mcp
---

A board's [comments](/docs/collaborate/comments) are read and written here: the
bubbles on its canvas, and the threads inside its docs and notes. Everything
runs as you, so the API lets you do with a comment exactly what the app does.

## `GET /boards/:id/comments`

Every comment thread on the board, in one list: on the canvas, and inside its
docs and notes.

```json
{
  "board_id": "9f1c…", "status": "open", "counts": { "open": 2, "resolved": 5 },
  "threads": [
    { "id": "cm_k3v8x0q2", "on": "doc", "card_id": "d-4", "card_title": "Treatment",
      "page_title": "Opening", "quote": "at night",
      "body": "Too slow?", "author_name": "Sam Park", "by_you": false, "resolved": false, "replies": [] },
    { "id": "6a0e…", "on": "card", "card_id": "c-3", "card_title": "Hero still",
      "body": "Too dark", "author_name": "Ana Ruiz", "by_you": true, "resolved": false,
      "replies": [{ "id": "41bd…", "body": "Agreed", "author_name": "Sam Park", "by_you": false }] }
  ],
  "has_more": false, "next_cursor": null
}
```

Every thread and reply also carries `author_id` and `created_at`, and every
thread a `url` that opens it in the app.

| Parameter | |
|---|---|
| `status` | `open` (the default), `resolved`, or `all` |
| `limit` | Threads per page: {{fact:commentListDefault}} by default, at most {{fact:commentListMax}} |
| `cursor` | The `next_cursor` of the page before |

The liveliest thread comes first: one moves up when someone replies to it.
`counts` tells you how many are open and resolved, whichever you asked for.

Each thread says what it is `on`, and carries only the fields that go with it:

| `on` | Means | Also carries |
|---|---|---|
| `card` | A bubble on a card | `card_id`, `card_kind`, `card_title` |
| `group` | A bubble on a [group](/docs/canvas/groups) | `group_id` |
| `point` | A bubble at a spot on the canvas | `x`, `y` |
| `board` | A bubble about the board as a whole | — |
| `doc` | A thread on a run of a doc's text | `card_id`, `page_id`, `page_title`, `quote` |
| `note` | A thread on a run of a note's text | `card_id`, `quote` |

`quote` is the text the thread is on, up to {{fact:commentQuoteMax}} characters.
A name is the one the person set, else one made from their email, as the app
shows it. `by_you` marks what you wrote. A thread someone hid on the canvas
carries `hidden: true`. When the threads inside docs and notes can't be read
just then, the list holds the board's own and a `note` says so.

## `POST /boards/:id/comments`

A comment, in your name.

```json
{ "body": "Warmer grade?", "card_id": "c-3" }
```

| Field | |
|---|---|
| `body` | Required. Up to {{fact:commentMaxChars}} characters |
| `card_id` | On that card |
| `group_id` | On that group |
| `x`, `y` | At that spot on the canvas |
| `quote` | With a doc's `card_id`: on those words in the doc |
| `page_id` | With `quote`: the page the words are on |
| `reply_to` | In that thread, as a reply |

Send one of `card_id`, `group_id`, or `x` and `y`, or none of them for a comment
about the board as a whole. The bubble is placed as the app places one: beside
its card or group, on the side where it covers least, and a comment on the
whole board beside everything on it.

A reply takes no place of its own: it goes into its thread, wherever the thread
is, so it stays with the card when the card moves. `reply_to` can name the
thread or any reply in it.

It answers `201` with the comment as the list has it, or a reply as a thread's
replies are, with `reply_to` naming its thread.

### On words in a doc

With a doc's `card_id` and `quote`, the comment starts a thread on those words,
highlighted as a selection is when you comment in the app. Quote them as
[reading the doc](/docs/api/docs) gives them (spacing, curly quotes and Markdown
marks don't matter), up to {{fact:commentAnchorMax}} characters. Words that
aren't there, or are there more than once, answer `400` saying so: quote more of
the words around them, or name the page with `page_id`. A note's words take a
comment in the app.

## `PATCH /boards/:id/comments/:commentId`

```json
{ "resolved": true }
```

Resolves a thread, as its **Resolve** button does, or reopens it with `false`.
Name the thread: a reply answers `400`, naming its thread.

## `PATCH /boards/:id/comments`

```json
{ "comment_ids": ["cm_k3v8x0q2", "6a0e…"], "resolved": true }
```

Up to {{fact:commentResolveMax}} threads of either kind at once, each checked on
its own. The answer lists them as `changed` (one already so counts),
`not_found`, or `refused`, each refusal with a `code` and a `reason`.

## `DELETE /boards/:id/comments/:commentId`

Deletes a comment you wrote. On the canvas its replies go with it, and come
back with it. Like every delete, it needs a token with the `delete` scope. It
can be restored for {{fact:commentRestoreDays}} days:

## `POST /boards/:id/comments/:commentId/restore`

Brings a deleted comment back. Restoring one that isn't deleted changes nothing.

A thread of yours inside a doc can be deleted until someone else replies in it
(`409` after that: resolve it instead). Its highlight goes with it, for good.

## Who can do what

| | On the canvas | Inside docs and notes |
|---|---|---|
| Comment, or reply | Anyone who can open the board | An editor |
| Start a thread on words | — | An editor, in a doc |
| Resolve or reopen | The thread's author, or an editor | An editor |
| Delete | The comment's author | The thread's author |
| Restore | Its author, or an editor | — |

An editor is anyone who can edit the board. Anything else answers `403`. A
board you can't open, or a comment that isn't on it, answers `404`.

## Threads inside docs and notes

Their ids start `cm_`, and their replies' `cr_`. They live in the doc itself
and are written through the board's live room, so everyone with it open sees
them at once. When the room can't be reached nothing is written, and the answer
is `503` `room_unavailable`: try again. As in the app, a resolved thread takes
no reply until it is reopened (`409`).
