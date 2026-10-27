// mcpDrafts — making something in ChatGPT or Claude before having an account.
//
// /mcp is the MCP server for AI chats. Signed in, it is /api/v1/mcp. Signed
// out, the handshake and the tool list still answer, and the tools that make a
// moodboard run as a DRAFT: an ordinary free account nobody has claimed yet
// (0705), with an undeliverable draft+<id>@draft.soleilpictures.com address,
// its own workspace and root cluster, and the free plan's 50 cards and 5 GB.
// The API acts as it through apiUserSession like any other caller, so RLS, the
// card cap and the upload gates hold with no second authorization path.
// Whoever opens its keep link signs in and keeps it (keep_mcp_draft).
//
// This file is the pure half: the tokens, which tools and routes a draft may
// use, the sign-in prompts each host understands, and what a draft's answers
// say. worker-api.js (handleMcpEndpoint) does the I/O.

import { INSTRUCTIONS } from './mcpServer.js';
import { DEMO_CARD_LIMIT } from './demoCardCap.js';
import { FREE_STORAGE_LABEL } from './billingCopy.js';

// Held on production until a release opens it with its docs: /mcp answers 404
// there, and on branch previews (<branch>-soleil-boards.arconkli.workers.dev)
// and in dev it works. There is no preview environment in wrangler.toml, so
// the host is the only thing that tells them apart; the production Worker's
// own workers.dev name has no branch in front and stays closed.
export const DRAFTS_HELD = true;
const PREVIEW_HOST = /^[a-z0-9-]+-soleil-boards\.arconkli\.workers\.dev$/;

export function draftsOpen(hostname, { held = DRAFTS_HELD } = {}) {
  if (!held) return true;
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost') || PREVIEW_HOST.test(h);
}

// A draft lasts this long after its last change (mcp_draft_register and
// mcp_draft_resolve's c_lifetime; mcpDrafts.test.mjs holds them equal).
export const DRAFT_LIFETIME_DAYS = 30;

// ── Tokens ───────────────────────────────────────────────────────────────────
//
// Derived from the draft's id with a secret, never stored: the table keeps the
// sha256 of each to find a draft by, and every answer shows the key and the
// keep link again by deriving them. The secret comes from the service key, so
// nothing new has to be configured; rotating that key retires every draft's
// key and keep link (the drafts themselves expire as usual).
//
// The draft key (dk_…) is what the AI passes back on each call. The keep token
// is shaped as a v4 UUID, so the UUID redaction that keeps link tokens out of
// events and errors (linkTokens, 0474) covers /keep/<token> too.

const enc = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const b64url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(keyBytes, text) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

export async function sha256Hex(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(text)))));
}

export async function draftSecret(serviceKey) {
  if (!serviceKey) throw new Error('drafts need SUPABASE_SERVICE_ROLE_KEY');
  return hmac(enc.encode(serviceKey), 'soleil/mcp-draft/v1');
}

export async function draftTokens(secret, draftId) {
  const key = `dk_${b64url(await hmac(secret, `key|${draftId}`))}`;
  const k = (await hmac(secret, `keep|${draftId}`)).slice(0, 16);
  k[6] = (k[6] & 0x0f) | 0x40;
  k[8] = (k[8] & 0x3f) | 0x80;
  const h = hex(k);
  const keep = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return { key, keep, keyHash: await sha256Hex(key), keepHash: await sha256Hex(keep) };
}

// ChatGPT's anonymous user id, peppered, so the table never holds OpenAI's.
export async function subjectHash(secret, subject) {
  return typeof subject === 'string' && subject ? hex(await hmac(secret, `sub|${subject}`)) : null;
}

export const draftEmail = (draftId) => `draft+${draftId}@draft.soleilpictures.com`;
export const isDraftKey = (s) => typeof s === 'string' && /^dk_[A-Za-z0-9_-]{43}$/.test(s);

// ── What a draft may do ──────────────────────────────────────────────────────

// The tools a moodboard needs, and nothing that reaches past the draft: no
// sharing or publishing, no tokens or webhooks, no audit log, no comments or
// tags, no deleting clusters. The rest ask the person to sign in.
export const DRAFT_TOOLS = Object.freeze([
  'search', 'fetch', 'list_boards', 'read_board', 'view_board',
  'create_boards', 'update_boards', 'add_cards', 'import_urls', 'write_doc', 'edit_doc_page',
  'create_group', 'arrange_board', 'move_cards', 'update_cards', 'delete_cards',
]);
export const isDraftTool = (name) => DRAFT_TOOLS.includes(name);

