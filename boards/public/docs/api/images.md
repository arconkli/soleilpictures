# Images API

> POST raw image bytes to /uploads with a board id and you get back an image key, which you then pass as image_key when creating a card. It is one request rather than a presign dance, images are limited to 25 MB through the API, and the upload is charged against the board owner's storage quota.

_Source: https://clusters.soleilpictures.com/docs/api/images · Updated 2026-08-08_

Uploading is **one request**. No presign, no multi-step S3 dance — which is what
makes it usable from a single tool call.

## `POST /uploads?board=<uuid>`

Raw bytes in the body, `Content-Type` set to the image's real type.

```sh
curl -X POST "$SOLEIL_API/uploads?board=$BOARD" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" \
  -H "Content-Type: image/jpeg" \
  --data-binary @frame.jpg
```

```json
{
  "image_key": "3b7e…/9f1c….jpg",
  "width": 3024,
  "height": 4032,
  "bytes": 2841923,
  "content_type": "image/jpeg",
  "next": "POST /api/v1/boards/…/cards with {\"kind\":\"image\",\"image_key\":\"…\"}"
}
```

The response spells out the next call, because it is not guessable from the key
alone.

The `?board=` parameter is required: an upload is charged to a board, and write
access to that board is checked before anything is stored.

## Then place it

```sh
curl -X POST "$SOLEIL_API/boards/$BOARD/cards" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"kind":"image","image_key":"3b7e…/9f1c….jpg","alt":"Diner counter, night"}'
```

Pass `alt` for a description. Omit `x`/`y` and the card is
[placed in free space](/docs/api/cards).

## Limits

| | |
|---|---|
| **Types** | JPEG, PNG, GIF, WebP, HEIC, AVIF |
| **Size** | 25 MB per image through the API |
| **Storage** | Counted against the **board owner's** quota |

A missing or unrecognised `Content-Type` gets `415` — the file extension is
derived from the declared type, so it has to be right.

An empty body gets `400`. Over the size ceiling gets `413`. Past the owner's
storage quota gets `402`. See [Errors](/docs/api/errors).

> **Note:** 25 MB is the API's own ceiling and is lower than what
> the app accepts, because a single buffered request is not the right shape for
> a very large file. Large media goes in through the app, which uploads in
> parts. See [Files and uploads](/docs/files).

## `GET /images/:key`

Reads an image back. Access is authorized the same way as everything else — you
get the image if your account can see a board that references it.

### Smaller renditions

Add `?variant=preview` for the downscaled copy the app stores when an image is
uploaded — roughly 900px and about 48 kB, against ~470 kB for a typical
original. It is more than enough to look at, and about ten times cheaper to
move, which matters if you are reading a whole moodboard or handing images to a
model.

Not every image has one, so this **falls back to the original** rather than
failing. The `X-Image-Variant` response header tells you which you got:

```sh
curl -sD- -o shot.webp \
  "https://clusters.soleilpictures.com/api/v1/images/$KEY?variant=preview" \
  -H "Authorization: Bearer $TOKEN" | grep -i x-image-variant
# x-image-variant: preview
```

The MCP server's `view_image` asks for this by default.

## Why the images row matters

An upload does two things: it stores the object, and it records a row that
authorizes reads and marks the object as in use.

If the row cannot be written the upload **fails and the object is deleted**,
rather than returning a key that would never resolve and would be swept away
later. An upload that returns `201` is an upload that is fully durable.

## Storage lifecycle

Files referenced by a board are protected from cleanup for as long as the board
references them. Removing the last card that uses an image makes it eligible for
reclamation later, not immediately — so deleting a card and restoring it from
the [delete response](/docs/api/cards) works.
