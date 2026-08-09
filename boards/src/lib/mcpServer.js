// The hosted MCP server: MCP over HTTP, served by the Worker at /api/v1/mcp.
//
// WHY. The stdio server is fine for one developer and useless to a studio: it
// means cloning a repository, having Node on the machine, and editing a JSON
// file with an absolute path. A pipeline TD evaluating three tools in an
// afternoon will not do that. A URL and a token, they will.
//
// It is STATELESS. Every request carries its own bearer token and is answered
// on its own; there is no session id, no server-initiated stream, no
// subscription. That fits both the transport (a Worker isolate does not survive
// between requests) and the content (nothing here needs to push).
//
// Authentication is the SAME personal access token as the REST API — resolved
// by the same resolveApiToken, so the scopes and the rate limit that govern
// /api/v1 govern this identically. There is no second credential and no second
// permission model, which is the only way the two cannot drift apart.

import { HOSTED_TOOLS, PROMPTS, SERVER_INFO, toolManifest } from './mcpTools.js';

// The newest version this implements. A client asking for something else is
// answered with this rather than refused: the specification says to negotiate
// down, and refusing over a version number is how an integration fails for a
// reason nobody can act on.
const PROTOCOL_VERSION = '2025-06-18';

const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
const error = (id, code, message, data) => ({
  jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) },
});

// JSON-RPC's own codes. -32602 is "invalid params", which is what an unknown
// tool name and a bad argument both are from the protocol's point of view; a
// tool that RAN and failed is a successful call with isError, not an RPC error.
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// A tool's own failure is content, not a transport error. A model that gets an
// RPC error learns only that something broke; one that gets isError with the
// API's sentence learns what to do differently.
const toolFailure = (message) => ({
  content: [{ type: 'text', text: `Error: ${message}` }],
  isError: true,
});

async function callTool(name, args, ctx) {
  const tool = HOSTED_TOOLS.find((t) => t.name === name);
  if (!tool) return { unknown: true };
  try {
    const out = await tool.call(args || {}, ctx);
    if (tool.image) {
      // view_image returns bytes. An image block is the entire point of the
      // tool — a base64 string in a text block is not something a model can see.
      const b64 = bytesToBase64(out.bytes);
      if (!/^image\//.test(out.contentType)) {
        return toolFailure(`that key is ${out.contentType}, not an image`);
      }
      return {
        content: [
          { type: 'image', data: b64, mimeType: out.contentType },
          { type: 'text',
            text: `Image ${args.image_key} — ${out.contentType}, ${out.bytes.byteLength} bytes`
              + (out.variant === 'preview'
                ? ' (a downscaled preview, which is what you are looking at).'
                : ' (the original; no smaller rendition was stored).') },
        ],
      };
    }
    const text = JSON.stringify(out, null, 2);
    return {
      content: [{ type: 'text', text }],
      ...(tool.outputSchema && out && typeof out === 'object' ? { structuredContent: out } : {}),
    };
  } catch (e) {
    return toolFailure(e?.message || String(e));
  }
}

function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  // Chunked: String.fromCharCode(...u8) throws RangeError somewhere around
  // 100KB, and an image preview is comfortably past that.
  for (let i = 0; i < u8.length; i += 0x8000) {
    binary += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Handle one JSON-RPC message. Returns the response object, or null for a
 * notification (which by specification gets no reply at all).
 */
export async function handleMcpMessage(msg, ctx) {
  const { id, method, params } = msg || {};

  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        // Only what is actually implemented. Advertising `subscribe` or
        // `listChanged` here and then never sending a notification is worse
        // than not advertising it: a client will wait for something that is
        // never coming.
        capabilities: { tools: {}, prompts: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Boards in Soleil Clusters (the interface calls them clusters). Start with whoami to '
          + 'learn what this token may do. Prefer search over listing everything, and view_image '
          + 'when the picture is the point. Deletes are recoverable but still destructive — '
          + 'confirm first.',
      });

    // Notifications carry no id and get no response.
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'ping':
      return result(id, {});

    case 'tools/list':
      return result(id, { tools: HOSTED_TOOLS.map(toolManifest) });

    case 'tools/call': {
      const name = params?.name;
      if (!name) return error(id, INVALID_PARAMS, 'params.name is required');
      const out = await callTool(name, params?.arguments, ctx);
      if (out.unknown) {
        return error(id, INVALID_PARAMS, `unknown tool: ${name}`,
          { available: HOSTED_TOOLS.map((t) => t.name) });
      }
      return result(id, out);
    }

    case 'prompts/list':
      return result(id, {
        prompts: PROMPTS.map((p) => ({
          name: p.name, title: p.title, description: p.description, arguments: p.arguments,
        })),
      });

    case 'prompts/get': {
      const p = PROMPTS.find((x) => x.name === params?.name);
      if (!p) return error(id, INVALID_PARAMS, `unknown prompt: ${params?.name}`);
      const missing = (p.arguments || [])
        .filter((a) => a.required && !params?.arguments?.[a.name])
        .map((a) => a.name);
      if (missing.length) {
        return error(id, INVALID_PARAMS, `missing required argument: ${missing.join(', ')}`);
      }
      return result(id, {
        description: p.description,
        messages: [{
          role: 'user',
          content: { type: 'text', text: p.render(params?.arguments || {}) },
        }],
      });
    }

    // Declared unsupported rather than left to time out. A client probing for
    // resources should get a clean "no" it can branch on.
    case 'resources/list':
      return result(id, { resources: [] });
    case 'resources/templates/list':
      return result(id, { resourceTemplates: [] });

    default:
      if (String(method || '').startsWith('notifications/')) return null;
      return error(id, METHOD_NOT_FOUND, `unsupported method: ${method}`);
  }
}

/**
 * The HTTP shell. A POST carrying one message or a batch; anything else is
 * refused with the reason.
 */
export async function handleMcpRequest(request, ctx) {
  if (request.method !== 'POST') {
    // No SSE stream: this server never initiates anything, so a GET would open
    // a connection that stays silent forever.
    return { status: 405, body: { error: 'POST a JSON-RPC message to this endpoint', code: 'method_not_allowed' } };
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return { status: 400, body: error(null, -32700, 'parse error: body is not JSON') };
  }

  if (Array.isArray(payload)) {
    const out = [];
    for (const msg of payload) {
      const res = await handleMcpMessage(msg, ctx).catch((e) => error(msg?.id, INTERNAL_ERROR, e.message));
      if (res) out.push(res);
    }
    // A batch of only notifications gets 202 with no body, per the transport.
    return out.length ? { status: 200, body: out } : { status: 202, body: null };
  }

  const res = await handleMcpMessage(payload, ctx)
    .catch((e) => error(payload?.id, INTERNAL_ERROR, e.message));
  return res ? { status: 200, body: res } : { status: 202, body: null };
}
