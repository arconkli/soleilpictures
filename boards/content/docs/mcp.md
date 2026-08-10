---
title: MCP Server — Soleil Clusters for AI Agents
metaDescription: Connect Claude or any MCP client to Soleil Clusters — hosted over a URL, or run locally. Tools for reading, building, importing and exporting boards.
h1: MCP server
navLabel: MCP
section: developers
order: 10
updated: 2026-08-09
answer: Soleil Clusters ships an MCP server exposing the API as tools an AI assistant can call directly. Connect to the hosted one with a URL and a personal access token, or run it locally with npx for tools that need your filesystem. Either way it holds no credentials of its own and forwards your token, so an agent reaches exactly what your account reaches and no more.
faq:
  - q: Do I have to install anything?
    a: No. Point an MCP client at https://clusters.soleilpictures.com/api/v1/mcp with your token. Running it locally is only needed for uploading files from your own machine.
  - q: Does the MCP server have its own permissions?
    a: No. It forwards your personal access token to the same API, so it inherits your account's permissions exactly. A token without the delete scope cannot delete.
  - q: How do I stop an agent deleting things?
    a: Mint a token without the delete scope. Deleting is a separate grant from writing precisely so an agent can be allowed to build without being allowed to destroy.
  - q: Can an agent upload a video?
    a: Only the local server can, with upload_file, because the file has to be read from a disk. The hosted one handles images with upload_image.
  - q: Is it the same set of tools either way?
    a: Yes, apart from upload_file, which needs a filesystem. Both servers are built from one registry so they cannot drift apart.
related:
  - /docs/api
  - /docs/api/authentication
  - /docs/api/metadata
---

The MCP server puts Soleil Clusters in reach of Claude and any other
Model Context Protocol client, so an assistant can read and build boards
directly.

## What it is

A layer over the [REST API](/docs/api). It holds no credentials and implements
no permissions of its own — it forwards your
[personal access token](/docs/api/authentication), so everything about the
authorization model there applies here unchanged.

## Two ways to connect

### Hosted — nothing to install

```json
{
  "mcpServers": {
    "soleil-clusters": {
      "type": "http",
      "url": "{{fact:siteOrigin}}/api/v1/mcp",
      "headers": { "Authorization": "Bearer {{fact:tokenPrefix}}…" }
    }
  }
}
```

Mint the token in the app under **Settings → API**, or create a
[service account](/docs/api/service-accounts) if this is for a team rather than
for you. That is the whole setup.

### Local — for files on your machine

```json
{
  "mcpServers": {
    "soleil-clusters": {
      "command": "npx",
      "args": ["-y", "soleil-clusters-mcp"],
      "env": { "SOLEIL_API_TOKEN": "{{fact:tokenPrefix}}…" }
    }
  }
}
```

`SOLEIL_API_BASE` overrides the host. Without a token the server exits at
startup rather than running in a state where every call fails.

The local server has one extra tool, `upload_file`, which reads a file from your
disk and uploads it — including large ones like video, which cannot fit through
an assistant's message. Everything else is identical: both servers are built
from one registry, so a tool cannot exist on one and not the other.

## Protocol versions

Both servers accept {{fact:mcpProtocolVersions}}.

`{{fact:mcpProtocolLatest}}` is the revision that removed the
`initialize` handshake: protocol version, client identity and client
capabilities now travel in `_meta` on every request, and there is no session to
establish or keep alive. Nothing needs to be configured to use it — the server
decides per request:

- A request whose `params._meta` carries
  `io.modelcontextprotocol/protocolVersion` is served under that revision.
- An `initialize` request is served under the older, session-based rules.

So a client built on the current official SDK — which tops out at `2025-11-25` —
connects exactly as it always did, and a newer one gets the newer behaviour from
the same URL. If you ask for a version the server does not implement, it answers
`-32022` and lists the ones it does, so a client can retry rather than guess.

`server/discover` returns the supported versions, the capabilities and the
server identity in a single call. On the local server it doubles as the probe
that tells a client which era it is talking to, because stdio has no HTTP status
code to branch on.

Under `{{fact:mcpProtocolLatest}}` the hosted transport also requires the
mirrored request headers — `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name`
for `tools/call` and `prompts/get`. They must agree with the request body; a
mismatch is refused with `-32020` rather than served, because a proxy is allowed
to route on the header without reading the body, and two components acting on
different values is exactly the confusion the rule exists to prevent. Older
clients send no such headers and are not held to them.

Two things that changed with the revision and may surprise you: `ping` is gone
(a stateless protocol has no connection to keep alive), and a POST body must be
a single message — JSON-RPC batching is no longer accepted. Both still work for
clients connecting under an older version.

### Protocol errors

These are JSON-RPC error codes, distinct from the REST API's
[error codes](/docs/api/errors) — a client branches on the number.

| Code | Means | HTTP |
|---|---|---|
| `-32700` | The body was not JSON | 400 |
| `-32600` | Not a valid single JSON-RPC message | 400 |
| `-32601` | No such method | 404 |
| `-32602` | Bad params — also an unknown tool or prompt | 200 |
| `-32603` | The server failed | 200 |
| `-32020` | A mirrored header disagrees with the body | 400 |
| `-32021` | The request needs a capability the client did not declare | 400 |
| `-32022` | Unsupported protocol version — the answer lists the supported ones | 400 |

A tool that *runs* and fails is not an error here. It returns a normal result
with `isError: true` and the API's own sentence in the content, because a model
that reads "this token cannot delete" can correct itself, while one that gets a
transport error only learns that something broke.

## Choosing scopes for an agent

