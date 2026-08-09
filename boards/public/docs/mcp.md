# MCP server

> Soleil Clusters ships an MCP server exposing the REST API as tools an AI assistant can call directly — search, read boards, create them, add and update cards, upload images, and restore deletions. It authenticates with the same personal access token as the API and holds no credentials of its own, so an agent reaches exactly what your account reaches.

_Source: https://clusters.soleilpictures.com/docs/mcp · Updated 2026-08-08_

The MCP server puts Soleil Clusters in reach of Claude and any other
Model Context Protocol client, so an assistant can read and build boards
directly.

## What it is

A layer over the [REST API](/docs/api). It holds no credentials and implements
no permissions of its own — it forwards your
[personal access token](/docs/api/authentication), so everything about the
authorization model there applies here unchanged.

## Setup

1. Mint a token in the app: **Settings → API**. Choose scopes deliberately — see below.
2. Point your MCP client at the server with the token in its environment:

```json
{
  "mcpServers": {
    "soleil-clusters": {
      "command": "node",
      "args": ["/absolute/path/to/soleilpictures/mcp/src/index.js"],
      "env": { "SOLEIL_API_TOKEN": "undefined…" }
    }
  }
}
```

`SOLEIL_API_BASE` overrides the host. Without a token the server exits at
startup rather than running in a state where every call fails.

## Choosing scopes for an agent

The three scopes (`delete` · `read` · `write`) exist mainly for this. "Can add cards to
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

**Reading**

| Tool | Input |
|---|---|
| `whoami` | — · the account, its scopes and rate-limit state |
| `list_workspaces` | — |
| `list_boards` | `workspace_id?`, `parent?` (`"root"` for top level), `limit?`, `offset?` |
| `search` | `q` (min 2 chars), `kind?` (`board`\|`card`), `workspace_id?`, paging |
| `read_board` | `board_id`, `full?`, `limit?`, `offset?` |
| `view_image` | `image_key` — fetch an image card's actual picture |
| `list_deleted_boards` | `workspace_id?` |

**Writing**

| Tool | Input |
|---|---|
| `create_board` | `name`, `workspace_id?`, `parent_board_id?` |
| `rename_board` | `board_id`, `name?`, `view?`, `parent_board_id?` |
| `add_cards` | `board_id`, `cards[]` — up to 1000 |
| `upload_image` | `board_id`, `data` (base64), `content_type` |
| `update_card` | `board_id`, `card_id`, plus any writable field |
| `move_cards` | `from_board_id`, `to_board_id`, `card_ids[]` |
| `restore_board` | `board_id` |

**Deleting** — requires the `delete` scope

| Tool | Input |
|---|---|
| `delete_card` | `board_id`, `card_id` |
| `delete_board` | `board_id` |

Card `kind` is `doc`, `file`, `image`, `link`, `note`, `video`, defaulting to `note`.

## Adding an image

Two calls:

1. `upload_image` with the base64 bytes and a `content_type` — returns an `image_key`
2. `add_cards` with `{"kind": "image", "image_key": "…"}`

Images are limited to **25 MB** through the API and are charged
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
- [OpenAPI](https://clusters.soleilpictures.com/api/v1/openapi.json) — the machine-readable API spec
- Any page plus `.md` — for example [`/docs/api/cards.md`](/docs/api/cards.md)
