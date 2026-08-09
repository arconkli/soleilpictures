// GENERATED — do not edit. Source: boards/src/lib/mcpServer.js
// Regenerate with `npm run sync` in mcp/.

// The MCP server: one implementation, two transports, two protocol eras.
//
// WHY IT IS HOSTED. The stdio server is fine for one developer and useless to a
// studio: it means cloning a repository, having Node on the machine, and
// editing a JSON file with an absolute path. A pipeline TD evaluating three
// tools in an afternoon will not do that. A URL and a token, they will.
//
// WHY IT IS DUAL-ERA. Revision 2026-07-28 is the largest change since MCP
// launched: it DELETES the `initialize`/`notifications/initialized` handshake.
// Protocol version, client identity and client capabilities now ride in `_meta`
// on every single request, so any server instance can answer any request and
// nothing has to remember a session. That is a straight win for a Worker, whose
// isolate does not survive between requests anyway — we were already stateless
// and were paying for a handshake that bought us nothing.
//
// But no shipping client speaks it yet. The official SDK's newest version is
// 2025-11-25, which means Claude Desktop, Claude Code, Cursor and everything
// else in the wild still open with `initialize`. So this server answers BOTH,
// and the spec says exactly how to decide which: an `initialize` request
// selects legacy semantics; a request carrying per-request `_meta` is served
// statelessly under the new revision. Everything else is shared — the same
// tools, the same registry, the same permission model.
//
// Authentication is the SAME personal access token as the REST API — resolved
// by the same resolveApiToken, so the scopes and the rate limit that govern
// /api/v1 govern this identically. There is no second credential and no second
// permission model, which is the only way the two cannot drift apart.

import { HOSTED_TOOLS, PROMPTS, SERVER_INFO, toolManifest } from './tools.js';

// Newest first: this is the list handed to a client in an
// UnsupportedProtocolVersionError, and it is the order it should prefer.
export const SUPPORTED_PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18'];

// "Modern" in the spec's own terminology: versions that carry version,
// identity and capabilities as per-request metadata. Everything else is
// "legacy" — it establishes a session with an `initialize` handshake.
const MODERN_VERSIONS = new Set(['2026-07-28']);

// What a legacy client is told when it asks for a version we do not implement.
// A handshake MUST answer with something, and answering with our best is what
// lets a client decide whether it can continue.
const PREFERRED_LEGACY_VERSION = '2025-11-25';

export const isModernVersion = (v) => MODERN_VERSIONS.has(v);

// The reserved `_meta` keys. Written out rather than built from a prefix
// constant, so a grep for the wire name finds the code that reads it.
export const META = {
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
};

// JSON-RPC's own codes, plus the three the MCP specification allocates for
// itself. 2026-07-28 partitions the implementation-defined range: -32000 to
// -32019 is grandfathered legacy, -32020 to -32099 belongs to the spec. The
// codes below are the spec's, at their post-renumbering values.
export const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  HEADER_MISMATCH: -32020,
  MISSING_CLIENT_CAPABILITY: -32021,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
};

// Freshness hints for cacheable results. The tool set is a fixed array that
// does not vary by token — every caller sees the same list — so it is genuinely
// `public` and a shared intermediary may cache it. If tools are ever filtered
// by scope, this MUST become "private": the whole point of the field is that a
// proxy believes it.
const LIST_TTL_MS = 300_000;
const DISCOVER_TTL_MS = 3_600_000;
const CACHE_SCOPE = 'public';

const INSTRUCTIONS =
  'Boards in Soleil Clusters (the interface calls them clusters). Start with whoami to '
  + 'learn what this token may do. Prefer search over listing everything, and view_image '
  + 'when the picture is the point. Deletes are recoverable but still destructive — '
  + 'confirm first.';

const CAPABILITIES = { tools: {}, prompts: {} };

// Past this, an image is not worth what it costs to look at.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// ── Message shaping ──────────────────────────────────────────────────────────

// A modern result carries `resultType` and identifies its server in `_meta`.
// A legacy result must NOT: a client validating against the older schema has no
// reason to expect either, and this costs nothing to keep clean.
function shapeResult(value, modern) {
  if (!modern) return value;
  return {
    resultType: 'complete',
    ...value,
    _meta: { ...(value._meta || {}), [META.serverInfo]: SERVER_INFO },
  };
}

