// Comments through /api/v1 and MCP, end to end: the real handleApiRoute
// against a fake PostgREST holding a comments table that refuses what its
// policies refuse, and a room holding the board's cards, a doc and its
// threads. What they pin: one list holds the board's threads and the ones
// inside its docs, named as the app names people; a comment lands where the
// app would put it, a reply in its thread; resolving and deleting are only
// for those the app lets do them, and a deleted comment comes back. Inside a
// doc, an editor's reply, resolve and new thread on its words reach the room
// filed as the app files them, and nothing is written when the room is away.
//
// Run: node --test src/lib/commentsRoute.test.mjs

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { handleApiRoute } from '../worker-api.js';
import { cardToYMap } from './yhelpers.js';
import {
  cardScope, initCardDocStore, addPage, pageContentMap, addCommentThread, addCommentReply, readComments,
} from './docState.js';
import { pickCommentOffset } from './commentPlacement.js';
import { pickPresenceColor } from './presenceColor.js';
import { collectQuotes } from './apiComments.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  PARTY_HOST: 'party.test',
};
const B1 = '11111111-1111-4111-8111-111111111111';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';   // the token's person
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NO_DELETE = createHash('sha256').update('sk_live_nodelete').digest('hex');

let rooms;
let table;      // the comments table
let writers;    // boards U1 may write
let rpcs;
const realFetch = globalThis.fetch;
const RealWS = globalThis.WebSocket;

const reply = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
const refused = () => reply({ code: '42501', message: 'new row violates row-level security policy for table "comments"' }, 403);

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

// The board: an image, a card beside it, a group of the two, a note, and a
// doc whose first page has a thread on "at night".
let docThread;
let docPage;
function seedBoard({ down = false } = {}) {
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  doc.transact(() => {
    cards.set('c1', cardToYMap({ id: 'c1', kind: 'image', title: 'Hero still', x: 0, y: 0, w: 200, h: 200, groupId: 'g1' }));
    cards.set('c2', cardToYMap({ id: 'c2', kind: 'note', title: '', x: 212, y: 0, w: 300, h: 300, groupId: 'g1' }));
    cards.set('d1', cardToYMap({ id: 'd1', kind: 'doc', title: 'Treatment', x: 0, y: 400, w: 320, h: 240 }));
    doc.getMap('groups').set('g1', { id: 'g1', name: 'Diner' });
  });
  const d1 = cards.get('d1');
  initCardDocStore(doc, d1);
  const scope = cardScope(d1);
  const p1 = addPage(doc, { name: 'Opening', scope });
  docPage = p1;
  docThread = addCommentThread(doc, { pageId: p1, body: 'Too slow?', author: 'Sam', authorId: U2, scope });
  doc.transact(() => {
    const para = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    para.insert(0, [text]);
    pageContentMap(doc, scope).get(p1).insert(0, [para]);
    text.insert(0, 'A diner ');
    text.insert(8, 'at night', { 'comment--Ab12Cd34': { id: docThread } });
  });
  rooms.set(B1, { doc, down });
}

const row = (fields) => {
  const r = {
    id: randomUUID(), workspace_id: 'w1', board_id: B1, anchor_kind: 'board', anchor_id: null,
    anchor_x: null, anchor_y: null, doc_page_id: null, doc_from: null, doc_to: null, offset_x: 0, offset_y: 0,
    author: U1, body: '', reply_to: null, hidden: false, resolved: false,
    created_at: new Date().toISOString(), deleted_at: null, ...fields,
  };
  table.push(r);
  return r;
};

// PostgREST's filters as these routes use them.
function matches(r, q) {
  for (const [k, v] of q) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const want = v.replace(/^(eq|is)\./, '');
    const have = r[k];
    if (v.startsWith('in.(')) {
      if (!v.slice(4, -1).split(',').includes(String(have))) return false;
    } else if (v.startsWith('is.')) {
      if (want === 'null' ? have != null : String(!!have) !== want) return false;
    } else if (String(have) !== want) return false;
  }
  return true;
}