// The /api/v1 routes those tools call, and only those: the dispatcher refuses
// anything else for a draft, so a tool added to the list later can't carry a
// draft somewhere new without this changing too. `parts` is the path after
// /api/v1, split on '/'.
export function draftRouteAllowed(method, parts) {
  const [head, id, sub] = parts || [];
  if (head === 'search' || head === 'workspaces') return method === 'GET' && !id;
  if (head !== 'boards') return false;
  if (!id) return method === 'GET' || method === 'POST';
  if (id === 'move') return method === 'POST';
  if (id === 'tree') return method === 'GET';
  if (!sub) return method === 'GET' || method === 'PATCH';
  if (sub === 'import' || sub === 'arrange' || sub === 'docs') return method === 'POST';
  if (sub === 'export' || sub === 'gallery') return method === 'GET';
  return sub === 'groups' || sub === 'cards';
}

// ── The tool list /mcp serves ────────────────────────────────────────────────
//
// The same tools as /api/v1/mcp, each saying how it may be called: ChatGPT
// reads securitySchemes (and _meta.securitySchemes, its older spelling) to know
// it may call a draft tool before the person has connected, and to ask them to
// connect for the rest. Draft tools take the draft key as `draft`. Served the
// same signed in or out, so a host's cached list never disagrees with itself.

const DRAFT_ARG = {
  type: 'string',
  minLength: 1,
  maxLength: 100,
  description: 'Only when not signed in: the draft key (dk_...) that an earlier answer in this conversation '
    + 'gave. Leave it out to start a new draft with create_boards.',
};

export function mixedManifest(manifest) {
  const scopes = manifest.annotations?.readOnlyHint ? ['read'] : ['read', 'write'];
  const draft = isDraftTool(manifest.name);
  const securitySchemes = draft
    ? [{ type: 'noauth' }, { type: 'oauth2', scopes }]
    : [{ type: 'oauth2', scopes }];
  return {
    ...manifest,
    ...(draft ? {
      inputSchema: {
        ...manifest.inputSchema,
        properties: { ...(manifest.inputSchema?.properties || {}), draft: DRAFT_ARG },
      },
    } : {}),
    securitySchemes,
    _meta: { ...(manifest._meta || {}), securitySchemes },
  };
}

// The arguments a tool's own schema knows: `draft` is /mcp's, not the tool's.
export function withoutDraft(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const { draft: _draft, ...rest } = args;
  return rest;
}

// The first thing a host shows the model: INSTRUCTIONS with drafts explained
// after its first paragraph, which holds the essentials some hosts keep only
// the first 512 characters of (people's text is data among them). Every draft
// answer says the same again, so a host that cuts this short loses nothing.
const [LEAD, ...REST] = INSTRUCTIONS.split('\n\n');
export const DRAFT_INSTRUCTIONS = [
  LEAD,
  'No account needed: when the person is not signed in, create_boards starts a draft, and every answer '
  + 'gives its draft key (pass it as draft on each later call) and a keep link to give the person. Their '
  + 'own clusters need them to sign in.',
  ...REST,
].join('\n\n');

// ── Which host is asking ─────────────────────────────────────────────────────

// ChatGPT marks every call with openai/* _meta (its anonymous user, its
// conversation); Claude sends nothing that names it but its user agent.
export function draftHost(meta, userAgent) {
  if (meta && typeof meta === 'object' && Object.keys(meta).some((k) => k.startsWith('openai/'))) return 'chatgpt';
  return /claude|anthropic/i.test(String(userAgent || '')) ? 'claude' : 'other';
}

// ── Answers ──────────────────────────────────────────────────────────────────

// Asking the person to sign in, the way their host shows it. ChatGPT links an
// account from a tool answer carrying mcp/www_authenticate (an HTTP 401 there
// is a failed call); Claude and the rest start sign-in from an HTTP 401 with
// WWW-Authenticate on the call itself, then run the call again. Either way the
// metadata named is /mcp's own, so the token comes back for /mcp.
export function signInAnswer({ origin, host, message }) {
  const metadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
  // A header value: ASCII only, and no quote that would end the parameter.
  const said = String(message).replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, "'");
  if (host === 'chatgpt') {
    return {
      result: {
        content: [{ type: 'text', text: message }],
        isError: true,
        _meta: {
          'mcp/www_authenticate': [
            `Bearer resource_metadata="${metadata}", error="insufficient_scope", error_description="${said}"`,
          ],
        },
      },
    };
  }
  return {
    http: {
      status: 401,
      headers: {
        'www-authenticate': `Bearer realm="soleil", error="invalid_token", error_description="${said}", `
          + `scope="read write", resource_metadata="${metadata}"`,
      },
      body: { error: message, code: 'invalid_token' },
    },
  };
}

