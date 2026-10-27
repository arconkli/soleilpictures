// Docs written through /api/v1 and MCP, end to end: the real handleApiRoute
// against a fake PostgREST and a room that answers like y-partyserver (the one
// clustersRoute.test.mjs drives). What they pin: a doc written here is in the
// room, whole, and reads back as written; a rewrite names the page as it was
// read; nothing is written when the room isn't there; a page sent back as it
// was is left alone; and search's page index hears about every write.
//
// Run: node --test src/lib/docWriteRoute.test.mjs

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { handleApiRoute } from '../worker-api.js';
import { cardToYMap, readCards } from './yhelpers.js';
import { cardScope, initCardDocStore, setDocMode, readPages } from './docState.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  PARTY_HOST: 'party.test',
};
const B1 = '11111111-1111-4111-8111-111111111111';

// board id -> { doc, down }: each room is the whole truth (board_state reads
// come back empty). `writes` records every REST write that leaves the Worker.
let rooms;
let writes;
const realFetch = globalThis.fetch;
const RealWS = globalThis.WebSocket;

function room(id, { cards = [], down = false } = {}) {
  const doc = new Y.Doc();
  doc.transact(() => {
    const m = doc.getMap('cards');
    for (const c of cards) m.set(c.id, cardToYMap(c));
  });
  rooms.set(id, { doc, down });
  return doc;
}

const reply = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

