#!/usr/bin/env node
// Soleil Clusters — MCP server.
//
// A thin layer over /api/v1. It holds no credentials of its own and implements
// no permissions: it forwards the user's own personal access token, and the API
// resolves that to their Supabase session so every call runs under ordinary
// RLS. If a model asks for a board the person cannot see, the database says no
// — not this file.
//
// WHAT PROTECTS THE USER, IN ORDER OF HOW MUCH IT IS WORTH:
//
//   1. The token's scopes. A read-only token makes every write tool fail at the
//      API, whatever the model intends. A read+write token still cannot delete:
//      that is a separate `delete` scope (0220), so "can add to my moodboard"
//      and "can destroy my moodboard" are different decisions.
//   2. Tool annotations. destructiveHint / readOnlyHint are what a client reads
//      when deciding whether a call needs confirmation. They are structured, so
//      unlike prose they participate in that decision.
//   3. The wording of the descriptions. Last, and least — it is advice to a
//      model, not a control. It is written bluntly anyway.
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
// right default; add write only if the model should be able to change things,
// and delete only if it should be able to remove them.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { idempotencyKey } from './idempotency.js';

const BASE = (process.env.SOLEIL_API_BASE || 'https://clusters.soleilpictures.com').replace(/\/$/, '');
const TOKEN = process.env.SOLEIL_API_TOKEN || '';

if (!TOKEN) {
  // Fail here rather than on the first tool call. A server that starts and then
  // errors on every request looks like the API is down.
  console.error('SOLEIL_API_TOKEN is not set. Mint one in Clusters under Settings → API.');
  process.exit(1);
}

async function api(path, { method = 'GET', body, tool, args, raw = false, headers } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(method === 'POST' ? { 'idempotency-key': await idempotencyKey(tool || path, args) } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (raw) {
    if (!res.ok) throw new Error(await errorMessage(res, method, path));
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'application/octet-stream',
    };
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON error page */ }
  if (!res.ok) throw new Error(await errorMessage(res, method, path, data));
  return data;
}

// Surface the API's own message: it is written for a person, and a model
// relaying it verbatim is more useful than one inventing a reason. The scope
// case gets a sentence of its own because "403" tells a model nothing it can
// act on, whereas "this token cannot delete" tells the USER what to change.
async function errorMessage(res, method, path, parsed) {
  let data = parsed;
  if (data === undefined) {
    try { data = JSON.parse(await res.text()); } catch (_) { data = null; }
  }
  if (data?.code === 'insufficient_scope') {
    return `${data.error}. This token has: ${(data.scopes || []).join(', ') || 'nothing'}. `
      + 'Mint a new token in Clusters under Settings → API to change that — it cannot be widened from here.';
  }
  if (res.status === 429) return 'Rate limited by Clusters (1000 requests/hour). Wait a little and retry.';
  return data?.error || `${method} ${path} failed (${res.status})`;
}

// MCP tools return content blocks. Everything here is structured data, so it
// goes back as pretty JSON rather than prose — the model reads it better and
// cannot mistake our summary for the data.
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
const run = (fn) => async (args) => { try { return await fn(args); } catch (e) { return fail(e); } };
const jsonTool = (fn) => run(async (args) => ok(await fn(args)));

// Annotation presets. Spelled out once so a new tool cannot land in a weaker
// bucket by having its hints forgotten. openWorldHint is true throughout: this
// talks to a live account over the network, not to a closed dataset.
const READS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const EDITS = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const DESTROYS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

// Output schemas are LOOSE on purpose: they name the fields a client can rely
// on without failing when the API grows one. A strict mirror of the wire format
// would be a third source of truth after the Worker and the OpenAPI document,
// and its failure mode is a hard tool error rather than a degraded response.
const loose = z.looseObject;
const CardOut = loose({
  id: z.string(), kind: z.string(),
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  image_key: z.string().nullable().optional(),
});
const BoardOut = loose({ id: z.string(), name: z.string(), workspace_id: z.string() });

const server = new McpServer({ name: 'soleil-clusters', version: '1.0.0' });

// ── Reading ──────────────────────────────────────────────────────────────────

server.registerTool('whoami', {
  title: 'Who this token belongs to',
  description:
    'The account these tools act as, and what this token is allowed to do. '
    + 'Worth calling first: it reports the scopes, so you can find out whether you '
    + 'may write or delete instead of discovering it by being refused.',
  inputSchema: {},
  outputSchema: {
    user_id: z.string(),
    display_name: z.string().nullable().optional(),
    tier: z.string().optional(),
    scopes: z.array(z.string()),
    rate_limit: loose({}).optional(),
  },
  annotations: READS,
}, run(async () => {
  const me = await api('/me');
  return { content: [{ type: 'text', text: JSON.stringify(me, null, 2) }], structuredContent: me };
}));