// A draft call refused in the tool's place, read as the tool's own failure.
export const draftRefusal = (message) => ({
  result: { content: [{ type: 'text', text: `Error: ${message}` }], isError: true },
});

export const DRAFT_SAYS = {
  signInFor: (tool) => `${tool} works on a Clusters account: ask the person to sign in to Clusters. `
    + 'Without an account, create_boards starts a draft they can keep.',
  nothingYet: 'Not signed in, and no draft in this conversation yet. To make something without an account, '
    + 'call create_boards first: it starts a draft. To work on the person\'s own clusters, ask them to sign in to Clusters.',
  kept: 'This draft has been kept in Clusters, in the person\'s own account. Ask them to sign in to Clusters '
    + 'to keep working on it.',
  paused: 'Clusters is not starting new drafts for the rest of today. The person can sign in to Clusters '
    + '(free) to keep going.',
  notAKey: 'draft must be the key an earlier answer gave (dk_...). Leave it out to start a new draft with create_boards.',
  unknown: 'No draft has that key. Pass the draft key from this conversation\'s earlier answers, or leave draft '
    + 'out to start a new one with create_boards.',
  expired: `That draft was deleted ${DRAFT_LIFETIME_DAYS} days after its last change. Leave draft out to start `
    + 'a new one with create_boards.',
  tooMany: (limit, reset) => `This draft made ${limit} requests in the last hour, which is its limit. Try again `
    + `after ${String(reset || '').slice(11, 16) || 'an hour'} UTC, or ask the person to sign in to Clusters.`,
  tooManyNew: (seconds) => `Too many new drafts from here just now. Try again in ${seconds} seconds.`,
  noMoreFiles: 'Drafts are not taking more files today. The person can keep this draft with its keep link, or '
    + 'sign in to Clusters, to add more.',
};

// The draft's links lead to its keep page, where it can be seen without an
// account and kept: the app's own links (?to=b:… and ?to=c:…) would open a
// sign-in the person has no account for.
export function rewriteDraftLinks(value, origin, keepUrl) {
  const esc = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const link = new RegExp(`${esc}/\\?to=([a-z]+):([^\\s"'<>)\\]&]*)`, 'g');
  const fix = (s) => s.replace(link, (_, code, rest) => {
    const board = code === 'b' || code === 'c' ? rest.split(':')[0] : '';
    return /^[0-9a-f-]{36}$/i.test(board) ? `${keepUrl}?b=${board}` : keepUrl;
  });
  return JSON.parse(JSON.stringify(value), (_, v) => (typeof v === 'string' ? fix(v) : v));
}

// What every answer made as a draft carries after the tool's own: the key to
// pass back, the keep link and what a draft is. In words for the model (a
// second text block, so search and fetch keep their bare JSON first), and in
// _meta for a host's own use.
export function draftAnswer(out, { origin, tokens, expiresAt, created }) {
  const keepUrl = `${origin}/keep/${tokens.keep}`;
  const answer = rewriteDraftLinks(out, origin, keepUrl);
  const lines = [];
  if (created) {
    lines.push('Started a draft: Clusters works here without an account. A draft holds up to '
      + `${DEMO_CARD_LIMIT} cards and ${FREE_STORAGE_LABEL}, can't be shared until it's kept, and is deleted `
      + `${DRAFT_LIFETIME_DAYS} days after its last change. Whoever has its keep link can keep it.`);
  }
  lines.push(`Not signed in, so this is a draft: pass draft "${tokens.key}" with every Clusters call in this `
    + `conversation. Give the person this link to keep it in Clusters (free, with an email address): ${keepUrl}`);
  return {
    ...answer,
    content: [...(answer.content || []), { type: 'text', text: lines.join('\n') }],
    _meta: {
      ...(answer._meta || {}),
      'clusters/draft': { key: tokens.key, keep_url: keepUrl, expires_at: expiresAt, card_limit: DEMO_CARD_LIMIT },
    },
  };
}