beforeEach(() => {
  rooms = new Map();
  table = [];
  writers = new Set([B1]);
  rpcs = [];
  globalThis.WebSocket = FakeRoomSocket;
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    if (path === 'rpc/api_token_resolve') {
      // A token that may write but not delete, for the scope check.
      const scopes = body?.p_token_hash === NO_DELETE ? ['read', 'write'] : ['read', 'write', 'delete'];
      return reply([{ user_id: U1, token_id: 't1', scopes, req_limit: 1000, req_count: 1 }]);
    }
    if (path === 'rpc/api_session_begin') return reply([{ access_token: 'user-jwt' }]);
    if (path === 'rpc/can_write_board') return reply(writers.has(body.p_board_id));
    if (path === 'boards' && method === 'GET') {
      return reply([...rooms.keys()].filter((id) => u.searchParams.get('id') === `eq.${id}`).map((id) => ({
        id, name: 'Tokyo noir', workspace_id: 'w1', parent_board_id: null, view: 'canvas',
        created_at: '2026-10-01T00:00:00Z', updated_at: null, deleted_at: null,
      })));
    }
    if (path === 'member_profiles') return reply([{ user_id: U1, display_name: 'Ana Ruiz' }]);
    if (path === 'rpc/users_by_ids') {
      const emails = { [U1]: 'ana.r@x.com', [U2]: 'sam.park@x.com' };
      return reply(body.p_user_ids.filter((u) => emails[u]).map((u) => ({ user_id: u, email: emails[u] })));
    }
    if (path === 'comments') {
      if (method === 'GET') return reply(table.filter((r) => matches(r, u.searchParams)));
      if (method === 'POST') {
        // The insert policy: your own comment, on a board you can read.
        if (body.some((r) => r.author !== U1 || !rooms.has(r.board_id))) return refused();
        return reply(body.map((r) => row(r)), 201);
      }
      if (method === 'PATCH') {
        // The update policy: its author, or an editor of the board.
        const hit = table.filter((r) => matches(r, u.searchParams) && (r.author === U1 || writers.has(r.board_id)));
        for (const r of hit) Object.assign(r, body);
        return reply(hit);
      }
    }
    if (path === 'rpc/soft_delete_comment' || path === 'rpc/restore_comment') {
      rpcs.push({ path, id: body.p_comment_id });
      const r = table.find((x) => x.id === body.p_comment_id);
      if (r && !(r.author === U1 || writers.has(r.board_id))) {
        return reply({ code: '42501', message: `not authorized to change comment ${r.id}` }, 403);
      }
      if (r) r.deleted_at = path === 'rpc/soft_delete_comment' ? new Date().toISOString() : null;
      return reply(undefined, 204);
    }
    if (path.startsWith('rpc/')) return reply(null);
    return method === 'GET' ? reply([]) : reply(undefined, 201);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = RealWS;
});

