#!/usr/bin/env node
// Soleil Clusters — MCP server.
//
// A thin layer over /api/v1. It holds no credentials of its own and implements
// no permissions: it forwards the user's own personal access token, and the API
// resolves that to their Supabase session so every call runs under ordinary
// RLS. If a model asks for a board the person cannot see, the database says no
// — not this file.
//
// Setup (Claude Desktop / Claude Code, mcp.json):
//
//   "soleil-clusters": {
//     "command": "node",
//     "args": ["/path/to/soleilpictures/mcp/src/index.js"],
//     "env": { "SOLEIL_API_TOKEN": "sk_live_…" }
//   }
//
// Mint the token in Clusters under Settings → API. A read-only token is the
// right default; only tick "Allow writes" if you want the model to be able to
// change things.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.SOLEIL_API_BASE || 'https://clusters.soleilpictures.com').replace(/\/$/, '');
const TOKEN = process.env.SOLEIL_API_TOKEN || '';

if (!TOKEN) {
  // Fail here rather than on the first tool call. A server that starts and then
  // errors on every request looks like the API is down.
  console.error('SOLEIL_API_TOKEN is not set. Mint one in Clusters under Settings → API.');
  process.exit(1);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      // Retries would otherwise duplicate work. The key is derived from the
      // call, so a retry of the SAME request replays rather than repeats, while
      // a genuinely new call gets a new key.
      ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON error page */ }
  if (!res.ok) {
    // Surface the API's own message. It is written for a person, and a model
    // relaying it verbatim is more useful than one inventing a reason.
    throw new Error(data?.error || `${method} ${path} failed (${res.status})`);
  }
  return data;
}

// MCP tools return content blocks. Everything here is structured data, so it
// goes back as pretty JSON rather than prose — the model reads it better and
// cannot mistake our summary for the data.
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
const run = (fn) => async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };

const server = new McpServer({ name: 'soleil-clusters', version: '0.1.0' });

// ── Reading ──────────────────────────────────────────────────────────────────

server.registerTool('list_workspaces', {
  title: 'List workspaces',
  description: 'List the Soleil Clusters workspaces this account can see.',
  inputSchema: {},
}, run(() => api('/workspaces')));

server.registerTool('list_boards', {
  title: 'List boards',
  description:
    'List boards. Optionally filter to one workspace, or to the children of one '
    + 'parent board. Pass parent="root" for top-level boards only.',
  inputSchema: {
    workspace_id: z.string().uuid().optional(),
    parent: z.string().optional().describe('A board id, or "root" for top level'),
  },
}, run(({ workspace_id, parent }) => {
  const q = new URLSearchParams();
  if (workspace_id) q.set('workspace', workspace_id);
  if (parent) q.set('parent', parent);
  const qs = q.toString();
  return api(`/boards${qs ? `?${qs}` : ''}`);
}));

server.registerTool('read_board', {
  title: 'Read a board',
  description:
    'Read every card on a board — text, links, images and their positions. '
    + 'This is how to find out what is actually on a board before changing it.',
  inputSchema: { board_id: z.string().uuid() },
}, run(({ board_id }) => api(`/boards/${board_id}/cards`)));

// ── Writing ──────────────────────────────────────────────────────────────────
// Every description below states plainly what the tool changes. That wording is
// the only thing standing between a model and someone's real work, so it says
// "creates", "changes", "removes" rather than anything softer.

server.registerTool('create_board', {
  title: 'Create a board',
  description:
    'CREATES a new, empty board. If workspace_id is omitted it goes in the '
    + 'personal workspace. Pass parent_board_id to nest it inside another board.',
  inputSchema: {
    name: z.string().min(1).max(200),
    workspace_id: z.string().uuid().optional(),
    parent_board_id: z.string().uuid().optional(),
  },
}, run((body) => api('/boards', { method: 'POST', body })));

server.registerTool('add_cards', {
  title: 'Add cards to a board',
  description:
    'ADDS cards to a board. Existing cards are never touched, and new cards are '
    + 'positioned in free space so they cannot cover anything already there. '
    + 'Give x and y only if you specifically want to place a card yourself.',
  inputSchema: {
    board_id: z.string().uuid(),
    cards: z.array(z.object({
      kind: z.enum(['note', 'image', 'link', 'doc']).optional().describe('Defaults to note'),
      title: z.string().optional(),
      body: z.string().optional(),
      url: z.string().optional().describe('For kind=link'),
      image_key: z.string().optional().describe('An existing R2 key; this API does not upload files'),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      h: z.number().optional(),
    })).min(1).max(100),
  },
}, run(({ board_id, cards }) => api(`/boards/${board_id}/cards`, { method: 'POST', body: { cards } })));

server.registerTool('update_card', {
  title: 'Update a card',
  description:
    'CHANGES an existing card in place. Only the fields you pass are altered; '
    + 'anything you leave out keeps its current value. The card id cannot be changed.',
  inputSchema: {
    board_id: z.string().uuid(),
    card_id: z.string(),
    title: z.string().optional(),
    body: z.string().optional(),
    url: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
  },
}, run(({ board_id, card_id, ...patch }) =>
  api(`/boards/${board_id}/cards/${encodeURIComponent(card_id)}`, { method: 'PATCH', body: patch })));

server.registerTool('move_cards', {
  title: 'Move cards to another board',
  description:
    'MOVES cards from one board to another. They stop being on the source board. '
    + 'They are re-laid-out on the destination so they do not overlap what is there.',
  inputSchema: {
    from_board_id: z.string().uuid(),
    to_board_id: z.string().uuid(),
    card_ids: z.array(z.string()).min(1),
  },
}, run(({ from_board_id, to_board_id, card_ids }) =>
  api(`/boards/${from_board_id}/cards/move`, {
    method: 'POST', body: { to_board_id, card_ids },
  })));

server.registerTool('delete_card', {
  title: 'Delete a card',
  description:
    'DELETES a card from a board. This removes the user\'s content — confirm with '
    + 'them before calling it. The deleted card is returned in full, and adding it '
    + 'back with add_cards restores it.',
  inputSchema: { board_id: z.string().uuid(), card_id: z.string() },
}, run(({ board_id, card_id }) =>
  api(`/boards/${board_id}/cards/${encodeURIComponent(card_id)}`, { method: 'DELETE' })));

server.registerTool('delete_board', {
  title: 'Delete a board',
  description:
    'DELETES a whole board and everything on it — confirm with the user before '
    + 'calling it. The delete is recoverable from the app\'s deleted-boards list, '
    + 'but not from here.',
  inputSchema: { board_id: z.string().uuid() },
}, run(({ board_id }) => api(`/boards/${board_id}`, { method: 'DELETE' })));

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr only: stdout carries the JSON-RPC stream, and one stray log on it
// corrupts the protocol.
console.error(`soleil-clusters MCP ready against ${BASE}`);
