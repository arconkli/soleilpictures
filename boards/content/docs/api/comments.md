---
title: Comments API — Read, Add and Resolve Comments — Soleil Clusters
metaDescription: List every comment thread on a Soleil Clusters board over REST, the ones inside its docs included, and add, resolve, delete or restore comments.
h1: Comments API
navLabel: Comments
section: developers
order: 4.6
updated: 2026-10-25
answer: GET /boards/:id/comments lists a board's comment threads in one list, the ones on the canvas and the ones inside its docs and notes, each with its replies and who wrote what. POST /boards/:id/comments adds a comment on a card, a group, a spot or the whole board, or a reply in a thread. PATCH resolves or reopens a thread, and DELETE removes your own comment, which can be restored for {{fact:commentRestoreDays}} days.
faq:
  - q: Who can comment, resolve or delete over the API?
    a: The same people as in the app. Anyone who can open a board can comment on it. A thread's author, or anyone who can edit the board, can resolve it. Only a comment's author can delete it.
  - q: Can I reply to a comment inside a doc?
    a: Threads inside a doc or a note are listed, with the text they are on, and answered or resolved in the app. Over the API they are read only.
  - q: Is the person I reply to told?
    a: A reply can email the author of the thread, as a reply made in the app does, when they are away and haven't turned reply emails off.
  - q: Can an AI assistant read and answer comments?
    a: Yes. The MCP server's list_comments, add_comment and resolve_comments tools are these endpoints, so an assistant can read the feedback on a board, act on it and resolve what it dealt with.
related:
  - /docs/collaborate/comments
  - /docs/api/docs
  - /docs/mcp
---

A board's [comments](/docs/collaborate/comments) are read and written here: the
bubbles on its canvas, and, to read, the threads inside its docs and notes.
Everything runs as you, so the API lets you do with a comment exactly what the
app does.

## `GET /boards/:id/comments`

Every comment thread on the board, in one list: on the canvas, and inside its
docs and notes.

```json
{
  "board_id": "9f1c…", "url": "…", "status": "open",
  "counts": { "open": 2, "resolved": 5 },
  "threads": [
    { "id": "cm_k3v8x0q2", "on": "doc", "card_id": "d-4", "card_kind": "doc", "card_title": "Treatment",
      "page_id": "p_7hd2w9zr8b0e", "page_title": "Opening", "quote": "at night",
      "body": "Too slow?", "author_id": "…", "author_name": "Sam Park", "by_you": false,
      "created_at": "2026-10-24T18:02:11.000Z", "resolved": false, "replies": [], "url": "…" },
    { "id": "6a0e…", "on": "card", "card_id": "c-3", "card_kind": "image", "card_title": "Hero still",
      "body": "Too dark", "author_id": "…", "author_name": "Ana Ruiz", "by_you": true,
      "created_at": "2026-10-20T10:00:00.000Z", "resolved": false,
      "replies": [
        { "id": "41bd…", "body": "Agreed", "author_id": "…", "author_name": "Sam Park", "by_you": false,
          "created_at": "2026-10-21T10:00:00.000Z" }
      ],
      "url": "…" }
  ],
  "has_more": false, "next_cursor": null
}
```

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
| `reply_to` | In that thread, as a reply |

Send one of `card_id`, `group_id`, or `x` and `y`, or none of them for a comment
about the board as a whole. The bubble is placed as the app places one: beside
its card or group, on the side where it covers least, and a comment on the
whole board beside everything on it.

A reply takes no place of its own: it goes into the thread, under its first
comment, wherever the thread is, so it stays with the card when the card moves.
`reply_to` can name the thread or any reply in it.

```json
{
  "board_id": "9f1c…",
  "comment": { "id": "6a0e…", "on": "card", "card_id": "c-3", "card_kind": "image", "card_title": "Hero still",
    "body": "Warmer grade?", "author_id": "…", "author_name": "Ana Ruiz", "by_you": true,
    "created_at": "…", "resolved": false, "replies": [], "url": "…" },
  "url": "https://clusters.soleilpictures.com/?to=c:9f1c…:c-3"
}
```

That is a `201`. A reply comes back as a thread's replies do, with `reply_to`
naming its thread.

## `PATCH /boards/:id/comments/:commentId`

```json
{ "resolved": true }
```

Resolves a thread, as its **Resolve** button does, or reopens it with `false`.
Name the thread: a reply answers `400`, naming its thread.

## `DELETE /boards/:id/comments/:commentId`

Deletes a comment you wrote. Its replies go with it, and come back with it.
Like every delete, it needs a token with the `delete` scope. It can be restored
for {{fact:commentRestoreDays}} days:

## `POST /boards/:id/comments/:commentId/restore`

Brings a deleted comment back. Restoring one that isn't deleted changes nothing.

## Who can do what

| | Who |
|---|---|
| Comment, or reply | Anyone who can open the board, viewers included |
| Resolve or reopen | The thread's author, or anyone who can edit the board |
| Delete | The comment's author |
| Restore | Its author, or anyone who can edit the board |

Anything else answers `403`. A board you can't open, or a comment that isn't on
it, answers `404`.

## Threads inside docs and notes

A thread on a run of text inside a doc or a note lives in the doc itself, beside
its words. The list reads them, with the text they are on; their ids start
`cm_`. They are answered and resolved in the app, so writing one here answers
`400`.
