// mcpDrafts.test.mjs — /mcp's drafts, the pure half: making something in
// ChatGPT or Claude with no account (P3b), and keeping it.
//
//   node --test src/lib/mcpDrafts.test.mjs
//
// What this guards:
//   * the hold: /mcp answers on previews and in dev, never on production;
//   * the tokens: stable for a draft, unique to it, shaped as 0705 checks them;
//   * the fence: the draft tools are hosted tools that never reach past the
//     draft, and every route they call is one the dispatcher lets a draft use;
//   * what hosts see: the tool list ChatGPT reads, the sign-in each host
//     understands, and the key and keep link every draft answer carries;
//   * the server's hooks that /mcp runs on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';
import { HOSTED_TOOLS, toolManifest, BOARD_VIEW } from './mcpTools.js';
import { handleMcpMessage, INSTRUCTIONS } from './mcpServer.js';
import { DEMO_CARD_LIMIT } from './demoCardCap.js';
import {
  draftsOpen, DRAFT_LIFETIME_DAYS, draftSecret, draftTokens, subjectHash, sha256Hex, draftEmail, isDraftKey,
  DRAFT_TOOLS, isDraftTool, draftRouteAllowed, mixedManifest, withoutDraft, DRAFT_INSTRUCTIONS, draftHost,
  signInAnswer, draftRefusal, DRAFT_SAYS, rewriteDraftLinks, draftAnswer,
} from './mcpDrafts.js';

const SQL = readFileSync(join(MIGRATIONS_DIR, '0705_mcp_drafts.sql'), 'utf8');
const ORIGIN = 'https://main-soleil-boards.arconkli.workers.dev';
const DRAFT = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const BOARD = '8b7e2f4a-1111-4222-8333-944455556666';
const BOARD2 = '1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const WS = '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';
const ASCII = /^[\x20-\x7e]*$/;
// mcpLint's: a word shaped like a tool name.
const TOOL_LIKE = /\b((?:list|get|read|view|show|export|create|add|update|move|delete|restore|rename|set|upload|import|arrange|tag|write|share|resolve)_[a-z_]+)\b/g;
const HOSTED = new Set(HOSTED_TOOLS.map((t) => t.name));

test('held on production: only branch previews and dev answer', () => {
  for (const h of ['localhost', '127.0.0.1', 'app.localhost', 'main-soleil-boards.arconkli.workers.dev',
    'p3b-drafts-soleil-boards.arconkli.workers.dev', 'MAIN-soleil-boards.arconkli.workers.dev']) {
    assert.equal(draftsOpen(h), true, h);
  }
  for (const h of ['clusters.soleilpictures.com', 'soleil-boards.arconkli.workers.dev',
    'main-soleil-boards.arconkli.workers.dev.evil.example', 'main-soleil-boards.other.workers.dev', '', null, undefined]) {
    assert.equal(draftsOpen(h), false, String(h));
  }
  // What a release flips, with its docs.
  assert.equal(draftsOpen('clusters.soleilpictures.com', { held: false }), true);
});

test('a draft always gets the same key and keep link, and no other draft gets them', async () => {
  const secret = await draftSecret('service-key');
  const a = await draftTokens(secret, DRAFT);
  assert.deepEqual(await draftTokens(secret, DRAFT), a);
  assert.ok(isDraftKey(a.key), a.key);
  // keep_mcp_draft's own pattern, and a v4 UUID so link-token redaction covers it.
  const pattern = SQL.match(/p_token !~ '([^']+)'/)?.[1];
  assert.ok(pattern, 'keep_mcp_draft checks the token is shaped');
  assert.match(a.keep, new RegExp(pattern));
  assert.match(a.keep, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // What the table stores to find them by (mcp_drafts' checks: 64 hex).
  assert.equal(a.keyHash, await sha256Hex(a.key));
  assert.equal(a.keepHash, await sha256Hex(a.keep));
  assert.match(a.keyHash, /^[0-9a-f]{64}$/);
  assert.match(a.keepHash, /^[0-9a-f]{64}$/);
  // Another draft, or another secret, shares nothing.
  const other = await draftTokens(secret, '7c6b5a49-3827-4615-a4b3-c2d1e0f9a8b7');
  assert.notEqual(other.key, a.key);
  assert.notEqual(other.keep, a.keep);
  const rotated = await draftTokens(await draftSecret('another-key'), DRAFT);
  assert.notEqual(rotated.key, a.key);
  assert.notEqual(rotated.keep, a.keep);
  await assert.rejects(() => draftSecret(''), /SUPABASE_SERVICE_ROLE_KEY/);
});