class FakeRoomSocket {
  constructor(url) {
    this.l = {};
    this.room = rooms.get(decodeURIComponent(/\/parties\/main\/([^?]+)/.exec(url)[1]));
    setTimeout(() => {
      if (!this.room || this.room.down) { this.emit('error'); return; }
      this.open = true;
      this.emit('open');
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeSyncStep1(enc, this.room.doc);
      this.deliver(encoding.toUint8Array(enc));
    }, 0);
  }
  emit(type, evt = {}) { for (const f of [...(this.l[type] || [])]) f(evt); }
  deliver(b) {
    setTimeout(() => { if (this.open) this.emit('message', { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }); }, 0);
  }
  addEventListener(type, fn) { (this.l[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.l[type] = (this.l[type] || []).filter((f) => f !== fn); }
  send(data) {
    const bytes = new Uint8Array(data);
    setTimeout(() => {
      if (!this.open) return;
      const dec = decoding.createDecoder(bytes);
      if (decoding.readVarUint(dec) !== 0) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      const step = decoding.readVarUint(dec);
      if (step === 0) syncProtocol.readSyncStep1(dec, enc, this.room.doc);
      else if (step === 1) syncProtocol.readSyncStep2(dec, this.room.doc, 'peer');
      else if (step === 2) syncProtocol.readUpdate(dec, this.room.doc, 'peer');
      if (encoding.length(enc) > 1) this.deliver(encoding.toUint8Array(enc));
    }, 0);
  }
  close() { if (!this.open) return; this.open = false; setTimeout(() => this.emit('close'), 0); }
}

beforeEach(() => {
  rooms = new Map();
  writes = [];
  globalThis.WebSocket = FakeRoomSocket;
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    if (path === 'rpc/api_token_resolve') {
      return reply([{ user_id: 'u1', token_id: 't1', scopes: ['read', 'write', 'delete'], req_limit: 1000, req_count: 1 }]);
    }
    if (path === 'rpc/api_session_begin') return reply([{ access_token: 'user-jwt' }]);
    if (path === 'rpc/can_write_board') return reply(rooms.has(body.p_board_id));
    if (path === 'boards' && method === 'GET') {
      return reply([...rooms.keys()].map((id) => ({
        id, name: 'Tokyo noir', workspace_id: 'w1', parent_board_id: null, view: 'canvas',
        created_at: '2026-10-01T00:00:00Z', updated_at: null, deleted_at: null,
      })));
    }
    if (method !== 'GET' && !path.startsWith('rpc/api_log')) writes.push({ method, path, query: u.searchParams, body });
    if (path.startsWith('rpc/')) return reply(null);
    return method === 'GET' ? reply([]) : reply(undefined, 201);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = RealWS;
});

async function api(method, path, body, headers = {}) {
  const url = new URL(`https://clusters.test/api/v1${path}`);
  const req = new Request(url, {
    method,
    headers: {
      authorization: 'Bearer sk_live_test',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await handleApiRoute(url, req, ENV, null);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const tool = async (name, args) => {
  const r = await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return r.body.result;
};

const wrote = (path, method = 'POST') => writes.filter((w) => w.path === path && w.method === method);
const docCard = (id) => readCards(rooms.get(B1).doc).find((c) => String(c.id) === id);
const pagesIn = (id) => {
  const doc = rooms.get(B1).doc;
  return readPages(doc, cardScope(doc.getMap('cards').get(id)));
};

const TREATMENT = {
  title: 'Tokyo noir',
  pages: [
    { title: 'Logline', markdown: 'A **night-shift** detective follows a dead phone through Shinjuku.' },
    { markdown: '# Places\n\n- Shinjuku\n- [Golden Gai](https://example.com/gg)\n- [ ] Scout the rooftops' },
  ],
};

async function made() {
  room(B1, { cards: [{ id: 'n1', kind: 'note', html: '<p>hi</p>', x: 0, y: 0, w: 100, h: 100 }] });
  const r = await api('POST', `/boards/${B1}/docs`, TREATMENT);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

test('POST /docs: a doc card whose pages are in the room, whole, reading back as written', async () => {
  const out = await made();
  assert.equal(out.card.kind, 'doc');
  assert.equal(out.card.title, 'Tokyo noir');
  assert.equal(out.live, true);
  assert.match(out.url, new RegExp(`\\?to=c:${B1}:${out.card.id}$`));
  assert.deepEqual(out.pages.map((p) => p.title), ['Logline', 'Places'], 'a page with no title takes its heading\'s words');
  assert.ok(out.pages.every((p) => p.hash && !('text' in p)), 'a hash per page; the indexed text stays on the server');
  assert.equal(docCard(out.card.id).w, 320, 'the app\'s size for a new doc');
  assert.deepEqual(pagesIn(out.card.id).map((p) => p.id), out.pages.map((p) => p.id));

  const read = await api('GET', `/boards/${B1}/cards/${out.card.id}/doc`);
  assert.equal(read.status, 200);
  assert.equal(read.body.pages[0].markdown, 'A **night-shift** detective follows a dead phone through Shinjuku.\n');
  assert.match(read.body.pages[1].markdown, /- \[Golden Gai\]\(https:\/\/example\.com\/gg\)/);
  assert.deepEqual(read.body.pages.map((p) => p.hash), out.pages.map((p) => p.hash));

  const one = await api('GET', `/boards/${B1}/cards/${out.card.id}/doc?page=${out.pages[0].id}`);
  assert.equal(one.headers.get('etag'), `"${out.pages[0].hash}"`);

  assert.equal(wrote('card_index').length, 1, 'the card counts against the cap like any other');
  const [index] = wrote('doc_page_index');
  assert.equal(index.query.get('on_conflict'), 'doc_card_id,page_id');
  assert.deepEqual(index.body.map((r) => [r.doc_card_id, r.page_id, r.workspace_id]),
    out.pages.map((p) => [out.card.id, p.id, 'w1']));
  assert.match(index.body[0].page_text, /night-shift detective/);
});

test('POST /docs: a card title from its one page, and the first page from the card', async () => {
  room(B1);
  const one = await api('POST', `/boards/${B1}/docs`, { pages: [{ title: 'Shot list', markdown: '1. Wide' }] });
  assert.equal(one.body.card.title, 'Shot list');
  const named = await api('POST', `/boards/${B1}/docs`, { title: 'Notes', pages: [{ markdown: 'No heading here.' }] });
  assert.equal(named.body.pages[0].title, 'Notes', 'an untitled first page follows the card, as in the app');
  const bad = await api('POST', `/boards/${B1}/docs`, { pages: [] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'bad_request');
  const big = await api('POST', `/boards/${B1}/docs`, { pages: [{ markdown: 'x'.repeat(200_001) }] });
  assert.equal(big.status, 413);
  assert.equal((await api('GET', `/boards/${B1}/docs`)).status, 405);
});

test('pages added after the ones a doc has, or under one of them', async () => {
  const out = await made();
  const base = `/boards/${B1}/cards/${out.card.id}/doc/pages`;
  const add = await api('POST', base, { pages: [{ title: 'Cast', markdown: 'Kenji, a detective.' }] });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const sub = await api('POST', base, { parent_page_id: add.body.pages[0].id, pages: [{ title: 'Kenji', markdown: 'Tired.' }] });
  assert.equal(sub.body.pages[0].parent_id, add.body.pages[0].id);
  assert.deepEqual(pagesIn(out.card.id).map((p) => p.name), ['Logline', 'Places', 'Cast', 'Kenji']);

  const before = Y.encodeStateVector(rooms.get(B1).doc);
  const lost = await api('POST', base, { parent_page_id: 'p_nope', pages: [{ markdown: 'x' }] });
  assert.equal(lost.status, 404);
  assert.deepEqual(Y.encodeStateVector(rooms.get(B1).doc), before, 'nothing reached the room');
  assert.equal(wrote('board_versions').length, 0, 'adding takes nothing away, so no checkpoint');
});

test('a whole-page rewrite names the page as it was read, and keeps what it didn\'t change', async () => {
  const out = await made();
  const [logline, places] = out.pages;
  const path = `/boards/${B1}/cards/${out.card.id}/doc/pages/${places.id}`;
  const next = '# Places\n\n- Shinjuku at 4am\n- [Golden Gai](https://example.com/gg)\n- [x] Scout the rooftops\n';

  const blind = await api('PATCH', path, { markdown: next });
  assert.equal(blind.status, 400);
  assert.match(blind.body.error, /page_hash/);

  const stale = await api('PATCH', path, { markdown: next, page_hash: logline.hash });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'page_changed');

  const ok = await api('PATCH', path, { markdown: next, page_hash: places.hash });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.changed, true);
  assert.deepEqual(ok.body.blocks, { kept: 1, removed: 1, added: 1 }, 'the heading stays; the list is rewritten');
  assert.notEqual(ok.body.page.hash, places.hash);
  const read = await api('GET', `/boards/${B1}/cards/${out.card.id}/doc?page=${places.id}`);
  assert.equal(read.body.pages[0].markdown, next);
  assert.equal(read.body.pages[0].hash, ok.body.page.hash);
  const [version] = wrote('board_versions');
  assert.deepEqual(version.body[0].op_summary, { action: 'api-edit-doc-page', card_id: out.card.id, page_id: places.id });

  // The same page sent back as it is: nothing written, no checkpoint.
  const before = Y.encodeStateVector(rooms.get(B1).doc);
  const again = await api('PATCH', path, { markdown: next }, { 'if-match': `"${ok.body.page.hash}"` });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.changed, false);
  assert.equal(again.body.page.hash, ok.body.page.hash);
  assert.deepEqual(Y.encodeStateVector(rooms.get(B1).doc), before);
  assert.equal(wrote('board_versions').length, 1);
});

test('edits change exact text; a title alone renames; a miss changes nothing', async () => {
  const out = await made();
  const page = out.pages[0];
  const path = `/boards/${B1}/cards/${out.card.id}/doc/pages/${page.id}`;
  const edit = await api('PATCH', path, { edits: [{ old_text: 'dead phone', new_text: 'ringing phone' }] });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const read = await api('GET', `/boards/${B1}/cards/${out.card.id}/doc?page=${page.id}`);
  assert.match(read.body.pages[0].markdown, /follows a ringing phone/);

  const miss = await api('PATCH', path, { edits: [{ old_text: 'dead phone', new_text: 'x' }] });
  assert.equal(miss.status, 400);
  assert.match(miss.body.error, /not on the page/);
  assert.equal((await api('PATCH', path, { markdown: 'x', edits: [] })).status, 400);
  assert.equal((await api('PATCH', path, {})).status, 400);

  const renamed = await api('PATCH', path, { title: 'The line' });
  assert.equal(renamed.body.page.title, 'The line');
  assert.deepEqual(renamed.body.blocks, { kept: 1, removed: 0, added: 0 });
  assert.equal(pagesIn(out.card.id)[0].name, 'The line');
});

test('nothing is written when the room isn\'t there', async () => {
  room(B1, { down: true });
  const r = await api('POST', `/boards/${B1}/docs`, TREATMENT);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'room_unavailable');
  assert.deepEqual(writes, [], 'no index row, no board_state, no page index');
  const p = await api('PATCH', `/boards/${B1}/cards/d1/doc/pages/p1`, { title: 'x' });
  assert.equal(p.status, 503);
});

test('prose docs only, and only the doc\'s own routes', async () => {
  const doc = room(B1, { cards: [{ id: 'n1', kind: 'note', html: '<p>hi</p>', x: 0, y: 0, w: 100, h: 100 }] });
  const script = new Y.Map();
  doc.transact(() => {
    doc.getMap('cards').set('s1', script);
    script.set('id', 's1');
    script.set('kind', 'doc');
    initCardDocStore(doc, script);
    setDocMode(doc, cardScope(script), 'screenplay');
  });
  const add = (id) => api('POST', `/boards/${B1}/cards/${id}/doc/pages`, { pages: [{ markdown: 'x' }] });
  const note = await add('n1');
  assert.equal(note.status, 400);
  assert.match(note.body.error, /a note, not a doc/);
  assert.match((await add('s1')).body.error, /screenplay/);
  assert.equal((await add('nope')).status, 404);
  assert.equal((await api('GET', `/boards/${B1}/cards/s1/doc/pages`)).status, 405);
  assert.equal((await api('POST', `/boards/${B1}/cards/s1/doc`, {})).status, 405);
  assert.equal((await api('PATCH', `/boards/${B1}/cards/s1/doc/other`, {})).status, 404);
  assert.equal((await api('PATCH', `/boards/${B1}/cards/s1/doc/pages/p1/more`, {})).status, 404);
});

test('write_doc, fetch and edit_doc_page over MCP', async () => {
  room(B1);
  const w = await tool('write_doc', { board_id: B1, ...TREATMENT });
  assert.notEqual(w.isError, true, JSON.stringify(w));
  const { card_id: cardId, pages, created } = w.structuredContent;
  assert.equal(created, true);
  assert.equal(pages.length, 2);

  const f = await tool('fetch', { id: `doc:${B1}:${cardId}:${pages[0].id}` });
  assert.equal(f.structuredContent.metadata.pages[0].hash, pages[0].hash);

  const e = await tool('edit_doc_page', {
    board_id: B1, card_id: cardId, page_id: pages[0].id,
    markdown: 'A detective follows a dead phone.', page_hash: pages[0].hash,
  });
  assert.notEqual(e.isError, true, JSON.stringify(e));
  assert.equal(e.structuredContent.changed, true);

  const more = await tool('write_doc', { board_id: B1, card_id: cardId, pages: [{ title: 'Cast', markdown: 'Kenji' }] });
  assert.equal(more.structuredContent.created, false);
  assert.equal(pagesIn(cardId).length, 3);

  const wrong = await tool('write_doc', { board_id: B1, card_id: cardId, title: 'x', pages: [{ markdown: 'y' }] });
  assert.equal(wrong.isError, true);
  assert.match(wrong.content[0].text, /update_cards renames/);
});
