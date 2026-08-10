# Import

> POST /boards/:id/import takes a list of https URLs and brings them onto a board. Images are downloaded and stored; anything else becomes a link card pointing at the original, and the response says which happened to each item. Every card is stamped with a source_url identifier and the import resolves on it, so running the same manifest twice updates the same cards rather than duplicating them.

_Source: https://clusters.soleilpictures.com/docs/api/import · Updated 2026-08-10_

Reference rarely starts life in Clusters. It is in a shared drive folder, on a
CDN, in somebody's export from another tool. `import` is how it gets here
without being re-uploaded by hand.

```sh
curl -X POST https://clusters.soleilpictures.com/api/v1/boards/$BOARD/import \
  -H "Authorization: Bearer undefined…" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "url": "https://cdn.example.com/ref/diner-01.jpg", "title": "Diner counter" },
      { "url": "https://cdn.example.com/ref/diner-02.jpg" },
      { "url": "https://example.com/treatment-v4.pdf" }
    ]
  }'
```

```json
{
  "board_id": "…",
  "imported": 2,
  "updated": 0,
  "failed": 0,
  "items": [
    { "url": "https://cdn.example.com/ref/diner-01.jpg", "ok": true, "kind": "image", "card_id": "…" },
    { "url": "https://cdn.example.com/ref/diner-02.jpg", "ok": true, "kind": "image", "card_id": "…" },
    { "url": "https://example.com/treatment-v4.pdf", "ok": true, "kind": "link",
      "note": "application/pdf is not an image — linked instead of imported", "card_id": "…" }
  ]
}
```

## It is safe to run twice

This is the point of the endpoint, not a footnote. Every imported card is
stamped with an identifier in the `source_url` scope holding the
URL it came from, and the import resolves on that identifier. Run the same
manifest again and the same cards are **updated** rather than added a second
time — the response tells you which, in `imported` versus `updated`.

That means an import that half-failed does not need unpicking. Fix the dead
links and run the whole thing again.

It also means you can find anything you brought in:

```sh
curl "https://clusters.soleilpictures.com/api/v1/resolve?scope=source_url&value=https://cdn.example.com/ref/diner-01.jpg" \
  -H "Authorization: Bearer undefined…"
```

## What each source becomes

| The source is | You get |
|---|---|
| An image format the API stores (`doc`, `file`, `image`, `link`, `note`, `video` covers the card kinds; see [Images](/docs/api/images)) | An **image card** — the bytes are copied into your workspace |
| Anything else — a PDF, a web page, a video | A **link card** pointing at the original, with a `note` saying why |

Only images are copied. Large media goes through the
[multipart upload endpoints](/docs/api/images), which stream from the client
rather than pulling gigabytes through the API — a link card is the honest
answer here rather than a silent half-import.

## Limits and refusals

- At most **100 items** per call.
- Each source must be an **https URL on a public host**. Internal and
  link-local addresses are refused, and one bad address fails the whole
  manifest before anything is fetched — an import that silently skipped it
  would still have told you the manifest was fine.
- Each image is subject to the same **25 MB** ceiling as a direct
  upload, and the same storage allowance.
- A source that does not answer within **15 seconds**
  fails that item; the rest still import.
- The same URL twice in one manifest is refused: both entries would race for the
  same identifier and one would silently win.

## Checking a list first

```sh
curl -X POST https://clusters.soleilpictures.com/api/v1/boards/$BOARD/import \
  -H "Authorization: Bearer undefined…" \
  -H "Content-Type: application/json" \
  -d '{ "items": [ … ], "dry_run": true }'
```

Validates every URL and creates nothing. Worth doing before pointing a
hundred-item manifest at a board.

## How it is laid out

Imported cards are arranged as **justified rows** by default — equal-height
rows at each picture's true aspect ratio, flush on both edges. Pass `layout`
to choose another, or re-run [`POST /boards/:id/arrange`](/docs/api/arrange)
afterwards to try a different one.

## Positioning and metadata

Items accept the same `x`, `y`, `w`, `h` as [cards](/docs/api/cards), and the
same `props` and `identifiers` as [metadata](/docs/api/metadata). Anything
without coordinates is arranged around what is already on the board.

Your own properties are kept, but the import always records where a card came
from and that record wins — an import cannot be made to misreport its own
source.
