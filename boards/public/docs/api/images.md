# Images API

> POST raw image bytes to /uploads with a board id and you get back an image key, which you then pass as image_key when creating a card. It is one request rather than a presign dance. Files larger than the one-request ceiling go through /uploads/multipart, where you PUT the parts straight to storage and the bytes never pass through the API. Either way the upload is charged against the board owner's storage quota.

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

> **Note:** 25 MB is the ceiling on this **one-request** form,
> because the whole body is held in memory to read its header. Larger files go
> through the multipart endpoints below, which have no such limit.

## Large files

`POST /uploads` is the convenient path. For anything bigger than
25 MB — camera media, ProRes, a scan of a whole lookbook — use
multipart, where **the bytes never pass through the API at all**. You get signed
URLs and `PUT` directly to storage, in parallel, at whatever speed your
connection allows.

Four calls, and only the first and last are API requests.

### 1. Start

```sh
curl -X POST "$SOLEIL_API/uploads/multipart?board=$BOARD" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"bytes":53687091200,"content_type":"video/quicktime","filename":"reel_01.mov"}'
```

```json
{ "key": "3b7e…/9f1c….mov", "upload_id": "2~abc…", "part_size": 8388608, "part_count": 6400 }
```

`bytes` is required: the storage quota is checked against the **total size up
front**, so a file that will not fit is refused before you send any of it.

### 2. Get signed URLs

```sh
curl -X POST "$SOLEIL_API/uploads/multipart/parts" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"board_id":"'$BOARD'","key":"…","upload_id":"…","part_numbers":[1,2,3]}'
```

Up to 1000 part numbers per call. Ask for them in batches as
you go — signed URLs are time-limited, so requesting 6,400 at once is worse than
requesting them as you need them.

### 3. `PUT` each part **to the returned URL**

Not to this API. Each response carries an `ETag`; keep it with its part number.
Parts may be uploaded in any order and in parallel.

**Upload many parts at once.** Nothing sits between you and storage on this
path, so your throughput is your own connection — but only if you keep it busy.
Each part is a separate HTTPS request, and a few in flight spends most of its
time in handshakes and TCP ramp-up rather than sending bytes. Measured over one
324 Mbit link, same code, varying only how many parts were in flight:

| in flight | throughput | share of the link |
|---|---|---|
| 4 | 18.5 MB/s | 46% |
| 15 | 31.8 MB/s | 78% |
| 30 | 36.9 MB/s | **91%** |

Around 30 concurrent parts saturates a link; the remainder is protocol
overhead. Uploading several files at once counts the same way — it is total
requests in flight that matters, not how they are grouped.

### 4. Finish

```sh
curl -X POST "$SOLEIL_API/uploads/multipart/complete" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"board_id":"'$BOARD'","key":"…","upload_id":"…",
       "parts":[{"part_number":1,"etag":"\"a1b2…\""}]}'
```

Returns the `image_key`, which you place as a card exactly as above. Dimensions
come back for formats that carry them in a header; other files report `null`.

`POST /uploads/multipart/abort` with the same `key` and `upload_id` discards an
upload you have given up on, so the parts are not billed as storage.

Multipart needs a paid account on the workspace that owns the board — the same
rule the app applies. Without one the first call returns `403`.

Every step re-checks write access to the board. A signed part URL is a
capability, so nothing relies on a check made three calls earlier.

## `GET /images`

Lists what is already stored, so an interrupted bulk upload can be resumed
without re-sending everything.

```sh
curl "$SOLEIL_API/images?workspace=$WS&limit=500" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

```json
{
  "images": [
    { "image_key": "3b7e…/9f1c….jpg", "bytes": 2841923, "width": 3024, "height": 4032,
      "board_id": "…", "workspace_id": "…", "created_at": "2026-08-08T12:00:00Z" }
  ],
  "limit": 500,
  "has_more": true,
  "next_cursor": "2026-08-08T12:00:00Z|9f1c…"
}
```

Filter with `workspace`, `board` and `since` (an ISO timestamp).

Paging is by **cursor**, not offset: pass `next_cursor` back as `cursor`. Offset
paging makes the database walk and discard every row it skips, so it gets slower
the further in you go — which only bites once a listing is long, which is
exactly when you need it.

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