async function api(method, path, body, { token = 'sk_live_test' } = {}) {
  const url = new URL(`https://clusters.test/api/v1${path}`);
  const req = new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await handleApiRoute(url, req, ENV, null);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const tool = async (name, args) => {
  const r = await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return r.body.result;
};

function seedThreads() {
  const t1 = row({ anchor_kind: 'card', anchor_id: 'c1', author: U2, body: 'Too dark', created_at: '2026-10-20T10:00:00Z' });
  const r1 = row({ anchor_kind: 'card', anchor_id: 'c1', author: U1, body: 'Agreed', reply_to: t1.id, created_at: '2026-10-21T10:00:00Z' });
  const t2 = row({ anchor_kind: 'point', anchor_x: 900, anchor_y: 40, author: U1, body: 'Titles here', resolved: true, created_at: '2026-10-22T10:00:00Z' });
  return { t1, r1, t2 };
}

test('GET /comments: the board\'s threads and the ones inside its docs, one list, named', async () => {
  seedBoard();
  const { t1, r1, t2 } = seedThreads();
  const r = await api('GET', `/boards/${B1}/comments`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.counts, { open: 2, resolved: 1 });
  const [a, b] = r.body.threads;
  assert.equal(a.id, docThread, 'the doc\'s thread is the liveliest (it was just written)');
  assert.deepEqual([a.on, a.card_id, a.card_kind, a.card_title, a.page_title, a.quote], ['doc', 'd1', 'doc', 'Treatment', 'Opening', 'at night']);
  assert.equal(a.author_name, 'Sam Park', 'a name made from the email, as the app makes it');
  assert.equal(b.id, t1.id);
  assert.deepEqual([b.on, b.card_title, b.author_name, b.by_you], ['card', 'Hero still', 'Sam Park', false]);
  assert.deepEqual(b.replies.map((x) => [x.id, x.author_name, x.by_you]), [[r1.id, 'Ana Ruiz', true]]);
  assert.match(b.url, new RegExp(`\\?to=c:${B1}:c1$`));
  assert.ok(!r.body.threads.some((t) => t.id === t2.id), 'resolved threads only when asked for');

  const all = await api('GET', `/boards/${B1}/comments?status=all&limit=2`);
  assert.deepEqual(all.body.threads.map((t) => t.id), [docThread, t2.id]);
  const spot = all.body.threads[1];
  assert.deepEqual([spot.on, spot.x, spot.y, spot.resolved], ['point', 900, 40, true]);
  assert.equal(all.body.has_more, true);
  const rest = await api('GET', `/boards/${B1}/comments?status=all&limit=2&cursor=${all.body.next_cursor}`);
  assert.deepEqual(rest.body.threads.map((t) => t.id), [t1.id]);
  assert.equal(rest.body.has_more, false);

  assert.equal((await api('GET', `/boards/${B1}/comments?status=mine`)).status, 400);
  assert.equal((await api('GET', `/boards/${B1}/comments?cursor=zz`)).status, 400);
  assert.equal((await api('GET', `/boards/22222222-2222-4222-8222-222222222222/comments`)).status, 404);
});

test('GET /comments: with the room away, the board\'s own threads, and a note saying so', async () => {
  seedBoard({ down: true });
  seedThreads();
  const r = await api('GET', `/boards/${B1}/comments`);
  assert.equal(r.status, 200);
  assert.equal(r.body.threads.length, 1);
  assert.match(r.body.note, /inside docs and notes could not be read/);
});

test('POST /comments: on a card, a group, a spot, the board — placed as the app places them', async () => {
  seedBoard();
  const onCard = await api('POST', `/boards/${B1}/comments`, { body: '  Warmer grade?  ', card_id: 'c1' });
  assert.equal(onCard.status, 201, JSON.stringify(onCard.body));
  const saved = table.at(-1);
  const want = pickCommentOffset({ target: { x: 0, y: 0, w: 200, h: 200 },
    others: [{ x: 212, y: 0, w: 300, h: 300 }, { x: 0, y: 400, w: 320, h: 240 }], placed: [] });
  assert.deepEqual(
    [saved.workspace_id, saved.author, saved.body, saved.anchor_kind, saved.anchor_id, saved.offset_x, saved.offset_y],
    ['w1', U1, 'Warmer grade?', 'card', 'c1', want.offsetX, want.offsetY]);
  assert.deepEqual([onCard.body.comment.on, onCard.body.comment.by_you, onCard.body.comment.author_name, onCard.body.comment.replies],
    ['card', true, 'Ana Ruiz', []]);
  assert.match(onCard.body.url, new RegExp(`\\?to=c:${B1}:c1$`));

  assert.equal((await api('POST', `/boards/${B1}/comments`, { body: 'x', group_id: 'g1' })).status, 201);
  assert.deepEqual([table.at(-1).anchor_kind, table.at(-1).anchor_id], ['group', 'g1']);
  assert.equal((await api('POST', `/boards/${B1}/comments`, { body: 'x', x: 10.2, y: 20.7 })).status, 201);
  assert.deepEqual([table.at(-1).anchor_kind, table.at(-1).anchor_x, table.at(-1).anchor_y], ['point', 10, 21]);
  const whole = await api('POST', `/boards/${B1}/comments`, { body: 'Missing: night exteriors' });
  assert.equal(whole.status, 201);
  assert.equal(whole.body.comment.on, 'board');
  assert.match(whole.body.url, new RegExp(`\\?to=b:${B1}$`));
  assert.deepEqual([100 + table.at(-1).offset_x, 100 + table.at(-1).offset_y], [512 + 48, 0], 'beside everything on the board');

  const before = table.length;
  for (const [b, code, status] of [
    [{ body: 'x', card_id: 'nope' }, 'not_found', 404],
    [{ body: 'x', group_id: 'nope' }, 'not_found', 404],
    [{ body: '' }, 'bad_request', 400],
    [{ body: 'x', card_id: 'c1', x: 1, y: 1 }, 'bad_request', 400],
    [{ body: 'x'.repeat(4001) }, 'bad_request', 400],
  ]) {
    const r = await api('POST', `/boards/${B1}/comments`, b);
    assert.deepEqual([r.status, r.body.code], [status, code], JSON.stringify(b));
  }
  assert.equal(table.length, before, 'nothing written for any of them');
});

test('POST /comments with the room away: nothing placed blind; a spot needs no room', async () => {
  seedBoard({ down: true });
  const r = await api('POST', `/boards/${B1}/comments`, { body: 'x', card_id: 'c1' });
  assert.deepEqual([r.status, r.body.code], [503, 'room_unavailable']);
  assert.equal(table.length, 0);
  assert.equal((await api('POST', `/boards/${B1}/comments`, { body: 'x', x: 1, y: 2 })).status, 201);
});

test('POST /comments with reply_to: into the thread, under its first comment, where it is', async () => {
  seedBoard();
  const { t1, r1 } = seedThreads();
  const r = await api('POST', `/boards/${B1}/comments`, { body: 'On it', reply_to: r1.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const saved = table.at(-1);
  assert.deepEqual([saved.reply_to, saved.anchor_kind, saved.anchor_id], [t1.id, 'card', 'c1'],
    'a reply to a reply goes into the thread');
  assert.deepEqual(Object.keys(r.body.comment).sort(),
    ['author_id', 'author_name', 'body', 'by_you', 'created_at', 'id', 'reply_to', 'url']);
  assert.equal(r.body.comment.reply_to, t1.id);

  assert.equal((await api('POST', `/boards/${B1}/comments`, { body: 'x', reply_to: randomUUID() })).status, 404);
  assert.equal((await api('POST', `/boards/${B1}/comments`, { body: 'x', reply_to: 'cm_nope' })).status, 404);
  assert.equal((await api('POST', `/boards/${B1}/comments`, { body: 'x', reply_to: r1.id, card_id: 'c1' })).status, 400);
});

test('PATCH /comments/:id: resolved by its author or an editor, threads only', async () => {
  seedBoard();
  const { t1, r1, t2 } = seedThreads();
  const ok = await api('PATCH', `/boards/${B1}/comments/${t1.id}`, { resolved: true });
  assert.deepEqual([ok.status, ok.body.resolved, table.find((x) => x.id === t1.id).resolved], [200, true, true],
    'an editor resolves someone else\'s thread');
  assert.equal((await api('PATCH', `/boards/${B1}/comments/${t2.id}`, { resolved: false })).body.resolved, false);

  const replyOne = await api('PATCH', `/boards/${B1}/comments/${r1.id}`, { resolved: true });
  assert.equal(replyOne.status, 400);
  assert.match(replyOne.body.error, new RegExp(t1.id));
  assert.equal((await api('PATCH', `/boards/${B1}/comments/${t1.id}`, { resolved: 'yes' })).status, 400);
  assert.equal((await api('PATCH', `/boards/${B1}/comments/${t1.id}`, { resolved: true, body: 'x' })).status, 400);
  assert.equal((await api('PATCH', `/boards/${B1}/comments/${randomUUID()}`, { resolved: true })).status, 404);
  assert.equal((await api('PATCH', `/boards/${B1}/comments/cm_nope`, { resolved: true })).status, 404);

  writers.clear();
  table.find((x) => x.id === t1.id).resolved = false;
  const no = await api('PATCH', `/boards/${B1}/comments/${t1.id}`, { resolved: true });
  assert.deepEqual([no.status, no.body.code], [403, 'forbidden'], 'not its author and not an editor');
  assert.equal(table.find((x) => x.id === t1.id).resolved, false);
});

test('DELETE /comments/:id: your own, and it comes back', async () => {
  seedBoard();
  const { t1, r1 } = seedThreads();
  const theirs = await api('DELETE', `/boards/${B1}/comments/${t1.id}`);
  assert.deepEqual([theirs.status, theirs.body.code], [403, 'forbidden'], 'an editor resolves it instead');
  assert.equal(rpcs.length, 0);

  const mine = await api('DELETE', `/boards/${B1}/comments/${r1.id}`);
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.restore, `POST /api/v1/boards/${B1}/comments/${r1.id}/restore`);
  assert.deepEqual(rpcs.map((x) => x.path), ['rpc/soft_delete_comment']);
  const after = await api('GET', `/boards/${B1}/comments`);
  assert.deepEqual(after.body.threads.find((t) => t.id === t1.id).replies, []);

  const back = await api('POST', `/boards/${B1}/comments/${r1.id}/restore`);
  assert.deepEqual([back.status, back.body.restored], [200, true]);
  const again = await api('GET', `/boards/${B1}/comments`);
  assert.equal(again.body.threads.find((t) => t.id === t1.id).replies.length, 1);
  assert.equal((await api('POST', `/boards/${B1}/comments/${r1.id}/restore`)).status, 200, 'restoring twice is fine');
  assert.equal(rpcs.length, 2, 'and calls nothing the second time');

  const scoped = await api('DELETE', `/boards/${B1}/comments/${r1.id}`, undefined, { token: 'sk_live_nodelete' });
  assert.deepEqual([scoped.status, scoped.body.code], [403, 'insufficient_scope']);
});

test('the routes around them', async () => {
  seedBoard();
  const { t1 } = seedThreads();
  assert.equal((await api('GET', `/boards/${B1}/comments/${t1.id}`)).status, 405);
  assert.equal((await api('GET', `/boards/${B1}/comments/${t1.id}/restore`)).status, 405);
  assert.equal((await api('POST', `/boards/${B1}/comments/${t1.id}/undo`)).status, 404);
  assert.equal((await api('PUT', `/boards/${B1}/comments`, {})).status, 405);
});

test('MCP: list_comments, add_comment, resolve_comments', async () => {
  seedBoard();
  const { t1 } = seedThreads();
  const list = await tool('list_comments', { board_id: B1 });
  assert.notEqual(list.isError, true, JSON.stringify(list));
  assert.deepEqual(list.structuredContent.counts, { open: 2, resolved: 1 });

  const added = await tool('add_comment', { board_id: B1, body: 'Try a warmer grade', card_id: 'c1' });
  assert.notEqual(added.isError, true, JSON.stringify(added));
  assert.equal(added.structuredContent.comment.on, 'card');
  const replied = await tool('add_comment', { board_id: B1, body: 'Done', reply_to: t1.id });
  assert.equal(replied.structuredContent.comment.reply_to, t1.id);

  const missing = randomUUID();
  const res = await tool('resolve_comments', { board_id: B1, comment_ids: [t1.id, missing, docThread, t1.id] });
  assert.notEqual(res.isError, true, JSON.stringify(res));
  const out = res.structuredContent;
  assert.deepEqual([out.changed, out.not_found, out.refused], [[t1.id, docThread], [missing], []]);
  assert.equal(table.find((x) => x.id === t1.id).resolved, true);
  assert.equal(roomThreads('d1')[0].resolved, true);

  const inDoc = await tool('add_comment', { board_id: B1, body: 'Name it', card_id: 'd1', quote: 'A diner' });
  assert.notEqual(inDoc.isError, true, JSON.stringify(inDoc));
  assert.deepEqual([inDoc.structuredContent.comment.on, inDoc.structuredContent.comment.quote], ['doc', 'A diner']);

  const bad = await tool('add_comment', { board_id: B1, body: 'x', card_id: 'c1', x: 1, y: 2 });
  assert.equal(bad.isError, true);
});

// ── Inside a doc ────────────────────────────────────────────────────────────

const roomCard = (cardId) => rooms.get(B1).doc.getMap('cards').get(cardId);
const roomThreads = (cardId) => readComments(null, { comments: roomCard(cardId).get('docComments') });
const roomQuotes = () => collectQuotes(pageContentMap(rooms.get(B1).doc, cardScope(roomCard('d1'))).get(docPage));

test('inside a doc: a reply and a resolve, filed as the app files them', async () => {
  seedBoard();
  const r = await api('POST', `/boards/${B1}/comments`, { body: '  Tighten it  ', reply_to: docThread });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body.comment).sort(),
    ['author_id', 'author_name', 'body', 'by_you', 'created_at', 'id', 'reply_to', 'url']);
  assert.deepEqual([r.body.comment.reply_to, r.body.comment.body, r.body.comment.author_name, r.body.comment.by_you],
    [docThread, 'Tighten it', 'Ana Ruiz', true]);
  assert.match(r.body.url, new RegExp(`\\?to=c:${B1}:d1$`));
  const replyId = r.body.comment.id;
  assert.match(replyId, /^cr_/);
  assert.ok(roomCard('d1').get('docComments').has(`${docThread}~r~${replyId}`), 'beside the thread, as the app files a reply');
  const [t] = roomThreads('d1');
  assert.deepEqual(t.replies.map((x) => [x.id, x.body, x.author, x.authorId, x.authorColor]),
    [[replyId, 'Tighten it', 'Ana Ruiz', U1, pickPresenceColor(U1)]]);
  assert.equal(roomCard('d1').get('updatedAt'), undefined, 'a comment is no edit of the card');

  const viaReply = await api('POST', `/boards/${B1}/comments`, { body: 'And the ending', reply_to: replyId });
  assert.equal(viaReply.body.comment.reply_to, docThread, 'a reply to a reply goes into the thread');

  const done = await api('PATCH', `/boards/${B1}/comments/${docThread}`, { resolved: true });
  assert.deepEqual([done.status, done.body.resolved], [200, true], JSON.stringify(done.body));
  assert.match(done.body.url, new RegExp(`\\?to=c:${B1}:d1$`));
  const [after] = roomThreads('d1');
  assert.deepEqual([after.resolved, after.resolvedBy, after.resolvedByName], [true, U1, 'Ana Ruiz']);

  const late = await api('POST', `/boards/${B1}/comments`, { body: 'x', reply_to: docThread });
  assert.deepEqual([late.status, late.body.code], [409, 'conflict'], 'as in the app: reopen it first');
  assert.match(late.body.error, /reopen it first/);
  assert.equal((await api('PATCH', `/boards/${B1}/comments/${docThread}`, { resolved: false })).body.resolved, false);
  assert.equal(roomThreads('d1')[0].resolved, false);

  const replyOne = await api('PATCH', `/boards/${B1}/comments/${replyId}`, { resolved: true });
  assert.equal(replyOne.status, 400);
  assert.match(replyOne.body.error, new RegExp(docThread));
});