test("ChatGPT's anonymous user is kept only as a peppered hash", async () => {
  const secret = await draftSecret('service-key');
  for (const none of [undefined, null, '', 42, {}]) assert.equal(await subjectHash(secret, none), null);
  const h = await subjectHash(secret, 'v1/abc');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(await subjectHash(secret, 'v1/abc'), h);
  assert.notEqual(h, await sha256Hex('v1/abc'), 'not the bare sha256 anyone could compute');
});

test('a key is a draft key or nothing', () => {
  assert.equal(isDraftKey(`dk_${'a'.repeat(43)}`), true);
  for (const k of [undefined, null, '', 'dk_', `dk_${'a'.repeat(42)}`, `dk_${'a'.repeat(44)}`, `sk_${'a'.repeat(43)}`,
    `dk_${'a'.repeat(42)}=`, 42]) {
    assert.equal(isDraftKey(k), false, String(k));
  }
});

test("a draft's address is the one 0705 registers and keeps out of mail and signups", () => {
  assert.equal(draftEmail(DRAFT), `draft+${DRAFT}@draft.soleilpictures.com`);
  assert.match(SQL, /lower\(u\.email\) = 'draft\+' \|\| p_id::text \|\| '@draft\.soleilpictures\.com'/);
  assert.match(SQL, /'@\(draft\|service\|scout\)\\\.soleilpictures\\\.com\$'/);
});

test('a draft lasts as long after its last change as the SQL says', () => {
  const days = [...SQL.matchAll(/c_lifetime\s+constant interval := interval '(\d+) days'/g)].map((m) => Number(m[1]));
  assert.deepEqual(days, [DRAFT_LIFETIME_DAYS, DRAFT_LIFETIME_DAYS], 'register and resolve');
});

test('the draft tools are hosted tools, and none of them reaches past the draft', () => {
  for (const n of DRAFT_TOOLS) assert.ok(HOSTED.has(n), `${n} is a hosted tool`);
  for (const n of ['whoami', 'share_board', 'unshare_board', 'delete_board', 'restore_board', 'list_audit',
    'add_comment', 'list_comments', 'resolve_comments', 'tag_cards', 'list_tags', 'resolve_identifier', 'upload_image']) {
    assert.ok(HOSTED.has(n), `${n} is a hosted tool`);
    assert.equal(isDraftTool(n), false, `${n} needs an account`);
  }
});

// Each draft tool run against a recorder, with arguments that take each branch.
const RUNS = {
  search: [{ query: 'neon' }],
  fetch: [{ id: `board:${BOARD}` }, { id: `card:${BOARD}:c1` }, { id: `doc:${BOARD}:c1` }],
  list_boards: [{}, { deleted: true }, { depth: 2 }],
  read_board: [{ board_id: BOARD }, { board_id: BOARD, format: 'omc' }],
  view_board: [{ board_id: BOARD }, { board_id: BOARD, card_ids: ['c1'] }],
  show_board: [{ board_id: BOARD }],
  create_boards: [{ boards: [{ name: 'Tokyo noir' }] }],
  update_boards: [{ boards: [{ board_id: BOARD, name: 'Night' }, { board_id: BOARD2, parent_board_id: BOARD }] }],
  add_cards: [{ board_id: BOARD, cards: [{ kind: 'note', body: 'rain' }] }],
  import_urls: [{ board_id: BOARD, urls: ['https://example.com/a.jpg'] }],
  write_doc: [{ board_id: BOARD, title: 'Treatment', pages: [{ title: 'One', markdown: 'Night.' }] },
    { board_id: BOARD, card_id: 'c1', pages: [{ title: 'Two', markdown: 'Rain.' }] }],
  edit_doc_page: [{ board_id: BOARD, card_id: 'c1', page_id: 'p1', markdown: 'Rain.' }],
  create_group: [{ board_id: BOARD, name: 'Palette' }],
  arrange_board: [{ board_id: BOARD }],
  move_cards: [{ from_board_id: BOARD, to_board_id: BOARD2, card_ids: ['c1'] }],
  update_cards: [{ board_id: BOARD, cards: [{ id: 'c1', title: 'Rain' }] }],
  delete_cards: [{ board_id: BOARD, card_ids: ['c1'] }],
};

