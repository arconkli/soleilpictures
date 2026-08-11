#!/usr/bin/env node
// Soleil Clusters — MCP server (stdio).
//
// This is an ADAPTER, not a definition. Every tool, prompt and schema lives in
// boards/src/lib/mcpTools.js, which the hosted server at
// https://clusters.soleilpictures.com/api/v1/mcp serves from the same file.
// Two copies of thirty tool definitions would drift within a week, and the
// drift would be silent: a tool present on one transport and missing on the
// other looks like a client bug.
//
// What lives HERE is what only makes sense on someone's own machine: the stdio
// transport, and `upload_file`, which reads the local filesystem.
//
// It holds no credentials of its own. It forwards the user's personal access
// token, and the API resolves that to their Supabase session, so every call
// runs under ordinary row-level security. If a model asks for a board the
// person cannot see, the database says no — not this file.
//
// Setup (Claude Desktop / Claude Code, mcp.json):
//
//   "soleil-clusters": {
//     "command": "npx",
//     "args": ["-y", "soleil-clusters-mcp"],
//     "env": { "SOLEIL_API_TOKEN": "sk_live_…" }
//   }
//
// Mint the token in Clusters under Settings → API. A read-only token is the
// right default; add write only if the model should change things, and delete
// only if it should remove them.

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { TOOLS } from './tools.js';
import { handleMcpMessage, ERR } from './server.js';
import { idempotencyKey } from './idempotency.js';
import { login, resolveToken, clearCredentials, credentialsPath } from './auth.js';

const BASE = (process.env.SOLEIL_API_BASE || 'https://clusters.soleilpictures.com').replace(/\/$/, '');

// ── Subcommands ──────────────────────────────────────────────────────────────
//
// `npx soleil-clusters-mcp` with no argument is the MCP server on stdio, which
// is what a client config runs. The two subcommands are for a person at a
// terminal, and they exit rather than falling through to the server — an MCP
// client would be talking to a process that had already printed prose to stdout.
const subcommand = process.argv[2];

if (subcommand === 'login') {
  await login(BASE).catch((e) => {
    console.error(`Could not sign in: ${e.message}`);
    process.exit(1);
  });
  process.exit(0);
}

if (subcommand === 'logout') {
  const had = await clearCredentials();
  console.log(had
    ? `Signed out. Removed ${credentialsPath()}.\n`
      + 'The connection itself is still listed under Settings → API → Connected apps; '
      + 'disconnect it there to revoke it for good.'
    : 'Nothing stored — you were not signed in.');
  process.exit(0);
}

// A stored sign-in, refreshed if it has expired, or SOLEIL_API_TOKEN if set.
// The environment variable wins: anyone with a working config or a service
// account should not have their setup changed by a new feature.
const TOKEN = await resolveToken(BASE);

if (!TOKEN) {
  // Fail here rather than on the first tool call. A server that starts and then
  // errors on every request looks like the API is down.
  console.error('Not signed in. Run `npx soleil-clusters-mcp login`, '
    + 'or set SOLEIL_API_TOKEN to a token from Settings → API.');
  process.exit(1);
}

// ── The HTTP client the shared tools are written against ─────────────────────

async function api(path, { method = 'GET', body, rawBody, raw = false, headers, tool, args } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(method === 'POST' ? { 'idempotency-key': await idempotencyKey(tool || path, args) } : {}),
      // Say which tool this call is on behalf of.
      //
      // This server implements MCP locally and then speaks plain REST, so
      // without this every request it makes is indistinguishable from a
      // hand-written script and the audit log cannot say which tool ran. That
      // was true for as long as the package has existed, and it was found by
      // installing it from npm and reading the log afterwards.
      //
      // `Mcp-Name` is the header the 2026-07-28 revision already defines for
      // the name of the thing being invoked; the hosted transport validates it
      // against the body, and here it is simply reported.
      ...(tool ? { 'mcp-method': 'tools/call', 'mcp-name': tool } : {}),
      ...(headers || {}),
    },
    body: rawBody !== undefined ? Buffer.from(rawBody, 'base64')
      : body === undefined ? undefined : JSON.stringify(body),
  });

  if (raw) {
    if (!res.ok) throw new Error(await errorMessage(res, method, path));
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      variant: res.headers.get('x-image-variant') || 'original',
    };
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON error page */ }
  if (!res.ok) throw new Error(await errorMessage(res, method, path, data));
  return data;
}

// Surface the API's own message: it is written for a person, and a model
// relaying it verbatim is more useful than one inventing a reason. Two cases
// get a sentence of their own, because the raw answer tells a model nothing it
// can act on.
async function errorMessage(res, method, path, parsed) {
  let data = parsed;
  if (data === undefined) {
    try { data = JSON.parse(await res.text()); } catch (_) { data = null; }
  }
  if (data?.code === 'insufficient_scope') {
    return `${data.error}. This token has: ${(data.scopes || []).join(', ') || 'nothing'}. `
      + 'Mint a new token in Clusters under Settings → API to change that — it cannot be widened from here.';
  }
  if (res.status === 429) {
    // The ceiling is per token and configurable, so the number comes from the
    // response rather than being hard-coded here — it used to say "1000/hour"
    // to service accounts whose limit was ten times that.
    const limit = res.headers.get('x-ratelimit-limit');
    const retry = res.headers.get('retry-after');
    return `Rate limited by Clusters${limit ? ` (${limit} requests/hour for this token)` : ''}.`
      + `${retry ? ` Retry in ${retry}s.` : ' Wait a little and retry.'}`;
  }
  // The machine-readable code goes back too. A model that only ever sees
  // English cannot branch on anything.
  const code = data?.code ? ` [${data.code}]` : '';
  return `${data?.error || `${method} ${path} failed (${res.status})`}${code}`;
}