server.registerTool('list_workspaces', {
  title: 'List workspaces',
  description: 'List the Soleil Clusters workspaces this account can see.',
  inputSchema: {},
  annotations: READS,
}, jsonTool(() => api('/workspaces')));

server.registerTool('list_boards', {
  title: 'List boards',
  description:
    'List boards. Optionally filter to one workspace, or to the children of one '
    + 'parent board. Pass parent="root" for top-level boards only. Results are paged — '
    + 'if has_more is true, call again with the offset it gives you.',
  inputSchema: {
    workspace_id: z.string().uuid().optional(),
    parent: z.string().optional().describe('A board id, or "root" for top level'),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: READS,
}, jsonTool(({ workspace_id, parent, limit, offset }) => {
  const q = new URLSearchParams();
  if (workspace_id) q.set('workspace', workspace_id);
  if (parent) q.set('parent', parent);
  if (limit) q.set('limit', String(limit));
  if (offset) q.set('offset', String(offset));
  const qs = q.toString();
  return api(`/boards${qs ? `?${qs}` : ''}`);
}));

server.registerTool('search', {
  title: 'Search boards and cards',
  description:
    'Find boards and cards by text — board names, card titles and card bodies. '
    + 'This is how to locate the board about something WITHOUT listing every board and '
    + 'reading each one, so prefer it over list_boards when you know roughly what you '
    + 'are looking for. Card results carry a short excerpt; use read_board for the rest.',
  inputSchema: {
    q: z.string().min(2).describe('At least 2 characters. Punctuation is matched literally.'),
    kind: z.enum(['board', 'card']).optional().describe('Restrict to one or the other; omit for both'),
    workspace_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
  annotations: READS,
}, jsonTool(({ q, kind, workspace_id, limit }) => {
  const p = new URLSearchParams({ q });
  if (kind) p.set('kind', kind);
  if (workspace_id) p.set('workspace', workspace_id);
  if (limit) p.set('limit', String(limit));
  return api(`/search?${p}`);
}));

server.registerTool('read_board', {
  title: 'Read a board',
  description:
    'Read the cards on a board — text, links, images and their positions. '
    + 'This is how to find out what is actually on a board before changing it. '
    + 'Long card text is shortened by default so one call cannot fill your context; '
    + 'pass full=true when you genuinely need every word.',
  inputSchema: {
    board_id: z.string().uuid(),
    full: z.boolean().optional().describe('Return untruncated body/html. Can be very large.'),
    limit: z.number().int().min(1).max(500).optional().describe('Default 100'),
    offset: z.number().int().min(0).optional(),
  },
  annotations: READS,
}, jsonTool(async ({ board_id, full, limit, offset }) => {
  const p = new URLSearchParams();
  if (limit) p.set('limit', String(limit));
  if (offset) p.set('offset', String(offset));
  const qs = p.toString();
  const out = await api(`/boards/${board_id}/cards${qs ? `?${qs}` : ''}`);
  if (full) return out;
  // Truncation lives HERE, not in the API. The API returns the truth; this
  // layer shapes it for a context window. A 300-card board of long notes is
  // several hundred KB, and a model that spends its window on one read cannot
  // then do anything with it.
  const trim = (s, n) => (typeof s === 'string' && s.length > n
    ? `${s.slice(0, n)}… [${s.length - n} more characters — call again with full=true]`
    : s);
  return {
    ...out,
    cards: (out.cards || []).map((c) => ({
      ...c,
      body: trim(c.body, 500),
      // html is markup a model almost never needs and is the biggest field on a
      // rich note. Its text is already in `body`.
      html: c.html ? '[html omitted — call again with full=true]' : null,
    })),
    truncated: !full,
  };
}));

server.registerTool('view_image', {
  title: 'Look at an image on a board',
  description:
    'Fetch an image card\'s actual picture so you can SEE it, rather than only knowing '
    + 'its key. Takes the image_key from a card returned by read_board. This is what makes '
    + 'it possible to say anything real about a moodboard.',
  inputSchema: {
    image_key: z.string().describe('The image_key field of an image card'),
  },
  annotations: READS,
}, run(async ({ image_key }) => {
  const { bytes, contentType } = await api(`/images/${image_key.split('/').map(encodeURIComponent).join('/')}`, { raw: true });
  // Base64 inflates by a third and every byte lands in the conversation, so a
  // full-resolution photo is a real cost. Refusing loudly beats silently
  // spending someone's context on one picture.
  //
  // This leaves a real gap: /api/v1/uploads accepts up to 25MB, so an image
  // between 5MB and 25MB can be stored and then never looked at from here. The
  // message has to be honest about that, and about what the person can actually
  // DO — "send a smaller one" is not an action available to someone whose photo
  // is already on the board. (The fix that would close it is serving the
  // progressive preview variant the app generates; the API does not expose
  // those yet, because a Worker cannot resize an image itself.)
  const MAX = 5 * 1024 * 1024;
  if (bytes.length > MAX) {
    throw new Error(
      `That image is ${(bytes.length / 1048576).toFixed(1)}MB, over the ${MAX / 1048576}MB this tool can inline — `
      + 'reading it would use most of the conversation. It is fine on the board and opens normally in '
      + 'Clusters; tell the person you cannot view this one here, and work from its title, caption and '
      + 'the other cards instead.');
  }
  return {
    content: [
      { type: 'image', data: bytes.toString('base64'), mimeType: contentType },
      { type: 'text', text: `Image ${image_key} (${contentType}, ${bytes.length} bytes)` },
    ],
  };
}));

server.registerTool('list_deleted_boards', {
  title: 'List deleted boards',
  description:
    'Boards that were deleted but are still recoverable. Pair with restore_board.',
  inputSchema: { workspace_id: z.string().uuid().optional() },
  annotations: READS,
}, jsonTool(({ workspace_id }) => {
  const p = new URLSearchParams({ deleted: '1' });
  if (workspace_id) p.set('workspace', workspace_id);
  return api(`/boards?${p}`);
}));

// ── Writing ──────────────────────────────────────────────────────────────────
// Every description below states plainly what the tool changes, and the two that
// destroy content say so first. The annotations above carry the same fact in a
// form a client can act on without reading English.

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
  outputSchema: { board: BoardOut },
  annotations: WRITES,
}, run(async (body) => {
  const out = await api('/boards', { method: 'POST', body, tool: 'create_board', args: body });
  return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
}));