test('every route a draft tool calls is a route the dispatcher lets a draft use', async () => {
  assert.deepEqual(Object.keys(RUNS).sort(), [...DRAFT_TOOLS].sort(), 'every draft tool is run');
  // Enough of every answer's shape for each tool to get to its next call.
  const answer = {
    board: { id: BOARD, name: 'Noir' }, url: `${ORIGIN}/?to=b:${BOARD}`, cards: [], groups: [], boards: [],
    card: { id: 'c1', kind: 'doc' }, pages: [], pictures: [], items: [], results: [], total: 0,
  };
  for (const [name, runs] of Object.entries(RUNS)) {
    const tool = HOSTED_TOOLS.find((t) => t.name === name);
    for (const args of runs) {
      const calls = [];
      const api = async (path, opts = {}) => {
        const u = new URL(`https://x.example/api/v1${path}`);
        calls.push([opts.method || 'GET', u.pathname.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean)]);
        return answer;
      };
      await Promise.resolve(tool.call(args, { api })).catch(() => {});
      assert.ok(calls.length > 0, `${name} ${JSON.stringify(args)} called the API`);
      for (const [method, parts] of calls) {
        assert.ok(draftRouteAllowed(method, parts), `${name}: ${method} /${parts.join('/')} is open to a draft`);
      }
    }
  }
});

test('a draft is refused every other route', () => {
  const refused = [
    ['GET', ''], ['GET', 'me'], ['GET', 'audit'], ['GET', 'resolve'], ['POST', 'mcp'],
    ['GET', 'webhooks'], ['POST', 'webhooks'], ['GET', 'service-accounts'], ['POST', 'service-accounts'],
    ['POST', 'uploads'], ['POST', 'uploads/multipart'], ['GET', 'images'], ['GET', 'images/k1'],
    ['GET', 'tags/t1'], ['GET', `workspaces/${WS}/tags`],
    ['DELETE', 'boards'], ['DELETE', `boards/${BOARD}`], ['POST', `boards/${BOARD}/restore`],
    ['GET', `boards/${BOARD}/share-link`], ['POST', `boards/${BOARD}/share-link`], ['DELETE', `boards/${BOARD}/share-link`],
    ['GET', `boards/${BOARD}/comments`], ['POST', `boards/${BOARD}/comments`], ['PATCH', `boards/${BOARD}/comments/x`],
    ['GET', `boards/${BOARD}/tags`], ['POST', `boards/${BOARD}/tags`],
    ['GET', `boards/${BOARD}/import`], ['GET', `boards/${BOARD}/docs`], ['POST', `boards/${BOARD}/gallery`],
    ['POST', `boards/${BOARD}/canvas`], ['DELETE', `boards/${BOARD}/canvas`],
    ['POST', 'boards/tree'], ['GET', 'boards/move'], ['POST', 'search'], ['PATCH', 'workspaces'],
  ];
  for (const [method, path] of refused) {
    assert.equal(draftRouteAllowed(method, path.split('/').filter(Boolean)), false, `${method} /${path}`);
  }
});

