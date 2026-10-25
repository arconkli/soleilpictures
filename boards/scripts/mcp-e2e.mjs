#!/usr/bin/env node
// A scripted live run of the hosted MCP server — the free half of "does it
// work for a real agent". No model is called: this drives the same JSON-RPC a
// host sends, in both protocol eras, through a realistic sequence (make a
// board, fill it, read it back, change it, lay it out, find it, delete and
// restore it), plus the failures an agent hits (a bad token, an unknown tool,
// a missing argument), and prints every call with its time and size. The size
// column is the point as much as the pass/fail one: it is what a tool result
// costs a model's context.
//
// Not in CI: it needs a real token and writes to a real workspace. Run it
// against the preview Worker before every promote, with a QA account's token:
//
//   CLUSTERS_TOKEN=sc_… node scripts/mcp-e2e.mjs --base=https://<preview-host>
//   … --workspace=<uuid>   pick the workspace (default: the token's first)
//   … --era=legacy|modern|both   (default both)
//   … --keep               leave the test board (deleted boards are restorable)
//
// Everything it makes is one board named "mcp-e2e <timestamp>", deleted at the
// end; nothing else in the workspace is touched.

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const BASE = String(args.base || process.env.CLUSTERS_BASE || 'https://clusters.soleilpictures.com').replace(/\/+$/, '');
const TOKEN = process.env.CLUSTERS_TOKEN || '';
const ERA = String(args.era || 'both');
const KEEP = !!args.keep;
const MODERN = '2026-07-28';
const LEGACY = '2025-11-25';
const URL_MCP = `${BASE}/api/v1/mcp`;

if (!TOKEN) {
  console.error('Set CLUSTERS_TOKEN to a QA account\'s token (Settings → API).');
  process.exit(2);
}

const rows = [];
const failures = [];
let nextId = 1;

function check(ok, what) {
  if (!ok) failures.push(what);
  return ok;
}

async function rpc(method, params = {}, { era = 'modern', token = TOKEN, label } = {}) {
  const id = nextId++;
  const body = { jsonrpc: '2.0', id, method, params: { ...params } };
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (era === 'modern' && method !== 'initialize') {
    body.params._meta = {
      'io.modelcontextprotocol/protocolVersion': MODERN,
      'io.modelcontextprotocol/clientCapabilities': {},
      ...(body.params._meta || {}),
    };
    headers['mcp-protocol-version'] = MODERN;
    headers['mcp-method'] = method;
    if (method === 'tools/call' || method === 'prompts/get') headers['mcp-name'] = params.name;
  }
  const t0 = performance.now();
  const res = await fetch(URL_MCP, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* an SSE frame or an HTML error page */ }
  rows.push({ era, what: label || (method === 'tools/call' ? params.name : method), status: res.status, ms, bytes: text.length,
    outcome: typeof json?.error === 'object' && json.error ? `rpc error ${json.error.code}`
      : json?.error ? `http error: ${json.error}`
        : json?.result?.isError ? 'tool error' : res.ok ? 'ok' : 'http error' });
  return { res, json, text };
}

// A tool result's data: structuredContent when the tool declares it, else the
// JSON in its first text block.
function data(json) {
  const r = json?.result;
  if (!r) return null;
  if (r.structuredContent) return r.structuredContent;
  const text = r.content?.find((c) => c.type === 'text')?.text;
  try { return JSON.parse(text); } catch { return text ?? null; }
}

const call = (name, a, opts) => rpc('tools/call', { name, arguments: a }, opts);

async function legacyHandshake() {
  const init = await rpc('initialize', {
    protocolVersion: LEGACY, capabilities: {}, clientInfo: { name: 'mcp-e2e', version: '1' },
  }, { era: 'legacy' });
  const info = init.json?.result?.serverInfo;
  check(init.json?.result?.protocolVersion === LEGACY, 'legacy initialize echoes 2025-11-25');
  check(info?.name === 'soleil-clusters' && /^\d+\.\d+\.\d+$/.test(info?.version || ''), 'serverInfo names itself with a version');
  const list = await rpc('tools/list', {}, { era: 'legacy' });
  const tools = list.json?.result?.tools || [];
  check(tools.length > 0, 'legacy tools/list returns tools');
  check(tools.every((t) => t.annotations && typeof t.annotations.readOnlyHint === 'boolean'), 'every tool carries its hints');
  await rpc('prompts/list', {}, { era: 'legacy' });
}