const ok = (id, value, modern, status = 200) => ({
  body: { jsonrpc: '2.0', id, result: shapeResult(value, modern) },
  status,
});

const errorBody = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id: id === undefined ? null : id,
  error: { code, message, ...(data ? { data } : {}) },
});

const err = (id, code, message, data, status = 200) => ({
  body: errorBody(id, code, message, data),
  status,
});

// ttlMs and cacheScope are required on list results in 2026-07-28 and unknown
// before it.
const cacheable = (value, modern, ttlMs) =>
  (modern ? { ...value, ttlMs, cacheScope: CACHE_SCOPE } : value);

// ── Header mirroring (Streamable HTTP) ───────────────────────────────────────

// A header value that cannot be expressed in plain ASCII arrives wrapped in the
// spec's sentinel. The markers are case-sensitive and must appear exactly.
export function decodeHeaderValue(raw) {
  const s = String(raw);
  const m = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(s);
  if (!m) return s;
  try {
    const binary = atob(m[1]);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return s;
  }
}

// Which body field each method mirrors into `Mcp-Name`.
const NAME_SOURCE = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
};

/**
 * Validate the mirrored HTTP headers against the body, per 2026-07-28.
 *
 * The point is not ceremony. An intermediary — a load balancer, a WAF, a
 * per-tenant rate limiter — is allowed to route on the header without parsing
 * the body, so a header that disagrees with the body is a way to make two
 * components act on different values. Returns a sentence, or null if fine.
 *
 * Legacy requests have no header contract and are never checked.
 */
export function headerProblem(headers, msg) {
  const declared = msg?.params?._meta?.[META.protocolVersion];
  if (!declared || !isModernVersion(declared)) return null;

  const get = (n) => (headers && typeof headers.get === 'function' ? headers.get(n) : null);

  const version = get('mcp-protocol-version');
  if (!version) return 'the MCP-Protocol-Version header is required';
  if (version !== declared) {
    return `MCP-Protocol-Version header '${version}' does not match the body value '${declared}'`;
  }

  const method = get('mcp-method');
  if (!method) return 'the Mcp-Method header is required';
  if (method !== msg.method) {
    return `Mcp-Method header '${method}' does not match the body method '${msg.method}'`;
  }

  const field = NAME_SOURCE[msg.method];
  if (field) {
    const raw = get('mcp-name');
    if (raw === null || raw === undefined) {
      return `the Mcp-Name header is required for ${msg.method}`;
    }
    const expected = msg?.params?.[field];
    const name = decodeHeaderValue(raw);
    if (name !== expected) {
      return `Mcp-Name header '${name}' does not match the body value '${expected}'`;
    }
  }
  return null;
}

// ── Tool invocation ──────────────────────────────────────────────────────────

// A tool's own failure is content, not a transport error. A model that gets an
// RPC error learns only that something broke; one that gets isError with the
// API's sentence learns what to do differently.
const toolFailure = (message) => ({
  content: [{ type: 'text', text: `Error: ${message}` }],
  isError: true,
});