server.registerTool('rename_board', {
  title: 'Rename a board',
  description:
    'CHANGES a board\'s name, its view, or which board it sits inside. Only what you '
    + 'pass is altered. Moving a board under one of its own descendants is refused.',
  inputSchema: {
    board_id: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    view: z.enum(['canvas', 'list']).optional(),
    parent_board_id: z.string().uuid().nullable().optional()
      .describe('null moves it to the top level'),
  },
  annotations: EDITS,
}, jsonTool(({ board_id, ...patch }) =>
  api(`/boards/${board_id}`, { method: 'PATCH', body: patch })));

server.registerTool('add_cards', {
  title: 'Add cards to a board',
  description:
    'ADDS cards to a board. Existing cards are never touched, and new cards are '
    + 'positioned in free space so they cannot cover anything already there. '
    + 'Give x and y only if you specifically want to place a card yourself. '
    + 'For an image card, call upload_image first and pass the image_key it returns.',
  inputSchema: {
    board_id: z.string().uuid(),
    cards: z.array(z.object({
      kind: z.enum(['note', 'image', 'link', 'doc']).optional().describe('Defaults to note'),
      title: z.string().optional(),
      body: z.string().optional().describe('The text of the card, whatever kind it is'),
      url: z.string().optional().describe('For kind=link'),
      image_key: z.string().optional().describe('From upload_image. For kind=image'),
      alt: z.string().optional().describe('Alt text, for kind=image'),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      h: z.number().optional(),
    })).min(1).max(100),
  },
  annotations: WRITES,
}, jsonTool(({ board_id, cards }) =>
  api(`/boards/${board_id}/cards`, {
    method: 'POST', body: { cards }, tool: 'add_cards', args: { board_id, cards },
  })));

