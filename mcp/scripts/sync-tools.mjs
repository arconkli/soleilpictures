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
const source = resolve(here, '../../boards/src/lib/mcpTools.js');
const target = resolve(here, '../src/tools.js');

const banner = '// GENERATED — do not edit. Source: boards/src/lib/mcpTools.js\n'
  + '// Regenerate with `npm run sync` in mcp/.\n\n';

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, banner + readFileSync(source, 'utf8'));
console.log('✓ mcp/src/tools.js synced from boards/src/lib/mcpTools.js');
