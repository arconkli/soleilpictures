// Copy the canonical tool registry into this package.
//
// boards/src/lib/mcpTools.js is the single definition — the Worker serves the
// hosted MCP server from it, and this package needs the same file. A published
// npm package cannot reach up out of its own directory, so the copy is
// committed here, exactly as the docs artifacts are: generated files live in
// git so a build never depends on generation succeeding.
//
// `npm test` in boards/ fails if the two ever differ, so the copy cannot go
// stale silently.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// The protocol handler is copied for the same reason the registry is, and it
// matters more: a tool that exists on one transport and not the other looks
// like a client bug, but a PROTOCOL that differs between them fails at
// connection time with nothing useful to read. Both transports negotiate
// versions, validate `_meta` and shape results from this one file.
const FILES = [
  { from: 'boards/src/lib/mcpTools.js', to: 'src/tools.js' },
  { from: 'boards/src/lib/mcpServer.js', to: 'src/server.js' },
];

for (const { from, to } of FILES) {
  const banner = `// GENERATED — do not edit. Source: ${from}\n`
    + '// Regenerate with `npm run sync` in mcp/.\n\n';
  const target = resolve(here, '..', to);
  // The only edit: inside this package the registry is a sibling named
  // tools.js. Asserted by a test, so a rename cannot silently break the copy.
  const body = readFileSync(resolve(here, '../..', from), 'utf8')
    .replace("from './mcpTools.js'", "from './tools.js'");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, banner + body);
  console.log(`✓ mcp/${to} synced from ${from}`);
}
