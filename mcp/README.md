# Soleil Clusters MCP server

Lets Claude (or any MCP client) read and write your Clusters boards — including
**looking at the actual images** on them.

It holds no credentials of its own and implements no permissions — it forwards
your personal access token to [`/api/v1`](../docs/API.md), which resolves it to
your own session. Everything runs under the same row-level security the app
uses, so the model can reach exactly what you can reach.

## Setup

1. In Clusters, go to **Settings → API** and create a token.
   - Leave both boxes unticked for a read-only token. That is the right default
     for "help me think about what's on this board".
   - Tick **Allow writes** if the model should be able to create and change things.
   - Tick **Allow deletes** only if it should be able to throw things away.
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

**Reading** — `whoami`, `list_workspaces`, `list_boards`, `search`,
`read_board`, `view_image`, `list_deleted_boards`

**Writing** — `create_board`, `rename_board`, `add_cards`, `upload_image`,
`update_card`, `move_cards`, `restore_board`

**Destroying** — `delete_card`, `delete_board`

Start with `search` rather than `list_boards` when you roughly know what you're
looking for — it's the difference between one call and reading every board.
`whoami` reports the token's scopes, so a model can find out whether it may
write instead of discovering it by being refused.

## What actually protects you

In descending order of how much it's worth:

1. **The token's scopes.** A read-only token makes every write tool fail at the
   API, whatever the model intends. A read+write token still cannot delete.
   This is the real control, and it's the one you set.
2. **Tool annotations.** Every tool declares `readOnlyHint`, `destructiveHint`,
   `idempotentHint` and `openWorldHint`. Clients read these when deciding what
   needs confirmation — unlike prose, they participate in that decision.
3. **The wording of the descriptions.** Last and least. It's advice to a model,
   not a control. It's written bluntly anyway.

## Resources

Boards are also exposed as resources (`soleil://board/<id>`), so you can attach
one as context in your client rather than having the model tool-call for it.

## Notes

- **`view_image`** returns the picture itself as an image block, so the model can
  see a moodboard rather than reading a list of opaque keys. Capped at 5MB —
  base64 inflates by a third and every byte lands in the conversation.
- **`upload_image`** takes base64 bytes and returns an `image_key` for
  `add_cards`. Uploads are charged against the board owner's storage.
- **`read_board`** shortens long card text by default so one call can't fill your
  context, and omits `html` (its text is already in `body`). Pass `full: true`
  when you genuinely need every word.
- **Retries replay rather than repeat.** `POST`s carry an `Idempotency-Key`
  derived from the call itself plus a per-process id, so re-issuing the same
  tool call after a timeout returns the original result instead of doing the
  work twice — while the same write in a later session still goes through. (This
  was previously a fresh random key per request, which did the opposite of what
  it claimed.)
- Deleting a card returns the card. Passing it back to `add_cards` restores its
  content.
