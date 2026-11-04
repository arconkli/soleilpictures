# soleil-clusters-mcp

MCP server for [Soleil Clusters](https://clusters.soleilpictures.com) — read and
build visual boards from Claude, or any Model Context Protocol client.

## Connect it

The **hosted** server is a URL, and it signs you in by itself:
`https://clusters.soleilpictures.com/api/v1/mcp`

No token. The first call comes back `401` with a pointer to the OAuth metadata;
your client registers itself, opens a browser, and you approve the connection on
one screen. If you do not have an account yet you get one there.

- **Claude** (claude.ai or the desktop app): Settings, Connectors, add a custom
  connector, paste the URL.
- **ChatGPT**: Settings, Apps, Advanced settings, turn on developer mode; then
  create an app and paste the URL.
- **Claude Code**: `claude mcp add --transport http soleil-clusters https://clusters.soleilpictures.com/api/v1/mcp`
- **Cursor**: [Add to Cursor](https://cursor.com/en/install-mcp?name=soleil-clusters&config=eyJ1cmwiOiJodHRwczovL2NsdXN0ZXJzLnNvbGVpbHBpY3R1cmVzLmNvbS9hcGkvdjEvbWNwIn0%3D)
- **VS Code**: [Add to VS Code](https://insiders.vscode.dev/redirect/mcp/install?name=soleil-clusters&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fclusters.soleilpictures.com%2Fapi%2Fv1%2Fmcp%22%7D)
- **Windsurf** and any other client that takes a remote server: add this to its
  MCP config (Windsurf calls the URL field `serverUrl`).

```json
{
  "mcpServers": {
    "soleil-clusters": {
      "type": "http",
      "url": "https://clusters.soleilpictures.com/api/v1/mcp"
    }
  }
}
```

### No account

`https://clusters.soleilpictures.com/mcp` works with no account. Anyone can try
it from Claude or ChatGPT: the assistant builds a draft cluster, and you keep it
with the keep link it hands back (an email address and a code). Signed in, the
same URL works as your account.

### Local, for files on your machine

Install this package only for the one tool the hosted server cannot offer:
`upload_file`, which reads a file from your own disk — including large media
that will not fit through an assistant's message.

```sh
npx soleil-clusters-mcp login
```

```json
{
  "mcpServers": {
    "soleil-clusters": {
      "command": "npx",
      "args": ["-y", "soleil-clusters-mcp"]
    }
  }
}
```

`login` runs the same OAuth flow from your terminal: it opens a browser, catches
the callback on a loopback port, and stores the credential in
`~/.config/soleil-clusters/credentials.json` (mode 600). It refreshes itself
after that. `npx soleil-clusters-mcp logout` removes it.

Prefer a token? `SOLEIL_API_TOKEN` still works and takes precedence — mint one
under **Settings → Connections**. `SOLEIL_API_BASE` overrides the host.

## What it can do

31 tools: search and fetch, read, write and export boards and docs, look at a whole board or the
images on it, show a board to you as it is laid out (drawn in the chat where the app can draw it),
create and change boards and cards in bulk, lay a board out as justified rows or masonry, share it by
link, read, add and resolve comments, list tags and tag cards, import from URLs, attach identifiers
from other systems, move and delete things, and read the audit log. Five prompts: make a moodboard
from a brief, review a board, organise one, write a treatment from one, and plan an import.

Version 3.0 folded fifteen tools into others (`get_board` into `read_board`, `update_card` into
`update_cards`, and so on). Calling an old name says which tool does it now.

Full reference, limits and per-app steps: <https://clusters.soleilpictures.com/docs/mcp>

## Permissions

This server holds no credentials of its own and implements no permissions. It
forwards your token, and the API resolves it to your own session — so an agent
reaches exactly what your account reaches, and the database refuses anything
else.

Three scopes: `read`, `write`, `delete`. **Deleting is separate from writing on
purpose**, so an agent can be allowed to build without being allowed to destroy.
`login` asks for `read write` and never for `delete`.

Whatever you connect is listed under **Settings → Connections → Connected apps**, with
what it has done and a button to disconnect it.

## Development

`src/tools.js` and `src/server.js` are **generated** from
`boards/src/lib/mcpTools.js` and `boards/src/lib/mcpServer.js`, which the hosted
server also uses. Edit those, then:

```sh
npm run sync
```

A test in `boards/` fails if either copy is stale, so the two transports cannot
drift apart.

## Publishing

`server.json` describes this server for the
[MCP Registry](https://registry.modelcontextprotocol.io). Its `name` and the
`mcpName` in `package.json` must match, and the `com.soleilpictures` namespace
comes from a DNS TXT record on the apex of `soleilpictures.com`.

```sh
npm publish --access public
mcp-publisher login dns --domain soleilpictures.com --private-key <hex>
mcp-publisher publish
```