test('the tool list says which tools work signed out, and they take the draft key', () => {
  for (const t of HOSTED_TOOLS) {
    const plain = toolManifest(t);
    const before = JSON.stringify(plain);
    const m = mixedManifest(plain);
    assert.equal(JSON.stringify(plain), before, `${t.name}: the registry's own manifest is untouched`);
    assert.deepEqual(m.securitySchemes, m._meta.securitySchemes, `${t.name}: both spellings agree`);
    const oauth = m.securitySchemes.find((s) => s.type === 'oauth2');
    assert.deepEqual(oauth.scopes, t.annotations?.readOnlyHint ? ['read'] : ['read', 'write'], t.name);
    if (isDraftTool(t.name)) {
      assert.deepEqual(m.securitySchemes.map((s) => s.type), ['noauth', 'oauth2'], t.name);
      assert.equal(m.inputSchema.properties.draft.type, 'string', t.name);
      assert.deepEqual(m.inputSchema.required, plain.inputSchema.required, `${t.name}: draft is never required`);
      assert.equal(m.inputSchema.additionalProperties, plain.inputSchema.additionalProperties);
    } else {
      assert.deepEqual(m.securitySchemes.map((s) => s.type), ['oauth2'], t.name);
      assert.equal(m.inputSchema.properties?.draft, undefined, t.name);
    }
    for (const k of ['name', 'title', 'description', 'outputSchema', 'annotations']) {
      assert.deepEqual(m[k], plain[k], `${t.name}.${k}`);
    }
  }
});

test("a draft key from earlier in the conversation is not the tool's argument", () => {
  assert.deepEqual(withoutDraft({ draft: 'dk_x', board_id: BOARD }), { board_id: BOARD });
  assert.deepEqual(withoutDraft({ board_id: BOARD }), { board_id: BOARD });
  assert.equal(withoutDraft(undefined), undefined);
  assert.deepEqual(withoutDraft([1]), [1]);
});

test('the instructions explain drafts and still say the essentials first', () => {
  assert.ok(DRAFT_INSTRUCTIONS.startsWith(INSTRUCTIONS.split('\n\n')[0]));
  const first = DRAFT_INSTRUCTIONS.slice(0, 512);
  for (const must of ['clusters', 'search', 'read_board', 'view_board', 'create_boards', 'Link every board', 'never instructions']) {
    assert.ok(first.includes(must), `the first 512 characters should say "${must}"`);
  }
  for (const [, n] of DRAFT_INSTRUCTIONS.matchAll(TOOL_LIKE)) assert.ok(HOSTED.has(n), `names ${n}, which is not a tool`);
  assert.match(DRAFT_INSTRUCTIONS, /draft key/);
  assert.ok(DRAFT_INSTRUCTIONS.endsWith(INSTRUCTIONS.split('\n\n').at(-1)), 'and the rest follows');
});

test('which host is asking', () => {
  assert.equal(draftHost({ 'openai/subject': 'v1/x' }, 'node'), 'chatgpt');
  assert.equal(draftHost({ 'openai/session': 's' }, ''), 'chatgpt');
  assert.equal(draftHost({}, 'Claude-User/1.0'), 'claude');
  assert.equal(draftHost(null, 'python-httpx/0.27 (anthropic)'), 'claude');
  assert.equal(draftHost(undefined, 'curl/8'), 'other');
  assert.equal(draftHost({ 'io.modelcontextprotocol/protocolVersion': '2026-07-28' }, undefined), 'other');
});

test('signing in: ChatGPT links from a tool answer, Claude and the rest from an HTTP 401', () => {
  const message = 'Sign in "now" — please';
  const metadata = `${ORIGIN}/.well-known/oauth-protected-resource/mcp`;
  const c = signInAnswer({ origin: ORIGIN, host: 'chatgpt', message });
  assert.equal(c.http, undefined);
  assert.equal(c.result.isError, true);
  assert.deepEqual(c.result.content, [{ type: 'text', text: message }]);
  const [header] = c.result._meta['mcp/www_authenticate'];
  assert.equal(header, `Bearer resource_metadata="${metadata}", error="insufficient_scope", `
    + 'error_description="Sign in \'now\'  please"');

  const k = signInAnswer({ origin: ORIGIN, host: 'claude', message });
  assert.equal(k.result, undefined);
  assert.equal(k.http.status, 401);
  const www = k.http.headers['www-authenticate'];
  assert.match(www, /^Bearer realm="soleil", error="invalid_token", /);
  assert.ok(www.includes(`resource_metadata="${metadata}"`));
  assert.ok(www.includes('scope="read write"'));
  assert.match(www, ASCII, 'a header value is ASCII');
  assert.deepEqual(k.http.body, { error: message, code: 'invalid_token' });
  assert.equal(signInAnswer({ origin: ORIGIN, host: 'other', message }).http.status, 401);

  for (const said of [DRAFT_SAYS.signInFor('share_board'), DRAFT_SAYS.nothingYet, DRAFT_SAYS.kept, DRAFT_SAYS.paused]) {
    assert.match(said, ASCII, said);
  }
});