The three scopes ({{fact:apiScopes}}) exist mainly for this. "Can add cards to
my moodboard" and "can delete my moodboard" are different levels of trust to
place in a language model, and they are separate grants.

| Give it | For |
|---|---|
| `read` | Research, summarising, answering questions about your boards |
| `read` + `write` | Building boards, adding references — the usual choice |
| all three | Housekeeping and cleanup agents |

An agent without `delete` gets a `403` naming the missing scope rather than
quietly failing.

## Tools

**Orientation and finding things**

| Tool | Input |
|---|---|
| `whoami` | — · the account, its scopes, rate limit, and whether it is a service account |
| `list_workspaces` | — |
| `search` | `q` (min 2 chars), `kind?` (`board`\|`card`), `workspace_id?`, paging |
| `list_boards` | `workspace_id?`, `parent?` (`"root"` for top level), `since?`, `cursor?`, paging |
| `board_tree` | `root?` or `workspace_id?`, `depth?` — a whole hierarchy in one call |
| `get_board` | `board_id` — one board, with how much of the card allowance is used |
| `resolve_identifier` | `scope`, `value` — find something by an id from another system |
| `list_deleted_boards` | `workspace_id?` |
| `list_groups` | `board_id` — the labelled sets on a board |

**Reading**

| Tool | Input |
|---|---|
| `read_board` | `board_id`, `full?`, `include?`, `source?`, `since?`, paging |
| `view_image` | `image_key` — fetch an image card's actual picture |
| `list_images` | `workspace_id?`, `board_id?`, `since?`, `cursor?` |
| `export_board` | `board_id`, `format?` (`json`\|`omc`) |
| `get_metadata` | `board_id`, `cards?` — identifiers and properties |
| `list_audit` | `since?`, `cursor?` — recent writes and image fetches |

**Writing**

| Tool | Input |
|---|---|
| `create_board` | `name`, `workspace_id?`, `parent_board_id?`, `identifiers?`, `props?` |
| `create_boards` | `boards[]`, `on_conflict?` — build a structure in one call |
| `add_cards` | `board_id`, `cards[]` — up to {{fact:maxCardsPerCall}}, `on_conflict?` |
| `upload_image` | `board_id`, `data` (base64), `content_type` |
| `upload_file` | `board_id`, `path` — **local server only**; handles large files |
| `import_urls` | `board_id`, `urls[]`, `titles?`, `dry_run?` — bring reference in from the web; safe to re-run |
| `arrange_board` | `board_id`, `layout?`, `card_ids?`, `dry_run?` — lay a board out |
| `create_group` | `board_id`, `name`, `color?`, `shape?` — say a set of cards is one thing |
| `rename_board` | `board_id`, `name?`, `view?`, `parent_board_id?` |
| `move_boards` | `board_ids[]`, `parent_board_id` |
| `update_card` | `board_id`, `card_id`, plus any writable field |
| `update_cards` | `board_id`, `cards[]` — many at once |
| `move_cards` | `from_board_id`, `to_board_id`, `card_ids[]` |
| `set_metadata` | `board_id`, `card_id?`, `identifiers?`, `props?` |
| `restore_board` | `board_id` |

**Deleting** — requires the `delete` scope

| Tool | Input |
|---|---|
| `delete_card` | `board_id`, `card_id` |
| `delete_cards` | `board_id`, `card_ids[]` |
| `delete_board` | `board_id` |

Card `kind` is {{fact:apiCardKinds}}, defaulting to `note`.

Every tool carries **annotations** — `readOnlyHint`, `destructiveHint`,
`idempotentHint` — which is what a client reads when deciding whether a call
needs confirming. They are structured, so unlike a warning in a description they
actually participate in that decision.

## Prompts

Three starting points, offered by name rather than buried in a tool
description:

| Prompt | Does |
|---|---|
| `describe_board` | Looks at every image and writes what the board is reaching for |
| `organize_board` | Proposes a grouping into child boards, without moving anything |
| `import_plan` | Turns a file listing into a plan of boards and cards, with identifiers so it can be re-run |

## Adding an image

Two calls:

1. `upload_image` with the base64 bytes and a `content_type` — returns an `image_key`
2. `add_cards` with `{"kind": "image", "image_key": "…"}`

Images are limited to **{{fact:maxUploadMb}}** through the API and are charged
to the board owner's storage. See [Images API](/docs/api/images).

## What agents should know

**`read_board` truncates by default.** Pass `full: true` for untruncated
bodies, and expect it to be large. Both `read_board` and `list_boards` paginate
— check for more rather than assuming one page is everything.

**Deleting returns the card.** `delete_card` responds with the full card it
removed. That object is the undo — pass it back to `add_cards` to restore it.
Worth keeping in context before destructive work.

**Deleting a board is destructive and confirmable.** `delete_board` removes a
whole board; the tool description says to confirm with the user first, and
`restore_board` exists because that is not always heeded.

**Writes are idempotent by key.** Every POST the server issues carries a
generated idempotency key, so a retried call replays rather than duplicating.

**Batch.** One `add_cards` call with forty cards is one request against the
[rate limit](/docs/api/authentication); forty calls are forty.

**`live: false` is not an error.** The change is saved; a canvas someone already
has open will not show it until reload.

**Start with `whoami`.** It reports the scopes and remaining rate budget, which
is cheaper than discovering both through failures.

## Reading the docs as an agent

- [`/llms.txt`](/llms.txt) — an index of every page with descriptions
- [`/llms-full.txt`](/llms-full.txt) — the entire corpus in one file
- [OpenAPI]({{fact:siteOrigin}}/api/v1/openapi.json) — the machine-readable API spec
- Any page plus `.md` — for example [`/docs/api/cards.md`](/docs/api/cards.md)