server.registerTool('upload_image', {
  title: 'Upload an image',
  description:
    'UPLOADS image bytes and returns an image_key to pass to add_cards. The image is '
    + 'charged against the board owner\'s storage. Give the bytes base64-encoded. '
    + 'Maximum 25MB, and the content type must be a real image type.',
  inputSchema: {
    board_id: z.string().uuid().describe('The board this upload is charged to'),
    data: z.string().describe('The image bytes, base64-encoded'),
    content_type: z.enum([
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/avif',
    ]),
  },
  annotations: WRITES,
}, jsonTool(async ({ board_id, data, content_type }) => {
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length) throw new Error('data decoded to nothing — is it valid base64?');
  const res = await fetch(`${BASE}/api/v1/uploads?board=${encodeURIComponent(board_id)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': content_type,
      'idempotency-key': await idempotencyKey('upload_image', { board_id, content_type, len: bytes.length }),
    },
    body: bytes,
  });
  const text = await res.text();
  let out = null;
  try { out = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON */ }
  if (!res.ok) throw new Error(await errorMessage(res, 'POST', '/uploads', out));
  return out;
}));

server.registerTool('update_card', {
  title: 'Update a card',
  description:
    'CHANGES an existing card in place. Only the fields you pass are altered; '
    + 'anything you leave out keeps its current value. The card id cannot be changed, '
    + 'and `kind` must be a real kind — an unrecognised one is refused rather than '
    + 'quietly turning the card into a note.',
  inputSchema: {
    board_id: z.string().uuid(),
    card_id: z.string(),
    kind: z.enum(['note', 'image', 'link', 'doc']).optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    url: z.string().optional(),
    alt: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
  },
  annotations: EDITS,
}, jsonTool(({ board_id, card_id, ...patch }) =>
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
  annotations: WRITES,
}, jsonTool(({ from_board_id, to_board_id, card_ids }) =>
  api(`/boards/${from_board_id}/cards/move`, {
    method: 'POST',
    body: { to_board_id, card_ids },
    tool: 'move_cards',
    args: { from_board_id, to_board_id, card_ids },
  })));

server.registerTool('restore_board', {
  title: 'Restore a deleted board',
  description: 'Puts a deleted board back. Find candidates with list_deleted_boards.',
  inputSchema: { board_id: z.string().uuid() },
  annotations: EDITS,
}, jsonTool(({ board_id }) =>
  api(`/boards/${board_id}/restore`, { method: 'POST', tool: 'restore_board', args: { board_id } })));

// ── Destroying ───────────────────────────────────────────────────────────────
// Both of these need a token with the `delete` scope. Without it they fail at
// the API with a message saying so — which is the actual protection here.

server.registerTool('delete_card', {
  title: 'Delete a card',
  description:
    'DELETES a card from a board. This removes the user\'s content — confirm with '
    + 'them before calling it. The deleted card is returned in full, and passing it '
    + 'back to add_cards restores its content.',
  inputSchema: { board_id: z.string().uuid(), card_id: z.string() },
  annotations: DESTROYS,
}, jsonTool(({ board_id, card_id }) =>
  api(`/boards/${board_id}/cards/${encodeURIComponent(card_id)}`, { method: 'DELETE' })));

server.registerTool('delete_board', {
  title: 'Delete a board',
  description:
    'DELETES a whole board and everything on it — confirm with the user before '
    + 'calling it. The delete is recoverable: restore_board puts it back, and '
    + 'list_deleted_boards finds it again.',
  inputSchema: { board_id: z.string().uuid() },
  annotations: DESTROYS,
}, jsonTool(({ board_id }) => api(`/boards/${board_id}`, { method: 'DELETE' })));

// ── Resources ────────────────────────────────────────────────────────────────
//
// Boards as attachable context. A tool call is the model deciding to look; a
// resource is the PERSON deciding what the model gets to see, in their own
// client, before the conversation starts. Different act, worth supporting.

server.registerResource(
  'board',
  new ResourceTemplate('soleil://board/{board_id}', {
    list: async () => {
      try {
        const out = await api('/boards?limit=200');
        return {
          resources: (out.boards || []).map((b) => ({
            uri: `soleil://board/${b.id}`,
            name: b.name || 'Untitled board',
            description: `Clusters board${b.parent_board_id ? ' (nested)' : ''}`,
            mimeType: 'application/json',
          })),
        };
      } catch (_) {
        // A client listing resources at startup must not see a crash because the
        // network was briefly down. An empty list is honest and recoverable.
        return { resources: [] };
      }
    },
  }),
  {
    title: 'Board',
    description: 'The cards on one Clusters board, as JSON.',
    mimeType: 'application/json',
  },
  async (uri, { board_id }) => {
    const out = await api(`/boards/${board_id}/cards`);
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(out, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr only: stdout carries the JSON-RPC stream, and one stray log on it
// corrupts the protocol.
console.error(`soleil-clusters MCP ready against ${BASE}`);