async function modernRun() {
  const disc = await rpc('server/discover', {});
  check(disc.json?.result?.supportedVersions?.includes(MODERN), 'server/discover lists 2026-07-28');
  const list = await rpc('tools/list', {});
  const names = new Set((list.json?.result?.tools || []).map((t) => t.name));
  check(names.has('create_boards') && names.has('read_board'), 'modern tools/list has the core tools');

  const me = data((await call('whoami', {})).json);
  check(!!me, 'whoami answers');
  const workspaceId = args.workspace || me?.workspaces?.[0]?.id;
  if (!check(!!workspaceId, 'whoami lists a workspace to work in')) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const marker = `e2e${Date.now().toString(36)}`;
  const created = data((await call('create_boards', {
    workspace_id: workspaceId, boards: [{ name: `mcp-e2e ${stamp}` }],
  })).json);
  const boardId = created?.boards?.[0]?.id;
  if (!check(!!boardId, 'create_boards returns the board')) return;
  check(/\?to=b:/.test(created?.boards?.[0]?.url || ''), 'and its link in the app');

  try {
    const added = data((await call('add_cards', {
      board_id: boardId,
      layout: 'grid',
      cards: [
        { kind: 'note', title: `Treatment ${marker}`, body: 'A night exterior, wet asphalt, sodium light.' },
        { kind: 'note', title: 'Palette', body: 'Teal shadows, amber practicals.' },
        { kind: 'link', url: 'https://en.wikipedia.org/wiki/Neo-noir', title: 'Neo-noir' },
      ],
    })).json);
    const cards = added?.cards || added?.created || [];
    check(cards.length === 3, `add_cards made 3 cards (got ${cards.length})`);

    const read = data((await call('read_board', { board_id: boardId })).json);
    const readCards = read?.cards || [];
    check(readCards.length === 3, `read_board sees 3 cards (got ${readCards.length})`);
    check(read?.board?.id === boardId && Array.isArray(read?.groups), 'read_board carries the board and its groups');

    await call('update_boards', { boards: [{ board_id: boardId, name: `mcp-e2e ${stamp} renamed` }] });
    const renamed = data((await call('read_board', { board_id: boardId, limit: 1 })).json);
    check(/renamed$/.test(renamed?.board?.name || ''), 'update_boards renamed it');

    const first = cards[0]?.id || readCards[0]?.id;
    if (first) {
      await call('update_cards', { board_id: boardId, cards: [{ id: first, title: `Treatment ${marker} v2` }] });
      const again = data((await call('read_board', { board_id: boardId })).json);
      check((again?.cards || []).some((c) => String(c.title || '').endsWith('v2')), 'update_cards landed');
    }

    const dry = data((await call('arrange_board', { board_id: boardId, layout: 'masonry', dry_run: true })).json);
    check(dry?.dry_run === true, 'arrange_board dry_run writes nothing and says so');
    await call('arrange_board', { board_id: boardId, layout: 'masonry' });

    const found = data((await call('search', { query: marker, workspace_id: workspaceId })).json);
    const hit = (found?.results || []).find((r) => r.kind === 'card');
    check(!!hit && JSON.stringify(found).includes(marker), 'search finds the new card by its words');
    if (hit) {
      const fetched = data((await call('fetch', { id: hit.id })).json);
      check(String(fetched?.text || '').includes(marker), 'fetch reads the card search found');
    }

    if (first) {
      await call('delete_cards', { board_id: boardId, card_ids: [first] });
      const after = data((await call('read_board', { board_id: boardId })).json);
      check((after?.cards || []).length === 2, 'delete_cards removed one card');
    }

    // The failures an agent actually hits.
    const unknown = await call('no_such_tool', {});
    check(unknown.json?.error?.code === -32602 && Array.isArray(unknown.json?.error?.data?.available),
      'an unknown tool answers -32602 with the tools that exist');
    const old = await call('get_board', { board_id: boardId });
    check(old.json?.error?.data?.renamed_to === 'read_board', 'a tool from before 3.0 names the one that does it now');
    const missing = await call('read_board', {});
    check(!!(missing.json?.error || missing.json?.result?.isError), 'a missing required argument is refused');
  } finally {
    await call('delete_board', { board_id: boardId });
    const trash = data((await call('list_boards', { deleted: true, workspace_id: workspaceId })).json);
    check(JSON.stringify(trash || '').includes(boardId), 'the deleted board is in the bin');
    if (KEEP) {
      await call('restore_board', { board_id: boardId });
    }
  }
}

async function badToken() {
  const r = await rpc('tools/list', {}, { era: 'legacy', token: 'sc_not_a_real_token', label: 'bad token' });
  check(r.res.status === 401, `a bad token is 401 (got ${r.res.status})`);
  check(/Bearer/i.test(r.res.headers.get('www-authenticate') || ''), 'the 401 says how to authenticate');
}

const t0 = Date.now();
try {
  if (ERA === 'legacy' || ERA === 'both') await legacyHandshake();
  if (ERA === 'modern' || ERA === 'both') await modernRun();
  await badToken();
} catch (e) {
  failures.push(`threw: ${e?.message || e}`);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${URL_MCP}\n`);
console.log(`${pad('era', 7)}${pad('call', 22)}${pad('status', 8)}${pad('ms', 7)}${pad('bytes', 9)}outcome`);
for (const r of rows) {
  console.log(`${pad(r.era, 7)}${pad(r.what, 22)}${pad(r.status, 8)}${pad(r.ms, 7)}${pad(r.bytes, 9)}${r.outcome}`);
}
const bytes = rows.reduce((a, r) => a + r.bytes, 0);
console.log(`\n${rows.length} calls · ${bytes} bytes · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failures.length) {
  console.log(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nall checks passed');