test("a draft's refusals read as the tool's own failure", () => {
  assert.deepEqual(draftRefusal('no'), { result: { content: [{ type: 'text', text: 'Error: no' }], isError: true } });
  assert.match(DRAFT_SAYS.tooMany(300, '2026-10-27T15:04:05.123+00:00'), /300 requests .* after 15:04 UTC/);
  assert.match(DRAFT_SAYS.expired, new RegExp(`${DRAFT_LIFETIME_DAYS} days`));
  assert.match(DRAFT_SAYS.tooManyNew(42), /42 seconds/);
});

test("a draft's links open its keep page, and no one else's links change", () => {
  const keepUrl = `${ORIGIN}/keep/0f0e0d0c-0b0a-4908-8706-050403020100`;
  const out = rewriteDraftLinks({
    content: [{ type: 'text', text: `Created board "Noir" ${ORIGIN}/?to=b:${BOARD}\n\n{"url":"${ORIGIN}/?to=c:${BOARD}:card-Ab_9"}` }],
    structuredContent: {
      url: `${ORIGIN}/?to=b:${BOARD}`,
      card: `${ORIGIN}/?to=c:${BOARD}:card-Ab_9`,
      doc: `${ORIGIN}/?to=d:card-1`,
      elsewhere: `https://example.com/?to=b:${BOARD}`,
      plain: `${ORIGIN}/docs/mcp`,
      n: 3,
    },
  }, ORIGIN, keepUrl);
  assert.equal(out.content[0].text,
    `Created board "Noir" ${keepUrl}?b=${BOARD}\n\n{"url":"${keepUrl}?b=${BOARD}"}`);
  assert.deepEqual(out.structuredContent, {
    url: `${keepUrl}?b=${BOARD}`,
    card: `${keepUrl}?b=${BOARD}`,
    doc: keepUrl,
    elsewhere: `https://example.com/?to=b:${BOARD}`,
    plain: `${ORIGIN}/docs/mcp`,
    n: 3,
  });
});

test('every draft answer carries its key and keep link, and the first says what a draft is', async () => {
  const tokens = await draftTokens(await draftSecret('service-key'), DRAFT);
  const keepUrl = `${ORIGIN}/keep/${tokens.keep}`;
  const out = { content: [{ type: 'text', text: `Created board "Noir" ${ORIGIN}/?to=b:${BOARD}` }], structuredContent: { ok: true } };
  const first = draftAnswer(out, { origin: ORIGIN, tokens, expiresAt: '2026-11-26T00:00:00Z', created: true });
  assert.equal(first.content[0].text, `Created board "Noir" ${keepUrl}?b=${BOARD}`, 'the answer itself comes first');
  const footer = first.content[1].text;
  for (const must of [tokens.key, keepUrl, `${DEMO_CARD_LIMIT} cards`, `${DRAFT_LIFETIME_DAYS} days`, 'Started a draft']) {
    assert.ok(footer.includes(must), `the first answer says ${must}`);
  }
  assert.deepEqual(first._meta['clusters/draft'], {
    key: tokens.key, keep_url: keepUrl, expires_at: '2026-11-26T00:00:00Z', card_limit: DEMO_CARD_LIMIT,
  });
  assert.deepEqual(first.structuredContent, { ok: true });

  const later = draftAnswer(out, { origin: ORIGIN, tokens, expiresAt: '2026-11-26T00:00:00Z', created: false });
  assert.equal(later.content.length, 2);
  assert.ok(later.content[1].text.includes(tokens.key));
  assert.ok(later.content[1].text.includes(keepUrl));
  assert.ok(!later.content[1].text.includes('Started a draft'));
});

