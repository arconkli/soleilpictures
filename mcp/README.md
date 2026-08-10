# soleil-clusters-mcp

MCP server for [Soleil Clusters](https://clusters.soleilpictures.com) — read and
build visual boards from Claude, or any Model Context Protocol client.

## You probably do not need this package

There is a **hosted** server, and it now signs you in by itself. Point your
client at a URL:

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

No token. The first call comes back `401` with a pointer to the OAuth metadata;
your client registers itself, opens a browser, and you approve the connection on
one screen. If you do not have an account yet you get one there — signing in is
a single email box.

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
under **Settings → API**. `SOLEIL_API_BASE` overrides the host.

## What it can do

33 tools: search, read and export boards, look at the actual images on them,
create boards and cards in bulk, lay a board out as justified rows or masonry,
import from URLs, attach identifiers from other systems, move and delete things,
and read the audit log. Three prompts for describing, organising and importing.

Full reference: <https://clusters.soleilpictures.com/docs/mcp>

## Permissions

This server holds no credentials of its own and implements no permissions. It
forwards your token, and the API resolves it to your own session — so an agent
reaches exactly what your account reaches, and the database refuses anything
else.

Three scopes: `read`, `write`, `delete`. **Deleting is separate from writing on
purpose**, so an agent can be allowed to build without being allowed to destroy.
`login` asks for `read write` and never for `delete`.

Whatever you connect is listed under **Settings → API → Connected apps**, with
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
