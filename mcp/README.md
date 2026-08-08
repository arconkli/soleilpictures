# Soleil Clusters MCP server

Lets Claude (or any MCP client) read and write your Clusters boards.

It holds no credentials of its own and implements no permissions — it forwards
your personal access token to [`/api/v1`](../docs/API.md), which resolves it to
your own session. Everything runs under the same row-level security the app
uses, so the model can reach exactly what you can reach.

## Setup

1. In Clusters, go to **Settings → API** and create a token.
   Leave **Allow writes** unticked unless you want the model to be able to
   change things — a read-only token is the right default for "help me think
   about what's on this board".
2. Install dependencies: `npm install`
3. Point your MCP client at it:

```json
{
  "mcpServers": {
    "soleil-clusters": {
      "command": "node",
      "args": ["/absolute/path/to/soleilpictures/mcp/src/index.js"],
      "env": { "SOLEIL_API_TOKEN": "sk_live_…" }
    }
  }
}
```

`SOLEIL_API_BASE` overrides the host (defaults to
`https://clusters.soleilpictures.com`) — useful against a preview deploy.

## Tools

**Reading** — `list_workspaces`, `list_boards`, `read_board`

**Writing** — `create_board`, `add_cards`, `update_card`, `move_cards`,
`delete_card`, `delete_board`

Tools that change or remove things say so in capitals in their descriptions, and
the two that destroy content tell the model to confirm with you first. That
wording is the only thing between an assistant and your real work, so it is
deliberately blunt rather than polite. A read-only token is still the stronger
guarantee: with it, the write tools simply fail.

## Notes

- **No file uploads.** `add_cards` takes an `image_key` that already exists in
  storage; there is no path here for new binary content.
- `POST`s carry an `Idempotency-Key`, so a retried call replays its original
  response rather than doing the work twice.
- Deleting a card returns the card. Passing it back to `add_cards` restores it.