async function callTool(tools, name, args, ctx) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { unknown: true };
  // The transport may want a per-call context — the stdio server derives an
  // idempotency key from the tool name and its arguments.
  const callCtx = typeof ctx?.forTool === 'function' ? ctx.forTool(tool, args || {}) : ctx;
  try {
    const out = await tool.call(args || {}, callCtx);
    if (tool.image) {
      // view_image returns bytes. An image block is the entire point of the
      // tool — a base64 string in a text block is not something a model can see.
      if (!/^image\//.test(out.contentType)) {
        return toolFailure(`that key is ${out.contentType}, not an image`);
      }
      // The stdio server had this ceiling and the hosted one did not, which
      // meant the same picture was a sentence on one transport and a 14MB
      // base64 wall on the other. Base64 inflates by a third before it even
      // reaches the model's context.
      const size = out.bytes.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        return toolFailure(`that image is ${(size / 1048576).toFixed(1)}MB, too large to look at. `
          + 'Work from its title and caption instead.');
      }
      return {
        content: [
          { type: 'image', data: bytesToBase64(out.bytes), mimeType: out.contentType },
          {
            type: 'text',
            text: `Image ${args.image_key} — ${out.contentType}, ${out.bytes.byteLength} bytes`
              + (out.variant === 'preview'
                ? ' (a downscaled preview, which is what you are looking at).'
                : ' (the original; no smaller rendition was stored).'),
          },
        ],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
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

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Handle one JSON-RPC message.
 *
 * Returns `{ body, status }`. `body` is null for a notification, which by
 * specification gets no reply at all. `status` is the HTTP status the
 * Streamable HTTP transport must use — it is part of the answer in this
 * revision, not a detail the caller can infer: a header mismatch and an
 * unsupported version are both 400, an unknown method is 404.
 *
 * `ctx.tools` selects the registry. The hosted server serves HOSTED_TOOLS; the
 * stdio server serves all of them, including the one that reads local files.
 */
export async function handleMcpMessage(msg, ctx) {
  const { id, method, params } = msg || {};
  const tools = ctx?.tools || HOSTED_TOOLS;

  // Notifications carry no id and get no response. 2026-07-28 defines no
  // client-to-server notifications at all, but a legacy client still sends
  // notifications/initialized, and answering it would be a protocol error.
  if (String(method || '').startsWith('notifications/')) return { body: null, status: 202 };

  // `initialize` is the legacy opener and is never modern. Anything else that
  // declares a version in _meta is speaking the per-request model.
  const declared = method === 'initialize' ? null : params?._meta?.[META.protocolVersion];

  if (declared !== undefined && declared !== null && typeof declared !== 'string') {
    return err(id, ERR.INVALID_PARAMS,
      `_meta['${META.protocolVersion}'] must be a string`, undefined, 400);
  }
  if (declared && !SUPPORTED_PROTOCOL_VERSIONS.includes(declared)) {
    return err(id, ERR.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version',
      { supported: SUPPORTED_PROTOCOL_VERSIONS, requested: declared }, 400);
  }

  const modern = Boolean(declared) && isModernVersion(declared);

  // Modern requests MUST declare what the client can do. A server is forbidden
  // from relying on a capability the client did not declare, which is only
  // enforceable if the declaration is mandatory.
  if (modern) {
    const caps = params?._meta?.[META.clientCapabilities];
    if (!caps || typeof caps !== 'object' || Array.isArray(caps)) {
      return err(id, ERR.INVALID_PARAMS,
        `_meta['${META.clientCapabilities}'] is required on every request in ${declared}`,
        undefined, 400);
    }
  }

  const notFound = (m) => err(id, ERR.METHOD_NOT_FOUND, `unsupported method: ${m}`,
    undefined, modern ? 404 : 200);

  switch (method) {
    // server/discover exists only in the modern revision — it IS the probe a
    // dual-era client sends first on stdio, where there is no HTTP status to
    // drive the fallback. So it always answers in modern shape, whatever the
    // caller declared.
    case 'server/discover':
      return ok(id, cacheable({
        supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
        capabilities: CAPABILITIES,
        instructions: INSTRUCTIONS,
      }, true, DISCOVER_TTL_MS), true);

    // The legacy handshake. Echo the client's version when we implement it, so
    // it can keep speaking what it already knows; otherwise name our best and
    // let it decide. Answering with a version the client did not ask for is
    // the protocol's own fallback, not a failure.
    case 'initialize': {
      if (modern) return notFound(method);
      const requested = params?.protocolVersion;
      const version = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) && !isModernVersion(requested)
        ? requested
        : PREFERRED_LEGACY_VERSION;
      return ok(id, {
        protocolVersion: version,
        // Only what is actually implemented. Advertising `listChanged` here and
        // then never sending a notification is worse than not advertising it: a
        // client will wait for something that is never coming.
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      }, false);
    }

    // Removed in 2026-07-28 — a stateless protocol has no connection to keep
    // alive. Still answered for legacy clients that send it.
    case 'ping':
      return modern ? notFound(method) : ok(id, {}, false);

    case 'tools/list':
      // Deterministic order: the registry is a fixed array and is served in
      // its own order, which is what lets a client cache the list and keeps
      // an LLM's prompt cache warm across calls.
      return ok(id, cacheable({ tools: tools.map(toolManifest) }, modern, LIST_TTL_MS), modern);

    case 'tools/call': {
      const name = params?.name;
      if (!name) return err(id, ERR.INVALID_PARAMS, 'params.name is required');
      const out = await callTool(tools, name, params?.arguments, ctx);
      if (out.unknown) {
        return err(id, ERR.INVALID_PARAMS, `unknown tool: ${name}`,
          { available: tools.map((t) => t.name) });
      }
      return ok(id, out, modern);
    }

    case 'prompts/list':
      return ok(id, cacheable({
        prompts: PROMPTS.map((p) => ({
          name: p.name, title: p.title, description: p.description, arguments: p.arguments,
        })),
      }, modern, LIST_TTL_MS), modern);

    case 'prompts/get': {
      const p = PROMPTS.find((x) => x.name === params?.name);
      if (!p) return err(id, ERR.INVALID_PARAMS, `unknown prompt: ${params?.name}`);
      const missing = (p.arguments || [])
        .filter((a) => a.required && !params?.arguments?.[a.name])
        .map((a) => a.name);
      if (missing.length) {
        return err(id, ERR.INVALID_PARAMS, `missing required argument: ${missing.join(', ')}`);
      }
      return ok(id, {
        description: p.description,
        messages: [{
          role: 'user',
          content: { type: 'text', text: p.render(params?.arguments || {}) },
        }],
      }, modern);
    }

    // Declared empty rather than left to time out. A client probing for
    // resources should get a clean "no" it can branch on.
    case 'resources/list':
      return ok(id, cacheable({ resources: [] }, modern, LIST_TTL_MS), modern);
    case 'resources/templates/list':
      return ok(id, cacheable({ resourceTemplates: [] }, modern, LIST_TTL_MS), modern);

    default:
      return notFound(method);
  }
}

// ── The HTTP shell ───────────────────────────────────────────────────────────

/**
 * A POST carrying one message, or — for a legacy client only — a batch.
 * Anything else is refused with the reason.
 */
export async function handleMcpRequest(request, ctx, parsedBody) {
  if (request.method !== 'POST') {
    // No GET stream and no DELETE: 2026-07-28 removed the standalone SSE
    // endpoint and protocol-level sessions outright, and this server never
    // initiated anything even when they existed. A GET would open a connection
    // that stays silent forever.
    return {
      status: 405,
      body: { error: 'POST a JSON-RPC message to this endpoint', code: 'method_not_allowed' },
    };
  }

  // The body is passed IN, already parsed. The router reads it once at the top
  // of dispatch for every route, and a Request body is a stream that can only
  // be consumed once — re-reading it here returned an empty string and answered
  // every well-formed call with "parse error", which is a confusing thing to be
  // told when you sent valid JSON.
  let payload = parsedBody;
  if (payload === undefined) {
    try {
      payload = await request.json();
    } catch {
      return { status: 400, body: errorBody(null, ERR.PARSE, 'parse error: body is not JSON') };
    }
  }
  if (payload === null || typeof payload !== 'object') {
    return {
      status: 400,
      body: errorBody(null, ERR.PARSE, 'parse error: expected a JSON-RPC message'),
    };
  }

  if (Array.isArray(payload)) {
    // A modern POST body MUST be a single request. Batching survives only for
    // legacy clients, which were allowed it.
    if (payload.some((m) => isModernVersion(m?.params?._meta?.[META.protocolVersion]))) {
      return {
        status: 400,
        body: errorBody(null, ERR.INVALID_REQUEST,
          'batching was removed in 2026-07-28 — POST one JSON-RPC message per request'),
      };
    }
    const out = [];
    for (const msg of payload) {
      const res = await handleMcpMessage(msg, ctx)
        .catch((e) => err(msg?.id, ERR.INTERNAL, e.message));
      if (res.body) out.push(res.body);
    }
    // A batch of only notifications gets 202 with no body, per the transport.
    return out.length ? { status: 200, body: out } : { status: 202, body: null };
  }

  // Header/body agreement is checked before the message is acted on: the whole
  // reason the headers exist is that something upstream may already have
  // routed on them.
  const problem = headerProblem(request.headers, payload);
  if (problem) {
    return { status: 400, body: errorBody(payload?.id, ERR.HEADER_MISMATCH, `Header mismatch: ${problem}`) };
  }

  return handleMcpMessage(payload, ctx)
    .catch((e) => err(payload?.id, ERR.INTERNAL, e.message));
}
