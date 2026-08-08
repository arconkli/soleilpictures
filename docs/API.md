# Soleil Clusters API (`/api/v1`)

Read and write your boards from your own software, or from an AI assistant.

Base URL: `https://clusters.soleilpictures.com/api/v1`
· Machine-readable: [`/api/v1/openapi.json`](https://clusters.soleilpictures.com/api/v1/openapi.json) (OpenAPI 3.1, no token needed)

## Authentication

Mint a personal access token in the app under **Settings → API**, and send it as
a bearer token:

```sh
curl https://clusters.soleilpictures.com/api/v1/me \
  -H "Authorization: Bearer sk_live_…"
```

A token acts **as you**. It can reach exactly what your account can reach and
nothing more — the API exchanges your token for your own session and every call
runs under the same row-level security the app uses. There is no separate
permission system to get out of step.

Tokens are stored only as a SHA-256 hash, so the value is shown once, at
creation, and cannot be recovered afterwards — lost tokens get revoked and
replaced.

### Scopes

| | |
|---|---|
| `read` | Always granted. Every `GET`. |
| `write` | Create boards, add and change cards, upload images, move things. |
| `delete` | Remove cards and boards. **Separate on purpose.** |

`delete` is its own scope because "may add to my moodboard" and "may destroy my
moodboard" are not the same decision — particularly when the token is going to a
language model. Ticking delete implies write.

Anything a token lacks the scope for returns `403` with
`code: "insufficient_scope"` and the scopes it does have.

### Rate limit

1000 requests per hour per token. Every response carries the window:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 987
X-RateLimit-Reset: 1754700000     # unix seconds
```

Past the limit you get `429` and a `Retry-After` in seconds.

## Endpoints

| | |
|---|---|
| `GET /me` | who this token belongs to, its scopes, its remaining budget |
| `GET /workspaces` | workspaces you can see |
| `GET /search` | find boards and cards by text |
| `GET /boards` | boards; `?workspace=`, `?parent=<uuid>|root`, `?deleted=1` |
| `POST /boards` | create a board |
| `GET /boards/:id` | one board, with its remaining card capacity |
| `PATCH /boards/:id` | rename, change view, or reparent |
| `DELETE /boards/:id` | soft-delete |
| `POST /boards/:id/restore` | undo that |
| `GET /boards/:id/cards` | cards on the board |
| `POST /boards/:id/cards` | add cards |
| `PATCH /boards/:id/cards/:cardId` | change a card |
| `DELETE /boards/:id/cards/:cardId` | remove a card |
| `POST /boards/:id/cards/move` | move cards to another board |
| `POST /uploads?board=:id` | upload image bytes |
| `GET /images/:key` | fetch an uploaded image |

### Paging

`GET /boards`, `GET /boards/:id/cards` and `GET /search` take `limit` (default
100, max 500) and `offset`, and answer with `has_more` and `next_offset`.
Nothing is ever silently truncated.

### Adding cards

```sh
curl -X POST https://clusters.soleilpictures.com/api/v1/boards/$BOARD/cards \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"cards":[{"kind":"note","title":"Scene 4","body":"diner, night"},
                {"kind":"link","url":"https://example.com/ref"}]}'
```

Cards you don't position are placed in free space, so they can't land on top of
what's already on the board. Pass `x` and `y` to place one yourself.

`kind` is one of `note`, `image`, `link`, `doc`. An unrecognised kind is
**refused**, not quietly turned into a note.

`body` is the text of a card whatever its kind — the API translates to whichever
field that kind actually uses, so reading a card and writing it back is
lossless.

The response includes `"live": true|false`. `false` means the cards are saved
but an already-open canvas won't show them until it reloads.

### Images

Two steps: upload the bytes, then make a card that points at them.

```sh
KEY=$(curl -s -X POST "https://clusters.soleilpictures.com/api/v1/uploads?board=$BOARD" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: image/jpeg" \
  --data-binary @still.jpg | jq -r .image_key)

curl -X POST https://clusters.soleilpictures.com/api/v1/boards/$BOARD/cards \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"cards\":[{\"kind\":\"image\",\"image_key\":\"$KEY\",\"alt\":\"diner exterior\"}]}"
```

The raw bytes go in the body with `Content-Type` set to the image type — jpeg,
png, gif, webp, heic or avif. 25MB maximum. `?board=` is required because the
upload is charged against that board owner's storage.

Width and height come back when they can be read from the file header; HEIC and
AVIF report `null` and the card falls back to a default size.

`GET /images/<key>` returns the bytes for any key your account can see. The key
contains slashes — send it as-is after `/images/`.

### Search

```sh
curl -G https://clusters.soleilpictures.com/api/v1/search \
  -H "Authorization: Bearer $TOKEN" --data-urlencode "q=diner"
```

Searches board names, and card titles and bodies. Punctuation is matched
literally: `50%` finds a card that says "50%", not every card. Card hits carry a
300-character `excerpt` rather than the whole card — fetch the board for the
rest. `?kind=board` or `?kind=card` narrows it; `?workspace=` scopes it.

### Deleting

`DELETE` on a card returns the card it removed, in full. There's no undo toast
on an HTTP call, so the response body *is* the undo — `POST` it back to restore
it. Deleting a board is a soft delete: find it again with `GET /boards?deleted=1`
and put it back with `POST /boards/:id/restore`.

Both need the `delete` scope.

### Retries

Send an `Idempotency-Key` header on `POST` and a retry with the same key replays
the original response instead of doing the work twice:

```sh
-H "Idempotency-Key: $(uuidgen)"
```

Keys are remembered for 24 hours. `PATCH` and `DELETE` are already idempotent.

### Errors

JSON, with a human `error` and a stable `code`. Branch on the code — the message
is written for a person and may be reworded.

| status | code | |
|---|---|---|
| 401 | `invalid_token` | bad, revoked or expired |
| 403 | `insufficient_scope` | the token lacks `write` or `delete` |
| 403 | `forbidden` | your account can't reach that |
| 404 | `not_found` | including things you can't see |
| 402 | `limit_reached` | card cap or storage quota |
| 409 | `conflict` | a refused reparent, or an in-flight idempotency key |
| 413 | `payload_too_large` | over 25MB |
| 415 | `unsupported_media_type` | not an image type we accept |
| 429 | `rate_limited` | see `Retry-After` |

## MCP

[`mcp/`](../mcp/README.md) in this repo is an MCP server over the same API, so
Claude and other assistants can use it with your token — including looking at
the actual images on a board.