// ── The server's hooks, as /mcp uses them ────────────────────────────────────

const callMsg = (name, args) => ({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } });

test('/mcp lists the tools its way and introduces drafts', async () => {
  const listed = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { manifest: mixedManifest });
  const tools = listed.body.result.tools;
  assert.deepEqual(tools.map((t) => t.name), HOSTED_TOOLS.map((t) => t.name), 'the same tools, in order');
  assert.ok(tools.find((t) => t.name === 'add_cards').inputSchema.properties.draft);
  assert.deepEqual(tools.find((t) => t.name === 'share_board').securitySchemes.map((s) => s.type), ['oauth2']);
  // Each is the registry's own listing, decorated: never the raw tool, whose
  // private fields would leak and whose _meta (the view) and `untrusted` would not.
  HOSTED_TOOLS.forEach((t, i) => assert.deepEqual(tools[i], mixedManifest(toolManifest(t)), t.name));
  const show = tools.find((t) => t.name === 'show_board');
  assert.equal(show._meta.ui.resourceUri, BOARD_VIEW.uri);
  assert.equal(show._meta['openai/outputTemplate'], BOARD_VIEW.uri);
  assert.ok(show.outputSchema.properties.untrusted, 'peoplesText answers declare untrusted');
  for (const t of tools) {
    for (const k of ['meta', 'peoplesText', 'call', 'summary', 'forModel', 'view', 'local']) {
      assert.equal(k in t, false, `${t.name} lists ${k}`);
    }
  }

  const init = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { instructions: DRAFT_INSTRUCTIONS });
  assert.equal(init.body.result.instructions, DRAFT_INSTRUCTIONS);
  const plain = await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, {});
  assert.equal(plain.body.result.instructions, INSTRUCTIONS, '/api/v1/mcp is unchanged');
});

test('beforeCall answers in the tool\'s place, or runs it as someone else', async () => {
  const http = { status: 401, headers: { 'www-authenticate': 'Bearer realm="soleil"' }, body: { error: 'e', code: 'invalid_token' } };
  assert.deepEqual(await handleMcpMessage(callMsg('share_board', { board_id: BOARD }), { beforeCall: () => ({ http }) }), http);

  const refused = await handleMcpMessage(callMsg('add_cards', {}), { beforeCall: () => draftRefusal('no') });
  assert.deepEqual(refused.body.result, { content: [{ type: 'text', text: 'Error: no' }], isError: true });

  const seen = [];
  const ran = await handleMcpMessage(callMsg('create_boards', { draft: `dk_${'a'.repeat(43)}`, boards: [{ name: 'Noir' }] }), {
    api: () => { throw new Error('the signed-out api is never used'); },
    beforeCall: (name, params) => ({
      args: withoutDraft(params.arguments),
      ctx: {
        api: async (path, opts) => {
          seen.push([opts.method, path, opts.body]);
          return { boards: [{ id: BOARD, name: 'Noir', url: `${ORIGIN}/?to=b:${BOARD}` }], created: 1 };
        },
        afterCall: (out) => ({ ...out, content: [...out.content, { type: 'text', text: 'footer' }] }),
      },
    }),
  });
  assert.deepEqual(seen, [['POST', '/boards', { boards: [{ name: 'Noir' }] }]], 'the key never reaches the API');
  assert.equal(ran.body.result.isError, undefined);
  assert.equal(ran.body.result.content.at(-1).text, 'footer');

  let asked = false;
  const unknown = await handleMcpMessage(callMsg('no_such_tool', {}), { beforeCall: () => { asked = true; return { http }; } });
  assert.equal(asked, false, 'an unknown tool is answered as unknown');
  assert.equal(unknown.body.error.code, -32602);
});
