# The REST API

> The Soleil Clusters REST API lives at /api/v1 and is authenticated with a personal access token sent as a bearer token. A token acts as you — every call runs under exactly the permissions your account has in the app. Responses are JSON, errors carry both a machine-readable code and a human sentence, list endpoints paginate, and a full OpenAPI description is published at /api/v1/openapi.json.

_Source: https://clusters.soleilpictures.com/docs/api · Updated 2026-08-08_

Base URL: `https://clusters.soleilpictures.com/api/v1`

Every response is JSON. Every error carries a machine-readable `code` and a
human-readable `error`. A full OpenAPI description is at
[`/api/v1/openapi.json`](https://clusters.soleilpictures.com/api/v1/openapi.json), served
**without authentication** — a spec you need a credential to read is not
discoverable.

## The authorization model

The part worth reading before anything else.

A token is **not a capability**. It resolves to *you*, and then every read and
write runs as your user under the same row-level security the app uses.

The consequence: a token reaches exactly what your account reaches, and nothing
more. Boards you were invited to as an editor are writable. Boards you can only
view are not. Boards you cannot see return `404` rather than `403`, so the API
never confirms the existence of something you have no business knowing about.

There is no per-resource permission list on a token, and no way for API
permissions to drift out of step with app permissions.

## Endpoints

| Method and path | Does |
|---|---|
| `GET /me` | Who this token belongs to, its scopes, and its rate-limit state |
| `GET /workspaces` | Workspaces you can see |
| `GET /search` | [Search](/docs/api/search) boards and cards by text |
| `GET /boards` | [List boards](/docs/api/boards); filter and paginate |
| `POST /boards` | Create a board |
| `GET /boards/:id` | One board |
| `PATCH /boards/:id` | Rename, change view, or reparent |
| `DELETE /boards/:id` | Soft-delete — restorable |
| `POST /boards/:id/restore` | Undo a soft delete |
| `GET /boards/:id/cards` | [Cards](/docs/api/cards) on a board, paginated |
| `POST /boards/:id/cards` | Add cards |
| `PATCH /boards/:id/cards/:cardId` | Change a card |
| `DELETE /boards/:id/cards/:cardId` | Remove a card |
| `POST /boards/:id/cards/move` | Move cards to another board |
| `POST /uploads` | [Upload an image](/docs/api/images), get a key back |
| `GET /images/:key` | Read an image back |
| `GET /service-accounts` | [Service accounts](/docs/api/service-accounts) in a workspace |
| `POST /service-accounts` | Create one, with its first token |
| `DELETE /service-accounts/:id` | Retire one and revoke its tokens |
| `POST /service-accounts/:id/tokens` | Mint another token — rotate without downtime |
| `GET /service-accounts/:id/tokens` | Its tokens and when each was last used |
| `DELETE /service-accounts/:id/tokens/:tokenId` | Revoke one token |

`GET /api/v1` returns this list plus your current scopes, so the one URL a
person types by hand answers usefully.

## Authentication

Mint a token under **Settings → API**, then:

```sh
curl https://clusters.soleilpictures.com/api/v1/me \
  -H "Authorization: Bearer undefined…"
```

Three scopes: `delete` · `read` · `write`. Tokens are stored only as a hash — the value
is shown once and cannot be recovered. See
[Authentication](/docs/api/authentication).

## Pagination

List endpoints take `limit` and `offset`. The default page is
**100** and the maximum is **500**.

```json
{ "boards": [ … ], "limit": 100, "offset": 0, "has_more": true, "next_offset": 100 }
```

`has_more` is computed by fetching one row beyond the page, so it costs nothing
extra. Follow `next_offset` until it is `null`.

## Rate limits

**1000 requests per hour per token.** Every response —
not only refusals — carries the current state:

| Header | Meaning |
|---|---|
| `x-ratelimit-limit` | Your ceiling |
| `x-ratelimit-remaining` | What is left in the window |
| `x-ratelimit-reset` | Unix seconds when the window resets |
| `retry-after` | Seconds to wait — only on `429` |

`GET /me` reports the same numbers in its body, so a client can check its budget
without spending a request on a real call.

## Idempotency

Send an `Idempotency-Key` header on any `POST` and a retry with the same key
replays the original response rather than doing the work twice:

```sh
-H "Idempotency-Key: $(uuidgen)"
```

Keys are remembered for 24 hours. `PATCH` and `DELETE` are idempotent by
construction. A retry arriving while the first attempt is still in flight gets
`409` rather than racing it. A replayed response carries
`idempotent-replay: true`.

## CORS

`Access-Control-Allow-Origin` is `*`, so the API is callable from a browser.

> **Warning:** That it *works* from a browser does not mean you should. A
> `undefined` token in front-end code is readable by anyone who opens
> dev tools, and it acts as you. Call the API from a server.

## For AI agents

- **[Quickstart](/docs/api/quickstart)** — working code in curl, TypeScript and Python
- **[MCP](/docs/mcp)** — the same API as tools an assistant can call directly
- **[OpenAPI](https://clusters.soleilpictures.com/api/v1/openapi.json)** — generate a client
- **[`/llms.txt`](/llms.txt)** and **[`/llms-full.txt`](/llms-full.txt)** — this documentation, machine-readable
- Every docs page is available as raw Markdown by appending `.md`
