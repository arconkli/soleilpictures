# Docs API

> A doc card's pages are read and written as Markdown. GET /boards/:id/cards/:cardId/doc reads every page with a hash of each; POST /boards/:id/docs makes a doc holding up to 50 pages; POST …/doc/pages adds pages; PATCH …/doc/pages/:pageId rewrites, edits or renames one page. A rewrite names the hash the page was read at, so it never erases a change made since, and it keeps every block it didn't change, comments included.

_Source: https://clusters.soleilpictures.com/docs/api/docs · Updated 2026-10-25_

A [doc](/docs/documents) card holds pages of writing. Over the API you read
them and write them as Markdown, page by page: the same Markdown the
[export](/docs/documents/export) gives you.

## `GET /boards/:id/cards/:cardId/doc`

A doc card's text: every page, in the order its page list shows them, as
Markdown.

```json
{
  "board_id": "9f1c…", "card_id": "c-3", "title": "Treatment", "url": "…",
  "page_count": 2,
  "pages": [
    { "id": "p1", "title": "Opening", "parent_id": null, "depth": 0,
      "markdown": "A diner at night…\n", "chars": 1840, "hash": "5d1f0c2a", "truncated": false },
    { "id": "p2", "title": "Close", "parent_id": null, "depth": 0,
      "markdown": null, "chars": 960, "hash": "0be4a9d1", "truncated": false }
  ],
  "complete": false
}
```

| Parameter | |
|---|---|
| `page` | One page, by its `id` |
| `max_chars` | Markdown handed back across the pages: 20,000 characters by default, at most 200,000 |

Pages fill in order until `max_chars` runs out. The page that crosses it is cut
and marked `truncated`, and any after it come back with `markdown: null`, so
every page is listed with its length in `chars` either way. `complete` says
whether you have all of it; read the rest one `page` at a time. A page nested
under another carries that page's id in `parent_id`, and a `depth` one more.

Links in the text carry their real address, and comments are left out. An
uploaded image's source is `r2:` followed by its storage key. A screenplay
reads one line to a paragraph, scene headings in bold. `hash` changes whenever
the page's Markdown does, and a read of one `page` carries it as the `ETag`.

A card that is not a doc answers `400`, naming the route that reads it.

## `POST /boards/:id/docs`

A new doc card holding the pages you send, placed in free space on the board,
or at `x` and `y`.

```json
{
  "title": "Tokyo noir",
  "pages": [
    { "title": "Logline", "markdown": "A night-shift detective follows a dead phone through Shinjuku." },
    { "markdown": "# Places\n\n- Shinjuku\n- [Golden Gai](https://example.com/gg)" }
  ]
}
```

| Field | |
|---|---|
| `pages` | Required. Up to 50, each `{ title?, markdown }`, with up to 200,000 characters of Markdown between them |
| `title` | The card's title. Left out, its one page's title, else "Untitled doc" |
| `x`, `y` | Where the card goes. Left out, it is placed where it covers nothing |

A page with no `title` takes the words of its first heading, and a first page
with neither takes the card's title, as a new doc's first page does in the app.
Titles are cut at 200 characters.

```json
{
  "board_id": "9f1c…",
  "card": { "id": "api-m2x9k1-a81f3c", "kind": "doc", "title": "Tokyo noir", … },
  "url": "https://clusters.soleilpictures.com/?to=c:9f1c…:api-m2x9k1-a81f3c",
  "pages": [
    { "id": "p_k3v8x0q2m1c4", "title": "Logline", "parent_id": null, "depth": 0, "chars": 64, "hash": "5d1f0c2a" },
    { "id": "p_7hd2w9zr8b0e", "title": "Places", "parent_id": null, "depth": 0, "chars": 57, "hash": "0be4a9d1" }
  ],
  "live": true
}
```

That is a `201`. The doc counts as one card toward the
[card cap](/docs/canvas/cards).

## `POST /boards/:id/cards/:cardId/doc/pages`

More pages for a doc that exists: after the pages it has, or, with
`parent_page_id`, under that page as its sub-pages. `pages` is as above. The
answer is a `201` listing the new pages.

## `PATCH /boards/:id/cards/:cardId/doc/pages/:pageId`

One page changed, in one of three ways:

| Send | Does |
|---|---|
| `markdown` and `page_hash` | Rewrites the page. `markdown` is the whole page as it should now read; `page_hash` is the `hash` you read it at, or send that as `If-Match` |
| `edits` | Up to 50 `{ "old_text", "new_text" }`, applied in order. Each `old_text` must appear in the page's Markdown exactly once |
| `title` | Renames the page, alone or with either of the others |

```json
{
  "markdown": "# Places\n\n- Shinjuku at 4am\n- [Golden Gai](https://example.com/gg)\n",
  "page_hash": "0be4a9d1"
}
```

```json
{
  "board_id": "9f1c…", "card_id": "api-m2x9k1-a81f3c", "url": "…",
  "page": { "id": "p_7hd2w9zr8b0e", "title": "Places", "parent_id": null, "depth": 0, "chars": 66, "hash": "77a0e3b4" },
  "blocks": { "kept": 1, "removed": 1, "added": 1 },
  "changed": true
}
```

**Only what you changed is rewritten.** The page you send is matched against
the page as it stands, block by block, by each block's Markdown. A heading,
paragraph, list, table or quote whose Markdown you left alone stays the same
block, so a comment on it, its text colour, an embedded board and anything else
Markdown has no words for stay with it. `blocks` counts what was kept, removed
and added. Send a page back as it was and nothing is written: `changed` is
`false`.

**A rewrite can't erase anyone's change.** When the page's hash is no longer
the one you name, the write is refused with `409 page_changed` and nothing is
written. Read the page again and make your change to that. `edits` need no
hash, because the exact text each one names is its own check.

Before a page is rewritten or edited, the board is saved to its
[Version history](/docs/clusters/trash-and-recovery#version-history) as it was,
marked API.

## What the Markdown carries

| Markdown | In the doc |
|---|---|
| `#` to `######` | Headings |
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `==highlight==`, `<u>underline</u>`, `<sub>`, `<sup>` | The same marks |
| `-` and `1.` lists, nested | Lists, numbered from where yours starts |
| `- [ ]` and `- [x]` | A checklist, when every item in the list is one |
| `>` | A quote |
| Fenced code | A code block, with its language |
| Tables | Tables, each column aligned as you aligned it |
| `---` | A divider |
| `[words](https://…)`, a bare `https://` address, `mailto:` | Links |
| `![caption](r2:<image_key>)` | A picture, when the file is already on the board |
| A single line break | A line break; a blank line starts a new paragraph |

Links go only to `http`, `https` and `mailto` addresses; any other keeps its
words without the link. A picture is placed only from a file already on the
board: an image card's `image_key` from
[`GET /boards/:id/cards`](/docs/api/cards), written `r2:<image_key>` as a read
gives it back (the bare key works too). Any other picture becomes a link to its
address, so writing a doc never fetches anything into it. Other HTML stays as
text.

A screenplay is written in the app. The API writes prose docs, and answers
`400` for a screenplay.

## Live, or not at all

Doc writes go through the cluster's live room, as an edit in the app does, so
anyone with the doc open sees the change land, on the board or in a
[doc shared on its own](/docs/collaborate/sharing#sharing-a-doc). When the room
can't be reached, or doesn't confirm the change, the answer is
`503 room_unavailable` and nothing was written: try again.

Search inside documents finds what you wrote straight away.