test('inside a doc: a new thread on its words, highlighted as a selection is', async () => {
  seedBoard();
  const made = await api('POST', `/boards/${B1}/comments`, { body: 'Which diner?', card_id: 'd1', quote: 'A  diner' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const c = made.body.comment;
  assert.match(c.id, /^cm_/);
  assert.deepEqual([c.on, c.card_id, c.card_kind, c.card_title, c.page_id, c.page_title, c.quote, c.body, c.author_name, c.by_you, c.resolved, c.replies],
    ['doc', 'd1', 'doc', 'Treatment', docPage, 'Opening', 'A diner', 'Which diner?', 'Ana Ruiz', true, false, []]);
  assert.equal(roomQuotes().get(c.id), 'A diner', 'the room\'s page carries its mark');
  assert.equal(roomQuotes().get(docThread), 'at night', 'and the thread already there keeps its own');
  const [head] = roomThreads('d1').filter((x) => x.id === c.id);
  assert.deepEqual([head.pageId, head.author, head.authorId, head.authorColor, head.resolved], [docPage, 'Ana Ruiz', U1, pickPresenceColor(U1), false]);
  const list = await api('GET', `/boards/${B1}/comments`);
  assert.equal(list.body.threads.find((x) => x.id === c.id).quote, 'A diner');

  const n = (await api('POST', `/boards/${B1}/comments`, { body: 'x', card_id: 'd1', quote: 'n' }));
  assert.deepEqual([n.status, n.body.code], [400, 'bad_request']);
  assert.match(n.body.error, /2 times \(Opening\)/);
  for (const [b, status, code, re] of [
    [{ body: 'x', card_id: 'd1', quote: 'a diner' }, 400, 'bad_request', /aren't in this doc/],
    [{ body: 'x', card_id: 'd1', quote: 'diner', page_id: 'nope' }, 404, 'not_found', /no page nope/],
    [{ body: 'x', card_id: 'c2', quote: 'x' }, 400, 'bad_request', /in a note take a comment in the app/],
    [{ body: 'x', card_id: 'c1', quote: 'x' }, 400, 'bad_request', /isn't one/],
    [{ body: 'x', card_id: 'zz', quote: 'x' }, 404, 'not_found', /no such card/],
  ]) {
    const r = await api('POST', `/boards/${B1}/comments`, b);
    assert.deepEqual([r.status, r.body.code], [status, code], JSON.stringify(b));
    assert.match(r.body.error, re);
  }
  // Code takes no comment, as a selection of it takes none in the editor.
  const { doc } = rooms.get(B1);
  doc.transact(() => {
    const para = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    para.insert(0, [text]);
    pageContentMap(doc, cardScope(roomCard('d1'))).get(docPage).push([para]);
    text.insert(0, 'Run ');
    text.insert(4, 'npm test', { code: {} });
  });
  const code = await api('POST', `/boards/${B1}/comments`, { body: 'x', card_id: 'd1', quote: 'npm test' });
  assert.deepEqual([code.status, code.body.code], [400, 'bad_request']);
  assert.match(code.body.error, /code, which takes no comment/);
  assert.equal(roomThreads('d1').length, 2, 'nothing written for any of them');
});

test('inside a doc: only an editor writes, and nothing is written with the room away', async () => {
  seedBoard();
  writers.clear();
  for (const [method, path, b] of [
    ['POST', `/boards/${B1}/comments`, { body: 'x', reply_to: docThread }],
    ['POST', `/boards/${B1}/comments`, { body: 'x', card_id: 'd1', quote: 'diner' }],
    ['PATCH', `/boards/${B1}/comments/${docThread}`, { resolved: true }],
    ['DELETE', `/boards/${B1}/comments/${docThread}`],
  ]) {
    const r = await api(method, path, b);
    assert.deepEqual([r.status, r.body.code], [403, 'forbidden'], `${method} ${JSON.stringify(b)}`);
    assert.match(r.body.error, /editor/);
  }
  assert.equal(roomThreads('d1')[0].replies.length, 0);

  seedBoard({ down: true });
  writers.add(B1);
  for (const b of [{ body: 'x', reply_to: docThread }, { body: 'x', card_id: 'd1', quote: 'diner' }]) {
    const r = await api('POST', `/boards/${B1}/comments`, b);
    assert.deepEqual([r.status, r.body.code], [503, 'room_unavailable'], JSON.stringify(b));
  }
  assert.equal(roomThreads('d1')[0].replies.length, 0);
});

test('inside a doc: deleting your own thread takes it and its highlight; no restore', async () => {
  seedBoard();
  const theirs = await api('DELETE', `/boards/${B1}/comments/${docThread}`);
  assert.deepEqual([theirs.status, theirs.body.code], [403, 'forbidden'], 'Sam\'s thread: resolve it instead');

  const mine = (await api('POST', `/boards/${B1}/comments`, { body: 'Which diner?', card_id: 'd1', quote: 'A diner' })).body.comment;
  const gone = await api('DELETE', `/boards/${B1}/comments/${mine.id}`);
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.deepEqual([gone.body.deleted, gone.body.restore], [true, null]);
  assert.deepEqual(roomThreads('d1').map((x) => x.id), [docThread]);
  assert.equal(roomQuotes().has(mine.id), false, 'its highlight goes with it');
  assert.equal(roomQuotes().get(docThread), 'at night');
  assert.equal(rpcs.length, 0, 'the board\'s comments table is never touched');

  const busy = (await api('POST', `/boards/${B1}/comments`, { body: 'Too long', card_id: 'd1', quote: 'diner' })).body.comment;
  const scope = { comments: roomCard('d1').get('docComments') };
  addCommentReply(rooms.get(B1).doc, busy.id, { body: 'Disagree', author: 'Sam', authorId: U2, scope });
  const held = await api('DELETE', `/boards/${B1}/comments/${busy.id}`);
  assert.deepEqual([held.status, held.body.code], [409, 'conflict'], 'someone else has replied');
  const replyId = roomThreads('d1').find((x) => x.id === busy.id).replies[0].id;
  assert.equal((await api('DELETE', `/boards/${B1}/comments/${replyId}`)).status, 400);
  assert.equal((await api('DELETE', `/boards/${B1}/comments/cm_nope`)).status, 404);

  const back = await api('POST', `/boards/${B1}/comments/${mine.id}/restore`);
  assert.deepEqual([back.status, back.body.code], [400, 'bad_request']);
});

test('PATCH /comments: several threads of either kind, each answered', async () => {
  seedBoard();
  const { t1, r1 } = seedThreads();
  const missing = randomUUID();
  const r = await api('PATCH', `/boards/${B1}/comments`, { comment_ids: [docThread, t1.id, r1.id, missing, 'cm_nope'], resolved: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.changed, r.body.not_found], [[docThread, t1.id], [missing, 'cm_nope']]);
  assert.deepEqual(r.body.refused.map((x) => [x.id, x.code]), [[r1.id, 'bad_request']]);
  assert.equal(table.find((x) => x.id === t1.id).resolved, true);
  assert.equal(roomThreads('d1')[0].resolved, true);
  const again = await api('PATCH', `/boards/${B1}/comments`, { comment_ids: [docThread, t1.id], resolved: true });
  assert.deepEqual(again.body.changed, [docThread, t1.id], 'already so is done');

  assert.equal((await api('PATCH', `/boards/${B1}/comments`, { comment_ids: [t1.id] })).status, 400);

  seedBoard({ down: true });
  const away = await api('PATCH', `/boards/${B1}/comments`, { comment_ids: [docThread, t1.id], resolved: false });
  assert.equal(away.status, 200);
  assert.deepEqual(away.body.changed, [t1.id], 'the board\'s own are still changed');
  assert.deepEqual(away.body.refused.map((x) => [x.id, x.code]), [[docThread, 'room_unavailable']]);
});
