# soleil-clusters-mcp

MCP server for [Soleil Clusters](https://clusters.soleilpictures.com) — read and
build visual boards from Claude, or any Model Context Protocol client.

## You probably do not need this package

There is a **hosted** server. Point your client at a URL and be done:

```json
{
  "mcpServers": {
    "soleil-clusters": {
      "type": "http",
      "url": "https://clusters.soleilpictures.com/api/v1/mcp",
      "headers": { "Authorization": "Bearer sk_live_…" }
    }
  }
}
```

Install this package only when you want the one tool the hosted server cannot
offer: `upload_file`, which reads a file from your own disk — including large
media that will not fit through an assistant's message.

```json
{
  "mcpServers": {
    "soleil-clusters": {
      "command": "npx",
      "args": ["-y", "soleil-clusters-mcp"],
      "env": { "SOLEIL_API_TOKEN": "sk_live_…" }
    }
  }
}
```

Mint a token in the app under **Settings → API**. `SOLEIL_API_BASE` overrides
the host.

## What it can do

29 tools: search, read and export boards, look at the actual images on them,
create boards and cards in bulk, attach identifiers from other systems, move and
delete things, and read the audit log. Three prompts for describing, organising
and importing.

Full reference: <https://clusters.soleilpictures.com/docs/mcp>

## Permissions

This server holds no credentials and implements no permissions. It forwards your
personal access token, and the API resolves it to your own session — so an agent
reaches exactly what your account reaches, and the database refuses anything
else.

Three scopes: `read`, `write`, `delete`. **Deleting is separate from writing on
purpose**, so an agent can be allowed to build without being allowed to destroy.
Mint a read-only token unless you mean otherwise.

## Development

`src/tools.js` is **generated** from `boards/src/lib/mcpTools.js`, which is the
one definition the hosted server also uses. Edit that file, then:

```sh
npm run sync
```

A test in `boards/` fails if the copy is stale, so the two transports cannot
drift apart.
