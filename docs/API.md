# Soleil Clusters API (`/api/v1`)

Read and write your boards from your own software, or from an AI assistant.

Base URL: `https://clusters.soleilpictures.com/api/v1`

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

Two scopes: every token can `read`; ticking **Allow writes** when you create it
adds `write`. A read-only token gets `403` on anything that changes data. Tokens
are stored only as a SHA-256 hash, so the value is shown once, at creation, and
cannot be recovered afterwards — lost tokens get revoked and replaced.

Rate limit: 1000 requests per hour per token (`429` past that).

## Endpoints

| | |
|---|---|
| `GET /me` | who this token belongs to, and its scopes |
| `GET /workspaces` | workspaces you can see |
| `GET /boards` | boards; `?workspace=<uuid>`, `?parent=<uuid>` or `?parent=root` |
| `POST /boards` | create a board |
| `GET /boards/:id` | one board |
| `PATCH /boards/:id` | rename, change view, or reparent |
| `DELETE /boards/:id` | soft-delete (restorable in the app) |
| `GET /boards/:id/cards` | every card on the board |
| `POST /boards/:id/cards` | add cards |
| `PATCH /boards/:id/cards/:cardId` | change a card |
| `DELETE /boards/:id/cards/:cardId` | remove a card |
| `POST /boards/:id/cards/move` | move cards to another board |

### Adding cards

```sh
curl -X POST https://clusters.soleilpictures.com/api/v1/boards/$BOARD/cards \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"cards":[{"kind":"note","title":"Scene 4","body":"diner, night"},
                {"kind":"link","url":"https://example.com/ref"}]}'
```

Cards you don't position are placed in free space, so they can't land on top of
what's already on the board. Pass `x` and `y` to place one yourself.

`kind` is one of `note`, `image`, `link`, `doc`. Image cards take an `image_key`
that already exists in storage — **this API does not upload files.**

The response includes `"live": true|false`. `false` means the cards are saved
but an already-open canvas won't show them until it reloads.

### Deleting

`DELETE` on a card returns the card it removed, in full. There's no undo toast
on an HTTP call, so the response body *is* the undo — `POST` it back to restore
it. Deleting a board is a soft delete; it stays restorable from the app.

### Retries

Send an `Idempotency-Key` header on `POST` and a retry with the same key replays
the original response instead of doing the work twice:

```sh
-H "Idempotency-Key: $(uuidgen)"
```

Keys are remembered for 24 hours. `PATCH` and `DELETE` are already idempotent.

### Errors

JSON, with an `error` string. `401` bad or revoked token · `403` read-only token,
or something your account can't reach · `402` you've hit your card cap ·
`404` not found (including boards you can't see) · `409` idempotency key still in
flight, or a reparent that was refused · `429` rate limited.

## MCP

`mcp/` in this repo is a small MCP server over the same API, so Claude and other
assistants can use it with your token. See [`mcp/README.md`](../mcp/README.md).
