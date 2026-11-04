# Installing Soleil Clusters for an AI coding agent

Soleil Clusters is a visual workspace (boards of images, notes and docs). This
server lets you read and build them for the person you work for.

## Option 1: hosted server (preferred)

Use this when your client speaks streamable HTTP. Nothing to install.

Add this to the client's MCP settings:

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

The first request returns `401` with a pointer to the OAuth metadata. A client
that supports MCP OAuth registers itself and opens a browser. Tell the person to
approve the connection on that screen; if they have no account, the same screen
creates one with their email. You cannot do this step for them.

## Option 2: the npm package (local, for files on the person's machine)

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

Before the server first starts, the person runs this in a terminal:

```sh
npx -y soleil-clusters-mcp login
```

It opens a browser for the same approval and stores the credential on their
machine. This package adds `upload_file`, which reads a file from disk.

## When sign-in is needed

- Hosted: the browser approval above. Do not ask for a password.
- Local: `npx -y soleil-clusters-mcp login`. If the server exits with
  "Not signed in", that is the fix.
- A client that cannot do OAuth can use a personal access token instead: the
  person makes one under Settings, Connections, then sets it as
  `SOLEIL_API_TOKEN` (local) or sends `Authorization: Bearer <token>` (hosted).

Docs: https://clusters.soleilpictures.com/docs/mcp