// ── Local file upload: the one thing only this transport can do ──────────────

const MIME_BY_EXT = {
  '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.mkv': 'video/x-matroska',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.aiff': 'audio/aiff', '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.dng': 'image/x-adobe-dng',
  '.exr': 'image/x-exr', '.mxf': 'application/mxf', '.dpx': 'application/x-dpx',
};

// The whole multipart dance, so the model does not have to orchestrate it.
// Parts go straight to storage, never through the API — which is what makes
// this usable for a file too big to hold in a message.
async function uploadLocalFile({ board_id: boardId, path, content_type: contentType }) {
  const bytes = await readFile(path);
  const filename = basename(path);
  const mime = contentType || MIME_BY_EXT[extname(path).toLowerCase()] || 'application/octet-stream';

  const created = await api(`/uploads/multipart?board=${boardId}`, {
    method: 'POST',
    body: { bytes: bytes.length, content_type: mime, filename },
    tool: 'upload_file', args: { path, size: bytes.length },
  });
  const { key, upload_id: uploadId, part_size: partSize, part_count: partCount } = created;

  const etags = [];
  // Signed URLs expire, so they are fetched in batches as the upload proceeds
  // rather than all at once up front.
  for (let start = 1; start <= partCount; start += 100) {
    const numbers = [];
    for (let n = start; n < Math.min(start + 100, partCount + 1); n++) numbers.push(n);
    const signed = await api('/uploads/multipart/parts', {
      method: 'POST',
      body: { board_id: boardId, key, upload_id: uploadId, part_numbers: numbers },
      tool: 'upload_file', args: { key, start },
    });
    // Eight at a time: enough to keep a connection busy without making a
    // desktop machine's upload unusable while it runs.
    for (let i = 0; i < numbers.length; i += 8) {
      await Promise.all(numbers.slice(i, i + 8).map(async (n) => {
        const from = (n - 1) * partSize;
        const put = await fetch(signed.urls[String(n)], {
          method: 'PUT',
          body: bytes.subarray(from, Math.min(from + partSize, bytes.length)),
        });
        if (!put.ok) throw new Error(`part ${n} failed (${put.status})`);
        etags[n - 1] = { part_number: n, etag: put.headers.get('etag') };
      }));
    }
  }

  const done = await api('/uploads/multipart/complete', {
    method: 'POST',
    body: { board_id: boardId, key, upload_id: uploadId, parts: etags },
    tool: 'upload_file', args: { key },
  });
  return {
    ...done,
    file_name: filename,
    mime,
    next: `Add a card with kind "${mime.startsWith('video/') ? 'video' : 'file'}" and `
      + `file_key "${done.image_key}".`,
  };
}

// ── The adapter ──────────────────────────────────────────────────────────────
//
// There is no SDK here. That is deliberate, and it is not NIH.
//
// Protocol revision 2026-07-28 removed the `initialize` handshake outright:
// version, identity and capabilities now travel in `_meta` on every request,
// and servers MUST implement `server/discover`. The official SDK's newest
// version is 2025-11-25, so it cannot express any of that — a server built on
// it can only speak the old era. Meanwhile the dispatch this package needs
// already exists in server.js, shared byte-for-byte with the hosted server at
// /api/v1/mcp, so the two transports cannot answer a client differently.
//
// What is left for this file is the transport itself, which for stdio is
// newline-delimited JSON on stdin and stdout. That is the whole thing.

const ctx = {
  // The stdio server carries the local-filesystem tool as well; the hosted one
  // filters it out, because there is no filesystem there.
  tools: TOOLS,
  api,
  uploadLocalFile,
  // Each call gets an api() bound to the tool that made it, so a retried POST
  // carries a stable idempotency key derived from the tool and its arguments.
  forTool: (tool, args) => ({
    ...ctx,
    api: (p, o) => api(p, { ...o, tool: tool.name, args }),
  }),
};

function send(message) {
  // One message per line, written whole. Responses may complete out of order —
  // JSON-RPC correlates by id, and serialising them would make a slow upload
  // block every other call.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: ERR.PARSE, message: 'parse error: not JSON' } });
    return;
  }
  try {
    const { body } = await handleMcpMessage(msg, ctx);
    if (body) send(body);
  } catch (e) {
    // A crash here would kill the process and take every other in-flight call
    // with it. The client gets an error it can attribute to this request.
    if (msg?.id !== undefined && msg?.id !== null) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: ERR.INTERNAL, message: e?.message || String(e) } });
    }
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) void handleLine(line);
  }
});
process.stdin.on('end', () => process.exit(0));

// stderr, never stdout: stdout is the protocol channel and anything else
// written there is a parse error at the other end.
console.error(`soleil-clusters MCP ready against ${BASE} — ${TOOLS.length} tools`);
